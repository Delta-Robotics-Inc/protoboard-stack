/**
 * The layout view's plumbing without a browser: the `layout` tab is offered at the root only while the host knows
 * a board folder, and the page-side board source follows a host feed (snapshot, commits with their records,
 * derived data) exactly as the board service it mirrors.
 */
import { afterEach, describe, expect, it } from "vitest";
import { HUMAN, openBoardService, snapshotToWire } from "@protoboardai/board";
import { airnodeC3, AIRNODE_C3_NETLIST } from "@protoboardai/board/fixtures/airnode-c3";
import { BUILTIN_TABS, tabsFor } from "../src/tabs.js";
import { setKnownBoards } from "../src/pcb/known-boards.js";
import { openBoardSource, type BoardChannel } from "../src/pcb/remote.js";
import type { BoardFeedMessage } from "../src/pcb/types.js";

const bundle = { root: "sys", definitions: [{ id: "sys", name: "System", interfaces: [], children: [] }] } as never;
const root = (bundle as { definitions: { id: string }[] }).definitions[0] as never;

describe("the layout tab", () => {
  afterEach(() => setKnownBoards([]));
  it("is registered with the built-in tabs", () => {
    expect(BUILTIN_TABS.map((t) => t.id)).toContain("layout");
  });
  it("is offered at the root only when the host knows a board folder", () => {
    expect(tabsFor(root, bundle, "").map((t) => t.id)).not.toContain("layout");
    setKnownBoards([{ key: "airnode__board", dir: "airnode/board", name: "Airnode C3" }]);
    expect(tabsFor(root, bundle, "").map((t) => t.id)).toContain("layout");
    expect(tabsFor(root, bundle, "child").map((t) => t.id)).not.toContain("layout");
  });
});

describe("the page's board source", () => {
  it("follows a feed: the snapshot, a commit's records, derived data", async () => {
    const svc = openBoardService({ document: airnodeC3(), netlist: AIRNODE_C3_NETLIST, journal: false, ownerLock: false });
    const key = "airnode";
    let push: ((m: BoardFeedMessage) => void) | undefined;
    const channel: BoardChannel = {
      subscribe(l) {
        push = l;
        queueMicrotask(() => l({ type: "snapshot", board: key, mode: "service", snapshot: snapshotToWire(svc.snapshot()) }));
        return () => (push = undefined);
      },
    };
    const { source, close } = await openBoardSource(key, channel);
    expect(source.snapshot().doc.records.size).toBe(svc.snapshot().doc.records.size);
    const seen: string[] = [];
    source.subscribe((e) => seen.push(e.type));
    // a commit on the service, relayed as the host relays it: the event plus the records it changed
    svc.subscribe((e) => {
      if (e.type !== "commit") return;
      const s = svc.snapshot();
      const ids = [...e.changed, ...Object.values(e.created)].filter((id) => !e.removed.includes(id));
      push?.({ type: "commit", board: key, event: e, puts: ids.map((id) => s.doc.records.get(id)!).filter(Boolean), removes: e.removed, versions: Object.fromEntries(ids.map((id) => [id, s.version(id)])) });
    });
    const r = svc.apply({ batchId: "t-move", label: "move the LDO", ops: [{ op: "footprint.move", ids: ["fp:power/ldo"], dx: 1_000_000, dy: 0, tracks: "stay" }] }, HUMAN);
    expect(r.status).toBe("applied");
    expect(seen).toEqual(["commit"]);
    const mine = source.snapshot();
    const theirs = svc.snapshot();
    expect(mine.seq).toBe(theirs.seq);
    expect(mine.doc.records.get("fp:power/ldo")).toEqual(theirs.doc.records.get("fp:power/ldo"));
    expect(mine.version("fp:power/ldo")).toBe(theirs.version("fp:power/ldo"));
    expect(mine.query.at({ x: -9_000_000, y: -3_000_000 }, { kinds: ["footprint"] }).map((i) => i.id)).toEqual(theirs.query.at({ x: -9_000_000, y: -3_000_000 }, { kinds: ["footprint"] }).map((i) => i.id));
    const got: unknown[] = [];
    source.onDerived((d) => got.push(d?.seq));
    push?.({ type: "derived", board: key, derived: { epoch: theirs.epoch, seq: theirs.seq, checks: { ran: false }, findings: [], ratsnest: [], fills: [] } });
    expect(got).toEqual([undefined, theirs.seq]);
    close();
    svc.close({ save: false });
  });

  it("rejects when the host reports an error before any snapshot", async () => {
    const channel: BoardChannel = { subscribe: (l) => (queueMicrotask(() => l({ type: "error", board: "x", message: "no board folder with key x" })), () => {}) };
    await expect(openBoardSource("x", channel)).rejects.toThrow(/no board folder/);
  });
});
