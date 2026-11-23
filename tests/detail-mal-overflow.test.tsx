// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as icons from "lucide-react";
import { createRoot } from "react-dom/client";

const source = readFileSync(
  new URL("../src/views/detail/overflow-sync-items.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;

type Status = "watching" | "plan_to_watch" | "completed" | "on_hold" | "dropped";

function harness(
  input: {
    connected?: boolean;
    resolvedId?: number | null;
    status?: Status | null;
    saveFails?: boolean;
    removeFails?: boolean;
  } = {},
) {
  const dom = new JSDOM("<body><div id='app'></div>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const calls: string[] = [];
  const connected = input.connected ?? true;
  const resolvedId = input.resolvedId === undefined ? 12345 : input.resolvedId;
  const dependencies: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsx,
    "lucide-react": icons,
    "@/lib/i18n": { useT: () => (key: string) => key },
    "@/lib/mal/provider": { useMal: () => ({ isConnected: connected }) },
    "@/lib/mal/mutations": {
      resolveMalMediaId: async (id: string) => {
        calls.push("resolve:" + id);
        return resolvedId;
      },
      fetchListEntry: async (id: number) => {
        calls.push("fetch:" + id);
        return {
          entry: input.status == null ? null : { status: input.status, numEpisodesWatched: 0 },
        };
      },
      saveListEntry: async ({ malId, status }: { malId: number; status: Status }) => {
        calls.push("save:" + malId + ":" + status);
        if (input.saveFails) throw Error("MAL update rejected");
        return { status, numEpisodesWatched: 0 };
      },
      deleteListEntry: async (id: number) => {
        calls.push("remove:" + id);
        return !input.removeFails;
      },
    },
    "@/lib/tracker-status-events": {
      useTrackerStatusVersion: () => 0,
      notifyTrackerStatusChanged: () => calls.push("notify"),
    },
  };
  const exports: Record<string, any> = {};
  new Function("require", "module", "exports", compiled)(
    (id: string) => {
      if (id.includes("/assets/")) return "test-logo";
      return dependencies[id] ?? {};
    },
    { exports },
    exports,
  );
  const MalMenuItems = exports.MalMenuItems as React.ComponentType<{
    harborId: string;
    onAction: () => void;
  }>;
  assert.ok(MalMenuItems, "MAL overflow item is exported");
  const root = createRoot(document.getElementById("app")!);
  const find = (label: string): HTMLButtonElement | undefined =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) =>
      item.textContent?.includes(label),
    );
  return {
    calls,
    find,
    async render() {
      await React.act(async () => {
        root.render(
          jsx.jsx(MalMenuItems, {
            harborId: "anilist:789",
            onAction: () => calls.push("close"),
          }),
        );
      });
    },
    async click(label: string) {
      const button = find(label);
      assert.ok(button, label + " menu item should be visible");
      await React.act(async () => {
        button.click();
      });
    },
    async dispose() {
      await React.act(async () => root.unmount());
      dom.window.close();
    },
  };
}

test("detail overflow preserves the MAL tracker action in compact layouts", () => {
  const detail = readFileSync(new URL("../src/views/detail.tsx", import.meta.url), "utf8");
  const overflow = readFileSync(
    new URL("../src/views/detail/hero-action-overflow.tsx", import.meta.url),
    "utf8",
  );
  assert.match(detail, /actionStage < 2 && animeIdentity && animeTrackerId/);
  assert.match(
    detail,
    /mal=\{animeIdentity && animeTrackerId \? \{ harborId: animeTrackerId \} : null\}/,
  );
  assert.match(overflow, /\{showSync && \(/);
  assert.match(overflow, /\{mal && \(\s*<MalMenuItems/);
});

test("disconnected MAL accounts do not show an overflow action", async () => {
  const h = harness({ connected: false });
  try {
    await h.render();
    assert.equal(h.find("Add to MAL"), undefined);
    assert.deepEqual(h.calls, []);
  } finally {
    await h.dispose();
  }
});

test("an unresolved MAL ID does not offer an unsafe add action", async () => {
  const h = harness({ resolvedId: null });
  try {
    await h.render();
    assert.equal(h.find("Add to MAL"), undefined);
    assert.ok(h.calls.includes("resolve:anilist:789"));
    assert.ok(!h.calls.some((call) => call.startsWith("save:")));
  } finally {
    await h.dispose();
  }
});

test("compact MAL action adds a title to Plan to Watch and closes after success", async () => {
  const h = harness();
  try {
    await h.render();
    assert.ok(h.find("Add to MAL"));
    await h.click("Add to MAL");
    assert.deepEqual(h.calls.slice(-3), ["save:12345:plan_to_watch", "notify", "close"]);
  } finally {
    await h.dispose();
  }
});

test("compact MAL action supports changing status and removing an entry", async () => {
  const h = harness({ status: "watching" });
  try {
    await h.render();
    assert.ok(h.find("MAL"));
    await h.click("MAL");
    assert.ok(h.find("Completed"));
    assert.ok(h.find("Remove from list"));
    await h.click("Completed");
    assert.deepEqual(h.calls.slice(-3), ["save:12345:completed", "notify", "close"]);
  } finally {
    await h.dispose();
  }
  const removal = harness({ status: "on_hold" });
  try {
    await removal.render();
    await removal.click("MAL");
    await removal.click("Remove from list");
    assert.deepEqual(removal.calls.slice(-3), ["remove:12345", "notify", "close"]);
  } finally {
    await removal.dispose();
  }
});

test("failed MAL writes keep the compact menu open for retry", async () => {
  const h = harness({ status: "watching", saveFails: true, removeFails: true });
  try {
    await h.render();
    await h.click("MAL");
    await h.click("Completed");
    assert.ok(h.find("MAL"));
    assert.ok(!h.calls.includes("close"));
    assert.ok(!h.calls.includes("notify"));
    await h.click("Remove from list");
    assert.ok(h.find("MAL"));
    assert.ok(!h.calls.includes("close"));
  } finally {
    await h.dispose();
  }
});
