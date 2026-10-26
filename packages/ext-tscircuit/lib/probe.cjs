// Tool probe for `protoboard doctor` and capability operations: the tscircuit
// libraries this provider runs in-process are installed at the exact versions
// package.json pins, on Node 22 or newer. Prints one line; exits 1 otherwise.
const { existsSync, readFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const KEY = ["@tscircuit/core", "@tscircuit/checks", "circuit-json-to-gerber", "circuit-json-to-gltf", "circuit-json-to-step", "circuit-to-svg", "sucrase"];
const root = dirname(require.resolve("@protoboardai/ext-tscircuit/package.json", { paths: [process.cwd(), __dirname] }));
const pins = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies;

function installed(name) {
  for (let dir = root; ; dir = dirname(dir)) {
    const f = join(dir, "node_modules", name, "package.json");
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")).version;
    if (dirname(dir) === dir) return undefined;
  }
}

const problems = [];
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) problems.push(`Node ${process.version} (needs 22 or newer)`);
for (const name of KEY) {
  const v = installed(name);
  if (!v) problems.push(`${name} not installed`);
  else if (v !== pins[name]) problems.push(`${name} ${v} (pinned ${pins[name]})`);
}
if (problems.length) {
  console.error(`tscircuit libraries not usable: ${problems.join("; ")}`);
  process.exit(1);
}
console.log(`tscircuit @tscircuit/core ${pins["@tscircuit/core"]}, converters pinned, Node ${process.version}`);
