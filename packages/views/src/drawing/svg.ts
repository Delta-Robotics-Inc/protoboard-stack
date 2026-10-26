/**
 * A board drawing's SVG (a circuit tool's schematic or PCB layer, by its
 * standard-output file name), made safe to put in the page and themed.
 *
 * The file is parsed with a small XML tokenizer and written out again from
 * an allow-list: drawing elements and presentation attributes only, no
 * scripts, no event handlers, no external references, no `<style>` (the view
 * brings its own rules). Ids are prefixed so two drawings on a page never
 * share one. Colours the tool wrote are replaced by the roles a palette
 * gives them (`var(--pb-d-<role>)`), so the drawing follows the shell's
 * theme; a colour the palette does not know stays as it is.
 *
 * No DOM here: it runs in Node for tests and in any shell.
 */

/** A known colour → the role it plays in the drawing (`ink`, `wire`, `copper`, …). */
export type Palette = ReadonlyMap<string, string>;

export interface ThemedSvg {
  /** The `<svg>` element's markup, ready for `innerHTML`. */
  markup: string;
  /**
   * The tool's own class rules (its `<style>`), themed and safe, as
   * declarations per class selector: the view scopes them to its drawing.
   */
  rules: { selector: string; declarations: string }[];
  /** The drawing's viewBox (or 0 0 width height). */
  viewBox?: [number, number, number, number];
  /** Every colour seen and the role it got (undefined: kept). */
  colours: Map<string, string | undefined>;
  /**
   * The tool that wrote the file, when it says (`kicad`: KiCad's Eeschema or
   * Pcbnew export; `tscircuit`: circuit-to-svg). KiCad writes a board's
   * bottom already mirrored, and its schematic's text as strokes with an
   * invisible `<text>` beside each.
   */
  generator?: "kicad" | "tscircuit";
}

const ELEMENTS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textPath",
  "defs", "pattern", "clipPath", "mask", "use", "symbol", "marker", "linearGradient", "radialGradient", "stop", "title", "desc",
]);

const ATTRIBUTES = new Set([
  "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "points", "transform", "viewBox",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "stroke-miterlimit",
  "fill-opacity", "fill-rule", "clip-rule", "opacity", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline",
  "alignment-baseline", "letter-spacing", "id", "class", "style", "patternUnits", "patternContentUnits", "patternTransform", "href", "xlink:href",
  "clip-path", "mask", "marker-start", "marker-mid", "marker-end", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform",
  "vector-effect", "shape-rendering", "preserveAspectRatio", "visibility", "display", "markerWidth", "markerHeight",
  "refX", "refY", "orient", "markerUnits", "dx", "dy", "rotate", "textLength", "lengthAdjust", "startOffset", "fx", "fy", "spreadMethod",
]);

/** Style properties kept from a `style` attribute. */
const STYLE_PROPS = new Set([
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-opacity", "fill-opacity", "opacity",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "letter-spacing", "visibility", "display",
  "background-color", "stop-color", "stop-opacity", "vector-effect", "shape-rendering",
]);

/** Attributes and style properties that carry a colour. */
const COLOUR_PROPS = new Set(["fill", "stroke", "stop-color", "background-color"]);

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeAttr = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]);

/** Decode the XML entities an attribute value may hold (numeric and the five named ones). */
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const l = e.toLowerCase();
    if (l === "amp") return "&";
    if (l === "lt") return "<";
    if (l === "gt") return ">";
    if (l === "quot") return '"';
    if (l === "apos") return "'";
    const n = l.startsWith("#x") ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
  });
}

/** A colour written the canonical way (`rgb(1, 2, 3)` and `#010203` both as `#010203`), for palette lookup. */
export function canonicalColour(value: string): string {
  const v = value.trim().toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (rgb) {
    const hex = [rgb[1], rgb[2], rgb[3]].map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0")).join("");
    return rgb[4] !== undefined && Number(rgb[4]) < 1 ? `#${hex}/${Number(rgb[4])}` : `#${hex}`;
  }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const named: Record<string, string> = { white: "#ffffff", black: "#000000", red: "#ff0000" };
  return named[v] ?? v;
}

