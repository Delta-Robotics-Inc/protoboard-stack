"""The exact measurement tier (PB-1187): measure a part's B-rep through build123d/OCCT.

Runs in the project's CAD runtime (PROTOBOARD_PYTHON, or `protoboard tools install cad`), started by
`@protoboardai/core/geometry-service` with `python -I geometry_service.py` and spoken to over stdin and stdout,
one JSON object per line (no socket, no loopback port). It reads only the STEP files the Node side resolved
and named in each request (`files`: part instance path -> absolute path), each checked there against the
project's `.protoboard/build/resolved.json`, contained in the project and size-capped; it never fetches.

Units: STEP is read in mm (OCCT converts the file's units on import), Z up, the part's own frame. A ref's
`transform` (row-major 4x4, mm) places the part in the assembly; results are in assembly mm when every ref
carries one. The viewer's display mesh is metres, Y up; it converts to mm before it sends a signature.

Requests:
  {"id": 1, "op": "ping"}
  {"id": 2, "op": "load", "file": "C:/.../body.step"}
  {"id": 3, "op": "faces", "file": "...", "limit": 50}
  {"id": 4, "op": "measure", "request": {protoboard.geometry-request/v0}, "files": {"frame": "C:/.../body.step"}}
  {"id": 5, "op": "quit"}
Replies: {"id": n, "ok": true, "result": {...}, "ms": 12.3} or {"id": n, "ok": false, "error": "..."}.
The first line written is {"ready": true, ...}.

Faces are found by signature (centroid, normal or axis and radius, area, in part mm), because the view
sidecar's feature ids are mesh primitive ordinals, not STEP face indices (see uhd-viewer
src/cad/measure/faces.ts). Each match reports how far off it was and its margin over the runner-up.
"""

import json
import math
import os
import sys
import time

MAX_BYTES = int(os.environ.get("PROTOBOARD_GEOMETRY_MAX_BYTES", str(256 * 1024 * 1024)))  # DEFAULT 256 MB
MAX_LINE = 4 * 1024 * 1024  # DEFAULT: a request line is at most 4 MB
MAX_CACHED = int(os.environ.get("PROTOBOARD_GEOMETRY_MAX_FILES", "8"))  # DEFAULT: STEP files kept loaded
PARALLEL_DEG = 1.0  # DEFAULT, as the mesh tier: faces within 1 degree are parallel

t_import = time.time()
from build123d import import_step  # noqa: E402
import build123d  # noqa: E402
from OCP.BRepAdaptor import BRepAdaptor_Surface  # noqa: E402
from OCP.BRepBndLib import BRepBndLib  # noqa: E402
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex, BRepBuilderAPI_Transform  # noqa: E402
from OCP.BRepExtrema import BRepExtrema_DistShapeShape  # noqa: E402
from OCP.BRepGProp import BRepGProp  # noqa: E402
from OCP.Bnd import Bnd_Box  # noqa: E402
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane, GeomAbs_Cone, GeomAbs_Sphere, GeomAbs_Torus, GeomAbs_BSplineSurface, GeomAbs_BezierSurface, GeomAbs_SurfaceOfRevolution, GeomAbs_SurfaceOfExtrusion, GeomAbs_OffsetSurface  # noqa: E402
from OCP.GProp import GProp_GProps  # noqa: E402
from OCP.TopAbs import TopAbs_REVERSED  # noqa: E402
from OCP.gp import gp_Pnt, gp_Trsf  # noqa: E402

IMPORT_S = time.time() - t_import

SURF_NAMES = {
    GeomAbs_Plane: "PLANE",
    GeomAbs_Cylinder: "CYLINDER",
    GeomAbs_Cone: "CONE",
    GeomAbs_Sphere: "SPHERE",
    GeomAbs_Torus: "TORUS",
    GeomAbs_BSplineSurface: "BSPLINE",
    GeomAbs_BezierSurface: "BEZIER",
    GeomAbs_SurfaceOfRevolution: "REVOLUTION",
    GeomAbs_SurfaceOfExtrusion: "EXTRUSION",
    GeomAbs_OffsetSurface: "OFFSET",
}


