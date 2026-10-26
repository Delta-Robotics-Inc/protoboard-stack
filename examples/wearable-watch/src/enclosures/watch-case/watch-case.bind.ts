/**
 * The case's generated geometry, bound to its interfaces: the frames and
 * artifacts `protoboard run cad:extract --module watch-case` returned for the
 * last generate (re-bound by hand after each one, as the enclosure-cad skill
 * says; there is no rebind operation yet). `check` reports
 * ENCLOSURE_FRAME_MISMATCH when the generated design no longer matches these.
 */
import type { ArtifactDef, InterfaceGeometry } from "@deltarobotics/uhd";

export const CASE_GEOMETRY: Record<string, InterfaceGeometry> = {
  "back_joint": {
    "frame": {
      "origin": [
        0.5,
        0,
        10.64
      ],
      "normal": [
        0,
        0,
        1
      ],
      "xAxis": [
        1,
        0,
        0
      ]
    },
    "refs": [
      {
        "kind": "feature",
        "artifact": "cad_step",
        "name": "back_joint",
        "signature": {
          "area_mm2": 252.262,
          "centroid": [
            0.953,
            0.0,
            10.64
          ],
          "normal": [
            0.0,
            0.0,
            1.0
          ]
        }
      }
    ]
  },
  "button_1": {
    "frame": {
      "origin": [
        -18.865,
        11.18,
        8.78
      ],
      "normal": [
        -0.866,
        0.5,
        0
      ],
      "xAxis": [
        -0.5,
        -0.866,
        0
      ]
    },
    "refs": [
      {
        "kind": "feature",
        "artifact": "cad_step",
        "name": "button_1",
        "signature": {
          "area_mm2": 6.915,
          "centroid": [
            -18.378,
            10.899,
            8.78
          ]
        }
      }
    ]
  },
  "button_2": {
    "frame": {
      "origin": [
        -18.865,
        -11.18,
        8.78
      ],
      "normal": [
        -0.866,
        -0.5,
        0
      ],
      "xAxis": [
        0.5,
        -0.866,
        0
      ]
    },
    "refs": [
      {
        "kind": "feature",
        "artifact": "cad_step",
        "name": "button_2",
        "signature": {
          "area_mm2": 6.915,
          "centroid": [
            -18.378,
            -10.899,
            8.78
          ]
        }
      }
    ]
  },
  "display_window": {
    "frame": {
      "origin": [
        0,
        0,
        -1.55
      ],
      "normal": [
        0,
        0,
        -1
      ],
      "xAxis": [
        1,
        0,
        0
      ]
    },
    "refs": [
      {
        "kind": "feature",
        "artifact": "cad_step",
        "name": "display_window",
        "signature": {
          "area_mm2": 319.406,
          "centroid": [
            0.0,
            0.0,
            -1.097
          ]
        }
      }
    ]
  },
  "hr_window": {
    "frame": {
      "origin": [
        3,
        4.822,
        11.94
      ],
      "normal": [
        0,
        0,
        1
      ],
      "xAxis": [
        1,
        0,
        0
      ]
    },
    "refs": [
      {
        "kind": "feature",
        "artifact": "cad_step",
        "name": "hr_window",
        "signature": {
          "area_mm2": 32.04,
          "centroid": [
            3.0,
            4.822,
            11.538
          ]
        }
      }
    ]
  },
  "lugs_12": {
    "frame": {
      "origin": [
        0.5,
        25.11,
        0.45
      ],
      "normal": [
        0,
        1,
        0
      ],
      "xAxis": [
        1,
        0,
        0
      ]
    },
    "refs": [
      {
        "kind": "feature",
        "artifact": "cad_step",
        "name": "lugs_12",
        "signature": {
          "area_mm2": 12.881,
          "centroid": [
            0.5,
            25.11,
            0.45
          ]
        }
      }
    ]
  },
  "lugs_6": {
    "frame": {
      "origin": [
        0.5,
        -25.11,
        0.45
      ],
      "normal": [
        0,
        -1,
        0
      ],
      "xAxis": [
        1,
        0,
        0
      ]
    },
    "refs": [
      {
        "kind": "feature",
        "artifact": "cad_step",
        "name": "lugs_6",
        "signature": {
          "area_mm2": 12.881,
          "centroid": [
            0.5,
            -25.11,
            0.45
          ]
        }
      }
    ]
  },
  "usb_opening": {
    "frame": {
      "origin": [
        -21.86,
        0,
        8.81
      ],
      "normal": [
        -1,
        0,
        0
      ],
      "xAxis": [
        0,
        -1,
        0
      ]
    },
    "refs": [
      {
        "kind": "feature",
        "artifact": "cad_step",
        "name": "usb_opening",
        "signature": {
          "area_mm2": 39.794,
          "centroid": [
            -21.031,
            0.0,
            9.085
          ]
        }
      }
    ]
  }
};

