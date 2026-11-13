#!/usr/bin/env python3
"""生成飞牛应用图标（纯标准库，无第三方依赖）。

输出 4 个文件，尺寸与 fnOS 约定一致：
  packaging/fnos/ICON.PNG            64x64
  packaging/fnos/ICON_256.PNG        256x256
  packaging/fnos/app/ui/images/icon_64.png
  packaging/fnos/app/ui/images/icon_256.png

图形与应用内 logo 一致：圆角底板 + 白色相片卡 + 山峦与太阳。
用法：python3 scripts/make_icons.py
"""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FNOS = ROOT / "packaging" / "fnos"

SS = 4  # 超采样倍数，用于抗锯齿


def _mix(c1, c2, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(c1, c2))


def _in_round_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def _in_polygon(x, y, pts):
    inside = False
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xin = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < xin:
                inside = not inside
    return inside


def render(size):
    """返回 RGBA 像素行列表（size x size，每像素 4 字节）。"""
    n = size * SS
    bg_from, bg_to = (79, 70, 229), (139, 92, 246)  # indigo -> violet
    white = (255, 255, 255)

    # 版面比例（按 100% 计）
    pad = 0.055
    card = (0.20, 0.22, 0.80, 0.78)
    sun_c = (0.365, 0.375)
    sun_r = 0.062
    # 山峦折线，卡内坐标 0..1
    ridge = [(0.245, 0.685), (0.415, 0.505), (0.545, 0.60),
             (0.655, 0.515), (0.775, 0.685)]

    # 超采样缓冲：按 n x n 累加覆盖率
    acc_bg = [[0.0] * n for _ in range(n)]
    acc_card = [[0.0] * n for _ in range(n)]
    acc_fg = [[0.0] * n for _ in range(n)]

    for py in range(n):
        y = (py + 0.5) / n
        for px in range(n):
            x = (px + 0.5) / n
            if _in_round_rect(x, y, pad, pad, 1 - pad, 1 - pad, 0.22):
                acc_bg[py][px] = 1.0
            if _in_round_rect(x, y, card[0], card[1], card[2], card[3], 0.085):
                acc_card[py][px] = 1.0
            dx, dy = x - sun_c[0], y - sun_c[1]
            if dx * dx + dy * dy <= sun_r * sun_r:
                acc_fg[py][px] = 1.0
            elif _in_polygon(x, y, ridge):
                acc_fg[py][px] = 1.0

    rows = []
    for oy in range(size):
        row = bytearray()
        for ox in range(size):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    py, px = oy * SS + sy, ox * SS + sx
                    cov_bg, cov_card, cov_fg = acc_bg[py][px], acc_card[py][px], acc_fg[py][px]
                    if cov_bg <= 0:
                        continue
                    # 底板渐变：左上 -> 右下
                    t = (px / n + py / n) / 2
                    base = _mix(bg_from, bg_to, t)
                    col = base
                    if cov_card > 0:
                        col = _mix(col, white, cov_card)
                        if cov_fg > 0:
                            col = _mix(col, base, cov_fg)
                    r += col[0]
                    g += col[1]
                    b += col[2]
                    a += 255.0
            total = SS * SS
            row += bytes((round(r / total), round(g / total), round(b / total), round(a / total)))
        rows.append(row)
    return rows


def write_png(path, size):
    rows = render(size)
    raw = b"".join(b"\x00" + bytes(r) for r in rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    print(f"{path.relative_to(ROOT)}  {size}x{size}  {len(png)} bytes")


def main():
    for size, name in ((64, "ICON.PNG"), (256, "ICON_256.PNG")):
        write_png(FNOS / name, size)
    for size, name in ((64, "icon_64.png"), (256, "icon_256.png")):
        write_png(FNOS / "app" / "ui" / "images" / name, size)


if __name__ == "__main__":
    main()
