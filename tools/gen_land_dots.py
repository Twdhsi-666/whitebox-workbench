# -*- coding: utf-8 -*-
"""
白膜工作台 · 地球陆地点阵生成器
把 world-atlas 的 countries-110m TopoJSON 栅格成等距圆柱投影掩膜，
再用 Fibonacci 球面采样出陆地点阵，输出 assets/land-dots.js。

用法:
    python tools/gen_land_dots.py [countries-110m.json] [输出.js]

依赖: Pillow (pip install pillow)
"""
import base64
import io
import json
import math
import struct
import sys

MASK_W, MASK_H = 1440, 720      # 掩膜分辨率（等距圆柱投影）
FIB_N = 36000                   # Fibonacci 采样数（陆地约占 29%，得约 1 万个点）


def decode_topojson(topo):
    """TopoJSON -> list of polygons, 每个 polygon 是 [ [ (lng,lat), ... ], ... ] (ring 列表)"""
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)

    def ring(arc_idxs):
        pts = []
        for i in arc_idxs:
            if i < 0:
                pts.extend(reversed(arcs[~i]))
            else:
                pts.extend(arcs[i])
        return pts

    polys = []
    for geom in topo["objects"]["countries"]["geometries"]:
        gtype = geom["type"]
        if gtype == "Polygon":
            geom_polys = [geom["arcs"]]
        elif gtype == "MultiPolygon":
            geom_polys = geom["arcs"]
        else:
            continue
        for poly in geom_polys:
            polys.append([ring(r) for r in poly])
    return polys


def rasterize(polys):
    from PIL import Image, ImageDraw
    img = Image.new("L", (MASK_W, MASK_H), 0)
    draw = ImageDraw.Draw(img)
    for poly in polys:
        for ring_pts in poly:
            xy = [((lng + 180.0) / 360.0 * MASK_W, (90.0 - lat) / 180.0 * MASK_H)
                  for lng, lat in ring_pts]
            if len(xy) >= 3:
                draw.polygon(xy, fill=255)
    return img


def is_land(mask, lng, lat):
    x = int((lng + 180.0) / 360.0 * MASK_W)
    y = int((90.0 - lat) / 180.0 * MASK_H)
    x = min(max(x, 0), MASK_W - 1)
    y = min(max(y, 0), MASK_H - 1)
    return mask.getpixel((x, y)) > 127


def sample_land_dots(mask):
    dots = []
    golden = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(FIB_N):
        y = 1.0 - (i / (FIB_N - 1.0)) * 2.0          # y ∈ [1, -1]
        r = math.sqrt(max(0.0, 1.0 - y * y))
        theta = golden * i
        lat = math.degrees(math.asin(y))
        lng = (math.degrees(theta) + 180.0) % 360.0 - 180.0
        if is_land(mask, lng, lat):
            dots.append((lat, lng))
    return dots


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "countries-110m.json"
    out = sys.argv[2] if len(sys.argv) > 2 else "../assets/land-dots.js"
    with open(src, "r", encoding="utf-8") as f:
        topo = json.load(f)
    polys = decode_topojson(topo)
    mask = rasterize(polys)
    dots = sample_land_dots(mask)
    print(f"polygons={len(polys)} land_dots={len(dots)}")

    # Int16 量化: lat*100 ∈ [-9000, 9000], lng*100 ∈ [-18000, 18000]
    buf = bytearray()
    for lat, lng in dots:
        buf += struct.pack("<hh", int(round(lat * 100)), int(round(lng * 100)))
    b64 = base64.b64encode(bytes(buf)).decode("ascii")

    js = (
        "// 自动生成 · 请勿手改 (tools/gen_land_dots.py)\n"
        "// 陆地点阵: Int16 量化 [lat*100, lng*100], 共 %d 点\n"
        "window.LAND_DOTS_B64 = \"%s\";\n"
    ) % (len(dots), b64)
    with open(out, "w", encoding="utf-8") as f:
        f.write(js)
    print(f"written {out} ({len(js)} bytes, raw {len(buf)} bytes)")


if __name__ == "__main__":
    main()
