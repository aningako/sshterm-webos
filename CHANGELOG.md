# Changelog

## 1.0.0 (2026-11-21)
First version. Created by aning with Claude.
- SSH client in a luna service (ssh2): password, keyboard-interactive, TV key and own private key; host key checking.
- Full-screen xterm terminal (canvas renderer, DejaVu Sans Mono), resizes to fit, font size A−/A+.
- Remote control: Back menu, color keys (^C / Tab / Esc / Type), on-screen keyboard "Type…" dialog, sticky Ctrl/Alt.
- Copy/paste: select-to-copy with the pointer, Copy screen / Copy all, Paste, Ctrl+Shift+C/V, persistent clipboard.
- TV key: generate an ed25519 key, install it on a server from the menu.
- "This TV" root shell on rooted TVs, with bundled vim, nano, curl, wget, netstat (Alpine armv7).
- Desktop simulator (tools/sim) for testing without a TV.
- Back twice exits (home screen or terminal), plus *Exit app* in the menu.
- Tested on an LG 50UR7550 (webOS 10.3.1). Fixed there: the terminal was drawn twice too large (webOS reports
  devicePixelRatio 2; the DOM renderer is used on the TV), last row cut off, "This TV" shell exiting at once
  (/bin/bash is busybox there) and losing TERM, vim's netrw error, on-screen keyboard covering dialog buttons.
  Default font 20px.
