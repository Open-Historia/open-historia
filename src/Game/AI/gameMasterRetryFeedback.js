/*! Open Historia - scoped GM corrective feedback for the one existing retry.
 * Native validators reject the original candidate. This helper never changes
 * any value, deletes an effect, or grants an additional provider attempt.
 */
export const gameMasterRetryFeedback = (taskKey, error) => {
  const failure = String(error ?? "").trim();
  if (taskKey !== "gameMaster" || !failure) return failure;

  if (/\.statsEffects must be object; received array\./.test(failure)) {
    return `${failure} Keep the same supported event consequences, but express statsEffects as ONE object for each polityChanges entry, never an array. Do not discard a supported effect merely to silence validation.`;
  }
  if (/\.statsEffects\.gdpCause must be one of /.test(failure)) {
    return `${failure} Select the permitted causal category that actually matches the event. Do not invent an alias or turn an unsupported claimed effect into a fabricated numeric mutation.`;
  }
  if (/\$\.eventsJson must contain valid JSON array text/.test(failure)) {
    return `${failure} Correct eventsJson to one syntactically valid JSON array string. Preserve the other ledger array strings and causal event indexes unless separately invalid; do not discard the events to bypass the error.`;
  }
  return failure;
};
