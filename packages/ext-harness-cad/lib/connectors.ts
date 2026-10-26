/**
 * What the router needs to know about a harness end's termination: the
 * contact pitch (to place each conductor on its pin) and, for a plug, the
 * housing it draws. Values are the makers' nominal drawings:
 *
 *   JST SH (SHR-xxV-S, eSH.pdf): 1.0 mm pitch, housing 2.8 x 5.0 mm, width (n - 1) + 3 mm
 *   JST GH (GHR-xxV-S, eGH.pdf): 1.25 mm pitch, housing 4.15 x 5.7 mm, width 1.25 (n + 1) mm
 *   DJI 6-pin (O4 3-in-1 cable, FC "DJI" sockets): SH1.0 6-pin (Oscar Liang; DJI names no series)
 *   AMASS XT60 (XT60H-M, XT60PW): 16.4 x 9.2 mm face, 7.2 mm contact pitch, male 20.2 mm long,
 *     mated pair 32.3 mm, so 16.3 mm of the male stands beyond the female's face
 *
 * `visible` is how far the plug housing stands out of the socket's mating face.
 */
export interface Termination {
  kind: "plug" | "solder" | "integral";
  pitch?: number;
  housing?: { width: number; height: number; depth: number; visible: number; color: string; name: string };
}

const JST_NATURAL = "#ece8dc";

export function termination(connectorType: string, positions: number): Termination {
  const t = connectorType.toLowerCase();
  if (t === "solder_leads" || t === "solder_pad") return { kind: "solder" };
  if (t === "integral" || t === "integral_leads" || t === "radial_lead" || t === "bare_wire_lead") return { kind: "integral" };
  if (t.startsWith("jst_sh") || t.startsWith("dji_6pin") || t.startsWith("dji_3in1")) {
    return { kind: "plug", pitch: 1.0, housing: { width: (positions - 1) * 1.0 + 3.0, height: 2.8, depth: 5.0, visible: 3.2, color: JST_NATURAL, name: "JST SH-type plug" } };
  }
  if (t.startsWith("jst_gh")) {
    return { kind: "plug", pitch: 1.25, housing: { width: 1.25 * (positions + 1), height: 4.15, depth: 5.7, visible: 4.0, color: JST_NATURAL, name: "JST GH plug" } };
  }
  if (t.startsWith("xt60")) {
    return { kind: "plug", pitch: 7.2, housing: { width: 16.4, height: 9.2, depth: 20.2, visible: 16.3, color: "#e7b416", name: "XT60 male" } };
  }
  return { kind: "plug", pitch: 1.0, housing: { width: positions + 2, height: 3, depth: 5, visible: 3.5, color: "#2a2a2a", name: `${connectorType} plug` } };
}

/**
 * Outside diameter of silicone-insulated stranded wire by AWG (mm).
 * Representative values for the common "silicone wire" sold for FPV builds;
 * no maker in this project states insulation thickness.
 */
export const SILICONE_OD_MM: Record<number, number> = { 12: 3.4, 14: 2.8, 16: 2.3, 18: 2.0, 20: 1.7, 22: 1.5, 24: 1.3, 26: 1.1, 28: 0.95, 30: 0.8, 32: 0.7 };

/** Named colours for conductors (display, not a standard). */
export const WIRE_COLORS: Record<string, string> = {
  red: "#c8202a",
  black: "#1a1a1a",
  white: "#ececec",
  grey: "#8a8d91",
  gray: "#8a8d91",
  brown: "#6b3f1f",
  yellow: "#e8c11a",
  blue: "#2463c9",
  green: "#2f9a3e",
  orange: "#e36a14",
  tinned: "#c9ccd1",
};
