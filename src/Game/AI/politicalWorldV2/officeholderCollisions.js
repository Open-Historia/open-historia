/*! Open Historia Continuum — Political World v2 cross-polity officeholder check
 *
 * The legacy pipeline runs a free, deterministic check after verification: the
 * same named person heading the government of two polities on the same date
 * is almost always a generation error. v2 clears polities in sentinel batches
 * and never revisited a cleared polity, so a world could reach Canonical with
 * one prime minister leading two countries. This re-opens the colliding
 * polities as verification challenges, once per collision, so the exact-date
 * adjudicator re-checks them with the collision spelled out.
 */

import { collisionReviewContextByPolity, crossPolityOfficeholderCollisions } from "../politicalWorldGeneratorCore.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => Array.isArray(value) ? value : [];

const collisionSignature = (collision) => [
  clean(collision?.personKey),
  ...array(collision?.records)
    .map((record) => `${clean(record?.polityKey)}:${clean(record?.role)}:${clean(record?.display)}`)
    .sort(),
].join("|");

// Mutates and returns the checkpoint. Only generated polities are compared
// (authored canon is never challenged), using their current staged actor, and
// only once every polity in a collision has been through verification.
export const reopenPoliticalWorldV2OfficeholderCollisions = (checkpoint, scenarioDate = "") => {
  if (checkpoint?.historicalVerificationRequired !== true) return checkpoint;
  const actors = checkpoint?.stagedWorld?.politicalActors?.byPolity || {};
  const entries = Object.keys(checkpoint?.generationEntriesByPolity || {})
    .map(clean)
    .filter((polity) => polity && actors[polity])
    .map((polityKey) => ({ item: { polityKey }, validation: { actor: actors[polityKey] } }));
  const verified = new Set(array(checkpoint?.coverage?.["historical-verification"]).map(clean).filter(Boolean));
  const collisions = crossPolityOfficeholderCollisions(entries)
    .filter((collision) => collision.polityKeys.every((polity) => verified.has(polity)));
  if (!collisions.length) return checkpoint;

  checkpoint.verification = checkpoint.verification && typeof checkpoint.verification === "object" ? checkpoint.verification : {};
  checkpoint.verification.challenges = checkpoint.verification.challenges && typeof checkpoint.verification.challenges === "object" ? checkpoint.verification.challenges : {};
  const rechecked = new Set(array(checkpoint.verification.officeholderCollisionRechecks).map(clean).filter(Boolean));
  const fresh = [];
  for (const collision of collisions) {
    const signature = collisionSignature(collision);
    if (rechecked.has(signature)) {
      // The adjudicator already re-checked this exact collision with it spelled
      // out and kept it. Failing closed here would block Apply with no way out.
      checkpoint.warnings = [...new Set([...array(checkpoint.warnings), `Officeholder collision kept after a focused exact-date re-check: ${collision.display} (${collision.polityKeys.join(", ")}).`])];
      continue;
    }
    rechecked.add(signature);
    fresh.push(collision);
  }
  checkpoint.verification.officeholderCollisionRechecks = [...rechecked];
  if (!fresh.length) return checkpoint;

  const contextByPolity = collisionReviewContextByPolity(fresh, scenarioDate || checkpoint?.scenarioDate);
  const reopened = new Set();
  for (const collision of fresh) {
    for (const record of collision.records) {
      const polity = clean(record.polityKey);
      const existing = checkpoint.verification.challenges[polity];
      const challengedFacts = [
        ...array(existing?.challengedFacts),
        { id: `collision:${record.role}`, path: `government.${record.role}`, display: record.display },
      ];
      checkpoint.verification.challenges[polity] = {
        polityKey: polity,
        verdict: "challenge",
        status: "challenge",
        issue: contextByPolity[polity] || clean(existing?.issue),
        challengedFacts,
        temporalCorrectionEstablished: false,
        officeholderCollision: true,
      };
      reopened.add(polity);
    }
  }
  checkpoint.coverage["historical-verification"] = [...verified].filter((polity) => !reopened.has(polity));
  return checkpoint;
};
