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
