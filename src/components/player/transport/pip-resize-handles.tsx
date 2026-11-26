import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { isWindowsDesktop } from "@/lib/platform";
import type { ResizeDir } from "@/lib/window";
import { resizePipBounds, type PipBounds, type PipSize } from "@/lib/player/pip-resize";
import "./pip-resize-handles.css";

const EDGES: ResizeDir[] = [
  "North",
  "South",
  "East",
  "West",
  "NorthEast",
  "NorthWest",
  "SouthEast",
  "SouthWest",
];

/** Windows' native resize drag can return successfully without resizing the
 * undecorated PiP host. Capture the pointer and apply geometry directly there;
 * keep the compositor-provided drag on macOS/Linux. */
function beginWindowsResize(
  event: ReactPointerEvent<HTMLDivElement>,
  edge: ResizeDir,
  minimum: PipSize,
): () => void {
  const target = event.currentTarget;
  const id = event.pointerId;
  const startX = event.screenX,
    startY = event.screenY;
  const pixelRatio = window.devicePixelRatio || 1;
  const win = getCurrentWindow();
  let start: PipBounds | undefined;
  let min: PipSize;
  let pending: { x: number; y: number } | undefined;
  let cancelled = false,
    ended = false,
    busy = false;
  let frame: number | undefined;
  let previous: PipBounds | undefined;

  function detach() {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", cancel);
    target.removeEventListener("lostpointercapture", lost);
    window.removeEventListener("blur", cancel);
    if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
  }
  function cancel() {
    cancelled = true;
    pending = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    detach();
  }
  function schedule() {
    if (cancelled || busy || !start || !pending || frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      void flush();
    });
  }
  async function flush() {
    if (cancelled || !target.isConnected || busy || !start || !pending) return;
    const point = pending;
    pending = undefined;
    const next = resizePipBounds(
      start,
      edge,
      Math.round((point.x - startX) * pixelRatio),
      Math.round((point.y - startY) * pixelRatio),
      min,
    );
    const last = previous ?? start;
    if (
      next.width === last.width &&
      next.height === last.height &&
      next.x === last.x &&
      next.y === last.y
    )
      return;
    busy = true;
    try {
      if (next.width !== last.width || next.height !== last.height) {
        await win.setSize(new PhysicalSize(next.width, next.height));
      }
      if (!cancelled && target.isConnected && (next.x !== last.x || next.y !== last.y)) {
        await win.setPosition(new PhysicalPosition(next.x, next.y));
      }
      previous = next;
    } catch (error) {
      console.warn("[pip] resize failed", error);
      cancel();
    } finally {
      busy = false;
      schedule();
    }
  }
  function move(e: PointerEvent) {
    if (e.pointerId !== id || ended || cancelled) return;
    if (e.pointerType === "mouse" && !(e.buttons & 1)) {
      cancel();
      return;
    }
    pending = { x: e.screenX, y: e.screenY };
    schedule();
  }
  function up(e: PointerEvent) {
    if (e.pointerId !== id || ended || cancelled) return;
    pending = { x: e.screenX, y: e.screenY };
    ended = true;
    detach();
    schedule();
  }
  function lost(e: PointerEvent) {
    if (e.pointerId === id && !ended) cancel();
  }
  target.setPointerCapture(id);
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", cancel);
  target.addEventListener("lostpointercapture", lost);
  window.addEventListener("blur", cancel);
  void Promise.all([win.outerPosition(), win.innerSize(), win.scaleFactor()])
    .then(([position, size, scale]) => {
      if (cancelled) return;
      start = { x: position.x, y: position.y, width: size.width, height: size.height };
      min = { width: Math.ceil(minimum.width * scale), height: Math.ceil(minimum.height * scale) };
      schedule();
    })
    .catch((error) => {
      console.warn("[pip] resize geometry unavailable", error);
      cancel();
    });
  return cancel;
}

export function PipResizeHandles({ minimum }: { minimum: PipSize }) {
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);
  return (
    <div className="pip-resize-handles" aria-hidden="true">
      {EDGES.map((edge) => (
        <div
          key={edge}
          data-edge={edge}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.preventDefault();
            event.stopPropagation();
            cleanup.current?.();
            cleanup.current = undefined;
            if (isWindowsDesktop()) {
              cleanup.current = beginWindowsResize(event, edge, minimum);
            } else {
              void getCurrentWindow()
                .startResizeDragging(edge)
                .catch((error) => console.warn("[pip] resize failed", error));
            }
          }}
        />
      ))}
    </div>
  );
}
