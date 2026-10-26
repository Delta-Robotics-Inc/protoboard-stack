"""Obstacle map and route search for wire harnesses.

The assembled model is voxelised (1 mm) from its GLB bodies, each body
filled solid. A clearance field (distance to the nearest solid) drives an
A* search for the bundle's centreline between the two ends' exit points:
a cell is allowed when the bundle fits (clearance >= bundle radius +
margin), and cheaper when the bundle rests on something below it (a cable
lies on the frame; it does not float) or at least touches a surface.

The voxel path is then shortened (line of sight in the clearance field),
its corners filleted to the target bend radius where there is room, and
lengthened to the modelled cable length with a smooth bow where the
clearance allows (the slack of a cable that is longer than its route).
"""
from __future__ import annotations

import heapq
import math
import os
import sys

DEBUG = bool(os.environ.get("HARNESS_CAD_DEBUG"))

import numpy as np
from scipy import ndimage


class ObstacleMap:
    def __init__(self, lo, hi, res: float = 1.0):
        self.res = res
        self.lo = np.asarray(lo, dtype=float)
        self.shape = tuple(int(math.ceil((h - l) / res)) + 1 for l, h in zip(lo, hi))
        self.occ = np.zeros(self.shape, dtype=bool)
        self.owner = np.full(self.shape, -1, dtype=np.int16)
        self.names: list[str] = []
        self.dist: np.ndarray | None = None

    # ---- building --------------------------------------------------------------------------
    def index(self, p) -> tuple[int, int, int]:
        i = np.round((np.asarray(p, dtype=float) - self.lo) / self.res).astype(int)
        return tuple(np.clip(i, 0, np.array(self.shape) - 1))

    def centre(self, idx) -> np.ndarray:
        return self.lo + np.asarray(idx, dtype=float) * self.res

    def add_solid(self, vertices: np.ndarray, faces: np.ndarray, name: str = "") -> None:
        """Surface-sample the triangles into a local box, fill it solid, OR it in."""
        if not len(faces):
            return
        vmin = vertices.min(axis=0) - 2 * self.res
        vmax = vertices.max(axis=0) + 2 * self.res
        i0 = np.maximum(np.floor((vmin - self.lo) / self.res).astype(int), 0)
        i1 = np.minimum(np.ceil((vmax - self.lo) / self.res).astype(int) + 1, np.array(self.shape))
        if np.any(i1 <= i0):
            return
        local = np.zeros(tuple(i1 - i0), dtype=bool)
        tri = vertices[faces]
        edge = np.max(np.linalg.norm(tri - np.roll(tri, 1, axis=1), axis=2), axis=1)
        steps = np.maximum(1, np.ceil(edge / (0.45 * self.res)).astype(int))
        for n in np.unique(steps):
            sel = tri[steps == n]
            a, b = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
            m = (a + b) <= n
            u = (a[m] / n)[:, None]
            v = (b[m] / n)[:, None]
            w = 1 - u - v
            pts = (sel[:, None, 0, :] * w[None] + sel[:, None, 1, :] * u[None] + sel[:, None, 2, :] * v[None]).reshape(-1, 3)
            idx = np.round((pts - self.lo) / self.res).astype(int) - i0
            ok = np.all((idx >= 0) & (idx < local.shape), axis=1)
            idx = idx[ok]
            local[idx[:, 0], idx[:, 1], idx[:, 2]] = True
        local = ndimage.binary_fill_holes(local)
        sl = tuple(slice(a, b) for a, b in zip(i0, i1))
        self.occ[sl] |= local
        if name not in self.names:
            self.names.append(name)
        self.owner[sl][local] = self.names.index(name)

    def owner_at(self, p) -> str:
        """The body occupying (or nearest below) a point, for reports."""
        i = self.index(p)
        k = int(self.owner[i])
        if k < 0:
            sl = tuple(slice(max(0, a - 2), a + 3) for a in i)
            vals = self.owner[sl][self.owner[sl] >= 0]
            k = int(vals[0]) if len(vals) else -1
        return self.names[k] if k >= 0 else "?"

    def stamp_tube(self, points: np.ndarray, radius: float, name: str = "") -> None:
        """Mark a routed conductor as solid (so later routes keep off it)."""
        r = int(math.ceil(radius / self.res))
        offs = np.array([(x, y, z) for x in range(-r, r + 1) for y in range(-r, r + 1) for z in range(-r, r + 1) if (x * x + y * y + z * z) * self.res**2 <= radius**2 + 1e-9])
        idx = np.round((points - self.lo) / self.res).astype(int)
        allidx = (idx[:, None, :] + offs[None]).reshape(-1, 3)
        ok = np.all((allidx >= 0) & (allidx < np.array(self.shape)), axis=1)
        allidx = allidx[ok]
        self.occ[allidx[:, 0], allidx[:, 1], allidx[:, 2]] = True
        if name not in self.names:
            self.names.append(name)
        self.owner[allidx[:, 0], allidx[:, 1], allidx[:, 2]] = self.names.index(name)
        self.dist = None

    def finalize(self) -> None:
        self.dist = ndimage.distance_transform_edt(~self.occ) * self.res
        # "supported": solid within a few mm straight below
        k = 4
        sup = np.zeros_like(self.occ)
        for d in range(1, k + 1):
            sup[:, :, d:] |= self.occ[:, :, :-d]
        self.support = sup

    # ---- queries ---------------------------------------------------------------------------
    def clearance(self, pts: np.ndarray) -> np.ndarray:
        """Trilinear clearance at points (mm)."""
        assert self.dist is not None
        f = (np.asarray(pts, dtype=float) - self.lo) / self.res
        return ndimage.map_coordinates(self.dist, f.T, order=1, mode="nearest")

    def gradient(self, p) -> np.ndarray:
        e = self.res
        g = np.array([(self.clearance([p + d])[0] - self.clearance([p - d])[0]) / (2 * e) for d in np.eye(3) * e])
        n = np.linalg.norm(g)
        return g / n if n > 1e-9 else np.zeros(3)


