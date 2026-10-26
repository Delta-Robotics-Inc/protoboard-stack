/**
 * System datasheet: overview, specifications, mechanical drawing with
 * interface geometry, interfaces and pinout, electrical characteristics,
 * performance (test data), design checks, BOM, evidence and provenance.
 */
import type { InterfaceDef, ModuleDef } from "@deltarobotics/uhd";
import { interfaceGeometry, slotBindings } from "@deltarobotics/uhd";
import { barChart, lineChart, meterChart, ACCENT } from "../charts.ts";
import { callouts, dimension, endOf, figure, groupRow, note, sec, sub, table, leafOf, parseEnd } from "../blocks.ts";
import { esc, MARKERS } from "../html.ts";
import { allBodies, interfaceAnchor, renderBody, ISO } from "../figures.ts";
import { thrustTests } from "@deltarobotics/uhd";
import { massByDefinition, moduleMass, systemMass } from "@deltarobotics/uhd";
import { bomFile } from "../context.ts";
import { cadVolume, category } from "../model.ts";
import { column } from "../testdata.ts";
import { coverPage, figNum, testOf, testTag, thumbnail, type BuildEnv } from "./common.ts";
import { productPage } from "./product.ts";
import { moduleSources, moduleVerification } from "../values.ts";
import type { ValueStatus } from "../values.ts";

const W = 178; // printed content width (mm)

