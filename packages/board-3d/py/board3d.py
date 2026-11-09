"""Board 3D helper for @protoboardai/board-3d, run with the stack's CAD runtime (OCP over OCCT).

Commands (JSON on stdout):

  inspect <file.step> [--board NAME] [--intersect]
      Re-read a STEP file through OCCT's XCAF reader: solids (as placed instances), products and occurrence names,
      colors, the bounding box, B-rep validity, and with --intersect the volume each component shares with the board
      body (named NAME, default the first product whose name ends in " PCB").

  mesh <file.step> [--tolerance MM] [--out FILE]
      Tessellate a part model (a vendor STEP) for the board scene: one triangle list for the whole model, in the file's
      own frame and millimeters, with the number of solids it holds and its bounding box. With --out the triangles go to
      FILE as little-endian float32 (x, y, z per corner) instead of into the JSON.

  meshes <jobs.json> [--tolerance MM]
      The same for several files in one run: jobs.json is a list of {"path", "out"}.

  compose <board.step> <jobs.json> <out.step>
      Place part models into a board STEP written by board-3d: each job names an occurrence (the component's name),
      a model STEP file and the 3 x 4 matrix from the model's frame to the footprint frame; the model replaces the
      stand-in box of that product, fused into one solid per part when "merge" is true (the default).

Only OCP is imported (not build123d), so a run starts in about a second.
"""
import json
import sys
import time


def _ocp():
    from OCP.STEPCAFControl import STEPCAFControl_Reader
    from OCP.TDocStd import TDocStd_Document
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorTool, XCAFDoc_ColorSurf, XCAFDoc_ColorGen
    from OCP.TDF import TDF_Label
    try:
        from OCP.TDF import TDF_LabelSequence
    except ImportError:  # OCP 8 moved the sequences to OCP.OCP.collections
        from OCP.OCP.collections import Sequence_TDF_Label as TDF_LabelSequence
    from OCP.TDataStd import TDataStd_Name
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_SOLID, TopAbs_FACE, TopAbs_SHELL
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.Quantity import Quantity_Color
    from OCP.IFSelect import IFSelect_RetDone
    return locals()


def _read(path):
    o = _ocp()
    doc = o["TDocStd_Document"](o["TCollection_ExtendedString"]("XmlOcaf"))
    r = o["STEPCAFControl_Reader"]()
    r.SetColorMode(True)
    r.SetNameMode(True)
    if r.ReadFile(path) != o["IFSelect_RetDone"]:
        raise SystemExit(json.dumps({"error": "STEP read failed", "path": path}))
    r.Transfer(doc)
    st = o["XCAFDoc_DocumentTool"].ShapeTool_s(doc.Main())
    ct = o["XCAFDoc_DocumentTool"].ColorTool_s(doc.Main())
    return o, doc, st, ct


def _name(o, label):
    attr = o["TDataStd_Name"]()
    if label.FindAttribute(o["TDataStd_Name"].GetID_s(), attr):
        return attr.Get().ToExtString()
    return ""


def _bbox(o, shape):
    b = o["Bnd_Box"]()
    o["BRepBndLib"].Add_s(shape, b, False)
    if b.IsVoid():
        return None
    lo = b.CornerMin()
    hi = b.CornerMax()
    x0, y0, z0, x1, y1, z1 = lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()
    return [[round(x0, 4), round(y0, 4), round(z0, 4)], [round(x1, 4), round(y1, 4), round(z1, 4)]]


def _count(o, shape, kind):
    n = 0
    e = o["TopExp_Explorer"](shape, kind)
    while e.More():
        n += 1
        e.Next()
    return n


def _label_color(o, label, col):
    lc = o["XCAFDoc_ColorTool"]
    return lc.GetColor_s(label, o["XCAFDoc_ColorSurf"], col) or lc.GetColor_s(label, o["XCAFDoc_ColorGen"], col)