_N26 = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if (dx, dy, dz) != (0, 0, 0)]


def astar(om: ObstacleMap, start, goal, radius: float, free_zones: list[tuple[np.ndarray, float]], max_expand: int = 4_000_000):
    """Cheapest 26-connected voxel path from start to goal for a bundle of `radius`.

    Cells need clearance >= radius, except inside `free_zones` (spheres around
    the terminations, where the cable meets its part by design). Cost per mm:
    1.0 resting on something below, 1.5 touching a surface, 2.6 in free air.
    """
    assert om.dist is not None
    s = om.index(start)
    g = om.index(goal)
    shape = np.array(om.shape)
    dist = om.dist
    sup = om.support
    zones = [(om.index(c), r / om.res) for c, r in free_zones]

    def allowed(c):
        if dist[c] >= radius:
            return True
        return any((c[0] - z[0]) ** 2 + (c[1] - z[1]) ** 2 + (c[2] - z[2]) ** 2 <= rr * rr for z, rr in zones)

    def weight(c):
        d = dist[c]
        if sup[c] and d <= radius + 2.5:
            return 1.0
        if d <= radius + 2.0:
            return 1.5
        return 2.6

    steps = [(d, math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2) * om.res) for d in _N26]
    h = lambda c: math.dist(c, g) * om.res
    openq = [(h(s), 0.0, s)]
    best = {s: 0.0}
    parent = {s: None}
    n = 0
    while openq:
        _, cost, c = heapq.heappop(openq)
        if c == g:
            path = []
            while c is not None:
                path.append(c)
                c = parent[c]
            return [om.centre(p) for p in reversed(path)]
        if cost > best.get(c, math.inf) + 1e-9:
            continue
        n += 1
        if n > max_expand:
            break
        for d, l in steps:
            nb = (c[0] + d[0], c[1] + d[1], c[2] + d[2])
            if nb[0] < 0 or nb[1] < 0 or nb[2] < 0 or nb[0] >= shape[0] or nb[1] >= shape[1] or nb[2] >= shape[2]:
                continue
            if not allowed(nb):
                continue
            nc = cost + l * weight(nb)
            if nc < best.get(nb, math.inf):
                best[nb] = nc
                parent[nb] = c
                heapq.heappush(openq, (nc + h(nb), nc, nb))
    return None


