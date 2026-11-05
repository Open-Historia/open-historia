// What temperature each task is asked at.
// provider default of 1.0: right for writing a timeline, wrong for matching a place name to a region id.
// A task not listed here sends no temperature and runs the same as before

export const NO_TEMPERATURE = null;

// Keyed by the task key every call already names, and set from each prompt's own demands.
export const TASK_TEMPERATURES = Object.freeze({
  // Classification and matching: one answer is right, the rest are wrong.
  demandCheck: 0.1,
  geographyResolver: 0.1,

  // Reconciliation and summary, all told that changing nothing is a correct answer.
  eventConsolidator: 0.2,
  gameMaster: 0.2,
  projects: 0.2,
  structureDirector: 0.2,
  territoryDirector: 0.2,
  timelineCurator: 0.2,
  unitDirector: 0.2,

  // Bounded estimation: the model must supply what the record does not.
  countryStatSheet: 0.3,
  intelligenceAssessment: 0.3,
  interactiveSummary: 0.3,

  // A compromise: one request carrying the four 0.2 reconcilers plus written agent reports.
  turnReview: 0.3,
});

// Gemini and Anthropic cap at 1, so a higher value is a 400 rather than a nudge.
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 1;

// The temperature for a task, or NO_TEMPERATURE when it has no deliberate setting.
export const temperatureForTask = (taskKey) => {
  const key = String(taskKey ?? "").trim();
  if (!key) return NO_TEMPERATURE;
  // Number() of anything off Object.prototype is NaN, so this is the own-property check too.
  const value = Number(TASK_TEMPERATURES[key]);
  if (!Number.isFinite(value)) return NO_TEMPERATURE;
  return Math.min(MAX_TEMPERATURE, Math.max(MIN_TEMPERATURE, value));
};

// The body fields to merge. enabled: false is a provider saying the model cannot take one.
export const temperatureBody = (taskKey, { enabled = true, field = "temperature" } = {}) => {
  if (!enabled) return {};
  const temperature = temperatureForTask(taskKey);
  return temperature === NO_TEMPERATURE ? {} : { [field]: temperature };
};

export const TEMPERATURE_REFUSAL_KEY = "ai_temperature_refusals";
export const TEMPERATURE_REFUSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const temperatureRefusalKey = ({ provider, endpoint, model } = {}) =>
  [provider, endpoint, model].map((value) => String(value ?? "").trim().toLowerCase()).join("|");

export const createTemperatureMemory = (storage, { now = Date.now } = {}) => {
  const seen = new Map();
  let loaded = false;

  const load = () => {
    if (loaded) return;
    loaded = true;
    try {
      const raw = storage?.getItem?.(TEMPERATURE_REFUSAL_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== "object") return;
      for (const [key, at] of Object.entries(parsed)) {
        if (key && Number.isFinite(Number(at))) seen.set(key, Number(at));
      }
    } catch { /* this session only */ }
  };

  const save = () => {
    try {
      storage?.setItem?.(TEMPERATURE_REFUSAL_KEY, JSON.stringify(Object.fromEntries(seen)));
    } catch { /* this session only */ }
  };

  return {
    refuses: (key) => {
      if (!key) return false;
      load();
      const at = seen.get(key);
      if (!Number.isFinite(at)) return false;
      if (now() - at >= TEMPERATURE_REFUSAL_TTL_MS) {
        seen.delete(key);
        save();
        return false;
      }
      return true;
    },
    learn: (key) => {
      if (!key) return;
      load();
      seen.set(key, now());
      save();
    },
  };
};
