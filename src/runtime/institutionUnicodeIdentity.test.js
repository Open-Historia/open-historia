/*! Open Historia — non-Latin institution/proposal identity regressions. */
import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalInstitutionIdentity,
  normalizeInstitutionProposal,
} from "./institutions.js";

test("canonical institution identity does not disappear for a non-Latin name", () => {
  const identity = canonicalInstitutionIdentity({ name: "Балтийский союз" });
  assert.match(identity.id, /^u-[a-z0-9]+$/);
  assert.equal(identity.name, "Балтийский союз");
});

test("a non-Latin proposal title can supply its own stable fallback id", () => {
  const proposal = normalizeInstitutionProposal({
    title: "Вступление Великобритании в качестве наблюдателя",
    summary: "Предоставить Лондону статус наблюдателя.",
  });
  assert.ok(proposal);
  assert.match(proposal.id, /^u-[a-z0-9]+$/);
  assert.equal(proposal.title, "Вступление Великобритании в качестве наблюдателя");
});
