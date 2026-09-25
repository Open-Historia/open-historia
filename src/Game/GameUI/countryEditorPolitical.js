/*! Open Historia — Country Editor Political World v2 bridge */
import {
  derivePoliticalDecisionAuthority,
  getPoliticalProfile,
  getPoliticalProfileKey,
  normalizePoliticalActorRecord,
  normalizePoliticalActors,
} from "../../runtime/politicalActors.js";
import { derivePoliticalDispositionForActor } from "../../runtime/politicalDisposition.js";
import {
  POLITICAL_TRAIT_REGISTRY,
  canonicalPoliticalTraitKey,
  politicalTraitCatalogForActor,
  normalizePoliticalTraitValue,
} from "../../runtime/politicalTraitRegistry.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clone = (value) => {
  if (!value || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const prettyJson = (value) => JSON.stringify(value && typeof value === "object" ? value : {}, null, 2);

const parseObjectJson = (value, label) => {
  const text = String(value ?? "").trim();
  if (!text) return {};
  let parsed;
  try { parsed = JSON.parse(text); } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error?.message || error}.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
};

export const listToEditorText = (value) => (Array.isArray(value) ? value.map(clean).filter(Boolean).join("\n") : clean(value));
export const editorTextToList = (value, limit = 32) => {
  const seen = new Set();
  const out = [];
  for (const line of String(value ?? "").split(/\r?\n/)) {
    const text = clean(line);
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
};

const officeholderName = (value) => {
  if (typeof value === "string") return clean(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return clean(value.name || value.id);
};

const percentText = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
};

const partyToEditor = (party, index) => ({
  id: clean(party?.id) || `party-${index + 1}`,
  name: clean(party?.name),
  shortName: clean(party?.shortName),
  leader: officeholderName(party?.leader),
  ideology: clean(party?.ideology),
  publicDescription: clean(party?.publicDescription),
  publicPrioritiesText: listToEditorText(party?.publicPriorities?.length ? party.publicPriorities : party?.goals),
  priorityField: Array.isArray(party?.publicPriorities) && party.publicPriorities.length ? "publicPriorities" : (Array.isArray(party?.goals) && party.goals.length ? "goals" : "publicPriorities"),
  publicForeignPolicyText: listToEditorText(party?.publicForeignPolicy),
  supportPercent: percentText(party?.support?.percent),
  influencePercent: percentText(party?.influence?.percent),
  influenceLabel: clean(party?.influence?.label),
  ruling: party?.ruling === true,
  coalition: party?.coalition === true,
});

const blocToEditor = (bloc, index) => ({
  id: clean(bloc?.id) || `bloc-${index + 1}`,
  name: clean(bloc?.name),
  shortName: clean(bloc?.shortName),
  kind: clean(bloc?.kind),
  status: clean(bloc?.status),
  leader: officeholderName(bloc?.leader),
  ideology: clean(bloc?.ideology),
  publicDescription: clean(bloc?.publicDescription),
  publicPrioritiesText: listToEditorText(bloc?.publicPriorities?.length ? bloc.publicPriorities : bloc?.goals),
  priorityField: Array.isArray(bloc?.publicPriorities) && bloc.publicPriorities.length ? "publicPriorities" : (Array.isArray(bloc?.goals) && bloc.goals.length ? "goals" : "publicPriorities"),
  publicForeignPolicyText: listToEditorText(bloc?.publicForeignPolicy),
  influencePercent: percentText(bloc?.influence?.percent),
  influenceLabel: clean(bloc?.influence?.label),
});

export const politicalActorToEditorState = (actor) => {
  const source = actor && typeof actor === "object" && !Array.isArray(actor) ? actor : {};
  const government = source.government && typeof source.government === "object" ? source.government : {};
  const system = source.politicalSystem && typeof source.politicalSystem === "object" ? source.politicalSystem : {};
  return {
    exists: Boolean(actor),
    governmentForm: clean(government.form),
    governmentIdeology: clean(government.ideology),
    governmentStatus: clean(government.status),
    coalitionName: clean(government.coalitionName),
    headOfState: officeholderName(government.headOfState),
    headOfGovernment: officeholderName(government.headOfGovernment),
    politicalLeader: officeholderName(source.leader),
    approval: percentText(government.approval),
    politicalStability: percentText(government.stability),
    politicalSystemType: clean(system.type),
    politicalRepresentation: clean(system.representation),
    regimeCharacter: clean(system.regimeCharacter),
    politicalSystemLabel: clean(system.label),
    politicalSystemNotes: clean(system.notes),
    goalsText: listToEditorText(source.goals),
    fearsText: listToEditorText(source.fears),
    ambitionsText: listToEditorText(source.ambitions),
    domesticPressuresText: listToEditorText(source.domesticPressures),
    traitValues: Object.fromEntries(
      politicalTraitCatalogForActor(source).traits.map((entry) => [entry.key, entry.value == null ? "" : String(entry.value)]),
    ),
    traitsJson: prettyJson(source.traits),
    perceptionsJson: prettyJson(source.perceptions),
    parties: (Array.isArray(source.parties) ? source.parties : []).map(partyToEditor),
    powerBlocs: (Array.isArray(source.powerBlocs) ? source.powerBlocs : []).map(blocToEditor),
  };
};

export const politicalEditorStateFromWorld = (world, polityKey) => politicalActorToEditorState(getPoliticalProfile(world, polityKey));

const optionalNumber = (value, { min = 0, max = 100 } = {}) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(min, Math.min(max, Math.round(number * 10) / 10));
};

