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
  assert.match(advisor, /\.oh-advisor-composer-input\s*\{[\s\S]*?background: var\(--oh-ui-surface,/);
  assert.match(advisor, /\.oh-advisor-message-body\[data-role="error"\]/);
  assert.doesNotMatch(palette, /writeWorldState|writeJson|saveGame|countryColor|partyColor/);
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