# ---------------------------------------------------------------------------------------------
# Path shaping
# ---------------------------------------------------------------------------------------------


def seg_ok(om: ObstacleMap, a, b, radius: float, zones) -> bool:
    n = max(2, int(np.linalg.norm(b - a) / 0.5) + 1)
    pts = a + (b - a) * np.linspace(0, 1, n)[:, None]
    c = om.clearance(pts)
    bad = c < radius
    if not bad.any():
        return True
    for p in pts[bad]:
        if not any(np.linalg.norm(p - zc) <= zr for zc, zr in zones):
            return False
    return True


def pull_string(om: ObstacleMap, pts: list[np.ndarray], radius: float, zones) -> list[np.ndarray]:
    out = [pts[0]]
    i = 0
    while i < len(pts) - 1:
        j = len(pts) - 1
        while j > i + 1 and not seg_ok(om, pts[i], pts[j], radius, zones):
            j -= 1
        out.append(pts[j])
        i = j
    return out


def fillet(poly: list[np.ndarray], radius: float, fixed_ends: int = 1, step: float = 0.5) -> tuple[np.ndarray, list[float]]:
    """Round every interior corner with a circular arc of up to `radius` (limited by the adjacent segments)."""
    pts = [np.asarray(p, dtype=float) for p in poly]
    out = [pts[0]]
    radii = []
    for k in range(1, len(pts) - 1):
        a, v, b = out[-1], pts[k], pts[k + 1]
        u = a - v
        w = b - v
        lu, lw = np.linalg.norm(u), np.linalg.norm(w)
        if lu < 1e-6 or lw < 1e-6:
            continue
        u /= lu
        w /= lw
        cosang = float(np.clip(np.dot(u, w), -1, 1))
        theta = math.acos(cosang)  # interior angle
        if theta > math.pi - 1e-3:
            out.append(v)
            continue
        if theta < 0.05:  # the path doubles back on itself: drop the spike
            continue
        t_max = min(lu * (1.0 if k == 1 else 0.5), lw * (1.0 if k == len(pts) - 2 else 0.5))
        t = radius / math.tan(theta / 2)
        if t > t_max:
            t = t_max
        r = t * math.tan(theta / 2)
        radii.append(r)
        p1 = v + u * t
        p2 = v + w * t
        bis = u + w
        bis /= np.linalg.norm(bis)
        centre = v + bis * (r / math.sin(theta / 2))
        a1 = p1 - centre
        a2 = p2 - centre
        ang = math.acos(float(np.clip(np.dot(a1, a2) / (np.linalg.norm(a1) * np.linalg.norm(a2)), -1, 1)))
        n = max(2, int(r * ang / step) + 1)
        for s in np.linspace(0, 1, n):
            # slerp between a1 and a2
            if ang < 1e-6:
                q = a1
            else:
                q = (math.sin((1 - s) * ang) * a1 + math.sin(s * ang) * a2) / math.sin(ang)
            out.append(centre + q)
    out.append(pts[-1])
    return resample(np.array(out), step), radii


def resample(pts: np.ndarray, step: float = 0.5) -> np.ndarray:
    d = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    keep = np.concatenate([[True], d > 1e-9])
    pts = pts[keep]
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    if s[-1] < 1e-9:
        return pts
    n = max(2, int(s[-1] / step) + 1)
    t = np.linspace(0, s[-1], n)
    return np.stack([np.interp(t, s, pts[:, k]) for k in range(3)], axis=1)


def length(pts: np.ndarray) -> float:
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())


def arclen(pts: np.ndarray) -> np.ndarray:
    return np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])


def min_radius(pts: np.ndarray, spacing: float = 2.0, skip: float = 1.0) -> float:
    """Smallest three-point circle radius along a polyline (points `spacing` apart)."""
    p = resample(pts, spacing)
    s = arclen(p)
    best = math.inf
    for k in range(1, len(p) - 1):
        if s[k] < skip or s[-1] - s[k] < skip:
            continue
        a, b, c = p[k - 1], p[k], p[k + 1]
        ab, bc, ca = np.linalg.norm(b - a), np.linalg.norm(c - b), np.linalg.norm(a - c)
        area2 = np.linalg.norm(np.cross(b - a, c - a))
        if area2 < 1e-9:
            continue
        best = min(best, ab * bc * ca / (2 * area2))
    return best


