"""Routed wire-harness CAD (protoboard ext-harness-cad).

    python harness_cad.py route <job.json> <out-dir>
    python harness_cad.py export <out-dir> <route.json>... [--no-step]
    python harness_cad.py <job.json> <out-dir> [--no-step]

The job (lib/job.ts) holds the assembled model's bodies and, per harness,
its conductors, modelled length and ends resolved to world positions.

`route` finds each harness's route through the model and writes
<id>.route.json: the conductor paths (full precision), centreline, length
fit, bend limits, clearance and notes. That is the native design. Harnesses
are routed in the system's order (rigid ends first, then thickest); each
routed cable becomes an obstacle for the next. Only the job's `targets`
are written; harnesses before the last target are routed again in memory,
so a route does not depend on which harnesses were generated when.

`export` builds the bodies from route files, in assembly-root coordinates
(mm, Z up):

    <id>.glb            conductors (twisted or parallel), plug housings,
                        solder joints and tinned tips; one named node each
    <id>.step           the same solids (build123d sweeps), when they build
    <id>.manifest.json  end frames, lengths, bend radii, clearance, route

With a job and a folder alone it does both for every harness. Each mode
prints one JSON summary line. Outputs are deterministic for a fixed job and
build123d version: the STEP timestamp is normalised. OpenCascade numbers a
STEP file's assembly occurrences with a counter that runs for the whole
process, so the STEP of the n-th harness exported in one process differs in
those ids (not in geometry) from exporting it alone; lib/route.ts exports one
harness per process.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from glb import read_glb, to_cad_mm, write_glb  # noqa: E402
from route import ObstacleMap, apex_loop, arclen, astar, fillet, fit_length, length, min_radius, pull_string, resample, rmf, smooth  # noqa: E402

TOOL = "protoboard ext-harness-cad (py/harness_cad.py)"
ROUTE_SCHEMA = "protoboard.harness-cad.route/v0"
FIXED_TIME = "2000-01-01T00:00:00"
SIDES = 10


def rnd(x, n=2):
    """JSON-safe rounding (None for inf/nan)."""
    return round(float(x), n) if x is not None and math.isfinite(x) else None


def unit(v):
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def core_diameter(awg: float | None, od: float) -> float:
    if awg:
        return 0.127 * 92 ** ((36 - awg) / 39)
    return od


# ---------------------------------------------------------------------------------------------
# Meshing
# ---------------------------------------------------------------------------------------------


def tube(pts: np.ndarray, r: float, caps: bool = True):
    pts = resample(pts, 0.7) if len(pts) > 1 else pts
    t, n, b = rmf(pts, np.array([0, 0, 1.0]))
    ang = np.linspace(0, 2 * math.pi, SIDES, endpoint=False)
    ring = np.cos(ang)[None, :, None] * n[:, None, :] + np.sin(ang)[None, :, None] * b[:, None, :]
    v = (pts[:, None, :] + r * ring).reshape(-1, 3)
    faces = []
    m = len(pts)
    for i in range(m - 1):
        for j in range(SIDES):
            a = i * SIDES + j
            bb = i * SIDES + (j + 1) % SIDES
            c = (i + 1) * SIDES + j
            d = (i + 1) * SIDES + (j + 1) % SIDES
            faces += [(a, c, bb), (bb, c, d)]
    if caps:
        v = np.vstack([v, pts[0], pts[-1]])
        c0, c1 = len(v) - 2, len(v) - 1
        for j in range(SIDES):
            faces.append((c0, (j + 1) % SIDES, j))
            faces.append((c1, (m - 1) * SIDES + j, (m - 1) * SIDES + (j + 1) % SIDES))
    return v, np.array(faces)


def box(centre, x, y, z, size):
    x, y, z = unit(x), unit(y), unit(z)
    hx, hy, hz = (s / 2 for s in size)
    corners = np.array([centre + sx * hx * x + sy * hy * y + sz * hz * z for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])
    f = [(0, 1, 3), (0, 3, 2), (4, 6, 7), (4, 7, 5), (0, 4, 5), (0, 5, 1), (2, 3, 7), (2, 7, 6), (0, 2, 6), (0, 6, 4), (1, 5, 7), (1, 7, 3)]
    return corners, np.array(f)


def ellipsoid(centre, axes, radii, n=10):
    u = np.linspace(0, math.pi, n)
    w = np.linspace(0, 2 * math.pi, 2 * n, endpoint=False)
    v = []
    for a in u:
        for c in w:
            p = np.array([math.sin(a) * math.cos(c) * radii[0], math.sin(a) * math.sin(c) * radii[1], math.cos(a) * radii[2]])
            v.append(centre + p[0] * axes[0] + p[1] * axes[1] + p[2] * axes[2])
    f = []
    for i in range(n - 1):
        for j in range(2 * n):
            a = i * 2 * n + j
            b = i * 2 * n + (j + 1) % (2 * n)
            c = (i + 1) * 2 * n + j
            d = (i + 1) * 2 * n + (j + 1) % (2 * n)
            f += [(a, c, b), (b, c, d)]
    return np.array(v), np.array(f)


def area_centroid(parts):
    tot, acc = 0.0, np.zeros(3)
    for v, f in parts:
        tri = v[f]
        a = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
        tot += a.sum()
        acc += (tri.mean(axis=1) * a[:, None]).sum(axis=0)
    return tot, acc / max(tot, 1e-12)


# ---------------------------------------------------------------------------------------------
# One harness
# ---------------------------------------------------------------------------------------------


def open_direction(om, p, n, reach: float, toward=None):
    """The direction a wire leaves a pad in: the pad normal, or tilted up to 70 degrees
    toward whichever side has the most room over the next `reach` mm (ties broken
    toward the cable's other end)."""
    a1 = unit(np.cross(n, [0, 0, 1.0]) if abs(n[2]) < 0.9 else np.cross(n, [1.0, 0, 0]))
    a2 = np.cross(n, a1)
    best = (-np.inf, n)
    for tilt in (0, 30, 50, 70):
        for az in (range(0, 360, 45) if tilt else [0]):
            t, a = math.radians(tilt), math.radians(az)
            d = unit(math.cos(t) * n + math.sin(t) * (math.cos(a) * a1 + math.sin(a) * a2))
            ray = p + np.outer(np.linspace(1.5, reach, 8), d)
            room = float(om.clearance(ray).min())
            score = room + (0.6 * float(np.dot(d, toward)) if toward is not None else 0.0) - 0.004 * tilt
            if score > best[0]:
                best = (score, d)
    return best[1]


def end_geometry(end, od_bundle, om=None, r_route=0.0, toward=None):
    """Where an end's length is measured from (R), where its bundle starts (S), and each conductor's way out.

    Plug: the conductors leave the housing's rear along the socket's normal.
    Solder pads: each wire leaves its pad up and tilted toward open space
    (away from the next board above, from components beside it), so a row of
    pads along a board edge is left from the outside; the bundle starts
    where those wires meet, pushed further out until the bundle fits there.
    Integral leads (motor, capacitor): straight on from where they leave the part.
    """
    O = np.array(end["counterpartFrame"]["origin"], dtype=float)
    n = unit(end["counterpartFrame"]["normal"])
    t = end["termination"]
    pins = [np.array(p["at"], dtype=float) for p in end["pins"]]
    if t["kind"] == "plug":
        R = O + n * t["housing"]["visible"]
        stub = 3.0 + od_bundle / 2
        dirs = [n for _ in pins]
        S = R + n * stub
    elif t["kind"] == "solder":
        R = np.mean(pins, axis=0)
        dirs, exits = [], []
        for p, pin in zip(pins, end["pins"]):
            pn = unit(pin["out"])
            d = open_direction(om, p, pn, 3.0 + od_bundle, toward) if om is not None else pn
            dirs.append(d)
            exits.append(p + d * (3.0 + od_bundle / 2))
        S = np.mean(exits, axis=0)
        if om is not None:
            for _ in range(24):
                if om.clearance([S])[0] >= r_route + 0.3:
                    break
                g = om.gradient(S)
                if np.linalg.norm(g) < 1e-6:
                    break
                S = S + g * 0.5
        stub = float(np.linalg.norm(S - R))
    else:
        R = O
        stub = 2.0 + od_bundle / 2
        dirs = [n for _ in pins]
        S = R + n * stub
    exit_dir = unit(S - R)
    return O, exit_dir, R, S, stub, dirs


def route_harness(h, om: ObstacleMap, notes: list[str]):
    cond = h["conductors"]
    nc = len(cond)
    od = cond[0]["od"]
    twisted = h["build"]["bundle"] == "twisted" and nc > 1
    if twisted:
        rb = (od / 2) / math.sin(math.pi / nc) if nc > 1 else 0.0
        r_bundle = rb + od / 2
    elif cond[0]["bare"]:
        r_bundle = od / 2 + 0.3  # separate component leads: each finds its own way beside the route
        rb = 0.0
    else:
        spacing = h["build"].get("spacing_mm") or od * 1.02
        # a flat cable lies flat where it is tight (see ribbon_axis): route it with a little
        # over half its half-width, and let the conductor check confirm it fits
        r_bundle = max(od / 2, 0.6 * ((nc - 1) * spacing + od) / 2)
        rb = 0.0
    r_route = r_bundle + 0.3
    ea, eb = h["ends"]
    ca = np.mean([p["at"] for p in ea["pins"]], axis=0)
    cb = np.mean([p["at"] for p in eb["pins"]], axis=0)
    Oa, na, Ra, Sa, stub_a, dirs_a = end_geometry(ea, 2 * r_bundle, om, r_route, unit(cb - ca))
    Ob, nb, Rb, Sb, stub_b, dirs_b = end_geometry(eb, 2 * r_bundle, om, r_route, unit(ca - cb))
    # where the bundle may touch what it starts from: around each end's bundle start
    zones = [(Sa, r_route + 2.5), (Sb, r_route + 2.5)]
    # every conductor's own termination: where it meets its pad or plug by design
    # (at a solder pad, other wires soldered to the same pad are expected within a few mm)
    pin_zones = [(np.array(p["at"], dtype=float), od + (3.5 if e["termination"]["kind"] == "solder" else 2.5) + (e["termination"]["housing"]["visible"] if e["termination"]["kind"] == "plug" else 0.0)) for e in (ea, eb) for p in e["pins"]]

    t0 = time.time()
    path = astar(om, Sa, Sb, r_route, zones)
    if path is None:
        raise RuntimeError(f"{h['path']}: no route between {ea['counterpart']} and {eb['counterpart']} for a {2 * r_bundle:.1f} mm bundle")
    od_target = 2 * r_bundle
    # a twisted bundle bends like a round cable of its own diameter; a flat
    # (parallel) one bends across its thin side, like one conductor
    stiff = max(od, 0.6 * od_target) if twisted else od
    # fine-strand silicone wire in a static installation: bends down to about
    # 2.5 x its diameter are acceptable, 4 x is comfortable (a representative rule)
    bend_target = max(4 * stiff, 4.0)
    bend_min = max(2.5 * stiff, 2.5)
    fixed = max(2, int(min(stub_a, stub_b) / 0.5))

    def shape(halves):
        poly = [Ra]
        for k, hp in enumerate(halves):
            seg = [Sa if k == 0 else hp[0]] + hp[1:-1] + [Sb if k == len(halves) - 1 else hp[-1]]
            pulled = pull_string(om, seg, r_route, zones)
            poly += pulled if k == 0 else pulled[1:]
        poly.append(Rb)
        c, rr = fillet(poly, bend_target)
        return smooth(c, om, r_route, fixed=fixed, iters=150, zones=zones), rr, poly

    centre, radii, poly = shape([[Sa] + path[1:-1] + [Sb]])
    target = h["length_mm"]
    base = length(centre)
    fit = {"route_mm": round(base, 2)}
    method = "shortest"
    if target > base + max(3.0, 0.08 * base):
        # more than a little slack: a service loop pulled out into clear space
        got = apex_loop(poly, om, r_route, zones, target, bend_target, bend_min, fixed, skip=max(stub_a, stub_b) + 2.0)
        if got is not None:
            centre, info = got
            method = "service loop"
            fit.update(info)
    t_search = time.time() - t0
    base2 = length(centre)
    if abs(target - length(centre)) <= (1.0 if method != "shortest" else 1.5):
        fit.setdefault("method", method)  # within tolerance of the modelled length already
    elif target < base - 0.5:
        notes.append(f"modelled length {target} mm is {base - target:.1f} mm shorter than the shortest clear route ({base:.1f} mm): the cable does not reach")
        fit["method"] = "too short"
    else:
        keep = min(max(stub_a, stub_b) + 2 * od_target, 0.3 * base2)
        centre, info = fit_length(centre, target, om, r_route, keep, zones, bend_min, bend_target)
        info["method"] = method if info["method"] == "none" else (info["method"] if method == "shortest" else f"{method} + {info['method']}")
        fit.update(info)
        if "not clear" in info["method"] or "failed" in info["method"]:
            notes.append(f"slack could not be laid clear: {info['method']} ({info.get('worst_clearance_mm', '?')} mm worst clearance, {info.get('bend_mm', '?')} mm bend radius)")
    centre = resample(centre, 0.5)
    centre = fair(centre, om, r_route, zones, fixed=max(4, int(min(stub_a, stub_b) / 0.5)))
    return {
        "centre": centre,
        "r_bundle": r_bundle,
        "rb": rb,
        "twisted": twisted,
        "ends": [(Oa, na, Ra, Sa, stub_a), (Ob, nb, Rb, Sb, stub_b)],
        "dirs": [dirs_a, dirs_b],
        "bend_target": bend_target,
        "bend_min": bend_min,
        "fillet_radii": radii,
        "fit": fit,
        "zones": zones,
        "pin_zones": pin_zones,
        "t_search": t_search,
    }


def ribbon_axis(centre, t, om, across_a, across_b, fan):
    """Width direction of a flat cable along its route: flat against the nearest surface
    (normal to both the route and the direction away from that surface), turning to
    each end's pin row over the fan length."""
    n = len(centre)
    s = arclen(centre)
    w = np.zeros_like(centre)
    prev = None
    for i in range(n):
        g = om.gradient(centre[i])
        c = np.cross(t[i], g)
        if np.linalg.norm(c) < 0.2:
            c = prev if prev is not None else np.cross(t[i], [0, 0, 1.0])
        c = c - t[i] * np.dot(c, t[i])
        c /= max(np.linalg.norm(c), 1e-9)
        if prev is not None and np.dot(c, prev) < 0:
            c = -c
        w[i] = c
        prev = c
    # smooth, then blend to the pin rows at the ends
    k = 9
    ker = np.ones(k) / k
    w = np.stack([np.convolve(np.pad(w[:, j], k // 2, mode="edge"), ker, mode="valid") for j in range(3)], axis=1)
    for i in range(n):
        a = min(1.0, s[i] / max(fan, 1e-6))
        b = min(1.0, (s[-1] - s[i]) / max(fan, 1e-6))
        target = w[i]
        for end_w, f in ((across_a, a), (across_b, b)):
            ew = end_w - t[i] * np.dot(end_w, t[i])
            if np.linalg.norm(ew) > 1e-6:
                ew /= np.linalg.norm(ew)
                if np.dot(ew, target) < 0:
                    ew = -ew
                target = f * target + (1 - f) * ew
        target -= t[i] * np.dot(target, t[i])
        w[i] = target / max(np.linalg.norm(target), 1e-9)
    return w


def conductor_paths(h, r, om=None):
    """Each conductor from its termination on end A to its termination on end B."""
    centre = r["centre"]
    cond = h["conductors"]
    nc = len(cond)
    od = cond[0]["od"]
    ea, eb = h["ends"]
    (Oa, na, Ra, Sa, stub_a), (Ob, nb, Rb, Sb, stub_b) = r["ends"]
    # frame along the centreline, oriented by end A's pin order
    pins_a = [np.array(p["at"], dtype=float) for p in ea["pins"]]
    pins_b = [np.array(p["at"], dtype=float) for p in eb["pins"]]
    across = pins_a[-1] - pins_a[0] if nc > 1 else np.array([0, 0, 1.0])
    t, nrm, bin_ = rmf(centre, across)
    s = arclen(centre)
    total = s[-1]
    pitch = h["build"].get("twist_pitch_mm") or 20.0
    spread = max(np.ptp(np.array(pins_a), axis=0).max(), np.ptp(np.array(pins_b), axis=0).max()) if nc > 1 else 0.0
    fan = min(max(6.0, 3.0 * r["r_bundle"] * 2, 1.2 * spread), 0.35 * total)

    if not r["twisted"] and nc > 1 and om is not None:
        across_b = pins_b[h["pairs"][-1]] - pins_b[h["pairs"][0]]
        nrm = ribbon_axis(centre, t, om, across, across_b, fan)

    def offset(k, i):
        if r["twisted"]:
            a = 2 * math.pi * k / nc + 2 * math.pi * s[i] / pitch
            return r["rb"] * (math.cos(a) * nrm[i] + math.sin(a) * bin_[i])
        return (k - (nc - 1) / 2) * (h["build"].get("spacing_mm") or od * 1.02) * nrm[i]

    def term(end, pin, n):
        kind = end["termination"]["kind"]
        if kind == "plug":
            return pin + n * end["termination"]["housing"]["visible"]
        if kind == "solder":
            return pin + n * (od / 2)
        return pin

    out = []
    for k in range(nc):
        kb = h["pairs"][k]
        ta = term(ea, pins_a[k], unit(ea["pins"][k]["out"]))
        tb = term(eb, pins_b[kb], unit(eb["pins"][kb]["out"]))
        # na / nb are the end's exit directions (tilted off a pad toward open space)
        ia = int(np.searchsorted(s, fan))
        ib = int(np.searchsorted(s, total - fan))
        body = np.array([centre[i] + offset(k, i) for i in range(ia, ib + 1)])
        # A side: stub along the pin's outward normal, then a cubic into the bundle
        da = r["dirs"][0][k]
        db = r["dirs"][1][kb]
        pa1 = ta + da * max(1.0, 0.85 * min(stub_a, 3.0 + 2 * r["r_bundle"]))
        qa = body[0]
        ha = np.linalg.norm(qa - pa1) / 2.2
        ba = np.array([(1 - u) ** 3 * pa1 + 3 * (1 - u) ** 2 * u * (pa1 + da * ha) + 3 * (1 - u) * u**2 * (qa - t[ia] * ha) + u**3 * qa for u in np.linspace(0, 1, 16)])
        pb1 = tb + db * max(1.0, 0.85 * min(stub_b, 3.0 + 2 * r["r_bundle"]))
        qb = body[-1]
        hb = np.linalg.norm(qb - pb1) / 2.2
        bb = np.array([(1 - u) ** 3 * qb + 3 * (1 - u) ** 2 * u * (qb + t[ib] * hb) + 3 * (1 - u) * u**2 * (pb1 + db * hb) + u**3 * pb1 for u in np.linspace(0, 1, 16)])
        path = np.vstack([ta, ba, body[1:-1], bb, tb])
        out.append(resample(path, 0.4))
    return out


def fair(centre: np.ndarray, om: ObstacleMap, radius: float, zones, fixed: int) -> np.ndarray:
    """Fair the centre line with a smoothing spline (keeping the ends and their stubs),
    removing the small kinks that obstacle-bounded smoothing leaves; kept only if it stays clear."""
    from scipy.interpolate import splev, splprep

    if len(centre) < 2 * fixed + 6:
        return centre
    mid = centre[fixed:-fixed]
    try:
        for tol in (0.08, 0.05, 0.03):
            tck, _ = splprep(mid.T, s=len(mid) * tol**2, k=3)
            u = np.linspace(0, 1, len(mid))
            new = np.array(splev(u, tck)).T
            new[0], new[-1] = mid[0], mid[-1]
            c = om.clearance(new)
            inside = np.array([any(np.linalg.norm(q - zc) <= zr for zc, zr in zones) for q in new])
            if ((c >= radius - 0.35) | inside).all():  # the conductors are relaxed clear afterwards
                return np.vstack([centre[:fixed], new, centre[-fixed:]])
    except Exception:  # noqa: BLE001
        pass
    return centre


def relax(p: np.ndarray, om: ObstacleMap, radius: float, zones, iters: int = 150) -> np.ndarray:
    """Push a conductor's points out of solids (along the clearance gradient), smoothing as it goes.

    The route is found for the bundle's centre line; the conductors fanned
    and twisted around it can graze a corner. This settles each one the last
    fraction of a millimetre clear, the way a real wire would lie.
    """
    q = p.copy()
    free = np.array([not any(np.linalg.norm(x - zc) <= zr for zc, zr in zones) for x in q])
    free[:2] = free[-2:] = False
    for _ in range(iters):
        c = om.clearance(q)
        bad = free & (c < radius + 0.05)
        if not bad.any():
            break
        for i in np.where(bad)[0]:
            g = om.gradient(q[i])
            if np.linalg.norm(g) > 1e-9:
                q[i] = q[i] + g * (radius + 0.15 - c[i])
        if _ % 4:
            continue
        # keep it smooth where it moved
        sm = q.copy()
        sm[1:-1] = 0.5 * q[1:-1] + 0.25 * (q[:-2] + q[2:])
        near = np.convolve(bad.astype(float), np.ones(7), mode="same") > 0
        near &= free
        q[near] = sm[near]
    return q



# ---------------------------------------------------------------------------------------------
# Routing (the native design) and export (the bodies)
# ---------------------------------------------------------------------------------------------


def routing_order(harnesses: list[dict]) -> list[dict]:
    """The system's routing order: rigid ends first (plug housings, component leads), which
    cannot move out of the way; then thickest first. Soldered flying leads bend around what
    is already there."""
    rigid = lambda h: sum(e["termination"]["kind"] == "plug" for e in h["ends"]) + (2 if h["conductors"][0]["bare"] else 0)
    return sorted(harnesses, key=lambda h: (-rigid(h), -h["conductors"][0]["od"] * len(h["conductors"])))


def obstacle_map(job) -> ObstacleMap:
    """Every placed body, in a lattice that covers the bodies and every harness end in the job."""
    meshes = []
    lo = np.array([np.inf] * 3)
    hi = -lo
    for b in job["bodies"]:
        m = np.array(b["matrix"], dtype=float).reshape(4, 4)
        for _name, v, f in read_glb(b["glb"]):
            w = to_cad_mm(v) @ m[:3, :3].T + m[:3, 3]
            meshes.append((w, f, b["key"]))
            lo = np.minimum(lo, w.min(axis=0))
            hi = np.maximum(hi, w.max(axis=0))
    for h in job["harnesses"]:
        for e in h["ends"]:
            for p in e["pins"]:
                lo = np.minimum(lo, np.array(p["at"]) - 40)
                hi = np.maximum(hi, np.array(p["at"]) + 40)
    # a lattice anchored at whole millimetres, so routes do not depend on where the model's bounds fall
    om = ObstacleMap(np.floor(lo - 15), np.ceil(hi + 15), 1.0)
    for w, f, key in meshes:
        om.add_solid(w, f, key)
    om.finalize()
    return om


def route_one(h, om: ObstacleMap) -> tuple[dict, float]:
    """Route one harness through the map and stamp it as an obstacle for later routes.

    Returns the route (conductor paths at full precision, centreline, fit, bend limits,
    clearance, notes) as plain JSON data, and the search time."""
    notes: list[str] = []
    r = route_harness(h, om, notes)
    paths = conductor_paths(h, r, om)
    od = h["conductors"][0]["od"]
    paths = [relax(p, om, od / 2, r["pin_zones"]) for p in paths]

    # ---- clearance of every conductor (outside the terminations' zones) ----
    worst = math.inf
    worst_at = None
    for p in paths:
        c = om.clearance(p) - od / 2
        mask = np.ones(len(p), dtype=bool)
        for zc, zr in r["pin_zones"]:
            mask &= np.linalg.norm(p - zc, axis=1) > zr
        if mask.any():
            i = int(np.argmin(np.where(mask, c, np.inf)))
            if c[i] < worst:
                worst, worst_at = float(c[i]), p[i]
    if worst < -0.2:
        notes.append(f"a conductor comes within {worst:.2f} mm of a solid (penetrates {om.owner_at(worst_at)}) at {np.round(worst_at, 1).tolist()}")

    # ---- stamp as an obstacle for later routes ----
    for p in paths:
        om.stamp_tube(p, od / 2, h["path"])
    om.finalize()

    route = {
        "schema": ROUTE_SCHEMA,
        "tool": TOOL,
        "harness": h,
        "paths": [p.tolist() for p in paths],
        "centre": np.asarray(r["centre"]).tolist(),
        "stubs": [float(r["ends"][0][4]), float(r["ends"][1][4])],
        "twisted": bool(r["twisted"]),
        "r_bundle": float(r["r_bundle"]),
        "bend_target": float(r["bend_target"]),
        "bend_min": float(r["bend_min"]),
        "fit": r["fit"],
        "clearance_mm": worst if math.isfinite(worst) else None,
        "notes": notes,
    }
    # exactly what a route file reads back as, so routing and exporting in one process
    # gives the same bodies as exporting a written route
    return json.loads(json.dumps(route)), r["t_search"]


def export_route(route: dict, out_dir: Path, step_ok: bool) -> dict:
    """Write <id>.glb, <id>.step and <id>.manifest.json from a route."""
    h = route["harness"]
    paths = [np.array(p, dtype=float) for p in route["paths"]]
    centre = np.array(route["centre"], dtype=float)
    notes = list(route["notes"])
    cond = h["conductors"]
    od = cond[0]["od"]
    awg = h.get("awg")
    core_d = core_diameter(awg, od) if not cond[0]["bare"] else od
    strip = h["build"].get("strip_mm", 2.0)
    ea, eb = h["ends"]

    # ---- meshes ----
    conductors, terminations = [], {ea["interfaceId"]: [], eb["interfaceId"]: []}
    for k, (c, p) in enumerate(zip(cond, paths)):
        s = arclen(p)
        colour = c["color"]
        if c["bare"]:
            v, f = tube(p, od / 2)
            conductors.append({"name": f"conductor_{c['position']}", "vertices": v, "faces": f, "color": "#c9ccd1", "metallic": 0.85, "roughness": 0.35, "material": "tinned copper"})
            continue
        lo = strip if ea["termination"]["kind"] == "solder" else 0.0
        hi = s[-1] - (strip if eb["termination"]["kind"] == "solder" else 0.0)
        ins = p[(s >= lo) & (s <= hi)]
        v, f = tube(ins, od / 2)
        conductors.append({"name": f"conductor_{c['position']}", "vertices": v, "faces": f, "color": colour, "metallic": 0.0, "roughness": 0.55, "material": "silicone insulation"})
        for end, sel in ((ea, s <= lo + 0.2), (eb, s >= hi - 0.2)):
            if end["termination"]["kind"] != "solder" or sel.sum() < 2:
                continue
            v, f = tube(p[sel], core_d / 2 * 1.08)
            terminations[end["interfaceId"]].append({"name": f"{end['interfaceId']}_tip_{c['position']}", "vertices": v, "faces": f, "color": "#c9ccd1", "metallic": 0.85, "roughness": 0.3, "material": "tinned copper"})
    for end in (ea, eb):
        t = end["termination"]
        n = unit(end["counterpartFrame"]["normal"])
        if t["kind"] == "plug":
            O = np.array(end["counterpartFrame"]["origin"], dtype=float)
            x = unit(end["counterpartFrame"].get("xAxis") or np.cross(n, [0, 0, 1.0]))
            y = np.cross(n, x)
            hsg = t["housing"]
            v, f = box(O + n * (hsg["visible"] - hsg["depth"] / 2), x, y, n, (hsg["width"], hsg["height"], hsg["depth"]))
            terminations[end["interfaceId"]].append({"name": f"{end['interfaceId']}_housing", "vertices": v, "faces": f, "color": hsg["color"], "metallic": 0.0, "roughness": 0.5, "material": hsg["name"]})
        elif t["kind"] == "solder":
            for pin in end["pins"]:
                P = np.array(pin["at"], dtype=float)
                nn = unit(pin["out"])
                a1 = unit(np.cross(nn, [0, 0, 1.0]) if abs(nn[2]) < 0.9 else np.cross(nn, [1.0, 0, 0]))
                a2 = np.cross(nn, a1)
                rj = max(core_d * 1.1, 0.9)
                v, f = ellipsoid(P + nn * 0.25, (a1, a2, nn), (rj, rj, max(0.55, core_d * 0.6)))
                terminations[end["interfaceId"]].append({"name": f"{end['interfaceId']}_joint_{pin['position']}", "vertices": v, "faces": f, "color": "#b9bdc4", "metallic": 0.9, "roughness": 0.25, "material": "solder"})
    groups = {"conductors": conductors, **{k: v for k, v in terminations.items() if v}}
    out_dir.mkdir(parents=True, exist_ok=True)
    glb = out_dir / f"{h['id']}.glb"
    write_glb(glb, groups)

    # ---- STEP (build123d sweeps) ----
    step_status = "skipped"
    if step_ok:
        try:
            step_status = write_step(out_dir / f"{h['id']}.step", h, paths, od, groups)
        except Exception as e:  # noqa: BLE001
            step_status = f"failed: {type(e).__name__}: {e}"
            notes.append(f"STEP not written ({step_status})")

    # ---- manifest ----
    lengths = [round(length(p), 2) for p in paths]
    # bends at the terminations (a wire turning off its pad or out of its plug) are reported apart
    term = max(route["stubs"]) + 1.0
    bend_centre = min_radius(centre, 1.5, skip=term)
    bend_term = min_radius(centre, 1.0, skip=0.5)
    bend_cond = min(min_radius(p, 1.5, skip=term) for p in paths)
    if math.isfinite(bend_centre) and bend_centre < route["bend_min"] - 0.05:
        notes.append(f"centreline bend radius {bend_centre:.1f} mm is under the {route['bend_min']:.1f} mm minimum")
    features = {}
    for iface, meshes in terminations.items():
        if meshes:
            a, c = area_centroid([(m["vertices"], m["faces"]) for m in meshes])
            features[iface] = {"area_mm2": round(a, 3), "centroid": [round(x, 3) + 0.0 for x in c], "faces": len(meshes)}
    fit = route["fit"]
    manifest = {
        "artifact": h["id"],
        "tool": TOOL,
        "toolVersion": "0.1.0",
        "sourceDigest": hashlib.sha256((json.dumps(h, sort_keys=True) + (HERE / "harness_cad.py").read_text() + (HERE / "route.py").read_text()).encode()).hexdigest(),
        "units": "mm",
        "coordinates": "assembly root (mm, Z up); glTF export in m, Y up",
        "harness": h["path"],
        "length_mm": h["length_mm"],
        "route_length_mm": round(float(length(centre)), 2),
        "conductor_lengths_mm": lengths,
        "length_fit": fit,
        "bundle": {"kind": "twisted" if route["twisted"] else "parallel", "conductors": len(cond), "conductor_od_mm": od, "bundle_od_mm": round(2 * route["r_bundle"], 2), "twist_pitch_mm": h["build"].get("twist_pitch_mm") if route["twisted"] else None},
        "bend_radius_mm": {"target": rnd(route["bend_target"]), "minimum": rnd(route["bend_min"]), "centreline": rnd(bend_centre), "conductors": rnd(bend_cond), "at_terminations": rnd(bend_term)},
        "clearance_mm": {"min_conductor_surface": rnd(route["clearance_mm"])},
        "ends": {e["interfaceId"]: {"frame": e["frame"], "counterpart": e["counterpart"], "termination": e["termination"]["kind"], "link": e["linkId"]} for e in (ea, eb)},
        "features": features,
        "step": step_status,
        "route": [[round(x, 2) for x in p] for p in resample(centre, 2.0)],
        "status": "ok" if not notes else "warning",
        "notes": notes,
    }
    (out_dir / f"{h['id']}.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return {"id": h["id"], "path": h["path"], "status": manifest["status"], "notes": notes, "length_mm": h["length_mm"], "route_length_mm": manifest["route_length_mm"], "slack_mm": fit.get("slack_mm"), "bend_mm": manifest["bend_radius_mm"], "clearance_mm": manifest["clearance_mm"]["min_conductor_surface"], "step": step_status}


def write_step(path: Path, h, paths, od, groups) -> str:
    import build123d as bd

    solids = []
    for c, p in zip(h["conductors"], paths):
        # control points: enough to follow a twist, few enough to keep the STEP small
        q = resample(p, 3.0 if h["build"]["bundle"] == "twisted" else 6.0)
        q[0], q[-1] = p[0], p[-1]
        try:
            spline = bd.Spline(*[bd.Vector(*x) for x in q])
            prof = bd.Plane(origin=bd.Vector(*q[0]), z_dir=spline.tangent_at(0)) * bd.Circle(od / 2)
            s = bd.sweep(prof.faces()[0] if hasattr(prof, "faces") else prof, path=spline)
            valid = s.is_valid() if callable(s.is_valid) else s.is_valid
            if not valid:
                raise ValueError("invalid sweep")
        except Exception:  # noqa: BLE001
            # a sweep that self-intersects in a tight twist: a chain of short cylinders instead
            q = resample(p, 1.2)
            segs = []
            for a, b in zip(q[:-1], q[1:]):
                v = b - a
                ln = float(np.linalg.norm(v))
                if ln < 1e-6:
                    continue
                cyl = bd.Cylinder(od / 2, ln + od * 0.3, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.CENTER))
                segs.append(cyl.moved(bd.Location(bd.Plane(origin=bd.Vector(*((a + b) / 2)), z_dir=bd.Vector(*(v / ln))))))
            s = bd.Compound(children=segs)
        s.label = f"conductor_{c['position']}"
        solids.append(s)
    for g, meshes in groups.items():
        if g == "conductors":
            continue
        for m in meshes:
            if "_housing" in m["name"]:
                v = np.asarray(m["vertices"])
                o = v[0]
                ax = [v[4] - v[0], v[2] - v[0], v[1] - v[0]]
                size = [np.linalg.norm(a) for a in ax]
                loc = bd.Location(bd.Plane(origin=bd.Vector(*o), x_dir=bd.Vector(*unit(ax[0])), z_dir=bd.Vector(*unit(ax[2]))))
                b = bd.Box(size[0], size[1], size[2], align=(bd.Align.MIN, bd.Align.MIN, bd.Align.MIN)).moved(loc)
                b.label = m["name"]
                solids.append(b)
            elif "_joint_" in m["name"]:
                c = np.asarray(m["vertices"]).mean(axis=0)
                sph = bd.Sphere(max(0.9, od * 0.55)).moved(bd.Location(bd.Vector(*c)))
                sph.label = m["name"]
                solids.append(sph)
    comp = bd.Compound(label=h["id"], children=solids)
    bd.export_step(comp, str(path))
    # the STEP processor stamps the export time; fix it so re-exports are byte-identical
    path.write_text(re.sub(r"FILE_NAME\('([^']*)','[^']*'", lambda m: f"FILE_NAME('{m.group(1)}','{FIXED_TIME}'", path.read_text(), count=1))
    return "ok"


def route_job(job, out: Path) -> dict:
    """Route the job's harnesses in the system's order and write <id>.route.json for each
    target (the job's `targets`, default all). A harness routed before a target is routed
    again here, in memory, so a target's route does not depend on which harnesses were
    generated when; harnesses after the last target are not routed."""
    t0 = time.time()
    om = obstacle_map(job)
    t_map = time.time() - t0
    order = routing_order(job["harnesses"])
    targets = set(job.get("targets") or [h["id"] for h in order])
    last = max((k for k, h in enumerate(order) if h["id"] in targets), default=-1)
    out.mkdir(parents=True, exist_ok=True)
    results, context = [], []
    for h in order[: last + 1]:
        try:
            route, t_search = route_one(h, om)
            entry = {"id": h["id"], "path": h["path"], "status": "ok" if not route["notes"] else "warning", "notes": route["notes"], "search_s": round(t_search, 2)}
            if h["id"] in targets:
                (out / f"{h['id']}.route.json").write_text(json.dumps(route, separators=(",", ":")) + "\n")
        except Exception as e:  # noqa: BLE001
            entry = {"id": h["id"], "path": h["path"], "status": "failed", "notes": [f"{type(e).__name__}: {e}"]}
        (results if h["id"] in targets else context).append(entry)
        print(f"  {entry['path']}: {entry['status']} {entry.get('notes', '')}{'' if h['id'] in targets else ' (routed before a target, not written)'}", file=sys.stderr, flush=True)
    return {"tool": TOOL, "map": {"shape": om.shape, "res_mm": om.res, "seconds": round(t_map, 1)}, "harnesses": results, "context": context}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    step_ok = "--no-step" not in sys.argv
    if args and args[0] == "route":
        print(json.dumps(route_job(json.loads(Path(args[1]).read_text()), Path(args[2]))))
    elif args and args[0] == "export":
        out = Path(args[1])
        results = []
        for f in args[2:]:
            route = json.loads(Path(f).read_text())
            try:
                results.append(export_route(route, out, step_ok))
            except Exception as e:  # noqa: BLE001
                results.append({"id": route["harness"]["id"], "path": route["harness"]["path"], "status": "failed", "notes": [f"{type(e).__name__}: {e}"]})
        print(json.dumps({"tool": TOOL, "harnesses": results}))
    else:
        # route and export every harness of the job into one folder
        job, out = json.loads(Path(args[0]).read_text()), Path(args[1])
        routed = route_job(job, out)
        results = []
        for r in routed["harnesses"]:
            f = out / f"{r['id']}.route.json"
            if r["status"] == "failed":
                results.append(r)
                continue
            try:
                results.append({**export_route(json.loads(f.read_text()), out, step_ok), "search_s": r.get("search_s")})
            except Exception as e:  # noqa: BLE001
                results.append({**r, "status": "failed", "notes": [*r["notes"], f"{type(e).__name__}: {e}"]})
            f.unlink()
        print(json.dumps({**routed, "harnesses": results}))


if __name__ == "__main__":
    main()
