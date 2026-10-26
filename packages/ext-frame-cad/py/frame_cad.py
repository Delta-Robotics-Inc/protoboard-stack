"""frame-cad: plate CAD generated from a module's UHD interfaces (build123d).

    python frame_cad.py <name>.params.json <out_dir>

Adapted from the UHD library's quadcopter generator (library/cad/py/frame.py
and common.py, @deltarobotics/uhd), made generic: every feature is placed from
a bolt pattern in the params file (written by lib/params.ts from the module's
interfaces), and nothing about a particular vehicle is hard-coded. Defaults
are the reference quadcopter's design values.

Coordinates: module frame, mm, Z up, origin on the plate underside.

Placements (decided in lib/params.ts):
  holes_top      pattern on the plate top (frame z = thickness): through holes
  holes_bottom   pattern on the underside (frame z = 0): through holes
  pad            raised pad on a hub, joined to the core by an arm; the pad's
                 top face is the mating face (circle patterns by default)
  clamp          horizontal normal: two vertical side plates `spacing_y`
                 apart (the clamped width), holes `spacing` apart vertically

Writes, into <out_dir>:
  <name>.step              body; each interface feature is a named sub-shape (D1)
  <name>.glb               the same for viewers (glTF: metres, Y-up)
  <name>.manifest.json     feature -> signature (area, centroid, normal), tool,
                           version, source digest (generator + params)
  <name>.frames.json       interface frames of the generated geometry
  <name>.dxf               manufacturing profiles: the plate outline with all
                           holes, and each side-clamp plate (layers)
  interfaces/<id>.glb      one artifact per interface (D2)
and prints a JSON summary on the last stdout line.

Outputs are deterministic for fixed params and build123d version: the STEP
and DXF timestamps and GUIDs are normalised.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sys
from pathlib import Path

import build123d as bd
from build123d import (
    Align,
    Axis,
    Box,
    BuildPart,
    BuildSketch,
    CenterOf,
    Circle,
    Compound,
    Cylinder,
    ExportDXF,
    Face,
    Locations,
    Mode,
    Pos,
    Rectangle,
    Rot,
    Shape,
    export_gltf,
    export_step,
    fillet,
)

MIN = (Align.CENTER, Align.CENTER, Align.MIN)
GENERATOR = Path(__file__)
FIXED_TIME = "2000-01-01T00:00:00"


def signature(faces: list[Face]) -> dict:
    """Area, area-weighted centroid and (if all coplanar-parallel) the shared normal."""
    area = sum(f.area for f in faces)
    c = [sum(getattr(f.center(CenterOf.MASS), k) * f.area for f in faces) / area for k in "XYZ"]
    sig = {"area_mm2": round(area, 3), "centroid": [round(v, 3) + 0.0 for v in c], "faces": len(faces)}
    normals = []
    for f in faces:
        if f.geom_type == bd.GeomType.PLANE:
            n = f.normal_at()
            normals.append((round(n.X, 3) + 0.0, round(n.Y, 3) + 0.0, round(n.Z, 3) + 0.0))
    if normals and len(set(normals)) == 1 and len(normals) == len(faces):
        sig["normal"] = list(normals[0])
    return sig


def feature_shape(name: str, faces: list[Face], pad: float = 0.25) -> Shape:
    """A thin named solid over a feature's faces (D1 sub-shape and D2 artifact)."""
    solids = []
    for f in faces:
        if f.geom_type == bd.GeomType.PLANE:
            solids.append(bd.Solid.extrude(f, f.normal_at() * pad))
        else:
            solids.append(bd.Solid.thicken(f, pad))
    return Compound(label=name, children=solids)


def ray_exit(box: tuple[float, float, float, float], start: tuple[float, float], d: tuple[float, float]) -> float:
    """Distance from `start` (inside the box) along unit `d` to the box boundary."""
    x0, x1, y0, y1 = box
    ts = []
    if abs(d[0]) > 1e-9:
        ts.append(((x1 if d[0] > 0 else x0) - start[0]) / d[0])
    if abs(d[1]) > 1e-9:
        ts.append(((y1 if d[1] > 0 else y0) - start[1]) / d[1])
    return min(t for t in ts if t >= 0) if ts else 0.0


