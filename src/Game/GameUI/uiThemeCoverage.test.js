import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const theme = read("../../runtime/uiTheme.js");
const settings = read("./settings.jsx");
const selector = read("./UiThemeSettings.jsx");
const diplomacy = read("./chat.jsx");
const time = read("./time.jsx");
const cheats = read("./cheats.jsx");
const debug = read("./debugConsole.jsx");
const actions = read("./actions.jsx");

test("Default (Original) is first, preserves authored per-panel styles and clears root variables", () => {
  assert.match(theme, /export const DEFAULT_UI_THEME = "default";/);
  assert.match(theme, /if \(normalized\.preset === DEFAULT_UI_THEME\) return \{\};/);
  assert.match(theme, /for \(const name of themeTokenNames\) root\.style\.removeProperty\(name\);/);
  assert.match(selector, /onClick=\{\(\) => selectUiTheme\(DEFAULT_UI_THEME\)\}/);
  assert.match(selector, /Default \(Original\)/);
  assert.match(selector, /UI_THEME_PRESETS\.map/);
  assert.match(selector, /selectUiTheme\("custom"\)/);
  assert.match(time, /const widgetSurface = \{[\s\S]*?backgroundColor: "var\(--oh-ui-glass-pill, var\(--oh-hud-bg-strong\)\)"/);
  // The HUD glass is themed; its text and blue/amber/red signals are not.
  assert.match(theme, /"--oh-hud-bg": translucent\(colors\.background,/);
  assert.match(theme, /"--oh-hud-border": /);
  assert.doesNotMatch(theme, /"--oh-hud-(text|muted|faint|blue|amber|red|radius|shadow|blur)/);
  // The HUD buttons with a grey of their own take the palette too: the menu
  // button, the Advisor and polity buttons, the dock, the map-mode switch.
  for (const file of ["./settings.jsx", "./main.jsx", "./other.jsx", "./chat.jsx", "./actions.jsx", "./social.jsx", "./MapModeSelector.jsx", "./libraryBar.jsx"]) {
    assert.doesNotMatch(read(file), /: "rgba\(35,35,39,0\.53\)"|"rgba\(59,130,246,0\.16\)"|"rgba\(34,34,37,0\.53\)"/, file);
  }
});

// "for themes, it themes the buttons themselfs but not the button tray. or the
// search button"; "it also doesnt theme this" (the date bar) (the owner,
// 2026-11-09). The HUD's own glass (--oh-hud-bg) is all but the default's dark
// grey under a palette, so the trays round themed buttons read the theme's
// glass, the HUD's glass as the fallback: Default is unchanged.
test("The dock's tray, search, the date bar and the map-mode switch take the theme's glass", () => {
  assert.match(diplomacy, /const Toolbar = memo\([\s\S]*?backgroundColor: "var\(--oh-ui-glass-pill, var\(--oh-hud-bg\)\)"/, "the dock's tray");
  const search = read("./search.jsx");
  assert.match(search, /borderRadius: hasSuggestions \? "0 0 12px 12px" : "12px",[\s\S]*?backgroundColor: "var\(--oh-ui-glass-pill, var\(--oh-hud-bg\)\)"/, "the search button");
  assert.match(search, /backgroundColor: "var\(--oh-ui-overlay-header, var\(--oh-hud-bg-strong\)\)"/, "search's suggestions");
  assert.match(search, /index === selectedIndex \? "var\(--oh-ui-glass-hover, rgba\(255,255,255,0\.08\)\)"/);
  assert.match(time, /color: countryButton && countryOpen \? "var\(--oh-ui-glass-active-text, #bfdbfe\)" : "var\(--oh-ui-accent, rgba\(147,197,253,0\.88\)\)"/, "the date bar's country");
  assert.match(time, /color: openPanel === "history" \? "var\(--oh-ui-glass-active-text, #bfdbfe\)"/, "the date bar's «");
  const mapMode = read("./MapModeSelector.jsx");
  assert.equal((mapMode.match(/background: "var\(--oh-ui-glass-pill, var\(--oh-hud-bg\)\)"/g) || []).length, 2, "the map-mode switch and its legend");
  for (const [file, text] of [["chat.jsx", diplomacy], ["search.jsx", search], ["time.jsx", time], ["MapModeSelector.jsx", mapMode]]) {
    assert.doesNotMatch(text, /(?:background|backgroundColor): "var\(--oh-hud-bg(?:-strong)?\)"/, `${file}: no HUD surface left on the bare HUD glass`);
  }
  const advisor = read("./advisorDossier.css");
  assert.match(advisor, /\.oh-advisor-recipient-trigger \{[\s\S]*?border: 1px solid var\(--oh-ui-line, rgba\(141, 194, 222, \.27\)\);/);
  assert.match(advisor, /\.oh-advisor-contact-select\[aria-current="true"\] \{[\s\S]*?background: var\(--oh-ui-active, rgba\(69, 137, 176, \.17\)\);/);
  assert.match(advisor, /\.oh-advisor-composer-field \{[\s\S]*?border: 1px solid var\(--oh-ui-line, rgba\(133, 183, 210, \.3\)\);/);
});

test("Diplomacy list, tabs, unread filter, thread controls and workspace use themed chrome", () => {
  assert.match(diplomacy, /data-diplomacy-workspace-header="modern"[\s\S]*?background: "var\(--oh-ui-overlay-header, transparent\)"/);
  assert.match(diplomacy, /data-diplomacy-thread-row="modern"[\s\S]*?background: hovered \? "var\(--oh-ui-hover,/);
  assert.match(diplomacy, /backgroundColor: "var\(--oh-ui-overlay, rgba\(24,24,27,0\.95\)\)"/);
  assert.match(diplomacy, /background: currentView === key \? "var\(--oh-ui-active,/);
  assert.match(diplomacy, /background: showUnreadOnly \? "var\(--oh-ui-active,/);
  assert.match(diplomacy, /Start New Chat/);
  assert.match(diplomacy, /onMouseLeave=\{e => e\.currentTarget\.style\.background = "var\(--oh-ui-overlay-card,/);
});

test("Events and Timeline use themeable translucent surfaces without changing skip guards", () => {
  assert.match(time, /const panelSurface = \{[\s\S]*?backgroundColor: "var\(--oh-ui-overlay,/);
  assert.match(time, /const EventCard = [\s\S]*?background: "var\(--oh-ui-overlay-card,/);
  assert.match(time, /const JumpNode = [\s\S]*?background: hovered \? "var\(--oh-ui-hover,/);
  assert.match(time, /background: "var\(--oh-ui-active, rgba\(37,99,235,0\.2\)\)"/);
  assert.match(time, /background: "var\(--oh-ui-overlay-strong, rgba\(0,0,0,0\.25\)\)"/);
  assert.match(time, /const blocked = busy \|\| sceneInProgress;/);
  assert.match(time, /disabled=\{blocked \|\| !customValue\}/);
  assert.match(time, /onClick=\{runCustomJump\}[\s\S]*?background: "var\(--oh-ui-active,/);
  assert.match(time, /const MetricPill = [\s\S]*?background: "var\(--oh-ui-overlay-card,/);
  assert.match(time, /const TagPill = [\s\S]*?background: "var\(--oh-ui-overlay-card,/);
  assert.match(time, /const LinkPill = [\s\S]*?background: "var\(--oh-ui-active,/);
  assert.match(time, /const ghostButtonStyle = [\s\S]*?background: "var\(--oh-ui-overlay-card,/);
});

test("Tools / Cheats chrome consumes theme tokens without changing administrative operations", () => {
  assert.match(settings, /const QuickAction = [\s\S]*?neutral: \{ background: "var\(--oh-ui-overlay-card,/);
  assert.match(settings, /const QuickMenuTabButton = [\s\S]*?background: selected \? "var\(--oh-ui-active,/);
  assert.match(settings, /className=\{\x60oh-menu-card/);
  assert.match(settings, /background: "var\(--oh-ui-overlay, rgba\(32,32,35,0\.63\)\)"/);
  assert.match(cheats, /const inputStyle = \{[\s\S]*?background: "var\(--oh-ui-overlay-strong,/);
  assert.match(cheats, /const homeToolButtonStyle = \{[\s\S]*?background: "var\(--oh-ui-overlay-card,/);
  assert.match(cheats, /className="oh-hud-panel"[\s\S]*?background: "var\(--oh-ui-overlay,/);
  assert.match(cheats, /const primaryButtonStyle = \{[\s\S]*?background: "var\(--oh-ui-active,/);
  assert.match(cheats, /const TOOLS = \[/);
  assert.match(cheats, /const TOOL_GROUPS = \[/);
});

test("AI Debug console chrome follows theme while status and ratings stay semantic", () => {
  assert.match(debug, /bg: "var\(--oh-ui-bg, #0a0e11\)"/);
  assert.match(debug, /panel: "var\(--oh-ui-header, #101518\)"/);
  assert.match(debug, /border: "var\(--oh-ui-line, #353538\)"/);
  assert.match(debug, /accent: "var\(--oh-ui-active, #3b82f6\)"/);
  assert.match(debug, /backgroundColor: selected \? "var\(--oh-ui-active,/);
  assert.match(debug, /danger: "#f85149"/);
  assert.match(debug, /gold: "#d29922"/);
  assert.match(debug, /ok: "#3fb950"/);
  assert.match(debug, /const statusColor = \(record\) => \(record\.ok === false \? COLORS\.danger/);
});

test("Standing Goal card themes chrome but retains original goal state and progress calculation", () => {
  assert.match(actions, /const StandingGoal = \(\{ country, round, gameDate, isOpen \}\) =>/);
  assert.match(actions, /playerGoalOf\(world, country\)/);
  assert.match(actions, /<GoalProgress country=\{country\} round=\{round\} turnRunning=\{turnRunning\} \/>/);
  assert.match(actions, /background: "var\(--oh-ui-overlay-card, rgba\(255,255,255,0\.08\)\)"/);
  assert.match(actions, /withPlayerGoal\(current, country, text, \{ round, date: gameDate \}\)/);
});
