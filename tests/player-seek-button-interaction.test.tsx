import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import * as seekStep from "../src/lib/seek-step.ts";

test("seek buttons handle pointer, keyboard and accessibility activation exactly once", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://fixture.invalid" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({ matches: true }),
  });
  const source = readFileSync(
    new URL("../src/components/player/transport/seek-step-btn.tsx", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const deps: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "lucide-react": { ChevronDown: () => null },
    "@/lib/i18n": { useT: () => (key: string) => key },
    "@/lib/settings": { useSettings: () => ({ settings: {}, update() {} }) },
    "@/lib/seek-step": seekStep,
    "./tooltip": { Tooltip: ({ children }: { children: React.ReactNode }) => children },
  };
  const output: Record<string, any> = {};
  new Function("require", "exports", compiled)((name: string) => {
    assert.ok(name in deps, name);
    return deps[name];
  }, output);
  const root = createRoot(document.getElementById("root")!);
  const deltas: number[] = [];
  try {
    await React.act(async () => {
      root.render(
        <>
          <output.SeekStepBtn direction="back" seconds={10} onSeekStep={(d: number) => deltas.push(d)} />
          <output.SeekStepBtn direction="forward" seconds={10} onSeekStep={(d: number) => deltas.push(d)} />
        </>,
      );
    });
    const [back, forward] = document.querySelectorAll("button");
    const dispatch = (el: Element, type: string, detail = 0) =>
      el.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, button: 0, detail }));
    await React.act(async () => {
      back.click();
      forward.click();
      dispatch(forward, "pointerdown");
      dispatch(forward, "pointerup");
      dispatch(forward, "click", 1);
      dispatch(back, "pointerdown");
      dispatch(back, "pointercancel");
      dispatch(back, "pointerup");
      dispatch(back, "click", 1);
    });
    assert.deepEqual(deltas, [-10, 10, 10]);
    await React.act(async () => {
      dispatch(back, "pointerdown");
      await new Promise((resolve) => setTimeout(resolve, 410));
    });
    await React.act(async () => {
      dispatch(back, "pointerup");
      dispatch(back, "click", 1);
    });
    assert.deepEqual(deltas, [-10, 10, 10], "long press must not seek");
    assert.match(document.body.textContent ?? "", /All times/);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
  }
});
