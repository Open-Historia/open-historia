/*! Open Historia — GM request completeness guards © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Whether the administrator's request asks for a puppet is the GM answer's own
// requestedSubordination: the model that read the request says so, in
// whatever language the request is written. An answer without the field (an
// older or a local model's) is not held to an install. When it was missing,
// the request's words decided instead: English install phrasings ("make X a
// puppet state of Y") with an English negation check, which no request in
// another language ever met and which misread English it did not expect.
// Native world.puppets remains the canonical owner of the subordination.
export const gameMasterRequestAsksForPuppet = (candidate) => candidate?.requestedSubordination === true;

export const validateGameMasterRequestedPuppetCompleteness = (candidate) => {
  if (!gameMasterRequestAsksForPuppet(candidate)) return "";
  const hasInstall = Array.isArray(candidate?.puppetUpdates) && candidate.puppetUpdates.some(
    (entry) => String(entry?.op ?? "").trim().toLowerCase() === "install",
  );
  if (hasInstall) return "";
  return "The administrator explicitly requested creating a puppet/satellite/protectorate/client relationship, but $.puppetUpdates contains no install operation. Event prose, relation scores and agreements do not establish world.puppets. Add one canonical puppetUpdates install tied to the event that establishes the subordination.";
};
