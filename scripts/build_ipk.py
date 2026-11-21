#!/usr/bin/env python3
"""Build the webOS IPK (app + JS service) without the webOS CLI (same layout as `ares-package`).

Usage: python3 scripts/build_ipk.py            -> releases/<id>_<version>_all.ipk
Run scripts/fetch_tools.py first if app/com.homebrew.sshterm/tools/ is missing.
"""
import io, json, os, sys, tarfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(ROOT, 'app', 'com.homebrew.sshterm')
SVC_DIR = os.path.join(ROOT, 'service', 'com.homebrew.sshterm.service')
OUT_DIR = os.path.join(ROOT, 'releases')
NOW = int(time.time())


def is_exec(rel):
    rel = rel.replace(os.sep, '/')
    return (rel.startswith('tools/bin/') or rel.startswith('tools/libexec/') or rel == 'tools/login.sh'
            or rel.startswith('tools/lib/ld-musl'))


def tar_gz(entries):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz', format=tarfile.GNU_FORMAT) as tf:
        for name, data, mode in entries:
            ti = tarfile.TarInfo(name)
            ti.mtime, ti.mode, ti.uid, ti.gid = NOW, mode, 0, 0
            if data is None:
                ti.type = tarfile.DIRTYPE
                tf.addfile(ti)
            else:
                ti.size = len(data)
                tf.addfile(ti, io.BytesIO(data))
    return buf.getvalue()


def ar(members):
    out = [b'!<arch>\n']
    for name, data in members:
        out.append(('%-16s%-12d%-6d%-6d%-8s%-10d`\n' % (name, NOW, 0, 0, '100644', len(data))).encode('ascii'))
        out.append(data)
        if len(data) % 2:
            out.append(b'\n')
    return b''.join(out)


def walk(src, base, dirs, files, skip=()):
    size = 0
    for dp, dns, fns in os.walk(src):
        dns[:] = sorted(d for d in dns if d not in skip)
        rel = os.path.relpath(dp, src)
        if rel != '.':
            dirs.append(base + '/' + rel.replace(os.sep, '/'))
        for fn in sorted(fns):
            p = os.path.join(dp, fn)
            if os.path.islink(p) and not os.path.exists(p):
                continue
            r = fn if rel == '.' else os.path.join(rel, fn)
            data = open(p, 'rb').read()
            files.append((base + '/' + r.replace(os.sep, '/'), data, 0o755 if is_exec(r) else 0o644))
            size += len(data)
    return size


def main():
    if not os.path.isdir(os.path.join(APP_DIR, 'tools')):
        sys.exit('tools/ missing: run python3 scripts/fetch_tools.py first')
    info = json.load(open(os.path.join(APP_DIR, 'appinfo.json')))
    svc_id = json.load(open(os.path.join(SVC_DIR, 'services.json')))['id']
    app_id, version = info['id'], info['version']
    app_base, svc_base, pkg_base = 'usr/palm/applications/' + app_id, 'usr/palm/services/' + svc_id, 'usr/palm/packages/' + app_id

    dirs = ['usr', 'usr/palm', 'usr/palm/applications', 'usr/palm/services', 'usr/palm/packages', app_base, svc_base, pkg_base]
    files = []
    size = walk(APP_DIR, app_base, dirs, files)
    size += walk(SVC_DIR, svc_base, dirs, files)
    pkginfo = json.dumps({'id': app_id, 'version': version, 'app': app_id, 'services': [svc_id]}, indent=2).encode()
    files.append((pkg_base + '/packageinfo.json', pkginfo, 0o644))

    data_tgz = tar_gz([(d, None, 0o755) for d in dirs] + files)
    control = ('Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\n'
               'Installed-Size: %d\nMaintainer: aning <aningako@users.noreply.github.com>\n'
               'Description: SSH Terminal for LG webOS TVs. Created by aning with Claude.\n'
               'webOS-Package-Format-Version: 2\nwebOS-Packager-Version: x.y.x\n') % (app_id, version, size)
    control_tgz = tar_gz([('control', control.encode(), 0o644)])

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, '%s_%s_all.ipk' % (app_id, version))
    with open(out, 'wb') as f:
        f.write(ar([('debian-binary', b'2.0\n'), ('control.tar.gz', control_tgz), ('data.tar.gz', data_tgz)]))
    print('%s (%.1f MB)' % (out, os.path.getsize(out) / 1e6))


if __name__ == '__main__':
    sys.exit(main())
