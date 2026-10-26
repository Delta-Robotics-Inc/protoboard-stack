"""Read an Eagle board (.brd, XML) for a part audit: outline, holes, elements, pads and nets.

    python eagle_brd.py <board.brd> [--element REGEX] [--nets] [--json]

Prints the board outline (layer 20, Dimension) and its size, the mounting
holes (plain holes, package holes and plated mounting-hole pads), every element (package, value, position, rotation) with its package
holes in board coordinates, and, for elements matching --element, every pad
with its board position, drill and net. --nets lists every net with the
pads on it. --json prints all of it as one JSON document.

Used by the uhd-part-verify audit (and research) to read a breakout board's
header pinout, mounting holes and outline from the manufacturer's own board
file instead of a photo. The ext-parts tests (test/audit-helpers.test.ts)
check it against Eagle boards, so an auditor can trust its coordinates.

Placement follows Eagle: a package point (x, y) of an element at (ex, ey)
with rotation "R<a>" is rotated by a degrees counter-clockwise; "M" (the
element is on the bottom) then mirrors the rotated point in X; "S" (spin)
does not move pads. Mirroring before rotating, as some ad hoc scripts do,
puts the pads of MR90/MR270 elements on the wrong side.

Standard library only (python 3.9+).
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field

DIMENSION_LAYER = "20"


@dataclass
class Pad:
    name: str
    x: float
    y: float
    kind: str  # "pad" (through hole) or "smd"
    drill: float | None
    net: str | None


@dataclass
class Hole:
    x: float
    y: float
    drill: float
    element: str | None = None  # None for a plain (board) hole
    plated: bool = False


@dataclass
class Element:
    name: str
    library: str
    package: str
    value: str | None
    x: float
    y: float
    rot: str
    mirrored: bool
    angle: float
    pads: list[Pad] = field(default_factory=list)
    holes: list[Hole] = field(default_factory=list)


@dataclass
class Board:
    outline: dict | None
    holes: list[Hole]
    elements: list[Element]
    nets: dict[str, list[str]]  # net -> ["ELEMENT.PAD", ...]


ROT = re.compile(r"^(S?)(M?)R(-?\d+(?:\.\d+)?)$")


def parse_rot(rot: str | None) -> tuple[bool, float]:
    """Eagle rotation "R90", "MR270", "SMR45" -> (mirrored, degrees)."""
    m = ROT.match(rot or "R0")
    if not m:
        raise ValueError(f"unknown Eagle rotation {rot!r}")
    return bool(m.group(2)), float(m.group(3))


def place(ex: float, ey: float, mirrored: bool, angle: float, px: float, py: float) -> tuple[float, float]:
    """A package point in board coordinates: rotate counter-clockwise, then mirror in X for a bottom-side element."""
    a = math.radians(angle)
    gx = px * math.cos(a) - py * math.sin(a)
    gy = px * math.sin(a) + py * math.cos(a)
    if mirrored:
        gx = -gx
    return round(ex + gx, 4) + 0.0, round(ey + gy, 4) + 0.0  # never -0.0


def _f(el: ET.Element, k: str) -> float:
    return float(el.get(k, "0"))


def outline(board: ET.Element) -> dict | None:
    xs: list[float] = []
    ys: list[float] = []
    plain = board.find("plain")
    if plain is None:
        return None
    for w in plain.iter("wire"):
        if w.get("layer") == DIMENSION_LAYER:
            xs += [_f(w, "x1"), _f(w, "x2")]
            ys += [_f(w, "y1"), _f(w, "y2")]
    for c in plain.iter("circle"):
        if c.get("layer") == DIMENSION_LAYER:
            r = _f(c, "radius")
            xs += [_f(c, "x") - r, _f(c, "x") + r]
            ys += [_f(c, "y") - r, _f(c, "y") + r]
    for r in plain.iter("rectangle"):
        if r.get("layer") == DIMENSION_LAYER:
            xs += [_f(r, "x1"), _f(r, "x2")]
            ys += [_f(r, "y1"), _f(r, "y2")]
    if not xs:
        return None
    return {
        "min": [min(xs), min(ys)],
        "max": [max(xs), max(ys)],
        "size": [round(max(xs) - min(xs), 4), round(max(ys) - min(ys), 4)],
    }


def read_board(path: str) -> Board:
    root = ET.parse(path).getroot()
    board = root.find("drawing/board")
    if board is None:
        raise ValueError(f"{path}: not an Eagle board (no drawing/board); a .brd from Eagle 6 or later is XML")
    packages = {
        (lib.get("name"), p.get("name")): p
        for lib in board.iter("library")
        for p in lib.iter("package")
    }
    pad_net: dict[tuple[str, str], str] = {}
    nets: dict[str, list[str]] = {}
    signals = board.find("signals")
    for s in signals if signals is not None else []:
        for c in s.iter("contactref"):
            pad_net[(c.get("element"), c.get("pad"))] = s.get("name")
            nets.setdefault(s.get("name"), []).append(f"{c.get('element')}.{c.get('pad')}")
    plain = board.find("plain")
    holes = [Hole(_f(h, "x"), _f(h, "y"), _f(h, "drill")) for h in (plain.iter("hole") if plain is not None else [])]
    elements: list[Element] = []
    for e in board.iter("element"):
        mirrored, angle = parse_rot(e.get("rot"))
        el = Element(e.get("name"), e.get("library"), e.get("package"), e.get("value"), _f(e, "x"), _f(e, "y"), e.get("rot") or "R0", mirrored, angle)
        pkg = packages.get((el.library, el.package))
        if pkg is not None:
            for kind in ("pad", "smd"):
                for p in pkg.iter(kind):
                    x, y = place(el.x, el.y, mirrored, angle, _f(p, "x"), _f(p, "y"))
                    drill = float(p.get("drill")) if p.get("drill") else None
                    el.pads.append(Pad(p.get("name"), x, y, kind, drill, pad_net.get((el.name, p.get("name")))))
            for h in pkg.iter("hole"):
                x, y = place(el.x, el.y, mirrored, angle, _f(h, "x"), _f(h, "y"))
                el.holes.append(Hole(x, y, _f(h, "drill"), el.name))
        elements.append(el)
    return Board(outline(board), holes, elements, nets)


def pad_sort_key(p: Pad):
    return (0, int(p.name), "") if p.name.isdigit() else (1, 0, p.name)


def header_pinout(board: Board, element: str) -> list[tuple[str, str | None]]:
    """(pad, net) of one element in pad order: a header's pinout as the board wires it."""
    el = next((e for e in board.elements if e.name == element), None)
    if el is None:
        raise KeyError(f"no element {element}")
    return [(p.name, p.net) for p in sorted(el.pads, key=pad_sort_key)]


