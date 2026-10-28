import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class TreeItem {
    id?: string;
    iconPath?: unknown;
    tooltip?: string;
    command?: unknown;
    constructor(public label: string) {}
  }
  class ThemeIcon {
    constructor(public id: string) {}
  }
  return { TreeItem, ThemeIcon, window: {}, commands: {}, env: {}, Uri: { parse: (s: string) => s } };
});

const { HELP_LINKS, helpCommand, helpItems, helpMarkdown } = await import("../src/help.js");
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import pkg from "../package.json" with { type: "json" };

/** The glyph names of a woff's post table (format 2). */
function fontGlyphNames(woff: Buffer): string[] {
  const tables = woff.readUInt16BE(12);
  for (let i = 0; i < tables; i++) {
    const at = 44 + i * 20;
    if (woff.toString("latin1", at, at + 4) !== "post") continue;
    const [offset, compLength, origLength] = [woff.readUInt32BE(at + 4), woff.readUInt32BE(at + 8), woff.readUInt32BE(at + 12)];
    const raw = woff.subarray(offset, offset + compLength);
    const post = compLength < origLength ? inflateSync(raw) : raw;
    if (post.readUInt32BE(0) !== 0x00020000) return [];
    const count = post.readUInt16BE(32);
    let p = 34 + count * 2;
    const names: string[] = [];
    while (p < post.length) {
      const n = post[p];
      names.push(post.toString("latin1", p + 1, p + 1 + n));
      p += 1 + n;
    }
    return names;
  }
  return [];
}

describe("documentation, feedback and Discord (PB-1070)", () => {
  it("are three links, each with a command the manifest declares", () => {
    expect(HELP_LINKS.map((l) => l.label)).toEqual(["Documentation", "Feedback and Issues", "Discord"]);
    const declared = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
    for (const l of HELP_LINKS) {
      expect(declared.has(helpCommand(l)), helpCommand(l)).toBe(true);
      expect(l.url).toMatch(/^https:\/\//);
    }
  });

  it("are a view of the Cloud side bar, shown in every window, whatever its height", () => {
    const view = (pkg.contributes.views as Record<string, { id: string; when?: string; name: string }[]>)["protoboard-cloud"].find((v) => v.id === "protoboard.help");
    expect(view?.name).toBe("Help");
    expect(view?.when).toBeUndefined();
  });

  it("each row opens its link through its command", () => {
    const items = helpItems() as unknown as { label: string; command: { command: string } }[];
    expect(items.map((i) => [i.label, i.command.command])).toEqual([
      ["Documentation", "protoboard.help.docs"],
      ["Feedback and Issues", "protoboard.help.feedback"],
      ["Discord", "protoboard.help.discord"],
    ]);
  });

  it("show Discord's own mark, a monochrome icon of the extension's font that takes the theme's colour", () => {
    const discord = HELP_LINKS.find((l) => l.id === "discord")!;
    expect(discord.icon).toBe("protoboard-discord");
    expect(pkg.contributes.icons["protoboard-discord"].default).toEqual({ fontPath: "media/protoboard-icons.woff", fontCharacter: "\\E001" });
    expect(pkg.contributes.commands.find((c: { command: string }) => c.command === "protoboard.help.discord")?.icon).toBe("$(protoboard-discord)");
    // the font holds the glyph, by name in its post table
    const font = readFileSync(fileURLToPath(new URL("../media/protoboard-icons.woff", import.meta.url)));
    expect(font.subarray(0, 4).toString("latin1")).toBe("wOFF");
    expect(fontGlyphNames(font)).toContain("protoboard-discord");
  });

  it("are one line of command links for the status bar's tooltip", () => {
    expect(helpMarkdown()).toBe("[$(book) Documentation](command:protoboard.help.docs) · [$(feedback) Feedback and Issues](command:protoboard.help.feedback) · [$(protoboard-discord) Discord](command:protoboard.help.discord)");
  });
});
