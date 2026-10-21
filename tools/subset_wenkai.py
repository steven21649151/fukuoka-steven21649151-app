#!/usr/bin/env python3
"""一次性腳本：把霞鶩文楷 TC 子集化成 woff2，給手帳疊字／拼貼用。

用法：
    pip install fonttools brotli
    python tools/subset_wenkai.py <放 TTF 的資料夾>

TTF 來源：https://github.com/lxgw/LxgwWenkaiTC/releases （SIL OFL 1.1）
  LXGWWenKaiTC-Regular.ttf → fonts/wenkai-tc-regular.woff2
  LXGWWenKaiTC-Medium.ttf  → fonts/wenkai-tc-bold.woff2   （Release 沒有 Bold，用最接近的 Medium 當粗體）

這支腳本不進 SW 快取，只在要重新產生字型時跑。
"""
import glob
import json
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'fonts')

JOBS = [
    ('LXGWWenKaiTC-Regular.ttf', 'wenkai-tc-regular.woff2'),
    ('LXGWWenKaiTC-Medium.ttf', 'wenkai-tc-bold.woff2'),
]


def big5_common():
    """Big5 0xA440–0xC67E 的常用字（約 5,401 字）。"""
    chars = set()
    for lead in range(0xA4, 0xC7):
        for trail in list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF)):
            code = (lead << 8) | trail
            if code < 0xA440 or code > 0xC67E:
                continue
            try:
                chars.add(bytes([lead, trail]).decode('big5'))
            except UnicodeDecodeError:
                pass
    return chars


def ranges(*spans):
    out = set()
    for a, b in spans:
        out.update(chr(c) for c in range(a, b + 1))
    return out


def strings_in(node, sink):
    if isinstance(node, str):
        sink.update(node)
    elif isinstance(node, list):
        for x in node:
            strings_in(x, sink)
    elif isinstance(node, dict):
        for k, v in node.items():
            sink.update(k)
            strings_in(v, sink)


def data_chars():
    chars = set()
    for path in glob.glob(os.path.join(ROOT, 'data', '*.json')):
        with open(path, encoding='utf-8') as f:
            strings_in(json.load(f), chars)
    return chars


def build_charset():
    chars = set()
    chars |= big5_common()
    chars |= ranges((0x20, 0x7E), (0xFF00, 0xFFEF), (0x3000, 0x303F), (0x3040, 0x30FF))
    chars |= data_chars()
    chars |= set('·・—–…「」『』（）、。，！？：；%°¥')
    chars -= set('\n\r\t')
    return chars


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src_dir = sys.argv[1]
    os.makedirs(OUT_DIR, exist_ok=True)
    charset = build_charset()
    print(f'字集：{len(charset)} 字')
    for src_name, out_name in JOBS:
        src = os.path.join(src_dir, src_name)
        out = os.path.join(OUT_DIR, out_name)
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.layout_features = ['kern', 'liga', 'ccmp', 'locl', 'mark', 'mkmk']
        opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
        opts.notdef_outline = True
        opts.glyph_names = False
        opts.hinting = False
        font = TTFont(src)
        sub = subset.Subsetter(opts)
        sub.populate(text=''.join(sorted(charset)))
        sub.subset(font)
        font.flavor = 'woff2'
        font.save(out)
        print(f'{out_name}: {os.path.getsize(out) / 1024 / 1024:.2f} MB')


if __name__ == '__main__':
    main()