# ---------------------------------------------------------------------------
# small vector helpers (tuples, mm)
# ---------------------------------------------------------------------------

def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scl(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    n = math.sqrt(dot(a, a))
    return (a[0] / n, a[1] / n, a[2] / n) if n > 0 else (0.0, 0.0, 0.0)


def length(a):
    return math.sqrt(dot(a, a))


def angle_deg(a, b):
    la, lb = length(a), length(b)
    if not la or not lb:
        return float("nan")
    return math.degrees(math.acos(max(-1.0, min(1.0, dot(a, b) / (la * lb)))))


def line_angle_deg(a, b):
    d = angle_deg(a, b)
    return 180.0 - d if d > 90.0 else d


def r4(x):
    return round(float(x), 4)


def r4v(v):
    return [r4(v[0]), r4(v[1]), r4(v[2])]


def r6v(v):
    return [round(float(v[0]), 6), round(float(v[1]), 6), round(float(v[2]), 6)]


# ---------------------------------------------------------------------------
# placements (row-major 4x4, mm, rigid)
# ---------------------------------------------------------------------------

RIGID_FIX = 1e-3  # DEFAULT: a placement off orthonormal by up to this is squared up (rounded matrices in a display file)


def rigid(m):
    """(the placement squared up to a rotation and translation, how far off it was). A placement written with
    rounded numbers (ClientX's display placements, 4 decimals) is off orthonormal by about 1e-4: it is
    re-orthonormalised (Gram-Schmidt on the columns, keeping the first) and the result says so. Beyond
    RIGID_FIX it is a scale or a shear, and refused."""
    if m is None:
        return None, 0.0
    if len(m) != 16:
        raise ValueError("transform must be 16 numbers")
    cols = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]]
    worst = 0.0
    for i in range(3):
        for j in range(3):
            d = sum(cols[i][k] * cols[j][k] for k in range(3))
            worst = max(worst, abs(d - (1.0 if i == j else 0.0)))
    if worst > RIGID_FIX:
        raise ValueError("transform must be a rotation and a translation (no scale): off by %.3g" % worst)
    if worst <= 1e-9:
        return list(m), worst
    x = norm(tuple(cols[0]))
    y = sub(tuple(cols[1]), scl(x, dot(cols[1], x)))
    y = norm(y)
    z = cross(x, y)
    if dot(z, tuple(cols[2])) < 0:
        raise ValueError("transform must not mirror")
    return [x[0], y[0], z[0], m[3], x[1], y[1], z[1], m[7], x[2], y[2], z[2], m[11], 0.0, 0.0, 0.0, 1.0], worst


def trsf_of(m):
    """gp_Trsf from a row-major 4x4 (UHD Mat4) that rigid() has squared up."""
    if m is None:
        return None
    t = gp_Trsf()
    t.SetValues(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11])
    return t


def apply_point(m, p):
    if m is None:
        return tuple(p)
    return (
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
        m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
        m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
    )


def apply_dir(m, d):
    if m is None:
        return tuple(d)
    return (m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[4] * d[0] + m[5] * d[1] + m[6] * d[2], m[8] * d[0] + m[9] * d[1] + m[10] * d[2])


def moved(shape, m):
    t = trsf_of(m)
    if t is None:
        return shape
    return BRepBuilderAPI_Transform(shape, t, True).Shape()


def box_limits(b):
    """(xmin, ymin, zmin, xmax, ymax, zmax) of a Bnd_Box (its corners; `Get()` does not convert in this OCP)."""
    lo, hi = b.CornerMin(), b.CornerMax()
    return lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()


# ---------------------------------------------------------------------------
# files and faces
# ---------------------------------------------------------------------------

