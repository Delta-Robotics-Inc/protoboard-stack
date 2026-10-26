/**
 * What a part picture is drawn on (PB-917, the 2026-10-05 review: "dark if
 * we can, a light background at worst"). Most library thumbnails are renders
 * with a transparent background: they sit on the theme's own surface. A photo
 * shot on white keeps a light tile, and the white melts into the tile
 * (`mix-blend-mode: multiply`), so in a dark theme the tile is a soft grey
 * rather than a white square. Other photos keep their own background on the
 * tile. The picture itself is never changed (no re-rendering, no keying).
 *
 * The kind is read from the picture's border once it has loaded (a 32 × 32
 * sample on a canvas). When the canvas cannot be read (a picture from
 * another origin without CORS), the picture gets the light tile: what every
 * picture had before.
 */
export type Matte = "clear" | "white" | "photo";

/** The border of an RGBA sample (`size` × `size`), as the share of pixels that are transparent and that are near-white. */
export function borderStats(data: ArrayLike<number>, size: number): { clear: number; white: number } {
  let n = 0;
  let clear = 0;
  let white = 0;
  const at = (x: number, y: number) => {
    const i = (y * size + x) * 4;
    n++;
    const a = data[i + 3];
    if (a < 24) clear++;
    else if (a > 232 && Math.min(data[i], data[i + 1], data[i + 2]) >= 236) white++;
  };
  for (let x = 0; x < size; x++) {
    at(x, 0);
    at(x, size - 1);
  }
  for (let y = 1; y < size - 1; y++) {
    at(0, y);
    at(size - 1, y);
  }
  return { clear: clear / n, white: white / n };
}

/** The matte for a picture's border: mostly transparent → clear; mostly near-white → white; else a photo. */
export function matteOf(stats: { clear: number; white: number }): Matte {
  if (stats.clear >= 0.6) return "clear";
  if (stats.white + stats.clear >= 0.6) return "white";
  return "photo";
}

const known = new Map<string, Matte>();

/** The matte of a loaded picture (cached by source), or undefined when its pixels cannot be read. */
export function readMatte(img: HTMLImageElement): Matte | undefined {
  const cached = known.get(img.currentSrc || img.src);
  if (cached) return cached;
  const size = 32;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, size, size);
    const m = matteOf(borderStats(ctx.getImageData(0, 0, size, size).data, size));
    known.set(img.currentSrc || img.src, m);
    return m;
  } catch {
    return undefined;
  }
}

/** A matte read before (the same picture in another card). */
export const knownMatte = (src: string | undefined): Matte | undefined => (src ? known.get(src) : undefined);
