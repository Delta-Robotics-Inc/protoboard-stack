"""Manufacturability report for a frame-cad DXF (CNC-routed plates).

    .protoboard/tools/cad/bin/python dxf_report.py <name>.dxf [--bit 3.0] [--json]   (or $PROTOBOARD_PYTHON)

Per layer: extent, holes by diameter, the smallest hole-to-edge distance
(edge = outline or any cut-out), the smallest web between two holes, and
holes or slots a router bit of the given diameter cannot cut. Uses ezdxf,
which build123d already depends on. Exit 1 when a rule is violated:
  - hole edge distance < hole diameter (breakout risk in carbon)
  - web between holes < 1 mm
  - a hole smaller than the bit (drill it, and say so) is reported, not failed
  - a straight cut-out narrower than the bit
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict

import ezdxf


def seg_points(e, step=1.0):
    t = e.dxftype()
    if t == "LINE":
        return [(e.dxf.start.x, e.dxf.start.y), (e.dxf.end.x, e.dxf.end.y)]
    if t == "ARC":
        a0, a1 = e.dxf.start_angle, e.dxf.end_angle
        if a1 < a0:
            a1 += 360
        n = max(2, int(math.radians(a1 - a0) * e.dxf.radius / step) + 1)
        c, r = e.dxf.center, e.dxf.radius
        return [(c.x + r * math.cos(math.radians(a0 + (a1 - a0) * k / (n - 1))), c.y + r * math.sin(math.radians(a0 + (a1 - a0) * k / (n - 1)))) for k in range(n)]
    try:
        return [(p.x, p.y) for p in e.flattening(0.05)]
    except Exception:  # noqa: BLE001
        return []


def point_seg(p, a, b):
    ax, ay, bx, by = *a, *b
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L))
    return math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))


def main() -> None:
    args = sys.argv[1:]
    path = args[0]
    bit = float(args[args.index("--bit") + 1]) if "--bit" in args else 3.0
    doc = ezdxf.readfile(path)
    layers: dict[str, dict] = defaultdict(lambda: {"holes": [], "polys": []})
    for e in doc.modelspace():
        L = layers[e.dxf.layer]
        if e.dxftype() == "CIRCLE":
            L["holes"].append(((e.dxf.center.x, e.dxf.center.y), e.dxf.radius))
        else:
            pts = seg_points(e)
            if len(pts) >= 2:
                L["polys"].append(pts)
    report, violations = {}, []
    for name, L in sorted(layers.items()):
        segs = [(a, b) for pts in L["polys"] for a, b in zip(pts, pts[1:])]
        xs = [p[0] for pts in L["polys"] for p in pts] + [c[0] for c, _ in L["holes"]]
        ys = [p[1] for pts in L["polys"] for p in pts] + [c[1] for c, _ in L["holes"]]
        by_d = defaultdict(int)
        for _, r in L["holes"]:
            by_d[round(2 * r, 3)] += 1
        edge = []
        for c, r in L["holes"]:
            d = min((point_seg(c, a, b) for a, b in segs), default=math.inf) - r
            edge.append((d, c, r))
            if d < 2 * r:
                violations.append(f"{name}: hole Ø{2 * r:.2f} at ({c[0]:.2f}, {c[1]:.2f}) is {d:.2f} mm from an edge (< its diameter)")
            drill = f"{name}: Ø{2 * r:.2f} holes are smaller than the {bit} mm bit: drill them (note it on the drawing)"
            if 2 * r < bit and drill not in violations:
                violations.append(drill)
        web = []
        hs = L["holes"]
        for i in range(len(hs)):
            for j in range(i + 1, len(hs)):
                w = math.hypot(hs[i][0][0] - hs[j][0][0], hs[i][0][1] - hs[j][0][1]) - hs[i][1] - hs[j][1]
                web.append(w)
                if w < 1.0:
                    violations.append(f"{name}: {w:.2f} mm web between holes at ({hs[i][0][0]:.1f}, {hs[i][0][1]:.1f}) and ({hs[j][0][0]:.1f}, {hs[j][0][1]:.1f})")
        # narrow straight cut-outs: two parallel, overlapping edges closer than the bit
        narrow = []
        lines = [(a, b) for a, b in segs if math.hypot(b[0] - a[0], b[1] - a[1]) > 0]
        for (a, b) in lines:
            for (c, d) in lines:
                if (a, b) >= (c, d):
                    continue
                v1 = (b[0] - a[0], b[1] - a[1])
                v2 = (d[0] - c[0], d[1] - c[1])
                cross = v1[0] * v2[1] - v1[1] * v2[0]
                if abs(cross) > 1e-6 * math.hypot(*v1) * math.hypot(*v2):
                    continue  # not parallel
                gap = point_seg(c, a, b)
                if 0 < gap < bit and min(math.hypot(*v1), math.hypot(*v2)) > 2 * bit and point_seg(d, a, b) - gap < 1e-6:
                    narrow.append(round(gap, 3))
        for g in sorted(set(narrow)):
            violations.append(f"{name}: a straight cut-out {g} mm wide is narrower than the {bit} mm bit")
        report[name] = {
            "extent_mm": [round(min(xs), 3), round(max(xs), 3), round(min(ys), 3), round(max(ys), 3)] if xs else None,
            "holes_by_diameter": dict(sorted(by_d.items())),
            "min_edge_distance_mm": round(min(edge)[0], 3) if edge else None,
            "min_web_mm": round(min(web), 3) if web else None,
        }
    out = {"file": path, "bit_mm": bit, "layers": report, "violations": violations}
    if "--json" in args:
        print(json.dumps(out, indent=2))
    else:
        for name, r in report.items():
            print(f"{name}: extent {r['extent_mm']}, holes {r['holes_by_diameter']}, min edge distance {r['min_edge_distance_mm']} mm, min web {r['min_web_mm']} mm")
        for v in violations:
            print(f"  ! {v}")
    hard = [v for v in violations if "drill them" not in v]
    sys.exit(1 if hard else 0)


if __name__ == "__main__":
    main()
