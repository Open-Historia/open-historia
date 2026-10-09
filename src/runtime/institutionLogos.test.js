import test from "node:test";
import assert from "node:assert/strict";

import {
  BUILTIN_INSTITUTION_LOGOS,
  institutionLogoUrl,
  normalizeInstitutionLogoUrl,
} from "./institutionLogos.js";
import { applyInstitutionUpdates, normalizeInstitutionRecord } from "./institutions.js";
import { EARTH_HISTORY_INSTITUTION_REFERENCE_CATALOG } from "../data/institutionReferencePacks/earthHistory.js";

test("current Fault Lines historical institutions resolve authentic artwork from explicit badgeKey", () => {
  const currentSaveBadgeKeys = [
    "nato", "eu", "csto", "cis", "visegrad", "asean", "au", "gcc",
    "osce", "un", "arab-league", "brics", "sco", "opec", "oecd", "wto", "mercosur",
  ];

  for (const badgeKey of currentSaveBadgeKeys) {
    const url = institutionLogoUrl({ badgeKey });
    assert.equal(url, BUILTIN_INSTITUTION_LOGOS[badgeKey], `${badgeKey} should resolve through the curated artwork catalog`);
    assert.match(url, /^https:\/\//, `${badgeKey} should use source artwork rather than an OpenHistoria redraw`);
  }

  assert.equal(Object.keys(BUILTIN_INSTITUTION_LOGOS).length, currentSaveBadgeKeys.length);
  assert.equal(institutionLogoUrl({ name: "North Atlantic Treaty Organization" }), "");
});

test("scenario-authored logoUrl overrides built-in badge artwork", () => {
  const custom = "/scenario-assets/institutions/alternate-nato.png";
  assert.equal(institutionLogoUrl({ badgeKey: "nato", logoUrl: custom }), custom);
  assert.equal(institutionLogoUrl({ badgeKey: "eu", emblemUrl: "logos/my-union.svg" }), "logos/my-union.svg");
});

test("institution logo URL normalization rejects executable/non-image schemes", () => {
  assert.equal(normalizeInstitutionLogoUrl("javascript:alert(1)"), "");
  assert.equal(normalizeInstitutionLogoUrl("data:text/html,<script>alert(1)</script>"), "");
  assert.equal(normalizeInstitutionLogoUrl("https://example.test/logo.svg"), "https://example.test/logo.svg");
  assert.equal(normalizeInstitutionLogoUrl("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  assert.equal(normalizeInstitutionLogoUrl("data:image/svg+xml,<svg></svg>"), "");
  assert.equal(normalizeInstitutionLogoUrl("blob:https://example.test/temporary"), "");
});

test("canonical institution normalization preserves a scenario-authored logo", () => {
  const institution = normalizeInstitutionRecord({
    id: "custom-league",
    name: "Custom League",
    shortName: "CL",
    badgeKey: "custom-league",
    logoUrl: "/scenario-assets/custom-league.svg",
    members: [],
  });
  assert.equal(institution.logoUrl, "/scenario-assets/custom-league.svg");
});


test("historical reference institutions opt into curated authentic artwork through structured badgeKey", () => {
  const byKey = new Map(EARTH_HISTORY_INSTITUTION_REFERENCE_CATALOG.map((entry) => [entry.badgeKey, entry]));
  assert.equal(institutionLogoUrl(byKey.get("eu")), BUILTIN_INSTITUTION_LOGOS.eu);
  assert.equal(institutionLogoUrl(byKey.get("nato")), BUILTIN_INSTITUTION_LOGOS.nato);
  assert.equal(institutionLogoUrl(byKey.get("csto")), BUILTIN_INSTITUTION_LOGOS.csto);
  assert.equal(institutionLogoUrl(byKey.get("un")), BUILTIN_INSTITUTION_LOGOS.un);
  assert.equal(institutionLogoUrl(byKey.get("osce")), BUILTIN_INSTITUTION_LOGOS.osce);
});

test("scenario-created institutions persist custom logoUrl through the canonical institution owner", () => {
  const result = applyInstitutionUpdates({
    world: { institutions: { schemaVersion: 1, ledgerVersion: 0, byId: {} } },
    updates: [{
      id: "northern-league",
      op: "create",
      name: "Northern League",
      shortName: "NL",
      kind: "regional_bloc",
      logoUrl: "/scenario-assets/institutions/northern-league.svg",
    }],
    allowUnboundBaseline: true,
    stopDate: "2014-01-01",
  });
  assert.equal(result.error, "");
  assert.equal(result.institutions.byId["northern-league"].logoUrl, "/scenario-assets/institutions/northern-league.svg");
});

test("scenario-uploaded institution artwork resolves through the runtime asset route", () => {
  const institution = normalizeInstitutionRecord({
    id: "northern-league",
    name: "Northern League",
    logoAsset: true,
    members: [],
  });
  assert.equal(institution.logoAsset, true);
  assert.equal(institutionLogoUrl(institution), "/api/runtime/institution-logo/northern-league");
});