def _color_hex(c):
    r, g, b = c.Red(), c.Green(), c.Blue()
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def inspect(path, board=None, intersect=False):
    t0 = time.time()
    o, doc, st, ct = _read(path)
    t_read = time.time() - t0
    roots = o["TDF_LabelSequence"]()
    st.GetFreeShapes(roots)
    out = {"file": path, "roots": [], "solids": 0, "faces": 0, "invalid": 0, "colors": [], "components": []}
    colors = set()
    board_shape = None
    comps_shapes = []
    for i in range(1, roots.Length() + 1):
        root = roots.Value(i)
        shape = st.GetShape_s(root)
        out["roots"].append(_name(o, root))
        out["solids"] += _count(o, shape, o["TopAbs_SOLID"])
        out["faces"] += _count(o, shape, o["TopAbs_FACE"])
        out["bbox"] = _bbox(o, shape)
        comps = o["TDF_LabelSequence"]()
        st.GetComponents_s(root, comps, False)
        for k in range(1, comps.Length() + 1):
            c = comps.Value(k)
            ref = o["TDF_Label"]()
            st.GetReferredShape_s(c, ref)
            cs = st.GetShape_s(c)
            nsol = _count(o, cs, o["TopAbs_SOLID"])
            col = o["Quantity_Color"]()
            found = None
            e = o["TopExp_Explorer"](cs, o["TopAbs_SOLID"])
            while e.More():
                s = e.Current()
                if ct.GetColor(s, o["XCAFDoc_ColorSurf"], col) or ct.GetColor(s, o["XCAFDoc_ColorGen"], col):
                    found = _color_hex(col)
                    colors.add(found)
                e.Next()
            if found is None:
                sub = o["TDF_LabelSequence"]()
                st.GetSubShapes_s(ref, sub)
                for j in range(1, sub.Length() + 1):
                    if _label_color(o, sub.Value(j), col):
                        found = _color_hex(col)
                        colors.add(found)
                        break
            if found is None and _label_color(o, ref, col):
                found = _color_hex(col)
                colors.add(found)
            invalid = 0
            e = o["TopExp_Explorer"](cs, o["TopAbs_SOLID"])
            while e.More():
                if not o["BRepCheck_Analyzer"](e.Current()).IsValid():
                    invalid += 1
                e.Next()
            out["invalid"] += invalid
            entry = {"occurrence": _name(o, c), "product": _name(o, ref), "solids": nsol, "color": found, "bbox": _bbox(o, cs), "invalid": invalid}
            out["components"].append(entry)
            pname = entry["product"]
            if board_shape is None and ((board and pname == board) or (not board and pname.endswith(" PCB"))):
                board_shape = cs
            else:
                comps_shapes.append((entry, cs))
    out["colors"] = sorted(colors)
    out["readSeconds"] = round(t_read, 3)
    if intersect and board_shape is not None:
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
        from OCP.GProp import GProp_GProps
        from OCP.BRepGProp import BRepGProp
        t1 = time.time()
        bb = _bbox(o, board_shape)
        hits = []
        for entry, cs in comps_shapes:
            b = entry["bbox"]
            if not b or b[1][2] < bb[0][2] or b[0][2] > bb[1][2] or b[1][0] < bb[0][0] or b[0][0] > bb[1][0] or b[1][1] < bb[0][1] or b[0][1] > bb[1][1]:
                continue
            common = BRepAlgoAPI_Common(board_shape, cs)
            props = GProp_GProps()
            BRepGProp.VolumeProperties_s(common.Shape(), props)
            v = props.Mass()
            if v > 1e-4:
                hits.append({"occurrence": entry["occurrence"], "volume": round(v, 5)})
        out["intersections"] = hits
        out["intersectSeconds"] = round(time.time() - t1, 3)
    out["seconds"] = round(time.time() - t0, 3)
    return out


