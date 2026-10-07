/*! Open Historia — institution shipped-language coverage regression. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { SHIPPED_PACK_LANGUAGES } from "./i18n.js";

const workspace = fs.readFileSync(new URL("../Game/GameUI/InstitutionsWorkspace.jsx", import.meta.url), "utf8");
const authoring = fs.readFileSync(new URL("../Game/GameUI/InstitutionAuthoringPanel.jsx", import.meta.url), "utf8");
const catalog = JSON.parse(fs.readFileSync(new URL("../../public/lang/catalog-en.json", import.meta.url), "utf8"));

const source = `${workspace}\n${authoring}`;
const runtimeErrorsShownByWorkspace = [
  "Proposal requires a stable id and title.",
];

// The catalog extractor already decides what counts as fixed interface text.
// Restrict that catalog to strings actually present in the two institution UI
// sources, then pin the runtime validation errors those screens can surface.
const required = [
  ...catalog.filter((entry) => typeof entry === "string" && source.includes(entry)),
  ...runtimeErrorsShownByWorkspace,
];

test("institution runtime errors shown by the workspace are in the English catalog", () => {
  for (const value of runtimeErrorsShownByWorkspace) {
    assert.ok(catalog.includes(value), `${value} is missing from catalog-en.json`);
  }
});

test("every shipped language pack covers the fixed institution authoring and governance UI", () => {
  assert.ok(required.length > 250, "institution coverage unexpectedly shrank; update this regression if the UI was intentionally reorganized");
  for (const language of SHIPPED_PACK_LANGUAGES) {
    const pack = JSON.parse(fs.readFileSync(new URL(`../../public/lang/${language}.json`, import.meta.url), "utf8"));
    for (const english of required) {
      const translated = String(pack[english] ?? "").trim();
      assert.ok(translated, `${language}: missing ${english}`);
    }
  }
});
