/**
 * `node:fs` and `node:path` for the browser bundles that run the board core in a page. An in-memory board service
 * (no folder) never touches files; anything that tries says so plainly.
 */
const none = (name: string) => () => {
  throw new Error(`${name} is not available in the browser: open the board service in memory (a document, no folder)`);
};
export const existsSync = () => false;
export const readFileSync = none("readFileSync");
export const writeFileSync = none("writeFileSync");
export const mkdirSync = none("mkdirSync");
export const renameSync = none("renameSync");
export const rmSync = none("rmSync");
export const statSync = none("statSync");
export const openSync = none("openSync");
export const closeSync = none("closeSync");
export const writeSync = none("writeSync");
export const appendFileSync = none("appendFileSync");

const norm = (p: string) => p.replace(/\\/g, "/");
export const join = (...parts: string[]) => norm(parts.filter(Boolean).join("/")).replace(/\/+/g, "/");
export const resolve = (...parts: string[]) => join(...parts);
export const dirname = (p: string) => norm(p).replace(/\/[^/]*$/, "") || "/";
export const relative = (from: string, to: string) => (norm(to).startsWith(norm(from)) ? norm(to).slice(norm(from).length).replace(/^\//, "") : norm(to));
export const isAbsolute = (p: string) => /^([a-zA-Z]:)?[\\/]/.test(p);
export const basename = (p: string) => norm(p).split("/").pop() ?? "";
export const sep = "/";

export default { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, statSync, openSync, closeSync, writeSync, appendFileSync, join, resolve, dirname, relative, isAbsolute, basename, sep };
