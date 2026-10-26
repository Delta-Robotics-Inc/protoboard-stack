"""Fit analysis: what goes inside an enclosure against the enclosure's walls.

Built on ext-harness-cad's obstacle map (py/route.py) and GLB reader
(py/glb.py), imported from that package rather than copied: the printed
parts are voxelised and filled solid, and the Euclidean distance transform
of free space gives the clearance field the harness router uses. Two more
fields come from the same occupancy grid:

  depth     distance from a solid cell to free space, so a point inside a
            wall has a negative signed clearance (a collision) and its depth;
  thickness the local wall thickness, twice the depth at the solid's medial
            surface (local maxima of `depth`), minus one cell.

Every inside body (board, battery, display, ...) is sampled on its surface
and looked up in two ways:

  exact     against the primitives the generator built the inside from: the
            cavity (a box or a cylinder) and the solids standing in it (insert
            bosses, lid screw columns, gland bosses: finite cylinders). Good to
            the sampling step (half a cell) on curved edges, exact on faces;
  voxel     in the signed field of the parts as built, which also sees
            anything the primitives do not describe (a hand-edited script).
            Good to about one cell (`resolution_mm`), so it reports a
            collision only past one cell of penetration and a tight fit only
            one cell under the clearance.

Contact the design intends (a board on its bosses) is excluded by zones the
job gives per body. Containment in the cavity primitive is exact (mesh
vertices against the box or cylinder), so a body that is bigger than its
cavity is caught whatever the voxel size.

Button plungers are inside bodies too, but they pass through the wall by
design: they are checked against the other contents in a voxel field of the
contents (analyse_plungers), and against the walls exactly by the generator.
"""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage


def harness_py() -> Path:
    """ext-harness-cad's py/ folder: PROTOBOARD_HARNESS_CAD_PY, else the sibling package in this repository."""
    env = os.environ.get("PROTOBOARD_HARNESS_CAD_PY")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "ext-harness-cad" / "py"


sys.path.insert(0, str(harness_py()))
from glb import read_glb, to_cad_mm  # noqa: E402  (ext-harness-cad)
from route import ObstacleMap  # noqa: E402  (ext-harness-cad)

MAX_CELLS = 6_000_000


def load_mesh(path: str | Path, matrix=None, node: str | None = None, skip=None) -> tuple[np.ndarray, np.ndarray]:
    """Every triangle of a GLB (or of its nodes named `node`, or all but those in `skip`) in CAD millimetres (Z up), transformed by a row-major 4x4 when given."""
    vs, fs, n = [], [], 0
    skip = set(skip or [])
    for name, v, f in read_glb(path):
        if node is not None and name != node:
            continue
        if name in skip:
            continue
        w = to_cad_mm(v)
        if matrix is not None:
            m = np.asarray(matrix, dtype=float).reshape(4, 4)
            w = w @ m[:3, :3].T + m[:3, 3]
        vs.append(w)
        fs.append(f + n)
        n += len(w)
    if not vs:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
    return np.concatenate(vs), np.concatenate(fs)


def sample_surface(v: np.ndarray, f: np.ndarray, step: float) -> np.ndarray:
    """Vertices plus barycentric samples no more than `step` apart on every triangle."""
    if not len(f):
        return v
    tri = v[f]
    edge = np.max(np.linalg.norm(tri - np.roll(tri, 1, axis=1), axis=2), axis=1)
    steps = np.maximum(1, np.ceil(edge / step).astype(int))
    out = [v]
    for n in np.unique(steps):
        sel = tri[steps == n]
        a, b = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
        m = (a + b) <= n
        u = (a[m] / n)[:, None]
        w = (b[m] / n)[:, None]
        out.append((sel[:, None, 0, :] * (1 - u - w)[None] + sel[:, None, 1, :] * u[None] + sel[:, None, 2, :] * w[None]).reshape(-1, 3))
    return np.concatenate(out)


