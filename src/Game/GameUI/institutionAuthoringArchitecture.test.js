import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(here, relative), "utf8");

test("scenario Politics editor exposes premade canonical institution and logo authoring", () => {
  const library = read("./libraryBar.jsx");
  const panel = read("./InstitutionAuthoringPanel.jsx");
  const core = read("../../runtime/institutionAuthoring.js");

  assert.match(library, /InstitutionAuthoringPanel/);
  assert.match(library, /details=\{details\}/);
  assert.match(panel, /Create institutions that already exist when the scenario begins/);
  assert.match(panel, /worldPatch:\s*\{\s*institutions:/);
  assert.match(panel, /Upload small logo/);
  assert.match(panel, /BUILTIN_INSTITUTION_LOGOS/);
  assert.match(panel, /optionStyle/);
  assert.match(panel, /<option key=\{kind\} style=\{optionStyle\}/);
  assert.match(core, /normalizeInstitutionRecord/);
  assert.match(core, /membersText/);
});
