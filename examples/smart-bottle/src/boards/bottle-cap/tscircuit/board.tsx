// @ts-nocheck
// The board's tscircuit entry (ours: circuit:generate wrote it once and never overwrites it).
// It renders the generated board (board.gen.tsx) unchanged except for one tscircuit property:
// the USB4720 is a mid-mount receptacle whose body sits in the board's edge cut-out (GCT
// drawing USB4720 rev B), so j1 is allowed to extend past the outline. Nothing is moved or added.
import { Children, cloneElement, isValidElement } from "react"
import Generated from "./board.gen.tsx"

const OVER_THE_CUTOUT = new Set(["j1"])

export default function Board() {
  const board = Generated()
  return cloneElement(
    board,
    {},
    Children.map(board.props.children, (c) => (isValidElement(c) && OVER_THE_CUTOUT.has(c.props.name) ? cloneElement(c, { allowOffBoard: true }) : c)),
  )
}
