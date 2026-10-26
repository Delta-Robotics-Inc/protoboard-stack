/**
 * Puts the React views bundle (appPage.ts) in a webview: its options (scripts
 * on, the extension's dist and media and any cache folders as the only local
 * roots) and its page.
 */
import * as vscode from "vscode";
import { accessMessage, isAccountAction, UNLOCKED, type AccountAction, type Lock } from "./account.js";
import { appHtml, type AppScreen } from "./appPage.js";
import { nonce } from "./html.js";

// ---- the library's sign-in (PB-928): every page is told one flag; only the Library's screens act on it

const apps = new Set<vscode.Webview>();
let lock: Lock = UNLOCKED;
let onAccount: ((action: AccountAction) => void) | undefined;

/** What the sign-in card's buttons do (the extension's Sign In, Check Again, Show Log). */
export function setAccountHandler(fn: (action: AccountAction) => void) {
  onAccount = fn;
}

/**
 * A webview that draws the views app: it is told whether the library needs
 * a sign-in, now and at every change, and its card's buttons reach the
 * extension. The Inspector's view writes its own page (inspectorView.ts) and
 * is tracked from where it is registered.
 */
export function trackApp(webview: vscode.Webview) {
  if (apps.has(webview)) return;
  apps.add(webview);
  webview.onDidReceiveMessage((m: { type?: unknown; action?: unknown }) => {
    // a page that has just loaded asks; its buttons name one of the account actions
    if (m?.type === "protoboard:access?") void post(webview);
    else if (m?.type === "protoboard:account" && isAccountAction(m.action)) onAccount?.(m.action);
  });
  void post(webview);
}

async function post(webview: vscode.Webview) {
  try {
    await webview.postMessage(accessMessage(lock));
  } catch {
    // the webview is gone
    apps.delete(webview);
  }
}

/** The sign-in changed: every page is told. */
export function setAppAccess(next: Lock) {
  lock = next;
  for (const w of apps) void post(w);
}

/** The screens of the part library: the cloud's pages (the rest are local work and are never written signed out). */
const LIBRARY_SCREENS: ReadonlySet<AppScreen> = new Set<AppScreen>(["library", "library-page", "part"]);

/** The flag for a page written now (appHtml's `signedOut`). */
export const appSignedOut = () => (lock.locked ? { reason: lock.reason, message: lock.message } : undefined);

export function showApp(webview: vscode.Webview, extensionUri: vscode.Uri, screen: AppScreen, title: string, roots: vscode.Uri[] = []) {
  const dist = vscode.Uri.joinPath(extensionUri, "dist");
  const media = vscode.Uri.joinPath(extensionUri, "media");
  webview.options = { enableScripts: true, localResourceRoots: [dist, media, ...roots] };
  webview.html = appHtml({
    screen,
    title,
    cspSource: webview.cspSource,
    script: webview.asWebviewUri(vscode.Uri.joinPath(dist, "views-app.js")).toString(),
    style: webview.asWebviewUri(vscode.Uri.joinPath(dist, "views-app.css")).toString(),
    nonce: nonce(),
    ...(appSignedOut() && LIBRARY_SCREENS.has(screen) ? { signedOut: appSignedOut() } : {}),
  });
  trackApp(webview);
}

/** An editor tab's icon (media/tabs/<name>-light|dark.svg). */
export function tabIcon(extensionUri: vscode.Uri, name: "library" | "part" | "settings" | "table"): { light: vscode.Uri; dark: vscode.Uri } {
  return { light: vscode.Uri.joinPath(extensionUri, "media", "tabs", `${name}-light.svg`), dark: vscode.Uri.joinPath(extensionUri, "media", "tabs", `${name}-dark.svg`) };
}
