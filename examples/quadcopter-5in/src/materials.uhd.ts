/**
 * Assembly materials the quadcopter's build uses that are neither parts with
 * interfaces nor fasteners (PB-836): what the work order's operations name
 * (solder and flux at every soldered joint, threadlocker on the motor and
 * standoff screws) and what holds the parts that have no mount (the
 * receiver under the top plate, the capacitor on the air unit, the
 * antennas). Each is a BOM line so the kit and the ordering list carry it;
 * the work order kits them at its first operation, and the assembly steps
 * that use them say how (docs/docspec.ts).
 *
 * They are specified by what the build needs (kind, size, amount), not by
 * product: no supplier is chosen (docs/decisions.md D-Q09). Same pattern as
 * the wearable watch's adhesives (examples/wearable-watch/src/materials.uhd.ts).
 */
import type { ModuleDef } from "@deltarobotics/uhd";

function material(o: { id: string; name: string; description: string; spec: string; why: string; source?: string }): ModuleDef {
  return {
    id: o.id,
    name: o.name,
    kind: "module",
    version: "0.1.0",
    // no manufacturer: no product is chosen yet (D-Q09); the data_gap below says so
    description: o.description,
    categories: ["mechanical.mounting"],
    tags: ["consumable", "assembly-material"],
    display: { icon: "layers" },
    interfaces: [],
    traits: [
      { type: "assumption", params: { field: "specification", value: o.spec, reason: o.why, ...(o.source ? { source: o.source } : {}) } },
      { type: "usage_note", params: { topic: "assembly", note: o.description } },
      { type: "data_gap", params: { fields: ["product", "supplier"], note: "Specified by kind and size only; no product is chosen yet (D-Q09)." } },
    ],
  };
}

export const QUAD_SOLDER = material({
  id: "quad-solder-wire",
  name: "Flux-cored solder wire, 0.8 mm",
  description: "Flux-cored solder wire, about 0.8 mm: every soldered joint (motor leads, battery lead, capacitor, receiver and GNSS wires; about 2 g per build).",
  spec: "Sn63/Pb37 or a lead-free SAC alloy, rosin or no-clean flux core, 0.6–1.0 mm",
  why: "The pads take 12 AWG down to 30 AWG wires; one fine wire suits all of them. Lead-free needs a hotter iron on the large battery pads.",
});

export const QUAD_FLUX = material({
  id: "quad-flux",
  name: "No-clean flux (pen or paste)",
  description: "No-clean flux, pen or paste: wetting the pads and tinning the cut leads before soldering.",
  spec: "no-clean rosin or synthetic flux, pen or syringe",
  why: "Cut leads are re-tinned (work order) and the ESC's large pads need flux to wet quickly without overheating the board.",
});

export const QUAD_THREADLOCKER = material({
  id: "quad-threadlocker",
  name: "Threadlocker, medium strength (blue)",
  description: "Medium-strength (blue) threadlocker: the 16 motor screws and the 8 standoff screws, one drop each.",
  spec: "medium-strength anaerobic threadlocker, removable with hand tools",
  why: "Steel screws into aluminium threads with no locking element back out under vibration; X-Team's motor-screw guide (a secondary source) advises medium strength. The nyloc joints need none.",
  source: "https://www.x-teamrc.com/fpv-motor-screws-falling-out-installation-and-thread-locking-tips-explained/",
});

export const QUAD_HEAT_SHRINK = material({
  id: "quad-receiver-heat-shrink",
  name: "Clear heat-shrink sleeve for the receiver, about 15 mm flat width",
  description: "Clear heat-shrink tubing, about 15 mm flat width, 25 mm long: sleeves the receiver after its wires are soldered, so its pads cannot touch the carbon plate.",
  spec: "clear polyolefin heat shrink, 2:1, flat width about 15 mm (fits the RP1's 10 x 10 mm board with its wires), cut to 25 mm",
  why: "The receiver is taped under the conductive carbon top plate; a clear sleeve insulates its pads and leaves its LED and bind button visible. A build choice.",
});

export const QUAD_MOUNT_TAPE = material({
  id: "quad-foam-mount-tape",
  name: "Double-sided foam mounting tape, 1 mm",
  description: "Double-sided foam tape, about 1 mm thick: holds the sleeved receiver under the top plate (10 x 10 mm piece) and the capacitor on the air unit (10 x 16 mm piece).",
  spec: "1 mm closed-cell acrylic foam tape, cut to 10 x 10 mm and 10 x 16 mm",
  why: "Neither the receiver nor the capacitor has a mount; foam tape holds them where the harness routes put them and damps vibration on their solder joints. A build choice.",
});

export const QUAD_CABLE_TIES = material({
  id: "quad-cable-ties",
  name: "Cable ties, 2.5 mm x 100 mm",
  description: "Small nylon cable ties, 2.5 x 100 mm: the receiver's T antenna to a rear standoff, the air unit's antenna lead and the XT60 lead to the frame (about 6 per build).",
  spec: "nylon 6.6 cable ties, 2.5 mm wide, 100 mm long",
  why: "Antennas and the battery lead must stay clear of the propellers; the frame has no clips for them. A build choice.",
});

export const MATERIALS: ModuleDef[] = [QUAD_SOLDER, QUAD_FLUX, QUAD_THREADLOCKER, QUAD_HEAT_SHRINK, QUAD_MOUNT_TAPE, QUAD_CABLE_TIES];
