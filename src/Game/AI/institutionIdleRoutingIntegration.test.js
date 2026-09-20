import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { normalizeGameplayPayload, validateGameplayPayload } from "./gameplaySchemas.js";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("idle diplomacy schema carries an optional shared-institution route", () => {
  const normalized = normalizeGameplayPayload("idleDiplomacy", {
    chat: {
      countries: ["Republic of Lithuania"],
      title: "Baltic cyber coordination",
      openingMessage: "Vilnius proposes we review our joint cyber posture.",
      speaker: "Republic of Lithuania",
    },
    chatInstitutionId: "baltic-union",
    unitOps: [],
    sighting: null,
  });
  assert.equal(validateGameplayPayload("idleDiplomacy", normalized).valid, true);
  assert.equal(normalized.chatInstitutionId, "baltic-union");
});

test("idle diplomacy runtime prefers a valid Council route without giving speech legal authority", () => {
  const gameplay = read("./gameplay.js");
  assert.match(gameplay, /buildIdleInstitutionRoutingContext\(bundle\.world, bundle\.game\.country\)/);
  assert.match(gameplay, /resolveIdleInstitutionRoute/);
  assert.match(gameplay, /commitInstitutionalDiplomaticReply/);
  assert.match(gameplay, /Idle diplomacy routed .* Council instead of Contacts/);
  const routing = read("./institutionIdleRouting.js");
  assert.match(routing, /This only routes conversation; it creates NO proposal, ballot, membership change, or legal outcome/i);
});