def in_zones(pts: np.ndarray, zones: list[dict]) -> np.ndarray:
    """Points inside any contact zone: a vertical cylinder (centre x, y; radius; z range), or one along `axis` (centre x, y, z; z range along the axis from the centre)."""
    hit = np.zeros(len(pts), dtype=bool)
    for z in zones:
        c = np.asarray(z["centre"], dtype=float)
        if "axis" in z:
            a = np.asarray(z["axis"], dtype=float)
            a = a / np.linalg.norm(a)
            t = (pts - c) @ a
            r = np.linalg.norm(pts - c - t[:, None] * a, axis=1)
            hit |= (r <= z["radius"]) & (t >= z["z"][0]) & (t <= z["z"][1])
            continue
        r = np.hypot(pts[:, 0] - c[0], pts[:, 1] - c[1])
        hit |= (r <= z["radius"]) & (pts[:, 2] >= z["z"][0]) & (pts[:, 2] <= z["z"][1])
    return hit


def cylinder_distance(pts: np.ndarray, s: dict) -> np.ndarray:
    """Signed distance from points to a finite solid cylinder (origin at one end, axis, radius, length): negative inside."""
    a = np.asarray(s["axis"], dtype=float)
    a = a / np.linalg.norm(a)
    d = pts - np.asarray(s["origin"], dtype=float)
    t = d @ a
    dr = np.linalg.norm(d - t[:, None] * a, axis=1) - s["radius"]
    dz = np.maximum(-t, t - s["length"])
    outside = np.hypot(np.maximum(dr, 0.0), np.maximum(dz, 0.0))
    return np.where((dr > 0) | (dz > 0), outside, np.maximum(dr, dz))


def exact_clearance(pts: np.ndarray, cavity: dict) -> tuple[np.ndarray, np.ndarray]:
    """Signed clearance (mm) from points to the cavity's walls and the solids standing in it, and which part each nearest wall belongs to.

    Inside the cavity and clear of every solid it is the distance to the
    nearest of them; a point in a solid or outside the cavity is negative.
    """
    names = []
    cols = []
    lo, hi = np.asarray(cavity["min"], dtype=float), np.asarray(cavity["max"], dtype=float)
    side_top = cavity.get("side_top", hi[2])
    if cavity["shape"] == "round":
        c = cavity["centre"]
        cols.append(cavity["radius"] - np.hypot(pts[:, 0] - c[0], pts[:, 1] - c[1]))
        names.append("side")
    else:
        for k in (0, 1):
            cols += [pts[:, k] - lo[k], hi[k] - pts[:, k]]
            names += ["side", "side"]
    cols += [pts[:, 2] - lo[2], hi[2] - pts[:, 2]]
    names += ["floor", "ceiling"]
    solids = cavity.get("solids", [])
    for s in solids:
        # only points that can be nearer to it than to everything else's floor of 1 mm past the clearance need the distance
        d = np.full(len(pts), np.inf)
        o, a = np.asarray(s["origin"], dtype=float), np.asarray(s["axis"], dtype=float)
        ends = np.stack([o, o + a / np.linalg.norm(a) * s["length"]])
        reach = s["radius"] + 2.0
        near = np.all((pts >= ends.min(axis=0) - reach) & (pts <= ends.max(axis=0) + reach), axis=1)
        d[near] = cylinder_distance(pts[near], s)
        cols.append(d)
        names.append(s["name"])
    m = np.stack(cols, axis=1)
    k = np.argmin(m, axis=1)
    split = cavity.get("split_z", hi[2])
    part = np.empty(len(pts), dtype=object)
    for i, name in enumerate(names):
        sel = k == i
        if not sel.any():
            continue
        z = pts[sel, 2]
        if name == "floor":
            part[sel] = "base"
        elif name == "ceiling":
            part[sel] = "lid"
        elif name == "side":
            part[sel] = np.where(z < side_top, "base", "lid")
        else:
            s = solids[i - (len(names) - len(solids))]
            part[sel] = s.get("part") or np.where(z < split, "base", "lid")
    labels = np.array([f"{p} ({names[j] if names[j] not in ('side', 'floor', 'ceiling') else 'cavity ' + names[j]})" for p, j in zip(part, k)], dtype=object)
    return m[np.arange(len(pts)), k], labels


