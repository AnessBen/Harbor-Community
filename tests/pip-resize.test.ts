import assert from "node:assert/strict";
import test from "node:test";
import { resizePipBounds } from "../src/lib/player/pip-resize.ts";
import { readFileSync } from "node:fs";
import ts from "typescript";

const original = { x: 100, y: 200, width: 480, height: 320 };
const minimum = { width: 360, height: 240 };

test("PiP southeast resize keeps top-left anchored", () => {
  assert.deepEqual(resizePipBounds(original, "SouthEast", 80, 45, minimum), {
    x: 100,
    y: 200,
    width: 560,
    height: 365,
  });
});
test("PiP northwest resize keeps bottom-right anchored", () => {
  assert.deepEqual(resizePipBounds(original, "NorthWest", -80, -45, minimum), {
    x: 20,
    y: 155,
    width: 560,
    height: 365,
  });
});
test("PiP minimum dimensions preserve the opposite edges", () => {
  assert.deepEqual(resizePipBounds(original, "NorthWest", 400, 300, minimum), {
    x: 220,
    y: 280,
    width: 360,
    height: 240,
  });
  assert.deepEqual(resizePipBounds(original, "SouthEast", -400, -300, minimum), {
    x: 100,
    y: 200,
    width: 360,
    height: 240,
  });
});
test("PiP side resizing affects only the selected axis", () => {
  assert.deepEqual(resizePipBounds(original, "West", 60, 90, minimum), {
    x: 160,
    y: 200,
    width: 420,
    height: 320,
  });
  assert.deepEqual(resizePipBounds(original, "East", 60, 90, minimum), {
    x: 100,
    y: 200,
    width: 540,
    height: 320,
  });
  assert.deepEqual(resizePipBounds(original, "North", 60, -90, minimum), {
    x: 100,
    y: 110,
    width: 480,
    height: 410,
  });
  assert.deepEqual(resizePipBounds(original, "South", 60, 90, minimum), {
    x: 100,
    y: 200,
    width: 480,
    height: 410,
  });
});
test("PiP mixed corners keep their opposite corner fixed", () => {
  assert.deepEqual(resizePipBounds(original, "NorthEast", 80, -45, minimum), {
    x: 100,
    y: 155,
    width: 560,
    height: 365,
  });
  assert.deepEqual(resizePipBounds(original, "SouthWest", -80, 45, minimum), {
    x: 20,
    y: 200,
    width: 560,
    height: 365,
  });
});
test("detached PiP supports its own smaller minimum", () => {
  assert.deepEqual(
    resizePipBounds(original, "NorthWest", 1000, 1000, { width: 240, height: 135 }),
    {
      x: 340,
      y: 385,
      width: 240,
      height: 135,
    },
  );
});
test("both PiP surfaces share the resize handles and detached window has geometry permissions", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(read("../src/components/player/transport/pip-chrome.tsx"), /<PipResizeHandles\b/);
  assert.match(read("../src/views/video-pip.tsx"), /!fullscreen && <PipResizeHandles\b/);
  const cap = JSON.parse(read("../src-tauri/capabilities/video-pip.json"));
  assert.deepEqual(cap.windows, ["harbor-video-pip"]);
  for (const command of [
    "outer-position",
    "inner-size",
    "scale-factor",
    "set-size",
    "set-position",
  ]) {
    assert.ok(cap.permissions.includes("core:window:allow-" + command));
  }
  const css = read("../src/components/player/transport/pip-resize-handles.css");
  assert.match(css, /-webkit-app-region:\s*no-drag/);
  assert.match(css, /background-color:\s*rgba\(0, 0, 0, 0\.02\)/);
});

