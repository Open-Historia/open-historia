/*! Open Historia — why a region changes hands © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The prose rule has been in the actions reference for a long time: a border
// moves when the other side agreed or when the ground is actually held, and a
// declaration alone is a CLAIM. Prose is the part a model skims. A field it has
// to fill in is the part it answers, so every regionTransfers entry and every
// control operation may now say WHY the land moves, and the engine reads the
// answer: a basis that holds no ground moves no border.
//
// Nothing is thrown away that the map can still show. A transfer whose basis is
// "claim" is what the model meant all along — "X declares Y theirs" — so it
// becomes X's regionClaims entry and the region renders as disputed, which is
// the middle state regionClaims exists for. A threat or a raid asserts nothing
// lasting, so it is dropped and said so.
//
// An entry WITHOUT a basis is applied exactly as it always was. Older payloads,
// the Game Master console, a lenient local backend that ignores the schema and
// every save written before the field existed all reach here without one, and
// this game's history of territorial bugs is of borders that failed to move,
// not of borders that moved too easily. The field earns its keep when a model
// labels a declaration honestly, not by refusing the unlabelled.
//
// Import-free on purpose: the AI schemas (gameplaySchemas.js), the save
// normalizer and the apply path (gameState.js) and the turn validator
// (gameplay.js) all read the vocabulary from here, so it lives in one place
// and tests under bare node.

// Land really changes hands.
export const TERRITORY_BASIS_MOVES_MAP = Object.freeze([
  "treaty",
  "annexation",
  "unification",
  "independence",
  "occupation",
]);

// It does not.
export const TERRITORY_BASIS_NO_CONTROL = Object.freeze([
  "claim",
  "threat",
  "raid",
]);

export const TERRITORY_BASIS_ENUM = Object.freeze([
  ...TERRITORY_BASIS_MOVES_MAP,
  ...TERRITORY_BASIS_NO_CONTROL,
]);

// The schema's own words, kept short on purpose. The jump's tool schema rides on
// every request and has a size budget that a test holds it to
// (projectOpSchema.test.js); the full explanation is TERRITORY_BASIS_DIRECTIVE
// below, which the jump is always given. So the definition is stated once, on
// regionTransfers, and the control operation only points at it.
export const TERRITORY_BASIS_DESCRIPTION =
  "WHY the land moves; the engine reads it. treaty = agreed, or imposed by a peace. "
  + "annexation = formalising land ALREADY held. unification = polities merging. "
  + "independence = a new state actually governing it. occupation = ground physically held. "
  + "claim, threat and raid do NOT move the map: a claim is recorded as a dispute instead.";
export const TERRITORY_BASIS_DESCRIPTION_SHORT = "Why control changes; same words and meaning as regionTransfers.basis.";

const MOVES_MAP = new Set(TERRITORY_BASIS_MOVES_MAP);
const NO_CONTROL = new Set(TERRITORY_BASIS_NO_CONTROL);

// Words a model reaches for that mean one of ours. Anything else is "unknown",
// which is treated as absent rather than guessed at.
const BASIS_SYNONYMS = Object.freeze({
  cession: "treaty",
  ceded: "treaty",
  purchase: "treaty",
  sale: "treaty",
  settlement: "treaty",
  peace: "treaty",
  annexed: "annexation",
  annex: "annexation",
  union: "unification",
  accession: "unification",
  succession: "unification",
  secession: "independence",
  liberation: "occupation",
  capture: "occupation",
  conquest: "occupation",
  occupied: "occupation",
  administration: "occupation",
  handover: "occupation",
  collapse: "occupation",
  declaration: "claim",
  declared: "claim",
  proclamation: "claim",
  decree: "claim",
  claimed: "claim",
  demand: "threat",
  ultimatum: "threat",
  bombardment: "raid",
  incursion: "raid",
});

const clean = (value) => String(value ?? "").trim();

// "" when the entry carries no basis, or one this vocabulary does not know.
export const normalizeTerritoryBasis = (value) => {
  const token = clean(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (!token) return "";
  if (MOVES_MAP.has(token) || NO_CONTROL.has(token)) return token;
  return BASIS_SYNONYMS[token] ?? "";
};

// Absent is allowed (see the header), so only an explicit no-control basis stops
// a border.
export const basisMovesTheMap = (basis) => !NO_CONTROL.has(normalizeTerritoryBasis(basis));
export const basisBecomesClaim = (basis) => normalizeTerritoryBasis(basis) === "claim";

const labelOf = (entry) => clean(entry?.regionName) || clean(entry?.regionId) || "an unnamed region";

// Screens one event's territorial operations. Pure: returns new arrays and the
// list of what it did, so the turn validator can tell the model and the apply
// path can act as the net for impacts that never met the validator. Works on
// raw model output and on normalized ops alike — both spell the fields the same.
//
//   actions[] = { family, outcome: "claimed" | "refused", basis, region, toCode, wholeCountry }
export const screenTerritoryBasis = ({ regionTransfers = [], regionControlOps = [], regionClaims = [] } = {}) => {
  const actions = [];
  const claims = Array.isArray(regionClaims) ? [...regionClaims] : [];

  const hasClaim = (regionId, claimant) => claims.some((claim) =>
    clean(claim?.regionId).toLowerCase() === clean(regionId).toLowerCase()
    && clean(claim?.claimantCode).toLowerCase() === clean(claimant).toLowerCase()
    && claim?.drop !== true);

  const screen = (family, entries, isCandidate) => {
    const kept = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || typeof entry !== "object" || !isCandidate(entry) || basisMovesTheMap(entry.basis)) {
        kept.push(entry);
        continue;
      }
      const basis = normalizeTerritoryBasis(entry.basis);
      const toCode = clean(entry.toCode);
      const wholeCountry = entry.wholeCountry === true;
      // A claim on a whole country has no single region to stripe, and the
      // expansion that would find them belongs to a real transfer. Refused.
      const becomesClaim = basis === "claim" && Boolean(toCode) && !wholeCountry && Boolean(clean(entry.regionId));
      if (becomesClaim && !hasClaim(entry.regionId, toCode)) {
        claims.push({
          claimantCode: toCode,
          note: clean(entry.note) || "Asserted without holding the ground.",
          regionId: clean(entry.regionId),
          regionName: clean(entry.regionName),
        });
      }
      actions.push({
        basis,
        family,
        outcome: becomesClaim ? "claimed" : "refused",
        region: wholeCountry ? `all of ${clean(entry.fromCode) || labelOf(entry)}` : labelOf(entry),
        toCode,
        wholeCountry,
      });
    }
    return kept;
  };

  const transfers = screen("regionTransfers", regionTransfers, () => true);
  // Only a control flip moves the de-facto border. A contest is already the
  // middle state and clear_contest moves nothing toward anyone.
  const controlOps = screen(
    "regionControlOps",
    regionControlOps,
    (entry) => ["control", "control_flip"].includes(clean(entry.op).toLowerCase()),
  );

  return { actions, regionClaims: claims, regionControlOps: controlOps, regionTransfers: transfers };
};

// One model-readable sentence per screened operation.
export const describeBasisAction = (action, { eventTitle = "" } = {}) => {
  const where = eventTitle ? `Event "${eventTitle}": ` : "";
  const what = action.family === "regionControlOps" ? "control of" : "the transfer of";
  const to = action.toCode ? ` to ${action.toCode}` : "";
  if (action.outcome === "claimed") {
    return `${where}${what} ${action.region}${to} carried basis "claim", which moves no border; `
      + `it was recorded as ${action.toCode}'s claim on ${action.region} instead, and the region now shows as disputed.`;
  }
  return `${where}${what} ${action.region}${to} carried basis "${action.basis}", which moves no border; nothing changed on the map.`;
};