def mesh(path, tolerance=0.02, out=None):
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.BRep import BRep_Tool
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopAbs import TopAbs_REVERSED
    from OCP.TopoDS import TopoDS
    t0 = time.time()
    o, doc, st, ct = _read(path)
    roots = o["TDF_LabelSequence"]()
    st.GetFreeShapes(roots)
    from OCP.TopoDS import TopoDS_Compound
    from OCP.BRep import BRep_Builder
    comp = TopoDS_Compound()
    bld = BRep_Builder()
    bld.MakeCompound(comp)
    for i in range(1, roots.Length() + 1):
        bld.Add(comp, st.GetShape_s(roots.Value(i)))
    BRepMesh_IncrementalMesh(comp, tolerance, False, 0.5, True)
    pos = []
    e = o["TopExp_Explorer"](comp, o["TopAbs_FACE"])
    while e.More():
        f = (TopoDS.Face_s if hasattr(TopoDS, "Face_s") else TopoDS.Face)(e.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(f, loc)
        if tri is not None:
            trsf = loc.Transformation()
            rev = f.Orientation() == TopAbs_REVERSED
            nodes = [tri.Node(k).Transformed(trsf) for k in range(1, tri.NbNodes() + 1)]
            for k in range(1, tri.NbTriangles() + 1):
                a, b, c = tri.Triangle(k).Get()
                if rev:
                    b, c = c, b
                for idx in (a, b, c):
                    p = nodes[idx - 1]
                    pos.extend([round(p.X(), 5), round(p.Y(), 5), round(p.Z(), 5)])
        e.Next()
    result = {"file": path, "solids": _count(o, comp, o["TopAbs_SOLID"]), "triangles": len(pos) // 9, "bbox": _bbox(o, comp), "seconds": round(time.time() - t0, 3)}
    if out:
        import array
        with open(out, "wb") as f:
            array.array("f", pos).tofile(f)
        result["out"] = out
    else:
        result["pos"] = pos
    return result


def _list_of_shapes():
    try:
        from OCP.TopTools import TopTools_ListOfShape
        return TopTools_ListOfShape()
    except ImportError:  # OCP 8
        from OCP.OCP.collections import List_TopoDS_Shape
        return List_TopoDS_Shape()


def _model_shape(o, path, merge):
    """A model STEP as one shape: its free shapes, fused into one solid when merge is set and they touch."""
    from OCP.TopoDS import TopoDS_Compound
    from OCP.BRep import BRep_Builder
    _, doc, st, _ = _read(path)
    roots = o["TDF_LabelSequence"]()
    st.GetFreeShapes(roots)
    comp = TopoDS_Compound()
    bld = BRep_Builder()
    bld.MakeCompound(comp)
    solids = []
    for i in range(1, roots.Length() + 1):
        sh = st.GetShape_s(roots.Value(i))
        e = o["TopExp_Explorer"](sh, o["TopAbs_SOLID"])
        while e.More():
            solids.append(e.Current())
            e.Next()
        bld.Add(comp, sh)
    supplied = len(solids)
    if not merge or supplied <= 1:
        return comp, supplied, supplied, None
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse
    from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
    args = _list_of_shapes()
    tools = _list_of_shapes()
    args.Append(solids[0])
    for x in solids[1:]:
        tools.Append(x)
    f = BRepAlgoAPI_Fuse()
    f.SetArguments(args)
    f.SetTools(tools)
    f.SetFuzzyValue(1e-4)
    f.SetRunParallel(True)
    f.Build()
    if not f.IsDone():
        return comp, supplied, supplied, "fuse failed; kept as supplied"
    u = ShapeUpgrade_UnifySameDomain(f.Shape(), True, True, True)
    u.Build()
    res = u.Shape()
    return res, supplied, _count(o, res, o["TopAbs_SOLID"]), None


def compose(base, jobs_path, out):
    """Replace the box stand-ins of model parts in a board STEP with the models' own geometry."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_GTransform, BRepBuilderAPI_Transform
    from OCP.gp import gp_GTrsf, gp_Trsf, gp_Mat, gp_XYZ
    from OCP.Quantity import Quantity_Color, Quantity_TOC_sRGB
    from OCP.STEPCAFControl import STEPCAFControl_Writer
    from OCP.STEPControl import STEPControl_AsIs
    from OCP.Interface import Interface_Static
    t0 = time.time()
    o, doc, st, ct = _read(base)
    jobs = json.load(open(jobs_path, encoding="utf-8"))
    roots = o["TDF_LabelSequence"]()
    st.GetFreeShapes(roots)
    by_name = {}
    for i in range(1, roots.Length() + 1):
        comps = o["TDF_LabelSequence"]()
        st.GetComponents_s(roots.Value(i), comps, False)
        for k in range(1, comps.Length() + 1):
            c = comps.Value(k)
            ref = o["TDF_Label"]()
            st.GetReferredShape_s(c, ref)
            by_name[_name(o, c)] = ref
    cache = {}
    parts = []
    for job in jobs["parts"]:
        ref = by_name.get(job["occurrence"])
        if ref is None:
            parts.append({"occurrence": job["occurrence"], "ok": False, "message": "occurrence not found"})
            continue
        key = (job["model"], bool(job.get("merge", True)))
        if key not in cache:
            try:
                cache[key] = _model_shape(o, job["model"], key[1])
            except BaseException as e:  # a bad model file: keep the stand-in
                cache[key] = e
        got = cache[key]
        if isinstance(got, BaseException):
            parts.append({"occurrence": job["occurrence"], "ok": False, "message": str(got)[:200]})
            continue
        shape, supplied, solids, note = got
        m = job["matrix"]
        if abs(abs(m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8])) - 1) < 1e-9:
            t = gp_Trsf()
            t.SetValues(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11])
            placed = BRepBuilderAPI_Transform(shape, t, True).Shape()
        else:
            g = gp_GTrsf(gp_Mat(m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]), gp_XYZ(m[3], m[7], m[11]))
            placed = BRepBuilderAPI_GTransform(shape, g, True).Shape()
        st.SetShape(ref, placed)
        col = job.get("color")
        if col:
            v = int(col[1:], 16)
            ct.SetColor(ref, Quantity_Color(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, Quantity_TOC_sRGB), o["XCAFDoc_ColorGen"])
        parts.append({"occurrence": job["occurrence"], "ok": True, "suppliedSolids": supplied, "solids": solids, **({"note": note} if note else {})})
    st.UpdateAssemblies()
    Interface_Static.SetCVal_s("write.step.schema", "AP214IS")
    w = STEPCAFControl_Writer()
    w.SetColorMode(True)
    w.SetNameMode(True)
    w.Transfer(doc, STEPControl_AsIs)
    w.Write(out)
    return {"out": out, "parts": parts, "seconds": round(time.time() - t0, 3)}


def meshes(jobs_path, tolerance=0.02):
    """Tessellate several model files in one run: jobs.json is [{"path", "out"}]; one result per job."""
    jobs = json.load(open(jobs_path, encoding="utf-8"))
    results = []
    for job in jobs:
        try:
            results.append(mesh(job["path"], tolerance, job["out"]))
        except BaseException as e:  # a bad file is reported, the others still load
            results.append({"file": job["path"], "error": str(e)[:300]})
    return {"results": results}


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    cmd, path = argv[1], argv[2]
    rest = argv[3:]
    if cmd == "inspect":
        board = rest[rest.index("--board") + 1] if "--board" in rest else None
        print(json.dumps(inspect(path, board, "--intersect" in rest)))
        return 0
    if cmd == "mesh":
        tol = float(rest[rest.index("--tolerance") + 1]) if "--tolerance" in rest else 0.02
        out = rest[rest.index("--out") + 1] if "--out" in rest else None
        print(json.dumps(mesh(path, tol, out)))
        return 0
    if cmd == "meshes":
        tol = float(rest[rest.index("--tolerance") + 1]) if "--tolerance" in rest else 0.02
        print(json.dumps(meshes(path, tol)))
        return 0
    if cmd == "compose":
        print(json.dumps(compose(path, rest[0], rest[1])))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
