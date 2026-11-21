#!/usr/bin/env python3
"""Drive the simulator in headless Chromium like a TV remote (1920x1080).

  python3 tools/sim/drive.py start                      launch headless chromium on the simulator
  python3 tools/sim/drive.py key BACK OK DOWN RED ...   remote buttons (LEFT UP RIGHT DOWN OK BACK RED GREEN YELLOW BLUE) or keyCodes
  python3 tools/sim/drive.py type 'ls -la'              type text like a USB keyboard (\\n = Enter)
  python3 tools/sim/drive.py ctrl c                     Ctrl+<key> from a USB keyboard
  python3 tools/sim/drive.py eval '<js>'                evaluate in the page
  python3 tools/sim/drive.py shot out.png               screenshot
  python3 tools/sim/drive.py drag x1 y1 x2 y2           pointer drag (Magic Remote select)
"""
import base64, json, os, subprocess, sys, time, urllib.request
import websocket

PORT = 9333
URL = 'http://127.0.0.1:8080/'
REMOTE = {'LEFT': 37, 'UP': 38, 'RIGHT': 39, 'DOWN': 40, 'OK': 13, 'BACK': 461, 'RED': 403, 'GREEN': 404, 'YELLOW': 405, 'BLUE': 406}
NAMES = {37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 13: 'Enter', 8: 'Backspace', 9: 'Tab', 27: 'Escape'}


TV = os.environ.get('SSHTERM_TV')   # e.g. 192.168.100.110:9998 -> drive the app on a real TV's web inspector


def ws_url():
    if TV:
        for p in json.load(urllib.request.urlopen('http://%s/json' % TV, timeout=5)):
            if p.get('description') == 'com.homebrew.sshterm' and p.get('type') == 'page':
                return p['webSocketDebuggerUrl']
        sys.exit('SSH Terminal is not running on the TV')
    for p in json.load(urllib.request.urlopen('http://127.0.0.1:%d/json' % PORT, timeout=5)):
        if p.get('type') == 'page':
            return p['webSocketDebuggerUrl']


class CDP:
    def __init__(self):
        self.ws = websocket.create_connection(ws_url(), timeout=30, suppress_origin=True)
        self.n = 0
        if not TV:
            self.call('Emulation.setDeviceMetricsOverride', width=1920, height=1080, deviceScaleFactor=1, mobile=False)

    def call(self, method, **params):
        self.n += 1
        self.ws.send(json.dumps({'id': self.n, 'method': method, 'params': params}))
        while True:
            m = json.loads(self.ws.recv())
            if m.get('id') == self.n:
                if 'error' in m:
                    raise RuntimeError(m['error'])
                return m['result']

    def key(self, kc, key='', text='', mods=0):
        self.call('Input.dispatchKeyEvent', type='rawKeyDown', windowsVirtualKeyCode=kc, key=key or NAMES.get(kc, ''), modifiers=mods)
        if text:
            self.call('Input.dispatchKeyEvent', type='char', text=text, key=key, modifiers=mods)
        self.call('Input.dispatchKeyEvent', type='keyUp', windowsVirtualKeyCode=kc, key=key or NAMES.get(kc, ''), modifiers=mods)


def main():
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'start':
        subprocess.Popen(['chromium', '--headless=new', '--remote-debugging-port=%d' % PORT, '--window-size=1920,1080',
                          '--user-data-dir=' + os.path.join(os.environ.get('TMPDIR', '/tmp'), 'sshterm-sim-profile'),
                          '--no-first-run', '--hide-scrollbars', URL], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(40):
            try:
                ws_url(); print('chromium ready'); return
            except Exception:
                time.sleep(0.25)
        sys.exit('chromium did not start')
    c = CDP()
    if cmd == 'key':
        for a in args:
            kc = REMOTE.get(a.upper()) or int(a)
            c.key(kc); time.sleep(0.15)
    elif cmd == 'type':
        for ch in args[0].replace('\\n', '\n'):
            if ch == '\n':
                c.key(13, 'Enter')
            else:
                kc = ord(ch.upper()) if ch.isalnum() else 0
                c.key(kc, ch, ch)
            time.sleep(0.02)
    elif cmd == 'ctrl':
        ch = args[0]
        c.key(ord(ch.upper()), ch, '', mods=2)
    elif cmd == 'eval':
        r = c.call('Runtime.evaluate', expression=args[0], awaitPromise=True, returnByValue=True)
        print(r['exceptionDetails'] if 'exceptionDetails' in r else json.dumps(r['result'].get('value')))
    elif cmd == 'shot':
        open(args[0], 'wb').write(base64.b64decode(c.call('Page.captureScreenshot', format='png')['data']))
        print(args[0])
    elif cmd == 'drag':
        x1, y1, x2, y2 = map(float, args)
        c.call('Input.dispatchMouseEvent', type='mouseMoved', x=x1, y=y1)
        c.call('Input.dispatchMouseEvent', type='mousePressed', x=x1, y=y1, button='left', clickCount=1)
        for i in range(1, 11):
            c.call('Input.dispatchMouseEvent', type='mouseMoved', x=x1 + (x2 - x1) * i / 10, y=y1 + (y2 - y1) * i / 10, button='left', buttons=1)
        c.call('Input.dispatchMouseEvent', type='mouseReleased', x=x2, y=y2, button='left', clickCount=1)


if __name__ == '__main__':
    main()
