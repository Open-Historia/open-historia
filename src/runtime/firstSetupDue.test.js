// Run: node --test src/runtime/firstSetupDue.test.js
//
// "make it so when installing the game (or when people update to the next
// update) there is a first time setup where you pick your language ... then
// ... your theme and then after that it goes away and shows you the vault
// door" (the owner, 2026-11-05).
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { FIRST_SETUP_KEY, firstSetupDue, rememberFirstSetup } from "./firstSetupDue.js";
import { GREETINGS } from "./greetings.js";

const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const memory = () => {
  const values = new Map();
  return { getItem: (key) => (values.has(key) ? values.get(key) : null), setItem: (key, value) => values.set(key, String(value)) };
};

test("owed once a device: before it is finished, and never after", () => {
  const store = memory();
  assert.equal(firstSetupDue(store), true, "a new install, or a device updating to this build");
  rememberFirstSetup(store);
  assert.equal(store.getItem(FIRST_SETUP_KEY), "1");
  assert.equal(firstSetupDue(store), false);
});

test("where nothing can be kept it is not shown, since it would come back every time", () => {
  assert.equal(firstSetupDue(null), false);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(firstSetupDue(broken), false);
  assert.doesNotThrow(() => rememberFirstSetup(broken));
});

test("it comes before the vault door, which shuts behind it", () => {
  const app = read("src/App.jsx");
  assert.match(app, /const \[setupDue, setSetupDue\] = useState\(\(\) => firstSetupDue\(\)\);/);
  assert.match(app, /const shut = show \|\| setupRef\.current;/, "the door follows the setup whatever the build");
  assert.match(app, /\{setupShown && \(\n\s*<Suspense[^\n]*>\n\s*<FirstSetup onDone=\{setupDone\} \/>/);
  assert.match(app, /\{menuReady && !setupDue && door === "shut" && \(/, "no door while the setup is up");
});

test("the language page greets in many languages, then the theme page follows the choice", () => {
  const setup = read("src/Game/GameUI/FirstSetup.jsx");
  assert.ok(GREETINGS.length >= 20);
  assert.equal(new Set(GREETINGS.map((entry) => entry.code)).size, GREETINGS.length);
  for (const entry of GREETINGS) assert.ok(entry.hello && entry.welcome, entry.code);
  assert.match(setup, /className="oh-setup-greeting" data-no-translate/, "the greetings are never translated");
  assert.match(setup, /const shown = await switchLanguage\(code\);[\s\S]*?if \(shown === code\) onChosen\(\);/, "a declined download stays on the language page");
  assert.match(setup, /onClick=\{\(\) => selectUiTheme\(choice\.id\)\}/);
  assert.match(setup, /\{ id: DEFAULT_UI_THEME, name: "Default \(Original\)"/);
  assert.match(setup, /UI_THEME_PRESETS\.map/);
  const css = read("src/Game/GameUI/firstSetup.css");
  assert.match(css, /\.oh-setup \{[\s\S]*?background: var\(--oh-ui-bg, #0f0f11\);/, "drawn in the theme it is choosing");
  assert.match(css, /z-index: 2147482500;/, "above the door (2147482000), under the download prompt");
});