export const CASE_ARTIFACTS: ArtifactDef[] = [
  {
    "id": "cad_source",
    "name": "watch-case build123d design",
    "type": "cad",
    "role": "source",
    "format": "build123d",
    "filePath": "src/enclosures/watch-case/build123d"
  },
  {
    "id": "cad_step",
    "name": "watch-case body",
    "type": "cad",
    "role": "body",
    "format": "step",
    "units": "mm",
    "filePath": "src/enclosures/watch-case/out/body.step",
    "provenance": {
      "generatedFrom": "cad_source",
      "tool": "build123d",
      "toolVersion": "0.13.0",
      "sourceDigest": "4f9f7d29e55785413ce17ccfc0b184e40edb0d4f4ef17afadac28958a442fed7"
    }
  },
  {
    "id": "cad_glb",
    "name": "watch-case body (GLB)",
    "type": "cad",
    "role": "body",
    "format": "glb",
    "units": "mm",
    "filePath": "src/enclosures/watch-case/out/body.glb",
    "provenance": {
      "generatedFrom": "cad_step",
      "tool": "build123d",
      "toolVersion": "0.13.0",
      "sourceDigest": "4f9f7d29e55785413ce17ccfc0b184e40edb0d4f4ef17afadac28958a442fed7"
    }
  },
  {
    "id": "cad_manifest",
    "name": "watch-case geometry manifest",
    "type": "cad",
    "format": "json",
    "filePath": "src/enclosures/watch-case/out/body.manifest.json",
    "provenance": {
      "generatedFrom": "cad_step",
      "tool": "build123d",
      "toolVersion": "0.13.0",
      "sourceDigest": "4f9f7d29e55785413ce17ccfc0b184e40edb0d4f4ef17afadac28958a442fed7"
    }
  },
  {
    "id": "base_stl",
    "name": "base (STL, for printing)",
    "type": "cad",
    "role": "body",
    "format": "stl",
    "units": "mm",
    "filePath": "src/enclosures/watch-case/out/base.stl",
    "tags": [
      "manufacturing",
      "print"
    ],
    "provenance": {
      "generatedFrom": "cad_step",
      "tool": "build123d",
      "toolVersion": "0.13.0",
      "sourceDigest": "4f9f7d29e55785413ce17ccfc0b184e40edb0d4f4ef17afadac28958a442fed7"
    }
  },
  {
    "id": "base_3mf",
    "name": "base (3MF, for printing)",
    "type": "cad",
    "role": "body",
    "format": "3mf",
    "units": "mm",
    "filePath": "src/enclosures/watch-case/out/base.3mf",
    "tags": [
      "manufacturing",
      "print"
    ],
    "provenance": {
      "generatedFrom": "cad_step",
      "tool": "build123d",
      "toolVersion": "0.13.0",
      "sourceDigest": "4f9f7d29e55785413ce17ccfc0b184e40edb0d4f4ef17afadac28958a442fed7"
    }
  },
  {
    "id": "lid_stl",
    "name": "lid (STL, for printing)",
    "type": "cad",
    "role": "body",
    "format": "stl",
    "units": "mm",
    "filePath": "src/enclosures/watch-case/out/lid.stl",
    "tags": [
      "manufacturing",
      "print"
    ],
    "provenance": {
      "generatedFrom": "cad_step",
      "tool": "build123d",
      "toolVersion": "0.13.0",
      "sourceDigest": "4f9f7d29e55785413ce17ccfc0b184e40edb0d4f4ef17afadac28958a442fed7"
    }
  },
  {
    "id": "lid_3mf",
    "name": "lid (3MF, for printing)",
    "type": "cad",
    "role": "body",
    "format": "3mf",
    "units": "mm",
    "filePath": "src/enclosures/watch-case/out/lid.3mf",
    "tags": [
      "manufacturing",
      "print"
    ],
    "provenance": {
      "generatedFrom": "cad_step",
      "tool": "build123d",
      "toolVersion": "0.13.0",
      "sourceDigest": "4f9f7d29e55785413ce17ccfc0b184e40edb0d4f4ef17afadac28958a442fed7"
    }
  },
  {
    "id": "plunger_button_1_stl",
    "name": "plunger_button_1 (STL, for printing)",
    "type": "cad",
    "role": "body",
    "format": "stl",
    "units": "mm",
    "filePath": "src/enclosures/watch-case/out/plunger_button_1.stl",
    "tags": [
      "manufacturing",
      "print"
    ],
    "provenance": {
      "generatedFrom": "cad_step",
      "tool": "build123d",
      "toolVersion": "0.13.0",
      "sourceDigest": "4f9f7d29e55785413ce17ccfc0b184e40edb0d4f4ef17afadac28958a442fed7"
    }
  },
  {
    "id": "plunger_button_1_3mf",
    "name": "plunger_button_1 (3MF, for printing)",
    "type": "cad",
    "role": "body",
    "format": "3mf",
    "units": "mm",
    "filePath": "src/enclosures/watch-case/out/plunger_button_1.3mf",
    "tags": [
      "manufacturing",
      "print"
    ],
    "provenance": {
      "generatedFrom": "cad_step",
      "tool": "build123d",
      "toolVersion": "0.13.0",
      "sourceDigest": "4f9f7d29e55785413ce17ccfc0b184e40edb0d4f4ef17afadac28958a442fed7"
    }
  },
  {
    "id": "plunger_button_2_stl",
    "name": "plunger_button_2 (STL, for printing)",
    "type": "cad",
    "role": "body",
    "format": "stl",
    "units": "mm",
    "filePath": "src/enclosures/watch-case/out/plunger_button_2.stl",
    "tags": [
      "manufacturing",
      "print"
    ],
    "provenance": {
      "generatedFrom": "cad_step",
      "tool": "build123d",
      "toolVersion": "0.13.0",
      "sourceDigest": "4f9f7d29e55785413ce17ccfc0b184e40edb0d4f4ef17afadac28958a442fed7"
    }
  },
  {
    "id": "plunger_button_2_3mf",
    "name": "plunger_button_2 (3MF, for printing)",
    "type": "cad",
    "role": "body",
    "format": "3mf",
    "units": "mm",
    "filePath": "src/enclosures/watch-case/out/plunger_button_2.3mf",
    "tags": [
      "manufacturing",
      "print"
    ],
    "provenance": {
      "generatedFrom": "cad_step",
      "tool": "build123d",
      "toolVersion": "0.13.0",
      "sourceDigest": "4f9f7d29e55785413ce17ccfc0b184e40edb0d4f4ef17afadac28958a442fed7"
    }
  }
];
