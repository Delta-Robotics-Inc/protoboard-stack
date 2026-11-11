"""Find the orthographic views on a sheet (PB-1190, `drawing.views`).

1. The part's geometry (not annotation, see sheet.py) is clustered by box proximity: two items whose boxes come
   within GAP of each other belong to one cluster. A single item that spans most of the sheet is the frame
   and is left out.
2. A cluster whose text reads like a title block (TITLE, SCALE, REV, DRAWN, ...) is the title block, not a view.
   Clusters with fewer than MIN_ITEMS items are left out (stray marks, symbols).
3. Each view takes the nearest label (TOP VIEW, FRONT, SECTION A-A, DETAIL B, ...) within reach.
4. Projection: the sheet's own words first (THIRD ANGLE / FIRST ANGLE), then the labelled views' layout
   (TOP above FRONT is third angle), else DEFAULT third angle with the reason. Unlabelled views get a role
   from where they sit relative to the largest view, which is taken as FRONT (DEFAULT).

Boxes are mm, y up (sheet.py). For a PDF they are also given as points from the top-left (`box_pt`), which is
what `crop` takes.
"""
from __future__ import annotations

import math
import re

from . import r3, r3v
from .sheet import Sheet, union

GAP_FRACTION = 0.015  # DEFAULT: boxes closer than 1.5 % of the sheet diagonal join one cluster
MIN_ITEMS = 2  # DEFAULT: a cluster of fewer items is not a view
FRAME_FRACTION = 0.7  # DEFAULT: an item wider and taller than 70 % of the sheet is the frame

TITLE_WORDS = re.compile(r"\b(TITLE|SCALE|REV(ISION)?|DRAWN|CHECKED|APPROVED|DATE|UNITS|SHEET|DWG|PART\s*(NO|NUMBER)|MATERIAL|TOLERANCES?|PROJECTION)\b", re.I)
LABEL = re.compile(r"^\s*((?:TOP|FRONT|SIDE|RIGHT|LEFT|BOTTOM|REAR|BACK|END|PLAN|ISOMETRIC|ISO)(?:\s+SIDE)?(?:\s+VIEW)?|VIEW\s+[A-Z](?:-[A-Z])?|SECTION\s+[A-Z]\s*-\s*[A-Z]|DETAIL\s+[A-Z]|(?:RECOMMENDED\s+)?(?:PCB|LAND)\s+(?:LAYOUT|PATTERN)|SIDE\s+VIEW)\b", re.I)
ROLE_WORDS = [("front", r"\bFRONT\b"), ("top", r"\b(TOP|PLAN)\b"), ("bottom", r"\bBOTTOM\b"), ("right", r"\bRIGHT\b"), ("left", r"\bLEFT\b"), ("back", r"\b(REAR|BACK)\b"), ("side", r"\b(SIDE|END)\b"), ("iso", r"\bISO(METRIC)?\b"), ("section", r"\bSECTION\b"), ("detail", r"\bDETAIL\b"), ("pcb-layout", r"\b(PCB|LAND)\b")]


def _gap(a, b) -> float:
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return math.hypot(dx, dy)


MAX_GRID_CELLS = 2_000_000  # DEFAULT: the clustering grid's size cap (cells grow to stay under it)


