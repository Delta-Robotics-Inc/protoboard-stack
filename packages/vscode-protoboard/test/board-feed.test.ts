/**
 * The layout tab's board messages between a viewer tab and the extension host (PCB editor Phase 1): the page asks
 * for the boards and opens, closes or rechecks one by key; a key is never a path. The feed the host relays is the
 * views package's BoardFeed, read only.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFromWebview } from "../../web-viewer/src/vscode/protocol.js";
import { BoardFeed, findBoards } from "../../views/src/pcb/host/index.js";
import type { BoardFeedMessage } from "../../views/src/pcb/types.js";

describe("board messages from a viewer tab", () => {
  it("are parsed by key, and a path or junk is refused", () => {
    expect(parseFromWebview({ type: "boards" })).toEqual({ type: "boards" });
    expect(parseFromWebview({ type: "boardOpen", board: "airnode__board" })).toEqual({ type: "boardOpen", board: "airnode__board" });
    expect(parseFromWebview({ type: "boardCheck", board: "board" })).toEqual({ type: "boardCheck", board: "board" });
    expect(parseFromWebview({ type: "boardOpen", board: "../../etc" })).toBeUndefined();
    expect(parseFromWebview({ type: "boardClose", board: "C:/x" })).toBeUndefined();
    expect(parseFromWebview({ type: "boardOpen" })).toBeUndefined();
  });
});

describe("the feed the extension host relays", () => {
  it("lists a project's boards and sends the snapshot, then the derived data", async () => {
    const root = mkdtempSync(join(tmpdir(), "pb-board-feed-"));
    try {
      writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
      cpSync(fileURLToPath(new URL("../../board/test/fixtures/airnode-c3", import.meta.url)), join(root, "airnode", "board"), { recursive: true });
      const boards = findBoards(root);
      expect(boards).toEqual([expect.objectContaining({ key: "airnode__board", dir: "airnode/board" })]);
      const feed = await BoardFeed.open({ dir: join(root, boards[0].dir), key: boards[0].key, servicePollMs: 0, analyze: { crossCheck: false } });
      const got: BoardFeedMessage[] = [];
      const derived = new Promise<void>((done) => {
        feed.subscribe((m) => {
          got.push(m);
          if (m.type === "derived") done();
        });
      });
      await derived;
      expect(got[0]).toMatchObject({ type: "snapshot", board: "airnode__board", mode: "files" });
      const d = got.find((m): m is Extract<BoardFeedMessage, { type: "derived" }> => m.type === "derived")!.derived;
      expect(d.checks.ran).toBe(true);
      await feed.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
