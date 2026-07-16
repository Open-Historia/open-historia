import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizePromptPack } from "../src/Game/AI/gameplayPrompts.js";

const OWNERSHIP_TASKS = ["jumpForward", "autoJumpForward", "gameMaster"];

const AUTHORED_PROMPT_ASSETS = [
  ["bundled defaults", new URL("../src/Game/AI/defaultPrompts.json", import.meta.url)],
  ["built-in scenario", new URL("./data/scenarios/default/prompts.json", import.meta.url)],
];

test("authored prompt assets visibly explain exact region ownership changes", () => {
  for (const [assetName, assetUrl] of AUTHORED_PROMPT_ASSETS) {
    const prompts = JSON.parse(readFileSync(assetUrl, "utf8"));
    const normalized = normalizePromptPack(prompts);

    for (const key of OWNERSHIP_TASKS) {
      const prompt = prompts.tasks[key];
      assert.match(prompt, /\[Region Ownership Changes\]/, `${assetName} ${key}`);
      assert.match(prompt, /impacts\.regionTransfers/, `${assetName} ${key}`);
      assert.match(prompt, /exact region id/i, `${assetName} ${key}`);
      assert.match(prompt, /do not invent/i, `${assetName} ${key}`);
      assert.match(prompt, /\$\{regionOwnershipReference\}/, `${assetName} ${key}`);
      assert.ok(
        prompt.indexOf("[Region Ownership Changes]") < 5000,
        `${assetName} ${key} should show ownership guidance near the beginning`,
      );
      assert.equal(
        (normalized.tasks[key].match(/\[Region Ownership Changes\]/g) ?? []).length,
        1,
        `${assetName} ${key} should retain one ownership block after normalization`,
      );
      assert.ok(
        normalized.tasks[key].indexOf("[Region Ownership Changes]") < 5000,
        `${assetName} ${key} should remain visible after normalization`,
      );
    }
  }
});

test("world-changing AI tasks explain the exact region ownership mechanism", () => {
  const customTasks = Object.fromEntries(
    OWNERSHIP_TASKS.map((key) => [key, `Custom ${key} prompt.\n\n--- OUTPUT FORMAT (return valid JSON only) ---`]),
  );
  const pack = normalizePromptPack({ tasks: customTasks });

  for (const key of OWNERSHIP_TASKS) {
    const prompt = pack.tasks[key];
    assert.match(prompt, /\[Region Ownership Changes\]/);
    assert.match(prompt, /impacts\.regionTransfers/);
    assert.match(prompt, /exact region id/i);
    assert.match(prompt, /one transfer object per region/i);
    assert.match(prompt, /do not invent/i);
    assert.match(prompt, /\$\{regionOwnershipReference\}/);
    assert.ok(
      prompt.startsWith("[Region Ownership Changes]"),
      `${key} should show ownership rules before the legacy prompt body`,
    );
    assert.ok(
      prompt.indexOf("[Region Ownership Changes]") < prompt.indexOf("--- OUTPUT FORMAT"),
      `${key} should teach ownership changes before describing its output`,
    );
  }
});

test("region ownership guidance is appended only once", () => {
  const once = normalizePromptPack({ tasks: { jumpForward: "Custom jump prompt." } });
  const twice = normalizePromptPack(once);
  const headings = twice.tasks.jumpForward.match(/\[Region Ownership Changes\]/g) ?? [];

  assert.equal(headings.length, 1);
});

test("custom prompt ownership markers are completed without duplicating the inventory", () => {
  const headingOnly = normalizePromptPack({
    tasks: { gameMaster: "[Region Ownership Changes]\nUse transfers carefully." },
  }).tasks.gameMaster;
  assert.equal((headingOnly.match(/\$\{regionOwnershipReference\}/g) ?? []).length, 1);
  assert.equal((headingOnly.match(/\[Region Ownership Changes\]/g) ?? []).length, 1);
  assert.match(headingOnly, /impacts\.regionTransfers/);
  assert.match(headingOnly, /exact region id/i);
  assert.ok(headingOnly.startsWith("[Region Ownership Changes]"));

  const referenceOnly = normalizePromptPack({
    tasks: { gameMaster: "Use this map:\n${regionOwnershipReference}" },
  }).tasks.gameMaster;
  assert.equal((referenceOnly.match(/\$\{regionOwnershipReference\}/g) ?? []).length, 1);
  assert.equal((referenceOnly.match(/\[Region Ownership Changes\]/g) ?? []).length, 1);
  assert.match(referenceOnly, /impacts\.regionTransfers/);
  assert.match(referenceOnly, /exact region id/i);
  assert.ok(referenceOnly.startsWith("[Region Ownership Changes]"));
});

test("complete ownership guidance buried in a legacy prompt is moved to the top", () => {
  const canonical = normalizePromptPack({
    tasks: { jumpForward: "Legacy jump prompt." },
  }).tasks.jumpForward;
  const repaired = normalizePromptPack({
    tasks: { jumpForward: `${"Legacy context. ".repeat(500)}\n${canonical}` },
  }).tasks.jumpForward;

  assert.ok(repaired.startsWith("[Region Ownership Changes]"));
  assert.equal((repaired.match(/\[Region Ownership Changes\]/g) ?? []).length, 1);
  assert.equal((repaired.match(/\$\{regionOwnershipReference\}/g) ?? []).length, 1);
});