def _clusters(items: list, gap: float) -> list[list[int]]:
    """Groups of items whose line work comes within about `gap` of each other.

    The items' own strokes (segments along their length, circles around their rim) are sampled onto a grid of
    cells half a gap wide, the occupied cells grown by one cell, and the grown cells joined 4-connected. Linear in
    the number of items and samples (a pairwise box test took 500 s on an 8 MB board DXF with 63k segments)."""
    import numpy as np
    from collections import deque

    if not items:
        return []
    xs, ys, owner = [], [], []
    for i, it in enumerate(items):
        if hasattr(it, "r"):
            n = max(8, int(math.ceil(2 * math.pi * it.r / max(gap / 2, 1e-9))) + 1)
            t = np.linspace(0.0, 2 * math.pi, n, endpoint=False)
            xs.append(it.c[0] + it.r * np.cos(t))
            ys.append(it.c[1] + it.r * np.sin(t))
        else:
            n = max(2, int(math.ceil(it.length / max(gap / 2, 1e-9))) + 1)
            t = np.linspace(0.0, 1.0, n)
            xs.append(it.a[0] + (it.b[0] - it.a[0]) * t)
            ys.append(it.a[1] + (it.b[1] - it.a[1]) * t)
        owner.append(np.full(n, i, dtype=np.int64))
    X, Y, O = np.concatenate(xs), np.concatenate(ys), np.concatenate(owner)
    x0, y0 = float(X.min()), float(Y.min())
    cell = max(gap / 2, 1e-9)
    while math.ceil((float(X.max()) - x0) / cell + 3) * math.ceil((float(Y.max()) - y0) / cell + 3) > MAX_GRID_CELLS:
        cell *= 1.5
    W = int(math.ceil((float(X.max()) - x0) / cell)) + 3
    H = int(math.ceil((float(Y.max()) - y0) / cell)) + 3
    ix = np.floor((X - x0) / cell).astype(np.int64) + 1
    iy = np.floor((Y - y0) / cell).astype(np.int64) + 1
    occ = np.zeros((H, W), dtype=bool)
    occ[iy, ix] = True
    grown = occ.copy()
    grown[1:, :] |= occ[:-1, :]
    grown[:-1, :] |= occ[1:, :]
    grown[:, 1:] |= occ[:, :-1]
    grown[:, :-1] |= occ[:, 1:]
    label = np.full((H, W), -1, dtype=np.int64)
    n_labels = 0
    for sy, sx in zip(*np.nonzero(grown)):
        if label[sy, sx] >= 0:
            continue
        label[sy, sx] = n_labels
        q = deque([(sy, sx)])
        while q:
            cy, cx = q.popleft()
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < H and 0 <= nx < W and grown[ny, nx] and label[ny, nx] < 0:
                    label[ny, nx] = n_labels
                    q.append((ny, nx))
        n_labels += 1
    item_label = np.full(len(items), -1, dtype=np.int64)
    item_label[O] = label[iy, ix]  # every sample of an item lies in one grown component
    groups: dict[int, list[int]] = {}
    for i, lab in enumerate(item_label.tolist()):
        groups.setdefault(lab, []).append(i)
    return list(groups.values())


def _is_frame(b, sheet_box, paper: bool) -> bool:
    """A border: the box spans most of the sheet both ways, or it is one long edge lying near the sheet's edge."""
    sx0, sy0, sx1, sy1 = sheet_box
    sw, sh = max(sx1 - sx0, 1e-9), max(sy1 - sy0, 1e-9)
    w, h = b[2] - b[0], b[3] - b[1]
    if w > FRAME_FRACTION * sw and h > FRAME_FRACTION * sh:
        return True
    if not paper:
        return False
    edge = 0.12  # DEFAULT: within 12 % of the sheet's edge
    if w > FRAME_FRACTION * sw and h < 0.02 * sh and (b[1] - sy0 < edge * sh or sy1 - b[3] < edge * sh):
        return True
    if h > FRAME_FRACTION * sh and w < 0.02 * sw and (b[0] - sx0 < edge * sw or sx1 - b[2] < edge * sw):
        return True
    return False


def _outline_only(box, members, sheet_box) -> bool:
    """A cluster that covers most of the sheet and whose every item lies on its own outline (with other geometry
    inside it, checked by the caller): a drawn border, not a rectangular part."""
    sx0, sy0, sx1, sy1 = sheet_box
    if (box[2] - box[0]) < FRAME_FRACTION * (sx1 - sx0) or (box[3] - box[1]) < FRAME_FRACTION * (sy1 - sy0):
        return False
    tol = 0.005 * max(box[2] - box[0], box[3] - box[1])
    on = lambda b: (abs(b[0] - box[0]) < tol and abs(b[2] - box[0]) < tol) or (abs(b[0] - box[2]) < tol and abs(b[2] - box[2]) < tol) or (abs(b[1] - box[1]) < tol and abs(b[3] - box[1]) < tol) or (abs(b[1] - box[3]) < tol and abs(b[3] - box[3]) < tol)  # noqa: E731
    return all(on(b) for b in members)


