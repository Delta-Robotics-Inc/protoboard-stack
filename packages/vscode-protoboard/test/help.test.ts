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
import pkg from "../package.json" with { type: "json" };

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
    expect(view?.name).toBe("Help and Feedback");
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

  it("are one line of command links for the status bar's tooltip", () => {
    expect(helpMarkdown()).toBe("[$(book) Documentation](command:protoboard.help.docs) · [$(feedback) Feedback and Issues](command:protoboard.help.feedback) · [$(comment-discussion) Discord](command:protoboard.help.discord)");
  });
});
