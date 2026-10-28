"""
The Protoboard "0" mark (PB-916) as the files the extension and the web viewer
ship, from the brand's own drawing, design/brand/pb-logo-black.svg in this
repository (the slashed zero of PR0TOBOARD; byte for byte the alpha app's
public/Protoboard Logo/PB Logo Black.svg, copied 2026-10-08). Run it again
after the mark changes; it rewrites:

  media/protoboard.svg            24 px, currentColor: view containers and views (VS Code tints it)
  media/protoboard-light.svg      the editor tab's icon on light themes (VS Code's icon grey)
  media/protoboard-dark.svg       the same on dark themes
  media/protoboard-icons.woff     an icon font with the mark at U+E000 ($(protoboard-logo) in the status bar),
                                  and Discord's mark at U+E001 ($(protoboard-discord): the Help view and the
                                  status bar's tooltip), from design/brand/discord-mark.svg
  media/icon.png                  the extension's icon (128 px, the brand orange on a dark tile)
  ../web-viewer/src/logo-mark.ts  the mark's path for the web viewer's header and favicon

Needs fontTools (the PNG is rendered by the repository's @resvg/resvg-js):
  $PROTOBOARD_PYTHON scripts/logo-assets.py      (any Python with fontTools)
"""
import json, os, re, subprocess, sys
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.svgLib.path import parse_path

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
MEDIA = os.path.join(PKG, "media")

# The source drawing, kept in this repository: its one path (in its own coordinates: x 46.125..255.578, y -329.484..0)
SOURCE = os.path.normpath(os.path.join(PKG, "..", "..", "design", "brand", "pb-logo-black.svg"))
with open(SOURCE) as f:
    _paths = re.findall(r'<path[^>]*\sd="([^"]+)"', f.read())
if len(_paths) != 1:
    sys.exit(f"{SOURCE}: expected one path, found {len(_paths)}")
# the drawing ends with a bare moveto after the last contour closes: it draws nothing
MARK = re.sub(r"\s*M\s+[-\d.]+\s+[-\d.]+\s*$", "", _paths[0])
X0, X1, Y0, Y1 = 46.125, 255.578125, -329.484375, 0.0
W, H = X1 - X0, Y1 - Y0


def path_in_box(size, height, flip=False):
    """The mark scaled to `height`, centred in a size × size box (y down; `flip`: y up, for a font)."""
    s = height / H
    dx = (size - W * s) / 2
    dy = (size - height) / 2
    pen = SVGPathPen(None, ntos=lambda v: f"{v:.3f}".rstrip("0").rstrip("."))
    if flip:
        t = (s, 0, 0, -s, dx - X0 * s, size - dy + Y0 * s)
    else:
        t = (s, 0, 0, s, dx - X0 * s, dy - Y0 * s)
    parse_path(MARK, TransformPen(pen, t))
    return pen.getCommands()


def svg(fill, size=24, height=20):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}"><path fill="{fill}" d="{path_in_box(size, height)}"/></svg>\n'


def write(name, text):
    with open(os.path.join(MEDIA, name), "w") as f:
        f.write(text)


write("protoboard.svg", svg("currentColor"))
write("protoboard-light.svg", svg("#424242"))
write("protoboard-dark.svg", svg("#c5c5c5"))

# Discord's mark (its brand kit's symbol, one colour), for the link to the Discord server
DISCORD_SOURCE = os.path.normpath(os.path.join(PKG, "..", "..", "design", "brand", "discord-mark.svg"))
with open(DISCORD_SOURCE) as f:
    _discord = re.findall(r'<path[^>]*\sd="([^"]+)"', f.read())
if len(_discord) != 1:
    sys.exit(f"{DISCORD_SOURCE}: expected one path, found {len(_discord)}")
DISCORD = _discord[0]

# the icon font: the em square 1000, the mark 840 tall on the baseline box (codicon proportions)
UPM = 1000
fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder([".notdef", "protoboard-logo", "protoboard-discord"])
fb.setupCharacterMap({0xE000: "protoboard-logo", 0xE001: "protoboard-discord"})
glyph_pen = TTGlyphPen(None)
s = 840 / H
dx = (UPM - W * s) / 2
dy = (UPM - 840) / 2 - 80
parse_path(MARK, TransformPen(Cu2QuPen(glyph_pen, 1.0), (s, 0, 0, -s, dx - X0 * s, 840 + dy + Y0 * s)))
# Discord's mark is wide: 900 across, centred on the same middle as the Protoboard mark (y 420)
bounds = BoundsPen(None)
parse_path(DISCORD, bounds)
bx0, by0, bx1, by1 = bounds.bounds
ds = 900 / (bx1 - bx0)
discord_pen = TTGlyphPen(None)
parse_path(DISCORD, TransformPen(Cu2QuPen(discord_pen, 1.0), (ds, 0, 0, -ds, (UPM - 900) / 2 - bx0 * ds, 420 + (by0 + by1) / 2 * ds)))
empty = TTGlyphPen(None)
fb.setupGlyf({".notdef": empty.glyph(), "protoboard-logo": glyph_pen.glyph(), "protoboard-discord": discord_pen.glyph()})
fb.setupHorizontalMetrics({".notdef": (UPM, 0), "protoboard-logo": (UPM, 0), "protoboard-discord": (UPM, 0)})
fb.setupHorizontalHeader(ascent=880, descent=-120)
fb.setupNameTable({"familyName": "protoboard-icons", "styleName": "Regular"})
fb.setupOS2(sTypoAscender=880, sTypoDescender=-120, usWinAscent=880, usWinDescent=120)
fb.setupPost()
fb.font.flavor = "woff"
fb.save(os.path.join(MEDIA, "protoboard-icons.woff"))

# the extension's icon: the mark in the brand orange on a dark rounded tile, rendered by resvg
tile = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'
    '<rect width="128" height="128" rx="24" fill="#141414"/>'
    f'<path fill="#ff5c00" d="{path_in_box(128, 92)}"/></svg>'
)
render = (
    "const {Resvg}=require('@resvg/resvg-js');const fs=require('fs');"
    "fs.writeFileSync(process.argv[2], new Resvg(process.argv[1]).render().asPng());"
)
subprocess.run(["node", "-e", render, tile, os.path.join(MEDIA, "icon.png")], check=True, cwd=PKG)

with open(os.path.join(PKG, "..", "web-viewer", "src", "logo-mark.ts"), "w") as f:
    f.write(
        "// Generated by packages/vscode-protoboard/scripts/logo-assets.py: the Protoboard \"0\" mark (PB-916) in a 24 × 24 box.\n"
        f"export const MARK_PATH = {json.dumps(path_in_box(24, 20))};\n"
    )
print("logo assets written")
