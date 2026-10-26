# @protoboardai/cloud

The typed client of the Protoboard parts service (API v1), and of any other
`uhd-library/v1` library. Apache-2.0 (`LICENSE`, `NOTICE`).

Everything it downloads is verified before it is returned: an envelope
against its digest and its definition digest, a file against its sha256.
Node 22.13 or later; no dependencies (global `fetch`, `node:crypto`,
`node:fs`). The package ships its TypeScript sources; Protoboard runs them
through tsx.

| Module | What |
| --- | --- |
| `src/client.ts` | `PartsClient` (`@protoboardai/cloud/client`), with the envelope helpers re-exported. |
| `src/envelope.ts` | The `protoboard.part-revision/v1` envelope (`@protoboardai/cloud/envelope`): types, canonical JSON, digests, validation. Pure. |
| `src/api.ts` | Request and response types of API v1. |
| `src/taxonomy.ts` | The category taxonomy as the service serves it: ancestors, tree with counts, shape checks. Pure. |
| `src/kits.ts` | The service's kit manifests (`x-kits`): types and shape checks. Pure. |

```ts
import { PartsClient, vendoredDefinition } from "@protoboardai/cloud/client";

const cloud = new PartsClient({ baseUrl: process.env.PROTOBOARD_CLOUD_URL ?? "http://localhost:8787" });
const { parts } = await cloud.search({ q: "2207 motor", domain: "mechanical" });
const { revisions } = await cloud.getClosure(parts[0].partId, parts[0].recommendedRevision!); // verified, dependencies first
for (const env of revisions) writeFileSync(`parts/catalog/${env.partId}.json`, vendoredDefinition(env));
```

With `discover: true` the client finds a library's API root from its
`/.well-known/uhd-library` document.

## The service

This package is the client only. The parts service it talks to is hosted
by Protoboard; any other server that speaks `uhd-library/v1` works with it
too (`discover: true`).

The package is `"private": true` in this repository, so a plain `npm
publish` refuses it; `scripts/registry/publish-stack.mjs` publishes a staged
copy with the rest of the stack.
