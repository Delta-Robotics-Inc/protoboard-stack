/** The layout screen's line icons (16 px grid, stroke in currentColor). Drawn here; no icon package. */
import type { ReactElement } from "react";

const P: Record<string, string> = {
  select: "M4 2.5 L12.5 9 L8.6 9.6 L10.8 13.6 L9.2 14.4 L7 10.4 L4.2 13 Z",
  route: "M2.5 13.5 L6 13.5 L10 4.5 L13.5 4.5 M13.5 4.5 m-1.4 0 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0",
  via: "M8 3 a5 5 0 1 0 0.01 0 Z M8 6 a2 2 0 1 0 0.01 0 Z",
  zone: "M2.5 2.5 H13.5 V13.5 H2.5 Z M2.5 9 L9 2.5 M2.5 13.5 L13.5 2.5 M7 13.5 L13.5 7",
  keepout: "M3 3 H13 V13 H3 Z M5.5 5.5 L10.5 10.5 M10.5 5.5 L5.5 10.5",
  text: "M3 3.5 H13 M8 3.5 V13 M6 13 H10",
  measure: "M2 11 L11 2 L14 5 L5 14 Z M5 8 L6.5 9.5 M7 6 L8.5 7.5 M9 4 L10.5 5.5",
  flip: "M8 2 V14 M6 4 L2.5 12 H6 Z M10 4 L13.5 12 H10 Z",
  layers: "M8 2.5 L14 5.5 L8 8.5 L2 5.5 Z M2 8.5 L8 11.5 L14 8.5 M2 11 L8 14 L14 11",
  camera: "M2.5 5 H5 L6.3 3.3 H9.7 L11 5 H13.5 V12.5 H2.5 Z M8 6.5 a2.3 2.3 0 1 0 0.01 0 Z",
  alert: "M8 2.5 L14 13 H2 Z M8 6.5 V9.5 M8 11.2 V11.4",
  fit: "M2.5 6 V2.5 H6 M10 2.5 H13.5 V6 M13.5 10 V13.5 H10 M6 13.5 H2.5 V10",
  board: "M2.5 3 H13.5 V13 H2.5 Z M5 6 H8 V8 M10 10 H11",
  system: "M3 3 H7 V7 H3 Z M9 9 H13 V13 H9 Z M7 5 H11 V9",
  file: "M4 2 H9.5 L12.5 5 V14 H4 Z M9.5 2 V5 H12.5",
  history: "M3 8 a5 5 0 1 0 1.5 -3.5 M3 2.5 V5 H5.5 M8 5 V8 L10 9.5",
  settings: "M8 5.5 a2.5 2.5 0 1 0 0.01 0 Z M8 1.8 V3.6 M8 12.4 V14.2 M1.8 8 H3.6 M12.4 8 H14.2 M3.6 3.6 L4.9 4.9 M11.1 11.1 L12.4 12.4 M3.6 12.4 L4.9 11.1 M11.1 4.9 L12.4 3.6",
  user: "M8 3 a2.6 2.6 0 1 0 0.01 0 Z M3 14 C3.5 10.5 12.5 10.5 13 14",
  sparkle: "M8 1.8 L9.3 6.7 L14.2 8 L9.3 9.3 L8 14.2 L6.7 9.3 L1.8 8 L6.7 6.7 Z",
  eye: "M1.5 8 C4 3.5 12 3.5 14.5 8 C12 12.5 4 12.5 1.5 8 Z M8 6.2 a1.8 1.8 0 1 0 0.01 0 Z",
  eyeOff: "M1.5 8 C4 3.5 12 3.5 14.5 8 C12 12.5 4 12.5 1.5 8 Z M2.5 13.5 L13.5 2.5",
  play: "M5.5 3.5 L12.5 8 L5.5 12.5 Z",
  undo: "M5 4 L2.5 6.5 L5 9 M2.5 6.5 H10 a3.5 3.5 0 0 1 0 7 H7",
  lock: "M4 7.5 H12 V14 H4 Z M5.8 7.5 V5.3 a2.2 2.2 0 0 1 4.4 0 V7.5",
  commit: "M1.5 8 H5.3 M10.7 8 H14.5 M8 5.3 a2.7 2.7 0 1 0 0.01 0 Z",
  list: "M5.5 4 H13.5 M5.5 8 H13.5 M5.5 12 H13.5 M2.5 4 H3 M2.5 8 H3 M2.5 12 H3",
  check: "M2.5 8.5 L6 12 L13.5 4.5",
  download: "M8 2.5 V10.5 M4.5 7 L8 10.5 L11.5 7 M2.5 13.5 H13.5",
  bom: "M2.5 3 H13.5 V13 H2.5 Z M2.5 6.5 H13.5 M2.5 10 H13.5 M6.5 3 V13",
  library: "M3 2.5 V13.5 M6 2.5 V13.5 M9 3 L12.5 13",
  redo: "M11 4 L13.5 6.5 L11 9 M13.5 6.5 H6 a3.5 3.5 0 0 0 0 7 H9",
  pause: "M5.5 3.5 V12.5 M10.5 3.5 V12.5",
  hand: "M5 8.5 V4 a1 1 0 0 1 2 0 V7.5 M7 7 V3 a1 1 0 0 1 2 0 V7 M9 7 V4 a1 1 0 0 1 2 0 V8.5 M11 6.5 a1 1 0 0 1 2 0 V10 a4 4 0 0 1 -4 4 H8 a4 4 0 0 1 -3.5 -2 L2.8 9.2 a1 1 0 0 1 1.7 -1 L5 9",
  close: "M4 4 L12 12 M12 4 L4 12",
  rotate: "M12.5 6 a5 5 0 1 0 0.5 3.5 M12.8 2.5 V6 H9.3",
  trash: "M3 4.5 H13 M6 4.5 V3 H10 V4.5 M4.5 4.5 L5.3 13.5 H10.7 L11.5 4.5",
  unlock: "M4 7.5 H12 V14 H4 Z M5.8 7.5 V5.3 a2.2 2.2 0 0 1 4.3 -0.6",
  save: "M3 2.5 H11 L13.5 5 V13.5 H2.5 V3 Z M5 2.5 V6 H10 V2.5 M5 13.5 V9.5 H11 V13.5",
  flag: "M3.5 14 V2.5 M3.5 3 H12 L10 6 L12 9 H3.5",
  stop: "M4 4 H12 V12 H4 Z",
  reroute: "M2.5 12.5 C5 12.5 5 3.5 8 3.5 C11 3.5 11 12.5 13.5 12.5 M11.5 10.5 L13.5 12.5 L11.5 14.5",
  why: "M5.5 6 a2.5 2.5 0 1 1 3.5 2.3 C8.3 8.6 8 9.2 8 10 M8 12.3 V12.5",
};

export function Icon({ name, size = 16, strokeWidth = 1.3 }: { name: keyof typeof P | string; size?: number; strokeWidth?: number }): ReactElement {
  const fill = name === "play" ? "currentColor" : "none";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill={fill} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? P.board} />
    </svg>
  );
}