export async function buildDatasheet(env: BuildEnv): Promise<string> {
  const { ctx, doc } = env;
  const cfg = ctx.sys.config;
  const ds = cfg.datasheet ?? {};
  const out: string[] = [];
  const iso = cfg.camera?.dir ?? ISO;

  // ---------------------------------------------------------------- cover
  const heroBodies = [
    ...ctx.scene.bodies.filter((b) => ds.heroHints || !b.via?.startsWith("hint:")).map((b) => renderBody(b, "normal")),
    ...ctx.scene.hardware.map((h) => renderBody(h, "normal")),
  ];
  const hero = await env.r.render("ds-hero", { width: 2000, height: 1180, mode: "shaded", bodies: heroBodies, camera: { dir: iso, margin: 0.03 } });
  const kpis = (ds.keyFigures ?? [])
    .map((k) => `<div class="kpi"><div class="k-label">${esc(k.label)}</div><div class="k-value">${doc.v(k.q, k.f)}</div>${k.sub ? `<div class="k-sub">${esc(k.sub)}</div>` : ""}</div>`)
    .join("");
  const placedCount = ctx.scene.bodies.length;
  out.push(
    coverPage(env, {
      kicker: "Datasheet · Reference system",
      hero,
      heroCaption: `Assembled from UHD mates (${placedCount} placed bodies, ${ctx.scene.hardware.length} fasteners)${ds.heroHints ? "; parts held inside placed by the project's placement hints" : "; strapped battery not shown"}.`,
      bottom: `<div class="kpis k6">${kpis}</div>
      <div class="cover-grid">
        <div><h2 class="sub">About this document</h2><p class="small">Every value is queried from the UHD model at build time and re-checked by <code>uhd-tech-docs-verify</code>. Markers show where a value is not a cited source value.</p></div>
        <div>${doc.legendPlaceholder()}</div>
      </div>`,
    }),
  );

  // ---------------------------------------------------------------- 01 overview
  const diagram = systemDiagram(env);
  const sections = ["Overview", "Specifications", "Mechanical", "Interfaces and pinout", "Electrical characteristics", "Performance", "Design checks", "Bill of materials", "Evidence and assumptions", "Value provenance"];
  // the product as the project states it, before the component detail (PB-935)
  out.push(productPage(ctx.sys.root, ctx.sys.system.name ?? ctx.sys.system.id, ctx.sys.system.description));
  out.push(`<div class="block" data-break="before">${sec("01", "Overview", `${esc(ctx.sys.system.id)} · v${esc(ctx.sys.system.version ?? "")}`)}
  <div class="cols-60"><div><p class="lead">${doc.v("sys:system.description", undefined, { cls: "wrap" })}</p>
  ${table(
    [{ h: "Role" }, { h: "Module" }, { h: "Qty", cls: "num" }],
    (ctx.sys.system.children ?? [])
      .filter((c) => ctx.sys.lookup(c.moduleDefId)?.kind !== "harness")
      .reduce((acc: { name: string; id: string; n: number }[], c) => {
        const ex = acc.find((a) => a.id === c.moduleDefId);
        if (ex) ex.n++;
        else acc.push({ name: c.name ?? c.id, id: c.moduleDefId, n: 1 });
        return acc;
      }, [])
      .map((c) => [esc(c.n > 1 ? c.name.replace(/^(Front|Rear)-(left|right) (\w)/i, (_m, _a, _b, x: string) => x.toUpperCase()) + "s" : c.name), doc.v(`def:${c.id}:name`, undefined, { cls: "wrap" }), String(c.n)]),
    { cls: "dense" },
  )}</div>
  <div><h2 class="sub">Contents</h2><ol class="toc">${sections.map((s, i) => `<li><span class="toc-n">${String(i + 1).padStart(2, "0")}</span><span class="toc-t">${esc(s)}</span><span class="toc-dots"></span><span class="toc-p">00</span></li>`).join("")}</ol></div></div></div>`);
  if (diagram) out.push(`<div class="block keep">${sub("System architecture")}${diagram}<div class="cap"><b>Figure ${figNum(env)}</b><span>Power and signal links as stored in the model (validated with validateLinks); labels are the hub-side interfaces.</span></div></div>`);
  const boardFig = boardDiagram(env);
  if (boardFig) out.push(`<div class="block keep">${sub(`${ctx.instances.get(ds.hub!)?.name ?? "Board"} architecture`)}${boardFig}<div class="cap"><b>Figure ${figNum(env)}</b><span>The board's components (passives left out) and the nets that join them to its controller, from the board module's net links. Parts with no net to the controller hang off the part they share a rail with.</span></div></div>`);

  // ---------------------------------------------------------------- 02 specifications
  const groups = ds.specGroups ?? [];
  const half = Math.ceil(groups.reduce((s, g) => s + g.rows.length + 1, 0) / 2);
  const left: typeof groups = [];
  const right: typeof groups = [];
  let acc = 0;
  for (const g of groups) {
    (acc < half ? left : right).push(g);
    acc += g.rows.length + 1;
  }
  const specTable = (gs: typeof groups) =>
    table(
      [{ h: "Parameter" }, { h: "Value" }],
      gs.flatMap((g) => [groupRow(g.title), ...g.rows.map((r) => [esc(r.label) + (r.sub ? ` <span class="muted small">${esc(r.sub)}</span>` : ""), doc.v(r.q, r.f, { cls: "wrap" })])]) as any,
    );
  out.push(`<div class="block" data-break="before">${sec("02", "Specifications")}<div class="cols">${specTable(left)}${specTable(right)}</div>${doc.legendPlaceholder()}</div>`);

  // ---------------------------------------------------------------- 03 mechanical
  out.push(sec("03", "Mechanical", "", ' data-break="before"'));
  const drawingBodies = [
    ...ctx.scene.bodies.filter((b) => !b.via?.startsWith("hint:")).map((b) => renderBody(b, b.category === "prop" ? "ghost" : "normal")),
    ...ctx.scene.hardware.map((h) => renderBody(h, "normal")),
  ];
  const mm = (spec: string) => {
    const a = interfaceAnchor(ctx.scene, spec);
    return a ? [{ id: spec, p: a.p }] : [];
  };
  const topAnchors = ["frame.motor_mount_fl", "frame.motor_mount_fr", "frame.motor_mount_rl", "frame.motor_mount_rr"].flatMap(mm);
  const top = await env.r.render("ds-top", { width: 1500, height: 1260, mode: "lineart", bodies: drawingBodies, anchors: topAnchors, camera: { dir: [0, 0, 1], up: [1, 0, 0], margin: 0.12 } });
  const lbl = (q: string, f?: string) => (x: number, y: number, size: number, rot: number) =>
    doc.svgText(q, f, `x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size.toFixed(1)}" text-anchor="middle" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="#d94e00" font-weight="600" class="dimtext"`);
  const topW = W * 0.56;
  const frameDims = !ds.envelope;
  const topDims = !frameDims ? "" : [
    dimension(top, "frame.motor_mount_rl", "frame.motor_mount_fr", lbl("def:quadcopter-5in-frame:domains[domain=mechanical].metadata.wheelbase_mm"), topW, 0),
    dimension(top, "frame.motor_mount_fl", "frame.motor_mount_fr", lbl("derived:frameDistance(frame.motor_mount_fl,frame.motor_mount_fr)", "d1"), topW, -9),
    dimension(top, "frame.motor_mount_rr", "frame.motor_mount_fr", lbl("derived:frameDistance(frame.motor_mount_rr,frame.motor_mount_fr)", "d1"), topW, 9),
  ].join("");
  // plate gap drawn at a standoff: its bottom (placement) to the top plate's underside (the top plate's standoff frame)
  const so = ctx.scene.hardware.find((h) => h.category === "standoff" && h.matrix[7] < 0);
  const tp = interfaceAnchor(ctx.scene, "top_plate.standoff_mount");
  const sideAnchors = so && tp ? [{ id: "so-bottom", p: [so.matrix[3], so.matrix[7], so.matrix[11]] }, { id: "so-top", p: [so.matrix[3], so.matrix[7], tp.p[2]] }] : [];
  const side = await env.r.render("ds-side", { width: 2000, height: 560, mode: "lineart", bodies: drawingBodies, anchors: sideAnchors, camera: { dir: [0, -1, 0], up: [0, 0, 1], margin: 0.04 } });
  const sideDims = !frameDims ? "" : dimension(side, "so-bottom", "so-top", lbl("def:quadcopter-5in-frame:domains[domain=mechanical].metadata.standoff_height_mm"), W, 16);
  // the doc spec's envelope table and captions; without one, the multirotor recipe (frameDims)
  const envSpec = ds.envelope;
  const envRows: string[][] = envSpec
    ? envSpec.rows.map((r) => [esc(r.label) + (r.sub ? ` <span class="muted small">${esc(r.sub)}</span>` : ""), doc.v(r.q, r.f, { cls: "wrap" })])
    : [
        ["Wheelbase", doc.v("def:quadcopter-5in-frame:domains[domain=mechanical].metadata.wheelbase_mm")],
        ["Arm spacing (x)", doc.v("derived:frameDistance(frame.motor_mount_fl,frame.motor_mount_rl)", "d1")],
        ["Arm spacing (y)", doc.v("derived:frameDistance(frame.motor_mount_fl,frame.motor_mount_fr)", "d1")],
        ["Plate thickness", doc.v("def:quadcopter-5in-frame:domains[domain=mechanical].metadata.plate_thickness_mm")],
        ["Standoff height", doc.v("def:quadcopter-5in-frame:domains[domain=mechanical].metadata.standoff_height_mm")],
        ["Propeller diameter", doc.v("def:hqprop-ethix-s5:domains[domain=mechanical].metadata.prop_diameter_in", "u=in")],
        ["Motor diameter", doc.v("def:meps-neon-2207-v2-1950kv:domains[domain=mechanical].metadata.diameter_mm")],
        ["Plate material", doc.v("def:quadcopter-5in-frame:domains[domain=mechanical].material.name", undefined, { cls: "wrap" })],
        ["Material density", doc.v("def:quadcopter-5in-frame:domains[domain=mechanical].material.density_g_cm3", "u=g/cm³")],
        ["Frame mass", doc.v("derived:mass.module(quadcopter-5in-frame)", "d1")],
        ["Top plate mass", doc.v("derived:mass.module(quadcopter-5in-top-plate)", "d1")],
      ];
  const envNote = envSpec ? envSpec.note : "Plate masses are the generated CAD volume × the declared material density (systemMass), so they follow the design.";
  out.push(`<div class="block"><div class="cols-60">
    ${figure({ src: env.img(top.file), w: top.width, h: top.height, overlay: topDims, num: figNum(env), caption: envSpec?.topCaption ?? (frameDims ? "Top view, front up. Wheelbase is the frame's stated value; arm spacings are measured between the placed motor-mount frames." : "Top view."), unit: "mm" })}
    <div>${sub("Envelope")}${table([{ h: "Parameter" }, { h: "Value", cls: "num" }], envRows, { cls: "dense" })}
    ${envNote ? `<p class="small muted">${esc(envNote)}</p>` : ""}</div></div></div>`);
  out.push(`<div class="block">${figure({ src: env.img(side.file), w: side.width, h: side.height, overlay: sideDims, num: figNum(env), caption: envSpec?.sideCaption ?? (frameDims ? "Right side, front to the right. Plate gap is the frame's standoff height." : "Side view."), unit: "mm" })}</div>`);

  // mass budget (systemMass): every instance by definition, and what has no mass
  {
    const sm = systemMass(ctx.sys.system, ctx.sys.lookup, cadVolume(ctx.sys));
    const groups = massByDefinition(sm);
    const rows = groups
      .filter((g) => g.mass)
      .sort((a, b) => (b.totalG ?? 0) - (a.totalG ?? 0))
      .map((g) => {
        const unit = g.mass!.basis === "stated" ? doc.v(`def:${g.def.id}:domains[domain=mechanical].weight_g`) : doc.v(`derived:mass.module(${g.def.id})`);
        return [esc(shortDefName(g.def)), String(g.quantity), unit, g.mass!.basis === "stated" ? "stated" : `CAD × ${esc(g.mass!.material!.name.replace(/ \(.*\)/, ""))}`];
      });
    const missing = groups.filter((g) => !g.mass);
    out.push(`<div class="block keep">${sub("Mass budget")}${table([{ h: "Part" }, { h: "Qty", cls: "num" }, { h: "Each", cls: "num" }, { h: "Basis" }], rows, {
      cls: "dense",
      foot: `All-up weight ${doc.v("derived:mass.all_up", "d1")} (systemMass), of which ${doc.v("derived:mass.assumed", "d1")} is computed from assumed material or nominal CAD geometry. Not included, no mass in the model: ${missing.map((g) => `${esc(g.def.name)} ×${g.quantity}`).join(", ") || "none"}. Rows in order of total mass (quantity × each).`,
    })}</div>`);
  }

  // interface callouts
  const calls = (ds.mechanicalCallouts ?? []).map((s) => ({ s, a: interfaceAnchor(ctx.scene, s) })).filter((x) => x.a);
  const accentByBody = new Map<string, string[]>();
  for (const c of calls) accentByBody.set(c.a!.body.key, [...(accentByBody.get(c.a!.body.key) ?? []), c.a!.iface.id]);
  const ifBodies = ctx.scene.bodies
    // the structures (a frame, a top plate) and any other body an interface callout sits on (an enclosure)
    .filter((b) => ["frame", "top_plate"].includes(b.category) || accentByBody.has(b.key))
    .map((b) => renderBody(b, "normal", { accentNodes: accentByBody.get(b.key) ?? [] }));
  const standoffs = ctx.scene.hardware.filter((h) => h.category === "standoff").map((h) => renderBody(h, "context"));
  const ifFig = await env.r.render("ds-interfaces", {
    width: 1900,
    height: 1050,
    mode: "lineart",
    bodies: [...ifBodies, ...standoffs],
    anchors: calls.map((c) => ({ id: c.s, p: c.a!.p })),
    camera: { dir: [1, -1.25, 1.05], margin: 0.1 },
  });
  const ifOverlay = callouts(ifFig, calls.map((c, i) => ({ anchor: c.s, label: String(i + 1), accent: true })), W);
  const ifRows = calls.map((c, i) => {
    const { body, iface } = c.a!;
    const q = (pid: string) => `inst:${body.path.join("/")}:interfaces[id=${iface.id}].parameters[id=${pid}].value`;
    const shape = iface.traits?.find((t) => t.type === "bolt_pattern")?.params?.shape;
    const hasY = iface.parameters?.some((p) => p.id === "hole_spacing_y");
    const pattern = `${doc.v(q("hole_count"))} × on ${shape === "circle" ? "Ø" : ""}${doc.v(q("hole_spacing"))}${hasY ? ` × ${doc.v(q("hole_spacing_y"))}` : ""} ${esc(shape ?? "")}`;
    const mates = ctx.scene.assembly.mates.filter((m) => (m.a.path.join("/") === body.path.join("/") && m.a.iface.id === iface.id) || (m.b.path.join("/") === body.path.join("/") && m.b.iface.id === iface.id));
    const other = mates.map((m) => {
      const o = m.a.path.join("/") === body.path.join("/") && m.a.iface.id === iface.id ? m.b : m.a;
      return `${esc(o.def.name)}${m.harness ? ` <span class="muted">via ${esc(m.harness)}</span>` : ""}`;
    });
    const g = interfaceGeometry(body.def, iface.id);
    const kinds = [...new Set(g.refs.map((r) => r.ref.kind))].map((k) => ({ feature: "D1", artifact: "D2", procedural: "D3" })[k]).join(" ");
    return [`<span class="co-inline">${i + 1}</span>`, `<b>${esc(iface.name)}</b><br><span class="muted small">${esc(body.path.join("/"))}.${esc(iface.id)}</span>`, pattern, doc.v(q("fastener_diameter"), "u=mm"), [...new Set(other)].join("<br>"), `<span class="tag">${kinds || "none"}</span>`];
  });
  out.push(`<div class="block keep" data-break="before">${sub("Interface geometry")}${figure({ src: env.img(ifFig.file), w: ifFig.width, h: ifFig.height, overlay: ifOverlay, num: figNum(env), caption: "Structural interfaces of the frame and top plate (accent), from each interface's geometry frame and CAD feature binding." })}</div>`);
  out.push(table([{ h: "#" }, { h: "Interface" }, { h: "Pattern" }, { h: "Fastener", cls: "num" }, { h: "Mates with" }, { h: "Binding" }], ifRows, { foot: "Binding: D1 named CAD feature, D2 per-interface artifact, D3 procedural from parameters (docs/geometry-artifacts.md)." }));

  // ---------------------------------------------------------------- 04 interfaces and pinout
  out.push(sec("04", "Interfaces and pinout", "", ' data-break="before"'));
  const hub = ds.hub;
  const hubRows: string[][] = [];
  const peerParams = ["baud_rate", "clock_freq", "i2c_address", "voltage", "max_current"];
  for (const s of ctx.wiring) {
    if (s.domain !== "electrical") continue;
    const ea = parseEnd(s.a);
    const eb = parseEnd(s.b);
    const la = endOf(ctx.sys.system, ctx.sys.lookup, ea.path, ea.iface, s.name);
    const lb = endOf(ctx.sys.system, ctx.sys.lookup, eb.path, eb.iface, s.name);
    if (!la || !lb) continue;
    // the hub itself or a part inside it (a board's export resolves to the component behind it)
    const inHub = (path: string[]) => !!hub && (path.join("/") === hub || path.join("/").startsWith(hub + "/"));
    const isHubA = inHub(la.path);
    const isHubB = inHub(lb.path);
    if (!isHubA && !isHubB) continue;
    const [h, p] = isHubA ? [la, lb] : [lb, la];
    const pads = s.connections.length
      ? s.connections.map((c) => {
          const [hc, pc] = isHubA ? [c.from, c.to] : [c.to, c.from];
          return `${esc(parseEnd(hc).pad)} → ${esc(parseEnd(pc).pad)}${c.crossover ? ' <span class="x-flag">×</span>' : ""}`;
        }).join("<br>")
      : `${esc(h.iface.pin ?? h.iface.id)} → ${esc(p.iface.pin ?? p.iface.id)}`;
    const params = peerParams.flatMap((pid) => {
      for (const [end, endPath] of [[p, p.path.join("/")], [h, h.path.join("/")]] as const) {
        if (end.iface.parameters?.some((x) => x.id === pid)) {
          const base = ctx.instances.has(endPath) ? `inst:${endPath}` : `def:${end.def.id}`;
          return [`${esc(pid.replace(/_/g, " "))} ${doc.v(`${base}:interfaces[id=${end.iface.id}].parameters[id=${pid}].value`, pid === "i2c_address" ? "hex" : pid === "baud_rate" ? "u=Bd" : pid === "clock_freq" ? "si" : undefined)}`];
        }
      }
      return [];
    });
    hubRows.push([`<b>${esc(h.iface.name)}</b>`, pads, `${esc(p.def.name)}<br><span class="muted small">${esc(p.iface.name)}</span>`, `<span class="tag">${esc(s.protocol)}</span>`, params.join("<br>") || '<span class="muted">—</span>', `<span class="tag ${s.state === "configured" ? "ok" : "err"}">${esc(s.state)}</span>`]);
  }
  const hubDef = hub ? ctx.instances.get(hub) : undefined;
  out.push(`<p class="prose">Allocation of the ${esc(hubDef?.name ?? "hub")} (<code>${esc(hub ?? "")}</code>) interfaces, pad to pad, from the stored links. Crossovers (TX→RX) are marked <span class="x-flag">×</span>. The link state is the result of pairwise DRC.</p>`);
  out.push(table([{ h: "Hub interface" }, { h: "Pads (hub → peer)" }, { h: "Peer" }, { h: "Protocol" }, { h: "Parameters" }, { h: "State" }], hubRows, { split: true, caption: "Interface allocation" }));
  // a board hub: its controller's pins, net by net (the board's own pinout; its edge is in the table above)
  const pinRows = controllerPinout(env);
  if (pinRows.length) {
    out.push(`<p class="prose">Pin allocation of the ${esc(hubDef?.name ?? "board")}'s controller, from the board module's nets: every controller pin on a net other than ground, with what else is on that net. Passives are listed by their role.</p>`);
    out.push(table([{ h: "Pad", cls: "num" }, { h: "Pin" }, { h: "Net" }, { h: "Also on the net" }], pinRows, { split: true, caption: "Controller pinout", cls: "dense" }));
  }

  // power rails: the system's, then each board's own rails (checked on the board module, as protoboard check does)
  const budgets: { d: (typeof ctx.checks.diagnostics)[number]; base: string; prefix: string }[] = [
    ...ctx.checks.diagnostics.filter((d) => d.rule === "supply_budget").map((d) => ({ d, base: `sys:checks.diagnostics[id=${d.id}]`, prefix: "" })),
    ...ctx.boards.flatMap((b) => b.diagnostics.filter((d) => d.rule === "supply_budget").map((d) => ({ d, base: `sys:boards[path=${b.path}].diagnostics[id=${d.id}]`, prefix: b.path }))),
  ];
  const full = (prefix: string, ref: string) => (prefix ? `${prefix}/${ref}` : ref);
  const railRows = budgets.map(({ d, base, prefix }) => {
    const q = (k: string) => `${base}.details.${k}`;
    const det = (d.details ?? {}) as any;
    const [path, iface] = full(prefix, d.refs[0]).split(":");
    const leaf = leafOf(ctx.sys.system, ctx.sys.lookup, path, iface);
    const loads = d.refs.slice(1).filter((r) => !r.startsWith("link:")).map((r) => full(prefix, r));
    const net = prefix ? boardNetOf(env, prefix, d.refs[0]) : undefined;
    return [
      `<b>${esc(net ? `${net} · ${leaf?.iface.name ?? d.refs[0]}` : (leaf?.iface.name ?? d.refs[0]))}</b><br><span class="muted small">${esc(full(prefix, d.refs[0]))}</span>`,
      leaf ? doc.v(`def:${leaf.def.id}:interfaces[id=${leaf.iface.id}].parameters[id=voltage].value`, "d1") : "—",
      det.capacityW !== undefined
        ? doc.v(q("capacityW"), "u=W")
        : det.suppliedFrom
          ? `from ${doc.v(q("suppliedFrom"))}${det.assumption ? ' <sup class="mk mk-assumption">A</sup>' : ""}`
          : '<span class="v st-gap">—</span><sup class="mk mk-gap">—</sup>',
      det.loadW !== undefined ? doc.v(q("loadW"), "u=W|s3") : det.suppliedFrom ? '<span class="muted">in parent</span>' : '<span class="v st-gap">—</span>',
      esc(loads.join(", ")),
      esc((det.unknownLoads ?? []).map((r: string) => full(prefix, r)).join(", ") || (det.suppliedFrom ? `budgeted on ${det.suppliedFrom}${det.assumption ? " (assumed branch)" : ""}` : det.capacityW === undefined ? "source has no current rating" : "—")),
    ];
  });

  // ---------------------------------------------------------------- 05 electrical
  out.push(sec("05", "Electrical characteristics", "", ' data-break="before"'));
  const meters = meterChart({
    width: 330,
    status: "model",
    rows: budgets
      .filter(({ d }) => (d.details as any)?.capacityW !== undefined)
      .map(({ d, prefix }) => ({ label: prefix ? `${boardNetOf(env, prefix, d.refs[0]) ?? railName(env, full(prefix, d.refs[0]))}` : railName(env, d.refs[0]), value: (d.details as any).loadW, capacity: (d.details as any).capacityW, unit: "W", note: ((d.details as any).unknownLoads ?? []).length ? `+ ${((d.details as any).unknownLoads as string[]).length} load(s) with no stated draw` : undefined })),
  });
  const pc = ctx.checks.diagnostics.find((d) => d.rule === "propulsion_current");
  const pcd = (pc?.details ?? {}) as any;
  const propChart = pc
    ? barChart({
        width: 330,
        height: 180,
        status: "model",
        categories: ["Motors, peak (sum)"],
        series: [{ label: "Peak", values: [pcd.totalPeak], color: ACCENT }],
        y: { label: "Current", unit: "A" },
        refs: [
          ...(pcd.cont !== undefined ? [{ value: pcd.cont, label: `battery continuous ${pcd.cont} A` }] : []),
          ...(pcd.burst !== undefined ? [{ value: pcd.burst, label: `battery burst ${pcd.burst} A` }] : []),
        ],
        valueLabels: true,
        decimals: 1,
      })
    : "";
  const meterRows = budgets.filter(({ d }) => (d.details as any)?.capacityW !== undefined);
  const elCharts = [
    ...(meterRows.length ? [`<div class="chartbox"><h3>${pc ? "BEC and rail" : "Rail"} utilisation (known loads)</h3>${meters}<div class="cap"><b>Figure ${figNum(env)}</b><span>checkSystem supply_budget.</span></div></div>`] : []),
    ...(pc ? [`<div class="chartbox"><h3>Propulsion peak current vs battery ratings</h3>${propChart}<div class="cap"><b>Figure ${figNum(env)}</b><span>${esc(pc.message)}</span></div></div>`] : []),
  ];
  if (elCharts.length) out.push(`<div class="block"><div class="cols">${elCharts.join("")}${elCharts.length < 2 ? "<div></div>" : ""}</div></div>`);
  out.push(`<div class="block keep">${sub("Power rails")}${table([{ h: "Rail" }, { h: "Voltage", cls: "num" }, { h: "Capacity", cls: "num" }, { h: "Known load", cls: "num" }, { h: "Loads" }, { h: "Unbudgeted" }], railRows, { foot: "From checkSystem rule supply_budget: capacity = rail voltage × current rating; loads that state no draw cannot be budgeted. A branch rail (supplied_from) is budgeted on the output that feeds it; A marks a relation assumed, not cited." })}</div>`);
  // operating ranges of power inputs
  const opRows: string[][] = [];
  for (const inst of ctx.scene.assembly.instances.filter((i) => i.kind === "module")) {
    for (const iface of inst.def.interfaces) {
      if (!iface.protocols?.some((p) => p.type === "power") || !iface.parameters?.some((p) => p.id === "voltage")) continue;
      const roles = iface.protocols.flatMap((p) => p.roles ?? []);
      if (!roles.some((r) => /sink|input|consumer/.test(r)) && !/in$|_in|vcc|vin/.test(iface.id)) continue;
      opRows.push([esc(inst.def.name), `${esc(iface.name)} <span class="muted small">${esc(iface.pin ?? "")}</span>`, doc.v(`def:${inst.def.id}:interfaces[id=${iface.id}].parameters[id=voltage].value`, "d1"), iface.parameters.some((p) => p.id === "min_supply_power") ? doc.v(`def:${inst.def.id}:interfaces[id=${iface.id}].parameters[id=min_supply_power].value`) : '<span class="muted">—</span>']);
    }
  }
  out.push(`<div class="block">${sub("Supply inputs")}${table([{ h: "Module" }, { h: "Input" }, { h: "Voltage range", cls: "num" }, { h: "Min. supply power", cls: "num" }], opRows, { cls: "dense" })}</div>`);
  const linkStates = ctx.checks.links;
  out.push(`<p class="small muted">Stored links: ${linkStates.length}; configured: ${linkStates.filter((l) => l.state === "configured").length}. Diagnostics on the nominal build: ${ctx.checks.diagnostics.map((d) => `${d.severity} ${d.rule}`).join(", ")}.</p>`);

  // ---------------------------------------------------------------- 06 performance
  out.push(sec("06", "Performance", "test data", ' data-break="before"'));
  const perfStart = out.length;
  const motor = ctx.scene.assembly.instances.find((i) => category(i.def) === "motor")?.def;
  const tests = motor ? thrustTests(motor) : [];
  const mq = (i: number, k: string) => `def:${motor!.id}:traits[type=performance].params.thrust_tests[${i}].${k}`;
  const fitted = ctx.scene.assembly.instances.find((i) => category(i.def) === "prop")?.def.name ?? "";
  if (motor && tests.length) {
    // the maker's full table: every printed row of every test prop, side by side by throttle
    const throttles = [...new Set(tests.flatMap((t) => t.rows.map((r) => r.throttle_pct)))].sort((a, b) => a - b);
    const cols = [{ h: "Throttle", cls: "num" }, ...tests.flatMap((t) => [
      { h: `${t.propeller.replace(/^MEPS /, "")} V`, cls: "num" },
      { h: "A", cls: "num" },
      { h: "rpm", cls: "num" },
      { h: "g", cls: "num" },
      { h: "W", cls: "num" },
    ])];
    const rowq = (i: number, pct: number, k: string) => mq(i, `rows[throttle_pct=${pct}].${k}`);
    const rows = throttles.map((pct) => [
      `${pct} %`,
      ...tests.flatMap((t, i) =>
        t.rows.some((r) => r.throttle_pct === pct)
          ? [doc.v(rowq(i, pct, "voltage_V"), "d1|nounit"), doc.v(rowq(i, pct, "current_A"), "d1|nounit"), doc.v(rowq(i, pct, "rpm"), "nounit"), doc.v(rowq(i, pct, "thrust_g"), "nounit"), doc.v(rowq(i, pct, "power_W"), "nounit")]
          : ["—", "—", "—", "—", "—"],
      ),
    ]);
    const heads = tests.map((_, i) => `${doc.v(mq(i, "propeller"))} at ${doc.v(mq(i, "supply_V"), "d1")}`).join("; ");
    out.push(`<div class="block keep">${sub("Motor thrust tables (manufacturer)")}${table(cols, rows, {
      cls: "dense",
      foot: `${esc(motor.name)}: every row of the maker's KV table, per test propeller (${heads}); columns per propeller are measured supply voltage, current, speed, thrust and electrical power. The fitted propeller (${esc(fitted)}) is not one the maker tested, so these figures, and every figure derived from them below, are for the maker's test props.`,
    })}</div>`);
  }
  const sweep = testOf(env, "throttle-sweep");
  const hover = testOf(env, "hover-current");
  const flight = testOf(env, "flight-time");
  const twr = testOf(env, "thrust-to-weight");
  const escT = testOf(env, "esc-temp-punchout");
  const dis = testOf(env, "battery-discharge");
  // test data the multirotor recipe does not draw (any other product's files): one block each,
  // its rows as a table, its last numeric column as a bar chart, its summary bound as values
  const KNOWN_TESTS = new Set(["throttle-sweep", "hover-current", "flight-time", "thrust-to-weight", "esc-temp-punchout", "battery-discharge"]);
  const others = [...ctx.tests.values()].filter((t) => !KNOWN_TESTS.has(t.id)).sort((a, b) => a.id.localeCompare(b.id));
  const anyStandin = [sweep, hover, flight, twr, escT, dis, ...others].some((t) => t?.status === "standin");
  if (anyStandin) {
    out.push(note("caution", `Charts and figures tagged <span class="tag warn">stand-in · not measured</span> are derived from the model to show the expected shape. Replace them by dropping measured files into <code>${esc(env.docRel)}/test-data/</code> (status <code>measured</code>); the next build swaps them in.`));
  }
  const charts: string[] = [];
  if (sweep && motor && tests.length) {
    const thr = column(sweep, "throttle");
    const tpm = column(sweep, "thrust_motor");
    const ipm = column(sweep, "current_motor");
    charts.push(`<div class="chartbox"><h3>Thrust and current per motor vs throttle ${testTag(sweep)}</h3>${lineChart({
      status: sweep.status,
      testIds: [sweep.id],
      x: { label: "Throttle", unit: "%", min: 0, max: 100 },
      y: { label: "Thrust", unit: "g", min: 0 },
      y2: { label: "Current", unit: "A", min: 0 },
      legend: true,
      series: [
        { label: "thrust", points: thr.map((t, i) => [t, tpm[i]]) },
        { label: "current", points: thr.map((t, i) => [t, ipm[i]]), axis: "y2", color: "#1b1b1b", dashed: true },
        { label: "maker's rows", points: tests[0].rows.map((r) => [r.throttle_pct, r.thrust_g]), markersOnly: true, color: ACCENT },
        { label: "", points: tests[0].rows.map((r) => [r.throttle_pct, r.current_A]), markersOnly: true, axis: "y2", color: "#1b1b1b", endLabel: false },
      ],
    })}<div class="cap"><b>Figure ${figNum(env)}</b><span>Circles: every row of the maker's table (${esc(tests[0].propeller)} at ${tests[0].supply_V} V, not the fitted prop). Lines: ${esc(sweep.provenance.method)}</span></div></div>`);
  }
  if (flight) {
    const names = flight.rows.map((r) => String(r[0]));
    charts.push(`<div class="chartbox"><h3>Flight time by regime ${testTag(flight)}</h3>${barChart({
      status: flight.status,
      testIds: [flight.id],
      categories: names,
      series: [{ label: "Flight time (min)", values: column(flight, "minutes"), color: ACCENT }],
      y: { label: "Flight time", unit: "min" },
      valueLabels: true,
      decimals: 1,
    })}<div class="cap"><b>Figure ${figNum(env)}</b><span>${esc(flight.provenance.method)}</span></div></div>`);
  }
  if (dis) {
    const used = column(dis, "used");
    charts.push(`<div class="chartbox"><h3>Battery discharge ${testTag(dis)}</h3>${lineChart({
      status: dis.status,
      testIds: [dis.id],
      x: { label: "Capacity used", unit: "mAh", min: 0 },
      legend: true,
      y: { label: "Pack voltage", unit: "V", min: Math.floor(Math.min(...column(dis, "v_mix")) - 1), max: Math.ceil(Math.max(...column(dis, "v_rest")) + 0.5) },
      series: [
        { label: "open circuit", points: used.map((u, i) => [u, column(dis, "v_rest")[i]]), color: "#8c8c8c" },
        { label: "hover", points: used.map((u, i) => [u, column(dis, "v_hover")[i]]), color: "#1b1b1b" },
        { label: "freestyle avg", points: used.map((u, i) => [u, column(dis, "v_mix")[i]]), color: ACCENT },
      ],
    })}<div class="cap"><b>Figure ${figNum(env)}</b><span>${esc(dis.provenance.method)}</span></div></div>`);
  }
  if (escT) {
    const t = column(escT, "time");
    charts.push(`<div class="chartbox"><h3>ESC temperature over a punch-out ${testTag(escT)}</h3>${lineChart({
      status: escT.status,
      testIds: [escT.id],
      x: { label: "Time", unit: "s", min: 0 },
      y: { label: "Temperature", unit: "°C", min: Math.floor(Math.min(...column(escT, "temperature")) / 5) * 5 - 5 },
      y2: { label: "Throttle", unit: "%", min: 0, max: 100 },
      legend: true,
      series: [
        { label: "ESC board", points: t.map((x, i) => [x, column(escT, "temperature")[i]]) },
        { label: "throttle", points: t.map((x, i) => [x, column(escT, "throttle")[i]]), axis: "y2", color: "#9a9a9a", dashed: true },
      ],
    })}<div class="cap"><b>Figure ${figNum(env)}</b><span>${esc(escT.provenance.method)}</span></div></div>`);
  }
  for (let i = 0; i < charts.length; i += 2) out.push(`<div class="block keep"><div class="cols">${charts[i]}${charts[i + 1] ?? "<div></div>"}</div></div>`);

  for (const t of others) {
    const numeric = t.columns.map((_, j) => t.rows.length > 0 && t.rows.every((r) => typeof r[j] === "number"));
    const last = numeric.lastIndexOf(true);
    const keyed = last > 0 && !numeric[0];
    const cell = (i: number, j: number) => doc.v(`test:${t.id}:rows[${i}][${j}]`, numeric[j] ? "nounit" : undefined);
    const tableCols = [...(keyed ? [{ h: "#" }] : []), ...t.columns.map((c, j) => ({ h: c.unit ? `${esc(c.label)} (${esc(c.unit)})` : esc(c.label), cls: numeric[j] ? "num" : undefined }))];
    const tableRows = t.rows.map((r, i) => [...(keyed ? [`P${i + 1}`] : []), ...r.map((_, j) => cell(i, j))]);
    const cond = t.conditions.length ? ` Conditions: ${t.conditions.map((c) => `${esc(c.name)} ${esc(String(c.value))}${c.unit ? "\u00a0" + esc(c.unit) : ""}`).join("; ")}.` : "";
    out.push(`<div class="block keep">${sub(t.title)}<p class="small">${testTag(t)}</p>${table(tableCols, tableRows, { cls: "dense", foot: `${esc(t.provenance.method)}${cond}` })}</div>`);
    const sum = t.summary.map((x) => [esc(x.label), doc.v(`test:${t.id}:summary[id=${x.id}].value`), esc(t.id)]);
    const sumTable = sum.length ? `${sub("Performance summary")}${table([{ h: "Figure" }, { h: "Value", cls: "num" }, { h: "Test data" }], sum, { cls: "dense" })}` : "";
    if (keyed) {
      const col = t.columns[last];
      const chart = `<div class="chartbox"><h3>${esc(col.label)} by row ${testTag(t)}</h3>${barChart({
        status: t.status,
        testIds: [t.id],
        categories: t.rows.map((_, i) => `P${i + 1}`),
        series: [{ label: col.label, values: column(t, col.id), color: ACCENT }],
        y: { label: col.label, unit: col.unit },
        valueLabels: true,
        decimals: 0,
      })}<div class="cap"><b>Figure ${figNum(env)}</b><span>${esc(t.title)}; P1-P${t.rows.length} are the table's rows.</span></div></div>`;
      out.push(`<div class="block keep"><div class="cols">${chart}<div>${sumTable}</div></div></div>`);
    } else if (sumTable) out.push(`<div class="block keep">${sumTable}</div>`);
    if (t.status === "standin" && t.provenance.assumptions?.length) out.push(`<div class="block keep">${sub("Stand-in assumptions")}<ul class="small tight">${t.provenance.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>`);
  }

  if (hover || twr || sweep) {
    const rows: string[][] = [];
    if (hover) {
      for (const s of hover.summary) rows.push([esc(s.label), doc.v(`test:${hover.id}:summary[id=${s.id}].value`, s.unit === "A" ? "d1" : undefined), esc(hover.id)]);
    }
    if (sweep) for (const s of sweep.summary) rows.push([esc(s.label), doc.v(`test:${sweep.id}:summary[id=${s.id}].value`, s.unit === "g" ? "si|d2" : "d1"), esc(sweep.id)]);
    if (twr) {
      for (let i = 0; i < twr.rows.length; i++) rows.push([`Thrust-to-weight at ${doc.v(`test:${twr.id}:rows[${i}][0]`, "d1")}`, doc.v(`test:${twr.id}:rows[${i}][2]`, "d1|nounit") + " : 1", esc(twr.id)]);
    }
    if (flight) for (const s of flight.summary) rows.push([`Flight time, ${esc(s.label.toLowerCase())}`, doc.v(`test:${flight.id}:summary[id=${s.id}].value`, "d1"), esc(flight.id)]);
    if (escT) for (const s of escT.summary) rows.push([`ESC ${esc(s.label.toLowerCase())}`, doc.v(`test:${escT.id}:summary[id=${s.id}].value`, "d1"), esc(escT.id)]);
    out.push(`<div class="block keep">${sub("Performance summary")}${table([{ h: "Figure" }, { h: "Value", cls: "num" }, { h: "Test data" }], rows, { cls: "dense" })}</div>`);
    const assumptions = [...new Set([sweep, hover, flight, twr, escT, dis].flatMap((t) => (t?.status === "standin" ? t.provenance.assumptions ?? [] : [])))];
    if (assumptions.length) out.push(`<div class="block keep">${sub("Stand-in assumptions")}<ul class="small tight">${assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>`);
  }

  // figures the doc spec names (model queries): a system that is not a multirotor states its own (battery life)
  const perf = ds.performance;
  if (perf?.charts?.length) {
    const boxes = perf.charts.map((c) => {
      const vals = c.items.map((it) => Number(ctx.resolve(it.q).value));
      const refs = (c.refs ?? []).map((r) => ({ value: Number(ctx.resolve(r.q).value), label: r.label }));
      const status = c.items.some((it) => ctx.resolve(it.q).status === "standin") ? "standin" : "model";
      return `<div class="chartbox"><h3>${esc(c.title)}</h3>${barChart({ status, categories: c.items.map((it) => it.label), series: [{ label: c.y, values: vals, color: ACCENT }], y: { label: c.y, unit: c.unit }, refs, valueLabels: true, decimals: c.decimals ?? 1 })}<div class="cap"><b>Figure ${figNum(env)}</b><span>${esc(c.caption ?? "")}</span></div></div>`;
    });
    for (let i = 0; i < boxes.length; i += 2) out.push(`<div class="block keep"><div class="cols">${boxes[i]}${boxes[i + 1] ?? "<div></div>"}</div></div>`);
  }
  if (perf?.rows?.length) {
    out.push(`<div class="block keep">${sub(perf.title ?? "Performance summary")}${table([{ h: "Figure" }, { h: "Value", cls: "num" }, { h: "Basis" }], perf.rows.map((r) => [esc(r.label), doc.v(r.q, r.f), esc(r.sub ?? "")]), { cls: "dense", ...(perf.note ? { foot: perf.note } : {}) })}</div>`);
  }

  if (out.length === perfStart)
    out.push(`<p class="prose">No performance test data for this system yet: no part states a performance table, and <code>${esc(ctx.sys.docsDir)}/test-data/</code> has no measured files. Measured results placed there appear here on the next build.</p>`);

  // ---------------------------------------------------------------- 07 design checks
  out.push(sec("07", "Design checks", "checkSystem", ' data-break="before"'));
  out.push(`<p class="prose">The nominal build and each fault scenario in <code>scenarios.ts</code> run through <code>checkSystem</code> (the system and each circuit board in it). A fault scenario is expected to raise at least one error or warning.</p>`);
  const scenRows = ctx.scenarioChecks.map((s) => {
    const top = s.diagnostics.filter((d) => d.severity !== "info").slice(0, 3);
    return [
      `<b>${esc(s.label)}</b><br><span class="muted small">${esc(s.id)}</span>`,
      `<span class="tag err">${doc.v(`derived:diagCount(${s.id},error)`, undefined, { marker: false })} err</span> <span class="tag warn">${doc.v(`derived:diagCount(${s.id},warning)`, undefined, { marker: false })} warn</span> <span class="tag info">${doc.v(`derived:diagCount(${s.id},info)`, undefined, { marker: false })} info</span>`,
      top.length ? top.map((d) => `<span class="tag ${d.severity === "error" ? "err" : "warn"}">${esc(d.rule)}</span> ${esc(d.message)}`).join("<br>") : '<span class="muted">no errors or warnings</span>',
    ];
  });
  out.push(table([{ h: "Scenario" }, { h: "Diagnostics" }, { h: "Findings (errors and warnings)" }], scenRows, { split: true, caption: "Design checks" }));

  // ---------------------------------------------------------------- 08 BOM
  out.push(sec("08", "Bill of materials", bomFile(ctx.sys), ' data-break="before"'));
  const bomRows = ctx.bom.map((b: any) => {
    const q = (k: string) => `sys:bom[line=${b.line}].${k}`;
    const def = ctx.sys.lookup(b.partId);
    const hasW = def?.domains?.some((d) => d.domain === "mechanical" && d.weight_g !== undefined);
    const computed = def && !hasW ? moduleMass(def, cadVolume(ctx.sys)) : undefined;
    return [
      doc.v(q("line")),
      `${doc.v(q("name"), undefined, { cls: "wrap" })}${b.value ? ` <span class="small">${doc.v(q("value"), undefined, { marker: false })}</span>` : ""}<br><span class="muted small">${esc(b.partId)}</span>`,
      `${doc.v(q("manufacturer"), undefined, { cls: "wrap" })}${b.partNumber ? `<br><span class="muted small">${doc.v(q("partNumber"), undefined, { cls: "wrap" })}</span>` : ""}`,
      doc.v(q("quantity")) + (b.packQuantity ? `<br><span class="muted small">pack of ${doc.v(q("packQuantity"))}</span>` : ""),
      b.buy === "included" ? `<span class="tag">incl.</span><br><span class="muted small">${esc(b.includedWith)}</span>` : `<span class="tag ${b.buy === "fabricate" ? "warn" : ""}">${esc(b.buy)}</span>`,
      hasW ? doc.v(`def:${b.partId}:domains[domain=mechanical].weight_g`) : computed ? doc.v(`derived:mass.module(${b.partId})`) : '<span class="v st-gap">—</span>',
      `${doc.v(q("verification"))}<br><span class="muted small">A ${doc.v(q("assumptions"), undefined, { marker: false })} · gaps ${doc.v(q("openGaps"), undefined, { marker: false })}</span>`,
    ];
  });
  out.push(`<div class="bom">${table([{ h: "#", cls: "num" }, { h: "Part" }, { h: "Manufacturer / P/N" }, { h: "Qty", cls: "num" }, { h: "Supply" }, { h: "Mass", cls: "num" }, { h: "Verification" }], bomRows, { split: true, caption: "Bill of materials", cls: "bomtable", foot: `Rows as written by the document build (${bomFile(ctx.sys)}). Mass per piece: the part's stated weight, else CAD volume × declared material density (derived); — = no mass in the model. A = assumption traits.` })}</div>`);

  // ---------------------------------------------------------------- 09 evidence
  out.push(sec("09", "Evidence and assumptions", "", ' data-break="before"'));
  const partIds = [...new Set(ctx.bom.map((b: any) => b.partId as string))];
  const evRows = partIds.map((id) => {
    const def = ctx.sys.lookup(id)!;
    const v = moduleVerification(ctx.sys, id);
    const srcs = moduleSources(ctx.sys, id);
    const assumptions = (def.traits ?? []).filter((t) => t.type === "assumption");
    const gaps: string[] = v?.data_gaps ?? (def.traits ?? []).filter((t) => t.type === "data_gap").flatMap((t) => (t.params?.fields as string[]) ?? []);
    return [
      `<b>${esc(def.name)}</b>`,
      String(srcs.length || "—"),
      v?.audit && typeof v.audit.checked === "number" ? `${doc.v(`ver:${id}:audit.confirmed`, undefined, { marker: false })}/${doc.v(`ver:${id}:audit.checked`, undefined, { marker: false })}` : v?.audit ? "audited" : '<span class="muted">not audited</span>',
      assumptions.length ? assumptions.map((a) => `<span class="mk-inline">A</span> ${esc(String(a.params?.field ?? ""))}: ${esc(String(a.params?.value ?? a.params?.reason ?? "")).slice(0, 90)}`).join("<br>") : '<span class="muted">—</span>',
      gaps.length ? esc(gaps.slice(0, 5).join("; ")) + (gaps.length > 5 ? ` <span class="muted">(+${gaps.length - 5})</span>` : "") : '<span class="muted">—</span>',
    ];
  });
  out.push(table([{ h: "Part" }, { h: "Sources", cls: "num" }, { h: "Audit" }, { h: "Assumptions" }, { h: "Open data gaps" }], evRows, { split: true, caption: "Evidence", cls: "evtable", foot: "Sources: sources.json entries. Audit: independent re-check of facts against the sources (verification.json)." }));

  // ---------------------------------------------------------------- 10 provenance (built last: it lists every value above)
  return out.join("\n");
}

/** Provenance section: counts by status, then every value that is not a plain cited source value. */
export function provenanceSection(env: BuildEnv): string {
  const { doc } = env;
  const vals = [...doc.values.values()];
  const count = (s: ValueStatus) => vals.filter((v) => v.status === s).length;
  const statuses: ValueStatus[] = ["source", "model", "derived", "assumption", "standin", "measured", "gap"];
  const flagged = vals.filter((v) => v.status !== "source" && v.status !== "model");
  const seen = new Set<string>();
  const rows = flagged
    .filter((v) => (seen.has(v.q) ? false : (seen.add(v.q), true)))
    .map((v) => [
      `<sup class="mk mk-${v.status}">${MARKERS[v.status]?.mark ?? ""}</sup> ${esc(MARKERS[v.status]?.label ?? v.status)}`,
      esc(v.text),
      `<code class="q">${esc(v.q)}</code>`,
      // allow breaks after "/" so long source URLs wrap inside the column
      esc([v.formula, v.note, v.inputs?.length ? `inputs: ${v.inputs.length}` : "", v.source && v.status !== "derived" ? v.source : ""].filter(Boolean).join(" · ")).slice(0, 260).replace(/\//g, "/\u200b"),
    ]);
  return `${sec("10", "Value provenance", "", ' data-break="before"')}
  <p class="prose">This document shows ${vals.length} bound values. Each is a query into the UHD model, re-resolved and compared by <code>uhd-tech-docs-verify</code>; the full list with sources is in <code>${esc(env.doc.meta.docId.toLowerCase())}.values.json</code> next to the document.</p>
  <div class="block">${table(
    [{ h: "Status" }, { h: "Values", cls: "num" }, { h: "Meaning" }],
    statuses.filter((s) => count(s)).map((s) => [esc(MARKERS[s]?.label ?? (s === "source" ? "Cited source" : "Model design value")), String(count(s)), esc(MARKERS[s]?.help ?? (s === "source" ? "stated by a source in the part's sources.json" : "a design value of a custom module, or a UHD check result"))]),
    { cls: "dense" },
  )}</div>
  ${table([{ h: "Status" }, { h: "Value" }, { h: "Query" }, { h: "Derivation / reason" }], rows, { split: true, caption: "Flagged values", cls: "provtable dense" })}`;
}

/** The net a board-relative output (`u7:vout`, a pin or a composite of pins) drives on the board at `boardPath`: its name. */
function boardNetOf(env: BuildEnv, boardPath: string, ref: string): string | undefined {
  const board = env.ctx.instances.get(boardPath);
  if (!board) return undefined;
  const [child, iface] = ref.split(":");
  const def = env.ctx.sys.lookup(board.children?.find((c) => c.id === child)?.moduleDefId ?? "");
  const i = def?.interfaces.find((x) => x.id === iface);
  if (!i) return undefined;
  // the pins behind it: itself, or the composite's bound pins (its first power pin: the rail, not ground)
  const pins = [iface, ...Object.entries(slotBindings(i)).filter(([slot]) => !/gnd|ground|neg/.test(slot)).map(([, leaf]) => leaf)];
  for (const pin of pins) {
    const l = (board.links ?? []).find((x) => "child" in x.a && x.a.child === child && x.a.interfaceId === pin && "self" in x.b);
    const netId = l && "interfaceId" in l.b ? l.b.interfaceId : undefined;
    const net = netId ? board.interfaces.find((x) => x.id === netId) : undefined;
    if (net) return net.name ?? net.id;
  }
  return undefined;
}

function railName(env: BuildEnv, ref: string): string {
  const [path, iface] = ref.split(":");
  const leaf = leafOf(env.ctx.sys.system, env.ctx.sys.lookup, path, iface);
  return leaf ? `${leaf.iface.name} (${ref})` : ref;
}

/** Instance label along a path of child ids: the child refs' names ("Flight controller"). */
function instanceLabel(env: BuildEnv, path: string[]): string {
  let owner = env.ctx.sys.system;
  let name = path.join("/");
  for (const id of path) {
    const ref = owner.children?.find((c) => c.id === id);
    if (!ref) break;
    name = ref.name ?? ref.moduleDefId;
    const d = env.ctx.sys.lookup(ref.moduleDefId);
    if (!d) break;
    owner = d;
  }
  return name;
}

/** Power and signal architecture drawn from the stored links around the hub module. */
function systemDiagram(env: BuildEnv): string {
  const { ctx } = env;
  const hub = ctx.sys.config.datasheet?.hub;
  type Node = { key: string; def: ModuleDef; label: string; count: number };
  const edges: { a: string; b: string; labels: string[]; power: boolean }[] = [];
  const nodes = new Map<string, Node>();
  const motorCount = ctx.scene.assembly.instances.filter((i) => category(i.def) === "motor").length;
  for (const s of ctx.wiring) {
    if (s.domain !== "electrical") continue;
    const ea = parseEnd(s.a);
    const eb = parseEnd(s.b);
    const la = endOf(ctx.sys.system, ctx.sys.lookup, ea.path, ea.iface);
    const lb = endOf(ctx.sys.system, ctx.sys.lookup, eb.path, eb.iface);
    if (!la || !lb) continue;
    const prefix = s.linkId.includes("/") ? s.linkId.split("/").slice(0, -1) : [];
    // a leaf inside the hub (a board's pads, reached through its exports) is the hub
    const hubDef = hub ? ctx.instances.get(hub) : undefined;
    const toHub = (p: string[], d: ModuleDef): [string[], ModuleDef] => (hub && hubDef && p.join("/").startsWith(hub + "/") ? [hub.split("/"), hubDef] : [p, d]);
    const [pa, da] = toHub([...prefix, ...la.path], la.def);
    const [pb, db] = toHub([...prefix, ...lb.path], lb.def);
    // identical instances (four arms) collapse into one node
    const keyOf = (p: string[], d: ModuleDef) => (category(d) === "motor" ? `motor:${d.id}` : p.join("/"));
    const ka = keyOf(pa, da);
    const kb = keyOf(pb, db);
    for (const [k, d, p] of [[ka, da, pa], [kb, db, pb]] as const) {
      if (!nodes.has(k)) nodes.set(k, { key: k, def: d, label: category(d) === "motor" ? "Motors" : instanceLabel(env, [...p]), count: category(d) === "motor" ? motorCount : 1 });
    }
    const power = s.protocol === "power";
    const hubEnd = ka === hub ? la : kb === hub ? lb : undefined;
    const label: string = hubEnd ? (hubEnd.iface.pin && power ? String(hubEnd.iface.pin) : (hubEnd.iface.name ?? hubEnd.iface.id).replace(/ \(.*\)$/, "")) : s.protocol === "power" ? s.name.replace(/\s*[+−-]$/, "") : s.protocol.replace("bldc_3phase", "3-phase").replace("fc_esc_connector", "8-pin FC–ESC");
    const ex = edges.find((e) => (e.a === ka && e.b === kb) || (e.a === kb && e.b === ka));
    if (ex) {
      if (!ex.labels.includes(label)) ex.labels.push(label);
      ex.power = ex.power && power;
    } else edges.push({ a: ka, b: kb, labels: [label], power });
  }
  if (!hub || !nodes.has(hub)) return "";
  const nb = (k: string) => edges.filter((e) => e.a === k || e.b === k).map((e) => (e.a === k ? e.b : e.a));
  const battery = [...nodes.values()].find((n) => category(n.def) === "battery")?.key;
  const prev = new Map<string, string>();
  const q = [hub];
  const seen = new Set([hub]);
  while (q.length) {
    const k = q.shift()!;
    for (const n of nb(k)) if (!seen.has(n)) (seen.add(n), prev.set(n, k), q.push(n));
  }
  const chain: string[] = []; // hub-adjacent first
  for (let k = battery; k && k !== hub; k = prev.get(k)) chain.unshift(k);
  chain.reverse();
  const chainOrdered = [...chain].reverse(); // nearest the hub first
  const right = nb(hub).filter((k) => !chain.includes(k));
  const below = [...new Set(chain.flatMap((k) => nb(k)).filter((k) => k !== hub && !chain.includes(k) && !right.includes(k)))];

  const boxW = 124;
  const boxH = 40;
  const colGap = 74;
  const rowGap = 58;
  const pos = new Map<string, { x: number; y: number }>();
  const nChain = chain.length;
  const hubX = nChain * (boxW + colGap);
  const rightX = hubX + boxW + 104;
  const hubY = 20 + Math.max(0, ((right.length - 1) * rowGap) / 2);
  pos.set(hub, { x: hubX, y: hubY });
  right.forEach((k, i) => pos.set(k, { x: rightX, y: 20 + i * rowGap }));
  chainOrdered.forEach((k, i) => pos.set(k, { x: hubX - (i + 1) * (boxW + colGap), y: hubY }));
  for (const c of chainOrdered) {
    const kids = below.filter((b) => nb(c).includes(b) && !pos.has(b));
    kids.forEach((k, j) => {
      const p = pos.get(c)!;
      pos.set(k, { x: p.x, y: p.y + boxH + 46 + j * rowGap });
    });
  }
  // one more column: what the right-hand modules lead on to (a part behind its cable)
  const rightX2 = rightX + boxW + colGap;
  const beyond = right.flatMap((r) => nb(r).filter((k) => !pos.has(k)).map((k) => [r, k] as const));
  beyond.forEach(([r, k], j) => {
    if (pos.has(k)) return;
    const y = pos.get(r)!.y;
    pos.set(k, { x: rightX2, y: beyond.slice(0, j).some(([r2]) => r2 === r) ? y + j * rowGap : y });
  });
  const H = Math.max(...[...pos.values()].map((p) => p.y)) + boxH + 30;
  const Wd = (beyond.length ? rightX2 : rightX) + boxW + 4;
  const parts: string[] = [];
  const label = (x: number, y: number, lines: string[], color: string, anchor = "middle") =>
    lines.map((l, i) => `<text x="${x}" y="${y + i * 9}" font-size="7.4" text-anchor="${anchor}" fill="${color}">${esc(l)}</text>`).join("");
  for (const e of edges) {
    const a = pos.get(e.a);
    const b = pos.get(e.b);
    if (!a || !b) continue;
    const col = e.power ? "#1b1b1b" : ACCENT;
    const sw = e.power ? 1.6 : 1.2;
    const [p, r] = a.x <= b.x ? [a, b] : [b, a];
    if (Math.abs(p.x - r.x) < 1) {
      // vertical (chain module to the part below it)
      const [t, u] = p.y < r.y ? [p, r] : [r, p];
      parts.push(`<path d="M${t.x + boxW / 2} ${t.y + boxH} V${u.y}" stroke="${col}" stroke-width="${sw}" fill="none"/>`);
      parts.push(label(t.x + boxW / 2 + 6, (t.y + boxH + u.y) / 2 + 3, e.labels.slice(0, 2), e.power ? "#1b1b1b" : "#d94e00", "start"));
    } else if (Math.abs(p.y - r.y) < 1) {
      parts.push(`<path d="M${p.x + boxW} ${p.y + boxH / 2} H${r.x}" stroke="${col}" stroke-width="${sw}" fill="none"/>`);
      parts.push(label((p.x + boxW + r.x) / 2, p.y + boxH / 2 - 5 - (e.labels.length - 1) * 9, e.labels.slice(0, 3), e.power ? "#1b1b1b" : "#d94e00"));
    } else {
      const mx = p.x + boxW + 40;
      parts.push(`<path d="M${p.x + boxW} ${p.y + boxH / 2} H${mx} V${r.y + boxH / 2} H${r.x}" stroke="${col}" stroke-width="${sw}" fill="none"/>`);
      parts.push(label(mx + 8, r.y + boxH / 2 - 4 - (Math.min(e.labels.length, 3) - 1) * 9, e.labels.slice(0, 3), e.power ? "#1b1b1b" : "#d94e00", "start"));
    }
  }
  for (const [k, p] of pos) {
    const n = nodes.get(k)!;
    const isHub = k === hub;
    const part = n.def.name.replace(/\s*\(.*?\)\s*/g, " ").trim();
    parts.push(`<rect x="${p.x}" y="${p.y}" width="${boxW}" height="${boxH}" fill="${isHub ? "#1b1b1b" : "#fff"}" stroke="#1b1b1b" stroke-width="0.9"/>`);
    if (isHub) parts.push(`<rect x="${p.x}" y="${p.y}" width="4" height="${boxH}" fill="${ACCENT}"/>`);
    parts.push(`<text x="${p.x + 9}" y="${p.y + 17}" font-size="9" font-weight="600" fill="${isHub ? "#fff" : "#1b1b1b"}">${esc(n.label)}${n.count > 1 ? ` ×${n.count}` : ""}</text>`);
    parts.push(`<text x="${p.x + 9}" y="${p.y + 31}" font-size="6.6" fill="${isHub ? "#bdbdbd" : "#6f6f6f"}">${esc(part.length > 27 ? part.slice(0, 26) + "…" : part)}</text>`);
  }
  const ly = H - 8;
  parts.push(`<line x1="0" x2="22" y1="${ly}" y2="${ly}" stroke="#1b1b1b" stroke-width="1.6"/><text x="28" y="${ly + 2.6}" font-size="7" fill="#1b1b1b">power</text>`);
  parts.push(`<line x1="78" x2="100" y1="${ly}" y2="${ly}" stroke="${ACCENT}" stroke-width="1.2"/><text x="106" y="${ly + 2.6}" font-size="7" fill="#1b1b1b">signal / data</text>`);
  return `<svg class="sysdiag" viewBox="-2 0 ${Wd + 4} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="inherit">${parts.join("")}</svg>`;
}

/** The hub board's controller pins on nets other than ground: pad, pin name, net, and the other members. */
function controllerPinout(env: BuildEnv): string[][] {
  const { ctx, doc } = env;
  const hub = ctx.sys.config.datasheet?.hub;
  const board = hub ? ctx.instances.get(hub) : undefined;
  if (!board) return [];
  const nets = new Map(board.interfaces.filter((i) => i.protocols?.some((p) => p.type === "net")).map((i) => [i.id, i]));
  if (!nets.size) return [];
  const ctl = (board.children ?? []).find((c) => (ctx.sys.lookup(c.moduleDefId)?.categories ?? []).some((x) => x.startsWith("microcontroller")));
  const ctlDef = ctl && ctx.sys.lookup(ctl.moduleDefId);
  if (!ctl || !ctlDef) return [];
  const members = new Map<string, { child: string; pin: string }[]>();
  for (const l of board.links ?? []) {
    if (!("child" in l.a) || !("self" in l.b) || !nets.has(l.b.interfaceId)) continue;
    members.set(l.b.interfaceId, [...(members.get(l.b.interfaceId) ?? []), { child: l.a.child, pin: l.a.interfaceId }]);
  }
  const rows: { pad: number; row: string[] }[] = [];
  for (const [netId, ms] of members) {
    if (/^(gnd|ground)$/i.test(netId)) continue;
    for (const m of ms.filter((x) => x.child === ctl.id)) {
      const iface = ctlDef.interfaces.find((i) => i.id === m.pin);
      const others = ms.filter((x) => x.child !== ctl.id).map((x) => {
        const ref = board.children?.find((c) => c.id === x.child);
        const d = ref && ctx.sys.lookup(ref.moduleDefId);
        return { x, ref, passive: (d?.categories ?? []).some((c) => c.startsWith("component.passive")), pin: d?.interfaces.find((i) => i.id === x.pin) };
      });
      // parts by pin; passives (decoupling, pull-ups, dividers) by reference only, on one line
      const parts = [...new Map(others.filter((o) => !o.passive).map((o) => [`${o.x.child}:${o.pin?.name ?? o.x.pin}`, o])).values()].map(
        (o) => `${esc(`${o.x.child.toUpperCase()} ${o.pin?.name ?? o.x.pin}`)}${o.ref?.name ? ` <span class="muted small">(${esc(o.ref.name)})</span>` : ""}`,
      );
      const passives = [...new Set(others.filter((o) => o.passive).map((o) => o.x.child.toUpperCase()))];
      if (passives.length) parts.push(`<span class="muted small">${esc(passives.join(", "))}</span>`);
      rows.push({
        pad: Number(iface?.pin ?? 0),
        row: [String(iface?.pin ?? "—"), doc.v(`def:${ctlDef.id}:interfaces[id=${m.pin}].name`), `<b>${esc(nets.get(netId)?.name ?? netId)}</b>`, parts.join("<br>") || '<span class="muted">—</span>'],
      });
    }
  }
  return rows.sort((a, b) => a.pad - b.pad).map((r) => r.row);
}

/**
 * The hub board's own architecture: its components (passives left out) and the nets that join them to the
 * board's controller: signal nets in the accent colour, supply rails in black. Components with no net to the
 * controller hang off the component they share a rail with (USB-C to the charger). Empty when the hub has no nets.
 */
function boardDiagram(env: BuildEnv): string {
  const { ctx } = env;
  const hub = ctx.sys.config.datasheet?.hub;
  const board = hub ? ctx.instances.get(hub) : undefined;
  if (!board || !board.interfaces.some((i) => i.protocols?.some((p) => p.type === "net"))) return "";
  const kids = (board.children ?? []).map((c) => ({ c, def: ctx.sys.lookup(c.moduleDefId) })).filter((x): x is { c: (typeof x)["c"]; def: ModuleDef } => !!x.def);
  const ctl = kids.find((k) => (k.def.categories ?? []).some((c) => c.startsWith("microcontroller")));
  if (!ctl) return "";
  const shown = kids.filter((k) => !(k.def.categories ?? []).some((c) => c.startsWith("component.passive")));
  const netName = new Map(board.interfaces.filter((i) => i.protocols?.some((p) => p.type === "net")).map((i) => [i.id, i]));
  const netsOf = new Map<string, Set<string>>();
  for (const l of board.links ?? []) {
    if (!("child" in l.a) || !("self" in l.b) || !netName.has(l.b.interfaceId)) continue;
    const set = netsOf.get(l.a.child) ?? new Set<string>();
    set.add(l.b.interfaceId);
    netsOf.set(l.a.child, set);
  }
  const isRail = (id: string) => netName.get(id)?.parameters?.some((p) => p.id === "voltage") ?? false;
  const isGround = (id: string) => /^(gnd|ground|agnd|dgnd)$/i.test(id);
  const shared = (a: string, b: string) => [...(netsOf.get(a) ?? [])].filter((n) => !isGround(n) && netsOf.get(b)?.has(n));
  type E = { a: string; b: string; labels: string[]; power: boolean };
  const edges: E[] = [];
  // the power path: supplies, protection, and connectors that carry a rail (USB-C, the cell pads)
  const power = (k: (typeof kids)[number]) =>
    (k.def.categories ?? []).some((c) => /^(power|component\.protection)/.test(c)) ||
    ((k.def.categories ?? []).some((c) => c.startsWith("connector")) && [...(netsOf.get(k.c.id) ?? [])].some(isRail));
  for (const k of shown) {
    if (k === ctl) continue;
    let to = ctl.c.id;
    let nets = shared(k.c.id, to);
    if (!nets.length) {
      const peer = shown.find((o) => o !== k && o !== ctl && power(o) && shared(k.c.id, o.c.id).length) ?? shown.find((o) => o !== k && o !== ctl && shared(k.c.id, o.c.id).length);
      if (!peer) continue;
      to = peer.c.id;
      nets = shared(k.c.id, to);
    }
    const signal = nets.filter((n) => !isRail(n));
    const rails = nets.filter(isRail);
    const names = (ids: string[]) => ids.map((n) => netName.get(n)?.name ?? n);
    if (signal.length) edges.push({ a: k.c.id, b: to, labels: names(signal), power: false });
    else if (rails.length) edges.push({ a: k.c.id, b: to, labels: names(rails), power: true });
  }
  const left = shown.filter((k) => k !== ctl && power(k) && edges.some((e) => e.a === k.c.id));
  const right = shown.filter((k) => k !== ctl && !power(k) && edges.some((e) => e.a === k.c.id));
  const boxW = 128;
  const boxH = 30;
  const rowGap = 40;
  const leftX = 0;
  const ctlX = 262;
  const rightX = 524;
  const rows = Math.max(left.length, right.length, 1);
  const H = rows * rowGap + 30;
  const pos = new Map<string, { x: number; y: number }>();
  left.forEach((k, i) => pos.set(k.c.id, { x: leftX, y: 10 + i * rowGap + ((rows - left.length) * rowGap) / 2 }));
  right.forEach((k, i) => pos.set(k.c.id, { x: rightX, y: 10 + i * rowGap + ((rows - right.length) * rowGap) / 2 }));
  pos.set(ctl.c.id, { x: ctlX, y: 10 + ((rows - 1) * rowGap) / 2 - 20 });
  const ctlH = boxH + 40;
  const parts: string[] = [];
  const lab = (x: number, y: number, t: string, color: string, anchor = "middle") => `<text x="${x}" y="${y}" font-size="6.6" text-anchor="${anchor}" fill="${color}">${esc(t)}</text>`;
  for (const e of edges) {
    const a = pos.get(e.a);
    const b = pos.get(e.b);
    if (!a || !b) continue;
    const col = e.power ? "#1b1b1b" : ACCENT;
    const bh = e.b === ctl.c.id ? ctlH : boxH;
    const [x1, y1] = a.x < b.x ? [a.x + boxW, a.y + boxH / 2] : [a.x, a.y + boxH / 2];
    const [x2, y2] = a.x < b.x ? [b.x, b.y + bh / 2] : b.x === a.x ? [b.x, b.y + bh / 2] : [b.x + boxW, b.y + bh / 2];
    if (a.x === b.x) {
      // two parts in one column: a bracket on their outer side
      const ox = a.x - 10;
      parts.push(`<path d="M${a.x} ${y1} H${ox} V${y2} H${b.x}" stroke="${col}" stroke-width="1.1" fill="none"/>`);
      parts.push(lab(ox - 3, (y1 + y2) / 2 + 2, e.labels.slice(0, 2).join(", "), col, "end"));
      continue;
    }
    const text = e.labels.length > 3 ? `${e.labels.slice(0, 3).join(", ")} +${e.labels.length - 3}` : e.labels.join(", ");
    parts.push(`<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${col}" stroke-width="${e.power ? 1.4 : 1.1}" fill="none"/>`);
    const tx = a.x < b.x ? x1 + 4 : x1 - 4;
    parts.push(lab(tx, y1 - 3, text, col, a.x < b.x ? "start" : "end"));
  }
  const box = (id: string, p: { x: number; y: number }, title: string, subt: string, h: number, dark: boolean) => {
    parts.push(`<rect x="${p.x}" y="${p.y}" width="${boxW}" height="${h}" fill="${dark ? "#1b1b1b" : "#fff"}" stroke="#1b1b1b" stroke-width="0.9"/>`);
    if (dark) parts.push(`<rect x="${p.x}" y="${p.y}" width="4" height="${h}" fill="${ACCENT}"/>`);
    parts.push(`<text x="${p.x + 8}" y="${p.y + 12}" font-size="8" font-weight="600" fill="${dark ? "#fff" : "#1b1b1b"}">${esc(title.length > 24 ? title.slice(0, 23) + "…" : title)}</text>`);
    parts.push(`<text x="${p.x + 8}" y="${p.y + 23}" font-size="6.4" fill="${dark ? "#bdbdbd" : "#6f6f6f"}">${esc((t => (t.length > 27 ? t.slice(0, 26) + "…" : t))(`${id.toUpperCase()} · ${subt}`))}</text>`);
  };
  for (const k of [...left, ...right]) box(k.c.id, pos.get(k.c.id)!, k.c.name ?? k.def.name, shortDefName(k.def).replace(/\s*\(.*?\)\s*/g, " ").trim(), boxH, false);
  box(ctl.c.id, pos.get(ctl.c.id)!, ctl.c.name ?? ctl.def.name, shortDefName(ctl.def).replace(/\s*\(.*?\)\s*/g, " ").trim(), ctlH, true);
  const ly = H - 6;
  parts.push(`<line x1="0" x2="22" y1="${ly}" y2="${ly}" stroke="#1b1b1b" stroke-width="1.4"/><text x="28" y="${ly + 2.6}" font-size="7" fill="#1b1b1b">supply rail</text>`);
  parts.push(`<line x1="90" x2="112" y1="${ly}" y2="${ly}" stroke="${ACCENT}" stroke-width="1.1"/><text x="118" y="${ly + 2.6}" font-size="7" fill="#1b1b1b">signal nets to the controller</text>`);
  return `<svg class="sysdiag" viewBox="-60 0 ${rightX + boxW + 64} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="inherit">${parts.join("")}</svg>`;
}

const shortDefName = (d: ModuleDef) => d.name.replace(/\s*\((included[^)]*|custom)\)/gi, "").replace(/, ISO 4762.*$/, "");
