/**
 * What every webview page of the extension shares: escaping text into HTML
 * and the nonce its Content-Security-Policy allows scripts and styles by.
 * The viewer tabs' page is viewerPage.ts; the views' pages build on
 * webviewKit.ts or pageStyle.ts.
 */
import { randomBytes } from "node:crypto";

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A random nonce for the CSP. */
export const nonce = (): string => randomBytes(18).toString("base64url");
