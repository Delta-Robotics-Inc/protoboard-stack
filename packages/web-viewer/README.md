# @protoboardai/web-viewer

Protoboard's shells over the viewer stack (two shells over one base viewer):

- the **browser shell** (`src/`): the Protoboard theme, view tabs from the
  view registry for the focused module, the viewer's hierarchy at the left
  (kept per browser tab in session storage), and its own inspector
  and DRC. `protoboard dev` serves it;
- the **VS Code shell** (`src/vscode/`): one viewer editor tab of the VS Code
  extension. VS Code's theme, the registry's view tabs, the diagram's toolbar
  and legend, the tab's own hierarchy at the left (its state in the
  webview's state, its rows' menu VS Code's via `data-vscode-context`), no
  inspector or DRC of its own (the extension's native views hold them). The extension ships its build and loads it into each tab's
  webview; `src/vscode/protocol.ts` is the messages between them.

Private. Architecture: [docs/specs/viewer-stack.md](../../docs/specs/viewer-stack.md).

```bash
npm run build -w @protoboardai/web-viewer   # dist/web-viewer.{js,css} and dist/vscode/protoboard-viewer.{js,css} (needs uhd-viewer built)
```

The repository root builds it too: `npm install` (its `postinstall`, when
`dist` is missing or older than the sources or uhd-viewer's build) and `npm
run build`, so a fresh checkout's `protoboard dev` has its page.
`PROTOBOARD_SKIP_WEB_BUILD=1` skips the install-time build.

```ts
import { mountWebViewer } from "@protoboardai/web-viewer";
const viewer = mountWebViewer(el, { bundleUrl: "/uhd-bundle.json", themeChoice: "protoboard-dark" });
viewer.focus("arm_fl/motor"); // the viewer's handle and host messages, unchanged
```

`?theme=` on the dev page picks the theme: `protoboard-dark` (default),
`protoboard-light`, `protoboard-system`, `vscode`, `default-dark`,
`default-light`.
