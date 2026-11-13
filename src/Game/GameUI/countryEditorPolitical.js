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
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
};

const partyToEditor = (party, index) => {
  const sourceId = clean(party?.id) || `party-${index + 1}`;
  return {
    _editorKey: `party-editor:${sourceId}:${index}`,
    _sourceId: sourceId,
    id: sourceId,
    name: clean(party?.name),
    shortName: clean(party?.shortName),
    nameNative: clean(party?.nameNative),
    shortNameNative: clean(party?.shortNameNative),
    leader: officeholderName(party?.leader),
    ideology: clean(party?.ideology),
    ideologyFamily: clean(party?.ideologyFamily),
    subideology: clean(party?.subideology),
    politicalPosition: clean(party?.politicalPosition),
    role: party?.ruling === true ? "governing" : party?.coalition === true ? "coalition" : clean(party?.role) || "opposition",
    seats: party?.seats == null || party?.seats === "" ? "" : String(party.seats),
    founded: clean(party?.founded),
    color: clean(party?.color),
    publicDescription: clean(party?.publicDescription),
    publicPrioritiesText: listToEditorText(party?.publicPriorities?.length ? party.publicPriorities : party?.goals),
    priorityField: Array.isArray(party?.publicPriorities) && party.publicPriorities.length ? "publicPriorities" : (Array.isArray(party?.goals) && party.goals.length ? "goals" : "publicPriorities"),
    publicForeignPolicyText: listToEditorText(party?.publicForeignPolicy),
    supportPercent: percentText(party?.support?.percent),
    influencePercent: percentText(party?.influence?.percent),
    influenceLabel: clean(party?.influence?.label),
    ruling: party?.ruling === true,
    coalition: party?.coalition === true,
  };
};

const blocToEditor = (bloc, index) => {
  const sourceId = clean(bloc?.id) || `bloc-${index + 1}`;
  return {
    _editorKey: `bloc-editor:${sourceId}:${index}`,
    _sourceId: sourceId,
    id: sourceId,
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
  };
};

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
    legislature: clean(government.legislature),
    legislatureSeats: government.legislatureSeats == null || government.legislatureSeats === "" ? "" : String(government.legislatureSeats),
    nextElection: clean(government.nextElection),
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

const optionalSeatCount = (value, label) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 100000) {
    throw new Error(`${label} must be a whole number from 0 to 100,000.`);
  }
  return number;
};

const optionalSupportShare = (value, label) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new Error(`${label} must be between 0 and 100 percent.`);
  }
  return Math.round(number * 10) / 10;
};

// The totals an editor state adds up to. A legislature of 0 seats is no total: saving deletes it
// (applyPoliticalEditorStateToWorld), so the counter must not report parties "exceeding 0 seats".
const compositionTotals = (editor) => {
  const statedSeats = optionalSeatCount(editor?.legislatureSeats, "Legislature seats");
  const totalSeats = statedSeats === 0 ? null : statedSeats;
  const parties = (Array.isArray(editor?.parties) ? editor.parties : []).filter((party) => clean(party?.name));
  let assignedSeats = 0;
  let mappedSupport = 0;
  const seenIds = new Set();

  for (const party of parties) {
    const id = clean(party.id);
    if (!id) throw new Error(`Political entity "${clean(party.name)}" needs a stable party ID.`);
    const idKey = id.toLocaleLowerCase();
    if (seenIds.has(idKey)) throw new Error(`Duplicate party ID "${id}".`);
    seenIds.add(idKey);
    assignedSeats += optionalSeatCount(party.seats, `Seats held by ${clean(party.name)}`) ?? 0;
    mappedSupport += optionalSupportShare(party.supportPercent, `Support for ${clean(party.name)}`) ?? 0;
  }
  return { totalSeats, assignedSeats, mappedSupport };
};

