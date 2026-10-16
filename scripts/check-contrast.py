#!/usr/bin/env python3
"""校验 tokens.css 中每种纸的对比度（DESIGN.md §2）。新增或调整纸张后运行。"""
import re
import sys
from pathlib import Path

css = (Path(__file__).resolve().parent.parent / "frontend/src/design/tokens.css").read_text()
RULES = [("ink", 12.0), ("ink-3", 3.5), ("cinnabar", 4.5)]


def lum(h):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a, b):
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


ok = True
for name, body in re.findall(r'\[data-paper="(\w+)"\]\s*\{(.*?)\n\}', css, re.S):
    v = dict(re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})", body))
    cells = []
    for key, need in RULES:
        r = ratio(v[key], v["paper"])
        cells.append(f"{key} {r:5.2f}{'' if r >= need else ' ✗'}")
        ok &= r >= need
    print(f"{name:6} " + "  ".join(cells))
print("✓ 全部达标" if ok else "✗ 有纸张不达标")
sys.exit(0 if ok else 1)