class Part:
    def __init__(self, path):
        st = os.stat(path)
        self.path = path
        self.key = (st.st_size, st.st_mtime_ns)
        t0 = time.time()
        self.shape = import_step(path)
        self.load_s = time.time() - t0
        self.faces = list(self.shape.faces())
        self.info = {}
        self.boxes = None

    def face_info(self, i):
        got = self.info.get(i)
        if got is not None:
            return got
        f = self.faces[i]
        props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(f.wrapped, props)
        c = props.CentreOfMass()
        ad = BRepAdaptor_Surface(f.wrapped)
        kind = ad.GetType()
        info = {"index": i, "type": SURF_NAMES.get(kind, "OTHER"), "area": props.Mass(), "centroid": (c.X(), c.Y(), c.Z())}
        reversed_ = f.wrapped.Orientation() == TopAbs_REVERSED
        if kind == GeomAbs_Plane:
            ax = ad.Plane().Axis()
            d = ax.Direction()
            n = (d.X(), d.Y(), d.Z())
            info["normal"] = scl(n, -1.0) if reversed_ else n
            p = ax.Location()
            info["origin"] = (p.X(), p.Y(), p.Z())
        elif kind == GeomAbs_Cylinder:
            cy = ad.Cylinder()
            ax = cy.Axis()
            d = ax.Direction()
            p = ax.Location()
            axis = (d.X(), d.Y(), d.Z())
            origin = (p.X(), p.Y(), p.Z())
            # the axis point nearest the face's centroid (the mesh tier reports the same point)
            info["axis"] = axis
            info["axisPoint"] = add(origin, scl(axis, dot(sub(info["centroid"], origin), axis)))
            info["radius"] = cy.Radius()
        self.info[i] = info
        return info

    def bbox_centres(self):
        """Each face's bounding box centre and half-diagonal (cheap; prefilters signature matching on big files)."""
        if self.boxes is None:
            out = []
            for f in self.faces:
                b = Bnd_Box()
                BRepBndLib.Add_s(f.wrapped, b, False)
                if b.IsVoid():
                    out.append(((0.0, 0.0, 0.0), float("inf")))
                    continue
                x0, y0, z0, x1, y1, z1 = box_limits(b)
                out.append((((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), 0.5 * math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2)))
            self.boxes = out
        return self.boxes


PARTS = {}


def load(path):
    if not isinstance(path, str) or not path:
        raise ValueError("a STEP file path is needed")
    if not path.lower().endswith((".step", ".stp")):
        raise ValueError("only STEP files are measured")
    if not os.path.isfile(path):
        raise ValueError("the STEP file is not on disk: " + path)
    size = os.path.getsize(path)
    if size > MAX_BYTES:
        raise ValueError("the STEP file is %d bytes, over the %d byte cap" % (size, MAX_BYTES))
    real = os.path.realpath(path)
    st = os.stat(real)
    got = PARTS.get(real)
    if got is not None and got.key == (st.st_size, st.st_mtime_ns):
        return got, True
    part = Part(real)
    PARTS[real] = part
    while len(PARTS) > MAX_CACHED:
        PARTS.pop(next(iter(PARTS)))
    return part, False


def match_face(part, sig):
    """The B-rep face that fits a mesh signature best (part mm), with its distance, angle and margin."""
    want = sig.get("type", "other")
    c = tuple(sig["centroid"])
    area = sig.get("area")
    reach = max(5.0, 3.0 * math.sqrt(area)) if area else 25.0
    boxes = part.bbox_centres()
    cands = [i for i, (bc, half) in enumerate(boxes) if length(sub(bc, c)) <= half + reach]
    if not cands:
        cands = range(len(part.faces))
    scored = []
    for i in cands:
        info = part.face_info(i)
        size = max(1.0, math.sqrt(info["area"]))
        score = length(sub(info["centroid"], c)) / size
        ang = None
        if want == "plane":
            if info["type"] != "PLANE":
                score += 5.0
            elif sig.get("normal"):
                ang = angle_deg(info["normal"], sig["normal"])
                score += ang / 10.0
        elif want == "cylinder":
            if info["type"] != "CYLINDER":
                score += 5.0
            else:
                if sig.get("axis"):
                    ang = line_angle_deg(info["axis"], sig["axis"])
                    score += ang / 10.0
                if sig.get("radius"):
                    score += abs(info["radius"] - sig["radius"]) / max(0.1, sig["radius"]) * 10.0
                if sig.get("axisPoint"):
                    off = sub(tuple(sig["axisPoint"]), info["axisPoint"])
                    across = sub(off, scl(info["axis"], dot(off, info["axis"])))
                    score += length(across) / max(0.1, info["radius"])
        if area:
            score += abs(math.log(max(1e-9, info["area"]) / max(1e-9, area))) * 0.5
        scored.append((score, i, ang))
    scored.sort()
    best = scored[0]
    info = part.face_info(best[1])
    margin = (scored[1][0] + 1e-9) / (best[0] + 1e-9) if len(scored) > 1 else None
    m = {"brepFace": best[1], "type": info["type"], "method": "signature", "centroidOffset": r4(length(sub(info["centroid"], c)))}
    if best[2] is not None:
        m["angleDeg"] = r4(best[2])
    if margin is not None:
        m["margin"] = round(min(margin, 1e6), 3)
    return best[1], m


