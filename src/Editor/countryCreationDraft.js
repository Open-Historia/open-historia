/*!
 * Open Historia Map Editor - a country is configured locally before being created.
 * This pure preflight reuses the engine's canonical identity, military, population,
 * tag, and puppet contracts. No map or scenario state is changed here.
 */
import { nameKey } from "../../server/nameKey.js";
import { normalizeTagList, MAX_TAGS, MAX_TAG_LEN } from "../runtime/countryTags.js";
import { normalizeMilitaryStats } from "../runtime/militaryStats.js";
import { readPopulationFigure } from "../runtime/populationFigure.js";
import { planCountryCreation } from "./countryCreationPlan.js";
import { planStartingRelationDraft } from "./scenarioStartingRelations.js";
import { PUPPET_KIND_OPTIONS, PUPPET_SECRECY_OPTIONS, setOverlord } from "./scenarioPuppets.js";

const clean = (value) => String(value ?? "").trim();
const reject = (reason) => ({ ok: false, reason });

export const emptyCountryDraft = () => ({
  name: "",
  aliases: [],
  formerNames: [],
  note: "",
  population: "",
  military: null,
  color: null,
  flag: null,
  tags: [],
  overlord: "",
  dependencyKind: "satellite",
  secrecy: "open",
  loyalty: 50,
  assignSelectedRegions: false,
  startingRelations: [],
});

export const planCountryDraft = ({
  draft, polities = {}, occupiedKeys = [], puppets = [], polityChoices = [],
} = {}) => {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return reject("Open a new country setup first.");
  }
  const primary = planCountryCreation({ name: draft.name, polities, occupiedKeys });
  if (!primary.ok) return primary;
  const key = primary.key;
  const seenNames = new Set([nameKey(key)]);
  const configuredNames = {};

  for (const [field, label] of [["aliases", "Alternative name"], ["formerNames", "Former name"]]) {
    const supplied = draft[field] ?? [];
    if (!Array.isArray(supplied) || supplied.some((entry) => typeof entry !== "string")) {
      return reject(`${label} entries must be text.`);
    }
    const checked = [];
    for (const entry of supplied) {
      const candidate = clean(entry);
      const folded = nameKey(candidate);
      if (!folded) return reject(`Enter a valid ${label.toLowerCase()} or remove the empty entry.`);
      if (seenNames.has(folded)) {
        return reject(`"${candidate}" is already listed as this country's name.`);
      }
      const conflict = planCountryCreation({ name: candidate, polities, occupiedKeys });
      if (!conflict.ok) return conflict;
      checked.push(candidate);
      seenNames.add(folded);
    }
    configuredNames[field] = checked;
  }

  const rawPopulation = clean(draft.population);
  const population = rawPopulation ? readPopulationFigure(rawPopulation) : undefined;
  if (rawPopulation && !population) {
    return reject("Starting population must be a whole number of people written in digits.");
  }
  const military = draft.military == null ? null : normalizeMilitaryStats(draft.military);
  if (draft.military != null && !military) {
    return reject("Starting military figures are invalid. Clear them or enter valid figures.");
  }

  const color = draft.color == null ? null : draft.color;
  if (color && (!Array.isArray(color) || color.length !== 3 || color.some(
    (value) => !Number.isInteger(value) || value < 0 || value > 255,
  ))) return reject("Choose a valid country colour.");

  const flag = draft.flag == null ? null : draft.flag;
  if (flag !== null && (typeof flag !== "string" || !flag.trim())) {
    return reject("Choose a valid flag, or leave it unset.");
  }

  const rawTags = draft.tags ?? [];
  if (!Array.isArray(rawTags) || rawTags.some((value) => typeof value !== "string")) {
    return reject("Country tags must be text.");
  }
  if (rawTags.length > MAX_TAGS || rawTags.some((value) => clean(value).length > MAX_TAG_LEN)) {
    return reject(`Use up to ${MAX_TAGS} country tags of at most ${MAX_TAG_LEN} characters each.`);
  }
  const tags = normalizeTagList(rawTags);
  if (tags.length !== rawTags.length) {
    return reject("Remove repeated or empty country tags before creation.");
  }

  const overlord = clean(draft.overlord);
  let nextPuppets = null;
  if (overlord) {
    const allowed = (Array.isArray(polityChoices) ? polityChoices : []).some((choice) => choice.key === overlord);
    if (!allowed) return reject("Choose an existing country as the overlord.");
    if (!PUPPET_KIND_OPTIONS.some((choice) => choice.id === draft.dependencyKind)) {
      return reject("Choose a valid kind of dependency.");
    }
    if (!PUPPET_SECRECY_OPTIONS.some((choice) => choice.id === draft.secrecy)) {
      return reject("Choose whether the dependency is publicly known.");
    }
    const loyalty = Number(draft.loyalty);
    if (!Number.isInteger(loyalty) || loyalty < 0 || loyalty > 100) {
      return reject("Dependency loyalty must be between 0 and 100.");
    }
    const relationship = setOverlord(puppets, key, overlord, {
      kind: draft.dependencyKind,
      secrecy: draft.secrecy,
      loyalty,
    });
    if (relationship.error) return reject(relationship.error);
    nextPuppets = relationship.puppets;
  }

  const startingRelations = planStartingRelationDraft(draft.startingRelations ?? [], key, polityChoices);
  if (!startingRelations.ok) return startingRelations;

  return {
    ok: true,
    key,
    record: {
      name: key,
      code: key,
      status: "active",
      aliases: configuredNames.aliases,
      formerNames: configuredNames.formerNames,
      note: String(draft.note ?? ""),
      ...(population !== undefined ? { population } : {}),
      ...(military ? { military } : {}),
    },
    color,
    flag,
    tags,
    puppets: nextPuppets,
    relationEdits: startingRelations.edits,
    assignSelectedRegions: draft.assignSelectedRegions === true,
  };
};
