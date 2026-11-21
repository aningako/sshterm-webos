#!/usr/bin/env python3
"""Fetch vim, nano, curl, wget and netstat for the TV's local shell, from official Alpine Linux armv7 packages.

Every package is checked against the checksum in Alpine's APKINDEX (downloaded over HTTPS) before use.
Output: app/com.homebrew.sshterm/tools/
    bin/       wrapper scripts (vim, vi, nano, curl, wget, netstat, xxd, busybox) - put this dir on PATH
    libexec/   the real binaries (run through the bundled musl loader, so nothing on the TV is touched)
    lib/       musl loader + shared libraries
    share/     terminfo, vim runtime, nano syntax files
    etc/       CA certificates, nanorc
    env.sh / login.sh   environment for the 'This TV' shell

Usage: python3 scripts/fetch_tools.py [--branch v3.24]
"""
import base64, hashlib, io, os, re, shutil, subprocess, sys, tarfile, urllib.request, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'com.homebrew.sshterm', 'tools')
CACHE = os.path.join(ROOT, 'build', 'apk-cache')
ARCH = 'armv7'
LOADER = 'ld-musl-armhf.so.1'
BRANCH = sys.argv[sys.argv.index('--branch') + 1] if '--branch' in sys.argv else 'v3.24'
MIRROR = 'https://dl-cdn.alpinelinux.org/alpine/%s/%%s/%s/' % (BRANCH, ARCH)
WANT = ['musl', 'vim', 'nano', 'curl', 'wget', 'busybox-static', 'ncurses-terminfo-base', 'ca-certificates-bundle', 'nano-syntax']
# Things the packages "depend on" that we don't need inside a self-contained tools dir.
SKIP = {'busybox', 'busybox-binsh', 'alpine-baselayout', 'alpine-baselayout-data', 'apk-tools', 'ca-certificates',
        'musl-utils', 'scanelf', 'libc-utils'}
BINARIES = {  # wrapper name -> (path inside rootfs, extra args)
    'vim': ('usr/bin/vim', []), 'vi': ('usr/bin/vim', []), 'xxd': ('usr/bin/xxd', []),
    'nano': ('usr/bin/nano', []), 'curl': ('usr/bin/curl', []), 'wget': ('usr/bin/wget', []),
}
VIM_DROP = {'doc', 'tutor', 'lang', 'spell', 'print', 'keymap', 'pack', 'tools', 'macros'}


def fetch(url, dest):
    if not os.path.exists(dest):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with urllib.request.urlopen(url, timeout=60) as r, open(dest + '.part', 'wb') as f:
            shutil.copyfileobj(r, f)
        os.replace(dest + '.part', dest)
    return open(dest, 'rb').read()


def gzip_members(data):
    """Split concatenated gzip streams; return list of raw member byte strings."""
    out, pos = [], 0
    while pos < len(data):
        d = zlib.decompressobj(31)
        d.decompress(data[pos:])
        end = len(data) - len(d.unused_data)
        out.append(data[pos:end])
        pos = end
    return out


def load_index():
    pkgs = {}
    for repo in ('main', 'community'):
        raw = fetch(MIRROR % repo + 'APKINDEX.tar.gz', os.path.join(CACHE, BRANCH, repo, 'APKINDEX.tar.gz'))
        tf = tarfile.open(fileobj=io.BytesIO(raw))
        text = tf.extractfile('APKINDEX').read().decode()
        for block in text.strip().split('\n\n'):
            e = {'repo': repo, 'deps': [], 'provides': []}
            for line in block.splitlines():
                k, _, v = line.partition(':')
                if k == 'P': e['name'] = v
                elif k == 'V': e['ver'] = v
                elif k == 'C': e['csum'] = v
                elif k == 'D': e['deps'] = v.split()
                elif k == 'p': e['provides'] = v.split()
            if 'name' in e:
                pkgs.setdefault(e['name'], e)
    provides = {}
    for e in pkgs.values():
        provides.setdefault(e['name'], e['name'])
        for p in e['provides']:
            provides.setdefault(p.split('=')[0], e['name'])
    return pkgs, provides


def resolve(pkgs, provides):
    todo, seen = list(WANT), []
    while todo:
        n = todo.pop(0)
        if n in seen or n in SKIP:
            continue
        seen.append(n)
        for d in pkgs[n]['deps']:
            if d.startswith('!'):
                continue
            for op in ('>=', '<=', '=', '>', '<', '~'):
                d = d.split(op)[0]
            name = provides.get(d)
            if name is None:
                raise SystemExit('cannot resolve dependency %s of %s' % (d, n))
            todo.append(name)
    return seen


