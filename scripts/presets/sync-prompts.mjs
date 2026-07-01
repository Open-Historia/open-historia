// Keep each scenario's stored prompts.json in sync with the JS prompt defaults
// for the keys we changed. The runtime prefers the stored prompts.json over the
// JS defaults (normalizePromptPack), so a prompt edit only takes effect once the
// stored copies are updated too.
//
//   node scripts/presets/sync-prompts.mjs
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GAMEPLAY_PROMPT_DEFAULTS } from "../../src/Game/AI/gameplayPrompts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SCENARIOS_DIR = path.join(PROJECT_ROOT, "server", "data", "scenarios");

// Only the task prompts we edited need syncing.
const KEYS = ["jumpForward", "autoJumpForward"];
const SCENARIOS = ["default", "wwii-1939", "medieval-1200"];

for (const id of SCENARIOS) {
  const file = path.join(SCENARIOS_DIR, id, "prompts.json");
  if (!existsSync(file)) {
    console.log(`skip ${id} (no prompts.json)`);
    continue;
  }
  const prompts = JSON.parse(readFileSync(file, "utf8"));
  for (const key of KEYS) {
    const value = GAMEPLAY_PROMPT_DEFAULTS[key];
    if (typeof value !== "string") continue;
    if (key in prompts) prompts[key] = value;
    if (prompts.tasks && typeof prompts.tasks === "object" && key in prompts.tasks) {
      prompts.tasks[key] = value;
    }
  }
  writeFileSync(file, `${JSON.stringify(prompts, null, 2)}\n`, "utf8");
  console.log(`synced ${id}/prompts.json`);
}