def _others_inside(box, boxes, members: set) -> bool:
    return any(b[0] > box[0] and b[2] < box[2] and b[1] > box[1] and b[3] < box[3] for j, b in enumerate(boxes) if j not in members)


def _near(box, t, reach) -> float:
    return _gap(box, t.box) if _gap(box, t.box) <= reach else math.inf


def projection_hint(sheet: Sheet) -> tuple[str | None, str | None]:
    text = sheet.all_text().upper()
    if re.search(r"\b(THIRD|3RD)[\s-]*ANGLE\b", text):
        return "third", "the sheet says third angle"
    if re.search(r"\b(FIRST|1ST)[\s-]*ANGLE\b", text):
        return "first", "the sheet says first angle"
    return None, None


def find_views(sheet: Sheet) -> dict:
    sx0, sy0, sx1, sy1 = sheet.box
    sw, sh = max(sx1 - sx0, 1e-9), max(sy1 - sy0, 1e-9)
    diag = math.hypot(sw, sh)
    gap = GAP_FRACTION * diag
    items = [x for x in sheet.segs + sheet.circs if not x.anno]
    paper = sheet.kind == "pdf" or sheet.index > 1  # a DXF's model space has no paper edge to sit near
    frame = [x for x in items if _is_frame(x.bbox(), sheet.box, paper)]
    items = [x for x in items if x not in frame]
    boxes = [x.bbox() for x in items]
    groups = _clusters(items, gap)
    views, title = [], None
    for g in groups:
        box = union(boxes[i] for i in g)
        if _outline_only(box, [boxes[i] for i in g], sheet.box) and _others_inside(box, boxes, set(g)):
            frame.extend(items[i] for i in g)
            continue
        inner = [t for t in sheet.texts if _gap(box, t.box) == 0.0]
        if sum(1 for t in inner if TITLE_WORDS.search(t.text)) >= 2:
            if title is None or (box[2] - box[0]) * (box[3] - box[1]) > (title["box"][2] - title["box"][0]) * (title["box"][3] - title["box"][1]):
                title = {"box": box, "text": [t.text for t in sorted(inner, key=lambda t: (-t.box[3], t.box[0]))]}
            continue
        if len(g) < MIN_ITEMS:
            continue
        circles = sum(1 for i in g if hasattr(items[i], "r"))
        views.append({"box": box, "items": len(g), "circles": circles, "sources": sorted({items[i].src.split(":")[0] for i in g})})
    views.sort(key=lambda v: (-(v["box"][3]), v["box"][0]))  # top to bottom, then left to right
    # labels: the nearest label text within reach of each view (one label per view)
    used = set()
    for v in views:
        b = v["box"]
        reach = 0.25 * max(b[2] - b[0], b[3] - b[1]) + 10.0
        cands = sorted(((_near(b, t, reach), k, t) for k, t in enumerate(sheet.texts) if LABEL.search(t.text) and k not in used), key=lambda c: c[0])
        if cands and cands[0][0] < math.inf:
            _, k, t = cands[0]
            used.add(k)
            v["label"] = LABEL.search(t.text).group(1).upper()
            v["labelSource"] = t.src
            v["role"] = next((role for role, rx in ROLE_WORDS if re.search(rx, v["label"])), "other")
    proj, reason = projection_hint(sheet)
    confidence = "high" if proj else None
    labelled = {v["role"]: v for v in views if v.get("role")}
    if not proj and "front" in labelled:
        f = labelled["front"]["box"]
        for role, other in labelled.items():
            o = other["box"]
            if role == "top":
                proj = "third" if o[1] >= f[3] - 1e-6 else "first" if o[3] <= f[1] + 1e-6 else None
            elif role == "right":
                proj = "third" if o[0] >= f[2] - 1e-6 else "first" if o[2] <= f[0] + 1e-6 else None
            elif role == "left":
                proj = "third" if o[2] <= f[0] + 1e-6 else "first" if o[0] >= f[2] - 1e-6 else None
            if proj:
                reason, confidence = f"the {role.upper()} view sits {'where' if proj == 'third' else 'opposite where'} third angle puts it relative to FRONT", "medium"
                break
    if not proj:
        proj, confidence = "third", "low"
        reason = "DEFAULT: no projection note and no labelled TOP or side view next to FRONT; third angle (ASME Y14.3, the US and most Asian datasheet convention) assumed; check the projection symbol"
    # roles for unlabelled views, from their place relative to the front view (the largest, DEFAULT, when unlabelled)
    unlabelled = [v for v in views if not v.get("role")]
    if unlabelled or labelled.get("front"):
        # a labelled view that is not FRONT (a PCB layout, a section) never anchors the others
        front = labelled.get("front") or max(unlabelled, key=lambda v: (v["box"][2] - v["box"][0]) * (v["box"][3] - v["box"][1]))
        if not front.get("role"):
            front["role"] = "front"
            front["roleReason"] = "DEFAULT: the largest unlabelled view is taken as FRONT"
        f = front["box"]
        for v in views:
            if v.get("role"):
                continue
            b = v["box"]
            above, below = b[1] >= f[3] - 1e-6, b[3] <= f[1] + 1e-6
            right, left = b[0] >= f[2] - 1e-6, b[2] <= f[0] + 1e-6
            overlap_x = b[0] < f[2] and b[2] > f[0]
            overlap_y = b[1] < f[3] and b[3] > f[1]
            third = proj == "third"
            if overlap_x and above:
                v["role"] = "top" if third else "bottom"
            elif overlap_x and below:
                v["role"] = "bottom" if third else "top"
            elif overlap_y and right:
                v["role"] = "right" if third else "left"
            elif overlap_y and left:
                v["role"] = "left" if third else "right"
            else:
                v["role"] = "other"
            v["roleReason"] = f"{'above' if above else 'below' if below else 'right of' if right else 'left of' if left else 'apart from'} FRONT, {proj} angle"
    out = []
    for n, v in enumerate(views, start=1):
        row = {"id": f"v{n}", "role": v.get("role", "other"), "label": v.get("label"), "box_mm": r3v(v["box"]), "size_mm": [r3(v["box"][2] - v["box"][0]), r3(v["box"][3] - v["box"][1])], "items": v["items"], "circles": v["circles"]}
        if sheet.kind == "pdf":
            row["box_pt"] = r3v(sheet.pt_box(v["box"]))
        if v.get("roleReason"):
            row["roleReason"] = v["roleReason"]
        if v.get("labelSource"):
            row["labelSource"] = v["labelSource"]
        out.append(row)
    result = {"sheet": sheet.name, "page": sheet.index, "views": out, "projection": {"guess": proj, "reason": reason, "confidence": confidence}, "clusterGap_mm": r3(gap)}
    if title:
        result["titleBlock"] = {"box_mm": r3v(title["box"]), "text": title["text"]}
        if sheet.kind == "pdf":
            result["titleBlock"]["box_pt"] = r3v(sheet.pt_box(title["box"]))
    if frame:
        result["frame"] = r3v(union(x.bbox() for x in frame))
    return result


def view_for_point(views: list[dict], p) -> str | None:
    """The view whose box holds `p`, else the nearest one (mm)."""
    best, bestd = None, math.inf
    for v in views:
        b = v["box_mm"]
        d = _gap(b, (p[0], p[1], p[0], p[1]))
        if d < bestd:
            best, bestd = v["id"], d
    return best
