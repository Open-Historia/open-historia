/*! Open Historia — the diplomatic map's four views © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The diplomatic map shows the political world in one of four views, each a
// colour for every country, a legend of what is on the map with how many
// countries are in each, a short line for the tooltip, and what is laid over
// the fills (hatching, an outline, the lines from a capital, the borders where
// belligerents meet):
//
//   relations   every country by its standing with the focus country
//               (diplomaticStance.js), the focus being the player's or any
//               country the player clicks
//   wars        every war in the world, each side in a colour of its own,
//               ceasefires hatched, its fronts' borders lit
//   blocs       one institution's members by their standing in it, the whole
//               of its members' land outlined as one area
//   government  how each country is governed, by an enum the Political World
//               records (regime, representation, the ruling party's ideology
//               family, its power tier); puppets in their overlord's colour,
//               hatched; occupied land hatched
//
// Only public records are read: what a country's people, press and neighbours
// can see. A Political World record's disposition, pressures, traits and
// perceptions are never read (politicalKnowledge.js keeps them private), and
// nothing is decided by reading the words of a name or a description.
//
// Pure: no IO. useDiplomaticView.js computes one view for the whole map.

import {
  BLOC_COLORS,
  DIPLO_UNKNOWN,
  IDEOLOGY_COLORS,
  POWER_COLORS,
  REGIME_COLORS,
  RELATION_COLORS,
  REPRESENTATION_COLORS,
  WAR_SIDE_COLORS,
  WAR_SIDE_OVERFLOW,
  puppetShade,
} from "./diplomaticPalette.js";
import { RELATION_PRECEDENCE, buildDiplomaticStanceMap, diplomaticKeyOf } from "./diplomaticStance.js";
import { IDEOLOGIES } from "./politics.js";
import { livePuppetsFor } from "./puppets.js";

export const DIPLOMATIC_VIEWS = Object.freeze(["relations", "wars", "blocs", "government"]);
export const GOVERNMENT_AXES = Object.freeze(["regime", "representation", "ideology", "power"]);

export const DIPLOMATIC_VIEW_LABELS = Object.freeze({
  relations: "Relations",
  wars: "Wars",
  blocs: "Blocs",
  government: "Government",
});
export const GOVERNMENT_AXIS_LABELS = Object.freeze({
  regime: "Regime",
  representation: "Representation",
  ideology: "Ideology",
  power: "Power",
});

export const RELATION_CATEGORY_LABELS = Object.freeze({
  self: "Focus country",
  overlord: "Overlord",
  puppet: "Puppet",
  war: "At war",
  ceasefire: "Ceasefire",
  alliance: "Alliance",
  guarantee: "Guarantee",
  nonAggression: "Non-aggression",
  peace: "Peace settlement",
  access: "Military access",
  friendly: "Friendly",
  trade: "Trade",
  agreement: "Other treaty",
  cordial: "Cordial",
  neutral: "Neutral",
  cautious: "Cautious",
  strained: "Strained",
  hostile: "Hostile",
  rival: "Rival",
  unknown: "No record",
});
export const AGREEMENT_TYPE_LABELS = Object.freeze({
  alliance: "Alliance",
  mutual_defense: "Mutual defence",
  military_cooperation: "Military cooperation",
  guarantee: "Guarantee",
  non_aggression: "Non-aggression pact",
  neutrality: "Neutrality pact",
  peace_settlement: "Peace settlement",
  military_access: "Military access",
  friendship_consultation: "Friendship treaty",
  trade_economic: "Trade agreement",
  other: "Treaty",
});
export const INSTITUTION_TIE_LABELS = Object.freeze({
  security_alliance: "Mutual defence",
  defense_pact: "Defence pact",
  political_union: "Political union",
  economic_union: "Economic union",
});
export const PUPPET_TIE_LABELS = Object.freeze({
  overlord: "Overlord",
  puppet: "Puppet",
  satellite: "Satellite",
  protectorate: "Protectorate",
  client: "Client state",
});
export const WAR_TIE_LABELS = Object.freeze({
  active: "At war",
  ceasefire: "Ceasefire",
  ally: "Fighting alongside",
  none: "Not at war",
});
export const BLOC_STATUS_LABELS = Object.freeze({
  member: "Member",
  associate: "Associate",
  participant: "Participant",
  candidate: "Candidate",
  observer: "Observer",
  suspended: "Suspended",
  none: "Not a member",
});
export const REGIME_LABELS = Object.freeze({
  democratic: "Democratic",
  hybrid: "Hybrid",
  authoritarian: "Authoritarian",
  totalitarian: "Totalitarian",
  theocratic: "Theocratic",
  military: "Military",
  colonial: "Colonial",
  other: "Other",
  unknown: "No record",
});
export const REPRESENTATION_LABELS = Object.freeze({
  electoral: "Elections",
  court_factions: "Court factions",
  party_state: "One party",
  elite_factions: "Elite factions",
  military_factions: "Military factions",
  revolutionary_factions: "Revolutionary factions",
  colonial: "Colonial",
  none: "None",
  unknown: "No record",
});
export const POWER_LABELS = Object.freeze({
  "major-power": "Major power",
  "regional-power": "Regional power",
  "minor-power": "Minor power",
  unknown: "No record",
});
export const HATCH_LABELS = Object.freeze({
  ceasefire: "Ceasefire",
  puppet: "Puppet, in its overlord's colour",
  occupied: "Occupied land",
  candidate: "Candidate",
  suspended: "Suspended",
});
// What wins when a pair has several ties (the legend's hover, never a paragraph).
export const PRECEDENCE_TOOLTIP = "The strongest tie is shown: war, ceasefire, alliance, guarantee, non-aggression, peace, access, friendship, trade, then relations.";

// The ground a hatch-only legend entry's swatch shows its lines on: no country
// is filled with it, the marking is what the entry means.
const HATCH_SWATCH = "#8f897a";
const IDEOLOGY_LABELS = Object.freeze(Object.fromEntries([...IDEOLOGIES.map((entry) => [entry.id, entry.name]), ["unknown", "No record"]]));
const BLOC_STATUSES = ["member", "associate", "participant", "candidate", "observer", "suspended"];
// The members whose land is one area, outlined.
const BLOC_AREA_STATUSES = new Set(["member", "associate", "participant"]);
const BLOC_HATCHED = new Set(["candidate", "suspended"]);

const GOVERNMENT_TABLES = Object.freeze({
  regime: { colors: REGIME_COLORS, labels: REGIME_LABELS, valueOf: (actor) => actor?.regimeCharacter },
  representation: { colors: REPRESENTATION_COLORS, labels: REPRESENTATION_LABELS, valueOf: (actor) => actor?.representation },
  ideology: { colors: IDEOLOGY_COLORS, labels: IDEOLOGY_LABELS, valueOf: (actor) => actor?.ideologyFamily },
  power: { colors: POWER_COLORS, labels: POWER_LABELS, valueOf: (_actor, tier) => tier },
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const normalizeDiplomaticView = (value) => (DIPLOMATIC_VIEWS.includes(value) ? value : "relations");
export const normalizeGovernmentAxis = (value) => (GOVERNMENT_AXES.includes(value) ? value : "regime");

// The institutions still standing, the largest first.
export const standingInstitutionsOf = (institutions) => asArray(institutions)
  .filter((institution) => institution && clean(institution.id) && lower(institution.status) !== "dissolved")
  .map((institution) => ({
    ...institution,
    members: asArray(institution.members).filter((member) => clean(member?.polity)),
  }))
  .sort((a, b) => b.members.length - a.members.length || clean(a.shortName || a.name).localeCompare(clean(b.shortName || b.name)));

export const institutionLabelOf = (institution) => clean(institution?.shortName || institution?.name || institution?.id);

// The institution the Blocs view opens on: the largest the player is a member of, or none.
export const defaultInstitutionId = (institutions, playerCountry) => {
  const player = diplomaticKeyOf(playerCountry);
  if (!player) return "";
  const own = standingInstitutionsOf(institutions).find((institution) => institution.members
    .some((member) => diplomaticKeyOf(member.polity) === player && lower(member.status || "member") === "member"));
  return own ? clean(own.id) : "";
};

// The wars on the map: active ones first, then ceasefires, the largest first.
export const liveWarsOf = (wars) => asArray(wars)
  .filter((war) => ["active", "ceasefire"].includes(lower(war?.status)))
  .map((war) => ({
    id: clean(war.id) || `${asArray(war.sideA).join("+")}|${asArray(war.sideB).join("+")}`,
    title: clean(war.title),
    status: lower(war.status),
    sides: [asArray(war.sideA).map(clean).filter(Boolean), asArray(war.sideB).map(clean).filter(Boolean)],
  }))
  .filter((war) => war.sides[0].length && war.sides[1].length)
  .sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1)
    || (b.sides[0].length + b.sides[1].length) - (a.sides[0].length + a.sides[1].length)
    || (a.title || a.sides[0][0]).localeCompare(b.title || b.sides[0][0]));

export const warSideColors = (index) => WAR_SIDE_COLORS[index] ?? WAR_SIDE_OVERFLOW;

// A war's name as the legend writes it: its title, else its leading belligerents.
export const warLabelOf = (war) => war?.title || `${war?.sides?.[0]?.[0] ?? ""} – ${war?.sides?.[1]?.[0] ?? ""}`;

// The owners on the map, one name a country (the first spelling met), keyed as
// every view keys a country.
const landedByKey = (landedOwners) => {
  const byKey = new Map();
  for (const owner of asArray(landedOwners)) {
    const name = clean(owner);
    const key = diplomaticKeyOf(name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(name);
  }
  return byKey;
};

// The pair a border segment between two owners carries (politicalBoundaryTopology.js
// ownerKey: the two names, sorted, joined by U+001F).
export const boundaryPairKey = (a, b) => [clean(a), clean(b)].sort().join("\u001f");

// The views' puppets: the arrangements standing, as the player may see them.
const visiblePuppets = (puppets, playerCountry) => (clean(playerCountry)
  ? livePuppetsFor({ puppets: asArray(puppets) }, clean(playerCountry))
  : []);

const politicalOf = (politicalActors, key) => (isRecord(politicalActors) ? politicalActors[key] : null) ?? null;

// Assembles a view. `info` is (key) => { category, color, why, hatch? }; the
// legend's entries are counted over the landed countries, in `order`, each in
// its category's own colour (`colorOf`) with every shade drawn in it
// (`colors`, which the legend's highlight matches the map's fills against).
const assemble = ({ view, landed, info, order, labels, colorOf = null, extra = {} }) => {
  const cache = new Map();
  const infoOfKey = (key) => {
    let found = cache.get(key);
    if (!found) {
      found = info(key);
      cache.set(key, found);
    }
    return found;
  };
  const counts = new Map();
  const shades = new Map();
  const hatched = new Map();
  for (const key of landed.keys()) {
    const { category, color, hatch } = infoOfKey(key);
    counts.set(category, (counts.get(category) ?? 0) + 1);
    if (!shades.has(category)) shades.set(category, new Set());
    shades.get(category).add(color);
    // A category hatched as a whole (a ceasefire, a candidate), not a country's own marking.
    if (hatch && hatch !== "puppet") hatched.set(category, hatch);
  }
  const entries = order
    .filter((category) => counts.get(category))
    .map((category) => {
      const colors = [...shades.get(category)];
      return {
        id: category,
        label: labels[category] ?? category,
        color: colorOf?.(category) ?? colors[0],
        colors,
        count: counts.get(category),
        ...(hatched.has(category) ? { hatch: hatched.get(category) } : {}),
      };
    });
  return {
    view,
    infoOf: (owner) => infoOfKey(diplomaticKeyOf(owner)),
    colorOf: (owner) => infoOfKey(diplomaticKeyOf(owner)).color,
    legend: { entries },
    ...extra,
  };
};

const relationsView = ({ world, landed, focusCountry, playerCountry }) => {
  const stances = buildDiplomaticStanceMap({
    focusCountry,
    playerCountry,
    wars: world.wars,
    agreements: world.agreements,
    relations: world.relations,
    puppets: world.puppets,
    institutions: world.institutions,
  });
  const focusKey = stances?.focusKey ?? "";
  const info = (key) => {
    const stance = (key && stances?.byKey.get(key)) || { category: "unknown", why: null };
    return {
      category: stance.category,
      color: RELATION_COLORS[stance.category] ?? DIPLO_UNKNOWN,
      why: stance.why,
      ...(stance.category === "ceasefire" ? { hatch: "ceasefire" } : {}),
    };
  };
  const lines = [];
  const frontPairs = [];
  const focusOwners = landed.get(focusKey) ?? [];
  if (stances) {
    for (const [key, stance] of stances.byKey) {
      if (key === focusKey || !landed.has(key)) continue;
      const kind = stance.category === "war" ? "war"
        : stance.category === "ceasefire" ? "ceasefire"
          : ["alliance", "guarantee", "overlord", "puppet"].includes(stance.category) ? "ally" : "";
      if (!kind) continue;
      lines.push({ kind, toKey: key, to: landed.get(key)[0], rank: RELATION_PRECEDENCE.indexOf(stance.category) });
      if (kind !== "ally") for (const own of focusOwners) for (const their of landed.get(key)) frontPairs.push(boundaryPairKey(own, their));
    }
  }
  // Every war and ceasefire first, then the closest allies; never a thicket.
  lines.sort((a, b) => a.rank - b.rank || a.to.localeCompare(b.to));
  const enemies = lines.filter((line) => line.kind !== "ally");
  const allies = lines.filter((line) => line.kind === "ally").slice(0, 40);
  return assemble({
    view: "relations",
    landed,
    info,
    order: RELATION_PRECEDENCE,
    labels: RELATION_CATEGORY_LABELS,
    colorOf: (category) => RELATION_COLORS[category],
    extra: {
      focusKey,
      focusName: stances?.focusName ?? "",
      focusOwners,
      lines: [...enemies.slice(0, 60), ...allies].map(({ kind, to }) => ({ kind, from: focusOwners[0] ?? stances?.focusName ?? "", to })),
      frontPairs: [...new Set(frontPairs)],
    },
  });
};

const warsView = ({ world, landed, focusWarId }) => {
  const wars = liveWarsOf(world.wars).map((war, index) => ({ ...war, colors: warSideColors(index) }));
  const ordered = focusWarId ? [...wars.filter((war) => war.id === focusWarId), ...wars.filter((war) => war.id !== focusWarId)] : wars;
  // Each belligerent's colour comes from its first war in that order.
  const sideOf = new Map();
  const allWarsOf = new Map();
  for (const war of ordered) {
    war.sides.forEach((names, side) => {
      for (const name of names) {
        const key = diplomaticKeyOf(name);
        if (!key) continue;
        if (!sideOf.has(key)) sideOf.set(key, { war, side });
        if (!allWarsOf.has(key)) allWarsOf.set(key, []);
        allWarsOf.get(key).push({ war, side });
      }
    });
  }
  const info = (key) => {
    const at = sideOf.get(key);
    if (!at) return { category: "none", color: DIPLO_UNKNOWN, why: null };
    return {
      category: `${at.war.id}#${at.side}`,
      color: at.war.colors[at.side],
      why: { kind: "war", wars: allWarsOf.get(key).map(({ war, side }) => ({ id: war.id, title: warLabelOf(war), status: war.status, side })) },
      ...(at.war.status === "ceasefire" ? { hatch: "ceasefire" } : {}),
    };
  };
  const frontPairs = [];
  for (const war of focusWarId ? wars.filter((entry) => entry.id === focusWarId) : wars) {
    for (const a of war.sides[0]) for (const b of war.sides[1]) {
      for (const ownA of landed.get(diplomaticKeyOf(a)) ?? []) for (const ownB of landed.get(diplomaticKeyOf(b)) ?? []) frontPairs.push(boundaryPairKey(ownA, ownB));
    }
  }
  const built = assemble({ view: "wars", landed, info, order: [], labels: {} });
  const countOf = (war, side) => [...landed.keys()].filter((key) => info(key).category === `${war.id}#${side}`).length;
  const notAtWar = [...landed.keys()].filter((key) => info(key).category === "none").length;
  return {
    ...built,
    legend: {
      entries: notAtWar ? [{ id: "none", label: WAR_TIE_LABELS.none, color: DIPLO_UNKNOWN, colors: [DIPLO_UNKNOWN], count: notAtWar }] : [],
      wars: wars.map((war) => ({
        id: war.id,
        label: warLabelOf(war),
        status: war.status,
        colors: [...war.colors],
        sides: war.sides.map((names, side) => ({ names, color: war.colors[side], count: countOf(war, side) })),
      })),
    },
    focusWarId: focusWarId && wars.some((war) => war.id === focusWarId) ? focusWarId : "",
    frontPairs: [...new Set(frontPairs)],
    lines: [],
  };
};

const blocsView = ({ world, landed, institutionId }) => {
  const institutions = standingInstitutionsOf(world.institutions);
  const institution = institutions.find((entry) => clean(entry.id) === clean(institutionId)) ?? null;
  const statusOf = new Map();
  for (const member of institution?.members ?? []) {
    const key = diplomaticKeyOf(member.polity);
    const status = lower(member.status || "member");
    if (key && BLOC_STATUSES.includes(status) && !statusOf.has(key)) statusOf.set(key, status);
  }
  const name = institutionLabelOf(institution);
  const info = (key) => {
    const status = statusOf.get(key) ?? "none";
    return {
      category: status,
      color: BLOC_COLORS[status] ?? DIPLO_UNKNOWN,
      why: status === "none" ? null : { kind: "bloc", institution: name, status },
      ...(BLOC_HATCHED.has(status) ? { hatch: status } : {}),
      ...(BLOC_AREA_STATUSES.has(status) ? { area: name } : {}),
    };
  };
  return assemble({
    view: "blocs",
    landed,
    info,
    order: [...BLOC_STATUSES, "none"],
    labels: BLOC_STATUS_LABELS,
    colorOf: (status) => BLOC_COLORS[status],
    extra: {
      institutionId: institution ? clean(institution.id) : "",
      institutionName: name,
      institutions: institutions.map((entry) => ({ id: clean(entry.id), label: institutionLabelOf(entry), members: entry.members.length })),
      noInstitutions: institutions.length === 0,
      lines: [],
      frontPairs: [],
    },
  });
};

const governmentView = ({ world, landed, axis, playerCountry }) => {
  const table = GOVERNMENT_TABLES[axis] ?? GOVERNMENT_TABLES.regime;
  const actors = isRecord(world.politicalActors) ? world.politicalActors : {};
  const tiers = isRecord(world.powerStatus) ? world.powerStatus : {};
  const valueOf = (key) => {
    const raw = lower(table.valueOf(politicalOf(actors, key), tiers[key]));
    // An enum the table knows, or nothing: a value is never read for its words.
    const value = Object.hasOwn(table.colors, raw) ? raw : (Object.keys(table.colors).find((id) => id.toLowerCase() === raw) ?? "");
    return value || "unknown";
  };
  const overlordOf = new Map();
  for (const row of visiblePuppets(world.puppets, playerCountry)) {
    const puppet = diplomaticKeyOf(row.puppet);
    if (puppet && !overlordOf.has(puppet)) overlordOf.set(puppet, { key: diplomaticKeyOf(row.overlord), name: clean(row.overlord), kind: row.kind });
  }
  const info = (key) => {
    const overlord = overlordOf.get(key);
    // A puppet is drawn in a shade of its overlord's kind, and counted with it.
    if (overlord?.key && overlord.key !== key) {
      const value = valueOf(overlord.key);
      return {
        category: value,
        color: puppetShade(table.colors[value] ?? DIPLO_UNKNOWN),
        why: { kind: "puppet-of", overlord: overlord.name, puppetKind: overlord.kind, value: valueOf(key) },
        hatch: "puppet",
      };
    }
    const value = valueOf(key);
    return { category: value, color: table.colors[value] ?? DIPLO_UNKNOWN, why: { kind: "government", value } };
  };
  const built = assemble({ view: "government", landed, info, order: Object.keys(table.colors), labels: table.labels, colorOf: (value) => table.colors[value] });
  const puppets = [...landed.keys()].map((key) => built.infoOf(landed.get(key)[0])).filter((found) => found.hatch === "puppet");
  const puppetCount = puppets.length;
  // Land held by another than its lawful sovereign, counted in regions.
  const sovereigns = isRecord(world.regionSovereigntyOverrides) ? world.regionSovereigntyOverrides : {};
  const holders = isRecord(world.regionOwnershipOverrides) ? world.regionOwnershipOverrides : {};
  const occupiedCount = Object.entries(sovereigns)
    .filter(([regionId, sovereign]) => holders[regionId] && diplomaticKeyOf(holders[regionId]) !== diplomaticKeyOf(sovereign))
    .length;
  return {
    ...built,
    axis,
    legend: {
      entries: [
        ...built.legend.entries,
        ...(puppetCount ? [{ id: "hatch:puppet", label: HATCH_LABELS.puppet, hatch: "puppet", color: HATCH_SWATCH, colors: [...new Set(puppets.map((found) => found.color))], count: puppetCount }] : []),
        ...(occupiedCount ? [{ id: "hatch:occupied", label: HATCH_LABELS.occupied, hatch: "occupied", color: HATCH_SWATCH, colors: [], count: occupiedCount, unit: "regions" }] : []),
      ],
    },
    lines: [],
    frontPairs: [],
    occupation: true,
  };
};

/**
 * One view of the diplomatic map.
 * @param world  the map store's slices (useWorldState.js): wars, agreements, relations, puppets,
 *               institutions, politicalActors (public fields, keyed by diplomaticKeyOf),
 *               powerStatus (tier keyed the same way), regionSovereigntyOverrides
 * @param landedOwners  the owners of the map's land, for the legend's counts
 */