def resolve_face(ref, files):
    """(part, face index, match record) for a ref that names a face, else (part, None, None)."""
    path = files.get(ref.get("part", ""))
    if not path:
        raise ValueError("no STEP file resolved for part %r" % ref.get("part"))
    part, _ = load(path)
    if ref.get("brepFace") is not None:
        i = int(ref["brepFace"])
        if i < 0 or i >= len(part.faces):
            raise ValueError("brepFace %d is out of range (%d faces)" % (i, len(part.faces)))
        info = part.face_info(i)
        return part, i, {"brepFace": i, "type": info["type"], "method": "index"}
    if ref.get("signature"):
        i, m = match_face(part, ref["signature"])
        return part, i, m
    return part, None, None


# ---------------------------------------------------------------------------
# measurements (exact)
# ---------------------------------------------------------------------------

def nearest(shape_a, shape_b):
    d = BRepExtrema_DistShapeShape(shape_a, shape_b)
    d.Perform()
    if not d.IsDone() or d.NbSolution() < 1:
        raise ValueError("no distance found")
    pa = d.PointOnShape1(1)
    pb = d.PointOnShape2(1)
    return d.Value(), (pa.X(), pa.Y(), pa.Z()), (pb.X(), pb.Y(), pb.Z())


def vertex(p):
    return BRepBuilderAPI_MakeVertex(gp_Pnt(*p)).Vertex()


def placed_info(info, m):
    """A face's analytic data in the assembly (or part) frame."""
    out = dict(info)
    out["centroid"] = apply_point(m, info["centroid"])
    for k in ("normal", "axis"):
        if k in info:
            out[k] = norm(apply_dir(m, info[k]))
    for k in ("origin", "axisPoint"):
        if k in info:
            out[k] = apply_point(m, info[k])
    return out


def surface_kind(info):
    return "plane" if info["type"] == "PLANE" else "cylinder" if info["type"] == "CYLINDER" else "other"


def line_distance(p1, d1, p2, d2):
    w = sub(p2, p1)
    c = cross(d1, d2)
    if line_angle_deg(d1, d2) <= PARALLEL_DEG or length(c) < 1e-12:
        foot = add(p1, scl(d1, dot(w, d1)))
        return length(sub(p2, foot)), foot, p2
    a, b, e = dot(d1, d1), dot(d1, d2), dot(d2, d2)
    dd, f = dot(d1, w), dot(d2, w)
    den = a * e - b * b
    s = (dd * e - b * f) / den
    t = (b * dd - a * f) / den
    pa = add(p1, scl(d1, s))
    pb = add(p2, scl(d2, -t))
    return length(sub(pa, pb)), pa, pb


EXACT_TOL = {"mm": 0, "basis": ["B-rep through build123d/OCCT"]}


def measure(req, files):
    notes = []
    res = _measure(req, files, notes)
    if notes:
        res["notes"] = res.get("notes", []) + [n for n in notes if n not in res.get("notes", [])]
    return res