def smooth(pts: np.ndarray, om: ObstacleMap, radius: float, fixed: int, iters: int = 30, zones=()) -> np.ndarray:
    """Laplacian smoothing that never moves a point into a collision; `fixed` points at each end stay."""
    p = pts.copy()
    for _ in range(iters):
        q = p.copy()
        q[fixed:-fixed] = 0.5 * p[fixed:-fixed] + 0.25 * (p[fixed - 1 : -fixed - 1] + p[fixed + 1 : len(p) - fixed + 1])
        c = om.clearance(q[fixed:-fixed])
        ok = c >= radius
        if zones:
            for i, pt in enumerate(q[fixed:-fixed]):
                if not ok[i] and any(np.linalg.norm(pt - zc) <= zr for zc, zr in zones):
                    ok[i] = True
        p[fixed:-fixed][ok] = q[fixed:-fixed][ok]
    return p


def bow(pts: np.ndarray, s0: float, s1: float, direction: np.ndarray, amp: float) -> np.ndarray:
    """Displace the section [s0, s1] (arc length) by amp * sin^2 along `direction` (made normal to the local tangent)."""
    s = arclen(pts)
    out = pts.copy()
    t = np.gradient(pts, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-12)
    for k in range(len(pts)):
        if s0 < s[k] < s1:
            w = math.sin(math.pi * (s[k] - s0) / (s1 - s0)) ** 2
            d = direction - t[k] * np.dot(direction, t[k])
            nd = np.linalg.norm(d)
            if nd > 1e-9:
                out[k] = pts[k] + d / nd * amp * w
    return out


def bezier_loop(pts: np.ndarray, s0: float, s1: float, direction: np.ndarray, amp: float, spread: float = 0.6) -> np.ndarray:
    """Replace [s0, s1] with a cubic Bezier that leaves and rejoins tangentially and bulges `amp` along `direction`."""
    s = arclen(pts)
    i0 = int(np.searchsorted(s, s0))
    i1 = int(np.searchsorted(s, s1))
    i0 = max(1, min(i0, len(pts) - 3))
    i1 = max(i0 + 2, min(i1, len(pts) - 2))
    p0, p1 = pts[i0], pts[i1]
    t0 = pts[i0] - pts[i0 - 1]
    t1 = pts[i1 + 1] - pts[i1]
    t0 /= max(np.linalg.norm(t0), 1e-9)
    t1 /= max(np.linalg.norm(t1), 1e-9)
    d = direction - t0 * np.dot(direction, t0)
    d /= max(np.linalg.norm(d), 1e-9)
    c0 = p0 + t0 * amp * spread + d * amp
    c1 = p1 - t1 * amp * spread + d * amp
    u = np.linspace(0, 1, max(8, int((np.linalg.norm(p1 - p0) + 3 * amp) / 0.5)))[:, None]
    curve = (1 - u) ** 3 * p0 + 3 * (1 - u) ** 2 * u * c0 + 3 * (1 - u) * u**2 * c1 + u**3 * p1
    return np.vstack([pts[:i0], curve, pts[i1 + 1 :]])


