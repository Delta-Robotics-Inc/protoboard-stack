/**
 * Which of a viewer tab's view tabs fit its header (B8), from the widths the
 * shell measures: all with their titles, all as icons, or the first few as
 * icons and a More menu for the rest. No DOM here: the tests call it.
 */
export function fitTabs(full: number[], compact: number[], avail: number, activeIndex: number, more = 34, gap = 2): { compact: boolean; shown: number[] } {
  const total = (ws: number[]) => ws.reduce((a, w) => a + w, 0) + gap * Math.max(0, ws.length - 1);
  const all = full.map((_, i) => i);
  if (total(full) <= avail) return { compact: false, shown: all };
  if (total(compact) <= avail) return { compact: true, shown: all };
  const shown: number[] = [];
  let used = more;
  for (const i of all) {
    if (used + compact[i] + gap > avail) break;
    shown.push(i);
    used += compact[i] + gap;
  }
  // the active tab is always one of those shown: it takes the last place
  if (activeIndex >= 0 && !shown.includes(activeIndex)) {
    if (shown.length) shown.pop();
    shown.push(activeIndex);
    shown.sort((a, b) => a - b);
  }
  return { compact: true, shown };
}