def clamp_geometry(i: dict, plate: dict) -> dict:
    """Side plates of a clamp interface, in module coordinates."""
    o, n, x = i["origin"], i["normal"], i["x_axis"]
    T = plate["thickness"]
    gap, wall = i["spacing_y"], plate["clamp_wall"]
    width = i["spacing"] + plate["clamp_margin"]
    top = T + i["height"] + i["spacing"] / 2 + plate["clamp_margin"]
    per_side = max(1, i["hole_count"] // 2)
    offsets = [0.0] if per_side == 1 else [-i["spacing"] / 2 + k * i["spacing"] / (per_side - 1) for k in range(per_side)]
    angle = math.degrees(math.atan2(x[1], x[0]))
    centre_z = T + i["height"]
    plates = [(o[0] + s * n[0] * (gap / 2 + wall / 2), o[1] + s * n[1] * (gap / 2 + wall / 2)) for s in (1, -1)]
    return {"width": width, "top": top, "wall": wall, "gap": gap, "angle": angle, "plates": plates, "offsets": offsets, "centre_z": centre_z}


def build(params: dict, out: Path) -> dict:
    plate = params["plate"]
    T = plate["thickness"]
    name = params["name"]
    ifaces = params["interfaces"]
    hole_r = lambda i: i["fastener_d"] / 2 + plate["hole_clearance"]
    pad_r = lambda i: (i["spacing"] / 2 if i["shape"] == "circle" else math.hypot(i["spacing"], i["spacing_y"] or i["spacing"]) / 2) + plate["pad_margin"]

    core_holes = [i for i in ifaces if i["placement"] in ("holes_top", "holes_bottom")]
    pads = [i for i in ifaces if i["placement"] == "pad"]
    clamps = [i for i in ifaces if i["placement"] == "clamp"]
    clamp_geo = {i["id"]: clamp_geometry(i, plate) for i in clamps}

    # ---- outline: explicit, or the core features' extent plus a margin
    if plate.get("outline"):
        x0, x1 = plate["outline"]["x"]
        y0, y1 = plate["outline"]["y"]
    else:
        pts = [(hx + s * hole_r(i), hy + t * hole_r(i)) for i in core_holes for hx, hy in i["holes"] for s in (-1, 1) for t in (-1, 1)]
        for cid, g in clamp_geo.items():
            i = next(c for c in clamps if c["id"] == cid)
            a = math.radians(g["angle"])
            for px, py in g["plates"]:
                for s in (-1, 1):
                    for t in (-1, 1):
                        pts.append((px + s * g["width"] / 2 * math.cos(a) - t * g["wall"] / 2 * math.sin(a), py + s * g["width"] / 2 * math.sin(a) + t * g["wall"] / 2 * math.cos(a)))
        if not pts:
            pts = [(-10.0, -10.0), (10.0, 10.0)]
        m = plate["margin"]
        x0, x1 = min(p[0] for p in pts) - m, max(p[0] for p in pts) + m
        y0, y1 = min(p[1] for p in pts) - m, max(p[1] for p in pts) + m
    box = (x0, x1, y0, y1)
    hub = (0.0, 0.0) if x0 < 0 < x1 and y0 < 0 < y1 else ((x0 + x1) / 2, (y0 + y1) / 2)

    # ---- plate: core, arms and hubs to the pads, fillet, then every hole
    with BuildPart() as body:
        with Locations(Pos((x0 + x1) / 2, (y0 + y1) / 2, 0)):
            Box(x1 - x0, y1 - y0, T, align=MIN)
        for i in pads:
            cx, cy = i["origin"][0] - hub[0], i["origin"][1] - hub[1]
            d, ang = math.hypot(cx, cy), math.degrees(math.atan2(cy, cx))
            with Locations(Pos(hub[0], hub[1], 0) * Rot(0, 0, ang) * Pos(d / 2, 0, 0)):
                Box(d, plate["arm_width"], T, align=MIN)
            with Locations(Pos(i["origin"][0], i["origin"][1], 0)):
                Cylinder(pad_r(i) + plate["hub_extra"], T, align=MIN)
    plate_part = body.part
    if plate["corner_radius"] > 0:
        try:
            plate_part = fillet(plate_part.edges().filter_by(Axis.Z), radius=plate["corner_radius"])
        except Exception:  # noqa: BLE001 - a fillet the kernel rejects is skipped, not fatal
            pass
    with BuildPart() as cut:
        for i in core_holes:
            with Locations(*[Pos(hx, hy, 0) for hx, hy in i["holes"]]):
                Cylinder(hole_r(i), T, align=MIN)
        for i in pads:
            with Locations(*[Pos(hx, hy, 0) for hx, hy in i["holes"]]):
                Cylinder(hole_r(i), T, align=MIN)
            if i["shape"] == "circle" and plate["pad_center_relief"] > 0:
                with Locations(Pos(i["origin"][0], i["origin"][1], 0)):
                    Cylinder(plate["pad_center_relief"], T, align=MIN)
            # lightening slot down the arm, outside the core and clear of the hub
            if plate["arm_slot_width"] > 0:
                cx, cy = i["origin"][0] - hub[0], i["origin"][1] - hub[1]
                d = math.hypot(cx, cy)
                u = (cx / d, cy / d)
                t0 = ray_exit(box, hub, u) + 4
                t1 = d - pad_r(i) - plate["hub_extra"] - 4
                if t1 - t0 >= 10:
                    with Locations(Pos(hub[0], hub[1], 0) * Rot(0, 0, math.degrees(math.atan2(cy, cx))) * Pos((t0 + t1) / 2, 0, 0)):
                        Box(t1 - t0, plate["arm_slot_width"], T, align=MIN)
        for s in plate.get("slots") or []:
            with Locations(Pos(s["center"][0], s["center"][1], 0)):
                Box(s["size"][0], s["size"][1], T, align=MIN)
    plate_part = plate_part - cut.part
    plate_part.label = "plate"

    # ---- raised pads (separate bodies: their tops are the mating faces)
    pad_part = None
    if pads:
        with BuildPart() as pp:
            for i in pads:
                with Locations(Pos(i["origin"][0], i["origin"][1], T)):
                    Cylinder(pad_r(i), i["height"], align=MIN)
                with Locations(*[Pos(hx, hy, T) for hx, hy in i["holes"]]):
                    Cylinder(hole_r(i), i["height"], align=MIN, mode=Mode.SUBTRACT)
                if i["shape"] == "circle" and plate["pad_center_relief"] > 0:
                    with Locations(Pos(i["origin"][0], i["origin"][1], T)):
                        Cylinder(plate["pad_center_relief"], i["height"], align=MIN, mode=Mode.SUBTRACT)
        pad_part = pp.part
        pad_part.label = "pads"

    # ---- side clamps
    clamp_part = None
    if clamps:
        with BuildPart() as cp:
            for i in clamps:
                g = clamp_geo[i["id"]]
                for px, py in g["plates"]:
                    with Locations(Pos(px, py, T) * Rot(0, 0, g["angle"])):
                        Box(g["width"], g["wall"], g["top"] - T, align=MIN)
                for dz in g["offsets"]:
                    with Locations(Pos(i["origin"][0], i["origin"][1], g["centre_z"] + dz) * Rot(0, 0, g["angle"]) * Rot(90, 0, 0)):
                        Cylinder(hole_r(i), g["gap"] + 2 * g["wall"] + 2, mode=Mode.SUBTRACT)
        clamp_part = cp.part
        clamp_part.label = "clamps"

    # ---- interface features (D1 names = UHD interface ids)
    at = lambda f: f.center(CenterOf.MASS)
    features: dict[str, list[Face]] = {}
    cyl = [f for f in plate_part.faces() if f.geom_type == bd.GeomType.CYLINDER]
    for i in core_holes:
        features[i["id"]] = [f for f in cyl if f.radius is not None and abs(f.radius - hole_r(i)) < 1e-3 and any(math.hypot(at(f).X - hx, at(f).Y - hy) < 0.2 for hx, hy in i["holes"])]
    if pad_part is not None:
        tops = [f for f in pad_part.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z > 0.99]
        for i in pads:
            z = T + i["height"]
            features[i["id"]] = [f for f in tops if abs(at(f).Z - z) < 1e-3 and math.hypot(at(f).X - i["origin"][0], at(f).Y - i["origin"][1]) < pad_r(i) + 1]
    if clamp_part is not None:
        for i in clamps:
            n, o, g = i["normal"], i["origin"], clamp_geo[i["id"]]
            features[i["id"]] = [
                f
                for f in clamp_part.faces()
                if f.geom_type == bd.GeomType.PLANE
                and abs(abs(f.normal_at().X * n[0] + f.normal_at().Y * n[1]) - 1) < 1e-3
                and abs(abs((at(f).X - o[0]) * n[0] + (at(f).Y - o[1]) * n[1]) - g["gap"] / 2) < 0.05
            ]
    for fid, faces in features.items():
        if not faces:
            raise SystemExit(f"{name}: feature {fid!r} selected no faces")

    # ---- write
    out.mkdir(parents=True, exist_ok=True)
    (out / "interfaces").mkdir(exist_ok=True)
    shapes = {fid: feature_shape(fid, faces) for fid, faces in features.items()}
    parts = [s for s in (plate_part, pad_part, clamp_part) if s is not None]
    whole = Compound(label=name, children=[*parts, *[Compound(label=n, children=[s]) for n, s in shapes.items()]])
    step = out / f"{name}.step"
    export_step(whole, str(step))
    step.write_text(re.sub(r"FILE_NAME\('([^']*)','[^']*'", lambda m: f"FILE_NAME('{m.group(1)}','{FIXED_TIME}'", step.read_text(), count=1))
    export_gltf(whole, str(out / f"{name}.glb"), binary=True, linear_deflection=0.05, angular_deflection=0.3)
    for n, s in shapes.items():
        export_gltf(Compound(label=n, children=[s]), str(out / "interfaces" / f"{n}.glb"), binary=True)

    # manufacturing profiles: the plate (bottom face: every through hole), each clamp side plate beside it
    dxf = ExportDXF()
    dxf.add_layer("plate")
    bottom = [f for f in plate_part.faces() if f.geom_type == bd.GeomType.PLANE and f.normal_at().Z < -0.99 and abs(at(f).Z) < 1e-6]
    dxf.add_shape(bottom, layer="plate")
    cursor = x1 + 10
    for i in clamps:
        g = clamp_geo[i["id"]]
        h = g["top"] - T
        with BuildSketch() as sk:
            with Locations((cursor + g["width"] / 2, h / 2)):
                Rectangle(g["width"], h)
            with Locations(*[(cursor + g["width"] / 2, g["centre_z"] - T + dz) for dz in g["offsets"]]):
                Circle(hole_r(i), mode=Mode.SUBTRACT)
        layer = f"clamp_{i['id']}"
        dxf.add_layer(layer)
        dxf.add_shape(sk.sketch.faces(), layer=layer)
        cursor += g["width"] + 10
    dxf_path = out / f"{name}.dxf"
    dxf.write(str(dxf_path))
    normalise_dxf(dxf_path, name)

    digest = hashlib.sha256(GENERATOR.read_bytes() + json.dumps(params, sort_keys=True).encode()).hexdigest()
    manifest = {
        "artifact": name,
        "tool": "build123d",
        "toolVersion": bd.__version__,
        "generator": "@protoboardai/ext-frame-cad py/frame_cad.py",
        "params": f"{name}.params.json",
        "sourceDigest": digest,
        "units": "mm",
        "features": {fid: signature(faces) for fid, faces in features.items()},
        # solid volume of the bodies (feature pads excluded), so mass = volume x the module's declared material density
        "volume_mm3": round(sum(p.volume for p in parts), 3),
        "bodies": {p.label: round(p.volume, 3) for p in parts},
        "manufacturing": {
            "dxf": f"{name}.dxf",
            "layers": ["plate", *[f"clamp_{i['id']}" for i in clamps]],
            "quantities": {"plate": 1, **{f"clamp_{i['id']}": 2 for i in clamps}},
            "notInDxf": (["pads: raised mating pads (bond shims, or spot-face a thicker plate)"] if pads else []),
            "thickness_mm": {"plate": T, **({f"clamp_{i['id']}": plate["clamp_wall"] for i in clamps})},
        },
    }
    (out / f"{name}.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    # frames of the generated geometry (the check compares them with the module)
    frames = {}
    for i in ifaces:
        z = {"holes_top": T, "holes_bottom": 0.0, "pad": T + i["height"], "clamp": T + i["height"]}[i["placement"]]
        f = {"origin": [i["origin"][0], i["origin"][1], round(z, 3) + 0.0], "normal": i["normal"], "xAxis": i["x_axis"]}
        if i.get("symmetry") is not None:
            f["symmetryDeg"] = i["symmetry"]
        frames[i["id"]] = f
    (out / f"{name}.frames.json").write_text(json.dumps(frames, indent=2) + "\n")
    return {"name": name, "toolVersion": bd.__version__, "sourceDigest": digest, "features": manifest["features"], "frames": frames}


def normalise_dxf(path: Path, name: str) -> None:
    """ezdxf stamps creation times, GUIDs and its own version/time; fix them so reruns are byte-identical."""
    lines = path.read_text().split("\n")
    guid = "{" + hashlib.sha256(name.encode()).hexdigest()[:8].upper() + "-0000-0000-0000-000000000000}"
    fixed = {"$TDCREATE": "2451545.0", "$TDUCREATE": "2451545.0", "$TDUPDATE": "2451545.0", "$TDUUPDATE": "2451545.0", "$TDINDWG": "0.0", "$TDUSRTIMER": "0.0", "$FINGERPRINTGUID": guid, "$VERSIONGUID": guid}
    for k, line in enumerate(lines):
        if line.strip() in fixed and k + 2 < len(lines):
            lines[k + 2] = fixed[line.strip()]
    text = "\n".join(lines)
    text = re.sub(r"(\d+\.\d+\.\d+) @ \d{4}-\d\d-\d\dT[\d:.+]+", r"\1 @ " + FIXED_TIME, text)
    path.write_text(text)


if __name__ == "__main__":
    params_path, out_dir = sys.argv[1], sys.argv[2]
    result = build(json.loads(Path(params_path).read_text()), Path(out_dir))
    print(json.dumps(result))
