import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as icons from "lucide-react";
import { createRoot } from "react-dom/client";

const source = readFileSync("src/views/detail/overflow-sync-items.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;

type Status = "CURRENT" | "PLANNING" | "COMPLETED" | "PAUSED" | "DROPPED" | "REPEATING";

function harness(
  input: {
    connected?: boolean;
    resolvedId?: number | null;
    status?: Status | null;
    saveFails?: boolean;
    deleteFails?: boolean;
    fetchFails?: boolean;
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
  const resolved = input.resolvedId === undefined ? 21450 : input.resolvedId;
  const dependencies: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": jsx,
    "lucide-react": icons,
    "@/lib/i18n": { useT: () => (s: string) => s },
    "@/lib/anilist/provider": { useAnilist: () => ({ isConnected: connected }) },
    "@/lib/anilist/sync": {
      resolveAnilistMediaId: async (id: string) => {
        calls.push("resolve:" + id);
        return resolved;
      },
    },
    "@/lib/anilist/mutations": {
      fetchListEntry: async (id: number) => {
        calls.push("fetch:" + id);
        if (input.fetchFails) throw Error("network unavailable");
        return { entry: input.status == null ? null : { id: 900, status: input.status } };
      },
      saveListEntry: async ({ mediaId, status }: { mediaId: number; status: Status }) => {
        calls.push("save:" + mediaId + ":" + status);
        if (input.saveFails) throw Error("request rejected");
        return { id: 900, status };
      },
      deleteListEntry: async (id: number) => {
        calls.push("remove:" + id);
        return !input.deleteFails;
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
  const AnilistMenuItems = exports.AnilistMenuItems as React.ComponentType<{
    harborId: string;
    onAction: () => void;
  }>;
  assert.ok(AnilistMenuItems, "AniList overflow items are exported");
  const root = createRoot(document.getElementById("app")!);
  const find = (label: string): HTMLButtonElement | undefined =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      (item) => item.textContent?.trim() === label,
    );
  return {
    calls,
    find,
    async render() {
      await React.act(async () => {
        root.render(
          jsx.jsx(AnilistMenuItems, {
            harborId: "kitsu:11459",
            onAction: () => calls.push("close"),
          }),
        );
      });
    },
    async click(label: string) {
      const item = find(label);
      assert.ok(item, "Expected menu item: " + label);
      await React.act(async () => item.click());
    },
    async dispose() {
      await React.act(async () => root.unmount());
      dom.window.close();
    },
  };
}

test("AniList overflow menu is hidden for disconnected accounts", async () => {
  const h = harness({ connected: false });
  try {
    await h.render();
    assert.equal(h.find("Add to AniList"), undefined);
    assert.deepEqual(h.calls, []);
  } finally {
    await h.dispose();
  }
});

test("AniList overflow menu resolves the native season owner and displays its status", async () => {
  const h = harness({ status: "COMPLETED" });
  try {
    await h.render();
    assert.ok(h.find("AniList · Completed"));
    assert.deepEqual(h.calls, ["resolve:kitsu:11459", "fetch:21450"]);
    await h.click("AniList · Completed");
    assert.ok(h.find("Watching"));
    assert.ok(h.find("Remove from list"));
    assert.deepEqual(
      h.calls,
      ["resolve:kitsu:11459", "fetch:21450"],
      "opening a status submenu must never write to AniList",
    );
  } finally {
    await h.dispose();
  }
});

test("AniList overflow update confirms success before closing the menu", async () => {
  const h = harness({ status: "CURRENT" });
  try {
    await h.render();
    await h.click("AniList · Watching");
    await h.click("Completed");
    assert.deepEqual(h.calls.slice(-3), ["save:21450:COMPLETED", "notify", "close"]);
    assert.ok(h.find("AniList · Completed"));
  } finally {
    await h.dispose();
  }
});

test("AniList overflow add and removal confirm success before closing", async () => {
  const add = harness();
  try {
    await add.render();
    await add.click("Add to AniList");
    assert.deepEqual(add.calls.slice(-3), ["save:21450:PLANNING", "notify", "close"]);
  } finally {
    await add.dispose();
  }
  const remove = harness({ status: "PAUSED" });
  try {
    await remove.render();
    await remove.click("AniList · On Hold");
    await remove.click("Remove from list");
    assert.deepEqual(remove.calls.slice(-3), ["remove:900", "notify", "close"]);
  } finally {
    await remove.dispose();
  }
});

test("failed AniList mutations keep the menu open, restore status and explain failure", async () => {
  const h = harness({ status: "CURRENT", saveFails: true, deleteFails: true });
  try {
    await h.render();
    await h.click("AniList · Watching");
    await h.click("Completed");
    assert.ok(h.find("AniList · Watching"));
    assert.ok(document.querySelector('[role="alert"]')?.textContent?.includes("failed"));
    assert.equal(h.calls.includes("close"), false);
    assert.equal(h.calls.includes("notify"), false);
    await h.click("Remove from list");
    assert.ok(h.find("AniList · Watching"));
    assert.equal(h.calls.includes("close"), false);
  } finally {
    await h.dispose();
  }
});

test("failed lookup shows an explicit retry action rather than disappearing indefinitely", async () => {
  const h = harness({ fetchFails: true });
  try {
    await h.render();
    assert.ok(h.find("Unable to load AniList status. Retry."));
    assert.equal(h.find("Add to AniList"), undefined);
    assert.equal(h.calls.includes("close"), false);
  } finally {
    await h.dispose();
  }
});