def outside_cavity(v: np.ndarray, cavity: dict) -> tuple[float, list[float] | None]:
    """How far (mm) the furthest vertex lies outside the cavity primitive, and where."""
    if not len(v):
        return 0.0, None
    if cavity["shape"] == "round":
        c = cavity["centre"]
        out_r = np.hypot(v[:, 0] - c[0], v[:, 1] - c[1]) - cavity["radius"]
        out_xy = out_r
    else:
        (x0, y0, _), (x1, y1, _) = cavity["min"], cavity["max"]
        out_xy = np.maximum.reduce([x0 - v[:, 0], v[:, 0] - x1, y0 - v[:, 1], v[:, 1] - y1])
    out_z = np.maximum(cavity["min"][2] - v[:, 2], v[:, 2] - cavity["max"][2])
    out = np.maximum(out_xy, out_z)
    k = int(np.argmax(out))
    return float(out[k]), [round(float(x), 2) for x in v[k]]


def analyse(parts: dict[str, tuple[np.ndarray, np.ndarray]], bodies: list[dict], cavity: dict, resolution: float, clearance: float) -> dict:
    """parts: wall parts {name: (V, F)}; bodies: [{key, label, V, F, zones}]. Returns the fit report."""
    allv = np.concatenate([p[0] for p in parts.values()] + [b["V"] for b in bodies if len(b["V"])])
    lo = allv.min(axis=0) - 2.0
    hi = allv.max(axis=0) + 2.0
    res = float(resolution)
    cells = np.prod(np.ceil((hi - lo) / res) + 1)
    if cells > MAX_CELLS:
        res = float(np.ceil(((np.prod(hi - lo) / MAX_CELLS) ** (1 / 3)) * 100) / 100)
    om = ObstacleMap(np.floor(lo), np.ceil(hi), res)
    for name, (v, f) in sorted(parts.items()):
        om.add_solid(v, f, name)
    om.finalize()
    depth = ndimage.distance_transform_edt(om.occ) * res

    def depth_at(pts):
        g = (np.asarray(pts, dtype=float) - om.lo) / res
        return ndimage.map_coordinates(depth, g.T, order=1, mode="nearest")

    out_bodies = []
    for b in bodies:
        entry = {"key": b["key"], "label": b.get("label", b["key"])}
        if not len(b["V"]):
            entry.update({"status": "no_geometry"})
            out_bodies.append(entry)
            continue
        pts = sample_surface(b["V"], b["F"], res * 0.5)
        keep = ~in_zones(pts, b.get("zones", []))
        pts = pts[keep]
        out_mm, out_at = outside_cavity(b["V"], cavity)
        if not len(pts):
            entry.update({"status": "clear", "samples": 0, "outside_cavity_mm": round(max(out_mm, 0.0), 3)})
            out_bodies.append(entry)
            continue
        signed = om.clearance(pts) - depth_at(pts)
        kv = int(np.argmin(signed))
        v_worst = float(signed[kv])
        exact, near = exact_clearance(pts, cavity)
        ke = int(np.argmin(exact))
        e_worst = float(exact[ke])
        # exact: no tolerance; voxel: one cell either way
        e_status = "collision" if e_worst < -1e-3 else ("tight" if e_worst < clearance - 1e-3 else "clear")
        v_status = "collision" if v_worst < -res else ("tight" if v_worst < clearance - res else "clear")
        rank = {"clear": 0, "tight": 1, "collision": 2}
        voxel = rank[v_status] > rank[e_status]
        status = "collision" if out_mm > 1e-3 else max(e_status, v_status, key=rank.get)
        worst, at, by = (v_worst, pts[kv], om.owner_at(pts[kv])) if voxel else (e_worst, pts[ke], str(near[ke]))
        entry.update(
            {
                "min_clearance_mm": round(worst, 3),
                "at": [round(float(x), 2) for x in at],
                "near": by,
                "basis": "voxel" if voxel else "exact",
                "exact_clearance_mm": round(e_worst, 3),
                "voxel_clearance_mm": round(v_worst, 2),
                "outside_cavity_mm": round(max(out_mm, 0.0), 3),
                **({"outside_at": out_at} if out_mm > 1e-3 else {}),
                "samples": int(len(pts)),
                "status": status,
            }
        )
        out_bodies.append(entry)

    # local wall thickness at the medial surface of each part
    walls = {}
    peak = (ndimage.maximum_filter(depth, size=3) <= depth + 1e-9) & om.occ & (depth >= res)
    border = np.zeros_like(peak)
    border[2:-2, 2:-2, 2:-2] = True
    peak &= border
    for k, name in enumerate(om.names):
        sel = peak & (om.owner == k)
        if not sel.any():
            continue
        d = depth[sel]
        i = int(np.argmin(d))
        idx = np.argwhere(sel)[i]
        walls[name] = {"min_mm": round(float(2 * d[i] - res), 2), "at": [round(float(x), 2) for x in om.centre(idx)]}
    return {"resolution_mm": res, "grid": list(om.shape), "bodies": out_bodies, "walls": walls}