def extract(pkg, rootfs):
    fn = '%s-%s.apk' % (pkg['name'], pkg['ver'])
    data = fetch(MIRROR % pkg['repo'] + fn, os.path.join(CACHE, BRANCH, pkg['repo'], fn))
    members = gzip_members(data)
    control, payload = (members[1], members[2]) if len(members) >= 3 else (members[0], members[1])
    got = 'Q1' + base64.b64encode(hashlib.sha1(control).digest()).decode()
    if got != pkg['csum']:
        raise SystemExit('CHECKSUM MISMATCH for %s: %s != %s' % (fn, got, pkg['csum']))
    tf = tarfile.open(fileobj=io.BytesIO(zlib.decompress(payload, 31)))
    for m in tf.getmembers():
        if m.name.startswith('.') or '..' in m.name.split('/'):
            continue
        dest = os.path.join(rootfs, m.name)
        if m.isdir():
            os.makedirs(dest, exist_ok=True)
        elif m.issym():
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if os.path.lexists(dest): os.remove(dest)
            os.symlink(m.linkname, dest)
        elif m.isfile():
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, 'wb') as f:
                f.write(tf.extractfile(m).read())
            os.chmod(dest, 0o755 if m.mode & 0o111 else 0o644)
    return fn


def copy_real(src, dst, mode=0o644):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(os.path.realpath(src), dst)
    os.chmod(dst, mode)


def copy_tree(src, dst, drop=()):
    for dp, dns, fns in os.walk(src):
        dns[:] = sorted(x for x in dns if not (dp == src and x in drop))
        for fn in fns:
            s = os.path.join(dp, fn)
            if not os.path.exists(s):
                continue  # dangling symlink
            copy_real(s, os.path.join(dst, os.path.relpath(s, src)))


WRAPPER = '''#!/bin/sh
# SSH Terminal tools: run the bundled %(name)s through the bundled musl loader.
T=$(cd "$(dirname "$0")/.." && pwd)
. "$T/env.sh"
exec "$T/lib/%(loader)s" --library-path "$T/lib" --argv0 %(name)s "$T/libexec/%(bin)s"%(args)s "$@"
'''

ENV = '''# SSH Terminal tools environment (sourced by wrappers and the 'This TV' shell).
[ -n "$T" ] || T=/media/developer/apps/usr/palm/applications/com.homebrew.sshterm/tools
case ":$PATH:" in *":$T/bin:"*) ;; *) PATH="$T/bin:$PATH" ;; esac
export PATH
export TERMINFO="$T/share/terminfo"
export VIM="$T/share/vim" VIMRUNTIME="$T/share/vim/%(vimdir)s"
export CURL_CA_BUNDLE="$T/etc/ssl/cert.pem" SSL_CERT_FILE="$T/etc/ssl/cert.pem"
export NANORC="$T/etc/nanorc"
[ -n "$TERM" ] || export TERM=xterm-256color
[ -n "$EDITOR" ] || export EDITOR=nano
'''

LOGIN = '''#!/bin/sh
# Forced command for the TV key on this TV's own root account: set up the tools, then run the shell/command.
T=$(cd "$(dirname "$0")" && pwd)
. "$T/env.sh"
cd "${HOME:-/}" 2>/dev/null
if [ -n "$SSH_ORIGINAL_COMMAND" ]; then exec /bin/sh -c "$SSH_ORIGINAL_COMMAND"; fi
for sh in /bin/bash /bin/sh; do [ -x "$sh" ] && exec "$sh" -l; done
'''


