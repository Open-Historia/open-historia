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
  assert.match(time, /const widgetSurface = \{[\s\S]*?backgroundColor: "var\(--oh-hud-bg-strong\)"/);
  assert.doesNotMatch(theme, /"--oh-hud-/);
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