def apex_loop(poly: list[np.ndarray], om: ObstacleMap, radius: float, zones, target: float, bend_target: float, bend_min: float, fixed: int, skip: float = 4.0):
    """Lay slack as a service loop: one apex point pulled out from the route, joined by straight legs, corners filleted.

    Tries an apex after every interior vertex (and at segment midpoints), in
    fourteen directions (twelve around the local route direction, up, down);
    sizes each by bisection to the target length after filleting; keeps the
    candidates whose legs are clear and whose bends keep the minimum radius;
    returns the one that stays lowest and closest to surfaces (a loop that
    lies on something, drooping rather than standing up), or None.
    """
    pts = [np.asarray(p, dtype=float) for p in poly]
    inserts = []
    for i in range(1, len(pts) - 2):
        inserts.append((i, pts[i]))
        inserts.append((i, 0.5 * (pts[i] + pts[i + 1])))
    if not inserts:
        return None
    best = None
    for i, base in inserts:
        t = pts[i + 1] - pts[i]
        t /= max(np.linalg.norm(t), 1e-9)
        e1 = np.cross(t, [0, 0, 1.0])
        if np.linalg.norm(e1) < 1e-6:
            e1 = np.cross(t, [1.0, 0, 0])
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(t, e1)
        dirs = [math.cos(a) * e1 + math.sin(a) * e2 for a in np.linspace(0, 2 * math.pi, 12, endpoint=False)] + [np.array([0, 0, 1.0]), np.array([0, 0, -1.0])]
        for d in dirs:
            for kind in ("U", "V"):
                sep = 2.2 * bend_target

                def build(dist, kind=kind, d=d, base=base, i=i, t=t):
                    if kind == "V":
                        apices = [base + d * dist]
                    else:
                        apices = [base + d * dist - t * sep / 2, base + d * dist + t * sep / 2]
                    q = pts[: i + 1] + ([base] if base is not pts[i] else []) + apices + pts[i + 1 :]
                    c, _ = fillet(q, bend_target)
                    return c, apices

                lo, hi = 0.0, 3.0
                while length(build(hi)[0]) < target and hi < 120:
                    hi *= 1.5
                if length(build(hi)[0]) < target:
                    continue
                for _ in range(30):
                    m = 0.5 * (lo + hi)
                    if length(build(m)[0]) < target:
                        lo = m
                    else:
                        hi = m
                cand, apices = build(hi)
                chain = [base] + apices + [pts[i + 1]]
                if not all(seg_ok(om, a, b, radius, zones) for a, b in zip(chain[:-1], chain[1:])):
                    continue
                cand = smooth(cand, om, radius, fixed=fixed, iters=20, zones=zones)
                clear = om.clearance(cand) - radius
                inside = np.array([any(np.linalg.norm(p - zc) <= zr for zc, zr in zones) for p in cand])
                worst = float(clear[~inside].min()) if (~inside).any() else 0.0
                bend = min_radius(cand, 1.5, skip=skip)
                if DEBUG:
                    print(f"apex {kind} i={i} d={np.round(d, 2)} leg={hi:.1f} worst={worst:.2f} bend={bend:.2f}", file=sys.stderr)
                if worst < 0 or bend < bend_min:
                    continue
                touching = float(np.mean(clear[~inside] < 2.5)) if (~inside).any() else 0.0
                rise = max(0.0, max(a[2] for a in apices) - base[2])
                score = touching - 0.02 * rise + 0.3 * min(bend / bend_target, 1.0) - 0.004 * hi
                if best is None or score > best[0]:
                    best = (score, cand, {"method": "service loop", "shape": kind, "apex_mm": [[round(x, 1) for x in a] for a in apices], "leg_mm": round(hi, 1), "bend_mm": round(bend, 2)})
    return (best[1], best[2]) if best else None


