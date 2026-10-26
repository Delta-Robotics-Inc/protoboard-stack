# @protoboardai/views

Protoboard's views as React components, the view registry the shells' tabs
come from, and the host and theme adapter interfaces the shells implement.
Private. Architecture: [docs/specs/viewer-stack.md](../../docs/specs/viewer-stack.md).

```ts
import { createViewRegistry, registerContributedViews, themeAdapterFor } from "@protoboardai/views";

const registry = createViewRegistry();          // diagram, 3d; planned schematic, pcb, bom, pair, library
registerContributedViews(registry, views);      // from extension manifests (core's resolveViews)
const tabs = registry.forModule(module, bundle, path);
```

A stage 2 track lands its view by registering a component under the planned
id with `{ replace: true }`, or by declaring it in its extension's
`contributes.views`.

`@protoboardai/views/inspector` holds the Inspector's selection
(`SelectionInspector`: a shell's card around the viewer's own details, every
artifact as a card) and the DRC panel (`DrcPanel`), data in and actions out;
`@protoboardai/views/inspector-model` is their models' types alone.
