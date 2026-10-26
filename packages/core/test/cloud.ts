/**
 * The Protoboard Cloud parts service for tests: the real server from a
 * protoboard-cloud checkout (cloud-checkout.ts: PROTOBOARD_CLOUD_DIR, else
 * ../protoboard-cloud), started as its own process on an ephemeral port with
 * a temporary data directory, and stopped afterwards. The client is this
 * repository's packages/cloud.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PART_REVISION_SCHEMA, PartsClient, sealDraft, sha256Hex, type EnvelopeArtifact, type EvidenceRef, type PartRef, type PartRevisionDraft, type UhdModuleDef } from "@protoboardai/cloud/client";
import { cloudCheckout } from "./cloud-checkout.js";

export const TOKEN = "test-publish-token";

export interface CloudService {
  url: string;
  dataDir: string;
  /** Write access, with the test token. */
  client: PartsClient;
  stop: () => Promise<void>;
}


/** The protoboard-cloud checkout: the service and the library at its root (cloud-checkout.ts). */
export const cloudRepo = () => {
  const repo = cloudCheckout();
  if (!repo) throw new Error("no parts service: set PROTOBOARD_CLOUD_DIR to a protoboard-cloud checkout with its dependencies installed (default ../protoboard-cloud)");
  return repo;
};

export async function startCloud(): Promise<CloudService> {
  const dataDir = mkdtempSync(join(tmpdir(), "pb-parts-test-"));
  const repo = cloudRepo();
  const tsxCli = createRequire(join(repo, "package.json")).resolve("tsx/cli");
  const child: ChildProcess = spawn(process.execPath, ["--no-warnings", tsxCli, join(repo, "src/server/main.ts")], {
    cwd: repo,
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", PB_CLOUD_DATA_DIR: dataDir, PB_CLOUD_PUBLISH_TOKEN: TOKEN, PB_CLOUD_PUBLISHER: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`parts service did not start:\n${log}`)), 30000);
    const onData = (b: Buffer) => {
      log += b.toString();
      const m = /parts service on (http:\/\/[^\s/]+)\/v1/.exec(log);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`parts service exited (${code}):\n${log}`));
    });
  });
  return {
    url,
    dataDir,
    client: new PartsClient({ baseUrl: url, token: TOKEN }),
    stop: async () => {
      if (child.exitCode === null) {
        const exited = new Promise((r) => child.once("exit", r));
        child.kill("SIGTERM");
        await exited;
      }
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** A port nothing listens on: bound once, then released. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  await new Promise((r) => server.close(r));
  return port;
}

/** Bytes a test publishes, by blob address. */
export class Blobs {
  readonly bytes = new Map<string, Uint8Array>();
  add(content: string | Uint8Array): { sha256: string; size: number } {
    const b = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const sha256 = sha256Hex(b);
    this.bytes.set(sha256, b);
    return { sha256, size: b.length };
  }
  source = (sha: string): Uint8Array => this.bytes.get(sha)!;
}

/** A sealed draft: `files` are path → content (artifacts the definition references are "body"), `evidence` likewise. */
export function draft(
  blobs: Blobs,
  definition: UhdModuleDef,
  options: { revision?: number; dependencies?: PartRef[]; files?: Record<string, string>; evidence?: Record<string, string> } = {},
): PartRevisionDraft {
  const revision = options.revision ?? 1;
  const artifacts: EnvelopeArtifact[] = Object.entries(options.files ?? {})
    .map(([path, content]): EnvelopeArtifact => {
      const ref = (definition.artifacts ?? []).find((a) => a.filePath === path);
      return { path, ...blobs.add(content), mediaType: path.endsWith(".glb") ? "model/gltf-binary" : "text/plain", role: ref ? "body" : "attachment", ...(ref ? { artifactId: ref.id } : {}) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const evidence: EvidenceRef[] = Object.entries(options.evidence ?? {}).map(([path, content]) => ({
    kind: path.endsWith("verification.json") ? "verification" : "sources",
    path,
    ...blobs.add(content),
    mediaType: "application/json",
  }));
  return sealDraft({
    schema: PART_REVISION_SCHEMA,
    uhdSchema: "0.2.0",
    partId: definition.id,
    revision,
    definition,
    dependencies: options.dependencies ?? [],
    artifacts,
    missingArtifacts: [],
    evidence,
    derivedFrom: revision > 1 ? { partId: definition.id, revision: revision - 1 } : null,
  });
}

/**
 * A parts library served in this process: the protoboard-cloud server's app
 * and store (imported from the checkout) on an ephemeral port, with
 * its own data directory. With `readToken`, every request except discovery
 * needs `Authorization: Bearer <readToken>`, like a private uhd-library/v1
 * library.
 */
export async function startLibrary(options: { readToken?: string } = {}): Promise<CloudService> {
  const repo = cloudRepo();
  const load = (rel: string) => import(pathToFileURL(join(repo, rel)).href);
  const [{ createApp }, { Store }, { configFromEnv }, { serve }] = await Promise.all([
    load("src/server/app.ts"),
    load("src/server/store.ts"),
    load("src/server/config.ts"),
    import(pathToFileURL(createRequire(join(repo, "package.json")).resolve("@hono/node-server")).href),
  ]);
  const dataDir = mkdtempSync(join(tmpdir(), "pb-library-test-"));
  const store = new Store(dataDir);
  const app = createApp(store, { ...configFromEnv({}), dataDir, publishToken: TOKEN, publisher: "test" });
  const fetchHandler = (req: Request) => {
    const path = new URL(req.url).pathname;
    const discovery = path === "/.well-known/uhd-library" || path === "/v1";
    const writing = req.method !== "GET" && req.method !== "HEAD";
    if (options.readToken && !discovery && !writing && req.headers.get("authorization") !== `Bearer ${options.readToken}`)
      return Response.json({ error: { code: "AUTH_REQUIRED", message: "this library needs a bearer token" } }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="test"' } });
    return app.fetch(req);
  };
  const server = serve({ fetch: fetchHandler, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((r) => server.once("listening", () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    url,
    dataDir,
    client: new PartsClient({ baseUrl: url, token: TOKEN, ...(options.readToken ? { readToken: options.readToken } : {}) }),
    stop: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      store.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
