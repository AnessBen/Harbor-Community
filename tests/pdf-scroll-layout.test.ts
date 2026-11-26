import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorPdfScroll,
  pdfPageAtOffset,
  pdfScrollLayout,
  pdfVisibleRange,
} from "../src/lib/ebook/pdf-scroll-layout.ts";

const width = { fit: "width", zoom: 1 } as const;
test("continuous PDF layout handles portrait, landscape and last-page alignment", () => {
  const layout = pdfScrollLayout(3, 800, 1000, width, 0.8, new Map([[2, 2]]));
  assert.deepEqual(layout.pages, [
    { top: 0, width: 800, height: 1000 },
    { top: 1024, width: 800, height: 400 },
    { top: 1448, width: 800, height: 1000 },
  ]);
  assert.equal(pdfPageAtOffset(layout, 1023), 1);
  assert.equal(pdfPageAtOffset(layout, 1024), 2);
  assert.equal(pdfPageAtOffset(layout, 1448), 3);
  const shortLast = pdfScrollLayout(2, 800, 1000, width, 2, new Map());
  assert.equal(shortLast.height - 1000, shortLast.pages[1].top);
});
test("Fit Page bounds each page to the viewport and supports zoom", () => {
  const layout = pdfScrollLayout(2, 800, 1000, { fit: "page", zoom: 1 }, 0.5, new Map([[2, 2]]));
  assert.deepEqual(layout.pages[0], { top: 0, width: 488, height: 976 });
  assert.deepEqual(layout.pages[1], { top: 1000, width: 800, height: 400 });
  const zoomed = pdfScrollLayout(2, 800, 1000, { fit: "page", zoom: 2 }, 0.5, new Map([[2, 2]]));
  assert.equal(zoomed.pages[0].height, 1952);
});
test("virtual window bounds rasterized pages even for a large PDF", () => {
  const layout = pdfScrollLayout(10000, 800, 1000, width, 0.8, new Map());
  const [first, last] = pdfVisibleRange(layout, layout.pages[4999].top);
  assert.ok(first <= 5000 && last >= 5000);
  assert.ok(last - first + 1 <= 5);
  assert.equal(pdfVisibleRange(layout, 0)[0], 1);
  assert.equal(pdfVisibleRange(layout, layout.height - 1000)[1], 10000);
});
test("zoom and measured page geometry keep the same fractional scroll anchor", () => {
  const old = pdfScrollLayout(100, 800, 1000, width, 0.8, new Map());
  const next = pdfScrollLayout(
    100,
    800,
    1000,
    { fit: "width", zoom: 1.5 },
    0.8,
    new Map([
      [1, 2],
      [50, 2],
    ]),
  );
  const top = old.pages[49].top + old.pages[49].height * 0.4;
  const anchored = anchorPdfScroll(old, next, top);
  assert.equal(pdfPageAtOffset(next, anchored), 50);
  assert.equal(anchored, next.pages[49].top + next.pages[49].height * 0.4);
});
