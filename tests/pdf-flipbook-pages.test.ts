import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
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

test("releasing a PDF book settles its retired references without affecting another book", async () => {
  const first = createPdfFlipbookPageUrls("C:/books/first.pdf", 2);
  const second = createPdfFlipbookPageUrls("C:/books/second.pdf", 2);
  assert.notEqual(first[0], second[0]);
  releasePdfFlipbookPageUrls(first);
  await assert.rejects(
    loadPdfFlipbookPageBitmap("harbor-pdf-page:999999/1"),
    /no longer available/,
  );
  releasePdfFlipbookPageUrls(second);
  const h = mockedPages(async () => ({ width: 800, height: 1100 }));
  const a = h.api.createPdfFlipbookPageUrls("first.pdf", 1);
  const b = h.api.createPdfFlipbookPageUrls("second.pdf", 1);
  h.api.releasePdfFlipbookPageUrls(a);
  assert.deepEqual(await h.api.loadPdfFlipbookPageBitmap(a[0]), { width: 1, height: 1 });
  assert.deepEqual(await h.api.loadPdfFlipbookPageBitmap(b[0]), { width: 800, height: 1100 });
  h.api.releasePdfFlipbookPageUrls(b);
});

test("invalid PDF page counts are rejected before any source is registered", () => {
  for (const count of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createPdfFlipbookPageUrls("C:/books/test.pdf", count), /no pages/);
  }
});

function mockedPages(
  render: (path: string, page: number, signal: AbortSignal) => Promise<unknown>,
) {
  const src = readFileSync(
    new URL("../src/lib/ebook/pdf-flipbook-pages.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const warnings: unknown[] = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: "",
      font: "",
      fillRect() {},
      fillText() {},
    }),
  };
  class ImageDataStub {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
  }
  new Function(
    "require",
    "module",
    "exports",
    "ImageData",
    "createImageBitmap",
    "document",
    "console",
    compiled,
  )(
    (name: string) => {
      assert.equal(name, "./pdf");
      return { pdfFlipbookPageBitmap: render };
    },
    module,
    module.exports,
    ImageDataStub,
    async (input: { width: number; height: number }) => ({
      width: input.width,
      height: input.height,
    }),
    { createElement: () => canvas },
    { warn: (...args: unknown[]) => warnings.push(args) },
  );
  return { api: module.exports as typeof import("../src/lib/ebook/pdf-flipbook-pages"), warnings };
}

test("a pending retired PDF texture settles silently when its render is aborted", async () => {
  const h = mockedPages(
    (_path, _page, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      }),
  );
  const pages = h.api.createPdfFlipbookPageUrls("a.pdf", 4);
  const pending = h.api.loadPdfFlipbookPageBitmap(pages[1]);
  h.api.releasePdfFlipbookPageUrls(pages);
  assert.deepEqual(await pending, { width: 1, height: 1 });
  assert.deepEqual(await h.api.loadPdfFlipbookPageBitmap(pages[2]), { width: 1, height: 1 });
  assert.equal(h.warnings.length, 0);
});

test("late successful texture is closed when its source has been retired", async () => {
  let resolve!: (value: unknown) => void;
  let closed = 0;
  const h = mockedPages(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pages = h.api.createPdfFlipbookPageUrls("a.pdf", 1);
  const pending = h.api.loadPdfFlipbookPageBitmap(pages[0]);
  h.api.releasePdfFlipbookPageUrls(pages);
  resolve({ close: () => closed++ });
  assert.deepEqual(await pending, { width: 1, height: 1 });
  assert.equal(closed, 1);
});

test("a real active PDF render failure still produces a visible error page", async () => {
  const h = mockedPages(async () => {
    throw new Error("damaged page");
  });
  const pages = h.api.createPdfFlipbookPageUrls("bad.pdf", 1);
  assert.deepEqual(await h.api.loadPdfFlipbookPageBitmap(pages[0]), { width: 800, height: 1100 });
  assert.equal(h.warnings.length, 1);
  await assert.rejects(
    h.api.loadPdfFlipbookPageBitmap("harbor-pdf-page:9999/1"),
    /no longer available/,
  );
  h.api.releasePdfFlipbookPageUrls(pages);
});