def fit_length(pts: np.ndarray, target: float, om: ObstacleMap, radius: float, keep: float, zones, bend_min: float = 0.0, bend_target: float = 0.0) -> tuple[np.ndarray, dict]:
    """Lengthen the centreline to `target` by laying the slack in clear space.

    Candidates: a sin^2 bow or a tangent Bezier loop over windows of the free
    middle of the route, bulging in twelve directions around the route and
    away from the nearest surface. Each is sized (bisection) to the exact
    length, then scored: it must stay clear and keep the minimum bend radius;
    among those, the one that stays closest to surfaces (lying on the frame,
    not standing in the air) and bends least wins. If none qualifies, the
    least bad one is returned and reported.
    """
    base = length(pts)
    info = {"slack_mm": round(target - base, 2), "method": "none"}
    if target <= base + 0.3:
        return pts, info
    s = arclen(pts)
    total = s[-1]
    lo_s, hi_s = keep, total - keep
    if hi_s - lo_s < 4:
        lo_s, hi_s = 0.15 * total, 0.85 * total
    windows = []
    for frac in (1.0, 0.8, 0.6, 0.4):
        w = (hi_s - lo_s) * frac
        for centre in (np.linspace(lo_s + w / 2, hi_s - w / 2, 3) if frac < 1 else [(lo_s + hi_s) / 2]):
            windows.append((centre - w / 2, centre + w / 2))
    best_ok, best_bad = None, None
    for s0, s1 in windows:
        a_i, b_i = int(np.searchsorted(s, s0).clip(0, len(pts) - 1)), int(np.searchsorted(s, s1).clip(0, len(pts) - 1))
        chord = pts[b_i] - pts[a_i]
        chord /= max(np.linalg.norm(chord), 1e-9)
        e1 = np.cross(chord, [0, 0, 1.0])
        if np.linalg.norm(e1) < 1e-6:
            e1 = np.cross(chord, [1.0, 0, 0])
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(chord, e1)
        mid = pts[(a_i + b_i) // 2]
        dirs = [math.cos(a) * e1 + math.sin(a) * e2 for a in np.linspace(0, 2 * math.pi, 12, endpoint=False)] + [om.gradient(mid)]
        for d in dirs:
            if np.linalg.norm(d) < 1e-6:
                continue
            for shape in ("bow", "loop"):
                f = (lambda a: bow(pts, s0, s1, d, a)) if shape == "bow" else (lambda a: bezier_loop(pts, s0, s1, d, a))
                lo, hi = 0.0, 4.0
                while length(f(hi)) < target and hi < 400:
                    hi *= 1.6
                if length(f(hi)) < target:
                    continue
                for _ in range(36):
                    m = 0.5 * (lo + hi)
                    if length(f(m)) < target:
                        lo = m
                    else:
                        hi = m
                cand = resample(f(hi), 0.5)
                cs = arclen(cand)
                k2 = min(keep, 0.25 * cs[-1])
                inner = cand[(cs > k2) & (cs < cs[-1] - k2)]
                if not len(inner):
                    continue
                clear = om.clearance(inner) - radius
                worst = float(clear.min())
                bend = min_radius(cand, 1.5, skip=keep)
                touching = float(np.mean(clear < 2.5))
                ok = worst >= 0 and bend >= bend_min
                score = touching + min(bend / max(bend_target, 1e-6), 1.0) - 0.002 * hi
                rec = (score, cand, shape, hi, s0, s1, worst, bend)
                if ok and (best_ok is None or score > best_ok[0]):
                    best_ok = rec
                if not ok:
                    badness = min(worst, 0) + min(bend - bend_min, 0) * 0.5
                    if best_bad is None or badness > best_bad[0]:
                        best_bad = (badness, cand, shape, hi, s0, s1, worst, bend)
    pick = best_ok or best_bad
    if pick is None:
        info.update(method="failed")
        return pts, info
    _, cand, shape, amp, s0, s1, worst, bend = pick
    info.update(method=shape if best_ok else f"{shape} (not clear)", amplitude_mm=round(amp, 2), window_mm=[round(s0, 1), round(s1, 1)], worst_clearance_mm=round(worst, 2), bend_mm=round(bend, 2))
    return cand, info


def rmf(pts: np.ndarray, n0: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Rotation-minimising frames (double reflection): tangents, normals, binormals."""
    t = np.gradient(pts, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-12)
    r = np.zeros_like(pts)
    first = n0 - t[0] * np.dot(n0, t[0])
    if np.linalg.norm(first) < 1e-6:
        first = np.cross(t[0], [0, 0, 1.0])
        if np.linalg.norm(first) < 1e-6:
            first = np.cross(t[0], [1.0, 0, 0])
    r[0] = first / np.linalg.norm(first)
    for i in range(len(pts) - 1):
        v1 = pts[i + 1] - pts[i]
        c1 = np.dot(v1, v1)
        if c1 < 1e-12:
            r[i + 1] = r[i]
            continue
        rl = r[i] - (2 / c1) * np.dot(v1, r[i]) * v1
        tl = t[i] - (2 / c1) * np.dot(v1, t[i]) * v1
        v2 = t[i + 1] - tl
        c2 = np.dot(v2, v2)
        r[i + 1] = rl - (2 / c2) * np.dot(v2, rl) * v2 if c2 > 1e-12 else rl
        r[i + 1] /= np.linalg.norm(r[i + 1])
    b = np.cross(t, r)
    return t, r, b
