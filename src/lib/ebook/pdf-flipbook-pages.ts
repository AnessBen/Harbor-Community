import { pdfFlipbookPageBitmap } from "./pdf";

/** Opaque page URLs are resolved by the flipbook texture loader, never fetched over the network. */
const PREFIX = "harbor-pdf-page:";
const sources = new Map<number, { path: string; controller: AbortController }>();
let sourceSequence = 0;

function parse(url: string): { sourceId: number; pageNumber: number } | null {
  const match = /^harbor-pdf-page:(\d+)\/(\d+)$/.exec(url);
  if (!match) return null;
  return { sourceId: Number(match[1]), pageNumber: Number(match[2]) };
}

export function isPdfFlipbookPageUrl(url: string): boolean {
  return url.startsWith(PREFIX);
}

export function createPdfFlipbookPageUrls(path: string, count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("This PDF has no pages.");
  const id = ++sourceSequence;
  sources.set(id, { path, controller: new AbortController() });
  return Array.from({ length: count }, (_, index) => `${PREFIX}${id}/${index + 1}`);
}

export function releasePdfFlipbookPageUrls(urls: readonly string[]): void {
  const first = parse(urls[0] ?? "");
  if (!first) return;
  const source = sources.get(first.sourceId);
  if (!source) return;
  sources.delete(first.sourceId);
  source.controller.abort();
}

// The vendor schedules texture continuations even after a flipbook is disposed.
// Retired sources must settle those promises rather than reject into the app.
function retiredPageBitmap(): Promise<ImageBitmap> {
  return createImageBitmap(new ImageData(1, 1));
}

export async function loadPdfFlipbookPageBitmap(url: string): Promise<ImageBitmap> {
  const request = parse(url);
  const source = request && sources.get(request.sourceId);
  if (!request || request.sourceId < 1 || request.sourceId > sourceSequence) {
    throw new Error("This PDF book page is no longer available.");
  }
  if (!source) return retiredPageBitmap();
  const { signal } = source.controller;
  try {
    const bitmap = await pdfFlipbookPageBitmap(source.path, request.pageNumber, signal);
    if (!signal.aborted) return bitmap;
    bitmap.close();
    return retiredPageBitmap();
  } catch (error) {
    if (signal.aborted) return retiredPageBitmap();
    // One damaged PDF page must not strand the entire 3D reader in a loading state.
    console.warn("[ebook/pdf-flipbook-page]", error);
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 1100;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw error;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#a11";
    ctx.font = "24px sans-serif";
    ctx.fillText(`Unable to render PDF page ${request.pageNumber}`, 40, 80);
    try {
      return await createImageBitmap(canvas);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
