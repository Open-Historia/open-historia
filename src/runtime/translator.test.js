// Run: node --test src/runtime/translator.test.js
//
// "The desktop client intercepts and overwrites text inputs through
// translation layers" (a player's report, 2026-11-02). The interface
// translator rewrites rendered text it knows; what a player typed is theirs,
// in the box they typed it in and wherever it is shown afterwards.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { attributesAreSkipped, textIsSkipped } from "./translator.js";

// A stand-in for the DOM: an element is its tag, its attributes and its
// parent, and closest() answers the selector lists the translator uses.
const element = (tag, attributes = {}, parent = null) => {
  const self = {
    tagName: tag.toUpperCase(),
    attributes,
    parentElement: parent,
    matchesOne: (selector) => {
      const attribute = selector.match(/^\[([\w-]+)\]$/);
      return attribute ? Object.hasOwn(attributes, attribute[1]) : selector === tag;
    },
    closest: (list) => {
      const selectors = list.split(",").map((part) => part.trim());
      for (let node = self; node; node = node.parentElement) {
        if (selectors.some((selector) => node.matchesOne(selector))) return node;
      }
      return null;
    },
  };
  return self;
};
const textIn = (parent) => ({ nodeType: 3, parentElement: parent });

test("text a player types is never the translator's: inputs, text areas and editable text", () => {
  const panel = element("div");
  assert.equal(textIsSkipped(textIn(element("textarea", {}, panel))), true);
  assert.equal(textIsSkipped(textIn(element("input", {}, panel))), true);
  assert.equal(textIsSkipped(textIn(element("span", {}, element("div", { contenteditable: "true" }, panel)))), true);
  assert.equal(textIsSkipped(textIn(element("span", {}, panel))), false, "the interface around them still is");
});

test("text shown with data-no-translate is left as written, however deep", () => {
  const order = element("div", { "data-no-translate": "" }, element("div"));
  assert.equal(textIsSkipped(textIn(element("b", {}, order))), true);
  assert.equal(attributesAreSkipped(element("span", { title: "x" }, order)), true);
  // An input's own placeholder is interface text all the same.
  assert.equal(attributesAreSkipped(element("input", { placeholder: "Write an order" }, element("div"))), false);
});

test("a queued order and the Game Master's preview are shown with data-no-translate", () => {
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const actions = read("../Game/GameUI/actions.jsx");
  assert.match(actions, /<div data-no-translate[^>]*>\s*\{normalized\.title\}/);
  assert.match(actions, /<div data-no-translate[^>]*>\s*\{label\}/);
  const console = read("../Game/GameUI/cheats.jsx");
  assert.match(console, /<div data-no-translate[^>]*>\{event\.title\}<\/div>/);
  assert.match(console, /<div data-no-translate[^>]*>\{event\.description\}<\/div>/);
  assert.match(console, /data-no-translate=\{gmPreview\.summary \? "" : undefined\}/);
});
