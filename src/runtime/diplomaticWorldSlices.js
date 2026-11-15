/*! Open Historia — the political world as the map reads it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The parts of the political world the diplomatic map draws, cut down to what
// it reads, so the map store (Map/useWorldState.js) compares a few small
// records each publish instead of the whole Political World:
//
//   institutions      [{ id, name, shortName, kind, status, members: [{ polity, status }] }]
//   politicalActors   { [country key]: { regimeCharacter, representation, ideologyFamily } }
//   powerStatus       { [country key]: tier }
//
// Public fields only. A Political World record's disposition, pressures,
// traits, perceptions, approval and stability are private (politicalKnowledge.js)
// and never leave here; neither does any free text: the map colours by enums.

import { diplomaticKeyOf } from "./diplomaticStance.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const EMPTY = Object.freeze({});
const NONE = Object.freeze([]);

export const institutionsForMap = (institutions) => {
  const byId = isRecord(institutions?.byId) ? institutions.byId : null;
  const rows = byId ? Object.entries(byId).map(([id, row]) => ({ ...row, id: clean(row?.id) || id })) : asArray(institutions);
  const out = rows
    .filter((row) => isRecord(row) && clean(row.id))
    .map((row) => ({
      id: clean(row.id),
      name: clean(row.name),
      shortName: clean(row.shortName),
      kind: lower(row.kind),
      status: lower(row.status) || "active",
      members: asArray(row.members)
        .filter((member) => clean(member?.polity))
        .map((member) => ({ polity: clean(member.polity), status: lower(member.status) || "member" })),
    }));
  return out.length ? out : NONE;
};

// The ruling party's ideology family: an enum id (politics.js IDEOLOGIES), or "".
const rulingFamilyOf = (actor) => {
  const parties = asArray(actor?.parties);
  const rulingIds = new Set(asArray(actor?.government?.rulingPartyIds).map(clean));
  const ruling = parties.find((party) => party?.ruling === true)
    ?? parties.find((party) => rulingIds.has(clean(party?.id)));
  return clean(ruling?.ideologyFamily);
};

export const politicalActorsForMap = (politicalActors) => {
  const byPolity = isRecord(politicalActors?.byPolity) ? politicalActors.byPolity : null;
  if (!byPolity) return EMPTY;
  const out = {};
  for (const [polity, actor] of Object.entries(byPolity)) {
    if (!isRecord(actor)) continue;
    const key = diplomaticKeyOf(clean(actor.polityKey) || polity);
    if (!key || out[key]) continue;
    const row = {
      regimeCharacter: lower(actor.politicalSystem?.regimeCharacter),
      representation: lower(actor.politicalSystem?.representation),
      ideologyFamily: rulingFamilyOf(actor),
    };
    if (row.regimeCharacter || row.representation || row.ideologyFamily) out[key] = row;
  }
  return Object.keys(out).length ? out : EMPTY;
};

// One tier a country. A save may hold two rows for one country under two
// spellings; the one updated last stands.
export const powerTiersForMap = (powerStatus) => {
  const byPolity = isRecord(powerStatus?.byPolity) ? powerStatus.byPolity : null;
  if (!byPolity) return EMPTY;
  const out = {};
  const rounds = {};
  for (const [polity, row] of Object.entries(byPolity)) {
    if (!isRecord(row)) continue;
    const tier = lower(row.tier);
    const key = diplomaticKeyOf(clean(row.polityKey) || polity);
    if (!key || !tier) continue;
    const round = Number(row.lastUpdatedRound) || 0;
    if (out[key] && rounds[key] >= round) continue;
    out[key] = tier;
    rounds[key] = round;
  }
  return Object.keys(out).length ? out : EMPTY;
};

export const sovereigntyOverridesForMap = (value) => {
  if (!isRecord(value)) return EMPTY;
  const out = {};
  for (const [regionId, sovereign] of Object.entries(value)) {
    const name = clean(sovereign);
    if (clean(regionId) && name) out[regionId] = name;
  }
  return Object.keys(out).length ? out : EMPTY;
};
