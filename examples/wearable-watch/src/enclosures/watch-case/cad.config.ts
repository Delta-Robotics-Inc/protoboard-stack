import { defineCapabilityConfig } from "@protoboardai/core";

// The case through the cad capability (@protoboardai/ext-enclosure-cad, build123d).
export default defineCapabilityConfig({
  provider: "@protoboardai/ext-enclosure-cad",
  // the folder also declares the window covers it cuts (glazing.uhd.ts); this config designs the case
  module: "watch-case",
  process: "print",
  constraints: {
    shape: "round",
    // A fixed cavity, 0.5 mm towards the display's FPC tab (+x). The receptacle's flat 8.94 mm face
    // meets a round wall: its corners (20.02 mm out, y +-4.47) keep the 0.25 mm clearance when the
    // radius is 21.25 mm, and so do the display's FPC tail (20.37, 6.6), its tab corners (20.0, 7.0)
    // and the far edge of the 41 mm board. The mouth then sits 0.73 mm inside the cavity and, with a
    // 1.1 mm wall, 1.83 mm behind the outer surface (the plug allows 1.85). Auto-sizing centres the
    // cavity on the contents and grows it to 21.5 mm, which puts the receptacle 2.5 mm deep.
    // z: 0.25 mm in front of the display's viewing face to 0.25 mm above the tallest part (USB-C, 10.39).
    cavity_mm: { centre: [0.5, 0], radius: 21.26, z: [-0.25, 10.64] },
    // 1.1 mm walls (above the 0.8 mm minimum of two extrusions), for the USB-C's reach; a rabbet
    // would need 1.7 mm (2 x 0.8 + 0.1), so the back cover closes flat on its screws
    wall_mm: 1.1,
    // floor and lid 1.3 mm: each holds a 0.5 mm lens in a pocket, its edge on a ledge at least 0.8 mm wide
    // (two 0.4 mm extrusions); 1.3 + 10.89 + 1.3 = 13.49 mm against the brief's 13.5 mm
    floor_mm: 1.3,
    lid_mm: 1.3,
    clearance_mm: 0.25,
    clearance_top_mm: 0.25,
    material: "PETG",
    fasteners: "screws",
    joint: { style: "flat" },
  },
});
