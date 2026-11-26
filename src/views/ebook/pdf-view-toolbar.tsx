import type { Dispatch, SetStateAction } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { fitPdfView, zoomPdfView, type PdfViewSettings } from "@/lib/ebook/pdf-view-settings";

export function PdfViewToolbar({
  view,
  onViewChange,
  visible = true,
}: {
  view: PdfViewSettings;
  onViewChange: Dispatch<SetStateAction<PdfViewSettings>>;
  visible?: boolean;
}) {
  const { fit, zoom } = view;
  return (
    <div
      data-pdf-reader-controls
      inert={!visible}
      className={`flex flex-wrap items-center justify-center gap-2 rounded-full bg-black/70 px-3 py-2 text-xs text-white shadow-lg backdrop-blur transition-opacity duration-300 ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
    >
      <button
        type="button"
        aria-label="Fit PDF page"
        aria-pressed={fit === "page"}
        onClick={() => onViewChange(fitPdfView("page"))}
        className={`rounded-full px-3 py-1.5 ${fit === "page" ? "bg-white/25" : "hover:bg-white/15"}`}
      >
        Fit page
      </button>
      <button
        type="button"
        aria-label="Fit PDF width"
        aria-pressed={fit === "width"}
        onClick={() => onViewChange(fitPdfView("width"))}
        className={`rounded-full px-3 py-1.5 ${fit === "width" ? "bg-white/25" : "hover:bg-white/15"}`}
      >
        Fit width
      </button>
      <span className="mx-1 h-4 w-px bg-white/25" aria-hidden="true" />
      <button
        type="button"
        aria-label="Zoom out PDF"
        disabled={zoom <= 0.5}
        onClick={() => onViewChange((value) => zoomPdfView(value, -0.15))}
        className="rounded-full p-1.5 hover:bg-white/15 disabled:opacity-40"
      >
        <ZoomOut size={16} />
      </button>
      <button
        type="button"
        aria-label="Reset PDF zoom"
        onClick={() => onViewChange((value) => ({ ...value, zoom: 1 }))}
        className="min-w-12 rounded-full px-2 py-1.5 hover:bg-white/15"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label="Zoom in PDF"
        disabled={zoom >= 3}
        onClick={() => onViewChange((value) => zoomPdfView(value, 0.15))}
        className="rounded-full p-1.5 hover:bg-white/15 disabled:opacity-40"
      >
        <ZoomIn size={16} />
      </button>
    </div>
  );
}
