// Pure viewport math for the virtualized hex view.
// Given the scroll state, returns which row indices to render and the
// top/bottom spacer heights that keep the scrollbar honest.

export function visibleRange({ scrollTop, viewportHeight, rowHeight, totalRows, overscan }) {
  if (totalRows === 0) {
    return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  }
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const rawStart = Math.floor(scrollTop / rowHeight) - overscan;
  const start = Math.max(0, rawStart);
  const end = Math.min(totalRows, start + visibleCount + overscan * 2);
  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: (totalRows - end) * rowHeight
  };
}
