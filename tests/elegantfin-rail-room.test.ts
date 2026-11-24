import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// ElegantFin's collapsed sidebar is a fixed rail that CSS alone puts on screen. A Theme Studio copy
// can be saved without the theme's script, so there is none here: only the page and the CSS.

function parse(path: string) {
  const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  return ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
}

function find<T extends ts.Node>(root: ts.Node, what: string, is: (n: ts.Node) => n is T): T {
  const visit = (node: ts.Node): T | undefined => (is(node) ? node : ts.forEachChild(node, visit));
  const hit = visit(root);
  assert.ok(hit, `${what} in ${root.getSourceFile().fileName}`);
  return hit;
}

function initializer(source: ts.SourceFile, name: string): ts.Expression {
  const declared = find(
    source,
    name,
    (node): node is ts.VariableDeclaration & { initializer: ts.Expression } =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      !!node.initializer,
  );
  return declared.initializer;
}

type State = Record<string, unknown>;

/** The value of a component's expression. Variables the state does not hold are worked out from it. */
function evaluate(expression: ts.Expression, state: State): unknown {
  const scope: State = { ...state };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) return visit(node.expression);
    if (ts.isIdentifier(node) && node.text !== "undefined" && !(node.text in scope)) {
      scope[node.text] = evaluate(initializer(expression.getSourceFile(), node.text), state);
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return new Function(...Object.keys(scope), `"use strict"; return (${expression.getText()});`)(
    ...Object.values(scope),
  );
}

/** The data-* and aria-* props of the element that carries `marker`. */
function marks(source: ts.SourceFile, marker: string, state: State) {
  const attributes = find(
    source,
    marker,
    (node): node is ts.JsxAttributes =>
      ts.isJsxAttributes(node) &&
      node.properties.some((prop) => ts.isJsxAttribute(prop) && prop.name.getText() === marker),
  );
  const props: State = {};
  for (const prop of attributes.properties) {
    if (!ts.isJsxAttribute(prop) || !/^(data|aria)-/.test(prop.name.getText())) continue;
    const value = prop.initializer;
    if (value) assert.ok(ts.isJsxExpression(value) && value.expression, prop.getText());
    props[prop.name.getText()] = value ? evaluate(value.expression!, state) : true;
  }
  return props;
}

const app = parse("src/App.tsx");
const sidebar = parse("src/chrome/sidebar.tsx");
const css = initializer(parse("src/lib/theme.ts"), "elegantFinCss");
assert.ok(ts.isNoSubstitutionTemplateLiteral(css));

const dom = new JSDOM(`<style>${css.text}</style>`);

/** Renders the shell the way App.tsx does in this state, and reads what the theme makes of it. */
function look(state: State) {
  const shown = find(
    app,
    "<Sidebar />",
    (node): node is ts.JsxSelfClosingElement =>
      ts.isJsxSelfClosingElement(node) && node.tagName.getText() === "Sidebar",
  ).parent;
  assert.ok(ts.isBinaryExpression(shown));
  const { document, getComputedStyle } = dom.window;
  document.body.innerHTML = renderToStaticMarkup(
    h(
      "div",
      marks(app, "data-harbor-shell", state),
      evaluate(shown.left, state) ? h("aside", marks(sidebar, "data-harbor-sidebar", state)) : null,
      h("header", null, h("div", { "data-harbor-topbar-content": "" })),
    ),
  );
  const rail = document.querySelector("aside");
  const value = (selector: string, name: string) =>
    getComputedStyle(document.querySelector(selector)!).getPropertyValue(name);
  return {
    rail: !!rail && getComputedStyle(rail).visibility === "visible",
    room: value("[data-harbor-shell]", "--ef-rail-space"),
    headerInset: value("[data-harbor-topbar-content]", "--ef-header-inset"),
  };
}

const COLLAPSED_ON_HOME: State = {
  topKind: "home",
  player: null,
  kid: null,
  baseLayout: "sidebar",
  settings: { sidebarCollapsed: true },
  chromeHidden: false,
  liveHasSources: true,
  installFeatures: { games: true },
  gamesNavigationOpen: false,
  editing: false,
};

const STATES: { name: string; change: State; rail: boolean; room: boolean }[] = [
  { name: "Home", change: {}, rail: true, room: true },
  { name: "Library", change: { topKind: "library" }, rail: true, room: true },
  { name: "a docked player", change: { player: { pipDocked: true } }, rail: true, room: true },
  {
    name: "a kid's profile, which always has the sidebar",
    change: { kid: {}, baseLayout: "topdock" },
    rail: true,
    room: true,
  },
  // Games hides the sidebar with CSS of its own, which is not in this page.
  { name: "Games", change: { topKind: "games" }, rail: true, room: false },
  {
    name: "the expanded sidebar",
    change: { settings: { sidebarCollapsed: false } },
    rail: false,
    room: false,
  },
  { name: "Big Picture or a trailer", change: { chromeHidden: true }, rail: false, room: false },
  { name: "Settings", change: { topKind: "settings" }, rail: false, room: false },
  { name: "the stream picker", change: { topKind: "picker" }, rail: false, room: false },
  { name: "Live with its own page", change: { topKind: "live" }, rail: false, room: false },
  { name: "the player", change: { player: {} }, rail: false, room: false },
  { name: "a layout without it", change: { baseLayout: "topdock" }, rail: false, room: false },
];

for (const { name, change, rail, room } of STATES) {
  const kept = room ? "keeps room for its rail" : "keeps no room for a rail";
  test(`ElegantFin without its script ${kept}: ${name}`, () => {
    assert.deepEqual(look({ ...COLLAPSED_ON_HOME, ...change }), {
      rail,
      room: room ? "var(--ef-rail-width)" : "0px",
      headerInset: room ? "calc(var(--ef-rail-width) + 1rem)" : "1rem",
    });
  });
}