export const buildDiplomaticView = ({
  view = "relations",
  focusCountry = "",
  playerCountry = "",
  institutionId = "",
  governmentAxis = "regime",
  focusWarId = "",
  world = {},
  landedOwners = [],
} = {}) => {
  const landed = landedByKey(landedOwners);
  const shown = normalizeDiplomaticView(view);
  let built;
  if (shown === "wars") built = warsView({ world, landed, focusWarId });
  else if (shown === "blocs") built = blocsView({ world, landed, institutionId });
  else if (shown === "government") built = governmentView({ world, landed, axis: normalizeGovernmentAxis(governmentAxis), playerCountry });
  else built = relationsView({ world, landed, focusCountry: focusCountry || playerCountry, playerCountry });
  const sovereigns = isRecord(world.regionSovereigntyOverrides) ? world.regionSovereigntyOverrides : {};
  // What is hatched over a region: its country's marking, or, in the
  // Government view, land held by another than its lawful sovereign.
  const hatchOf = (owner, regionId) => {
    if (built.occupation) {
      const sovereign = sovereigns[regionId];
      if (sovereign && diplomaticKeyOf(sovereign) !== diplomaticKeyOf(owner)) return "occupied";
    }
    return built.infoOf(owner).hatch ?? "";
  };
  return { ...built, hatchOf, areaOf: (owner) => built.infoOf(owner).area ?? "" };
};

