/*! Open Historia - GM revision wiring regression tests (AGPL-3.0-or-later). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const gameplay = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const lazy = fs.readFileSync(new URL("./gameplayLazy.js", import.meta.url), "utf8");
const consoleSource = fs.readFileSync(new URL("../GameUI/cheats.jsx", import.meta.url), "utf8");

test("GM revision includes the prior exact transaction, not merely the amendment", () => {
  const start = gameplay.indexOf("export const previewGameMasterRevision = async");
  const end = gameplay.indexOf("export const applyGameMasterPreview = async", start);
  const source = gameplay.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(source, /BASE TRANSACTION:[\s\S]*?JSON\.stringify\(prior\.transaction\)/);
  assert.match(source, /toolOverride: GAME_MASTER_EDIT_TOOL/);
  assert.match(source, /customToolPayload: true/);
  assert.match(source, /validateToolPayload: validateGameMasterEditResponse/);
  assert.match(source, /validateGameMasterPreviewPayload\(candidate/);
  assert.match(source, /gameMasterStateFingerprint\(/);
  assert.match(source, /prior\.baseFingerprint/);
  assert.match(source, /applyGameMasterPreviewEdits\(prior\.transaction, payload\)/);
  assert.match(source, /transaction,\s*generation,/);
  assert.match(source, /previewOnly: true/);
  assert.match(lazy, /export const previewGameMasterRevision = async/);
});

test("Edit Preview is compact, keeps the old preview while editing and only replaces it after success", () => {
  assert.match(consoleSource, /gmEditOpen, setGmEditOpen/);
  assert.match(consoleSource, /\{gmEditOpen \? "Cancel Edit" : "Edit Preview"\}/);
  assert.match(consoleSource, /rows=\{3\}/);
  const call = consoleSource.indexOf("const result = await previewGameMasterRevision(gmPreview, gmEditText.trim())");
  assert.ok(call > 0);
  const continuation = consoleSource.slice(call, call + 320);
  assert.match(continuation, /setGmPreview\(result\)/);
  assert.doesNotMatch(continuation, /setGmPreview\(null\)/);
  assert.match(consoleSource, /disabled=\{busy \|\| !gmEditText\.trim\(\)\}/);
  assert.match(consoleSource, /const result = await applyGameMasterPreview\(gmPreview\)/, "still applies only the displayed transaction");
});
