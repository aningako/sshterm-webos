# Third-party components

## Web app
- **xterm.js** 5.5.0, @xterm/addon-fit 0.10.0, @xterm/addon-canvas 0.7.0, MIT (`app/com.homebrew.sshterm/lib/xterm.LICENSE`)
- **DejaVu Sans Mono** fonts, Bitstream Vera / DejaVu free font license

## Service (`service/com.homebrew.sshterm.service/node_modules`)
- **ssh2** 1.16.0, MIT
- **asn1** 0.2.6, MIT
- **bcrypt-pbkdf** 1.0.2, BSD-3-Clause
- **safer-buffer** 2.1.2, MIT
- **tweetnacl** 0.14.5, Unlicense

## "This TV" tools (`app/com.homebrew.sshterm/tools`, built by `scripts/fetch_tools.py`, shipped in the IPK)
Unmodified binaries from official Alpine Linux packages. Each package's source, build recipe and license is at https://gitlab.alpinelinux.org/alpine/aports (pick the matching branch), and source tarballs are at https://dl-cdn.alpinelinux.org/alpine/. Licenses include Vim (vim), GPL-3.0 (nano, wget), curl (curl), GPL-2.0 (busybox), MIT (musl).

```
Bundled from Alpine Linux v3.24 (armv7). Sources: https://gitlab.alpinelinux.org/alpine/aports

musl 1.2.6-r3 (main)
vim 9.2.1352-r0 (community)
nano 9.3-r0 (main)
curl 8.23.0-r0 (main)
wget 1.25.0-r3 (main)
busybox-static 1.37.0-r31 (main)
ncurses-terminfo-base 6.6_p20260516-r0 (main)
ca-certificates-bundle 20261020-r0 (main)
nano-syntax 9.3-r0 (main)
vim-common 9.2.1352-r0 (community)
xxd 9.2.1352-r0 (community)
libncursesw 6.6_p20260516-r0 (main)
pixman 0.46.4-r0 (main)
libcurl 8.23.0-r0 (main)
zlib 1.4-r0 (main)
libcrypto3 3.5.9-r1 (main)
libidn2 2.3.8-r0 (main)
pcre2 10.49-r0 (main)
libssl3 3.5.9-r1 (main)
brotli-libs 1.2.1-r0 (main)
c-ares 1.34.9-r0 (main)
nghttp2-libs 1.70.0-r0 (main)
libpsl 0.21.5-r3 (main)
zstd-libs 1.5.7-r2 (main)
libunistring 1.4.2-r0 (main)
```
