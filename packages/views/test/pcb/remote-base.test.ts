/** The dev board host's routes ignore the page's own query string and hash. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardHostBase, createEventStreamBoardHost } from "../../src/pcb/remote.js";

afterEach(() => vi.unstubAllGlobals());

describe("the board host's base URL", () => {
  it("drops the page's query and hash and keeps the folder", () => {
    expect(boardHostBase("http://127.0.0.1:5173/?drill=")).toBe("http://127.0.0.1:5173/");
    expect(boardHostBase("http://127.0.0.1:5173/view/index.html?drill=1#layout")).toBe("http://127.0.0.1:5173/view/");
    expect(boardHostBase("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173/");
    expect(boardHostBase("/app/?x=1")).toBe("/app/");
    expect(boardHostBase("")).toBe("");
  });

  it("lists boards from the folder even when the page URL has a query", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      calls.push(String(u));
      return new Response(JSON.stringify({ boards: [] }), { status: 200 });
    });
    const host = createEventStreamBoardHost({ base: "http://127.0.0.1:5173/?drill=" });
    expect(await host.list()).toEqual([]);
    expect(calls).toEqual(["http://127.0.0.1:5173/__protoboard/board/list"]);
  });
});