def local_map(bodies: list[dict], lo: np.ndarray, hi: np.ndarray, res: float) -> ObstacleMap:
    """An obstacle map of the bodies over a small box: each body is filled solid on its own grid (on the same lattice) and cropped in, so a body the box cuts through is still solid."""
    om = ObstacleMap(lo, hi, res)
    for b in bodies:
        vmin, vmax = b["V"].min(axis=0), b["V"].max(axis=0)
        if np.any(vmax < lo) or np.any(vmin > hi):
            continue
        blo = om.lo + (np.floor((vmin - om.lo) / res) - 2) * res
        bm = ObstacleMap(blo, vmax + 2 * res, res)
        bm.add_solid(b["V"], b["F"], b["key"])
        off = np.round((bm.lo - om.lo) / res).astype(int)
        a0 = np.maximum(off, 0)
        a1 = np.minimum(off + np.array(bm.shape), np.array(om.shape))
        if np.any(a1 <= a0):
            continue
        local = bm.occ[tuple(slice(x - k, y - k) for x, y, k in zip(a0, a1, off))]
        sl = tuple(slice(x, y) for x, y in zip(a0, a1))
        om.occ[sl] |= local
        if b["key"] not in om.names:
            om.names.append(b["key"])
        om.owner[sl][local] = om.names.index(b["key"])
    om.finalize()
    return om


def analyse_plungers(plungers: list[dict], bodies: list[dict], resolution: float, clearance: float) -> list[dict]:
    """Each plunger against what is inside (not the walls: it passes through one by design), in a voxel field of the contents around it.

    plungers: [{key, feature, V, F, zones}], the zone being its tip, which
    meets the switch it presses by design (the gap there is checked exactly).
    """
    inside = [b for b in bodies if len(b["V"])]
    res = float(resolution)
    out = []
    for p in plungers:
        entry = {"key": p["key"], "feature": p["feature"]}
        if not inside or not len(p["V"]):
            out.append({**entry, "status": "clear", "near": None})
            continue
        margin = clearance + 1.0 + 2 * res
        om = local_map(inside, np.floor(p["V"].min(axis=0) - margin), np.ceil(p["V"].max(axis=0) + margin), res)
        pts = sample_surface(p["V"], p["F"], res * 0.5)
        pts = pts[~in_zones(pts, p.get("zones", []))]
        if not len(pts) or not om.occ.any():
            out.append({**entry, "status": "clear", "near": None})
            continue
        depth = ndimage.distance_transform_edt(om.occ) * res
        signed = om.clearance(pts) - ndimage.map_coordinates(depth, ((pts - om.lo) / res).T, order=1, mode="nearest")
        k = int(np.argmin(signed))
        worst = float(signed[k])
        out.append(
            {
                **entry,
                "min_clearance_mm": round(worst, 2),
                "at": [round(float(x), 2) for x in pts[k]],
                "near": om.owner_at(pts[k]),
                "basis": "voxel",
                "resolution_mm": res,
                "status": "collision" if worst < -res else ("tight" if worst < clearance - res else "clear"),
            }
        )
    return out
