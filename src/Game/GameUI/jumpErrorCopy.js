/*! Open Historia - player-facing copy for time-skip failures. */

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Which failure an error is, by the status it carries, never by the words of
// its message: a turn held because the Political World could not be made to
// match a political event says so (AI/politicalClaimRepair.js
// politicalClaimRepairHoldError: canonicalIntegrity "political-world").
const isPoliticalWorldHold = (error) => error?.canonicalIntegrity === "political-world"
  || error?.cause?.canonicalIntegrity === "political-world";

export const playerFacingJumpError = (error) => {
  const message = clean(error?.message || error);
  if (!message) return "The time skip could not be completed.";

  if (isPoliticalWorldHold(error)) {
    return "The AI described a political change but did not update the Political World to match it. Nothing was written. Retry the time skip; the technical reason is saved in Diagnostics.";
  }

  return message;
};
