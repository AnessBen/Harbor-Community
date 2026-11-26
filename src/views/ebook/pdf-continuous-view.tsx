import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  type Dispatch,
  type SetStateAction,
  type Ref,
  type CSSProperties,
} from "react";
import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { pdfPageContent, pdfPageCount, type PdfPageData } from "@/lib/ebook/pdf";
import { zoomPdfView, type PdfViewSettings } from "@/lib/ebook/pdf-view-settings";
import {
  anchorPdfScroll,
  pdfPageAtOffset,
  pdfScrollLayout,
  pdfVisibleRange,
} from "@/lib/ebook/pdf-scroll-layout";
import { PdfViewToolbar } from "./pdf-view-toolbar";

export type PdfScrollApi = { goToPage: (page: number) => void };

function ScrollPage({
  path,
  page,
  seed,
  width,
  height,
  onAspect,
}: {
  path: string;
  page: number;
  seed?: PdfPageData;
  width: number;
  height: number;
  onAspect: (page: number, aspect: number) => void;
}) {
  const t = useT();
  const [data, setData] = useState<PdfPageData | undefined>(seed);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (seed) return;
    const controller = new AbortController();
    setError("");
    void pdfPageContent(path, page, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        onAspect(page, result.width / result.height);
        setData(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "Unable to render PDF page");
      });
    return () => controller.abort();
  }, [path, page, seed, attempt, onAspect]);
  return (
    <div
      data-pdf-scroll-page={page}
      data-pdf-page-ready={Boolean(data)}
      className="relative shrink-0 bg-white text-black shadow-xl"
      style={{ width, height }}
    >
      {data ? (
        <>
          <img
            src={data.image}
            alt={t("Page {page}", { page })}
            draggable={false}
            className="block h-full w-full"
          />
          {data.textLayer && (
            <div
              className="pdf-text-layer"
              style={{ "--scale-factor": width / data.width } as CSSProperties}
              dangerouslySetInnerHTML={{ __html: data.textLayer }}
            />
          )}
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-sm text-black/60">
          {error ? (
            <>
              <p>{error}</p>
              <button
                type="button"
                className="rounded-lg border border-black/20 px-3 py-2"
                onClick={() => retry((x) => x + 1)}
              >
                {t("Retry")}
              </button>
            </>
          ) : (
            <Loader2 size={20} className="animate-spin motion-reduce:animate-none" />
          )}
          <span>{t("Page {page}", { page })}</span>
        </div>
      )}
    </div>
  );
}