// Validates author-entered electoral data without guessing missing parties,
// distributing seats, or rewriting a political result to make it add up.
// `asRecorded`: the record as it stood before this edit, in the editor's form. A record that already held more seats
// or support than its totals (an older AI compile, a turn's edits) does not stop every other edit to the country
// from saving; only an edit that makes it worse, or changes the legislature's size, is refused.
export const politicalEditorComposition = (editor, { asRecorded = null } = {}) => {
  const { totalSeats, assignedSeats, mappedSupport } = compositionTotals(editor);
  let before = null;
  try { before = asRecorded ? compositionTotals(asRecorded) : null; } catch { before = null; }
  const seatsAsRecorded = Boolean(before) && before.totalSeats === totalSeats && assignedSeats <= before.assignedSeats;
  const supportAsRecorded = Boolean(before) && mappedSupport <= before.mappedSupport + 0.000001;

  if (totalSeats !== null && assignedSeats > totalSeats && !seatsAsRecorded) {
    throw new Error(`Parties hold ${assignedSeats} seats, exceeding the legislature's ${totalSeats} seats.`);
  }
  const representation = clean(editor?.politicalRepresentation);
  if ((!representation || representation === "electoral") && mappedSupport > 100.000001 && !supportAsRecorded) {
    throw new Error(`Named party support totals ${mappedSupport.toFixed(1)}%, exceeding 100%.`);
  }

  return {
    totalSeats,
    assignedSeats,
    unlistedSeats: totalSeats === null ? null : totalSeats - assignedSeats,
    mappedSupport: Math.round(mappedSupport * 10) / 10,
    otherSupport: Math.max(0, Math.round((100 - mappedSupport) * 10) / 10),
  };
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
  if (Object.prototype.hasOwnProperty.call(draft, "nameNative")) replaceText(next, "nameNative", draft.nameNative);
  if (Object.prototype.hasOwnProperty.call(draft, "shortNameNative")) replaceText(next, "shortNameNative", draft.shortNameNative);
  const leader = preserveOfficeholder(base?.leader, draft.leader);
  if (leader) next.leader = leader; else delete next.leader;
  replaceText(next, "ideology", draft.ideology);
  if (Object.prototype.hasOwnProperty.call(draft, "ideologyFamily")) replaceText(next, "ideologyFamily", draft.ideologyFamily);
  if (Object.prototype.hasOwnProperty.call(draft, "subideology")) replaceText(next, "subideology", draft.subideology);
  if (Object.prototype.hasOwnProperty.call(draft, "politicalPosition")) replaceText(next, "politicalPosition", draft.politicalPosition);
  if (Object.prototype.hasOwnProperty.call(draft, "role")) {
    const role = draft.ruling === true ? "governing" : draft.coalition === true ? "coalition"
      : (draft.role === "governing" || draft.role === "coalition" ? "opposition" : draft.role);
    replaceText(next, "role", role);
  }
  if (Object.prototype.hasOwnProperty.call(draft, "seats")) {
    const seats = optionalSeatCount(draft.seats, `Seats held by ${clean(draft.name)}`);
    if (seats === null) delete next.seats;
    else next.seats = seats;
  }
  if (Object.prototype.hasOwnProperty.call(draft, "founded")) replaceText(next, "founded", draft.founded);
  if (Object.prototype.hasOwnProperty.call(draft, "color")) {
    const color = clean(draft.color);
    if (color && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
      throw new Error(`The colour of ${clean(draft.name)} must be a hex colour such as #2bc1f3.`);
    }
    replaceText(next, "color", color);
  }
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
  politicalEditorComposition(editor, { asRecorded: politicalEditorStateFromWorld(world, key) });

  const existingActor = getPoliticalProfile(world, key);
  const existingKey = getPoliticalProfileKey(world, key) || key;
  const existing = clone(existingActor) || { polityKey: key, government: {}, parties: [], powerBlocs: [] };
  const existingParties = new Map((Array.isArray(existing.parties) ? existing.parties : []).map((party) => [clean(party?.id), party]));
  const existingBlocs = new Map((Array.isArray(existing.powerBlocs) ? existing.powerBlocs : []).map((bloc) => [clean(bloc?.id), bloc]));

  // Keep the draft with its normalized party while filtering blank rows.
  // Filtering first and then indexing editor.parties assigns coalition/ruling
  // flags to the wrong party whenever an earlier empty row is discarded.
  const partyRows = (Array.isArray(editor?.parties) ? editor.parties : [])
    .map((draft) => ({ draft, party: applyPartyEditor(draft, existingParties.get(clean(draft?._sourceId || draft?.id))) }))
    .filter(({ party }) => clean(party?.name));
  const parties = partyRows.map(({ party }) => party);
  const powerBlocs = (Array.isArray(editor?.powerBlocs) ? editor.powerBlocs : [])
    .map((draft) => applyBlocEditor(draft, existingBlocs.get(clean(draft?._sourceId || draft?.id))))
    .filter((bloc) => clean(bloc?.name));

  const rulingPartyIds = partyRows
    .filter(({ draft }) => draft?.ruling === true)
    .map(({ party }) => clean(party.id))
    .filter(Boolean);
  const coalitionPartyIds = partyRows
    .filter(({ draft }) => draft?.coalition === true && draft?.ruling !== true)
    .map(({ party }) => clean(party.id))
    .filter(Boolean);

  const government = clone(existing.government) || {};
  replaceText(government, "form", editor?.governmentForm);
  replaceText(government, "ideology", editor?.governmentIdeology);
  replaceText(government, "status", editor?.governmentStatus);
  replaceText(government, "coalitionName", editor?.coalitionName);
  if (Object.prototype.hasOwnProperty.call(editor || {}, "legislature")) replaceText(government, "legislature", editor.legislature);
  if (Object.prototype.hasOwnProperty.call(editor || {}, "nextElection")) replaceText(government, "nextElection", editor.nextElection);
  if (Object.prototype.hasOwnProperty.call(editor || {}, "legislatureSeats")) {
    const seats = optionalSeatCount(editor.legislatureSeats, "Legislature seats");
    if (seats === null || seats === 0) delete government.legislatureSeats;
    else government.legislatureSeats = seats;
  }
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
