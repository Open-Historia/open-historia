/*! Open Historia — a polity is found by its own names, exactly: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/polityIdentityExact.test.js
//
// resolvePolityIdentity used to strip English regime words ("Kingdom of",
// "Republic", "Empire") from a name and match what was left: "Republic of
// China" resolved to China with Taiwan declared beside it, and a name in any
// other language matched nothing, since the words and the a-z fold were
// English. A polity now answers to its key, code, name, aliases, former names
// and declared map references, under the one name fold (server/nameKey.js),
// and to nothing else, the same in every language.

import test from "node:test";
import assert from "node:assert/strict";

import { resolvePolityIdentity } from "./polityIdentity.js";

const strict = { allowUnknown: false };
const resolved = (token, world, options = strict) => resolvePolityIdentity(token, world, options).resolved;

test("no regime word is stripped: a name means the polity of that name, in every language", () => {
  const english = {
    polityOverrides: {
      "Republic of China": { name: "Republic of China", status: "active" },
      "People's Republic of China": { name: "People's Republic of China", status: "active" },
      "Kingdom of Greece": { name: "Kingdom of Greece", status: "active" },
    },
  };
  assert.equal(resolved("Republic of China", english), "Republic of China");
  assert.equal(resolved("PEOPLE'S REPUBLIC OF CHINA", english), "People's Republic of China");
  // The stock country stays the stock country; it never becomes a declared
  // polity that merely contains its name.
  assert.equal(resolvePolityIdentity("China", english, strict).status, "stock-base");
  assert.equal(resolvePolityIdentity("Greece", english, strict).status, "stock-base");
  assert.equal(resolved("Greece", english, { ...strict, allowStockBase: false }), "");

  const russian = {
    polityOverrides: {
      "Китайская Республика": { name: "Китайская Республика", status: "active" },
      "Королевство Греция": { name: "Королевство Греция", status: "active" },
    },
  };
  assert.equal(resolved("КИТАЙСКАЯ РЕСПУБЛИКА", russian), "Китайская Республика");
  assert.equal(resolved("Китай", russian), "", "a part of a name is not the name");
  assert.equal(resolved("Греция", russian), "");
});

test("a polity named in another script is found, as its English twin is", () => {
  for (const [name, written] of [["Russia", "RUSSIA"], ["Россия", "РОССИЯ"], ["Россия", "россия"], ["中华民国", " 中华 民国 "], ["مصر", "مصر"]]) {
    const world = { polityOverrides: { [name]: { name, status: "active" } }, regionOwnershipOverrides: { r1: name } };
    const answer = resolvePolityIdentity(written, world, strict);
    assert.equal(answer.status, "exact-declared", `${written}`);
    assert.equal(answer.resolved, name);
  }
});

test("a polity answers to its aliases and former names; its own name comes first", () => {
  const world = {
    polityOverrides: {
      "Third Reich": { name: "Third Reich", aliases: ["Nazi Germany"], formerNames: ["Germany", "Weimar Republic"], status: "active" },
      Germany: { name: "Germany", status: "active" },
      "СССР": { name: "СССР", formerNames: ["Российская империя"], status: "active" },
    },
    regionOwnershipOverrides: { r1: "Third Reich", r2: "Germany", r3: "СССР" },
  };
  assert.equal(resolved("Weimar Republic", world), "Third Reich");
  assert.equal(resolved("nazi germany", world), "Third Reich");
  assert.equal(resolved("Германия", world), "", "a translated name is not a declared name");
  assert.equal(resolved("РОССИЙСКАЯ ИМПЕРИЯ", world), "СССР");
  // "Germany" is a former name of the Reich and the own name of the Germany
  // founded since: the polity that bears it now.
  assert.equal(resolved("Germany", world), "Germany");
});

test("a name with no letters or digits resolves to nobody", () => {
  const world = { polityOverrides: { "Россия": { name: "Россия", status: "active" }, "中国": { name: "中国", status: "active" } } };
  for (const token of ["!!!", "—", "...", "   "]) {
    assert.equal(resolved(token, world), "", JSON.stringify(token));
  }
});
