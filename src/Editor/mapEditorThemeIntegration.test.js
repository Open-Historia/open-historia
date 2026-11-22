import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACCENT, EDITOR_NAV, EDITOR_PANEL, EDITOR_CARD,
  panelSurface, inputStyle, navButton, pillButton, toolButton,
} from "./editorStyles.js";
import { uiThemeTokens } from "../runtime/uiTheme.js";

const source = (name) => readFileSync(new URL(name, import.meta.url), "utf8");

test("map editor chrome shares the Settings > General > Theme token family", () => {
  assert.match(EDITOR_NAV, /var\(--oh-ui-header,/);
  assert.match(EDITOR_PANEL, /var\(--oh-ui-surface,/);
  assert.match(EDITOR_CARD, /var\(--oh-ui-raised,/);
  assert.match(ACCENT, /var\(--oh-ui-accent,/);
  assert.equal(panelSurface.backgroundColor, EDITOR_PANEL);
  assert.match(panelSurface.border, /var\(--oh-ui-line,/);
  assert.match(panelSurface.color, /var\(--oh-ui-text,/);
  assert.match(inputStyle.backgroundColor, /var\(--oh-ui-raised,/);
  assert.match(inputStyle.border, /var\(--oh-ui-line,/);
  assert.match(inputStyle.color, /var\(--oh-ui-text,/);
  assert.match(navButton(true).background, /var\(--oh-ui-active,/);
  assert.match(pillButton(true).background, /var\(--oh-ui-active,/);
  assert.match(pillButton(false).background, /var\(--oh-ui-raised,/);
  assert.match(toolButton(true, false).background, /var\(--oh-ui-active,/);
  assert.match(toolButton(false, false).background, /var\(--oh-ui-raised,/);
});

test("Theme tokens cover all named presets and custom, and default remains an override-free legacy palette", () => {
  assert.deepEqual(uiThemeTokens({ preset: "default" }), {});
  const surfaces = new Set();
  for (const preset of ["midnight", "graphite", "forest", "oxblood", "sepia", "custom"]) {
    const theme = preset === "custom"
      ? { preset, custom: { background: "#171B22", surface: "#303A44", accent: "#F9D187" } }
      : { preset };
    const tokens = uiThemeTokens(theme);
    for (const key of ["--oh-ui-bg", "--oh-ui-surface", "--oh-ui-raised", "--oh-ui-header", "--oh-ui-active", "--oh-ui-accent", "--oh-ui-text", "--oh-ui-line"]) {
      assert.ok(tokens[key], `Missing theme token ${key} for ${preset}`);
    }
    surfaces.add(tokens["--oh-ui-surface"]);
  }
  assert.equal(surfaces.size, 6, "every preset, including custom, must have distinct panel colors");
});

test("Map Editor panels, Countries and aliases use the same reactive theme variables", () => {
  const map = source("./MapEditor.jsx");
  const sidebar = source("./EditorSidebar.jsx");
  const panel = source("./Panel.jsx");
  const countries = source("./PolitiesPanel.jsx");
  const aliases = source("./CountryAliases.jsx");
  assert.match(map, /background: "var\(--oh-ui-bg,/);
  assert.match(sidebar, /background: EDITOR_NAV/);
  assert.match(sidebar, /background: EDITOR_CARD/);
  assert.match(panel, /\.\.\.panelSurface/);
  assert.match(panel, /var\(--oh-ui-line,/);
  assert.match(countries, /var\(--oh-ui-active,/);
  assert.match(countries, /var\(--oh-ui-raised,/);
  assert.match(aliases, /background: EDITOR_CARD/);
  assert.match(aliases, /import \{[^}]*EDITOR_CARD[^}]*\} from "\.\/editorStyles\.js";/);
  assert.match(aliases, /\.\.\.inputStyle/);
  assert.doesNotMatch(aliases, /background: "var\(--oh-ui-surface,/,
    "the inline alias card must not be a brighter/different layer than its parent panel");
});

test("semantic colors remain tied to game data rather than user UI appearance", () => {
  const countries = source("./PolitiesPanel.jsx");
  const sidebar = source("./EditorSidebar.jsx");
  assert.match(countries, /colors\?\.\[row\.key\]/);
  assert.match(sidebar, /SAVE = \{/);
  assert.match(sidebar, /#ef4444/, "save error color stays a semantic warning");
});