export function PdfContinuousView({
  path,
  initialPage,
  initialData,
  knownCount,
  view,
  onViewChange,
  onPageChange,
  apiRef,
}: {
  path: string;
  initialPage: number;
  initialData: PdfPageData;
  knownCount: number;
  view: PdfViewSettings;
  onViewChange: Dispatch<SetStateAction<PdfViewSettings>>;
  onPageChange: (page: number, count: number) => void;
  apiRef: Ref<PdfScrollApi>;
}) {
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(Math.max(initialPage, knownCount));
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [top, setTop] = useState(0);
  const topRef = useRef(0);
  const updateTop = (value: number) => {
    topRef.current = value;
    setTop(value);
  };
  const [aspects, setAspects] = useState(
    () => new Map([[initialPage, initialData.width / initialData.height]]),
  );
  const [countError, setCountError] = useState("");
  const [countAttempt, retryCount] = useState(0);
  const previousLayout = useRef<ReturnType<typeof pdfScrollLayout> | null>(null);
  const lastReported = useRef("");
  const callback = useRef(onPageChange);
  callback.current = onPageChange;
  const seed = useRef(initialData);
  const onAspect = useMemo(
    () => (page: number, aspect: number) => {
      if (!Number.isFinite(aspect) || aspect <= 0) return;
      setAspects((old) => {
        if (old.get(page) === aspect) return old;
        const next = new Map(old);
        next.set(page, aspect);
        return next;
      });
    },
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    setCountError("");
    void pdfPageCount(path, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setCount(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setCountError(error instanceof Error ? error.message : "Unable to open PDF");
      });
    return () => controller.abort();
  }, [path, countAttempt]);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = () =>
      setSize((old) => {
        const width = Math.max(1, Math.min(1120, node.clientWidth - 32));
        const height = Math.max(1, node.clientHeight);
        return old.width === width && old.height === height ? old : { width, height };
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(
    () =>
      pdfScrollLayout(
        count,
        size.width,
        size.height,
        view,
        seed.current.width / seed.current.height,
        aspects,
      ),
    [count, size, view, aspects],
  );
  // Anchor the currently read page when its geometry, the viewport or zoom changes.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const old = previousLayout.current;
    const nextTop = old
      ? anchorPdfScroll(old, layout, topRef.current)
      : (layout.pages[Math.min(count, initialPage) - 1]?.top ?? 0);
    previousLayout.current = layout;
    node.scrollTop = nextTop;
    updateTop(node.scrollTop);
    // This effect intentionally runs only on layout changes; scrolling itself never repositions the reader.
  }, [layout, initialPage, count]);
  const [first, last] = pdfVisibleRange(layout, top);
  const active = pdfPageAtOffset(layout, top + 1);
  useEffect(() => {
    if (!previousLayout.current) return;
    const page = pdfPageAtOffset(layout, (root.current?.scrollTop ?? top) + 1);
    const key = page + "/" + count;
    if (lastReported.current === key) return;
    lastReported.current = key;
    callback.current(page, count);
  }, [active, count, layout, top]);
  useImperativeHandle(
    apiRef,
    () => ({
      goToPage(page) {
        const node = root.current;
        const target = layout.pages[Math.max(0, Math.min(count - 1, page - 1))];
        if (node && target) {
          node.scrollTop = target.top;
          updateTop(node.scrollTop);
        }
      },
    }),
    [layout, count],
  );
  useEffect(() => {
    const listener = (event: WheelEvent) => {
      if (
        (!event.ctrlKey && !event.altKey) ||
        !(event.target instanceof Node) ||
        !host.current?.contains(event.target)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onViewChange((old) => zoomPdfView(old, event.deltaY < 0 ? 0.1 : -0.1));
    };
    window.addEventListener("wheel", listener, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", listener, { capture: true });
  }, [onViewChange]);
  return (
    <div ref={host} className="absolute inset-x-0 top-16 bottom-20 flex flex-col overflow-hidden">
      <div className="z-10 flex shrink-0 justify-center p-2">
        <PdfViewToolbar view={view} onViewChange={onViewChange} />
      </div>
      {countError && (
        <div role="alert" className="px-4 pb-2 text-center text-sm text-red-400">
          {countError}{" "}
          <button type="button" onClick={() => retryCount((n) => n + 1)}>
            {t("Retry")}
          </button>
        </div>
      )}
      <div
        ref={root}
        data-pdf-continuous-scroll
        data-current-page={active}
        tabIndex={0}
        aria-label={t("Continuous scrolling")}
        className="min-h-0 flex-1 overflow-auto overscroll-contain outline-none [overflow-anchor:none]"
        onScroll={(event) => updateTop(event.currentTarget.scrollTop)}
      >
        <div
          className="relative mx-auto"
          style={{
            height: layout.height,
            width: layout.pages.reduce(
              (max, page) => Math.max(max, page.width + 32),
              size.width + 32,
            ),
            minWidth: "100%",
          }}
        >
          {layout.pages.slice(first - 1, last).map((item, i) => {
            const page = first + i;
            return (
              <div
                key={page}
                className="absolute inset-x-0 flex justify-center"
                style={{ top: item.top }}
              >
                <ScrollPage
                  path={path}
                  page={page}
                  width={item.width}
                  height={item.height}
                  seed={page === initialPage ? seed.current : undefined}
                  onAspect={onAspect}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
