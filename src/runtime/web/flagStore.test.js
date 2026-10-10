/*! Open Historia — flag library parity tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/flagStore.test.js
//
// The desktop library (server/flagStore.js) and the website's and Android
// app's (web/flagStore.js) must agree on what a flag is: the same data URL is
// kept by both or refused by both.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installFakeIndexedDb } from "./fakeIndexedDb.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-flags-"));
process.env.OH_DATA_DIR = dataDir;
const fake = installFakeIndexedDb();
const desktop = await import("../../../server/flagStore.js");
const { handleFlags } = await import("./flagStore.js");
const { MAX_FLAG_BYTES } = await import("../../../server/flagValidation.js");

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const onDesktop = (dataUrl) => {
  try {
    desktop.createFlag({ name: "Test", dataUrl });
    return { kept: true };
  } catch (error) {
    return { kept: false, error: error.message };
  }
};
const onWeb = async (dataUrl) => {
  const response = await handleFlags({ method: "POST", segments: [], body: { name: "Test", dataUrl } });
  const body = await response.json();
  return response.status === 201 ? { kept: true } : { kept: false, error: body.error };
};

const cases = {
  "a small PNG": "data:image/png;base64,iVBORw0KGgo=",
  "an SVG": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
  "a BMP": "data:image/bmp;base64,Qk0=",
  "not base64": "data:image/png,rawbytes",
  "not an image": "data:text/plain;base64,aGk=",
  "an oversized PNG": `data:image/png;base64,${"A".repeat((MAX_FLAG_BYTES / 3) * 4 + 4)}`,
};

for (const [name, dataUrl] of Object.entries(cases)) {
  test(`${name}: both builds give the same answer`, async () => {
    fake.clear();
    const web = await onWeb(dataUrl);
    assert.deepEqual(web, onDesktop(dataUrl));
  });
}

test("the web store refuses what the old prefix check let through", async () => {
  fake.clear();
  const result = await onWeb(cases["an oversized PNG"]);
  assert.equal(result.kept, false);
  assert.match(result.error, /too large/);
  assert.equal(fake.rows("open-historia-web", "flags").size, 0, "nothing was stored");
});
