#!/usr/bin/env node
// Runs the TypeScript sources through tsx (v0: no compile step; see README).
import { register } from "tsx/esm/api";
register();
await import("../src/index.ts");
