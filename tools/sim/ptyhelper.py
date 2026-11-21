#!/usr/bin/env python3
"""Run a shell in a real pseudo-terminal for the simulator's mock SSH server.
stdin/stdout carry terminal data; fd 3 receives 'cols rows\\n' resize lines."""
import fcntl, os, pty, select, signal, struct, sys, termios

cols, rows = int(sys.argv[1]), int(sys.argv[2])
pid, fd = pty.fork()
if pid == 0:
    # Neutral demo environment (no personal prompt/hostname in screenshots).
    home = os.environ.get('SIM_HOME') or os.getcwd()
    os.makedirs(home, exist_ok=True)
    os.chdir(home)
    os.environ.update(TERM='xterm-256color', HOME=home, PS1='\\[\\e[1;32m\\]demo@server\\[\\e[0m\\]:\\[\\e[1;34m\\]\\w\\[\\e[0m\\]$ ')
    os.execvp('bash', ['bash', '--norc', '--noprofile'])

def setsize(c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
    try: os.kill(pid, signal.SIGWINCH)
    except OSError: pass

setsize(cols, rows)
ctl, buf = 3, b''
fds = [0, fd, ctl]
while True:
    try: r, _, _ = select.select(fds, [], [])
    except InterruptedError: continue
    if fd in r:
        try: data = os.read(fd, 65536)
        except OSError: break
        if not data: break
        os.write(1, data)
    if 0 in r:
        data = os.read(0, 65536)
        if not data: break
        os.write(fd, data)
    if ctl in r:
        data = os.read(ctl, 1024)
        if not data: fds.remove(ctl); continue
        buf += data
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1)
            try: c, rr = map(int, line.split()); setsize(c, rr)
            except ValueError: pass
try: os.kill(pid, signal.SIGHUP)
except OSError: pass
