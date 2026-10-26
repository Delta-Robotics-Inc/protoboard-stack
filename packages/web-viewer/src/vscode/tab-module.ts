/** No React and no VS Code API here: the extension's tests import this file too. */

/**
 * The module a tab is on, for its name, its title and its source file: the
 * level the viewer shows, or, for a tab opened on a part with nothing inside
 * (which has no level of its own, so the viewer shows the level that holds
 * it), that part. A tab is never named after the parent of what it was
 * opened on.
 */
export function tabModule(drill: readonly string[], startPath: string, levelLabel: string, nodes: readonly { id: string; label: string }[]): { path: string; label: string; part: boolean } {
  const level = drill.join("/");
  const start = startPath ? startPath.split("/") : [];
  const below = start.length > drill.length && drill.every((d, i) => start[i] === d);
  if (!below) return { path: level, label: levelLabel, part: false };
  const local = start.slice(drill.length).join("/");
  const node = nodes.find((n) => n.id === local);
  return { path: startPath, label: node?.label ?? start[start.length - 1], part: true };
}
