// Pure viewport math for the virtualized hex view.
//
// Browsers have hard limits on how tall a single element can be:
//   Safari   ~16M px
//   Firefox  ~17.9M px
//   Chrome   ~33M px
// A 16 MiB cart at 16 bytes/row × 20px/row is ~20.97M px. That blows up
// layout in Firefox/Safari (paint freezes, the tab appears hung) and is
// uncomfortably close to Chrome's limit too.
//
// The fix: cap physical scroll height at MAX_PHYSICAL_PX. When the natural
// height exceeds the cap, we scale: each physical scroll pixel maps to
// `scale` virtual pixels. Rows are absolute-positioned, so we don't pay
// for huge spacer divs.

// Cap container height at 500K px. The previous 14M-px cap kept scrollbar
// resolution row-precise for huge files but the giant sizer itself causes
// memory-pressured systems (small GPUs, lots of tabs) to outright crash
// the renderer process when the HEX tab first lays out a 16 MiB cart.
// 500K px is well below any browser's per-element limit and lays out
// instantly. Scrollbar resolution on a 16 MiB cart drops to ~33 bytes per
// scrollbar pixel — coarser than before, but row-precision is recovered
// via PgUp/PgDn + Home/End keys and the GOTO box.
const MAX_PHYSICAL_PX = 2_000_000;

// Compute the physical container height and virtual→physical scale.
export function virtualGeometry(totalRows, rowHeight) {
  const naturalPx = Math.max(0, totalRows * rowHeight);
  if (naturalPx <= MAX_PHYSICAL_PX) {
    return { physicalPx: naturalPx, scale: 1 };
  }
  return { physicalPx: MAX_PHYSICAL_PX, scale: naturalPx / MAX_PHYSICAL_PX };
}

// Translate a physical scrollTop (px in the container) to a virtual y
// coordinate (px in the full unscaled space).
export function physicalToVirtual(scrollTop, scale) {
  return scrollTop * scale;
}

// Translate a virtual y coordinate back to a physical scrollTop.
export function virtualToPhysical(virtualY, scale) {
  return virtualY / scale;
}

// Pick the visible row range and the physical top position to anchor the
// first rendered row at. Returns { start, end, topPx }.
//
// topPx is the px offset (inside the scroll container's coordinate space)
// where row `start` should be placed via absolute positioning.
//
// When scale === 1 we align rows exactly to their virtual positions
// (start * rowHeight). When scale > 1 we anchor the first visible row to
// the current viewport top minus its sub-row remainder, so scrolling
// remains smooth even though row N+1 is no longer exactly rowHeight px
// below row N in physical space.
export function visibleRange({ scrollTop, viewportHeight, rowHeight, totalRows, overscan, scale }) {
  if (totalRows === 0) {
    return { start: 0, end: 0, topPx: 0 };
  }
  const s = scale ?? 1;
  const virtualScrollTop = scrollTop * s;
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const rawStart = Math.floor(virtualScrollTop / rowHeight) - overscan;
  const start = Math.max(0, rawStart);
  const end = Math.min(totalRows, start + visibleCount);

  let topPx;
  if (s === 1) {
    topPx = start * rowHeight;
  } else {
    // Physical anchor: align the first row to the top of the viewport,
    // minus the fractional row that has already scrolled off.
    const remainder = virtualScrollTop - start * rowHeight;
    topPx = scrollTop - remainder / s;
  }
  return { start, end, topPx };
}