MOUNTING_PACKAGE = re.compile(r"MOUNT|HOLE|STANDOFF", re.I)


def mounting_holes(board: Board) -> list[Hole]:
    """Mounting holes in board coordinates: plain holes, package holes, and the plated pads of
    mounting-hole footprints (Adafruit's MOUNTINGHOLE_2.5_PLATED is a pad, not a hole)."""
    out = list(board.holes) + [h for e in board.elements for h in e.holes]
    for e in board.elements:
        if MOUNTING_PACKAGE.search(e.package or ""):
            out += [Hole(p.x, p.y, p.drill, e.name, True) for p in e.pads if p.drill]
    return sorted(out, key=lambda h: (h.y, h.x))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("board")
    ap.add_argument("--element", help="regex: print the pads (position, drill, net) of matching elements")
    ap.add_argument("--nets", action="store_true", help="list every net with its pads")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    b = read_board(a.board)
    if a.json:
        print(json.dumps({**asdict(b), "mounting_holes": [asdict(h) for h in mounting_holes(b)]}, indent=1))
        return 0
    o = b.outline
    if o:
        print(f"outline x {o['min'][0]:.3f}..{o['max'][0]:.3f} y {o['min'][1]:.3f}..{o['max'][1]:.3f} -> {o['size'][0]:.3f} x {o['size'][1]:.3f} mm")
    else:
        print("outline: none on layer 20")
    for h in mounting_holes(b):
        print(f"mounting hole ({h.x:.3f}, {h.y:.3f}) drill {h.drill}{' plated' if h.plated else ''} [{h.element or 'plain'}]")
    pat = re.compile(a.element) if a.element else None
    for e in b.elements:
        line = f"{e.name:10s} {e.package:28s} {(e.value or ''):22s} @({e.x:.3f},{e.y:.3f}) {e.rot}"
        if e.holes:
            line += " holes " + " ".join(f"({h.x:.3f},{h.y:.3f}) d{h.drill}" for h in e.holes)
        print(line)
        if pat and pat.search(e.name):
            for p in sorted(e.pads, key=pad_sort_key):
                print(f"    {p.kind:3s} {p.name:6s} ({p.x:.3f},{p.y:.3f}) drill {p.drill} -> {p.net}")
    if a.nets:
        for n in sorted(b.nets):
            print(f"net {n}: {' '.join(b.nets[n])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