/** A value safe in a style declaration or attribute: no markup, no external url, no script. */
function safeValue(v: string): boolean {
  if (/[<>]/.test(v)) return false;
  if (/expression\s*\(|javascript:|@import|behavior\s*:/i.test(v)) return false;
  const urls = v.match(/url\(([^)]*)\)/gi) ?? [];
  return urls.every((u) => /^url\(\s*['"]?#[\w:.-]+['"]?\s*\)$/i.test(u));
}

interface Token {
  kind: "open" | "close" | "text";
  name?: string;
  attrs?: [string, string][];
  selfClosing?: boolean;
  text?: string;
}

/** The tokens of an XML document (comments, processing instructions, doctypes and CDATA dropped). */
export function* tokens(xml: string): Generator<Token> {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      yield { kind: "text", text: xml.slice(i) };
      return;
    }
    if (lt > i) yield { kind: "text", text: xml.slice(i, lt) };
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt + 2);
      if (end < 0) return;
      yield { kind: "close", name: xml.slice(lt + 2, end).trim() };
      i = end + 1;
      continue;
    }
    // an opening tag: name, then attributes (quoted values may hold ">")
    let j = lt + 1;
    while (j < n && /[^\s/>]/.test(xml[j])) j++;
    const name = xml.slice(lt + 1, j);
    const attrs: [string, string][] = [];
    let selfClosing = false;
    for (;;) {
      while (j < n && /\s/.test(xml[j])) j++;
      if (j >= n) return;
      if (xml[j] === ">") {
        j++;
        break;
      }
      if (xml[j] === "/" && xml[j + 1] === ">") {
        selfClosing = true;
        j += 2;
        break;
      }
      let k = j;
      while (k < n && /[^\s=/>]/.test(xml[k])) k++;
      const attr = xml.slice(j, k);
      j = k;
      while (j < n && /\s/.test(xml[j])) j++;
      let value = "";
      if (xml[j] === "=") {
        j++;
        while (j < n && /\s/.test(xml[j])) j++;
        const q = xml[j];
        if (q === '"' || q === "'") {
          const end = xml.indexOf(q, j + 1);
          if (end < 0) return;
          value = xml.slice(j + 1, end);
          j = end + 1;
        } else {
          let e = j;
          while (e < n && /[^\s>]/.test(xml[e])) e++;
          value = xml.slice(j, e);
          j = e;
        }
      }
      if (attr) attrs.push([attr, decode(value)]);
      if (k === j && !attr) j++;
    }
    yield { kind: "open", name, attrs, selfClosing };
    i = j;
  }
}

export interface ThemeSvgOptions {
  palette: Palette;
  /** Prefix for every id (unique per drawing on a page). */
  idPrefix: string;
  /** The role of a colour by where it is (an element's class, the property), before the palette. */
  roleOf?: (colour: string, at: { element: string; className: string; property: string }) => string | undefined;
  /**
   * Mirror the drawing left to right inside its viewBox: a board's bottom
   * side as it is seen from below. The content goes in one
   * `<g data-pb-mirror="…">` (its value is the axis sum, 2·x + width).
   */
  mirror?: boolean;
}

/** An SVG affine map, `[a, b, c, d, e, f]` as in `matrix(a b c d e f)`. */
export type Affine = [number, number, number, number, number, number];
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const mul = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
/** `about(x, y, m)`: `m` done about the point (x, y). */
const about = (x: number, y: number, m: Affine): Affine => mul(mul([1, 0, 0, 1, x, y], m), [1, 0, 0, 1, -x, -y]);

