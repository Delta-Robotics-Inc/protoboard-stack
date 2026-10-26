/**
 * The Library view's model: shared with `protoboard dev`'s library and the
 * views (@protoboardai/views/parts-data).
 */
export * from "@protoboardai/views/parts-data";

/** What Project Parts says before it has a list (B12): no project that is set up yet. */
export function projectPartsWaiting(): string {
  return "The parts are listed once a project is open and set up.";
}
