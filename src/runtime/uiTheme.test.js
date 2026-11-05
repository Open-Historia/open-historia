import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_UI_THEME,
  UI_THEME_PRESETS,
  UI_THEME_STORAGE_KEY,
  applyUiTheme,
  getUiTheme,
  installUiTheme,
  normalizeUiColor,
  normalizeUiTheme,
  resetUiTheme,
  selectUiTheme,
  setCustomUiThemeColor,
  subscribeUiTheme,
  uiContrastRatio,
  uiThemeColors,
  uiThemeTokens,
  validateUiPalette,
} from "./uiTheme.js";

test("exactly five built-in presets plus custom and readable color combinations", () => {
  assert.equal(UI_THEME_PRESETS.length, 5);
  assert.deepEqual(UI_THEME_PRESETS.map((preset) => preset.id), ["midnight", "graphite", "forest", "oxblood", "sepia"]);
  for (const preset of UI_THEME_PRESETS) {
    assert.equal(validateUiPalette(preset.colors), "", preset.name);
    assert.ok(uiContrastRatio(preset.colors.accent, preset.colors.surface) >= 4.5);
  }
  assert.equal(DEFAULT_UI_THEME, "default");
});
test("malformed stored preferences cannot inject CSS or unknown presets", () => {
  const bad = normalizeUiTheme({
    preset: "evil",
    custom: { background: "red; position:fixed", surface: "#ffffff", accent: "var(--x)" },
  });
  assert.equal(bad.preset, DEFAULT_UI_THEME);
  assert.deepEqual(bad.custom, UI_THEME_PRESETS[0].colors);
  assert.equal(normalizeUiTheme({ preset: "default" }).preset, "default");
  assert.equal(normalizeUiColor("#f08"), "#FF0088");
  assert.equal(normalizeUiColor("#ff8800"), "#FF8800");
  assert.equal(normalizeUiColor("red"), null);
});
test("theme preferences create only chrome variables, not gameplay semantic colors", () => {
  const tokens = uiThemeTokens(normalizeUiTheme({ preset: "forest" }));
  assert.equal(tokens["--oh-ui-bg"], "#121E19");
  assert.equal(tokens["--oh-ui-accent"], "#78C8A1");
  assert.ok(!Object.keys(tokens).some((key) => /party|relationship|diplomac|military|war|map-|hud-/i.test(key)));
  assert.equal(Object.keys(tokens).length, 24);
  assert.ok(tokens["--oh-ui-overlay"].startsWith("rgba("), "floating panels retain translucency");
  assert.deepEqual(uiThemeTokens(normalizeUiTheme({ preset: DEFAULT_UI_THEME })), {}, "original UI must not override panel chrome");
});
test("custom palette rejects unreadable colors and never overwrites working selection", () => {
  resetUiTheme();
  assert.equal(selectUiTheme("graphite"), true);
  const old = getUiTheme();
  const rejected = setCustomUiThemeColor("background", "#FFFFFF");
  assert.match(rejected, /too bright/);
  assert.equal(getUiTheme(), old);
  assert.equal(selectUiTheme("not a preset"), false);
  assert.equal(getUiTheme(), old);
  assert.equal(setCustomUiThemeColor("surface", "#213749"), "");
  assert.equal(getUiTheme().preset, "custom");
  assert.equal(uiThemeColors(getUiTheme()).surface, "#213749");
  resetUiTheme();
});
test("stored theme applies tokens and emits one change per selection", () => {
  resetUiTheme();
  const calls = [];
  const unsub = subscribeUiTheme(() => calls.push(getUiTheme().preset));
  selectUiTheme("oxblood");
  selectUiTheme("custom");
  assert.deepEqual(calls, ["oxblood", "custom"]);
  unsub();
  selectUiTheme("forest");
  assert.equal(calls.length, 2);
  const props = new Map();
  let attr = "";
  applyUiTheme(getUiTheme(), {
    setAttribute(name, value) { attr = name + "=" + value; },
    style: { setProperty(name, value) { props.set(name, value); } },
  });
  assert.equal(attr, "data-oh-ui-theme=forest");
  assert.equal(props.get("--oh-ui-bg"), "#121E19");
  assert.equal(props.get("--oh-ui-accent"), "#78C8A1");
  resetUiTheme();
  assert.equal(UI_THEME_STORAGE_KEY, "openhistoria:ui-theme:v1");
});

test("theme persists across app initialization and synchronizes storage changes", () => {
  const data = new Map([[UI_THEME_STORAGE_KEY, JSON.stringify({ preset: "sepia", custom: UI_THEME_PRESETS[0].colors })]]);
  const handlers = new Map();
  const vars = new Map();
  const local = {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
  globalThis.localStorage = local;
  globalThis.window = { addEventListener(type, cb) { handlers.set(type, cb); } };
  const root = { style: { setProperty(key, value) { vars.set(key, value); }, removeProperty(key) { vars.delete(key); } }, setAttribute(name, value) { this[name] = value; } };
  globalThis.document = { documentElement: root };
  try {
    installUiTheme();
    assert.equal(getUiTheme().preset, "sepia");
    assert.equal(vars.get("--oh-ui-bg"), "#241F19");
    assert.equal(root["data-oh-ui-theme"], "sepia");
    selectUiTheme("forest");
    assert.equal(JSON.parse(data.get(UI_THEME_STORAGE_KEY)).preset, "forest");
    assert.equal(vars.get("--oh-ui-accent"), "#78C8A1");
    data.set(UI_THEME_STORAGE_KEY, JSON.stringify({ preset: "graphite", custom: UI_THEME_PRESETS[0].colors }));
    handlers.get("storage")({ key: UI_THEME_STORAGE_KEY });
    assert.equal(getUiTheme().preset, "graphite");
    assert.equal(root["data-oh-ui-theme"], "graphite");
    data.set(UI_THEME_STORAGE_KEY, "not-json");
    handlers.get("storage")({ key: UI_THEME_STORAGE_KEY });
    assert.equal(getUiTheme().preset, DEFAULT_UI_THEME, "invalid preferences fail closed");
    assert.equal(vars.has("--oh-ui-bg"), false, "legacy defaults must clear theme root overrides");
    assert.equal(vars.has("--oh-grey-bg"), false, "legacy neutral tokens must fall back to original :root");
  } finally {
    delete globalThis.localStorage;
    delete globalThis.window;
    delete globalThis.document;
    resetUiTheme();
  }
});

test("Default (Original) removes every theme override and preserves unrelated HUD tokens", () => {
  const values = new Map([["--oh-hud-bg", "original-hud"]]);
  const attrs = new Map();
  const root = {
    style: {
      setProperty(name, value) { values.set(name, value); },
      removeProperty(name) { values.delete(name); },
    },
    setAttribute(name, value) { attrs.set(name, value); },
  };
  applyUiTheme({ preset: "forest" }, root);
  assert.equal(values.get("--oh-ui-bg"), "#121E19");
  assert.ok(values.has("--oh-grey-bg"));
  applyUiTheme({ preset: "default" }, root);
  assert.equal(attrs.get("data-oh-ui-theme"), "default");
  assert.deepEqual([...values.entries()], [["--oh-hud-bg", "original-hud"]],
    "original panel and :root CSS colors must take over, without changing the game HUD");
  assert.equal(selectUiTheme("default"), true);
  assert.equal(getUiTheme().preset, "default");
  assert.equal(selectUiTheme("midnight"), true);
  assert.equal(getUiTheme().preset, "midnight", "an explicitly selected Midnight Navy remains a separate preset");
  resetUiTheme();
});
