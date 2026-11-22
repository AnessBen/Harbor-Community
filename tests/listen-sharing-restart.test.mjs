import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import * as rooms from "../src/lib/listen-together/room.ts";
import * as session from "../src/lib/listen-together/session.ts";
import * as trackState from "../src/lib/listen-together/track-state.ts";

test("restarting Listen Along and re-enabling Discord sharing each advertise a fresh invite", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://example.test" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const settings = {
    discordRichPresence: true,
    discordMusicPresence: true,
    discordShowPartyJoin: true,
  };
  let url, controls;
  const translate = (key) => key;
  class Client {
    constructor(relay, self) {
      this.self = self;
      this.snapshot = { state: "disconnected", participants: [] };
    }
    listeners = new Set();
    getSnapshot() {
      return this.snapshot;
    }
    on(fn) {
      this.listeners.add(fn);
      fn({ kind: "snapshot", snapshot: this.snapshot });
      return () => this.listeners.delete(fn);
    }
    update(snapshot) {
      this.snapshot = snapshot;
      for (const fn of this.listeners) fn({ kind: "snapshot", snapshot });
    }
    setName() {}
    setProfile() {}
    leave() {
      this.update({ state: "disconnected", participants: [] });
    }
    join(room, mode) {
      this.update({
        state: "joined",
        room,
        hostClientId: this.self,
        participants: [],
        listenSessionId: mode?.listenMode === "host" ? crypto.randomUUID() : undefined,
        syncState: { mediaId: "track" },
      });
    }
  }
  const noop = () => () => {};
  const deps = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "@/components/lists/list-toast": { emitListenAlongToast() {} },
    "@tauri-apps/api/core": { isTauri: () => true },
    "@/lib/together/invite": {
      onListenInvite: noop,
      buildInviteUrl: (_relay, _room, _origin, id) => id,
    },
    "@/lib/together/relay-version": { HARBOR_PUBLIC_RELAY: "wss://example.test" },
    "@/lib/music/player": {
      subscribeMusic: noop,
      getMusicState: () => ({ current: { id: "track" }, phase: "playing" }),
    },
    "@/lib/discord/presence": {
      setListenInvite: (value) => {
        url = value;
      },
    },
    "@/lib/together/client": { TogetherClient: Client },
    "@/lib/together/provider": { useTogether: () => ({ displayName: "Alex" }) },
    "@/lib/together/use-self-identity": { useSelfIdentity: () => ({ avatar: null, color: null }) },
    "@/lib/settings": { useSettings: () => ({ settings }) },
    "@/lib/i18n": { useT: () => translate },
    "@/lib/view": { useView: () => ({ player: null }) },
    "./queue": {},
    "./room": rooms,
    "./track-state": trackState,
    "./session": session,
    "./use-listen-session": { useListenSession() {} },
  };
  const { outputText } = ts.transpileModule(
    readFileSync(new URL("../src/lib/listen-together/provider.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  const api = {};
  new Function("require", "exports", outputText)((name) => {
    assert.ok(name in deps, name);
    return deps[name];
  }, api);
  function Consumer() {
    controls = api.useListenTogether();
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  const render = () =>
    React.act(() =>
      root.render(
        React.createElement(api.ListenTogetherProvider, null, React.createElement(Consumer)),
      ),
    );
  try {
    await render();
    const first = url;
    assert.ok(first);
    await React.act(() => controls.leave());
    assert.equal(url, null);
    await React.act(() => controls.start());
    assert.ok(url);
    assert.notEqual(url, first);
    // Start a new automatic session, then toggle the setting mid-track.
    await React.act(() => controls.leave());
    settings.discordShowPartyJoin = false;
    await render();
    settings.discordShowPartyJoin = true;
    await render();
    const second = url;
    assert.ok(second);
    settings.discordShowPartyJoin = false;
    await render();
    assert.equal(url, null);
    settings.discordShowPartyJoin = true;
    await render();
    assert.ok(url);
    assert.notEqual(url, second);
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
  }
});
