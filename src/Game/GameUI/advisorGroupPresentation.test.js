import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("group chat labels are generic and preserve user-defined names", () => {
  const ui = source("./AdvisorRecipients.jsx");
  const panel = source("./advisor.jsx");
  assert.match(ui, /Create group chat/);
  assert.match(ui, /Edit group chat/);
  assert.match(ui, /Choose 2 to 10 advisors/);
  assert.doesNotMatch(ui, /cabinet meeting|cabinet participants|Cabinet Meeting/i);
  assert.doesNotMatch(panel, /cabinet meeting|cabinet member|Former cabinet/i);
  assert.match(ui, /group\.name/);
});

test("group chat batching settings use the existing compact music-volume range pattern", () => {
  const settings = source("./settings.jsx");
  assert.match(settings, /Individual AI responses in group chats/);
  assert.match(settings, /Advisors per AI request/);
  assert.match(settings, /type="range" min="1" max="10"/);
  assert.match(settings, /disabled=\{groupAi\.individual\}/);
});

test("contact rows, not just the six-dot handle, are the draggable surface", () => {
  const ui = source("./AdvisorRecipients.jsx");
  const css = source("./advisorDossier.css");
  assert.match(ui, /className="oh-advisor-contact-row" draggable=\{!busy && !saving\}/);
  assert.match(ui, /setDragImage\(event\.currentTarget/);
  assert.match(ui, /setHoverId\(contact\.id\)/);
  assert.match(css, /\[data-dragging="true"\]/);
  assert.match(css, /\[data-drop-target="true"\]/);
});

test("AI debug generations collapse group calls without rewriting underlying usage", () => {
  const ui = source("./debugConsole.jsx");
  const main = source("../AI/main.jsx");
  assert.match(ui, /groupGenerationRows\(filtered\)/);
  assert.match(ui, /expandedGroupTurns/);
  assert.match(ui, /group\.requests\} provider requests/);
  assert.match(main, /groupTurnId: groupDebug\.turnId/);
  assert.match(main, /requestLedger\.note\(/);
});
