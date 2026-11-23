import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";

function moduleFrom(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", compiled)((id: string) => {
    if (id in dependencies) return dependencies[id];
    throw new Error("Unexpected dependency: " + id);
  }, exports);
  return exports;
}

function environment() {
  const dom = new JSDOM("<main id='app'></main>", {
    url: "http://localhost:1420/",
    pretendToBeVisual: true,
  });
  // React uses legacy input-event hooks when the test DOM is installed after imports.
  Object.assign(dom.window.HTMLElement.prototype, {
    attachEvent() {},
    detachEvent() {},
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = createRoot(document.getElementById("app")!);
  return {
    root,
    async dispose() {
      await React.act(async () => root.unmount());
      dom.window.close();
    },
  };
}

test("episode jumper follows active details view and never portals over playback", async () => {
  const env = environment();
  const view = { topKind: "meta", player: null as null | object };
  const revealed: number[] = [];
  const exports = moduleFrom("src/components/episode-jumper.tsx", {
    react: React,
    "react/jsx-runtime": jsx,
    "react-dom": { createPortal },
    "lucide-react": { Hash: () => null },
    "@/lib/episode-scroll": { scrollToDataEp: () => {} },
    "@/lib/i18n": { useT: () => (key: string) => key },
    "@/lib/view": { useView: () => view },
  });
  const Jumper = exports.EpisodeJumper as React.ComponentType<{
    scrollRef: React.RefObject<HTMLElement | null>;
    totalEpisodes: number;
    onReveal?: (n: number) => void;
  }>;
  const scrollRef = { current: document.createElement("section") };
  const render = async (totalEpisodes: number) => {
    await React.act(async () => {
      env.root.render(
        jsx.jsx(Jumper, {
          scrollRef,
          totalEpisodes,
          onReveal: (n: number) => revealed.push(n),
        }),
      );
    });
  };
  const button = () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Jump to episode"]');
  try {
    await render(25);
    assert.ok(button(), "jump shortcut is visible on a long active episode list");
    await React.act(async () => button()!.click());
    assert.ok(document.querySelector('input[type="number"]'), "popover opens normally");

    view.player = { url: "test" };
    await render(25);
    assert.equal(button(), null, "player hides the global portal immediately");
    assert.equal(document.querySelector('input[type="number"]'), null);

    view.player = null;
    view.topKind = "player";
    await render(25);
    assert.equal(button(), null, "player route hides the button");

    view.topKind = "settings";
    await render(25);
    assert.equal(button(), null, "settings should not inherit background details UI");

    view.topKind = "meta";
    await render(25);
    assert.ok(button(), "button reappears after returning to details");
    assert.equal(
      document.querySelector('input[type="number"]'),
      null,
      "popover stays closed after returning",
    );

    await render(11);
    assert.equal(button(), null, "short episode lists do not need the jumper");
    await render(12);
    assert.ok(button(), "12 episodes meet the existing visibility threshold");
    assert.deepEqual(revealed, []);
  } finally {
    await env.dispose();
  }
});

test("episode jump preference is user-controllable and off unmounts the jumper", async () => {
  const env = environment();
  const source = readFileSync("src/views/detail/series-episodes.tsx", "utf8");
  const defaults = readFileSync("src/lib/settings/defaults.ts", "utf8");
  const types = readFileSync("src/lib/settings/types.ts", "utf8");
  assert.match(source, /settings\.showEpisodeJumper !== false && \(/);
  assert.match(defaults, /showEpisodeJumper: true/);
  assert.match(types, /showEpisodeJumper: boolean/);

  let pref = true;
  const updated: Array<Record<string, unknown>> = [];
  const settings = {
    showWatchedButton: true,
    resumeDetailScroll: true,
    hideSpoilers: false,
    episodeCardScale: 1,
    showEpisodeJumper: pref,
  };
  const ToggleRow = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: boolean;
    onChange: (next: boolean) => void;
  }) =>
    jsx.jsx("button", {
      type: "button",
      role: "switch",
      "aria-label": label,
      "aria-checked": value,
      onClick: () => onChange(!value),
    });
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    jsx.jsx(React.Fragment, { children });
  const mod = moduleFrom("src/views/settings/library-panel/detail-tab.tsx", {
    react: React,
    "react/jsx-runtime": jsx,
    "@/lib/settings": {
      useSettings: () => ({
        settings,
        update: (patch: Record<string, unknown>) => {
          updated.push(patch);
          Object.assign(settings, patch);
        },
      }),
    },
    "@/lib/i18n": { useT: () => (key: string) => key },
    "../shared": { Section: passthrough, Segmented: () => null, ToggleRow },
    "../kit": {
      SettingGroup: passthrough,
      SettingRow: passthrough,
      Nested: passthrough,
      SettingsWorkbench: passthrough,
    },
    "../spoiler-preview": { SpoilerPreview: () => null },
    "../episode-card-previews": { EpisodeCardPreview: () => null },
    "./episode-scale-preview": { EpisodeScalePreview: () => null },
  });
  const DetailTab = mod.DetailTab as React.ComponentType;
  try {
    await React.act(async () => env.root.render(jsx.jsx(DetailTab, {})));
    const toggle = () =>
      document.querySelector<HTMLButtonElement>(
        '[role="switch"][aria-label="Show episode Jump button"]',
      );
    assert.ok(toggle(), "details settings expose the Jump visibility preference");
    assert.equal(toggle()!.getAttribute("aria-checked"), "true");
    await React.act(async () => toggle()!.click());
    assert.deepEqual(updated, [{ showEpisodeJumper: false }]);
    pref = false;
    await React.act(async () => env.root.render(jsx.jsx(DetailTab, {})));
    assert.equal(toggle()!.getAttribute("aria-checked"), "false");
  } finally {
    await env.dispose();
  }
});
