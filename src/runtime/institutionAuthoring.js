/*! Open Historia Continuum — scenario-authoring helpers for canonical institutions. */

import {
  INSTITUTION_KINDS,
  normalizeInstitutionRecord,
  normalizeInstitutions,
} from "./institutions.js";
import { normalizeInstitutionLogoUrl } from "./institutionLogos.js";
import { collectScenarioPoliticalPolities } from "./scenarioPolities.js";

const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLocaleLowerCase();

export const institutionAuthoringId = (value) => clean(value)
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 96);

const uniqueText = (value) => {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[\n,;]+/g);
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const next = clean(entry);
    const key = lower(next);
    if (!next || seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
};

// The member list, one polity per line. Polity names are exact keys and may
// hold commas ("Bonaire, Sint Eustatius and Saba"), so it never splits on them.
export const institutionMemberNames = (membersText) => uniqueText(String(membersText ?? "").split(/\r?\n/g));

// The polities an author can pick as members: every polity in the scenario,
// dormant ones included, since an author may list one on purpose.
export const institutionMemberRoster = (world = {}) => collectScenarioPoliticalPolities(world)
  .map((entry) => entry.polityKey);

// Members that name no polity in the scenario, exactly as written. Polity names
// are exact keys, so a typo or a near-name would found a phantom member that
// votes and counts toward quorum without matching any country. Kept, not
// refused: this only warns. An exact name or alias a polity is known by counts.
// With no roster to compare against there is nothing to warn about, and a
// world without ownerCodes has none: on the stock map every country the map
// draws owns its land without being listed, as the country picker assumes, so
// "France" would be flagged there although it is on the map.
export const unmatchedInstitutionMembers = (names = [], world = {}) => {
  if (!Array.isArray(world?.ownerCodes) || !world.ownerCodes.length) return [];
  const roster = institutionMemberRoster(world);
  if (!roster.length) return [];
  const known = new Set(roster);
  for (const override of Object.values(world?.polityOverrides ?? {})) {
    if (!override || typeof override !== "object") continue;
    for (const token of [override.name, ...(Array.isArray(override.aliases) ? override.aliases : [])]) {
      if (clean(token)) known.add(clean(token));
    }
  }
  return (Array.isArray(names) ? names : []).filter((name) => clean(name) && !known.has(clean(name)));
};

export const institutionAuthoringRows = (world = {}) => {
  const institutions = normalizeInstitutions(world?.institutions, world);
  return Object.values(institutions.byId || {})
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
};

export const institutionAuthoringDraft = (institution = null) => {
  const source = institution && typeof institution === "object" ? institution : {};
  return {
    id: clean(source.id),
    name: clean(source.name),
    shortName: clean(source.shortName),
    kind: INSTITUTION_KINDS.includes(source.kind) ? source.kind : "other",
    foundedDate: clean(source.foundedDate),
    dissolvedDate: clean(source.dissolvedDate),
    badgeKey: clean(source.badgeKey),
    logoUrl: clean(source.logoUrl),
    logoAsset: source.logoAsset === true,
    aliasesText: uniqueText(source.aliases).join(", "),
    membersText: Array.isArray(source.members)
      ? source.members.map((member) => clean(member?.polity)).filter(Boolean).join("\n")
      : "",
    note: clean(source.note),
  };
};

export const validateInstitutionAuthoringDraft = (draft = {}, world = {}) => {
  const name = clean(draft.name);
  if (!name) return "Institution name is required.";
  const requestedId = clean(draft.id) || institutionAuthoringId(name);
  if (!requestedId) return "Institution id could not be derived from the name.";
  const normalizedId = institutionAuthoringId(requestedId);
  if (!normalizedId) return "Institution id is invalid.";
  if (clean(draft.logoUrl) && !normalizeInstitutionLogoUrl(draft.logoUrl)) {
    return "Logo must be an http(s) URL, a normal image asset path, or a persistent raster image data URL.";
  }

  const institutions = normalizeInstitutions(world?.institutions, world);
  const existing = institutions.byId?.[normalizedId];
  if (existing && !clean(draft.id)) {
    return `Institution id ${normalizedId} is already in use. Select the existing institution to edit it.`;
  }
  return "";
};

const preserveMember = (existingMembers, polity) => {
  const existing = existingMembers.get(lower(polity));
  if (existing) return { ...existing, polity };
  return {
    polity,
    status: "member",
    role: "member",
    sinceDate: "",
    lastUpdatedDate: "",
    sourceEventIds: [],
    sourceProposalIds: [],
    note: "",
  };
};

export const upsertScenarioInstitution = (world = {}, draft = {}) => {
  const error = validateInstitutionAuthoringDraft(draft, world);
  if (error) return { world, institution: null, error };

  const institutions = normalizeInstitutions(world?.institutions, world);
  const id = clean(draft.id) ? institutionAuthoringId(draft.id) : institutionAuthoringId(draft.name);
  const existing = institutions.byId?.[id] || null;
  const existingMembers = new Map((existing?.members || []).map((member) => [lower(member?.polity), member]));
  const members = institutionMemberNames(draft.membersText).map((polity) => preserveMember(existingMembers, polity));
  const memberKeys = new Set(members.map((member) => lower(member.polity)));
  const leaders = (existing?.leaders || []).filter((polity) => memberKeys.has(lower(polity)));

  const candidate = {
    ...(existing || {}),
    id,
    name: clean(draft.name),
    shortName: clean(draft.shortName),
    kind: INSTITUTION_KINDS.includes(draft.kind) ? draft.kind : "other",
    foundedDate: clean(draft.foundedDate),
    dissolvedDate: clean(draft.dissolvedDate),
    badgeKey: clean(draft.badgeKey),
    logoUrl: normalizeInstitutionLogoUrl(draft.logoUrl),
    logoAsset: draft.logoAsset === true,
    aliases: uniqueText(draft.aliasesText),
    members,
    leaders,
    note: clean(draft.note).slice(0, 1000),
  };

  const normalized = normalizeInstitutionRecord(candidate, id, { ...world, institutions });
  if (!normalized) return { world, institution: null, error: "Institution could not be normalized." };

  const nextInstitutions = {
    ...institutions,
    byId: {
      ...(institutions.byId || {}),
      [normalized.id]: normalized,
    },
  };

  return {
    world: { ...world, institutions: nextInstitutions },
    institution: normalized,
    error: "",
  };
};

// Takes an institution out of the scenario's canon, members, proposals and
// history with it. The uploaded logo lives in a separate scenario asset, which
// the Politics tab clears on its own.
export const removeScenarioInstitution = (world = {}, institutionId = "") => {
  const institutions = normalizeInstitutions(world?.institutions, world);
  const id = clean(institutionId);
  const existing = id && Object.hasOwn(institutions.byId || {}, id) ? institutions.byId[id] : null;
  if (!existing) return { world, institution: null, error: "That institution is not in this scenario." };
  const byId = { ...(institutions.byId || {}) };
  delete byId[id];
  return {
    world: { ...world, institutions: { ...institutions, byId } },
    institution: existing,
    error: "",
  };
};
