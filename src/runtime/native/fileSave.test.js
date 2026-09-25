/*! Open Historia — saving a file from inside the Android app: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/native/fileSave.test.js
//
// The user (2026-09-24): "make it so you can export scenarios and games from the
// apk so downloading works on android". An export inside the app is a download:
// the file goes to Downloads/Open Historia and a notice says so. The share sheet
// is only the fallback, for an Android that will not let the app write there.

import test from "node:test";
import assert from "node:assert/strict";

import { DOWNLOADS_FOLDER, freeFileName, saveBlobFile } from "./fileSave.js";
import { showSavedNotice } from "./savedNotice.js";

// Just enough of the WebView for the saver: FileReader and the Capacitor plugins.
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onload?.();
    }, (error) => {
      this.error = error;
      this.onerror?.();
    });
  }
};

const plugins = ({ existing = [], downloadsRefused = false } = {}) => {
  const writes = [];
  const shares = [];
  const Filesystem = {
    stat: async ({ path }) => {
      if (existing.includes(path)) return { type: "file" };
      throw new Error("File does not exist");
    },
    writeFile: async ({ path, data, directory, recursive }) => {
      if (directory === "EXTERNAL_STORAGE" && downloadsRefused) throw new Error("Permission denied");
      writes.push({ path, data, directory, recursive });
      return { uri: `file:///${directory}/${path}` };
    },
  };
  const Share = { share: async (options) => { shares.push(options); } };
  globalThis.window = { Capacitor: { Plugins: { Filesystem, Share } } };
  return { writes, shares };
};

const zip = () => new Blob([Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], { type: "application/zip" });

test("a name nothing has yet, the way a browser names downloads", async () => {
  const taken = new Set(["game-1-game.zip", "game-1-game (1).zip"]);
  assert.equal(await freeFileName("game-1-game.zip", async (name) => taken.has(name)), "game-1-game (2).zip");
  assert.equal(await freeFileName("log.txt", async () => false), "log.txt");
  assert.equal(await freeFileName("README", async (name) => name === "README"), "README (1)");
});

test("an export goes into Downloads/Open Historia, with no share sheet", async () => {
  const { writes, shares } = plugins();
  assert.equal(await saveBlobFile(zip(), "game-1-game.zip"), "saved");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].directory, "EXTERNAL_STORAGE");
  assert.equal(writes[0].path, `${DOWNLOADS_FOLDER}/game-1-game.zip`);
  assert.equal(DOWNLOADS_FOLDER, "Download/Open Historia");
  assert.equal(writes[0].recursive, true, "the folder is made the first time");
  assert.equal(Buffer.from(writes[0].data, "base64").toString("hex"), "504b0304010203", "the bytes arrive whole");
  assert.equal(shares.length, 0, "a download does not open the share sheet");
});

test("exporting the same game twice keeps both files", async () => {
  const { writes } = plugins({ existing: [`${DOWNLOADS_FOLDER}/game-1-game.zip`] });
  await saveBlobFile(zip(), "game-1-game.zip");
  assert.equal(writes[0].path, `${DOWNLOADS_FOLDER}/game-1-game (1).zip`);
});

test("an Android that refuses Downloads still gets the file, through the share sheet", async () => {
  const { writes, shares } = plugins({ downloadsRefused: true });
  assert.equal(await saveBlobFile(zip(), "scenario-x-scenario.zip"), "saved");
  assert.deepEqual(writes.map((write) => [write.directory, write.path]), [["CACHE", "exports/scenario-x-scenario.zip"]]);
  assert.equal(shares.length, 1);
  assert.equal(shares[0].url, "file:///CACHE/exports/scenario-x-scenario.zip");
});

test("a name with a path in it cannot leave the folder", async () => {
  const { writes } = plugins();
  await saveBlobFile(zip(), "../../evil/name.zip");
  assert.equal(writes[0].path, `${DOWNLOADS_FOLDER}/..-..-evil-name.zip`);
});

// A minimal DOM: elements that hold children, style, attributes and click
// handlers — enough to read back what the notice shows.
const fakeDocument = () => {
  const make = (tag) => {
    const element = {
      tag, children: [], style: {}, attributes: {}, listeners: {}, textContent: "", id: "", parent: null,
      setAttribute(name, value) { this.attributes[name] = value; },
      append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; },
    };
    return element;
  };
  const body = make("body");
  const find = (node, id) => (node.id === id ? node : node.children.map((child) => find(child, id)).find(Boolean) ?? null);
  return { body, createElement: make, getElementById: (id) => find(body, id) };
};
const texts = (node) => [node.textContent, ...node.children.flatMap(texts)].filter(Boolean);
const findText = (node, text) => (node.textContent === text ? node : node.children.map((child) => findText(child, text)).find(Boolean) ?? null);

test("the notice says where the file went, keeps the file name out of translation, and offers Share", () => {
  globalThis.document = fakeDocument();
  let shared = 0;
  showSavedNotice({ fileName: "game-1-game.zip", onShare: () => { shared += 1; } });
  const notice = document.getElementById("oh-saved-notice");
  assert.ok(notice, "the notice is on the page");
  assert.equal(notice.attributes.role, "status");
  assert.deepEqual(texts(notice), ["Saved to your Downloads folder", "Open Historia / game-1-game.zip", "Share", "✕"]);
  assert.equal("data-no-translate" in findText(notice, "Open Historia / game-1-game.zip").attributes, true);
  findText(notice, "Share").listeners.click();
  assert.equal(shared, 1);
  assert.equal(document.getElementById("oh-saved-notice"), null, "sharing closes the notice");

  showSavedNotice({ fileName: "a.zip" });
  assert.equal(findText(document.getElementById("oh-saved-notice"), "Share"), null, "no Share button without a share sheet");
  findText(document.getElementById("oh-saved-notice"), "✕").listeners.click();
  assert.equal(document.getElementById("oh-saved-notice"), null);
  delete globalThis.document;
});