function resizeHarness() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  let capture = false;
  let connected = true;
  const target = {
    get isConnected() {
      return connected;
    },
    addEventListener(name: string, handler: (event: any) => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(handler);
    },
    removeEventListener(name: string, handler: (event: any) => void) {
      listeners.get(name)?.delete(handler);
    },
    setPointerCapture() {
      capture = true;
    },
    hasPointerCapture() {
      return capture;
    },
    releasePointerCapture() {
      capture = false;
    },
  };
  const frames = new Map<number, () => void>();
  let frameId = 0;
  const sizes: { width: number; height: number }[] = [];
  const positions: { x: number; y: number }[] = [];
  const win = {
    outerPosition: async () => ({ x: 100, y: 200 }),
    innerSize: async () => ({ width: 480, height: 320 }),
    scaleFactor: async () => 1,
    setSize: async ({ width, height }: { width: number; height: number }) => {
      sizes.push({ width, height });
    },
    setPosition: async ({ x, y }: { x: number; y: number }) => {
      positions.push({ x, y });
    },
  };
  const windowMock = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  const source = readFileSync(
    new URL("../src/components/player/transport/pip-resize-handles.tsx", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source + "\nexport { beginWindowsResize };", {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    "window",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    compiled,
  )(
    (name: string) => {
      if (name === "@tauri-apps/api/window")
        return {
          getCurrentWindow: () => win,
          PhysicalSize: class {
            width: number;
            height: number;
            constructor(width: number, height: number) {
              this.width = width;
              this.height = height;
            }
          },
          PhysicalPosition: class {
            x: number;
            y: number;
            constructor(x: number, y: number) {
              this.x = x;
              this.y = y;
            }
          },
        };
      if (name === "@/lib/player/pip-resize") return { resizePipBounds };
      if (name === "@/lib/platform") return { isWindowsDesktop: () => true };
      if (name === "react" || name === "react/jsx-runtime" || name.endsWith(".css")) return {};
      throw new Error("unexpected import " + name);
    },
    module,
    module.exports,
    windowMock,
    (callback: () => void) => {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    },
    (id: number) => frames.delete(id),
  );
  const begin = (
    module.exports as { beginWindowsResize: (e: any, d: string, min: typeof minimum) => () => void }
  ).beginWindowsResize;
  const tick = async () => {
    await Promise.resolve();
    await Promise.resolve();
    const batch = [...frames.values()];
    frames.clear();
    for (const frame of batch) frame();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  const fire = (name: string, x: number, y: number, buttons = 1) => {
    for (const handler of Array.from(listeners.get(name) ?? []))
      handler({ pointerId: 1, screenX: x, screenY: y, pointerType: "mouse", buttons });
  };
  return {
    start: (edge: string) =>
      begin({ currentTarget: target, pointerId: 1, screenX: 100, screenY: 100 }, edge, minimum),
    fire,
    tick,
    sizes,
    positions,
    capture: () => capture,
    unmount: () => {
      connected = false;
    },
  };
}

test("Windows PiP pointer capture applies coalesced geometry and final release", async () => {
  const h = resizeHarness();
  const stop = h.start("SouthEast");
  assert.equal(h.capture(), true);
  h.fire("pointermove", 120, 110);
  h.fire("pointermove", 180, 145);
  await h.tick();
  await h.tick();
  assert.deepEqual(h.sizes, [{ width: 560, height: 365 }]);
  h.fire("pointerup", 150, 125, 0);
  await h.tick();
  await h.tick();
  assert.deepEqual(h.sizes, [
    { width: 560, height: 365 },
    { width: 530, height: 345 },
  ]);
  assert.equal(h.capture(), false);
  h.fire("pointermove", 300, 300);
  await h.tick();
  assert.equal(h.sizes.length, 2);
  stop();
});

test("Windows PiP northwest drag anchors opposite edge, cancellation drops pending work", async () => {
  const h = resizeHarness();
  const stop = h.start("NorthWest");
  h.fire("pointermove", 20, 55);
  await h.tick();
  await h.tick();
  assert.deepEqual(h.sizes, [{ width: 560, height: 365 }]);
  assert.deepEqual(h.positions, [{ x: 20, y: 155 }]);
  h.fire("pointermove", 50, 75);
  h.fire("pointercancel", 50, 75, 0);
  await h.tick();
  assert.equal(h.sizes.length, 1);
  assert.equal(h.capture(), false);
  stop();
});

test("Windows PiP unmount cancels queued geometry writes", async () => {
  const h = resizeHarness();
  const stop = h.start("SouthEast");
  h.fire("pointermove", 180, 145);
  h.unmount();
  stop();
  await h.tick();
  assert.deepEqual(h.sizes, []);
  assert.equal(h.capture(), false);
});
