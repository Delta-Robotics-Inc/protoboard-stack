/**
 * Examples the agent can reference: a folder of images (board renders, photos, found images), each with a caption
 * file of the same name (`<name>.md`) whose front matter gives a title, tags, and what to copy and what to avoid.
 * `indexExamples` writes `index.json` (deterministic: sorted by file, with each image's SHA-256); `searchExamples`
 * finds captions by tag or words across the shipped theme's, the user's and the project's folders.
 *
 *   ---
 *   title: Sensor board, top, after the restyle
 *   tags: [frames, tags, black-mask]
 *   copy: chamfered frames hugging each group; tags on the top edge
 *   avoid: designators under the module
 *   ---
 *   Free text about the image.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SHIPPED_THEMES_DIR } from "./theme.js";
import type { StylePlaces } from "./paths.js";

export const EXAMPLES_SCHEMA = "protoboard.board-style.examples/v1";
const IMAGE = /\.(png|jpe?g|webp|svg)$/i;

export interface Example {
  file: string;
  title: string;
  tags: string[];
  copy?: string;
  avoid?: string;
  caption: string;
  sha256: string;
}

export interface ExampleHit extends Example {
  dir: string;
  layer: "shipped" | "user" | "project";
}

/** Parse a caption file: simple front matter (key: value, tags as [a, b] or a, b), then free text. */
export function parseCaption(text: string): Omit<Example, "file" | "sha256"> {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  const fm: Record<string, string> = {};
  if (m)
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  const tags = (fm.tags ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return { title: fm.title ?? "", tags, ...(fm.copy ? { copy: fm.copy } : {}), ...(fm.avoid ? { avoid: fm.avoid } : {}), caption: (m ? m[2] : text).trim() };
}

/** Read a folder's examples (images with a caption file; images without one are listed with an empty caption). */
export function readExamples(dir: string): Example[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => IMAGE.test(f)).sort();
  return files.map((file) => {
    const capFile = join(dir, file.replace(IMAGE, ".md"));
    const cap = existsSync(capFile) ? parseCaption(readFileSync(capFile, "utf8")) : { title: file, tags: [], caption: "" };
    return { file, ...cap, sha256: createHash("sha256").update(readFileSync(join(dir, file))).digest("hex") };
  });
}

/** Write the folder's `index.json`. */
export function indexExamples(dir: string): Example[] {
  const list = readExamples(dir);
  const tmp = join(dir, `index.json.tmp-${process.pid}`);
  writeFileSync(tmp, `${JSON.stringify({ schema: EXAMPLES_SCHEMA, examples: list }, null, 2)}\n`);
  renameSync(tmp, join(dir, "index.json"));
  return list;
}

/** The example folders of a style: the shipped theme's, then the user's, then the project's. */
export function exampleDirs(themeId: string, places?: StylePlaces): { dir: string; layer: ExampleHit["layer"] }[] {
  const out: { dir: string; layer: ExampleHit["layer"] }[] = [{ dir: join(SHIPPED_THEMES_DIR, themeId, "examples"), layer: "shipped" }];
  if (places?.user) out.push({ dir: places.user.examples, layer: "user" });
  if (places?.project) out.push({ dir: places.project.examples, layer: "project" });
  return out;
}

/** Examples whose tags include every tag asked for and whose text contains every word asked for. */
export function searchExamples(dirs: { dir: string; layer: ExampleHit["layer"] }[], q: { tags?: string[]; text?: string } = {}): ExampleHit[] {
  const tags = (q.tags ?? []).map((t) => t.toLowerCase());
  const words = (q.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const out: ExampleHit[] = [];
  for (const { dir, layer } of dirs)
    for (const e of readExamples(dir)) {
      if (!tags.every((t) => e.tags.includes(t))) continue;
      const hay = `${e.title} ${e.caption} ${e.copy ?? ""} ${e.avoid ?? ""} ${e.tags.join(" ")}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      out.push({ ...e, dir, layer });
    }
  return out;
}
