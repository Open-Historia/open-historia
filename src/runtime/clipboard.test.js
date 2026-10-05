/*! Open Historia — clipboard helper tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/clipboard.test.js
//
// navigator.clipboard is missing on an insecure origin (LAN play over http, the
// Android app). Every copy button goes through copyToClipboard, which falls back
// to execCommand there, and its boolean is what the buttons say "Copied" or
// "Copy failed" by.

import test from "node:test";
import assert from "node:assert/strict";

import { copyToClipboard } from "./clipboard.js";

const fakeDocument = ({ copies = true } = {}) => {
  const copied = [];
  const body = { children: [], appendChild(node) { this.children.push(node); }, removeChild(node) { this.children = this.children.filter((child) => child !== node); } };
  let selected = null;
  globalThis.document = {
    body,
    copied,
    createElement: () => {
      const node = { value: "", style: {}, setAttribute() {}, select() { selected = node; } };
      return node;
    },
    execCommand: (command) => {
      if (command !== "copy" || !copies) return false;
      copied.push(selected?.value);
      return true;
    },
  };
  return globalThis.document;
};

const setNavigator = (value) => {
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
};

test("the clipboard API is used where it exists", async () => {
  const written = [];
  setNavigator({ clipboard: { writeText: async (text) => { written.push(text); } } });
  fakeDocument();
  assert.equal(await copyToClipboard("Kingdom of Hungary"), true);
  assert.deepEqual(written, ["Kingdom of Hungary"]);
});

test("without it (an insecure origin), the text is still copied", async () => {
  setNavigator({});
  const document = fakeDocument();
  assert.equal(await copyToClipboard("Transdanubia"), true);
  assert.deepEqual(document.copied, ["Transdanubia"]);
  assert.equal(document.body.children.length, 0, "the scratch field is removed again");
});

test("a refused API falls back too, and a copy nothing can make says so", async () => {
  setNavigator({ clipboard: { writeText: async () => { throw new Error("NotAllowedError"); } } });
  assert.equal(await copyToClipboard("x"), true, "the fallback copied it");
  setNavigator({});
  fakeDocument({ copies: false });
  assert.equal(await copyToClipboard("x"), false);
});
