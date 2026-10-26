// @ts-nocheck
// The board's tscircuit entry (ours: circuit:generate wrote it once and never overwrites it).
// (From the wearable template, as in the wearable-watch reference project.) It renders the
// generated board (board.gen.tsx) unchanged except for one tscircuit property:
// - the USB-C receptacle's face is on the board edge (GCT's recommended layout), so its body's
//   courtyard reaches past it.
// It is allowed off-board for those tests only; circuit:check still checks every pad against
// the outline (CIRCUIT_OUTSIDE_OUTLINE). Nothing is moved or added.
import { Children, cloneElement, isValidElement } from "react"
import Generated from "./board.gen.tsx"

const AT_THE_EDGE = new Set(["j1"])

export default function Board() {
  const board = Generated()
  return cloneElement(
    board,
    {},
    Children.map(board.props.children, (c) => (isValidElement(c) && AT_THE_EDGE.has(c.props.name) ? cloneElement(c, { allowOffBoard: true }) : c)),
  )
}
