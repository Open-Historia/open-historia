// Run: node --test server/flagStore.test.js
//
// Against a throwaway data folder: OH_DATA_DIR is read once at import, so it is
// set before the store is loaded. Nothing here touches a real install.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-flag-store-test-"));
process.env.OH_DATA_DIR = DATA_DIR;
const { createFlag, listFlags } = await import("./flagStore.js");

after(() => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const png = (byte) => `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, byte]).toString("base64")}`;

test("a saved flag keeps its polity's exact name beside the short code hint", () => {
  const flag = createFlag({ name: "Holy Roman Empire", code: "Holy Roman Empire", polity: "Holy Roman Empire", dataUrl: png(1) });
  assert.equal(flag.code, "HOLY ROMAN E");
  assert.equal(flag.polity, "Holy Roman Empire");
  assert.equal(listFlags().find((f) => f.id === flag.id).polity, "Holy Roman Empire");
});

test("a flag saved without a polity, or with one too long to be a name, keeps none", () => {
  assert.equal(createFlag({ name: "Plain", dataUrl: png(2) }).polity, "");
  assert.equal(createFlag({ name: "Long", polity: "x".repeat(201), dataUrl: png(3) }).polity, "");
  assert.equal(createFlag({ name: "Odd", polity: { name: "Prussia" }, dataUrl: png(4) }).polity, "");
});
