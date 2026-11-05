import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const root = read("../../main.jsx");
const settings = read("./settings.jsx");
const selector = read("./UiThemeSettings.jsx");
const paletteCss = read("./uiThemeSettings.css");
const country = read("./countryDossier.css");
const advisor = read("./advisorDossier.css");
const actions = read("./actions.jsx");
const projects = read("./projects.jsx");
const diplomacy = read("./chat.jsx");
const palette = read("../../runtime/uiTheme.js");

test("theme initializes before the first React render and Settings General owns the UI selector", () => {
  assert.match(root, /installUiTheme\(\);[\s\S]*?createRoot\(/);
  assert.match(settings, /<SettingsSection title="Interface appearance"[\s\S]*?<UiThemeSettings \/>/);
  assert.match(selector, /UI_THEME_PRESETS\.map\(/);
  assert.match(selector, /selectUiTheme\("custom"\)/);
  assert.match(selector, /FIELDS\.map\(/);
  assert.match(selector, /type="color"/);
  assert.match(selector, /type="text"/);
  assert.match(selector, /resetUiTheme/);
  assert.match(selector, /aria-pressed=\{theme\.preset === item\.id\}/);
  assert.match(paletteCss, /@media \(max-width: 480px\)/);
  assert.match(paletteCss, /:focus-visible/);
});
test("Country and Advisor use a shared chrome palette without editing charts or game state", () => {
  assert.match(country, /--dossier-ink: var\(--oh-ui-bg,/);
  assert.match(country, /--dossier-accent: var\(--oh-ui-accent,/);
  assert.match(country, /\.oh-country-ranking-context\s*\{[\s\S]*?background: var\(--oh-ui-surface,/);
  assert.match(country, /\.oh-country-landscape-switch\s*\{[\s\S]*?background: var\(--oh-ui-surface,/);
  assert.match(advisor, /--oh-advisor-bg: var\(--oh-ui-bg,/);
  assert.match(advisor, /--oh-advisor-accent: var\(--oh-ui-accent,/);
  assert.match(advisor, /\.oh-advisor-composer-field\s*\{[\s\S]*?background: var\(--oh-ui-surface,/);
  assert.match(advisor, /\.oh-advisor-message-body\[data-role="error"\]/);
  assert.doesNotMatch(palette, /writeWorldState|writeJson|saveGame|countryColor|partyColor/);
});
test("the main menu, its pages and the popups take the theme, the original colours as fallbacks", () => {
  const menu = read("./libraryBar.jsx");
  assert.match(menu, /background:\r?\n\s*"var\(--oh-ui-bg, #0f0f11\)",/);
  assert.match(menu, /background: "var\(--oh-ui-header, #0b0b0d\)",\r?\n\s*borderRight:/, "the rail");
  assert.match(menu, /const themeSurfaceStyle = \{\r?\n\s*background: "var\(--oh-ui-surface, #12141a\)",/, "cards and dialogs");
  assert.match(menu, /background: active \? "var\(--oh-ui-active, rgba\(255,255,255,0\.11\)\)"/);
  assert.doesNotMatch(menu, /"#12141a"/);
  assert.match(read("./communityHub.jsx"), /background: "var\(--oh-ui-surface, #12141a\)",/);
  assert.match(read("../../multiplayer/ui/LobbiesTab.jsx"), /background: "var\(--oh-ui-surface, #12141a\)",/);
  for (const toast of ["generationRatingToast", "fallbackSwitchNotice", "agentWaitingNotice", "bordersFallbackNotice"]) {
    assert.match(read(`./${toast}.jsx`), /backgroundColor: "var\(--oh-ui-overlay-strong, rgba\(16,21,24,0\.96\)\)"/, toast);
  }
  assert.match(read("../../runtime/AppUpdateBanner.jsx"), /background: "var\(--oh-ui-surface, #131315\)",/);
  const translator = read("../../runtime/translator.js");
  assert.match(translator, /background:var\(--oh-ui-surface,#1b1b1e\);/, "the translation prompt");
  assert.match(translator, /background:var\(--oh-ui-text,#f4f4f5\);color:var\(--oh-ui-bg,#0b0b0d\)/, "no blue in the prompt");
});

test("Actions, Projects and diplomatic conversation chrome consume tokens while status colors remain semantic", () => {
  assert.match(actions, /backgroundColor: "var\(--oh-ui-bg,/);
  assert.match(projects, /const cardStyle = \{[\s\S]*?backgroundColor: "var\(--oh-ui-surface,/);
  assert.match(projects, /const selectStyle = \{[\s\S]*?backgroundColor: "var\(--oh-ui-surface,/);
  assert.match(diplomacy, /data-diplomacy-header="modern"[\s\S]*?background: "var\(--oh-ui-header,/);
  assert.match(diplomacy, /data-diplomacy-composer="modern"[\s\S]*?background: isInstitutionCouncil \? "transparent" : "var\(--oh-ui-header,/);
  assert.match(diplomacy, /color-mix\(in srgb, \$\{accentColor\} 4%, var\(--oh-ui-surface,/);
  // These colors encode game meaning and must not be derived from user accent.
  assert.match(projects, /if \(flags\.overdue\) return "#ef4444";/);
  assert.match(projects, /if \(flags\.stale \|\| flags\.milestoneMissed\) return "#f59e0b";/);
  assert.match(projects, /if \(project\.status === "complete"\) return "#22d3ee";/);
});
