/*! Open Historia Continuum — scenario-authoring helpers for canonical institutions. */

import {
  INSTITUTION_KINDS,
  normalizeInstitutionRecord,
  normalizeInstitutions,
} from "./institutions.js";
import { normalizeInstitutionLogoUrl } from "./institutionLogos.js";
import { collectScenarioPoliticalPolities, createScenarioPolityResolver } from "./scenarioPolities.js";
import { stableAsciiId } from "./stableId.js";

const clean = (value) => String(value ?? "").trim();
const lower = (value) => clean(value).toLocaleLowerCase();

export const institutionAuthoringId = (value) => stableAsciiId(value, { maxLength: 96 });

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

  const polityRows = collectScenarioPoliticalPolities(world).filter((entry) => entry.active !== false);
  if (polityRows.length) {
    const polityKeys = new Set(polityRows.map((entry) => entry.polityKey));
    const resolvePolity = createScenarioPolityResolver(world);
    const invalidMember = uniqueText(draft.membersText).find((member) => !polityKeys.has(resolvePolity(member)));
    if (invalidMember) return `Unknown institution member "${invalidMember}". Choose a polity from the scenario roster.`;
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
  const polityRows = collectScenarioPoliticalPolities(world).filter((entry) => entry.active !== false);
  const resolvePolity = createScenarioPolityResolver(world);
  const canonicalizePolity = (value) => polityRows.length ? resolvePolity(value) : clean(value);
  const existingMembers = new Map((existing?.members || []).map((member) => [lower(canonicalizePolity(member?.polity)), member]));
  const members = uniqueText(draft.membersText).map((polity) => preserveMember(existingMembers, canonicalizePolity(polity)));
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
