import type { PdfViewSettings } from "./pdf-view-settings";

export type PdfScrollPage = { top: number; width: number; height: number };
export type PdfScrollLayout = { pages: PdfScrollPage[]; height: number; viewportHeight: number };
const GAP = 24;

export function pdfScrollLayout(
  count: number,
  width: number,
  height: number,
  view: PdfViewSettings,
  estimate: number,
  aspects: ReadonlyMap<number, number>,
): PdfScrollLayout {
  const pages: PdfScrollPage[] = [];
  let top = 0;
  for (let i = 1; i <= count; i++) {
    const aspect = aspects.get(i) ?? estimate;
    const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.75;
    const base = view.fit === "width" ? width : Math.min(width, Math.max(1, height - 24) * ratio);
    const pageWidth = Math.max(1, Math.round(base * view.zoom));
    const pageHeight = Math.max(1, Math.round(pageWidth / ratio));
    pages.push({ top, width: pageWidth, height: pageHeight });
    top += pageHeight + GAP;
  }
  const last = pages.at(-1);
  return {
    pages,
    height: last ? last.top + Math.max(last.height, height) : 0,
    viewportHeight: height,
  };
}

/** Page number containing a vertical offset, including the following gap. */
export function pdfPageAtOffset(layout: PdfScrollLayout, offset: number): number {
  let low = 0,
    high = layout.pages.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (layout.pages[mid].top <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

export function pdfVisibleRange(layout: PdfScrollLayout, top: number): [number, number] {
  return [
    pdfPageAtOffset(layout, Math.max(0, top - layout.viewportHeight)),
    pdfPageAtOffset(layout, top + layout.viewportHeight * 2),
  ];
}

/** Preserve the same page and fractional position when zoom or measured page sizes change. */
export function anchorPdfScroll(
  previous: PdfScrollLayout,
  next: PdfScrollLayout,
  top: number,
): number {
  const index = pdfPageAtOffset(previous, top) - 1;
  const oldPage = previous.pages[index],
    newPage = next.pages[index];
  if (!oldPage || !newPage) return 0;
  const offset = top - oldPage.top;
  return (
    newPage.top +
    (offset <= oldPage.height
      ? Math.max(0, offset / oldPage.height) * newPage.height
      : newPage.height + offset - oldPage.height)
  );
}
