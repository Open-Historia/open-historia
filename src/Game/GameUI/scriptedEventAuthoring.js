/*! Open Historia — pure authoring helpers for structured scripted-event predicates © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { toCountryName } from "../../runtime/ownerNames.js";

const text = (value) => String(value ?? "").trim();
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value) => Array.isArray(value) ? value : [];

const addOption = (map, idInput, labelInput) => {
  const id = text(idInput);
  if (!id) return;
  const label = text(labelInput) || toCountryName(id) || id;
  const existing = map.get(id);
  if (!existing || existing.label === existing.id) map.set(id, { id, label });
};

export const scriptedEventPolityOptions = (worldInput = {}) => {
  const world = record(worldInput);
  const options = new Map();
  const overrides = record(world.polityOverrides);
  const actors = record(record(world.politicalActors).byPolity);
  const stats = record(world.countryStats);
  const power = record(record(world.powerStatus).byPolity);

  for (const id of array(world.ownerCodes)) addOption(options, id, text(overrides[id]?.name) || text(actors[id]?.name));
  for (const [id, polity] of Object.entries(overrides)) addOption(options, id, polity?.name || polity?.code);
  for (const [id, actor] of Object.entries(actors)) addOption(options, id, actor?.name || actor?.polityKey);
  for (const id of Object.keys(stats)) addOption(options, id, overrides[id]?.name || actors[id]?.name);
  for (const id of Object.keys(power)) addOption(options, id, overrides[id]?.name || actors[id]?.name);

  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
};

export const scriptedEventInstitutionOptions = (worldInput = {}) => {
  const world = record(worldInput);
  const source = record(world.institutions);
  const byId = record(source.byId && typeof source.byId === "object" ? source.byId : source);
  return Object.entries(byId)
    .map(([key, institution]) => {
      if (!institution || typeof institution !== "object" || Array.isArray(institution)) return null;
      const id = text(institution.id || key);
      if (!id) return null;
      return { id, label: text(institution.name || institution.shortName) || id };
    })
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
};

export const scriptedEventPickerLabel = (value, optionsInput = []) => {
  const id = text(value);
  if (!id) return "";
  return optionsInput.find((option) => option.id === id)?.label || id;
};

export const scriptedEventPickerValue = (typed, optionsInput = []) => {
  const value = text(typed);
  if (!value) return "";
  const exactLabel = optionsInput.filter((option) => option.label === value);
  if (exactLabel.length === 1) return exactLabel[0].id;
  const exactId = optionsInput.find((option) => option.id === value);
  return exactId?.id || value;
};
