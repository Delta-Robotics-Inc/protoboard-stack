// @ts-nocheck
// The board's tscircuit entry (ours: circuit:generate wrote it once and never overwrites it).
// It renders the generated board (board.gen.tsx) unchanged except for one tscircuit property:
// - the two side-push switches sit at 240° and 300° near the edge, and @tscircuit/checks tests a
//   component against the outline by its axis-aligned bounding box, whose corner falls 0.19 mm
//   outside the disc although every pad, hole and the courtyard are inside it (0.8 mm and more);
// - the USB-C receptacle's face is on the board edge (GCT's recommended layout), so its body's
//   courtyard reaches 0.25 mm past it.
// They are allowed off-board for those tests only; circuit:check still checks every pad against
// the outline (CIRCUIT_OUTSIDE_OUTLINE). Nothing is moved or added.
import { Children, cloneElement, isValidElement } from "react"
import Generated from "./board.gen.tsx"

const AT_THE_EDGE = new Set(["sw1", "sw2", "j1"])

export default function Board() {
  const board = Generated()
  return cloneElement(
    board,
    {},
    Children.map(board.props.children, (c) => (isValidElement(c) && AT_THE_EDGE.has(c.props.name) ? cloneElement(c, { allowOffBoard: true }) : c)),
  )
}
