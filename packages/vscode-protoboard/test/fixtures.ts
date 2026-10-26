/** A small project's build output (a watch): every kind of node the Explorer shows, and findings of every entity kind. */
import type { ResolvedProject, UhdBundle } from "../src/model.js";

const diag = (code: string, severity: "error" | "warning" | "info", entity: { kind: string; id: string }, message = code) => ({ code, severity, entity, message, validator: "uhd/checkSystem" });

export const resolved: ResolvedProject = {
  schema: "protoboard.resolved/v0",
  project: { name: "watch", root: "watch" },
  definitions: [
    { id: "watch", name: "Smart watch", kind: "module", origin: { kind: "local", tier: "project-specific", source: { file: "src/watch.uhd.ts", line: 10 } } },
    { id: "mainboard", name: "Main board", kind: "module", origin: { kind: "local", tier: "project-specific", source: { file: "src/boards/mainboard/mainboard.uhd.ts", line: 5 } } },
    { id: "mcu", name: "MCU", kind: "module", origin: { kind: "catalog", tier: "catalog", source: { file: "parts/catalog/mcu.json" } } },
    { id: "led", name: "LED", kind: "module", origin: { kind: "local", tier: "project-researched", source: { file: "parts/local/led.uhd.ts", line: 3 } } },
    { id: "case", name: "Case", kind: "module", origin: { kind: "local", tier: "project-specific", source: { file: "src/enclosures/case/case.uhd.ts", line: 4 } } },
    { id: "strap-kit", name: "Strap", kind: "group", origin: { kind: "local", tier: "project-specific", source: { file: "src/watch.uhd.ts", line: 40 } } },
    { id: "flex", name: "Flex cable", kind: "harness", origin: { kind: "local", tier: "project-specific", source: { file: "src/watch.uhd.ts", line: 50 } } },
    { id: "case-screws", name: "Case screws", kind: "harness", origin: { kind: "local", tier: "project-specific", source: { file: "src/watch.uhd.ts", line: 60 } } },
    { id: "pin", name: "Pin", kind: "module", origin: { kind: "catalog", tier: "catalog", source: { file: "parts/catalog/pin.json" } } },
  ],
  instances: [
    { path: "", definition: "watch", name: "Smart watch", kind: "module", quantity: 1 },
    { path: "board", definition: "mainboard", name: "Main board", kind: "module", quantity: 1, parent: "" },
    { path: "board/mcu", definition: "mcu", name: "MCU", kind: "module", quantity: 1, parent: "board" },
    { path: "board/led", definition: "led", name: "Status LED", kind: "module", quantity: 2, parent: "board" },
    { path: "case", definition: "case", name: "Case", kind: "module", quantity: 1, parent: "" },
    { path: "strap", definition: "strap-kit", name: "Strap", kind: "group", quantity: 1, parent: "" },
    { path: "strap/pin", definition: "pin", kind: "module", quantity: 2, parent: "strap" },
    { path: "flex", definition: "flex", name: "Flex cable", kind: "harness", quantity: 1, parent: "" },
    { path: "screws", definition: "case-screws", name: "Case screws", kind: "harness", quantity: 1, parent: "" },
    { path: "spare_led", definition: "led", name: "Spare LED", kind: "module", quantity: 1, parent: "" },
  ],
  links: [
    { id: "board_flex", owner: "", a: "board:fpc", b: "flex:end_a" },
    { id: "case_mount", owner: "", a: "case:boss", b: "board:holes" },
    { id: "board:mcu_led", owner: "board", a: "mcu:gpio1", b: "led:anode" },
  ],
  artifacts: [
    { definition: "mcu", id: "datasheet", url: "https://example.com/mcu.pdf", base: "parts/catalog/mcu", present: "remote" },
    { definition: "mcu", id: "cad_step", format: "step", filePath: "cad/mcu.step", resolved: "parts/catalog/mcu/cad/mcu.step", base: "parts/catalog/mcu", present: true },
    { definition: "led", id: "body", format: "glb", filePath: "led.glb", resolved: "package:@acme/parts/led.glb", base: "package:@acme/parts", present: true },
    { definition: "case", id: "note", base: "project", present: "provenance" },
  ],
  capabilities: [
    { capability: "circuit", module: "mainboard", provider: "@protoboardai/ext-tscircuit", config: "src/boards/mainboard/circuit.config.ts" },
    { capability: "cad", module: "case", provider: "@protoboardai/ext-enclosure-cad", config: "src/enclosures/case/cad.config.ts" },
  ],
  checks: [
    { validator: "uhd/checkSystem", status: "ran", counts: { error: 1, warning: 1, info: 0 } },
    { validator: "ext:@protoboardai/ext-tscircuit/check", subject: "mainboard", status: "skipped", reason: "no tscircuit", counts: { error: 0, warning: 0, info: 0 } },
  ],
  diagnostics: [
    diag("UHD_LINK_STATE", "error", { kind: "link", id: "board:mcu_led" }, "gpio1 drives 3.3 V into a 2.0 V LED; add a resistor"),
    diag("HW_NO_SOURCES", "warning", { kind: "definition", id: "led" }),
    diag("ENCLOSURE_STALE", "warning", { kind: "definition", id: "case" }),
    diag("UHD_UNPLACED", "info", { kind: "instance", id: "strap/pin" }),
    diag("UHD_SUPPLY_BUDGET", "info", { kind: "link", id: "board_flex+case_mount~vbat~vin" }),
    diag("UHD_FASTENER_TORQUE", "warning", { kind: "interface", id: "watch" }),
    diag("PB_ARTIFACT_UNAVAILABLE", "warning", { kind: "artifact", id: "mcu#cad_vendor" }),
    diag("PB_ROOT", "info", { kind: "project", id: "watch" }),
  ],
};

export const bundle: UhdBundle = {
  root: "watch",
  definitions: [
    { id: "watch", interfaces: [], links: [{ id: "board_flex", name: "Board to flex" }], children: [{ id: "board", moduleDefId: "mainboard" }, { id: "case", moduleDefId: "case" }] },
    { id: "mainboard", interfaces: [], exports: [{ id: "usb", name: "USB-C", from: { child: "mcu", interfaceId: "usb" } }], children: [{ id: "mcu", moduleDefId: "mcu" }, { id: "led", moduleDefId: "led" }] },
    { id: "mcu", interfaces: [{ id: "gpio1", domain: "electrical", protocols: [{ type: "gpio" }] }, { id: "usb", name: "USB", domain: "electrical", protocols: [{ type: "usb2" }] }] },
    { id: "led", interfaces: [{ id: "anode", domain: "electrical" }] },
    { id: "case-screws", kind: "harness", fastenerStack: [{ child: "screws", atMm: 0 }] },
    { id: "flex", kind: "harness" },
  ],
};