const replaceText = (target, key, value) => {
  const text = clean(value);
  if (text) target[key] = text;
  else delete target[key];
};

const replaceList = (target, key, value, limit = 32) => {
  const list = editorTextToList(value, limit);
  if (list.length) target[key] = list;
  else delete target[key];
};

const preserveOfficeholder = (base, value) => {
  const name = clean(value);
  if (!name) return "";
  if (base && typeof base === "object" && !Array.isArray(base) && officeholderName(base) === name) return clone(base);
  return name;
};

const applyPartyEditor = (draft, base = {}) => {
  const next = clone(base) || {};
  replaceText(next, "id", draft.id);
  replaceText(next, "name", draft.name);
  replaceText(next, "shortName", draft.shortName);
  const leader = preserveOfficeholder(base?.leader, draft.leader);
  if (leader) next.leader = leader; else delete next.leader;
  replaceText(next, "ideology", draft.ideology);
  replaceText(next, "publicDescription", draft.publicDescription);
  const priorityField = draft.priorityField === "goals" ? "goals" : "publicPriorities";
  replaceList(next, priorityField, draft.publicPrioritiesText, 16);
  if (priorityField === "goals") delete next.publicPriorities;
  else delete next.goals;
  replaceList(next, "publicForeignPolicy", draft.publicForeignPolicyText, 16);

  const support = optionalNumber(draft.supportPercent);
  if (support == null) delete next.support;
  else next.support = { ...(next.support && typeof next.support === "object" ? next.support : {}), percent: support };

  const influence = optionalNumber(draft.influencePercent);
  const influenceLabel = clean(draft.influenceLabel);
  if (influence == null && !influenceLabel) delete next.influence;
  else next.influence = {
    ...(next.influence && typeof next.influence === "object" ? next.influence : {}),
    ...(influence == null ? {} : { percent: influence }),
    ...(influenceLabel ? { label: influenceLabel } : {}),
  };

  // Government membership is canonical on government.rulingPartyIds /
  // coalitionPartyIds. Flags are re-derived by normalizePoliticalActorRecord.
  delete next.ruling;
  delete next.coalition;
  return next;
};

const applyBlocEditor = (draft, base = {}) => {
  const next = clone(base) || {};
  for (const key of ["id", "name", "shortName", "kind", "status", "ideology", "publicDescription"]) {
    replaceText(next, key, draft[key]);
  }
  const leader = preserveOfficeholder(base?.leader, draft.leader);
  if (leader) next.leader = leader; else delete next.leader;
  const priorityField = draft.priorityField === "goals" ? "goals" : "publicPriorities";
  replaceList(next, priorityField, draft.publicPrioritiesText, 16);
  if (priorityField === "goals") delete next.publicPriorities;
  else delete next.goals;
  replaceList(next, "publicForeignPolicy", draft.publicForeignPolicyText, 16);

  const influence = optionalNumber(draft.influencePercent);
  const influenceLabel = clean(draft.influenceLabel);
  if (influence == null && !influenceLabel) delete next.influence;
  else next.influence = {
    ...(next.influence && typeof next.influence === "object" ? next.influence : {}),
    ...(influence == null ? {} : { percent: influence }),
    ...(influenceLabel ? { label: influenceLabel } : {}),
  };
  return next;
};

