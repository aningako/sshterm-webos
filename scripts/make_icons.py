#!/usr/bin/env python3
"""Draw the SSH Terminal icons (original artwork): icon.png 80x80, largeIcon.png 130x130, plus a 512px preview."""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'com.homebrew.sshterm')
MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'


def draw(size):
    S = size * 4
    im = Image.new('RGB', (S, S))
    px = im.load()
    for y in range(S):                      # diagonal gradient: teal -> deep blue
        for x in range(S):
            t = (x + y) / (2 * S)
            px[x, y] = (int(20 * (1 - t) + 18 * t), int(170 * (1 - t) + 40 * t), int(150 * (1 - t) + 120 * t))
    d = ImageDraw.Draw(im)
    # terminal window
    m, top = S * 0.12, S * 0.17
    d.rounded_rectangle([m, top, S - m, S - top * 0.85], radius=S * 0.07, fill=(11, 18, 32))
    d.rounded_rectangle([m, top, S - m, top + S * 0.12], radius=S * 0.07, fill=(27, 39, 64))
    d.rectangle([m, top + S * 0.07, S - m, top + S * 0.12], fill=(27, 39, 64))
    for i, c in enumerate([(255, 92, 122), (255, 196, 0), (46, 230, 166)]):
        cx, cy, r = m + S * (0.085 + i * 0.07), top + S * 0.06, S * 0.022
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)
    # prompt ">_"
    f = ImageFont.truetype(MONO, int(S * 0.33))
    d.text((m + S * 0.08, top + S * 0.17), '>', font=f, fill=(46, 230, 166))
    d.rectangle([m + S * 0.33, top + S * 0.49, m + S * 0.55, top + S * 0.535], fill=(230, 237, 247))
    # tiny "ssh" label
    f2 = ImageFont.truetype(MONO, int(S * 0.1))
    d.text((S - m - S * 0.25, S - top * 0.85 - S * 0.15), 'ssh', font=f2, fill=(63, 169, 245))
    # rounded mask (webOS shows icons as-is)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.2, fill=255)
    bg = Image.new('RGB', (S, S), (11, 18, 32))
    bg.paste(im, (0, 0), mask)
    return bg.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    draw(80).save(os.path.join(OUT, 'icon.png'))
    draw(130).save(os.path.join(OUT, 'largeIcon.png'))
    os.makedirs(os.path.join(ROOT, 'docs'), exist_ok=True)
    draw(512).save(os.path.join(ROOT, 'docs', 'icon-512.png'))
    print('icons written')
