export type PdfViewSettings = { fit: "page" | "width"; zoom: number };

export const DEFAULT_PDF_VIEW: PdfViewSettings = { fit: "page", zoom: 1 };

export function fitPdfView(fit: PdfViewSettings["fit"]): PdfViewSettings {
  return { fit, zoom: 1 };
}

export function zoomPdfView(view: PdfViewSettings, delta: number): PdfViewSettings {
  return { ...view, zoom: Math.max(0.5, Math.min(3, Math.round((view.zoom + delta) * 100) / 100)) };
}