// The tooltip's short line for one country: [what, detail], both shown as written.
export const diplomaticTieOf = (diplomaticView, owner) => {
  if (!diplomaticView || !owner) return null;
  const { category, why } = diplomaticView.infoOf(owner);
  if (diplomaticView.view === "relations") {
    if (category === "self") return [RELATION_CATEGORY_LABELS.self, ""];
    if (!why) return [RELATION_CATEGORY_LABELS.unknown, ""];
    if (why.kind === "active" || why.kind === "ceasefire") return [WAR_TIE_LABELS[why.kind], why.war?.title || ""];
    if (why.kind === "ally-in-war") return [WAR_TIE_LABELS.ally, why.war?.title || ""];
    if (why.kind === "agreement") return [AGREEMENT_TYPE_LABELS[why.type] ?? AGREEMENT_TYPE_LABELS.other, why.title || ""];
    if (why.kind === "institution") return [INSTITUTION_TIE_LABELS[why.institutionKind] ?? RELATION_CATEGORY_LABELS[category], why.institution];
    if (why.kind === "overlord" || why.kind === "puppet") return [PUPPET_TIE_LABELS[why.kind], PUPPET_TIE_LABELS[why.puppetKind] ?? ""];
    if (why.kind === "relation") return [RELATION_CATEGORY_LABELS[why.band] ?? why.band, Number.isFinite(why.score) ? `${why.score > 0 ? "+" : why.score < 0 ? "−" : ""}${Math.abs(why.score)}` : ""];
    return [RELATION_CATEGORY_LABELS[category] ?? category, ""];
  }
  if (diplomaticView.view === "wars") {
    if (!why?.wars?.length) return [WAR_TIE_LABELS.none, ""];
    const first = why.wars[0];
    return [first.status === "ceasefire" ? WAR_TIE_LABELS.ceasefire : WAR_TIE_LABELS.active, why.wars.map((war) => war.title).join(" · ")];
  }
  if (diplomaticView.view === "blocs") {
    if (!why) return [BLOC_STATUS_LABELS.none, diplomaticView.institutionName || ""];
    return [BLOC_STATUS_LABELS[why.status] ?? why.status, why.institution];
  }
  const labels = GOVERNMENT_TABLES[diplomaticView.axis]?.labels ?? REGIME_LABELS;
  if (why?.kind === "puppet-of") return [PUPPET_TIE_LABELS.puppet, why.overlord];
  return [labels[why?.value] ?? labels.unknown, ""];
};
