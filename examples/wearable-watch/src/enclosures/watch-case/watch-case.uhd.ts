/**
 * The watch case (PB-829) as a UHD module of the features it must provide:
 * the display window, the heart-rate window, the USB-C opening, two button
 * plungers, the strap lugs and the back-cover joint. Its geometry is
 * generated from these interfaces and from what the assembly puts inside it
 * by the cad capability (@protoboardai/ext-enclosure-cad, cad.config.ts next
 * to this file): nothing here names a CAD tool.
 *
 * Case frame: +Z points out of the back cover (towards the wrist). The base
 * is the front: the floor carries the display window (the lens sits in a
 * pocket flush with the face), the walls the USB-C opening, the plungers and
 * the lugs. The lid is the back cover, held by four M2 screws into heat-set
 * inserts, with the heart-rate window over the MAX30102.
 *
 * Sources: the served parts' frames (the board's standard geometry manifest:
 * USB-C mouth, switch stems, heart-rate apertures; the display part's
 * viewing face), the provider's cited standard parts (ruthex RX-M2x4, Accu
 * SPP-M2-6-A2, Esslinger 82.2225, the USB Type-C plug), and the brief's
 * size targets (docs/brief.md). Values chosen here carry an assumption.
 */
import { withGeometry, type ModuleDef } from "@deltarobotics/uhd";
import { CASE_ARTIFACTS, CASE_GEOMETRY } from "./watch-case.bind.js";
import { Button, ESSLINGER_82_2225, Joint, M2X6_PAN, Opening, RUTHEX_RX_M2X4, StrapLugs, USB_C_PLUG, Window } from "@protoboardai/ext-enclosure-cad/lib/index.ts";

const WATCH_CASE_FEATURES: ModuleDef = {
  id: "watch-case",
  name: "Watch case",
  version: "0.1.0",
  description: "Round printed watch case, 22 mm lugs: front (base) with the display lens pocket, USB-C opening and two button plungers; back cover (lid) with the heart-rate window, held by four M2 screws into heat-set inserts.",
  categories: ["mechanical.enclosure"],
  tags: ["enclosure", "case", "wearable", "printed"],
  display: { icon: "box" },
  interfaces: [
    Window({
      id: "display_window",
      name: "Display window and lens",
      serves: { child: "board", interfaceId: "display_face" },
      aperture: { diameterMm: 33.6 },
      cover: { diameterMm: 38.0, thicknessMm: 0.5, material: "PMMA" },
      side: "outside",
      assumption: "Aperture: the 33.4 mm visual area (ER-TFT1.28-1 §2.2) + 0.1 mm a side. Lens: a 38 mm x 0.5 mm clear PMMA disc over the polarizer, as the display datasheet asks (§7.2, a protective plate); size and material are this project's choice, not yet sourced (OQ-W11).",
    }),
    Window({
      id: "hr_window",
      name: "Heart-rate window",
      serves: { child: "board", interfaceId: "hr_sensor" },
      aperture: { widthMm: 2.4, heightMm: 6.6 },
      cover: { widthMm: 4.0, heightMm: 8.2, thicknessMm: 0.5, material: "PMMA" },
      side: "outside",
      assumption: "One aperture over both MAX30102 windows: centred on the photodetector window (1.97 x 2.75 mm, 0.822 mm off the package centre), 6.6 mm long so it also clears the LED window (1.97 x 1.094 mm, 1.64 mm the other way; MAX30102 outline 21-1048). Clear PMMA cover, flush. The opaque barrier between the two apertures and the air gap to the sensor are open (OQ-W7).",
    }),
    Opening({
      id: "usb_opening",
      name: "USB-C opening",
      serves: { child: "board", interfaceId: "usb" },
      widthMm: 10.0,
      heightMm: 3.8,
      cornerRadiusMm: 1.6,
      maxRecessMm: 1.85,
      plug: USB_C_PLUG,
      // a flat seat for the plug's overmold on the round wall (D-W12): material out to the plane through the
      // opening's outermost point, so the plug bears on a flat face and the case gets no wider along the plug
      seat: "flat",
      assumption: "Receptacle shell 8.94 x 3.16 mm (GCT USB4105 drawing) plus about 0.3 mm a side, widened to 10.0 mm so the round wall leaves no sliver beside the receptacle's corners. The plug's overmold stays at least 1.85 mm in front of the receptacle face (the part's usage note), so the receptacle may sit at most 1.85 mm behind the outer surface.",
    }),
    Button({
      id: "button_1",
      name: "Button 1 plunger (wake / select)",
      serves: { child: "board", interfaceId: "btn_1" },
      holeDiameterMm: 2.0,
      travelMm: 0.2,
      gapMm: 0.1,
      flangeDiameterMm: 3.0,
      assumption: "Bore 2.0 mm (a 1.7 mm plunger shaft) pressing the 2 mm stem at its centre (Alps SKRT series: press the stem centre, ideally with a 2 mm flat tip; 0.2 mm travel); 0.1 mm rest gap. Flange 3.0 mm: the stem axis is 1.7 mm above the board and 1.86 mm below the back cover, so a larger flange would be cut away by both; it still overlaps the wall by 0.5 mm all round.",
    }),
    Button({
      id: "button_2",
      name: "Button 2 plunger (back)",
      serves: { child: "board", interfaceId: "btn_2" },
      holeDiameterMm: 2.0,
      travelMm: 0.2,
      gapMm: 0.1,
      flangeDiameterMm: 3.0,
      assumption: "As button 1.",
    }),
    StrapLugs({ id: "lugs_12", name: "Lugs at 12 o'clock", end: "+y", springBar: ESSLINGER_82_2225 }),
    StrapLugs({ id: "lugs_6", name: "Lugs at 6 o'clock", end: "-y", springBar: ESSLINGER_82_2225 }),
    Joint({ id: "back_joint", name: "Back cover joint (4 x M2)", screw: M2X6_PAN, insert: RUTHEX_RX_M2X4, count: 4 }),
  ],
  traits: [
    {
      type: "design_envelope",
      params: {
        max_mm: { length: 46, width: 62, height: 13.5 },
        reason: "Brief targets: round case body at most 46 mm across (x: the body and its screw columns) and 13.5 mm thick; y includes the strap lugs, which the brief excludes from the 46 mm, around the 22 mm strap.",
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "ingress",
        note: "Splash resistant only (brief): the back cover closes face to face on four screws with no gasket, the USB-C receptacle is open and the plunger bores have running clearance. No IP rating is claimed or tested.",
      },
    },
  ],
};

/** The case with its generated geometry bound (watch-case.bind.ts). */
export const WATCH_CASE: ModuleDef = withGeometry(WATCH_CASE_FEATURES, CASE_GEOMETRY, CASE_ARTIFACTS);