def main():
    pkgs, provides = load_index()
    names = resolve(pkgs, provides)
    rootfs = os.path.join(ROOT, 'build', 'rootfs-' + ARCH)
    shutil.rmtree(rootfs, ignore_errors=True)
    for n in names:
        print('  %-28s %s' % (n, extract(pkgs[n], rootfs)))

    shutil.rmtree(OUT, ignore_errors=True)
    for d in ('bin', 'libexec', 'lib', 'share', 'etc/ssl'):
        os.makedirs(os.path.join(OUT, d), exist_ok=True)

    # loader + exactly the shared libraries the binaries need (DT_NEEDED, recursively; dereferenced: no symlinks in IPK)
    copy_real(os.path.join(rootfs, 'lib', LOADER), os.path.join(OUT, 'lib', LOADER), 0o755)
    todo = [os.path.join(rootfs, p) for p, _ in BINARIES.values()]
    done = set()
    while todo:
        elf = todo.pop()
        out = subprocess.run(['readelf', '-d', elf], capture_output=True, text=True, check=True).stdout
        for so in re.findall(r'\(NEEDED\)\s+Shared library: \[([^\]]+)\]', out):
            if so in done or so.startswith('libc.musl'):
                continue  # libc.musl-armv7.so.1 is the loader itself
            done.add(so)
            src = next((os.path.join(rootfs, d, so) for d in ('lib', 'usr/lib') if os.path.exists(os.path.join(rootfs, d, so))), None)
            if not src:
                raise SystemExit('missing library ' + so)
            copy_real(src, os.path.join(OUT, 'lib', so))
            todo.append(src)
    print('  libraries:', ' '.join(sorted(done)))

    vimdir = sorted(x for x in os.listdir(os.path.join(rootfs, 'usr/share/vim')) if x.startswith('vim'))[-1]
    for name, (path, args) in BINARIES.items():
        bin_name = os.path.basename(path)
        copy_real(os.path.join(rootfs, path), os.path.join(OUT, 'libexec', bin_name), 0o755)
        w = WRAPPER % {'name': name, 'loader': LOADER, 'bin': bin_name, 'args': ''.join(' ' + a for a in args)}
        open(os.path.join(OUT, 'bin', name), 'w').write(w)

    # busybox is static: netstat (and the rest of busybox) need no loader
    copy_real(os.path.join(rootfs, 'bin/busybox.static'), os.path.join(OUT, 'libexec', 'busybox'), 0o755)
    open(os.path.join(OUT, 'bin', 'netstat'), 'w').write(
        '#!/bin/sh\nexec "$(cd "$(dirname "$0")/.." && pwd)/libexec/busybox" netstat "$@"\n')
    open(os.path.join(OUT, 'bin', 'busybox'), 'w').write(
        '#!/bin/sh\nexec "$(cd "$(dirname "$0")/.." && pwd)/libexec/busybox" "$@"\n')

    copy_tree(os.path.join(rootfs, 'etc/terminfo'), os.path.join(OUT, 'share/terminfo'))
    copy_tree(os.path.join(rootfs, 'usr/share/vim', vimdir), os.path.join(OUT, 'share/vim', vimdir), VIM_DROP)
    open(os.path.join(OUT, 'share/vim/vimrc'), 'w').write('source $VIMRUNTIME/defaults.vim\nset mouse=a\n')
    copy_tree(os.path.join(rootfs, 'usr/share/nano'), os.path.join(OUT, 'share/nano'))
    copy_real(os.path.join(rootfs, 'etc/ssl/certs/ca-certificates.crt'), os.path.join(OUT, 'etc/ssl/cert.pem'))
    # nano: syntax highlighting via relative includes is not supported, so list files by absolute install path
    inst = '/media/developer/apps/usr/palm/applications/com.homebrew.sshterm/tools/share/nano/'
    rc = ['set mouse', 'set linenumbers', 'set autoindent'] + [
        'include "%s%s"' % (inst, fn) for fn in sorted(os.listdir(os.path.join(OUT, 'share/nano'))) if fn.endswith('.nanorc')]
    open(os.path.join(OUT, 'etc/nanorc'), 'w').write('\n'.join(rc) + '\n')

    open(os.path.join(OUT, 'env.sh'), 'w').write(ENV % {'vimdir': vimdir})
    open(os.path.join(OUT, 'login.sh'), 'w').write(LOGIN)
    for p in [os.path.join(OUT, 'bin', x) for x in os.listdir(os.path.join(OUT, 'bin'))] + [os.path.join(OUT, 'login.sh')]:
        os.chmod(p, 0o755)

    with open(os.path.join(OUT, 'PACKAGES.txt'), 'w') as f:
        f.write('Bundled from Alpine Linux %s (%s). Sources: https://gitlab.alpinelinux.org/alpine/aports\n\n' % (BRANCH, ARCH))
        for n in names:
            f.write('%s %s (%s)\n' % (n, pkgs[n]['ver'], pkgs[n]['repo']))

    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
    print('tools written to %s (%.1f MB)' % (OUT, total / 1e6))


if __name__ == '__main__':
    main()
