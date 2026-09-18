import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFutureHistoryBoundaryDirective,
  resolveReferenceKnowledgeBoundary,
} from "./futureHistoryBoundary.js";

const currentWorld = ({ authority = "round-zero-only", divergence = null } = {}) => ({
  canonModelVersion: 2,
  canonContext: {
    universe: { id: "historical-earth", type: divergence ? "alternate" : "historical" },
    referencePacks: [{ id: "earth-history", version: "1.0", enabled: true }],
    referenceAuthority: authority,
    divergence,
  },
});

test("round-zero-only reference authority freezes post-boundary source-canon knowledge at campaign start", () => {
  const resolved = resolveReferenceKnowledgeBoundary({
    world: currentWorld(),
    game: { startDate: "2014-03-22", gameDate: "2014-04-21" },
  });

  assert.equal(resolved.authority, "round-zero-only");
  assert.equal(resolved.horizon, "2014-03-22");
  assert.equal(resolved.startDate, "2014-03-22");
  assert.equal(resolved.inclusive, true);
  assert.equal(resolved.referenceHorizonDate, "2014-03-22");

  const text = buildFutureHistoryBoundaryDirective({
    world: currentWorld(),
    game: { startDate: "2014-03-22", gameDate: "2014-04-21" },
    originDate: "2014-04-21",
  });

  assert.match(text, /admissible only through 2014-03-22/i);
  assert.match(text, /Reaching a later calendar date does NOT make post-boundary source-canon events canonical/i);
  assert.match(text, /MEMORY IS NOT EVIDENCE/i);
  assert.match(text, /numbered resolutions/i);
  assert.match(text, /exact dates/i);
  assert.match(text, /CALENDAR COINCIDENCE IS NOT CAUSALITY/i);
  assert.match(text, /REFERENCE-CAUSAL MOMENTUM means surviving pressures may generate a SIMILAR TYPE/i);
  assert.match(text, /BRANCH AUDIT/i);
});

test("pre-divergence-only authority uses the authored divergence rather than scenario start", () => {
  const world = currentWorld({
    authority: "pre-divergence-only",
    divergence: { date: "1991-08-19", description: "August coup succeeds" },
  });
  const resolved = resolveReferenceKnowledgeBoundary({
    world,
    game: { startDate: "2014-03-22", gameDate: "2014-03-22" },
  });

  assert.equal(resolved.horizon, "1991-08-19");
  assert.equal(resolved.inclusive, false);
  assert.equal(resolved.referenceHorizonDate, "1991-08-18");
  const text = buildFutureHistoryBoundaryDirective({ world, game: { startDate: "2014-03-22" } });
  assert.match(text, /admissible only BEFORE 1991-08-19/i);
  assert.match(text, /1991-08-19 itself/i);
  assert.match(text, /Campaign branch start: 2014-03-22/i);
});

test("no reference authority forbids outside chronology rather than inventing a cutoff", () => {
  const world = currentWorld({ authority: "none" });
  const text = buildFutureHistoryBoundaryDirective({
    world,
    game: { startDate: "2200-01-01", gameDate: "2200-02-01" },
  });

  assert.match(text, /External\/reference chronology has NO runtime authority/i);
  assert.match(text, /scenario-authored and campaign-generated canon/i);
  assert.match(text, /unknown counterfactual future/i);
});

test("legacy campaigns still get a campaign-start anti-railroading boundary", () => {
  const resolved = resolveReferenceKnowledgeBoundary({
    world: {},
    game: { startDate: "1912-01-01", gameDate: "1914-08-01" },
  });

  assert.equal(resolved.authority, "legacy-campaign-start");
  assert.equal(resolved.horizon, "1912-01-01");
  const text = buildFutureHistoryBoundaryDirective({
    world: {},
    game: { startDate: "1912-01-01", gameDate: "1914-08-01" },
  });
  assert.match(text, /admissible only through 1912-01-01/i);
});

test("directive explicitly protects current source-divergent political canon from reference attraction", () => {
  const text = buildFutureHistoryBoundaryDirective({
    world: currentWorld(),
    game: { startDate: "2014-03-22", gameDate: "2014-03-22" },
  });

  assert.match(text, /unusual leader\/party goals or source-divergent state choices/i);
  assert.match(text, /redirect attention and outcomes/i);
  assert.doesNotMatch(text, /prefer the historical outcome/i);
});

test("reference authority dates use Beta's BC-capable game calendar", () => {
  const world = currentWorld({
    authority: "pre-divergence-only",
    divergence: { date: "-0218-03-01", description: "Rome chooses another course" },
  });
  const resolved = resolveReferenceKnowledgeBoundary({
    world,
    game: { startDate: "-0200-01-01", gameDate: "-0199-01-01" },
  });
  assert.equal(resolved.horizon, "-0218-03-01");
  assert.equal(resolved.referenceHorizonDate, "-0218-02-28");
});
