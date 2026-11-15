/**
 * The System Map's data in a VS Code page (a viewer tab's System Map tab and
 * the extension's System Map panel): the map comes from the EXTENSION, not
 * the dev server. It is the map of the stack the extension runs, whatever
 * project is open, and it is there in a window with no project at all.
 *
 * `load()` posts `sysmap` and resolves on the extension's answer (protocol.ts
 * `SysmapReply`); loads that overlap all wait for the next answer, which is
 * the extension's current map either way. `refresh()` (the panel's Rebuild)
 * posts `sysmap` with `refresh`: the extension builds the map again, and its
 * answer goes to the subscribers, whose next `load()` takes it without asking
 * again (a failed rebuild is not built a second time). An answer nobody
 * asked for is handled the same way. `openFile` posts `sysmapOpen`; the
 * extension checks the path. No React here.
 */
import type { SysmapData, SysmapPayload } from "@protoboardai/views";
import type { FromWebview, SysmapReply } from "./protocol.js";

export interface VsCodeSysmapData extends SysmapData {
  /** The extension's answer (the page's message handler passes every `sysmap` message here). */
  receive(reply: SysmapReply): void;
}

const hasGraph = (r: SysmapReply): r is Extract<SysmapReply, { graph: unknown }> => {
  const g = (r as { graph?: unknown }).graph;
  return !!g && typeof g === "object" && Array.isArray((g as { items?: unknown }).items) && Array.isArray((g as { links?: unknown }).links);
};

const settle = (r: SysmapReply): Promise<SysmapPayload> =>
  hasGraph(r) ? Promise.resolve({ graph: r.graph }) : Promise.reject(new Error("error" in r && typeof r.error === "string" ? r.error : "the extension's System Map answer has no graph"));

export function createVsCodeSysmapData(post: (m: FromWebview) => void): VsCodeSysmapData {
  const listeners = new Set<() => void>();
  let waiting: { ok: (p: SysmapPayload) => void; fail: (e: Error) => void }[] = [];
  /** A rebuild was asked for and not answered yet. */
  let refreshing = false;
  /** An answer the subscribers were told about: the next load takes it. */
  let primed: SysmapReply | undefined;
  return {
    load(): Promise<SysmapPayload> {
      if (primed) {
        const r = primed;
        primed = undefined;
        return settle(r);
      }
      const p = new Promise<SysmapPayload>((ok, fail) => waiting.push({ ok, fail }));
      // one question for the loads that overlap: the answer settles them all
      if (waiting.length === 1) post({ type: "sysmap" });
      return p;
    },
    refresh() {
      refreshing = true;
      primed = undefined;
      post({ type: "sysmap", refresh: true });
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    openFile: (path) => post({ type: "sysmapOpen", path }),
    receive(reply) {
      const pending = waiting;
      waiting = [];
      for (const w of pending) settle(reply).then(w.ok, w.fail);
      // a rebuild's answer, or one nobody asked for: the subscribers load again and get it
      if (refreshing || !pending.length) {
        refreshing = false;
        primed = reply;
        for (const l of [...listeners]) l();
      }
    },
  };
}
