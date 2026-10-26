/**
 * The headless browser the documents are printed with: core's CDP client
 * (one Chrome, one page; core/src/cdp.ts, shared with `protoboard views check`).
 */
export { launchBrowser, type Browser, type LaunchOptions } from "@protoboardai/core/cdp";