/** An SVG `transform` list as one affine map (identity when there is none). */
export function affineOf(transform: string | undefined): Affine {
  let m = IDENTITY;
  for (const f of (transform ?? "").matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = f[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const rad = ((a[0] ?? 0) * Math.PI) / 180;
    let n: Affine = IDENTITY;
    if (f[1] === "matrix" && a.length >= 6) n = [a[0], a[1], a[2], a[3], a[4], a[5]];
    else if (f[1] === "translate") n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (f[1] === "scale") n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (f[1] === "rotate") {
      n = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0];
      if (a.length >= 3) n = about(a[1], a[2], n);
    } else if (f[1] === "skewX") n = [1, 0, Math.tan(rad), 1, 0, 0];
    else if (f[1] === "skewY") n = [1, Math.tan(rad), 0, 1, 0, 0];
    if (n.every(Number.isFinite)) m = mul(m, n);
  }
  return m;
}

/**
 * How text drawn with `m` (its own and every ancestor's linear map) reads
 * on screen: `mirrored` when it is a mirror image, and the direction its
 * baseline runs in degrees (0 left to right, -90 bottom to top, screen y down).
 */
export function textReading(m: Affine): { mirrored: boolean; angle: number } {
  return { mirrored: m[0] * m[3] - m[1] * m[2] < 0, angle: (Math.atan2(m[1], m[0]) * 180) / Math.PI };
}

/** A baseline the owner's rule allows: left to right, or bottom to top (top facing left). */
export const readableAngle = (angle: number): boolean => angle > -135 + 1e-6 && angle <= 45 + 1e-6;

const SWAP_ANCHOR: Record<string, string> = { start: "end", end: "start" };

