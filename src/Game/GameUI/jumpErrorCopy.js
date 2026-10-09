/*! Open Historia - player-facing copy for time-skip failures. */

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const playerFacingJumpError = (error) => {
  const message = clean(error?.message || error);
  if (!message) return "The time skip could not be completed.";

  if (/politicalActorOps/i.test(message)
    || /changes a head of state\/government or party leader but carries no matching/i.test(message)
    || /narrates a coup\/revolution\/regime transfer but carries no/i.test(message)
    || /says an election was held\/convened or produced a result but carries no/i.test(message)) {
    return "The AI described a political change but did not update the Political World to match it. Nothing was written. Retry the time skip; the technical reason is saved in Diagnostics.";
  }

  return message;
};
