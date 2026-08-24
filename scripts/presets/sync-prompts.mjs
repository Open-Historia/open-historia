/*! Open Historia — preset prompt sync tool © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Keep each scenario's stored prompts.json in sync with the JS prompt defaults
// for the keys we changed. The runtime prefers the stored prompts.json over the
// JS defaults (normalizePromptPack), so a prompt edit only takes effect once the
// stored copies are updated too.
//
//   node scripts/presets/sync-prompts.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Read defaultPrompts.json directly rather than importing gameplayPrompts.js.
// That module imports the JSON without an import attribute — fine under Vite,
// but plain `node` refuses it (ERR_IMPORT_ATTRIBUTE_MISSING), which left this
// tool unrunnable and the stored prompts silently stale.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SCENARIOS_DIR = path.join(PROJECT_ROOT, "server", "data", "scenarios");

const GAMEPLAY_PROMPT_DEFAULTS = JSON.parse(
  readFileSync(path.join(PROJECT_ROOT, "src", "Game", "AI", "defaultPrompts.json"), "utf8"),
).tasks;

// Only the task prompts we edited need syncing.
const KEYS = ["jumpForward", "autoJumpForward", "idleDiplomacy"];
// Whatever scenarios actually ship, rather than a hand-kept list that goes stale
// the moment one is added or renamed.
const SCENARIOS = existsSync(SCENARIOS_DIR)
  ? readdirSync(SCENARIOS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

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
