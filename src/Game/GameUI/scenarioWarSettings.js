/*! Open Historia — the Scenario Editor's war settings, as its form holds them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Wars and Fronts Pt.2. How a scenario's wars are fought (runtime/warSettings.js:
// world.warSettings) is set at the top of the Scenario Editor's Fronts tab
// (ScenarioWarSettings.jsx) and saved with the rest of the editor's form
// (libraryBar.jsx buildScenarioEditorState, handleSave): its era, the men a
// counter stands for, the share of people who can fight, the importance of
// technology in a country's military power (militaryPower.js), its default mustering
// curve, which of the engine's newer mechanics are on, and whether its wars'
// troops come along fronts or as swarms (runtime/fronts/swarms.js).
//
// The form holds them COMPACT: as normalizeWarSettings keeps them, but with a
// mechanic that is on left out (one the scenario says nothing of is on), and
// null for a scenario that sets nothing at all. So a scenario never touched
// here builds the same form as one whose author turned a switch off and on
// again, and closing the drawer asks about unsaved changes only when there
// are some (runtime/editorForm.js formDiffers).
//
// No React here, so node can test it.

import { MEN_PER_COUNTER_MOST, TECHNOLOGY_WEIGHT_MOST, normalizeWarSettings } from "../../runtime/warSettings.js";
import { formatPopulationFigure, readPopulationFigure } from "../../runtime/populationFigure.js";

const EMPTY = Object.freeze({ mechanics: {}, era: null, menPerCounter: null, manpowerShare: null, technologyWeight: null, muster: null, warfare: null });
const within = (value, least, most) => Math.min(most, Math.max(least, value));

// The settings as the form holds them: null where they say nothing.
export const compactWarSettings = (value) => {
  const kept = normalizeWarSettings(value);
  if (!kept) return null;
  const mechanics = Object.fromEntries(Object.entries(kept.mechanics).filter(([, on]) => on === false));
  const compact = { mechanics, era: kept.era, menPerCounter: kept.menPerCounter, manpowerShare: kept.manpowerShare, technologyWeight: kept.technologyWeight, muster: kept.muster, ...(kept.outcomes ? { outcomes: kept.outcomes } : {}), ...(kept.warfare ? { warfare: kept.warfare } : {}) };
  const empty = Object.keys(mechanics).length === 0 && ["era", "menPerCounter", "manpowerShare", "technologyWeight", "muster"].every((key) => compact[key] === null) && !compact.outcomes && !compact.warfare;
  return empty ? null : compact;
};

// The settings with some of them changed.
export const withWarSettings = (value, patch) => compactWarSettings({ ...EMPTY, ...(normalizeWarSettings(value) ?? {}), ...patch });

// A war meant to end one way added (warOutcomes.js), or the one at `index` taken off.
export const withWarOutcome = (value, winner, loser) => withWarSettings(value, { outcomes: [...(normalizeWarSettings(value)?.outcomes ?? []), { winner, loser }] });
export const withoutWarOutcome = (value, index) => withWarSettings(value, { outcomes: (normalizeWarSettings(value)?.outcomes ?? []).filter((_, at) => at !== index) });

// One mechanic switched on or off.
export const withWarMechanic = (value, key, on) => {
  const kept = normalizeWarSettings(value) ?? EMPTY;
  return compactWarSettings({ ...kept, mechanics: { ...kept.mechanics, [key]: on === true } });
};

// What the men-a-counter and share-of-people fields show: "" for the default.
export const warNumberText = (value, key) => {
  const number = normalizeWarSettings(value)?.[key];
  if (number === null || number === undefined) return "";
  return key === "menPerCounter" ? formatPopulationFigure(number) : String(number);
};

// The settings after an author typed `text` into the men-a-counter, the
// share-of-people or the importance-of-technology field: { settings, ok }. An
// empty field is the default again; a figure past the bounds is held to them (1
// to MEN_PER_COUNTER_MOST men, 1 to 100 percent, 0 to TECHNOLOGY_WEIGHT_MOST),
// where normalizeWarSettings would drop it; ok is false for text that is no
// figure, the settings then left as they were.
export const withWarNumber = (value, key, text) => {
  const raw = String(text ?? "").trim();
  if (raw === "") return { settings: withWarSettings(value, { [key]: null }), ok: true };
  const number = key === "menPerCounter"
    ? readPopulationFigure(raw)
    : Number(raw.replace(/\s*%$/, "").replace(",", "."));
  // (The importance of technology may be 0: the men alone.)
  const least = key === "technologyWeight" ? 0 : Number.MIN_VALUE;
  if (!Number.isFinite(number) || number < least) return { settings: compactWarSettings(value), ok: false };
  const held = key === "menPerCounter"
    ? within(Math.round(number), 1, MEN_PER_COUNTER_MOST)
    : key === "technologyWeight" ? within(number, 0, TECHNOLOGY_WEIGHT_MOST) : within(number, 1, 100);
  return { settings: withWarSettings(value, { [key]: held }), ok: true };
};