def _measure(req, files, notes):
    kind = req.get("kind")
    a = req.get("a") or {}
    b = req.get("b")
    placed = a.get("transform") is not None and (b is None or b.get("transform") is not None)
    frame = "assembly" if placed else "part"
    ma, off_a = rigid(a.get("transform") if placed else None)
    mb, off_b = rigid((b or {}).get("transform") if placed else None)
    pa, fa, match_a = resolve_face(a, files)
    pb, fb, match_b = resolve_face(b, files) if b is not None else (None, None, None)
    faces = {}
    if match_a:
        faces["a"] = match_a
    if match_b:
        faces["b"] = match_b
    res = {"schema": "protoboard.geometry-result/v0", "tier": "exact", "kind": kind, "frame": frame, "tolerance": EXACT_TOL}
    if faces:
        res["faces"] = faces
    for name, off in (("a", off_a), ("b", off_b)):
        if off > 1e-9:
            notes.append("%s's placement was off orthonormal by %.2g and was squared up (rounded matrix)" % (name, off))

    def face_shape(part, i, m):
        return moved(part.faces[i].wrapped, m)

    def point_on(ref, part, i, m):
        """The ref's point in the frame; snapped onto its face when it names one (the mesh point sits on a chord)."""
        p = apply_point(m, ref["point"])
        if i is None:
            return p
        _, q, _ = nearest(face_shape(part, i, m), vertex(p))
        return q

    if kind == "bounds":
        shape = pa.shape.wrapped if fa is None else pa.faces[fa].wrapped
        box = Bnd_Box()
        BRepBndLib.AddOptimal_s(moved(shape, ma), box, False, False)
        x0, y0, z0, x1, y1, z1 = box_limits(box)
        res.update({"method": "optimal-box", "min": r4v((x0, y0, z0)), "max": r4v((x1, y1, z1)), "size": r4v((x1 - x0, y1 - y0, z1 - z0))})
        return res

    if kind == "cylinder":
        if fa is None:
            raise ValueError("cylinder needs a face")
        info = placed_info(pa.face_info(fa), ma)
        res["surfaces"] = {"a": surface_kind(info)}
        if info["type"] != "CYLINDER":
            res.update({"method": "analytic"})
            res["notes"] = ["the matched face is %s, not a cylinder" % info["type"]]
            return res
        res.update({"method": "analytic", "radius": r4(info["radius"]), "diameter": r4(2 * info["radius"]), "axis": {"point": r4v(info["axisPoint"]), "direction": r6v(info["axis"])}})
        return res

    if kind == "point-point":
        p = point_on(a, pa, fa, ma)
        q = point_on(b, pb, fb, mb)
        res.update({"method": "points-on-faces" if (fa is not None or fb is not None) else "points", "distance": r4(length(sub(p, q))), "points": {"a": r4v(p), "b": r4v(q)}})
        return res

    if kind == "point-face":
        p = point_on(a, pa, fa, ma)
        info = placed_info(pb.face_info(fb), mb)
        res["surfaces"] = {"b": surface_kind(info)}
        if info["type"] == "PLANE":
            d = dot(sub(p, info["origin"]), info["normal"])
            res.update({"method": "plane", "distance": r4(d), "points": {"a": r4v(p), "b": r4v(sub(p, scl(info["normal"], d)))}})
        else:
            d, q, _ = nearest(face_shape(pb, fb, mb), vertex(p))
            res.update({"method": "nearest", "distance": r4(d), "points": {"a": r4v(p), "b": r4v(q)}})
        return res

    if kind == "face-face":
        ia = placed_info(pa.face_info(fa), ma)
        ib = placed_info(pb.face_info(fb), mb)
        res["surfaces"] = {"a": surface_kind(ia), "b": surface_kind(ib)}
        # the nearest points of two B-rep faces (BRepExtrema) cost seconds on a board's top face with thousands of
        # holes: taken only when the answer is the nearest distance, not for parallel planes or two axes (DEFAULT)
        def nearest_faces():
            return nearest(face_shape(pa, fa, ma), face_shape(pb, fb, mb))

        if ia["type"] == "PLANE" and ib["type"] == "PLANE":
            ang = angle_deg(ia["normal"], ib["normal"])
            if line_angle_deg(ia["normal"], ib["normal"]) <= PARALLEL_DEG:
                d1 = abs(dot(sub(ib["origin"], ia["origin"]), ia["normal"]))
                d2 = abs(dot(sub(ia["origin"], ib["origin"]), ib["normal"]))
                foot = sub(ib["centroid"], scl(ia["normal"], dot(sub(ib["centroid"], ia["origin"]), ia["normal"])))
                res.update({"method": "parallel-planes", "distance": r4((d1 + d2) / 2), "angleDeg": r4(ang), "points": {"a": r4v(foot), "b": r4v(ib["centroid"])}})
            else:
                dmin, qa, qb = nearest_faces()
                res.update({"method": "nearest", "distance": r4(dmin), "angleDeg": r4(ang), "points": {"a": r4v(qa), "b": r4v(qb)}})
        elif ia["type"] == "CYLINDER" and ib["type"] == "CYLINDER":
            ang = line_angle_deg(ia["axis"], ib["axis"])
            d, la, lb = line_distance(ia["axisPoint"], ia["axis"], ib["axisPoint"], ib["axis"])
            notes.append("diameters %s and %s mm" % (r4(2 * ia["radius"]), r4(2 * ib["radius"])))
            res.update({"method": "axis-to-axis" if ang <= PARALLEL_DEG else "axis-to-axis-skew", "distance": r4(d), "angleDeg": r4(ang), "points": {"a": r4v(la), "b": r4v(lb)}})
        else:
            dmin, qa, qb = nearest_faces()
            res.update({"method": "nearest", "distance": r4(dmin), "points": {"a": r4v(qa), "b": r4v(qb)}})
            cyl = ia if ia["type"] == "CYLINDER" else ib if ib["type"] == "CYLINDER" else None
            pl = ia if ia["type"] == "PLANE" else ib if ib["type"] == "PLANE" else None
            if cyl and pl:
                res["angleDeg"] = r4(line_angle_deg(cyl["axis"], pl["normal"]))
        return res

    raise ValueError("unknown kind %r" % kind)


