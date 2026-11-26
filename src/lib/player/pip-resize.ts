import type { ResizeDir } from "@/lib/window";

export type PipBounds = { x: number; y: number; width: number; height: number };
export type PipSize = { width: number; height: number };

/** Physical pixel bounds; keep the opposite edge fixed even at minimum size. */
export function resizePipBounds(
  original: PipBounds,
  direction: ResizeDir,
  dx: number,
  dy: number,
  minimum: PipSize,
): PipBounds {
  const west = direction.includes("West");
  const east = direction.includes("East");
  const north = direction.includes("North");
  const south = direction.includes("South");
  const width = Math.max(minimum.width, original.width + (east ? dx : west ? -dx : 0));
  const height = Math.max(minimum.height, original.height + (south ? dy : north ? -dy : 0));
  return {
    x: original.x + (west ? original.width - width : 0),
    y: original.y + (north ? original.height - height : 0),
    width,
    height,
  };
}
