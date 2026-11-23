import assert from "node:assert/strict";
import test from "node:test";
import {
  createPdfFlipbookPageUrls,
  isPdfFlipbookPageUrl,
  loadPdfFlipbookPageBitmap,
  releasePdfFlipbookPageUrls,
} from "../src/lib/ebook/pdf-flipbook-pages";

test("PDF book page references represent the whole document without rendering it", () => {
  const urls = createPdfFlipbookPageUrls("C:/books/test.pdf", 4);
  assert.equal(urls.length, 4);
  const prefix = urls[0].replace(/\/1$/, "");
  assert.deepEqual(
    urls,
    [1, 2, 3, 4].map((n) => `${prefix}/${n}`),
  );
  assert.equal(isPdfFlipbookPageUrl(urls[0]), true);
  assert.equal(isPdfFlipbookPageUrl("https://example.com/page.jpg"), false);
  releasePdfFlipbookPageUrls(urls);
});

test("releasing a PDF book invalidates its page references without affecting another book", async () => {
  const first = createPdfFlipbookPageUrls("C:/books/first.pdf", 2);
  const second = createPdfFlipbookPageUrls("C:/books/second.pdf", 2);
  assert.notEqual(first[0], second[0]);
  releasePdfFlipbookPageUrls(first);
  await assert.rejects(loadPdfFlipbookPageBitmap(first[0]), /no longer available/);
  releasePdfFlipbookPageUrls(second);
  await assert.rejects(loadPdfFlipbookPageBitmap(second[1]), /no longer available/);
});

test("invalid PDF page counts are rejected before any source is registered", () => {
  for (const count of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createPdfFlipbookPageUrls("C:/books/test.pdf", count), /no pages/);
  }
});