def faces_listing(path, limit):
    part, cached = load(path)
    out = []
    for i in range(min(len(part.faces), limit)):
        info = part.face_info(i)
        row = {"index": i, "type": info["type"], "area": r4(info["area"]), "centroid": r4v(info["centroid"])}
        if "normal" in info:
            row["normal"] = r6v(info["normal"])
        if "radius" in info:
            row["radius"] = r4(info["radius"])
            row["axis"] = r6v(info["axis"])
            row["axisPoint"] = r4v(info["axisPoint"])
        out.append(row)
    return {"faces": len(part.faces), "listed": out, "cached": cached}


def handle(msg):
    op = msg.get("op")
    if op == "ping":
        return {"pong": True, "loaded": len(PARTS)}
    if op == "load":
        part, cached = load(msg.get("file"))
        return {"faces": len(part.faces), "loadS": round(part.load_s, 3), "cached": cached}
    if op == "faces":
        return faces_listing(msg.get("file"), int(msg.get("limit", 100000)))
    if op == "measure":
        files = msg.get("files") or {}
        if not isinstance(files, dict):
            raise ValueError("files must map part instance paths to STEP paths")
        return measure(msg.get("request") or {}, files)
    raise ValueError("unknown op %r" % op)


def main():
    out = sys.stdout
    out.write(json.dumps({"ready": True, "build123d": build123d.__version__, "python": sys.version.split()[0], "importS": round(IMPORT_S, 3)}) + "\n")
    out.flush()
    for line in sys.stdin:
        if len(line) > MAX_LINE:
            out.write(json.dumps({"id": None, "ok": False, "error": "request line over the size cap"}) + "\n")
            out.flush()
            continue
        line = line.strip()
        if not line:
            continue
        t0 = time.time()
        try:
            msg = json.loads(line)
        except ValueError:
            out.write(json.dumps({"id": None, "ok": False, "error": "not JSON"}) + "\n")
            out.flush()
            continue
        rid = msg.get("id") if isinstance(msg, dict) else None
        if isinstance(msg, dict) and msg.get("op") == "quit":
            out.write(json.dumps({"id": rid, "ok": True, "result": {"bye": True}}) + "\n")
            out.flush()
            return
        try:
            result = handle(msg if isinstance(msg, dict) else {})
            reply = {"id": rid, "ok": True, "result": result, "ms": round((time.time() - t0) * 1000, 1)}
        except Exception as e:  # report, keep serving
            reply = {"id": rid, "ok": False, "error": "%s: %s" % (type(e).__name__, e), "ms": round((time.time() - t0) * 1000, 1)}
        out.write(json.dumps(reply) + "\n")
        out.flush()


if __name__ == "__main__":
    main()
