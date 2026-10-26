"""enclosure-cad: an enclosure generated from what it holds (build123d).

    python enclosure_cad.py build <job.json> <out_dir> [--root <project root>]
    python enclosure_cad.py fit <fit.json | ->

The job (lib/job.ts) is everything the generator needs and nothing about
UHD: the bodies that go inside, placed in the enclosure's coordinates (mm,
Z up) as GLB files with a 4x4 matrix each; the features the enclosure must
provide (openings, button plungers, windows, light pipes, insert bosses,
seal glands, threads, strap lugs, the lid joint), each with its frame or
the frame of the part it serves; and the design values from the module's
cad.config.ts (process, material, wall, clearances, split plane, fasteners).

The cavity is the bounding box (or cylinder) of the contents plus the
clearance, unless the config fixes it. The shell is cut at the split plane
into a base and a lid; button plungers are separate printed parts, made
last so their flanges can be trimmed to clear the walls and what is inside.
Every feature is applied to every part its tool reaches; a cut through a
side wall is checked part by part across the wall (wall_bands), and a sliver
it would leave at the joint inside the wall is cut away with it.

`build` writes into <out_dir>:
  parts/<part>.step|.glb|.stl|.3mf   one printed part each
  body.step, body.glb                every part, plus one named sub-shape
                                     per feature (named by its interface id)
  body.manifest.json                 UHD geometry manifest: feature
                                     signatures, volumes, frames
  section.svg                        a section through the cavity centre
  report.json                        cavity, parts, feature frames and facts
                                     (recess, gap, squeeze, ledges, walls),
                                     problems, and the fit analysis (bodies
                                     inside, and the plungers)
and prints the report summary as one JSON line. (The provider moves
report.json next to the job, out of the build cache.)

`fit` runs only the fit analysis (fit.py) on parts already built and the
bodies a check names, and prints the result: the check uses it when what
goes inside has changed since the enclosure was generated.

Outputs are deterministic for a fixed job and build123d version.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
from pathlib import Path

import build123d as bd
import numpy as np
from build123d import (
    ExportDXF,
    Unit,
    Align,
    Axis,
    Box,
    BuildLine,
    BuildPart,
    BuildSketch,
    Circle,
    Compound,
    Cylinder,
    Face,
    Helix,
    Location,
    Mesher,
    Plane,
    Polyline,
    Pos,
    Rot,
    Rectangle,
    RectangleRounded,
    Shape,
    Solid,
    Vector,
    export_gltf,
    export_step,
    export_stl,
    make_face,
    offset,
    revolve,
    sweep,
)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fit import analyse, analyse_plungers, load_mesh, sample_surface  # noqa: E402

GENERATOR = Path(__file__)
FIXED_TIME = "2000-01-01T00:00:00"
TOOL = "build123d"
MIN = (Align.CENTER, Align.CENTER, Align.MIN)


# ---------------------------------------------------------------------------------------------
# Small geometry helpers
# ---------------------------------------------------------------------------------------------


def unit(v) -> np.ndarray:
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def basis(normal, x_axis=None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Orthonormal x, y, z (= normal). Without an xAxis, x is horizontal (or +X for a vertical normal)."""
    z = unit(normal)
    if x_axis is not None:
        x = np.asarray(x_axis, dtype=float)
    elif abs(z[2]) > 0.9:
        x = np.array([1.0, 0.0, 0.0])
    else:
        x = np.cross([0.0, 0.0, 1.0], z)
    x = unit(x - z * np.dot(x, z))
    return x, np.cross(z, x), z


def plane_at(origin, normal, x_axis=None) -> Plane:
    x, _, z = basis(normal, x_axis)
    return Plane(origin=Vector(*map(float, origin)), x_dir=Vector(*x), z_dir=Vector(*z))


def r3(v) -> list[float]:
    return [round(float(x), 3) + 0.0 for x in v]


def frame_of(origin, normal, x_axis=None) -> dict:
    x, _, z = basis(normal, x_axis)
    return {"origin": r3(origin), "normal": r3(z), "xAxis": r3(x)}


def prism(pl: Plane, sketch_face: Face, z0: float, z1: float) -> Solid:
    """Extrude a face drawn in the plane's local XY from local z0 to z1."""
    f = sketch_face.moved(Location((0, 0, z0)))
    s = Solid.extrude(f, Vector(0, 0, z1 - z0))
    return pl.location * s


def extrude_region(region, z0: float, dz: float) -> Shape:
    """Extrude a planar region (a face, or several) drawn at z = 0 from z0 by dz."""
    solids = [Solid.extrude(f.moved(Location((0, 0, z0))), Vector(0, 0, dz)) for f in region.faces()]
    out = solids[0]
    for s in solids[1:]:
        out = out + s
    return out


def section_face(shape: str, width: float, height: float, radius: float = 0.0) -> Face:
    if shape == "round":
        return Circle(width / 2).face()
    if radius > 1e-6 and radius * 2 < min(width, height):
        return RectangleRounded(width, height, radius).face()
    return Rectangle(width, height).face()


def signature(faces: list[Face]) -> dict:
    """Area, area-weighted centroid and, when every face is planar and parallel, the shared normal."""
    area = sum(f.area for f in faces)
    c = [sum(getattr(f.center(bd.CenterOf.MASS), k) * f.area for f in faces) / area for k in "XYZ"]
    sig = {"area_mm2": round(area, 3), "centroid": [round(v, 3) + 0.0 for v in c], "faces": len(faces)}
    normals = set()
    for f in faces:
        if f.geom_type != bd.GeomType.PLANE:
            return sig
        n = f.normal_at()
        normals.add((round(n.X, 3) + 0.0, round(n.Y, 3) + 0.0, round(n.Z, 3) + 0.0))
    if len(normals) == 1:
        sig["normal"] = list(normals.pop())
    return sig