/** Parse, sanitise and theme an SVG document. */
export function themeSvg(source: string, options: ThemeSvgOptions): ThemedSvg {
  const out: string[] = [];
  const colours = new Map<string, string | undefined>();
  const stack: { name: string; kept: boolean; linear: Affine }[] = [];
  let mirrorSum: number | undefined;
  let dropDepth = 0;
  let viewBox: [number, number, number, number] | undefined;
  let root = true;
  let inStyle = false;
  let generator: ThemedSvg["generator"];
  const css: string[] = [];
  const prefixId = (id: string) => `${options.idPrefix}${id.replace(/[^\w:.-]/g, "_")}`;
  const recolour = (value: string, element: string, className: string, property: string): string => {
    const v = value.trim();
    if (!v || v === "none" || v === "transparent" || v === "currentColor" || v.startsWith("url(")) {
      return v.startsWith("url(") ? v.replace(/url\(\s*['"]?#([\w:.-]+)['"]?\s*\)/g, (_, id: string) => `url(#${prefixId(id)})`) : v;
    }
    const c = canonicalColour(v);
    const role = options.roleOf?.(c, { element, className, property }) ?? options.palette.get(c);
    colours.set(c, role);
    return role ? `var(--pb-d-${role})` : v;
  };

  for (const t of tokens(source)) {
    if (t.kind === "text") {
      if (inStyle) css.push(t.text!);
      if (!generator && stack.length && (stack[stack.length - 1].name === "desc" || stack[stack.length - 1].name === "title")) {
        if (/Eeschema|Pcbnew|PCBNEW|KiCad/.test(t.text!)) generator = "kicad";
      }
      if (dropDepth || !stack.length) continue;
      const parent = stack[stack.length - 1].name;
      // text only where SVG draws it; anything that looks like markup was already split off by the tokenizer
      if (["text", "tspan", "textPath", "title", "desc"].includes(parent)) out.push(t.text!.replace(/[<>]/g, ""));
      continue;
    }
    if (t.kind === "close") {
      const top = stack.pop();
      if (!top) continue;
      if (top.name === "style") inStyle = false;
      if (!top.kept) dropDepth--;
      else if (!dropDepth) out.push(`${!stack.length && mirrorSum !== undefined ? "</g>" : ""}</${top.name}>`);
      continue;
    }
    const name = t.name!;
    const kept = !dropDepth && ELEMENTS.has(name) && (!root || name === "svg");
    if (name === "style" && !dropDepth && !t.selfClosing) inStyle = true;
    if (!kept) {
      if (!t.selfClosing) {
        stack.push({ name, kept: false, linear: IDENTITY });
        dropDepth++;
      }
      continue;
    }
    const attrs = new Map(t.attrs);
    const className = attrs.get("class") ?? "";
    if (!generator && attrs.has("data-software-used-string") && /circuit-to-svg|tscircuit/i.test(attrs.get("data-software-used-string") ?? "")) generator = "tscircuit";
    const written: string[] = [];
    const styles: string[] = [];
    /** The roles this element's own stroke and fill got (`data-pb-stroke`, `data-pb-fill`: what the view finds wires and bodies by). */
    const roles: { stroke?: string; fill?: string } = {};
    const noteRole = (prop: string, v: string) => {
      const m = /^var\(--pb-d-([\w-]+)\)$/.exec(v);
      if (m && (prop === "stroke" || prop === "fill")) roles[prop] ??= m[1];
      return v;
    };
    for (const [k, raw] of t.attrs!) {
      if (k.startsWith("data-")) {
        if (/^data-[\w-]+$/.test(k)) written.push(`${k}="${escapeAttr(raw)}"`);
        continue;
      }
      if (!ATTRIBUTES.has(k)) continue;
      let v = raw;
      if (k === "id") v = prefixId(v);
      else if (k === "href" || k === "xlink:href") {
        if (!/^#[\w:.-]+$/.test(v)) continue;
        written.push(`href="#${escapeAttr(prefixId(v.slice(1)))}"`);
        continue;
      } else if (k === "style") {
        for (const decl of v.split(";")) {
          const at = decl.indexOf(":");
          if (at < 0) continue;
          const prop = decl.slice(0, at).trim().toLowerCase();
          const val = decl.slice(at + 1).trim();
          if (!STYLE_PROPS.has(prop) || !safeValue(val)) continue;
          styles.push(`${prop}: ${COLOUR_PROPS.has(prop) ? noteRole(prop, recolour(val, name, className, prop)) : val}`);
        }
        continue;
      } else if (!safeValue(v)) continue;
      if (COLOUR_PROPS.has(k)) {
        // a themed colour must be a style (presentation attributes take no var())
        const c = noteRole(k, recolour(v, name, className, k));
        if (c.startsWith("var(")) styles.push(`${k}: ${c}`);
        else written.push(`${k}="${escapeAttr(c)}"`);
        continue;
      }
      if (["clip-path", "mask", "marker-start", "marker-mid", "marker-end"].includes(k)) v = recolour(v, name, className, k);
      written.push(`${k}="${escapeAttr(v)}"`);
    }
    // text reads upright (or bottom to top) whatever the tool or the mirror did to it
    const parentLinear = stack.length ? stack[stack.length - 1].linear : IDENTITY;
    let linear = mul(parentLinear, affineOf(attrs.get("transform")));
    if (name === "text") {
      const px = parseFloat(attrs.get("x") ?? "0") || 0;
      const py = parseFloat(attrs.get("y") ?? "0") || 0;
      let own = affineOf(attrs.get("transform"));
      let swap = false;
      let fixed = false;
      if (textReading(linear).mirrored) {
        own = mul(own, about(px, py, [-1, 0, 0, 1, 0, 0]));
        swap = !swap;
        fixed = true;
      }
      if (!readableAngle(textReading(mul(parentLinear, own)).angle)) {
        own = mul(own, about(px, py, [-1, 0, 0, -1, 0, 0]));
        swap = !swap;
        fixed = true;
      }
      if (fixed) {
        linear = mul(parentLinear, own);
        const round = (v: number) => String(Math.round(v * 1e6) / 1e6 || 0);
        const next = `transform="matrix(${own.map(round).join(",")})"`;
        const at = written.findIndex((w) => w.startsWith("transform="));
        if (at >= 0) written[at] = next;
        else written.push(next);
        // the text keeps its place: its anchor flips with it
        const anchor = attrs.get("text-anchor");
        if (swap && anchor && SWAP_ANCHOR[anchor]) {
          const i = written.findIndex((w) => w.startsWith("text-anchor="));
          if (i >= 0) written[i] = `text-anchor="${SWAP_ANCHOR[anchor]}"`;
        }
      }
    }
    let opening = "";
    if (root) {
      root = false;
      const vb = attrs.get("viewBox")?.trim().split(/[\s,]+/).map(Number);
      const w = parseFloat(attrs.get("width") ?? "");
      const h = parseFloat(attrs.get("height") ?? "");
      if (vb?.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) viewBox = vb as [number, number, number, number];
      else if (w > 0 && h > 0) {
        viewBox = [0, 0, w, h];
        written.push(`viewBox="0 0 ${w} ${h}"`);
      }
      if (options.mirror && viewBox && !t.selfClosing) {
        mirrorSum = 2 * viewBox[0] + viewBox[2];
        opening = `<g data-pb-mirror="${mirrorSum}" transform="matrix(-1 0 0 1 ${mirrorSum} 0)">`;
        linear = mul(linear, [-1, 0, 0, 1, mirrorSum, 0]);
      }
    }
    // the page the tool draws behind the drawing (a rect as large as the viewBox): the view's background, never fitted to
    if (name === "rect" && viewBox && !dropDepth) {
      const n = (k: string) => parseFloat(attrs.get(k) ?? "0") || 0;
      const [x, y, w, h] = [n("x"), n("y"), n("width"), n("height")];
      if (w >= viewBox[2] * 0.98 && h >= viewBox[3] * 0.98 && x <= viewBox[0] + viewBox[2] * 0.01 && y <= viewBox[1] + viewBox[3] * 0.01) written.push('data-pb-page=""');
    }
    if (roles.stroke) written.push(`data-pb-stroke="${roles.stroke}"`);
    if (roles.fill) written.push(`data-pb-fill="${roles.fill}"`);
    if (styles.length) written.push(`style="${escapeAttr(styles.join("; "))}"`);
    out.push(`<${name}${written.length ? ` ${written.join(" ")}` : ""}${t.selfClosing ? "/>" : ">"}${opening}`);
    if (!t.selfClosing) stack.push({ name, kept: true, linear });
  }
  // close what the file left open
  while (stack.length) {
    const top = stack.pop()!;
    if (top.kept && !dropDepth) out.push(`${!stack.length && mirrorSum !== undefined ? "</g>" : ""}</${top.name}>`);
    if (!top.kept) dropDepth--;
  }
  // the tool's class rules: class selectors only, safe properties, colours by role
  const rules: ThemedSvg["rules"] = [];
  for (const m of css.join("").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (!/^\.[\w-]+(\s*,\s*\.[\w-]+)*$/.test(selector)) continue;
    const decls: string[] = [];
    for (const decl of m[2].split(";")) {
      const at = decl.indexOf(":");
      if (at < 0) continue;
      const prop = decl.slice(0, at).trim().toLowerCase();
      const val = decl.slice(at + 1).trim();
      // faces are the view's (its theme's), not the tool's
      if (!STYLE_PROPS.has(prop) || prop === "font-family" || !safeValue(val)) continue;
      decls.push(`${prop}: ${COLOUR_PROPS.has(prop) ? recolour(val, "style", selector, prop) : val}`);
    }
    if (decls.length) rules.push({ selector, declarations: decls.join("; ") });
  }
  return { markup: out.join(""), rules, viewBox, colours, ...(generator ? { generator } : {}) };
}

/** The tool's rules scoped to one drawing (`scope` is a selector for its container). */
export const scopedRules = (rules: ThemedSvg["rules"], scope: string): string =>
  rules.map((r) => `${r.selector.split(",").map((x) => `${scope} ${x.trim()}`).join(", ")} { ${r.declarations} }`).join("\n");
