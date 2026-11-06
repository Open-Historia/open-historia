import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { uiThemeTokens } from "../../runtime/uiTheme.js";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

const library = read("./libraryBar.jsx");
const community = read("./communityHub.jsx");
const lobbies = read("../../multiplayer/ui/LobbiesTab.jsx");
const publicLobbies = read("../../multiplayer/ui/PublicLobbies.jsx");
const actions = read("./actions.jsx");
const advisorDock = read("./main.jsx");
const countryDock = read("./other.jsx");
const mapMode = read("./MapModeSelector.jsx");
const settings = read("./settings.jsx");
const css = read("../../styles.css");

test("Rostra preserves upstream theme coverage and tints only its remaining neutral controls", () => {
  assert.match(library, /background: "var\(--oh-ui-header, #0b0b0d\)"/);
  assert.match(library, /background: active \? "var\(--oh-ui-active, rgba\(255,255,255,0\.11\)\)"/);
  assert.match(library, /const themeButtonStyle = \{[\s\S]*?background: "var\(--oh-ui-overlay-card,/);
  assert.match(library, /const themeSurfaceStyle = \{[\s\S]*?border: "1px solid var\(--oh-ui-line,/);
  assert.match(library, /const editorNavButtonStyle = \(active\) => \(\{[\s\S]*?background: active \? "var\(--oh-ui-active,/);
  assert.match(library, /const CreateScenarioTile = [\s\S]*?background: "var\(--oh-ui-overlay-card,/);
  assert.equal((library.match(/data-oh-theme-nav=""/g) || []).length, 3);
  assert.match(library, /const accent = record\.accentColor \|\| "#a1a1aa"/);
  assert.match(css, /@media \(hover: hover\) \{[\s\S]*?\[data-oh-theme-nav\]:hover:not\(:disabled\)/);
  assert.match(css, /color-mix\(in srgb, var\(--oh-ui-accent\) 38%, transparent\)/);
});

test("Community and Lobbies reuse upstream themed cards while tinting neutral inputs", () => {
  assert.match(community, /const cardSurface = \{[\s\S]*?background: "var\(--oh-ui-surface, #12141a\)"/);
  assert.match(community, /const pillButton = \{[\s\S]*?background: "var\(--oh-ui-overlay-card,/);
  assert.match(community, /const searchInputStyle = \{[\s\S]*?background: "var\(--oh-ui-overlay-card,/);
  assert.match(lobbies, /const card = \{[\s\S]*?background: "var\(--oh-ui-surface, #12141a\)"/);
  assert.match(lobbies, /const input = \{ background: "var\(--oh-ui-overlay-card,/);
  assert.match(lobbies, /const button = \{[\s\S]*?background: "var\(--oh-ui-overlay-card,/);
  assert.match(publicLobbies, /const input = \{ background: "var\(--oh-ui-overlay-card,/);
  assert.match(lobbies, /const primary = \{ \.\.\.button, background: "color-mix\(in srgb, var\(--oh-ui-accent,/);
  assert.match(community, /DISCORD_BLURPLE/);
  assert.match(lobbies, /const errorText = \{ color: "#fca5a5"/);
});

test("Actions and Settings controls use opt-in palettes with original color fallbacks", () => {
  assert.match(actions, /background: "var\(--oh-ui-overlay-card, rgba\(255,255,255,0\.05\)\)"/);
  assert.match(actions, /event\.currentTarget\.style\.background = "var\(--oh-ui-hover,/);
  assert.match(actions, /background: inputValue\.trim\(\) && !isSubmitting && !isImproving \? "var\(--oh-ui-active, #3b82f6\)"/);
  assert.match(actions, /boxShadow: "inset 0 0 0 1px var\(--oh-ui-accent, transparent\)"/);
  assert.match(settings, /const primaryButtonStyle = \{[\s\S]*?backgroundColor: "var\(--oh-ui-active,/);
  assert.match(settings, /backgroundColor: enabled \? \(inactive \? "var\(--oh-ui-hover,/);
  assert.match(settings, /data-oh-theme-hud=""/);
});

test("Theme accents stop at HUD chrome; canonical map, warnings and original palette stay unchanged", () => {
  assert.match(advisorDock, /background: isAdvisorOpen[\s\S]*?"var\(--oh-ui-glass-active,/);
  assert.match(advisorDock, /borderColor: isAdvisorOpen \? "var\(--oh-ui-glass-active-line,/);
  assert.match(advisorDock, /var\(--oh-ui-glass-pill,/);
  assert.match(advisorDock, /data-oh-theme-hud=""/);
  assert.match(countryDock, /background: active[\s\S]*?"var\(--oh-ui-glass-active,/);
  assert.match(countryDock, /borderColor: active \? "var\(--oh-ui-glass-active-line,/);
  assert.match(countryDock, /var\(--oh-ui-glass-pill,/);
  assert.match(countryDock, /data-oh-theme-hud=""/);
  assert.match(mapMode, /background: !isDiplo \? "var\(--oh-ui-glass-active,/);
  assert.match(mapMode, /background: isDiplo \? "var\(--oh-ui-glass-active,/);
  assert.match(mapMode, /borderColor: isDiplo \? "var\(--oh-ui-glass-active-line,/);
  assert.match(mapMode, /data-oh-theme-hud=""/);
  assert.match(css, /\[data-oh-ui-theme\]:not\(\[data-oh-ui-theme="default"\]\) \[data-oh-theme-hud\]:focus-visible/);
  assert.match(advisorDock, /backgroundColor: "#a8181e"/);
  const tokens = uiThemeTokens({ preset: "forest" });
  assert.equal(tokens["--oh-ui-accent"], "#78C8A1");
  assert.ok(tokens["--oh-ui-glass-active"].startsWith("rgba("), "chosen HUD controls stay translucent");
  assert.ok(!Object.keys(tokens).some((key) => /party|relationship|diplomac|military|war|map-/i.test(key)));
  assert.deepEqual(uiThemeTokens({ preset: "default" }), {});
});
