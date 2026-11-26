import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PDF_VIEW, fitPdfView, zoomPdfView } from "../src/lib/ebook/pdf-view-settings.ts";
import { readFileSync } from "node:fs";

test("PDF zoom changes retain the selected fit and clamp at the existing bounds", () => {
  const width = fitPdfView("width");
  assert.deepEqual(zoomPdfView(zoomPdfView(width, 0.15), 0.15), { fit: "width", zoom: 1.3 });
  assert.deepEqual(zoomPdfView(zoomPdfView(DEFAULT_PDF_VIEW, -0.15), -0.15), {
    fit: "page",
    zoom: 0.7,
  });
  assert.equal(zoomPdfView(width, -20).zoom, 0.5);
  assert.equal(zoomPdfView(width, 20).zoom, 3);
  assert.deepEqual(fitPdfView("page"), DEFAULT_PDF_VIEW);
});

test("PDF view state is owned by the book details session, not the keyed chapter reader", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const detail = read("../src/views/ebook.tsx").split("function EBookDetails(")[1];
  assert.match(detail, /useState<PdfViewSettings>\(DEFAULT_PDF_VIEW\)/);
  assert.match(
    detail,
    /<EBookReader[\s\S]*?key=\{reading.chapter.id\}[\s\S]*?pdfView=\{pdfView\}[\s\S]*?onPdfViewChange=\{setPdfView\}/,
  );
  const reader = read("../src/views/ebook/ebook-reader.tsx");
  assert.match(
    reader,
    /<HarborReader[\s\S]*?pdfView=\{pdfView\}[\s\S]*?onPdfViewChange=\{onPdfViewChange\}/,
  );
  const page = read("../src/views/ebook/harbor-reader.tsx");
  assert.match(page, /const \{ fit, zoom \} = view/);
  assert.match(
    page,
    /<PdfPageView[\s\S]*?view=\{pdfView\}[\s\S]*?onViewChange=\{onPdfViewChange\}/,
  );
  assert.doesNotMatch(page, /\[zoom, setZoom\] = useState/);
});
