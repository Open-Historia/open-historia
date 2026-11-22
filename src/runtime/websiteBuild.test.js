import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isWebsiteBuild } from "./websiteBuild.js";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("only the website's browser demo is the website build", () => {
  assert.equal(isWebsiteBuild({ VITE_OH_WEB: "1" }), true);
  assert.equal(isWebsiteBuild({ VITE_OH_WEB: "1", VITE_OH_NATIVE: "1" }), false, "the Android app");
  assert.equal(isWebsiteBuild({}), false, "the desktop app");
  assert.equal(isWebsiteBuild(), false);
});

// "make it so the theme picker and the vault door dont appear on the website demo" (the owner, 2026-11-09).
test("the website demo opens on the menu with no vault door and picks no theme", () => {
  const app = read("../App.jsx");
  assert.match(app, /useState\(\(\) => \{\r?\n\s*if \(isWebsiteBuild\(import\.meta\.env\)\) return "open";\r?\n\s*holdMusicBehindDoor\(true\);/);

  const setup = read("../Game/GameUI/FirstSetup.jsx");
  assert.match(setup, /export default function FirstSetup\(\{ onDone, withTheme = !isWebsiteBuild\(import\.meta\.env\) \}\)/);
  assert.match(setup, /<LanguagePage onChosen=\{withTheme \? \(\) => setStep\(1\) : finish\} \/>/);
  assert.match(setup, /\{withTheme && <Steps step=\{step\} \/>\}/);

  const settings = read("../Game/GameUI/settings.jsx");
  assert.match(settings, /\{!isWebsiteBuild\(import\.meta\.env\) && \(\r?\n\s*<SettingsSection title="Interface appearance"/);
  assert.match(settings, /\{!isWebsiteBuild\(import\.meta\.env\) && \(\r?\n\s*<>\r?\n\s*\{\/\* The vault door shows/);
});
