// Device-local group chat request strategy. No save-file migration or provider
// accounting changes: this controls only how many speakers share each prompt.
export const GROUP_BATCH_SIZE_MIN = 1;
export const GROUP_BATCH_SIZE_MAX = 10;
export const DEFAULT_GROUP_BATCH_SIZE = 3;
export const GROUP_AI_SETTINGS_EVENT = "oh:advisor-group-ai-settings";
const INDIVIDUAL_KEY = "oh_advisor_group_individual_calls";
const BATCH_SIZE_KEY = "oh_advisor_group_batch_size";

export const clampAdvisorBatchSize = (value) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(GROUP_BATCH_SIZE_MIN, Math.min(GROUP_BATCH_SIZE_MAX, Math.round(number)))
    : DEFAULT_GROUP_BATCH_SIZE;
};
const storage = (provided) => {
  if (provided) return provided;
  try { return globalThis.localStorage; } catch { return null; }
};
export const readAdvisorGroupSettings = (provided = null) => {
  const store = storage(provided);
  let individual = true, batchSize = DEFAULT_GROUP_BATCH_SIZE;
  try {
    individual = store?.getItem(INDIVIDUAL_KEY) !== "0";
    batchSize = clampAdvisorBatchSize(store?.getItem(BATCH_SIZE_KEY) ?? DEFAULT_GROUP_BATCH_SIZE);
  } catch { /* Missing/unavailable storage uses defaults. */ }
  return { individual, batchSize, effectiveBatchSize: individual ? 1 : batchSize };
};
export const setAdvisorGroupSettings = (changes, provided = null) => {
  const store = storage(provided);
  const before = readAdvisorGroupSettings(provided);
  const next = {
    individual: typeof changes?.individual === "boolean" ? changes.individual : before.individual,
    batchSize: Object.hasOwn(changes || {}, "batchSize")
      ? clampAdvisorBatchSize(changes.batchSize) : before.batchSize,
  };
  try {
    store?.setItem(INDIVIDUAL_KEY, next.individual ? "1" : "0");
    store?.setItem(BATCH_SIZE_KEY, String(next.batchSize));
  } catch { /* Session remains valid even without persistent storage. */ }
  if (!provided && typeof window !== "undefined") window.dispatchEvent(new Event(GROUP_AI_SETTINGS_EVENT));
  return { ...next, effectiveBatchSize: next.individual ? 1 : next.batchSize };
};