def faces_on(part: Shape, tool: Shape, tol: float = 1e-3) -> list[Face]:
    """Faces of `part` lying on the skin of `tool` (the faces a cut or an added solid made)."""
    skin = Compound(tool.faces())
    bb = tool.bounding_box()
    out = []
    for f in part.faces():
        fb = f.bounding_box()
        if fb.min.X > bb.max.X + tol or fb.max.X < bb.min.X - tol or fb.min.Y > bb.max.Y + tol or fb.max.Y < bb.min.Y - tol or fb.min.Z > bb.max.Z + tol or fb.max.Z < bb.min.Z - tol:
            continue
        vs, _ = f.tessellate(0.2)
        pts = vs[:: max(1, len(vs) // 10)]
        if all(skin.distance_to(p) < tol for p in pts):
            out.append(f)
    return out


def feature_shape(name: str, faces: list[Face], pad: float = 0.2) -> Compound | None:
    """A thin named solid over a feature's faces: its sub-shape in body.step and node in body.glb."""
    solids = []
    for f in faces:
        try:
            solids.append(Solid.extrude(f, f.normal_at() * pad) if f.geom_type == bd.GeomType.PLANE else Solid.thicken(f, pad))
        except Exception:  # noqa: BLE001 - a face the kernel cannot thicken is left out of the marker
            continue
    return Compound(label=name, children=solids) if solids else None


# ---------------------------------------------------------------------------------------------
# The enclosure
# ---------------------------------------------------------------------------------------------


class Enclosure:
    """Cavity, outline and z levels, from the contents and the design values."""

    def __init__(self, job: dict, bodies: list[dict]):
        self.job = job
        self.d = d = job["design"]
        self.problems: list[str] = []
        self.shape = d["shape"]
        self.wall = d["wall"]
        self.floor = d["floor"]
        self.lid = d["lid"]
        self.clr = d["clearance"]
        self.mw = d["min_wall"]
        feats = job["features"]
        self.joint_feature = next((f for f in feats if f["kind"] == "joint"), None)
        self.joint_gland = next((f for f in feats if f["kind"] == "seal_gland" and f["params"].get("at") == "joint" and f["params"]["type"] == "face"), None)
        self.collar_gland = next((f for f in feats if f["kind"] == "seal_gland" and f["params"].get("at") == "joint" and f["params"]["type"] == "radial"), None)
        self.twist = next((f for f in feats if f["kind"] == "twist_lid"), None)
        jd = d["joint"]
        self.joint_style = "twist" if self.twist else "flat" if self.joint_gland else jd["style"]
        if self.twist and self.joint_gland:
            self.problems.append(f"{self.joint_gland['id']}: a twist lid seals on its collar: make the joint gland radial (SealGland type radial, at joint)")
        if self.collar_gland and not self.twist:
            self.problems.append(f"{self.collar_gland['id']}: a radial gland at the joint seals a twist lid's collar; the module has no TwistLid")
        self.lip = jd["lip_height"]
        self.jc = jd["clearance"]
        # rabbet: the base's tongue inside, the lid's skirt outside it, the joint clearance between; tongue and skirt get the same width
        self.w_out = (self.wall + self.jc) / 2

        verts = [b["V"] for b in bodies if len(b["V"])]
        if not verts and not d.get("cavity"):
            raise SystemExit("nothing to enclose: no body inside has geometry, and the config fixes no cavity")
        allv = np.concatenate(verts) if verts else np.zeros((0, 3))
        self.contents_lo = allv.min(axis=0) if len(allv) else None
        self.contents_hi = allv.max(axis=0) if len(allv) else None

        fixed = d.get("cavity")
        if self.shape == "round":
            if fixed:
                self.centre = np.array(fixed["centre"], dtype=float)
                self.r_cav = float(fixed["radius"])
                z0, z1 = fixed["z"]
            else:
                self.centre = (self.contents_lo[:2] + self.contents_hi[:2]) / 2
                self.r_cav = float(np.max(np.hypot(allv[:, 0] - self.centre[0], allv[:, 1] - self.centre[1]))) + self.clr
                z0, z1 = self.contents_lo[2] - self.clr, self.contents_hi[2] + d["clearance_top"]
            self.cav_min = np.array([self.centre[0] - self.r_cav, self.centre[1] - self.r_cav, z0])
            self.cav_max = np.array([self.centre[0] + self.r_cav, self.centre[1] + self.r_cav, z1])
        else:
            if fixed:
                self.cav_min = np.array(fixed["min"], dtype=float)
                self.cav_max = np.array(fixed["max"], dtype=float)
            else:
                self.cav_min = self.contents_lo - self.clr
                self.cav_max = self.contents_hi + np.array([self.clr, self.clr, d["clearance_top"]])
            self.centre = (self.cav_min[:2] + self.cav_max[:2]) / 2

        # the floor must leave room below every insert boss for its insert hole and a skin
        for f in feats:
            if f["kind"] == "boss":
                p = f["params"]
                top = f["frame"]["origin"][2]
                need = top - max(0.0, p["insert"]["hole_depth_mm"] + self.mw - self.floor)
                if need < self.cav_min[2]:
                    if fixed:
                        self.problems.append(f"{f['id']}: the fixed cavity floor at z {self.cav_min[2]:.2f} leaves no room under the boss for its insert hole ({p['insert']['hole_depth_mm']} mm)")
                    else:
                        self.cav_min[2] = need
                if top < self.cav_min[2] - 1e-6:
                    self.problems.append(f"{f['id']}: boss top z {top:.2f} is below the cavity floor z {self.cav_min[2]:.2f}")
        self.z_floor = float(self.cav_min[2])
        self.z_bottom = self.z_floor - self.floor
        self.z_cav_top = float(self.cav_max[2])
        self.z_top = self.z_cav_top + self.lid
        split = d.get("split_z")
        if split is None:
            split = self.z_cav_top if self.joint_style in ("flat", "twist") else self.z_cav_top - self.lip
        self.z_split = float(split)
        if not (self.z_floor < self.z_split <= self.z_cav_top + 1e-6):
            self.problems.append(f"split plane z {self.z_split:.2f} is outside the cavity ({self.z_floor:.2f} to {self.z_cav_top:.2f})")

        # lid screws: columns at the cavity corners (box) or around it (round)
        self.scheme = d["fasteners"]
        self.columns: list[np.ndarray] = []
        self.rc = 0.0
        if self.scheme == "screws":
            jf = self.joint_feature
            if not jf or "insert" not in jf["params"] or "screw" not in jf["params"]:
                raise SystemExit('fasteners "screws" needs a joint feature stating its screw and insert (enclosure_feature kind "joint")')
            ins = jf["params"]["insert"]
            self.rc = ins["hole_d_mm"] / 2 + max(ins.get("min_wall_mm", 0.0), self.mw)
            self.columns = self.column_centres(jf["params"].get("count", 4))
        self.cw = self.mw  # wall around a column where it bulges out of the shell
        self.tw = self.plan_twist() if self.twist else None

    def plan_twist(self) -> dict | None:
        """A twist lid's collar: radii and levels (TwistLid). Everything is measured from the outer radius in.

        The lid's skirt keeps the shell's outside diameter; its wall behind the lock is at least the
        minimum wall. The skirt's bore is the sealing surface of the collar's O-ring (a radial gland,
        Parker's static table: gland depth from the bore to the groove's bottom) and passes over the
        collar's lock as it goes on. Bottom to top the collar holds: a ledge, the O-ring groove, a
        ledge, the lock (the thread's turns, or the bayonet's lugs at the top).
        """
        if self.shape != "round":
            self.problems.append(f"{self.twist['id']}: a twist lid needs a round enclosure (design shape round)")
            return None
        p = self.twist["params"]
        lock = p["lock"]
        mw = self.mw
        r_o = self.r_cav + self.wall
        clr = p.get("clearance_mm", 0.2)
        ax = p.get("axial_clearance_mm", 0.15)
        g = self.collar_gland["params"] if self.collar_gland else None
        row = g["table"] if g else None
        L = (row["depth_mm"][0] + row["depth_mm"][1]) / 2 if row else 0.0
        G = (row["width_mm"][0] + row["width_mm"][1]) / 2 if row else 0.0
        E = ((row.get("clearance_mm") or [0.05, 0.13])[0] + (row.get("clearance_mm") or [0.05, 0.13])[1]) / 4 if row else 0.05  # radial: half the diametral clearance
        # a printed bore comes out undersize: the drawn bore is this much larger (radial), so the bore as
        # printed lands on Parker's clearance and the groove's depth is measured from that printed bore
        a = p.get("bore_allowance_mm", 0.0)
        t: dict = {"lock": lock, "r_o": r_o, "clr": clr, "ax": ax, "L": L, "G": G, "gap": E, "a": a}
        if lock == "thread":
            P = p.get("pitch_mm", 2.0)
            d = p.get("depth_mm", round(0.45 * P, 3))
            flank = math.radians(p.get("flank_angle_deg", 30.0))
            turns = p.get("turns", 2.0)
            skirt = max(mw, 1.2)
            r_b = r_o - skirt  # the skirt's bore as drawn: the lid thread's root and the seal's bore
            t.update({"P": P, "d": d, "flank": flank, "turns": turns, "r_b": r_b, "r_bp": r_b - a, "r_c": r_b - a - E, "r_major": r_b - a - clr, "r_root": r_b - a - clr - d, "r_crest": r_b - d, "skirt": skirt})
            lock_h = turns * P + P
            t["base_wall_lock"] = t["r_root"] - self.r_cav
        else:
            d = p.get("lug_depth_mm", 1.0)
            h = p.get("lug_height_mm", 2.0)
            n = int(p.get("lugs", 3))
            w = p.get("lug_width_mm", 6.0)
            kw = p.get("key_lug_width_mm")
            twist = p.get("twist_deg", 30.0)
            r_c = r_o - mw - d - clr  # the slot's floor leaves the minimum wall in the skirt
            # the first lug (on +Y) may be wider, a key: its slot is the only one it enters, so the lid goes on one way
            widths = [kw if kw else w] + [w] * (n - 1)
            angles = [90.0 + 360.0 * k / n for k in range(n)]
            t.update({"d": d, "h_lug": h, "n": n, "w": w, "widths": widths, "angles": angles, "twist": twist, "r_c": r_c, "r_bp": r_c + E, "r_b": r_c + E + a, "skirt": r_o - (r_c + E + a), "skirt_behind_slot": r_o - (r_c + d + clr)})
            t["positions"] = bayonet_positions(angles, widths, clr, r_c)
            tid = self.twist["id"]
            if kw and kw <= w + 2 * clr + 1e-6:
                self.problems.append(f"{tid}: the key lug ({kw} mm) must be wider than a slot for the others ({w} mm + 2 x {clr} mm clearance), or it enters any slot")
            if t["positions"] > 1 and p.get("orientation", "keyed") != "any":
                self.problems.append(f"{tid}: the lid goes on in {t['positions']} positions {360 / t['positions']:g}° apart, so what is in the lid may not stand over what it serves; key it (key_lug_width_mm wider than lug_width_mm + 2 x clearance), or say orientation \"any\"")
            # neighbouring slots (each entry plus its run along the twist) keep the minimum wall between them
            r_slot = r_c + d + clr
            for i in range(n):
                j = (i + 1) % n
                c_ang = math.degrees(clr / r_c)
                end_i = angles[i] + math.degrees(widths[i] / r_c) / 2 + c_ang
                start_j = angles[j] + (360.0 if j == 0 else 0.0) - twist - math.degrees(widths[j] / r_c) / 2 - c_ang
                web = math.radians(start_j - end_i) * r_slot
                if web < mw - 1e-6:
                    self.problems.append(f"{tid}: the slots for lugs {i + 1} and {j + 1} leave {web:.2f} mm of skirt between them, under the {mw} mm minimum; fewer or narrower lugs, or a smaller twist")
            lock_h = 2 * ax + mw + d + h
            t["base_wall_lock"] = r_c - self.r_cav
        t["r_g"] = t["r_bp"] - L if g else None
        # levels, bottom to top. Thread: the groove under the thread (the lid's smooth skirt passes over
        # the thread to it, and its thread never crosses the groove). Bayonet: the lugs low, the groove
        # above them (the slots run up the skirt's lower part only; the bore above them is whole).
        seal_h = (mw + G + mw) if g else 0.0
        t["h"] = round(seal_h + lock_h + (ax if lock == "bayonet" else 0.0), 3)
        z0 = t["z0"] = self.z_cav_top - t["h"]
        if lock == "thread":
            t["zg"] = (z0 + mw, z0 + mw + G) if g else None
            t["zl"] = (z0 + seal_h, self.z_cav_top)
        else:
            zl0 = z0 + 2 * ax + mw  # the skirt's holding face needs a minimum wall under the slot
            zl1 = zl0 + t["d"] + t["h_lug"]
            t["zl"] = (zl0, zl1)
            t["zg"] = (zl1 + ax + mw, zl1 + ax + mw + G) if g else None
        if t["z0"] < self.z_floor + mw:
            self.problems.append(f"{self.twist['id']}: the collar ({t['h']:.2f} mm: the O-ring groove and the lock) reaches below the cavity floor; raise the cavity top")
        if g and t["r_g"] - self.r_cav < mw - 1e-6:
            self.problems.append(f"{self.collar_gland['id']}: the groove leaves {t['r_g'] - self.r_cav:.2f} mm of wall to the cavity, under the {mw} mm minimum; a thicker wall or a smaller cavity")
        return t

    def column_centres(self, count: int) -> list[np.ndarray]:
        rc, clr = self.rc, self.clr
        if self.shape == "round":
            reach = self.r_cav + (self.gland_reach() if self.joint_gland else 0.0)
            r = reach + rc
            return [self.centre + r * np.array([math.cos(a), math.sin(a)]) for a in [math.pi / 4 + 2 * math.pi * k / count for k in range(count)]]
        lo = self.contents_lo[:2] if self.contents_lo is not None else self.cav_min[:2]
        hi = self.contents_hi[:2] if self.contents_hi is not None else self.cav_max[:2]
        if self.joint_gland:
            # outside the groove ring: the cavity corner plus the gland's reach and a wall, along the diagonal
            k = (self.gland_reach() + self.mw + rc) / math.sqrt(2)
            lo, hi = self.cav_min[:2], self.cav_max[:2]
        else:
            k = (rc + clr) / math.sqrt(2)
        corners = [(lo[0] - k, lo[1] - k), (hi[0] + k, lo[1] - k), (hi[0] + k, hi[1] + k), (lo[0] - k, hi[1] + k)]
        if count != 4:
            self.problems.append(f"{count} lid screws: this provider places 4 (one per corner)")
        return [np.array(c) for c in corners]

    def gland_reach(self) -> float:
        """Distance from the cavity edge to the outer edge of the joint groove."""
        g = self.joint_gland["params"]
        return g["_inner_offset"] + g["_groove_width"]

    # ---- 2D outlines (XY) ----
    def cavity_face(self, grow: float = 0.0) -> Face:
        if self.shape == "round":
            return Pos(*self.centre) * Circle(self.r_cav + grow).face()
        w, h = (self.cav_max[:2] - self.cav_min[:2]) + 2 * grow
        r = grow if grow > 0 else 0.0
        return Pos(*self.centre) * section_face("box", w, h, r)

    def outer_face(self, inset: float = 0.0) -> Face:
        """The shell outline (cavity + wall, joined with the columns' bosses), inset by `inset`."""
        base = self.cavity_face(self.wall - inset)
        cols = [Pos(*c) * Circle(self.rc + self.cw - inset).face() for c in self.columns if self.rc + self.cw - inset > 0]
        f = base
        for c in cols:
            f = f + c
        return f.faces()[0] if len(f.faces()) == 1 else f

    def cavity_region(self) -> Face:
        f = self.cavity_face()
        for c in self.columns:
            f = f - Pos(*c) * Circle(self.rc).face()
        return f

    def outer_bounds(self) -> tuple[np.ndarray, np.ndarray]:
        lo = np.array([*(self.cav_min[:2] - self.wall), self.z_bottom])
        hi = np.array([*(self.cav_max[:2] + self.wall), self.z_top])
        return lo, hi

    def wall_bands(self) -> list[dict]:
        """Bands across a side wall (depth from the outer surface) and the z span each part holds in each.

        A flat joint is one band split at the split plane. A rabbet is three: the
        lid's skirt on the outside, the joint clearance, and the base's tongue on
        the inside (the lid sits over the tongue, clear of it by the joint
        clearance). Bands inside the wall are hidden once the case is closed.
        """
        zb, zs, zt = self.z_bottom, self.z_split, self.z_top
        if self.joint_style != "rabbet":
            return [{"band": "wall", "depth": (0.0, self.wall), "hidden": False, "parts": {"base": (zb, zs), "lid": (zs, zt)}}]
        skirt = self.w_out - self.jc
        over = zs + self.lip + self.jc
        return [
            {"band": "lid skirt", "depth": (0.0, skirt), "hidden": False, "parts": {"base": (zb, zs), "lid": (zs, zt)}},
            {"band": "joint clearance", "depth": (skirt, self.w_out), "hidden": True, "parts": {"base": (zb, zs), "lid": (over, zt)}},
            {"band": "tongue", "depth": (self.w_out, self.wall), "hidden": True, "parts": {"base": (zb, zs + self.lip), "lid": (over, zt)}},
        ]

    def wall_hit(self, origin, normal) -> tuple[np.ndarray | None, float, str]:
        """Where a ray from `origin` along `normal` leaves the shell, the wall thickness there, and which wall."""
        o = np.asarray(origin, dtype=float)
        n = unit(normal)
        if abs(n[2]) > math.cos(math.radians(10)):
            z = self.z_top if n[2] > 0 else self.z_bottom
            t = (z - o[2]) / n[2]
            return o + t * n, (self.lid if n[2] > 0 else self.floor), ("top" if n[2] > 0 else "bottom")
        if abs(n[2]) > math.sin(math.radians(10)):
            return None, 0.0, "a wall at an angle (this provider cuts openings square to a wall)"
        if self.shape == "round":
            c = np.array([*self.centre, o[2]])
            r = self.r_cav + self.wall
            d = o - c
            b = np.dot(d[:2], n[:2])
            cc = np.dot(d[:2], d[:2]) - r * r
            disc = b * b - cc * np.dot(n[:2], n[:2])
            if disc < 0:
                return None, 0.0, "outside the case"
            t = (-b + math.sqrt(disc)) / np.dot(n[:2], n[:2])
            return o + t * n, self.wall, "side"
        a = int(np.argmax(np.abs(n[:2])))
        if abs(n[a]) < math.cos(math.radians(10)):
            return None, 0.0, "a corner (the normal is not square to a side wall)"
        lo, hi = self.outer_bounds()
        plane = hi[a] if n[a] > 0 else lo[a]
        t = (plane - o[a]) / n[a]
        return o + t * n, self.wall, ("+x", "+y")[a] if n[a] > 0 else ("-x", "-y")[a]


# ---------------------------------------------------------------------------------------------
# Features
# ---------------------------------------------------------------------------------------------


class Built:
    def __init__(self):
        self.cuts: list[tuple[str, Shape]] = []  # (feature id, tool) cut from every part
        self.adds: list[tuple[str, Shape]] = []  # (feature id, solid) added to the base
        self.lid_adds: list[tuple[str, Shape]] = []  # (feature id, solid) added to the lid
        self.base_steps: list[tuple[str, Shape]] = []  # (feature id, tool) cut from the base before anything is added (a twist lid's collar)
        self.base_cuts: list[tuple[str, Shape]] = []  # (feature id, tool) cut from the base only (a twist lid's O-ring groove)
        self.lid_cuts: list[tuple[str, Shape]] = []  # (feature id, tool) cut from the lid only (a twist lid's slots)
        self.covers: dict[str, dict] = {}  # window feature id -> its cover, in the cover's own frame (not part of the case body)
        self.marks: dict[str, list[tuple[str, Shape]]] = {}  # feature id -> (part, skin tool) for its signature faces
        self.extra_parts: dict[str, Shape] = {}
        self.frames: dict[str, dict] = {}
        self.facts: dict[str, dict] = {}
        self.walls: list[dict] = []
        self.problems: list[str] = []
        self.zones: dict[str, list[dict]] = {}
        self.plungers: dict[str, dict] = {}  # feature id -> what make_plunger needs
        self.solids: list[dict] = []  # solids standing in the cavity (bosses, columns, gland bosses), for the exact fit


def served_axis(f: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray | None]:
    s = f.get("served") or {}
    fr = s.get("frame") or f.get("frame")
    if not fr:
        raise ValueError(f"{f['id']}: no frame and nothing it serves")
    return np.asarray(fr["origin"], dtype=float), unit(fr["normal"]), (np.asarray(fr["xAxis"], dtype=float) if fr.get("xAxis") else None)


def wall_feature(e: Enclosure, b: Built, f: dict) -> tuple[Plane, float, float] | None:
    """Plane on the outer wall where the feature's axis leaves the shell, the wall there, and the recess of what it serves."""
    o, n, x = served_axis(f)
    hit, wall, where = e.wall_hit(o, n)
    if hit is None:
        b.problems.append(f"{f['id']}: its axis meets {where}")
        return None
    pl = plane_at(hit, n, x)
    xa = np.array([pl.x_dir.X, pl.x_dir.Y, pl.x_dir.Z])
    b.frames[f["id"]] = frame_of(hit, n, xa)
    recess = float(np.dot(hit - o, n))
    return pl, wall, recess


def through(e: Enclosure, pl: Plane, half: float) -> float:
    """How far past the wall (measured on the feature's axis) a cut must reach to clear the cavity
    everywhere across its half-width: on a round shell's side wall the cavity face curves away from
    the axis, by r - sqrt(r^2 - half^2) at the cut's edge."""
    n = np.array([pl.z_dir.X, pl.z_dir.Y, pl.z_dir.Z])
    if e.shape != "round" or abs(n[2]) > 0.5 or half >= e.r_cav:
        return 0.2
    return 0.2 + e.r_cav - math.sqrt(e.r_cav * e.r_cav - half * half)


def edge_margins(e: Enclosure, b: Built, f: dict, pl: Plane, width: float, height: float, what: str, depth: tuple[float, float] | None = None, corner: float = 0.0) -> dict:
    """What each part keeps above and below a cut through a side wall, band by band across the wall (exact).

    `depth` is how far into the wall the cut reaches from the outer surface
    (default: through it); `corner` the radius of the cut's top and bottom
    corners. A sliver thinner than the minimum wall that the cut leaves at the
    joint inside the wall (on the rabbet's tongue, or the lid over it) is cut
    away with it: the other part closes the gap there, and nothing shows from
    outside. Anything else thinner than the minimum (on the outer face, at the
    top or bottom of the case) is reported as a wall.
    """
    o = np.array([pl.origin.X, pl.origin.Y, pl.origin.Z])
    n = np.array([pl.z_dir.X, pl.z_dir.Y, pl.z_dir.Z])
    if abs(n[2]) > 0.5:
        return {}
    x = np.array([pl.x_dir.X, pl.x_dir.Y, pl.x_dir.Z])
    y = np.array([pl.y_dir.X, pl.y_dir.Y, pl.y_dir.Z])
    half_z = abs(x[2]) * width / 2 + abs(y[2]) * height / 2
    h = unit(np.cross([0.0, 0.0, 1.0], n))
    half_h = abs(np.dot(x, h)) * width / 2 + abs(np.dot(y, h)) * height / 2
    lo_c, hi_c = o[2] - half_z, o[2] + half_z
    d0, d1 = depth if depth is not None else (0.0, e.wall)
    edges = (e.z_top, e.z_bottom)
    keep: dict[tuple[str, str], tuple[float, str]] = {}
    cleared = []
    for band in e.wall_bands():
        b0, b1 = band["depth"]
        if d1 <= b0 + 1e-9 or d0 >= b1 - 1e-9:
            continue  # the cut does not reach this band
        for part, (plo, phi) in band["parts"].items():
            if hi_c <= plo + 1e-9 or lo_c >= phi - 1e-9:
                continue  # the cut misses this part in this band
            for side, left, edge in (("above", phi - hi_c, phi), ("below", lo_c - plo, plo)):
                if left <= 1e-6:
                    continue
                at_joint = all(abs(edge - z) > 1e-6 for z in edges)
                if left < e.mw and at_joint and band["hidden"]:
                    z0, z1 = (hi_c - corner, phi + 0.01) if side == "above" else (plo - 0.01, lo_c + corner)
                    side_plane = Plane(origin=Vector(*o), x_dir=Vector(*h), z_dir=Vector(*n))
                    face = Pos(0, (z0 + z1) / 2 - o[2]) * Rectangle(2 * half_h, z1 - z0)
                    b.cuts.append((f["id"], prism(side_plane, face.face(), -(min(b1, d1) + 0.01), -(max(b0, d0) - 0.01))))
                    cleared.append({"part": part, "band": band["band"], "side": side, "mm": round(left, 3)})
                    continue
                k = (part, side)
                if k not in keep or left < keep[k][0]:
                    keep[k] = (left, band["band"])
    margins: dict[str, dict] = {}
    for (part, side), (left, band) in sorted(keep.items()):
        margins.setdefault(part, {})[side] = round(left, 3)
        b.walls.append({"feature": f["id"], "what": f"{part} {side} the {what} ({band})", "mm": round(left, 3), "min_mm": e.mw})
    if cleared:
        margins["cleared"] = cleared
    return margins


def side_half(pl: Plane, width: float, height: float) -> float:
    """Half the extent of a width x height cut across the horizontal of the wall it passes through (the
    direction a round cavity's inner face curves away in), for `through`."""
    n = np.array([pl.z_dir.X, pl.z_dir.Y, pl.z_dir.Z])
    if abs(n[2]) > 0.5:
        return max(width, height) / 2
    x = np.array([pl.x_dir.X, pl.x_dir.Y, pl.x_dir.Z])
    y = np.array([pl.y_dir.X, pl.y_dir.Y, pl.y_dir.Z])
    h = unit(np.cross([0.0, 0.0, 1.0], n))
    return abs(np.dot(x, h)) * width / 2 + abs(np.dot(y, h)) * height / 2


def opening(e: Enclosure, b: Built, f: dict) -> None:
    p = f["params"]
    w = wall_feature(e, b, f)
    if not w:
        return
    pl, wall, recess = w
    shape = p.get("shape", "rect")
    width = p["diameter_mm"] if shape == "round" else p["width_mm"]
    height = p["diameter_mm"] if shape == "round" else p["height_mm"]
    corner = width / 2 if shape == "round" else p.get("corner_radius_mm", 0.0)
    tool = prism(pl, section_face(shape, width, height, p.get("corner_radius_mm", 0.0)), -(wall + through(e, pl, side_half(pl, width, height))), 1.0)
    b.cuts.append((f["id"], tool))
    b.marks[f["id"]] = [("*", tool)]
    b.facts[f["id"]] = {"kind": "opening", "size_mm": [width, height], "recess_mm": round(recess, 3), "wall_mm": wall, "margins_mm": edge_margins(e, b, f, pl, width, height, "opening", corner=corner)}
    if p.get("plug"):
        fit = plug_fit(e, pl, width, height, p["plug"])
        if p.get("seat") == "flat" and fit.get("seat_gap_mm", 0.0) > 0.0:
            seat_pad(e, b, f, pl, p["plug"], fit)
        b.facts[f["id"]]["plug"] = fit


SEAT_MARGIN_MM = 0.3  # the flat seat stands this far beyond the overmold on each side


def seat_pad(e: Enclosure, b: Built, f: dict, pl: Plane, plug: dict, fit: dict) -> None:
    """A flat seat for a plug's overmold on a round wall: material added outside the wall up to the plane
    through the opening's outermost point, over the overmold's face plus a margin, within the case's height.
    The plug then bears on a flat face, and nothing stands proud of that plane (the case's extent along the
    plug axis is unchanged). The part above the split goes to the lid, the rest to the base."""
    ow, oh = plug["overmold_width_mm"] + 2 * SEAT_MARGIN_MM, plug["overmold_height_mm"] + 2 * SEAT_MARGIN_MM
    depth = fit["seat_gap_mm"] + 0.3  # from the plane into the wall, past where the curve leaves it
    pad = prism(pl, Rectangle(ow, oh).face(), -depth, 0.0)
    lo, hi = e.outer_bounds()
    span = float(np.max(hi[:2] - lo[:2])) + 20
    slab = lambda z0, z1: Pos(*e.centre, z0) * Box(span, span, z1 - z0, align=MIN)  # noqa: E731
    pad = pad & slab(e.z_bottom, e.z_top)
    cavity = extrude_region(e.cavity_region(), e.z_floor - 1, e.z_cav_top - e.z_floor + 2)
    pad = pad - cavity
    below, above = pad & slab(e.z_bottom - 1, e.z_split), pad & slab(e.z_split, e.z_top + 1)
    if below is not None and below.volume > 1e-6:
        b.adds.append((f["id"], below))
    if above is not None and above.volume > 1e-6:
        b.lid_adds.append((f["id"], above))
    fit["seat"] = {"kind": "flat", "width_mm": round(ow, 3), "height_mm": round(oh, 3), "proud_mm": fit["seat_gap_mm"]}
    fit["seat_gap_mm"] = 0.0


def plug_fit(e: Enclosure, pl: Plane, width: float, height: float, plug: dict) -> dict:
    """Whether the plug a socket opening takes passes through it, and how its overmold seats on the outer face.

    The overmold butts the wall around the opening, so the face must be flat
    under it: on a box, within the flat side and clear of the screw columns'
    bulges (seat_mm, the least margin; negative where it overhangs); on a round
    case, the gap the curve leaves under the overmold's ends (seat_gap_mm).
    """
    out = {"name": plug.get("name"), "passes": width >= plug["plug_width_mm"] - 1e-6 and height >= plug["plug_thickness_mm"] - 1e-6, "plug_mm": [plug["plug_width_mm"], plug["plug_thickness_mm"]]}
    o = np.array([pl.origin.X, pl.origin.Y, pl.origin.Z])
    n = np.array([pl.z_dir.X, pl.z_dir.Y, pl.z_dir.Z])
    if abs(n[2]) > 0.5:
        return out
    x = np.array([pl.x_dir.X, pl.x_dir.Y, pl.x_dir.Z])
    ow, oh = plug["overmold_width_mm"], plug["overmold_height_mm"]
    # the overmold's width lies along the opening's width
    half_h = (abs(x[2]) * oh + (1 - abs(x[2])) * ow) / 2
    half_z = (abs(x[2]) * ow + (1 - abs(x[2])) * oh) / 2
    margins = []
    # past the case's front or back face the overmold overhangs an edge into air: reported, not a seat fault
    out["edge_overhang_mm"] = round(max(0.0, -min(o[2] - half_z - e.z_bottom, e.z_top - (o[2] + half_z))), 3)
    if e.shape == "round":
        r = e.r_cav + e.wall
        out["seat_gap_mm"] = round(r - math.sqrt(max(r * r - half_h * half_h, 0.0)), 3)
    else:
        a = int(np.argmax(np.abs(n[:2])))
        lat = 1 - a
        c = o[lat]
        margins += [c - half_h - e.cav_min[lat], e.cav_max[lat] - (c + half_h)]
        rr = e.rc + e.cw
        for col in e.columns:
            d = (col[a] - o[a]) * math.copysign(1.0, n[a])  # how far the column's centre stands out of the face
            if d <= -rr:
                continue
            # the lateral span over which its bulge stands out of the face
            span = rr if d >= 0 else math.sqrt(rr * rr - d * d)
            margins.append(max(col[lat] - span - (c + half_h), (c - half_h) - (col[lat] + span)))
    out["overmold_mm"] = [ow, oh]
    if margins:
        out["seat_mm"] = round(min(margins), 3)
    return out


def light_pipe(e: Enclosure, b: Built, f: dict) -> None:
    p = f["params"]
    w = wall_feature(e, b, f)
    if not w:
        return
    pl, wall, recess = w
    d = p["diameter_mm"] + 2 * p.get("clearance_mm", 0.1)
    tool = prism(pl, Circle(d / 2).face(), -(wall + through(e, pl, d / 2)), 1.0)
    b.cuts.append((f["id"], tool))
    b.marks[f["id"]] = [("*", tool)]
    b.facts[f["id"]] = {"kind": "light_pipe", "hole_d_mm": round(d, 3), "recess_mm": round(recess, 3), "wall_mm": wall, "margins_mm": edge_margins(e, b, f, pl, d, d, "light pipe hole", corner=d / 2)}


def window(e: Enclosure, b: Built, f: dict) -> None:
    p = f["params"]
    w = wall_feature(e, b, f)
    if not w:
        return
    pl, wall, recess = w
    ap, cv = p["aperture"], p["cover"]
    shape = "round" if "diameter_mm" in ap else "rect"
    aw, ah = (ap["diameter_mm"],) * 2 if shape == "round" else (ap["width_mm"], ap["height_mm"])
    c = p.get("clearance_mm", 0.1)
    cw, ch = (cv["diameter_mm"] + 2 * c,) * 2 if shape == "round" else (cv["width_mm"] + 2 * c, cv["height_mm"] + 2 * c)
    t = cv["thickness_mm"]
    r = p.get("corner_radius_mm", 0.0)
    aperture = prism(pl, section_face(shape, aw, ah, r), -(wall + through(e, pl, max(aw, ah) / 2)), 1.0)
    side = p.get("side", "outside")
    z0, z1 = (-t, 1.0) if side == "outside" else (-(wall + through(e, pl, max(cw, ch) / 2)), -(wall - t))
    pocket = prism(pl, section_face(shape, cw, ch, r + c if r else 0.0), z0, z1)
    b.cuts += [(f["id"], aperture), (f["id"], pocket)]
    b.marks[f["id"]] = [("*", pocket)]
    ledge = min(cw - aw, ch - ah) / 2
    corner_a, corner_c = (aw / 2, cw / 2) if shape == "round" else (r, r + c if r else 0.0)
    edge_margins(e, b, f, pl, aw, ah, "aperture", corner=corner_a)
    edge_margins(e, b, f, pl, cw, ch, "cover pocket", depth=(0.0, t) if side == "outside" else (wall - t, wall), corner=corner_c)
    b.facts[f["id"]] = {"kind": "window", "aperture_mm": [aw, ah], "pocket_mm": [round(cw, 3), round(ch, 3)], "pocket_depth_mm": t, "side": side, "ledge_mm": round(ledge, 3), "recess_mm": round(recess, 3), "wall_mm": wall}
    # the cover itself, in its own frame: its outer face at z 0, its body behind it along +z (into the case), x
    # along the window's x. The frame mates flush with the window's frame (the outer surface). An inside cover is
    # not drawn: what holds it is the project's. Nor is a cover whose material is "none…": the pocket is only a
    # counterbore (a plug's overmold seats in it) and nothing is fitted.
    if side == "outside" and not str(cv.get("material") or "").lower().startswith("none"):
        cr = r if shape != "round" else 0.0
        outline = section_face(shape, cv["diameter_mm"] if shape == "round" else cv["width_mm"], cv["diameter_mm"] if shape == "round" else cv["height_mm"], cr)
        b.covers[f["id"]] = {"solid": Solid.extrude(outline, Vector(0, 0, t)), "placed": prism(pl, outline, -t, 0.0), "outline": outline, "material": cv.get("material"), "thickness_mm": t, "size_mm": [cv["diameter_mm"]] if shape == "round" else [cv["width_mm"], cv["height_mm"]], "shape": shape}
    b.walls.append({"feature": f["id"], "what": "ledge holding the cover", "mm": round(ledge, 3), "min_mm": e.mw})
    b.walls.append({"feature": f["id"], "what": "wall left under the cover pocket", "mm": round(wall - t, 3), "min_mm": e.mw})


def button(e: Enclosure, b: Built, f: dict) -> None:
    p = f["params"]
    w = wall_feature(e, b, f)
    if not w:
        return
    pl, wall, recess = w
    hole = p["hole_d_mm"]
    shaft = hole - 2 * p.get("clearance_mm", 0.15)
    gap = p.get("gap_mm", 0.1)
    out = p.get("protrude_mm", 1.0)
    fd, ft = p.get("flange_d_mm", hole + 2.0), p.get("flange_mm", 0.8)
    bore = prism(pl, Circle(hole / 2).face(), -(wall + through(e, pl, hole / 2)), 1.0)
    margins = edge_margins(e, b, f, pl, hole, hole, "plunger bore", corner=hole / 2)
    b.cuts.append((f["id"], bore))
    b.marks[f["id"]] = [("*", bore)]
    tip = -(recess - gap)
    room = recess - gap - wall - ft
    if room < 0.1:
        b.problems.append(f"{f['id']}: {recess:.2f} mm from the outer wall to the actuator leaves no room for a {ft} mm plunger flange behind a {wall} mm wall")
    # the plunger is made once the walls are built: its flange is trimmed to clear them and what is inside
    b.plungers[f["id"]] = {"plane": pl, "shaft": shaft, "hole": hole, "tip": tip, "out": out, "flange_d": fd, "flange": (-(wall + 0.1 + ft), -(wall + 0.1)), "gap": gap}
    n = np.array([pl.z_dir.X, pl.z_dir.Y, pl.z_dir.Z])
    tip_pt = np.array([pl.origin.X, pl.origin.Y, pl.origin.Z]) + n * tip
    b.facts[f["id"]] = {
        "kind": "button",
        "hole_d_mm": hole,
        "shaft_d_mm": round(shaft, 3),
        "plunger": f"plunger_{f['id']}",
        "tip": r3(tip_pt),
        "gap_mm": gap,
        "travel_mm": p.get("travel_mm"),
        "length_mm": round(out - tip, 3),
        "recess_mm": round(recess, 3),
        "wall_mm": wall,
        "margins_mm": margins,
    }


# the plunger flange must overlap the wall around the bore by this much over at least half its edge, or the
# plunger can tilt out through the bore (assumption: about one 0.4 mm extrusion plus the shaft clearance)
FLANGE_HOLD_MM = 0.5
FLANGE_HOLD_FRACTION = 0.5


def clip_polygon(poly: np.ndarray, axis: int, bound: float, keep_below: bool) -> np.ndarray:
    """Sutherland-Hodgman: the part of a convex polygon on one side of an axis-aligned plane."""
    if not len(poly):
        return poly
    out = []
    for i in range(len(poly)):
        a, c = poly[i], poly[(i + 1) % len(poly)]
        ina = a[axis] <= bound if keep_below else a[axis] >= bound
        inc = c[axis] <= bound if keep_below else c[axis] >= bound
        if ina:
            out.append(a)
        if ina != inc:
            t = (bound - a[axis]) / (c[axis] - a[axis])
            out.append(a + t * (c - a))
    return np.array(out)


def points_near(V: np.ndarray, F: np.ndarray, pl: Plane, reach: float, z0: float, z1: float, step: float) -> np.ndarray:
    """Surface points of a mesh within `reach` of the plane's axis and between local z0 and z1, in the plane's local coordinates."""
    if not len(F):
        return np.zeros((0, 3))
    o = np.array([pl.origin.X, pl.origin.Y, pl.origin.Z])
    R = np.array([[pl.x_dir.X, pl.x_dir.Y, pl.x_dir.Z], [pl.y_dir.X, pl.y_dir.Y, pl.y_dir.Z], [pl.z_dir.X, pl.z_dir.Y, pl.z_dir.Z]])
    tri = ((V - o) @ R.T)[F]
    lo, hi = tri.min(axis=1), tri.max(axis=1)
    sel = (lo[:, 0] <= reach) & (hi[:, 0] >= -reach) & (lo[:, 1] <= reach) & (hi[:, 1] >= -reach) & (lo[:, 2] <= z1) & (hi[:, 2] >= z0)
    out = []
    for t in tri[sel]:
        poly = t
        for axis, bound, below in ((0, reach, True), (0, -reach, False), (1, reach, True), (1, -reach, False), (2, z1, True), (2, z0, False)):
            poly = clip_polygon(poly, axis, bound, below)
        if len(poly) == 0:
            continue
        if len(poly) < 3:
            out.append(poly)
            continue
        fan = np.array([[0, i, i + 1] for i in range(1, len(poly) - 1)])
        out.append(sample_surface(poly, fan, step))
    return np.concatenate(out) if out else np.zeros((0, 3))


def flange_outline(obstacles: list[tuple[str, np.ndarray, float]], slab: tuple[float, float], clearance: float, r_max: float, count: int = 120) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Largest radius the flange may have at each angle and stay `clearance` clear of every obstacle point.

    obstacles: (name, local points, normal margin): a point counts when it lies
    within the margin of the flange's slab along the axis; its in-plane
    allowance shrinks with that distance (a sphere of the clearance). Returns
    the angles, the radius at each (taking the least of each angle and its two
    neighbours, so the polygon's edges stay clear too) and what limited it.
    """
    ang = np.arange(count) * 2 * math.pi / count
    r = np.full(count, r_max)
    who = np.full(count, -1)
    names = []
    for k, (name, pts, margin) in enumerate(obstacles):
        names.append(name)
        if not len(pts):
            continue
        dn = np.maximum(slab[0] - pts[:, 2], pts[:, 2] - slab[1])
        dn = np.maximum(dn, 0.0)
        ok = dn <= margin + 1e-9
        pts, dn = pts[ok], dn[ok]
        if not len(pts):
            continue
        ci = np.sqrt(np.maximum(clearance**2 - dn**2, 0.0)) if margin > 0 else np.full(len(pts), clearance)
        # where the ray at each angle first comes within the allowance of each point: projected along it, less the half-chord
        u = np.stack([np.cos(ang), np.sin(ang)], axis=1)
        rh = np.full(count, np.inf)
        for i in range(0, len(pts), 20000):
            q, cq = pts[i : i + 20000, :2], ci[i : i + 20000]
            along = u @ q.T
            perp2 = np.maximum((q * q).sum(axis=1)[None, :] - along**2, 0.0)
            hit = (along > 0) & (perp2 < cq[None, :] ** 2)
            rh = np.minimum(rh, np.where(hit, along - np.sqrt(np.maximum(cq[None, :] ** 2 - perp2, 0.0)), np.inf).min(axis=1))
        better = rh < r
        r = np.where(better, rh, r)
        who = np.where(better, k, who)
    r = np.minimum.reduce([r, np.roll(r, 1), np.roll(r, -1)])
    limited = sorted({names[k] for k in who if k >= 0})
    return ang, r, limited


def make_plunger(e: Enclosure, b: Built, fid: str, spec: dict, walls: dict[str, tuple[np.ndarray, np.ndarray]], bodies: list[dict]) -> Shape:
    """A plunger: the shaft from the tip to outside the wall, and a flange behind the wall trimmed to clear the walls and what is inside."""
    pl = spec["plane"]
    z0, z1 = spec["flange"]
    shaft_r = spec["shaft"] / 2
    r_max = spec["flange_d"] / 2
    step = 0.1
    # obstacle surfaces are sampled `step` apart, so the flange keeps half a step more than the clearance from each sample
    c = e.clr + step / 2
    reach = r_max + c + 0.1
    # walls count only across the flange's own thickness (the wall it sits behind is parallel to it); bodies inside within the clearance of it
    obstacles = [(k, points_near(v, f, pl, reach, z0, z1, step), 0.0) for k, (v, f) in sorted(walls.items())]
    obstacles += [(body["key"], points_near(body["V"], body["F"], pl, reach, z0 - c, z1 + c, step), c) for body in bodies]
    ang, r, limited = flange_outline(obstacles, (z0, z1), c, r_max)
    hole_r = spec["hole"] / 2
    held = float(np.mean(r - hole_r >= FLANGE_HOLD_MM - 1e-9))
    if limited:
        rr = np.maximum(r, shaft_r)
        pts = [Vector(float(R * math.cos(a)), float(R * math.sin(a)), 0.0) for a, R in zip(ang, rr)]
        face = Face(bd.Wire.make_polygon(pts, close=True))
        # the polygon's chords cut a hair inside the shaft's circle where the flange is trimmed to it
        joined = (face + Circle(shaft_r).face()).faces()
        face = joined[0] if len(joined) == 1 else face
    else:
        face = Circle(r_max).face()
    shaft_solid = prism(pl, Circle(shaft_r).face(), spec["tip"], spec["out"])
    flange = prism(pl, face, z0, z1)
    plunger = shaft_solid + flange
    b.facts[fid].update(
        {
            "flange_d_mm": round(2 * r_max, 3),
            "flange_trimmed_by": limited,
            "flange_overlap_mm": [round(float(np.min(r - hole_r)), 3), round(float(np.max(r - hole_r)), 3)],
            "flange_hold_pct": round(100 * held, 1),
            "flange_hold_rule": {"overlap_mm": FLANGE_HOLD_MM, "pct": 100 * FLANGE_HOLD_FRACTION},
        }
    )
    return plunger


def boss(e: Enclosure, b: Built, f: dict) -> None:
    p = f["params"]
    ins = p["insert"]
    fr = f["frame"]
    top = fr["origin"][2]
    if abs(unit(fr["normal"])[2] - 1) > 1e-6:
        b.problems.append(f"{f['id']}: a boss frame must face +Z (bosses stand on the floor)")
        return
    od = ins["hole_d_mm"] + 2 * max(ins.get("min_wall_mm", 0.0), e.mw)
    od = max(od, p.get("boss_d_mm", 0.0))
    solids, holes = [], []
    for hx, hy in p["holes"]:
        solids.append(Pos(hx, hy, e.z_floor - 0.01) * Cylinder(od / 2, top - e.z_floor + 0.01, align=MIN))
        holes.append(Pos(hx, hy, top - ins["hole_depth_mm"]) * Cylinder(ins["hole_d_mm"] / 2, ins["hole_depth_mm"] + 0.01, align=MIN))
    for s in solids:
        b.adds.append((f["id"], s))
    for hx, hy in p["holes"]:
        b.solids.append({"name": f"boss {f['id']}", "part": "base", "origin": [hx, hy, e.z_floor], "axis": [0.0, 0.0, 1.0], "radius": od / 2, "length": top - e.z_floor})
    for h in holes:
        b.cuts.append((f["id"], h))
    tops = [Pos(hx, hy, top - 0.05) * Cylinder(od / 2 + 1e-3, 0.05, align=MIN) for hx, hy in p["holes"]]
    b.marks[f["id"]] = [("base", t) for t in tops]
    b.frames[f["id"]] = frame_of(fr["origin"], fr["normal"], fr.get("xAxis"))
    b.facts[f["id"]] = {"kind": "boss", "boss_d_mm": round(od, 3), "top_z": top, "height_mm": round(top - e.z_floor, 3), "insert": ins, "holes": p["holes"]}
    b.walls.append({"feature": f["id"], "what": "boss wall around the insert", "mm": round((od - ins["hole_d_mm"]) / 2, 3), "min_mm": max(ins.get("min_wall_mm", 0.0), e.mw)})
    b.walls.append({"feature": f["id"], "what": "floor skin under the insert hole", "mm": round(top - ins["hole_depth_mm"] - e.z_bottom, 3), "min_mm": e.mw})
    for key in f.get("mates", []):
        b.zones.setdefault(key, []).extend({"centre": [hx, hy], "radius": od / 2 + e.clr + 0.5, "z": [top - 1.0, top + 1.0]} for hx, hy in p["holes"])


def strap_lugs(e: Enclosure, b: Built, f: dict) -> None:
    p = f["params"]
    sgn = 1.0 if p["end"] == "+y" else -1.0
    s = p["strap_width_mm"]
    lw = p.get("lug_width_mm", p["hole_depth_mm"] + e.mw + 0.2)
    bar_r = p["bar_d_mm"] / 2
    edge = p.get("edge_mm", 1.0)
    gap = p.get("strap_gap_mm", 2.0)
    lh = p.get("lug_height_mm", min(4.0, e.z_split - e.z_bottom))
    z0 = e.z_bottom
    zc = z0 + lh / 2
    cx, cy = e.centre
    xs = [(cx + s / 2, cx + s / 2 + lw), (cx - s / 2 - lw, cx - s / 2)]
    if e.shape == "round":
        r_out = e.r_cav + e.wall
        far = max(abs(xs[0][1] - cx), abs(xs[1][0] - cx))
        if far >= r_out:
            b.problems.append(f"{f['id']}: lugs {s} mm apart do not fit on a Ø{2 * r_out:.1f} mm case")
            return
        # lugs grow out of the case where they stand; the strap between them clears the case at its centre line
        y_start = math.sqrt(r_out**2 - far**2) - 0.5
        reach = r_out
    else:
        lo, hi = e.outer_bounds()
        reach = (hi[1] - cy) if sgn > 0 else (cy - lo[1])
        y_start = reach - 0.5
    y_bar = reach + gap + bar_r
    y_end = y_bar + bar_r + edge
    for x0, x1 in xs:
        b.adds.append((f["id"], Pos((x0 + x1) / 2, cy + sgn * (y_start + y_end) / 2, z0) * Box(x1 - x0, y_end - y_start, lh, align=MIN)))
    hd, hdep = p["hole_d_mm"], p["hole_depth_mm"]
    holes = []
    for x_face, dirn in ((xs[0][0], 1.0), (xs[1][1], -1.0)):
        pl = Plane(origin=Vector(x_face, cy + sgn * y_bar, zc), x_dir=Vector(0, 1, 0), z_dir=Vector(dirn, 0, 0))
        holes.append(prism(pl, Circle(hd / 2).face(), -0.01, hdep))
    for h in holes:
        b.cuts.append((f["id"], h))
    b.marks[f["id"]] = [("base", h) for h in holes]
    b.frames[f["id"]] = frame_of([cx, cy + sgn * y_bar, zc], [0, sgn, 0], [1, 0, 0])
    b.facts[f["id"]] = {"kind": "strap_lugs", "lug_gap_mm": s, "bar_axis": r3([cx, cy + sgn * y_bar, zc]), "hole_d_mm": hd, "hole_depth_mm": hdep, "bar_to_case_mm": round(gap, 3)}
    b.walls.append({"feature": f["id"], "what": "lug wall beyond the spring-bar hole", "mm": round(lw - hdep, 3), "min_mm": e.mw})
    b.walls.append({"feature": f["id"], "what": "lug edge beyond the spring-bar hole", "mm": round(y_end - y_bar - hd / 2, 3), "min_mm": e.mw})


def thread(e: Enclosure, b: Built, f: dict) -> None:
    """Internal thread in a skirt under the floor (a cap screwing onto a neck)."""
    p = f["params"]
    if e.shape != "round":
        b.problems.append(f"{f['id']}: threads need a round enclosure (design shape round)")
        return
    T, E, P = p["major_d_mm"], p["root_d_mm"], p["pitch_mm"]
    L = p["length_mm"]
    clr = p.get("clearance_mm", 0.3)
    r_root = T / 2 + clr
    r_crest = E / 2 + clr
    h = r_root - r_crest
    skirt = p.get("skirt_wall_mm", e.wall)
    cx, cy = e.centre
    z_open = e.z_bottom - L
    ring = Pos(cx, cy, z_open) * (Cylinder(r_root + skirt, L + 0.01, align=MIN) - Cylinder(r_root, L + 0.01, align=MIN))
    b.adds.append((f["id"], ring))
    crest_w = p.get("crest_width_mm", 0.25 * P)
    flank = math.radians(p.get("flank_angle_deg", 30.0))
    base_w = crest_w + 2 * h * math.tan(flank)
    if base_w >= P:
        b.problems.append(f"{f['id']}: a {h:.2f} mm deep thread with {crest_w} mm crests and {math.degrees(flank):.0f}° flanks is wider ({base_w:.2f} mm) than its {P} mm pitch")
        return
    start, end = 0.6 + base_w / 2, L - 0.6 - base_w / 2
    if end - start < P:
        b.problems.append(f"{f['id']}: {L} mm of skirt holds less than one turn of a {P} mm pitch thread")
        return
    helix = Helix(pitch=P, height=end - start, radius=r_root)
    with BuildSketch(Plane.XZ) as sk:
        with BuildLine():
            Polyline([(r_root + 0.2, -base_w / 2), (r_crest, -crest_w / 2), (r_crest, crest_w / 2), (r_root + 0.2, base_w / 2)], close=True)
        make_face()
    ridge = sweep(sk.sketch.faces()[0], path=helix, is_frenet=True)
    ridge = Pos(cx, cy, z_open + start) * ridge
    b.adds.append((f["id"], ridge))
    b.marks[f["id"]] = [("base", ridge)]
    b.frames[f["id"]] = frame_of([cx, cy, z_open], [0, 0, -1], [1, 0, 0])
    b.facts[f["id"]] = {"kind": "thread", "major_d_mm": round(2 * r_root, 3), "minor_d_mm": round(2 * r_crest, 3), "pitch_mm": P, "turns": round((end - start) / P, 2), "skirt_length_mm": L, "depth_mm": round(h, 3)}
    b.walls.append({"feature": f["id"], "what": "skirt wall behind the thread root", "mm": skirt, "min_mm": e.mw})


def seal_gland(e: Enclosure, b: Built, f: dict) -> None:
    p = f["params"]
    o = p["oring"]
    row = p["table"]
    L = (row["depth_mm"][0] + row["depth_mm"][1]) / 2
    G = (row["width_mm"][0] + row["width_mm"][1]) / 2
    W = o["w_mm"]
    fact = {"kind": "seal_gland", "type": p["type"], "oring": o["size"], "w_mm": W, "groove_depth_mm": round(L, 3), "groove_width_mm": round(G, 3), "table": row["source"]}
    if p["type"] == "radial" and p.get("at") == "joint":
        t = e.tw
        if not t:
            b.problems.append(f"{f['id']}: a radial gland at the joint seals a twist lid's collar; the module has none")
            return
        z0, z1 = t["zg"]
        groove = annulus(t["r_g"], t["r_c"] + 0.01, z0, z1, e.centre)
        b.base_cuts.append((f["id"], groove))
        b.marks[f["id"]] = [("base", groove)]
        b.frames[f["id"]] = frame_of([*e.centre, (z0 + z1) / 2], [0, 0, 1], [1, 0, 0])
        o = p["oring"]
        seat = 2 * t["r_g"]
        fact.update({"at": "joint", "seat_d_mm": round(seat, 3), "bore_d_mm": round(2 * t["r_b"], 3), "printed_bore_d_mm": round(2 * t["r_bp"], 3), "bore_allowance_mm": t["a"], "collar_d_mm": round(2 * t["r_c"], 3), "groove_d_mm": round(seat, 3), "groove_z_mm": [round(z0, 3), round(z1, 3)], "gland_depth_mm": round(t["L"], 3), "gap_mm": 0.0, "rod_offset_mm": round(t["r_bp"] - t["r_c"], 4), "gap_basis": "the lid skirt's bore is the sealing surface; the collar can sit off centre in it by the radial clearance" + (f"; the bore is drawn {t['a']:g} mm (radial) over the size it is meant to print at, and the groove's depth is from the printed bore" if t["a"] else ""), "stretch_pct": round((seat / o["id_mm"] - 1) * 100, 2)})
        b.walls.append({"feature": f["id"], "what": "base wall behind the collar's O-ring groove", "mm": round(t["r_g"] - e.r_cav, 3), "min_mm": e.mw})
        b.facts[f["id"]] = fact
        return
    if p["type"] == "radial":
        fr = f["frame"]
        if not fr:
            b.problems.append(f"{f['id']}: a radial gland needs a frame (bore axis)")
            return
        rod = p["rod_d_mm"]
        clr = (row["clearance_mm"][0] + row["clearance_mm"][1]) / 2
        bore_d = rod + clr
        groove_d = rod + 2 * L
        pl = plane_at(fr["origin"], fr["normal"], fr.get("xAxis"))
        o3, n3 = np.asarray(fr["origin"], dtype=float), unit(fr["normal"])
        hit, wall, _ = e.wall_hit(o3 - n3 * 50, n3)
        if hit is None or np.linalg.norm(hit - o3) > 0.05:
            b.problems.append(f"{f['id']}: a radial gland's frame must sit on the outer surface where the bore enters (it is {'off the shell' if hit is None else f'{np.linalg.norm(hit - o3):.2f} mm from it'})")
            return
        length = G + 2 * max(e.mw, 1.0)
        boss_d = groove_d + 2 * max(e.mw, 1.2)
        need = length - wall
        if need > 0:
            b.adds.append((f["id"], prism(pl, Circle(boss_d / 2).face(), -(wall + need), -wall + 0.01)))
            b.solids.append({"name": f"gland boss {f['id']}", "part": "base", "origin": r3(o3 - n3 * (wall + need)), "axis": r3(n3), "radius": boss_d / 2, "length": need})
        depth = max(length, wall)
        b.cuts.append((f["id"], prism(pl, Circle(bore_d / 2).face(), -(depth + 0.01), 1.0)))
        gz = -depth / 2
        groove = prism(pl, Circle(groove_d / 2).face(), gz - G / 2, gz + G / 2)
        b.cuts.append((f["id"], groove))
        b.marks[f["id"]] = [("*", groove)]
        b.frames[f["id"]] = frame_of(fr["origin"], fr["normal"], fr.get("xAxis"))
        # the rod is the sealing surface; it can sit off centre in the bore by the radial clearance, which moves the gland depth by as much
        fact.update({"rod_d_mm": rod, "bore_d_mm": round(bore_d, 3), "groove_d_mm": round(groove_d, 3), "gland_depth_mm": round(L, 3), "gap_mm": 0.0, "rod_offset_mm": round((bore_d - rod) / 2, 4), "gap_basis": "the rod is the sealing surface, off centre by up to the radial clearance"})
        b.walls.append({"feature": f["id"], "what": "wall around the gland groove", "mm": round((boss_d - groove_d) / 2 if need > 0 else e.wall, 3), "min_mm": e.mw})
        b.facts[f["id"]] = fact
        return

    # face glands: in the base rim at the joint, or a ring at a frame
    ext = p.get("pressure", "external") == "external"
    if p.get("at") == "joint":
        inner_off = p["_inner_offset"]
        z = e.z_split
        groove = extrude_region(e.cavity_face(inner_off + G), z - L, L + 0.01) - extrude_region(e.cavity_face(inner_off), z - L - 0.01, L + 0.03)
        inner_perimeter = sum(ed.length for ed in e.cavity_face(inner_off).outer_wire().edges())
        b.walls.append({"feature": f["id"], "what": "rim ledge inside the groove", "mm": round(inner_off, 3), "min_mm": e.mw})
        b.walls.append({"feature": f["id"], "what": "rim ledge outside the groove", "mm": round(e.wall - inner_off - G, 3), "min_mm": e.mw})
        b.frames[f["id"]] = frame_of([*e.centre, z], [0, 0, 1], [1, 0, 0])
        # the joint is flat: the lid's face bears on the rim around the groove when its screws close it
        fact["gap_basis"] = "contact: the lid's flat face bears on the rim (the lid screws close the joint)" if e.scheme == "screws" else "assumed contact: nothing in the design holds the lid down on the rim"
        fact["gap_assumed"] = e.scheme != "screws"
    else:
        fr = f["frame"]
        pl = plane_at(fr["origin"], fr["normal"], fr.get("xAxis"))
        # external pressure: groove inner edge on the O-ring ID (+0.5 %); internal: groove outer edge on its OD (-0.5 %)
        r_in = o["id_mm"] * 1.005 / 2 if ext else (o["id_mm"] + 2 * W) * 0.995 / 2 - G
        groove = prism(pl, Circle(r_in + G).face(), -L, 0.01) - prism(pl, Circle(r_in).face(), -L - 0.01, 0.02)
        inner_perimeter = 2 * math.pi * r_in
        b.frames[f["id"]] = frame_of(fr["origin"], fr["normal"], fr.get("xAxis"))
        fact["gap_basis"] = "assumed contact: the mating face bears on the gland's face (what presses it, such as a thread's engagement, is not modelled)"
        fact["gap_assumed"] = True
    b.cuts.append((f["id"], groove))
    b.marks[f["id"]] = [("*", groove)]
    groove_outer = inner_perimeter + 2 * math.pi * G
    fact.update(
        {
            "gland_depth_mm": round(L, 3),
            "gap_mm": 0.0,
            "groove_inner_perimeter_mm": round(inner_perimeter, 2),
            "groove_outer_perimeter_mm": round(groove_outer, 2),
            "oring_inner_perimeter_mm": round(math.pi * o["id_mm"], 2),
            "oring_outer_perimeter_mm": round(math.pi * (o["id_mm"] + 2 * W), 2),
            "pressure": "external" if ext else "internal",
        }
    )
    b.facts[f["id"]] = fact


def joint(e: Enclosure, b: Built, f: dict) -> None:
    b.frames[f["id"]] = frame_of([*e.centre, e.z_split], [0, 0, 1], [1, 0, 0])
    # the mating face: base faces in the split plane (the bottom of this slab)
    b.marks[f["id"]] = [("base", Pos(*e.centre, e.z_split) * Box(4 * (e.cav_max[0] - e.cav_min[0] + 40), 4 * (e.cav_max[1] - e.cav_min[1] + 40), 0.04, align=MIN))]
    fact = {"kind": "joint", "style": e.joint_style, "split_z": round(e.z_split, 3), "scheme": e.scheme}
    if e.columns:
        p = f["params"]
        ins, sc = p["insert"], p["screw"]
        grip = e.z_top - e.z_cav_top + (e.jc if e.joint_style == "rabbet" else 0.0)
        fact.update({"columns": [r3([c[0], c[1], e.z_cav_top]) for c in e.columns], "column_d_mm": round(2 * e.rc, 3), "grip_mm": round(grip, 3), "insert": ins, "screw": sc})
        b.walls.append({"feature": f["id"], "what": "column wall around the insert", "mm": round(e.rc - ins["hole_d_mm"] / 2, 3), "min_mm": max(ins.get("min_wall_mm", 0.0), e.mw)})
        if sc.get("length_mm") is not None:
            fact["screw_reach_mm"] = round(sc["length_mm"] - grip, 3)
            if sc["length_mm"] - grip > ins["hole_depth_mm"]:
                b.problems.append(f"{f['id']}: a {sc['length_mm']} mm screw through {grip:.2f} mm of lid reaches {sc['length_mm'] - grip:.2f} mm, deeper than the {ins['hole_depth_mm']} mm insert hole (it bottoms out)")
    b.facts[f["id"]] = fact


def annulus(r_in: float, r_out: float, z0: float, z1: float, centre) -> Shape:
    """A ring about the enclosure's axis from z0 to z1."""
    cx, cy = centre
    ring = Cylinder(r_out, z1 - z0, align=MIN)
    if r_in > 0:
        ring = ring - Cylinder(r_in, z1 - z0 + 0.02, align=MIN).moved(Location((0, 0, -0.01)))
    return Pos(cx, cy, z0) * ring


def revolved(points: list[tuple[float, float]], start_deg: float, arc_deg: float, centre) -> Shape:
    """A closed (r, z) profile turned about the enclosure's axis from start_deg through arc_deg."""
    with BuildSketch(Plane.XZ) as sk:
        with BuildLine():
            Polyline(points, close=True)
        make_face()
    solid = revolve(sk.sketch.faces()[0], Axis.Z, arc_deg)
    return Pos(centre[0], centre[1], 0) * (Rot(0, 0, start_deg) * solid)


def bayonet_positions(angles: list[float], widths: list[float], clr: float, r: float) -> int:
    """In how many turned positions a bayonet's lid goes on: each lug must meet a slot wide enough for it
    (a slot is its lug's width plus the clearance each side). Lugs at angles (deg) on the collar's radius r."""
    n = len(angles)
    count = 0
    for j in range(n):
        turn = angles[j] - angles[0]
        ok = True
        for i in range(n):
            at = (angles[i] + turn) % 360.0
            k = next((k for k in range(n) if abs(((angles[k] - at + 180.0) % 360.0) - 180.0) < 1e-6), None)
            if k is None or widths[i] > widths[k] + 2 * clr + 1e-6:
                ok = False
                break
        count += ok
    return count


def twist_lid(e: Enclosure, b: Built, f: dict) -> None:
    """The base's collar and the lid's skirt (Enclosure.plan_twist), with the lock: a thread or a bayonet."""
    t = e.tw
    if not t:
        return
    cx, cy = e.centre
    z0, top = t["z0"], e.z_cav_top
    # the base steps in to the collar; the lid's skirt fills the step down to the axial clearance
    b.base_steps.append((f["id"], annulus(t["r_c"], t["r_o"] + 1.0, z0, top + 0.01, e.centre)))
    skirt = annulus(t["r_b"], t["r_o"], z0 + t["ax"], top + 0.01, e.centre)
    b.lid_adds.append((f["id"], skirt))
    # a lead-in on the skirt's bore so it rides over the O-ring instead of shearing it (about 20°, Parker ORD 5700 §4.3)
    lead = [(t["r_b"] - 0.01, z0 + t["ax"] - 0.01), (t["r_b"] + 0.35, z0 + t["ax"] - 0.01), (t["r_b"] - 0.01, z0 + t["ax"] + 1.0)]
    b.lid_cuts.append((f["id"], revolved(lead, 0.0, 360.0, e.centre)))
    fact = {
        "kind": "twist_lid",
        "lock": t["lock"],
        "collar_d_mm": round(2 * t["r_c"], 3),
        "bore_d_mm": round(2 * t["r_b"], 3),
        "outer_d_mm": round(2 * t["r_o"], 3),
        "collar_z_mm": [round(z0, 3), round(top, 3)],
        "skirt_wall_mm": round(t["r_o"] - t["r_b"], 3),
        "lead_in": "0.35 mm over 1.0 mm on the skirt's bore (about 19°)",
        "base_wall_at_lock_mm": round(t["base_wall_lock"], 3),
        "printed_bore_d_mm": round(2 * t["r_bp"], 3),
        "bore_allowance_mm": t["a"],
        "seal_fit_mm": round(2 * (t["r_bp"] - t["r_c"]), 3),
        "radial_clearance_mm": t["clr"],
        "axial_clearance_mm": t["ax"],
        "print": {
            "base": "upright, its floor on the bed: the collar's lock faces lean 45° or steeper outward, so they print without supports",
            "lid": "upside down, its top on the bed: the skirt stands up, and its slot or thread faces lean 45° or steeper, so they print without supports",
        },
    }
    zl0, zl1 = t["zl"]
    if t["lock"] == "thread":
        P, d, turns = t["P"], t["d"], t["turns"]
        crest_w = 0.25 * P
        base_w = crest_w + 2 * d * math.tan(t["flank"])
        if base_w >= P:
            b.problems.append(f"{f['id']}: a {d} mm deep thread with {math.degrees(t['flank']):.0f}° flanks is wider ({base_w:.2f} mm) than its {P} mm pitch")
            return
        height = turns * P
        z_start = zl0 + base_w / 2

        def ridge(r_from: float, r_to: float, dz: float) -> Shape:
            helix = Helix(pitch=P, height=height, radius=r_from)
            with BuildSketch(Plane.XZ) as sk:
                with BuildLine():
                    Polyline([(r_from - math.copysign(0.2, r_to - r_from), -base_w / 2), (r_to, -crest_w / 2), (r_to, crest_w / 2), (r_from - math.copysign(0.2, r_to - r_from), base_w / 2)], close=True)
                make_face()
            return Pos(cx, cy, z_start + dz) * sweep(sk.sketch.faces()[0], path=helix, is_frenet=True)

        # the base's collar steps in again to the thread's root over the thread's zone
        b.base_steps.append((f["id"], annulus(t["r_root"], t["r_c"] + 0.01, zl0, top + 0.01, e.centre)))
        base_ridge = ridge(t["r_root"], t["r_major"], 0.0)
        lid_ridge = ridge(t["r_b"], t["r_crest"], P / 2)
        b.adds.append((f["id"], base_ridge))
        b.lid_adds.append((f["id"], lid_ridge))
        b.marks[f["id"]] = [("base", base_ridge), ("lid", lid_ridge)]
        fact.update({"pitch_mm": P, "depth_mm": d, "flank_angle_deg": round(math.degrees(t["flank"]), 2), "turns": turns, "major_d_mm": round(2 * t["r_major"], 3), "root_d_mm": round(2 * t["r_root"], 3), "lid_minor_d_mm": round(2 * t["r_crest"], 3), "thread_z_mm": [round(z_start - base_w / 2, 3), round(z_start + height + base_w / 2, 3)]})
        b.walls.append({"feature": f["id"], "what": "base wall behind the thread's root", "mm": round(t["base_wall_lock"], 3), "min_mm": e.mw})
        b.walls.append({"feature": f["id"], "what": "lid skirt behind its thread", "mm": round(t["r_o"] - t["r_b"], 3), "min_mm": e.mw})
    else:
        d, h, n, twist, clr, ax = t["d"], t["h_lug"], t["n"], t["twist"], t["clr"], t["ax"]
        r_c = t["r_c"]
        c_ang = math.degrees(clr / r_c)
        # the lug: low on the collar, its underside a 45° cone (no supports printed upright)
        lug = [(r_c - 0.3, zl0), (r_c, zl0), (r_c + d, zl0 + d), (r_c + d, zl1), (r_c - 0.3, zl1)]
        # the slot in the skirt: open at the bottom where the lug enters, then along the twist; its lower
        # face parallel to the lug's underside (the face that holds the lid down), the axial clearance between
        r_slot = r_c + d + clr
        z_bottom = z0 + t["ax"] - 0.05
        entry = [(t["r_b"] - 0.5, z_bottom), (r_slot, z_bottom), (r_slot, zl1 + ax), (t["r_b"] - 0.5, zl1 + ax)]
        along = [(t["r_b"] - 0.5, zl0 - ax), (r_c, zl0 - ax), (r_slot, zl0 + d + clr - ax), (r_slot, zl1 + ax), (t["r_b"] - 0.5, zl1 + ax)]
        angles = t["angles"]  # the locked lugs' centres (first on +Y, the key when there is one)
        lugs = []
        for a, w in zip(angles, t["widths"]):
            alpha = math.degrees(w / r_c)
            s_lug = revolved(lug, a - alpha / 2, alpha, e.centre)
            b.adds.append((f["id"], s_lug))
            lugs.append(s_lug)
            b.lid_cuts.append((f["id"], revolved(entry, a - twist - alpha / 2 - c_ang, alpha + 2 * c_ang, e.centre)))
            b.lid_cuts.append((f["id"], revolved(along, a - twist - alpha / 2 - c_ang, twist + alpha + 2 * c_ang, e.centre)))
        b.marks[f["id"]] = [("base", s) for s in lugs]
        keyed = t["widths"][0] != t["w"]
        fact.update({"lugs": n, "lug_angles_deg": [round(a % 360, 3) for a in angles], "lug_width_mm": t["w"], "lug_widths_mm": t["widths"], "keyed": keyed, "lid_positions": t["positions"], "lug_depth_mm": d, "lug_height_mm": round(h + d, 3), "twist_deg": twist, "lug_z_mm": [round(zl0, 3), round(zl1, 3)], "slot_depth_mm": round(r_slot - t["r_b"], 3), "skirt_behind_slot_mm": round(t["skirt_behind_slot"], 3), "close": f"push the lid down with each lug in its slot's open end{' (the wide lug in the wide slot: it goes on one way only)' if keyed else ''}, then turn it {twist:g}° clockwise seen from above until the lugs stop at the slots' ends"})
        b.walls.append({"feature": f["id"], "what": "lid skirt behind the bayonet slots", "mm": round(t["skirt_behind_slot"], 3), "min_mm": e.mw})
        b.walls.append({"feature": f["id"], "what": "base wall of the collar", "mm": round(t["base_wall_lock"], 3), "min_mm": e.mw})
    b.frames[f["id"]] = frame_of([cx, cy, top], [0, 0, 1], [1, 0, 0])
    b.facts[f["id"]] = fact


KINDS = {"opening": opening, "light_pipe": light_pipe, "window": window, "button": button, "boss": boss, "strap_lugs": strap_lugs, "thread": thread, "seal_gland": seal_gland, "joint": joint, "twist_lid": twist_lid}


def plan_joint_gland(e_job: dict, cav_shape: str, cav_size: np.ndarray, wall: float, mw: float) -> None:
    """Where the joint groove goes: its inner edge offset from the cavity so the O-ring fits (Parker Design Chart 4-2)."""
    g = next((f for f in e_job["features"] if f["kind"] == "seal_gland" and f["params"].get("at") == "joint" and f["params"]["type"] == "face"), None)
    if not g:
        return
    p = g["params"]
    row = p["table"]
    G = (row["width_mm"][0] + row["width_mm"][1]) / 2
    o = p["oring"]
    ext = p.get("pressure", "external") == "external"
    # external pressure: groove inner edge on the O-ring ID (+0.5 %); internal: groove outer edge on its OD (-0.5 %)
    target = math.pi * o["id_mm"] * 1.005 if ext else math.pi * (o["id_mm"] + 2 * o["w_mm"]) * 0.995 - 2 * math.pi * G
    base = math.pi * cav_size[0] if cav_shape == "round" else 2 * (cav_size[0] + cav_size[1])
    off = (target - base) / (2 * math.pi)
    p["_inner_offset"] = max(off, mw)
    p["_groove_width"] = G


# ---------------------------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------------------------


def load_bodies(job: dict, root: Path) -> list[dict]:
    out = []
    for c in job["contents"]:
        v, f = load_mesh(root / c["glb"], c["matrix"], skip=c.get("skip_nodes"))
        out.append({"key": c["key"], "label": c.get("label", c["key"]), "V": v, "F": f, "zones": []})
    return out


def build(job: dict, out: Path, root: Path) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    (out / "parts").mkdir(exist_ok=True)
    bodies = load_bodies(job, root)
    d = job["design"]
    # the joint groove decides the rim and the screw columns, so it is planned from the cavity first
    probe = Enclosure({**job, "features": [f for f in job["features"] if f["kind"] != "seal_gland"], "design": {**d, "fasteners": "none"}}, bodies)
    size = (probe.cav_max - probe.cav_min)[:2] if probe.shape != "round" else np.array([2 * probe.r_cav, 2 * probe.r_cav])
    plan_joint_gland(job, probe.shape, size, d["wall"], d["min_wall"])
    e = Enclosure(job, bodies)
    b = Built()
    b.problems.extend(e.problems)
    for c in e.columns:
        b.solids.append({"name": "lid screw column", "origin": [float(c[0]), float(c[1]), e.z_floor], "axis": [0.0, 0.0, 1.0], "radius": e.rc, "length": e.z_cav_top - e.z_floor})

    # ---- shell, cut at the split plane
    outer, cavity = e.outer_face(), e.cavity_region()
    H = e.z_top - e.z_bottom + 2
    shell = extrude_region(outer, e.z_bottom, e.z_top - e.z_bottom) - extrude_region(cavity, e.z_floor, e.z_cav_top - e.z_floor)
    lo, hi = e.outer_bounds()
    span = float(np.max(hi[:2] - lo[:2])) + 4 * (e.rc + e.cw) + 20
    below = Pos(*e.centre, e.z_split - H) * Box(span, span, H, align=MIN)
    above = Pos(*e.centre, e.z_split) * Box(span, span, H, align=MIN)
    base = shell & below
    lid = shell & above
    if e.joint_style == "rabbet":
        w_out = e.w_out
        tongue = offset(outer, -w_out) - cavity
        tongue_s = extrude_region(tongue, e.z_split - 0.01, e.lip + 0.01)
        groove = offset(outer, -(w_out - e.jc)) - cavity
        groove_s = extrude_region(groove, e.z_split - 0.01, e.lip + e.jc + 0.01)
        base = base + (tongue_s & shell)
        lid = lid - groove_s
        b.walls.append({"feature": e.joint_feature["id"] if e.joint_feature else "joint", "what": "base tongue of the rabbet", "mm": round(e.wall - w_out, 3), "min_mm": e.mw})
        b.walls.append({"feature": e.joint_feature["id"] if e.joint_feature else "joint", "what": "lid skirt outside the tongue", "mm": round(w_out - e.jc, 3), "min_mm": e.mw})
    parts: dict[str, Shape] = {"base": base, "lid": lid}

    # ---- features
    for f in job["features"]:
        try:
            KINDS[f["kind"]](e, b, f)
        except Exception as ex:  # noqa: BLE001 - one feature failing is a finding, not a crash
            b.problems.append(f"{f['id']}: {type(ex).__name__}: {ex}")
    for _fid, t in b.base_steps:
        parts["base"] = parts["base"] - t
    # a twist lid turns: nothing may cut the side wall where its skirt covers the collar
    if e.tw:
        z0, z1 = e.tw["z0"], e.z_cav_top
        for fid, fr in b.frames.items():
            fact = b.facts.get(fid, {})
            if fact.get("kind") not in ("opening", "window", "button"):
                continue
            if abs(fr["normal"][2]) > 0.5:
                continue  # through the floor or the lid, not the side wall
            sizes = [v[1] for k in ("pocket_mm", "aperture_mm", "size_mm") if isinstance((v := fact.get(k)), list) and len(v) > 1]
            half = max([*(x / 2 for x in sizes), fact.get("hole_d_mm", 0) / 2, 0.0])
            lo, hi = fr["origin"][2] - half, fr["origin"][2] + half
            if hi > z0 - 1e-6 and lo < z1:
                b.problems.append(f"{fid}: it cuts the side wall at z {lo:.2f}-{hi:.2f}, where the twist lid's skirt covers the collar (from z {z0:.2f}); raise the cavity top or move it down")
    for _fid, s in b.adds:
        parts["base"] = parts["base"] + s
    for _fid, s in b.lid_adds:
        parts["lid"] = parts["lid"] + s
    # lid screws: inserts in the columns, clearance holes through the lid
    if e.columns:
        jp = e.joint_feature["params"]
        ins, sc = jp["insert"], jp["screw"]
        for c in e.columns:
            parts["base"] = parts["base"] - Pos(c[0], c[1], e.z_cav_top - ins["hole_depth_mm"]) * Cylinder(ins["hole_d_mm"] / 2, ins["hole_depth_mm"] + 0.01, align=MIN)
            parts["lid"] = parts["lid"] - Pos(c[0], c[1], e.z_split - 0.5) * Cylinder(sc["clearance_d_mm"] / 2, e.z_top - e.z_split + 1, align=MIN)
    # a face gland at a frame is cut into the surface its frame lies on
    skin = Compound(parts["base"].faces())
    for f in job["features"]:
        if f["kind"] == "seal_gland" and f["params"]["type"] == "face" and f["params"].get("at") != "joint" and f.get("frame"):
            gap = skin.distance_to(Vector(*f["frame"]["origin"]))
            if gap > 0.05:
                b.problems.append(f"{f['id']}: its frame is {gap:.2f} mm off the base's surface; a face gland's frame sits on the face the O-ring seals against")
    for _fid, t in b.cuts:
        for k in parts:
            parts[k] = parts[k] - t
    for _fid, t in b.base_cuts:
        parts["base"] = parts["base"] - t
    for _fid, t in b.lid_cuts:
        parts["lid"] = parts["lid"] - t
    # plungers: flanges trimmed to clear the walls as built and what is inside; then checked against the walls exactly
    if b.plungers:
        walls = {}
        for k in ("base", "lid"):
            if k in parts:
                vs, ts = parts[k].tessellate(0.01, 0.1)
                walls[k] = (np.array([[v.X, v.Y, v.Z] for v in vs]), np.array(ts, dtype=np.int64))
        for fid, spec in b.plungers.items():
            try:
                plunger = make_plunger(e, b, fid, spec, walls, bodies)
            except Exception as ex:  # noqa: BLE001 - one feature failing is a finding, not a crash
                b.problems.append(f"{fid}: plunger: {type(ex).__name__}: {ex}")
                continue
            overlap = {}
            for k in ("base", "lid"):
                if k in parts:
                    common = plunger & parts[k]
                    overlap[k] = round(sum(x.volume for x in common.solids()) if common is not None else 0.0, 4)
            b.facts[fid]["wall_overlap_mm3"] = overlap
            plunger.label = f"plunger_{fid}"
            b.extra_parts[f"plunger_{fid}"] = plunger
    for k, s in b.extra_parts.items():
        parts[k] = s
    for k in list(parts):
        solids = parts[k].solids()
        if not solids:
            b.problems.append(f"part {k} came out empty")
            del parts[k]
            continue
        parts[k] = Compound(label=k, children=list(solids)) if len(solids) > 1 else solids[0]
        parts[k].label = k
        if len(solids) > 1 and not k.startswith("plunger"):
            b.problems.append(f"part {k} is in {len(solids)} pieces (a feature cut it apart?)")

    # ---- feature faces (signatures) on the parts their tools reach
    features: dict[str, dict] = {}
    feature_parts: dict[str, list[str]] = {}
    shapes = []
    for fid, marks in b.marks.items():
        faces: list[Face] = []
        where: list[str] = []
        for part_name, tool in marks:
            for k, part in parts.items():
                if k.startswith("plunger") or (part_name != "*" and k != part_name):
                    continue
                hit = faces_on(part, tool)
                if hit:
                    faces += hit
                    where.append(k)
        if not faces:
            b.problems.append(f"{fid}: the feature produced no faces on any part (its tool misses the shell?)")
            continue
        features[fid] = signature(faces)
        feature_parts[fid] = sorted(set(where))
        s = feature_shape(fid, faces)
        if s is not None:
            shapes.append(s)

    # ---- write parts and the body
    files = []
    for k, part in sorted(parts.items()):
        export_step(part, str(out / "parts" / f"{k}.step"))
        normalise_step(out / "parts" / f"{k}.step")
        export_gltf(part, str(out / "parts" / f"{k}.glb"), binary=True, linear_deflection=0.02, angular_deflection=0.2)
        export_stl(part, str(out / "parts" / f"{k}.stl"), tolerance=0.01, angular_tolerance=0.1)
        m = Mesher()
        m.add_shape(part, linear_deflection=0.01, angular_deflection=0.1)
        m.write(str(out / "parts" / f"{k}.3mf"))
        repack_zip(out / "parts" / f"{k}.3mf")
        files.append(k)
    # window covers: each its own STEP, GLB and a DXF outline for cutting, in the cover's frame
    covers = {}
    if b.covers:
        (out / "covers").mkdir(exist_ok=True)
    for fid, c in sorted(b.covers.items()):
        name = f"cover_{fid}"
        solid = c["solid"]
        solid.label = name
        export_step(solid, str(out / "covers" / f"{name}.step"))
        normalise_step(out / "covers" / f"{name}.step")
        export_gltf(solid, str(out / "covers" / f"{name}.glb"), binary=True, linear_deflection=0.01, angular_deflection=0.1)
        dxf = ExportDXF(unit=Unit.MM)
        dxf.add_shape(c["outline"])
        dxf.write(str(out / "covers" / f"{name}.dxf"))
        normalise_dxf(out / "covers" / f"{name}.dxf")
        covers[fid] = {"part": name, "shape": c["shape"], "size_mm": c["size_mm"], "thickness_mm": c["thickness_mm"], "material": c["material"], "volume_mm3": round(solid.volume, 4), "frame": {"origin": [0.0, 0.0, 0.0], "normal": [0.0, 0.0, 1.0], "xAxis": [1.0, 0.0, 0.0]}}
    body = Compound(label=job["name"], children=[*(parts[k] for k in sorted(parts)), *shapes])
    export_step(body, str(out / "body.step"))
    normalise_step(out / "body.step")
    export_gltf(Compound(label=job["name"], children=[parts[k] for k in sorted(parts)]), str(out / "body.glb"), binary=True, linear_deflection=0.02, angular_deflection=0.2)
    try:
        write_section(parts, e, out / "section.svg", bodies, {f"cover_{k}": c["placed"] for k, c in b.covers.items()})
    except Exception as ex:  # noqa: BLE001 - the render is optional
        b.problems.append(f"section render skipped: {type(ex).__name__}: {ex}")

    # ---- fit: what goes inside against the walls
    for body_ in bodies:
        body_["zones"] = b.zones.get(body_["key"], [])
    wall_parts = {k: load_mesh(out / "parts" / f"{k}.glb") for k in parts if not k.startswith("plunger")}
    fit = analyse(wall_parts, bodies, cavity_spec(e, b), d["resolution"], e.clr)
    # plungers against what is inside (against the walls they are checked exactly, above)
    fit["plungers"] = analyse_plungers([plunger_spec(fid, b, out / "parts" / f"plunger_{fid}.glb", fit["resolution_mm"]) for fid in b.plungers if f"plunger_{fid}" in parts], bodies, fit["resolution_mm"], e.clr)
    for entry in fit["plungers"]:
        overlap = b.facts[entry["feature"]].get("wall_overlap_mm3", {})
        entry["wall_overlap_mm3"] = overlap
        if any(v > 1e-3 for v in overlap.values()):
            entry["status"] = "collision"

    volumes = {k: round(parts[k].volume, 3) for k in sorted(parts)}
    shell_box = Compound(children=[parts[k] for k in parts if not k.startswith("plunger")]).bounding_box()
    digest = hashlib.sha256(GENERATOR.read_bytes() + (HERE / "fit.py").read_bytes() + json.dumps(job, sort_keys=True).encode()).hexdigest()
    manifest = {
        "artifact": "body",
        "tool": TOOL,
        "toolVersion": bd.__version__,
        "generator": "@protoboardai/ext-enclosure-cad py/enclosure_cad.py",
        "sourceDigest": digest,
        "units": "mm",
        "features": features,
        "volume_mm3": round(sum(volumes.values()), 3),
        "bodies": volumes,
        "frames": b.frames,
        "process": job["process"],
        "material": job.get("material"),
    }
    (out / "body.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    report = {
        "schema": "protoboard.enclosure-cad.report/v0",
        "module": job["module"],
        "name": job["name"],
        "toolVersion": bd.__version__,
        "sourceDigest": digest,
        "inputsDigest": job["inputsDigest"],
        "cavity": cavity_spec(e, b),
        "outer": {"min": r3(e.outer_bounds()[0]), "max": r3(e.outer_bounds()[1])},
        "overall": {"min": r3([shell_box.min.X, shell_box.min.Y, shell_box.min.Z]), "max": r3([shell_box.max.X, shell_box.max.Y, shell_box.max.Z])},
        "levels": {"bottom": round(e.z_bottom, 3), "floor": round(e.z_floor, 3), "split": round(e.z_split, 3), "cavity_top": round(e.z_cav_top, 3), "top": round(e.z_top, 3)},
        "parts": {k: {"volume_mm3": volumes[k], "printed": job["process"] == "print"} for k in files},
        "features": {fid: {**b.facts.get(fid, {}), "frame": b.frames.get(fid), "parts": feature_parts.get(fid, []), "signature": features.get(fid)} for fid in sorted(set(b.facts) | set(b.frames))},
        "walls": b.walls,
        "covers": covers,
        "problems": b.problems,
        "fit": fit,
    }
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def cavity_spec(e: Enclosure, b: Built) -> dict:
    """The cavity and the solids standing in it, for the exact part of the fit analysis.

    The side walls belong to the base up to `side_top` (the split, or the top of
    a rabbet's tongue) and to the lid above it; the floor to the base, the
    ceiling to the lid.
    """
    spec = {"shape": e.shape, "min": r3(e.cav_min), "max": r3(e.cav_max)}
    if e.shape == "round":
        spec.update({"centre": r3(e.centre), "radius": round(e.r_cav, 3)})
    spec["split_z"] = round(e.z_split, 3)
    spec["side_top"] = round(e.z_split + (e.lip if e.joint_style == "rabbet" else 0.0), 3)
    spec["solids"] = [{**s, "origin": r3(s["origin"]), "radius": round(s["radius"], 4), "length": round(s["length"], 4)} for s in b.solids]
    return spec


def plunger_spec(fid: str, b: Built, glb: Path, res: float) -> dict:
    """A plunger for the fit: its mesh, and its tip (where it meets the switch by design) as a zone."""
    fact = b.facts[fid]
    pl = b.plungers[fid]["plane"]
    n = [pl.z_dir.X, pl.z_dir.Y, pl.z_dir.Z]
    v, f = load_mesh(glb)
    zone = {"centre": fact["tip"], "axis": r3(n), "radius": fact["shaft_d_mm"] / 2 + 0.01, "z": [-0.01, fact["gap_mm"] + res]}
    return {"key": f"plunger_{fid}", "feature": fid, "V": v, "F": f, "zones": [zone]}


def repack_zip(path: Path) -> None:
    """lib3mf writes ZIP64 containers with the time in each entry; repack as a plain ZIP with fixed times (reruns are byte-identical)."""
    import zipfile

    with zipfile.ZipFile(path) as z:
        entries = [(i.filename, z.read(i.filename)) for i in z.infolist()]
    # lib3mf stamps random production-extension UUIDs; derive them from the part name and their order instead
    count = iter(range(1 << 30))

    def uuid(_m: re.Match) -> str:
        h = hashlib.sha256(f"{path.stem}:{next(count)}".encode()).hexdigest()
        return f'p:UUID="{h[:8]}-{h[8:12]}-4{h[13:16]}-8{h[17:20]}-{h[20:32]}"'

    entries = [(n, re.sub(rb'p:UUID="[0-9a-fA-F-]{36}"', lambda m: uuid(m).encode(), d) if n.endswith(".model") else d) for n, d in entries]
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in entries:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, data)


def normalise_step(path: Path) -> None:
    """OCC stamps the time into FILE_NAME; fix it so reruns are byte-identical."""
    path.write_text(re.sub(r"FILE_NAME\('([^']*)','[^']*'", lambda m: f"FILE_NAME('{m.group(1)}','{FIXED_TIME}'", path.read_text(), count=1))


def normalise_dxf(path: Path) -> None:
    """ezdxf stamps the time and random GUIDs into the header; fix them, so reruns are byte-identical."""
    lines = path.read_text(encoding="utf-8").split("\n")
    fixed = {"$TDCREATE": "2451545.0", "$TDUCREATE": "2451545.0", "$TDUPDATE": "2451545.0", "$TDUUPDATE": "2451545.0", "$TDINDWG": "0.0", "$FINGERPRINTGUID": "{00000000-0000-0000-0000-000000000000}", "$VERSIONGUID": "{00000000-0000-0000-0000-000000000000}"}
    for i, l in enumerate(lines[:-2]):
        if l.strip() in fixed:
            lines[i + 2] = fixed[l.strip()]
    # ezdxf's own "<version> @ <timestamp>" marks
    lines = [re.sub(r"^(\d+\.\d+\.\d+) @ \d{4}-\d\d-\d\dT[\d:.+]+$", r"\1", l) for l in lines]
    path.write_text("\n".join(lines), encoding="utf-8")


def write_section(parts: dict[str, Shape], e: Enclosure, path: Path, bodies: list[dict] | None = None, covers: dict[str, Shape] | None = None) -> None:
    """A section on the XZ plane through the cavity centre, as SVG: the case's parts and covers cut and filled,
    and what goes inside (the contents' meshes) cut as outlines, each in its own colour, with a legend and a
    millimetre scale. +Z (towards the lid) is up."""
    y0 = float(e.centre[1])
    pl = Plane(origin=Vector(0, y0, 0), x_dir=Vector(1, 0, 0), z_dir=Vector(0, -1, 0))
    S = 8.0  # px per mm
    polys: list[tuple[str, list[list[tuple[float, float]]], str]] = []  # (label, rings in (x, z), fill)
    fills = {"base": "#b8c4d6", "lid": "#d3d9e2"}

    def rings_of(face) -> list[list[tuple[float, float]]]:
        out = []
        for w in [face.outer_wire(), *face.inner_wires()]:
            pts = [w.position_at(t) for t in np.linspace(0, 1, 600)]
            ring = [(round(p.X, 3), round(p.Z, 3)) for p in pts]
            # the wire starts wherever the kernel put its first vertex: start at the least point, run one way
            k = ring.index(min(ring))
            ring = ring[k:] + ring[:k]
            if len(ring) > 2 and ring[1] > ring[-1]:
                ring = [ring[0]] + ring[1:][::-1]
            out.append(ring)
        return out

    for k, part in sorted({**parts, **(covers or {})}.items()):
        try:
            sec = part.intersect(Pos(0, y0, 0) * Box(1000, 1e-3, 1000))
        except Exception:  # noqa: BLE001 - one part that does not cut is left out of the drawing
            continue
        if sec is None:
            continue
        # the slab's two big faces are the same outline: one of them
        faces = sorted((f for f in (sec.faces() if hasattr(sec, "faces") else []) if f.normal_at().Y > 0.9), key=lambda f: (round(f.center().X, 3), round(f.center().Z, 3), round(f.area, 3)))
        if not faces:
            continue
        label = k.replace("_", " ")
        fill = fills.get(k, "#9fd3f0" if k.startswith("cover") else "#e6c79c")
        polys.append((label, [r for f in faces for r in rings_of(f)], fill))
    # contents: triangle meshes cut by the plane
    segs: list[tuple[str, list[tuple[float, float, float, float]]]] = []
    for body in bodies or []:
        V, F = body["V"], body["F"]
        if not len(F):
            continue
        d = V[:, 1] - y0
        F = np.asarray(F, dtype=np.int64)
        D = d[F]
        pos = D > 0
        cut = ~(pos.all(axis=1) | (~pos).all(axis=1))
        Fc, Dc = F[cut], D[cut]
        P = [[], []]
        for e0, e1 in ((0, 1), (1, 2), (2, 0)):
            m = (Dc[:, e0] > 0) != (Dc[:, e1] > 0)
            t = np.where(m, Dc[:, e0] / np.where(m, Dc[:, e0] - Dc[:, e1], 1.0), 0.0)
            q = V[Fc[:, e0]] + t[:, None] * (V[Fc[:, e1]] - V[Fc[:, e0]])
            P[0].append(np.where(m[:, None], q[:, [0, 2]], np.nan))
        pts = np.stack(P[0], axis=1)  # (n, 3 edges, 2)
        out = []
        for row in pts:
            ok = row[~np.isnan(row[:, 0])]
            if len(ok) >= 2:
                out.append((float(ok[0][0]), float(ok[0][1]), float(ok[1][0]), float(ok[1][1])))
        if out:
            segs.append((body.get("label", body["key"]), out))
    xs = [x for _, rs, _ in polys for r in rs for x, _ in r] + [v for _, ss in segs for s_ in ss for v in (s_[0], s_[2])]
    zs = [z for _, rs, _ in polys for r in rs for _, z in r] + [v for _, ss in segs for s_ in ss for v in (s_[1], s_[3])]
    if not xs:
        return
    x0, x1, z0, z1 = min(xs) - 2, max(xs) + 2, min(zs) - 2, max(zs) + 2
    W, H = (x1 - x0) * S, (z1 - z0) * S
    legend_h = 16 * (len(polys) + len(segs)) + 30
    X = lambda x: (x - x0) * S  # noqa: E731
    Z = lambda z: (z1 - z) * S  # noqa: E731
    colors = ["#d94e00", "#1f6fb2", "#2e8b57", "#8e44ad", "#b8860b", "#c0392b", "#16a085", "#555555"]
    el = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H + legend_h:.1f}" width="{W:.0f}" height="{H + legend_h:.0f}" font-family="sans-serif" font-size="11">', f'<rect width="100%" height="100%" fill="#fff"/>']
    for label, rings, fill in polys:
        dpath = " ".join("M" + " L".join(f"{X(x):.2f},{Z(z):.2f}" for x, z in r) + " Z" for r in rings)
        el.append(f'<path d="{dpath}" fill="{fill}" fill-rule="evenodd" stroke="#333" stroke-width="0.8"/>')
    for i, (label, ss) in enumerate(segs):
        col = colors[i % len(colors)]
        dpath = " ".join(f"M{X(a):.2f},{Z(bz):.2f} L{X(c):.2f},{Z(dz):.2f}" for a, bz, c, dz in ss)
        el.append(f'<path d="{dpath}" fill="none" stroke="{col}" stroke-width="1.2" stroke-linecap="round"/>')
    y = H + 18
    for label, _, fill in polys:
        el.append(f'<rect x="8" y="{y - 9}" width="14" height="10" fill="{fill}" stroke="#333" stroke-width="0.6"/><text x="28" y="{y}">{label} (cut)</text>')
        y += 16
    for i, (label, _) in enumerate(segs):
        el.append(f'<line x1="8" x2="22" y1="{y - 4}" y2="{y - 4}" stroke="{colors[i % len(colors)]}" stroke-width="2"/><text x="28" y="{y}">{label}</text>')
        y += 16
    # 5 mm scale bar
    el.append(f'<line x1="{W - 8 - 5 * S:.1f}" x2="{W - 8:.1f}" y1="{H + 14}" y2="{H + 14}" stroke="#000" stroke-width="2"/><text x="{W - 8:.1f}" y="{H + 28}" text-anchor="end">5 mm</text><text x="{W - 8:.1f}" y="{H + 42}" text-anchor="end">section at y = {y0:g} mm, +Z up</text>')
    el.append("</svg>")
    path.write_text("\n".join(el) + "\n", encoding="utf-8")


def main() -> None:
    mode = sys.argv[1]
    if mode == "build":
        job = json.loads(Path(sys.argv[2]).read_text())
        out = Path(sys.argv[3])
        root = Path(sys.argv[sys.argv.index("--root") + 1]) if "--root" in sys.argv else Path.cwd()
        r = build(job, out, root)
        print(json.dumps({"name": r["name"], "problems": r["problems"], "fit": {"bodies": r["fit"]["bodies"], "walls": r["fit"]["walls"]}}))
    elif mode == "fit":
        spec = json.loads(sys.stdin.read() if sys.argv[2] == "-" else Path(sys.argv[2]).read_text())
        root = Path(spec["root"])
        meshes = {k: load_mesh(root / p, node=k if spec.get("by_node") else None) for k, p in {**spec["parts"], **{x["key"]: x["glb"] for x in spec.get("plungers", [])}}.items()}
        bodies = []
        for c in spec["contents"]:
            v, f = load_mesh(root / c["glb"], c["matrix"], skip=c.get("skip_nodes"))
            bodies.append({"key": c["key"], "label": c.get("label", c["key"]), "V": v, "F": f, "zones": spec.get("zones", {}).get(c["key"], [])})
        fit = analyse({k: meshes[k] for k in spec["parts"]}, bodies, spec["cavity"], spec["resolution"], spec["clearance"])
        plungers = [{"key": x["key"], "feature": x["feature"], "V": meshes[x["key"]][0], "F": meshes[x["key"]][1], "zones": x.get("zones", [])} for x in spec.get("plungers", [])]
        fit["plungers"] = analyse_plungers(plungers, bodies, fit["resolution_mm"], spec["clearance"])
        print(json.dumps(fit))
    else:
        raise SystemExit(f"unknown mode {mode}")


if __name__ == "__main__":
    main()