export const applyPoliticalEditorStateToWorld = (world, polityKey, editor) => {
  if (!world || typeof world !== "object") throw new Error("World state is required.");
  const key = clean(polityKey);
  if (!key) throw new Error("Political World edit requires a polity key.");

  const existingActor = getPoliticalProfile(world, key);
  const existingKey = getPoliticalProfileKey(world, key) || key;
  const existing = clone(existingActor) || { polityKey: key, government: {}, parties: [], powerBlocs: [] };
  const existingParties = new Map((Array.isArray(existing.parties) ? existing.parties : []).map((party) => [clean(party?.id), party]));
  const existingBlocs = new Map((Array.isArray(existing.powerBlocs) ? existing.powerBlocs : []).map((bloc) => [clean(bloc?.id), bloc]));

  const parties = (Array.isArray(editor?.parties) ? editor.parties : [])
    .map((draft) => applyPartyEditor(draft, existingParties.get(clean(draft?.id))))
    .filter((party) => clean(party?.name));
  const powerBlocs = (Array.isArray(editor?.powerBlocs) ? editor.powerBlocs : [])
    .map((draft) => applyBlocEditor(draft, existingBlocs.get(clean(draft?.id))))
    .filter((bloc) => clean(bloc?.name));

  const rulingPartyIds = parties
    .filter((_, index) => editor.parties?.[index]?.ruling === true)
    .map((party) => clean(party.id))
    .filter(Boolean);
  const coalitionPartyIds = parties
    .filter((_, index) => editor.parties?.[index]?.coalition === true && editor.parties?.[index]?.ruling !== true)
    .map((party) => clean(party.id))
    .filter(Boolean);

  const government = clone(existing.government) || {};
  replaceText(government, "form", editor?.governmentForm);
  replaceText(government, "ideology", editor?.governmentIdeology);
  replaceText(government, "status", editor?.governmentStatus);
  replaceText(government, "coalitionName", editor?.coalitionName);
  const hos = preserveOfficeholder(existing?.government?.headOfState, editor?.headOfState);
  const hog = preserveOfficeholder(existing?.government?.headOfGovernment, editor?.headOfGovernment);
  if (hos) government.headOfState = hos; else delete government.headOfState;
  if (hog) government.headOfGovernment = hog; else delete government.headOfGovernment;
  const approval = optionalNumber(editor?.approval);
  const stability = optionalNumber(editor?.politicalStability);
  if (approval == null) delete government.approval; else government.approval = approval;
  if (stability == null) delete government.stability; else government.stability = stability;
  government.rulingPartyIds = rulingPartyIds;
  government.coalitionPartyIds = coalitionPartyIds;
  delete government.rulingParties;
  delete government.coalition;

  const politicalSystem = clone(existing.politicalSystem) || {};
  replaceText(politicalSystem, "type", editor?.politicalSystemType);
  replaceText(politicalSystem, "representation", editor?.politicalRepresentation);
  replaceText(politicalSystem, "regimeCharacter", editor?.regimeCharacter);
  replaceText(politicalSystem, "label", editor?.politicalSystemLabel);
  replaceText(politicalSystem, "notes", editor?.politicalSystemNotes);

  const draftActor = {
    ...existing,
    polityKey: existing.polityKey || key,
    government,
    politicalSystem,
    parties,
    powerBlocs,
  };
  const politicalLeader = preserveOfficeholder(existing?.leader, editor?.politicalLeader);
  if (politicalLeader) draftActor.leader = politicalLeader; else delete draftActor.leader;
  replaceList(draftActor, "goals", editor?.goalsText);
  replaceList(draftActor, "fears", editor?.fearsText);
  replaceList(draftActor, "ambitions", editor?.ambitionsText);
  replaceList(draftActor, "domesticPressures", editor?.domesticPressuresText);

  // The friendly trait controls expose the entire canonical registry. Raw JSON
  // remains available for legacy/extension traits, but canonical keys are owned
  // by the explicit controls so "unset" stays distinct from numeric zero.
  const rawTraits = parseObjectJson(editor?.traitsJson, "Traits JSON");
  const extensionTraits = {};
  for (const [rawKey, rawValue] of Object.entries(rawTraits)) {
    if (!canonicalPoliticalTraitKey(rawKey)) extensionTraits[rawKey] = rawValue;
  }
  const traits = { ...extensionTraits };
  for (const definition of POLITICAL_TRAIT_REGISTRY) {
    const raw = editor?.traitValues?.[definition.key];
    if (raw === "" || raw === null || raw === undefined) continue;
    const value = normalizePoliticalTraitValue(raw);
    if (value == null) throw new Error(`${definition.label} must be a number from 0 to 100.`);
    traits[definition.key] = value;
  }
  if (Object.keys(traits).length) draftActor.traits = traits;
  else delete draftActor.traits;

  const perceptions = parseObjectJson(editor?.perceptionsJson, "Perceptions JSON");
  if (Object.keys(perceptions).length) draftActor.perceptions = perceptions;
  else delete draftActor.perceptions;

  const normalized = normalizePoliticalActorRecord(draftActor, existingKey);
  const actors = normalizePoliticalActors(world.politicalActors);
  actors.byPolity[existingKey] = normalized;
  world.politicalActors = actors;
  return normalized;
};


export const politicalDebugSnapshotFromWorld = (world, polityKey) => {
  const actor = getPoliticalProfile(world, polityKey);
  if (!actor) return {
    polityKey: clean(polityKey),
    actor: null,
    traitCatalog: politicalTraitCatalogForActor(null),
    decisionAuthority: null,
    storedDisposition: null,
    derivedDisposition: null,
  };
  return {
    polityKey: clean(polityKey),
    actor: clone(actor),
    traitCatalog: politicalTraitCatalogForActor(actor),
    decisionAuthority: derivePoliticalDecisionAuthority(actor),
    storedDisposition: clone(actor.behavioralDisposition || null),
    derivedDisposition: derivePoliticalDispositionForActor(actor, { polityKey }),
  };
};
