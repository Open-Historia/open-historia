/*! Open Historia — GM request completeness guards © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

const normalizeRequestText = (value) => String(value ?? "")
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const PUPPET_KIND_PATTERN = "(?:puppet(?:\\s+state)?|satellite(?:\\s+state)?|protectorate|client\\s+state)";

const PUPPET_INSTALL_PATTERNS = Object.freeze([
  new RegExp(`\\bmake\\b.{1,48}\\b(?:an?\\s+)?(?:open\\s+|covert\\s+|secret\\s+)?${PUPPET_KIND_PATTERN}\\b`, "i"),
  new RegExp(`\\bturn\\b.{1,96}\\binto\\s+(?:an?\\s+)?(?:open\\s+|covert\\s+|secret\\s+)?${PUPPET_KIND_PATTERN}\\b`, "i"),
  new RegExp(`\\b(?:install|set)\\b.{1,96}\\bas\\s+(?:an?\\s+)?(?:open\\s+|covert\\s+|secret\\s+)?${PUPPET_KIND_PATTERN}\\b`, "i"),
  new RegExp(`\\bestablish\\b.{0,96}\\b(?:an?\\s+)?(?:open\\s+|covert\\s+|secret\\s+)?${PUPPET_KIND_PATTERN}\\b`, "i"),
  new RegExp(`\\bbecom(?:e|es|ing|came)\\b.{0,72}\\b(?:an?\\s+)?(?:open\\s+|covert\\s+|secret\\s+)?${PUPPET_KIND_PATTERN}\\b`, "i"),
]);

const NEGATED_INSTALL_PREFIX = /(?:\bdo\s+not\b|\b\w+n't\b|\bdont\b|\bnever\b|\bmust\s+not\b|\bshould\s+not\b|\bwithout\b|\bno\s+longer\b|\bceas(?:e|es|ed|ing)\s+to\b|\bprevent(?:s|ed|ing)?\b(?:\s+\w+){0,3}\s+from\b|\bavoid(?:s|ed|ing)?\b|\bstop(?:s|ped|ping)?\b)\s*$/i;
const NEGATED_INSTALL_WINDOW = /\b(?:not|never|without|prevent|preventing|avoid|avoiding|stop|stopping|no\s+longer|ceas(?:e|es|ed|ing)\s+to\s+be)\b|n't\b/i;
// "Liberate Belarus, which has become a puppet state of Russia": the clause
// describes a puppet that already exists.
const RELATIVE_CLAUSE_PREFIX = /\b(?:which|that|who)\s+(?:has|have|had)\s+(?:already\s+|long\s+|since\s+)?$/i;
// Words that end a subordination rather than create one. A sentence that
// frees, liberates or releases a country, or makes it independent, never asks
// for an install, whatever else it says about puppets.
const RELEASE_RE = /\b(?:liberat(?:e|es|ed|ing|ion)|releas(?:e|es|ed|ing)|emancipat(?:e|es|ed|ing)|free(?:s|d|ing)?\s+\w+(?:\s+\w+){0,3}\s+from|set\s+\w+(?:\s+\w+){0,3}\s+free|breaks?\s+free|(?:grant|give|restore|declare|recogni[sz]e|win|gain|regain)(?:s|ed|ing)?\s+(?:\w+\s+){0,3}independence|make\s+\w+(?:\s+\w+){0,3}\s+independent|end(?:s|ed|ing)?\s+(?:\w+\s+){0,2}(?:puppet|satellite|client|protectorate)|stop(?:s|ped)?\s+being)\b/i;

// The sentence around a match: a release in one sentence does not cancel an
// install asked for in another.
const sentenceAround = (text, start, end) => {
  const before = text.slice(0, start).search(/[.;!?](?=[^.;!?]*$)/);
  const afterOffset = text.slice(end).search(/[.;!?]/);
  return text.slice(before < 0 ? 0 : before + 1, afterOffset < 0 ? text.length : end + afterOffset);
};

const hasNonNegatedInstallMatch = (text, pattern) => {
  const match = pattern.exec(text);
  if (!match) return false;
  const start = Number(match.index) || 0;
  const prefix = text.slice(Math.max(0, start - 24), start);
  if (NEGATED_INSTALL_PREFIX.test(prefix)) return false;
  if (RELATIVE_CLAUSE_PREFIX.test(prefix)) return false;
  if (NEGATED_INSTALL_WINDOW.test(match[0])) return false;
  if (RELEASE_RE.test(sentenceAround(text, start, start + match[0].length))) return false;
  return true;
};

// This is deliberately narrow. It is not a second natural-language planner: it
// only recognizes explicit administrative installation wording that cannot be
// satisfied by prose, a relation score or a treaty. Native world.puppets remains
// the canonical owner of the requested subordination.
export const requestExplicitlyInstallsPuppet = (requestText) => {
  const text = normalizeRequestText(requestText);
  if (!text) return false;
  return PUPPET_INSTALL_PATTERNS.some((pattern) => hasNonNegatedInstallMatch(text, pattern));
};

// Whether the request asks for a puppet. The answer's own requestedSubordination
// is read first: the model that read the request says so in any of the game's
// languages, where the patterns above know only English. They are the fallback
// for an answer without the field (an older or a local model's).
export const gameMasterRequestAsksForPuppet = (candidate, request = "") =>
  typeof candidate?.requestedSubordination === "boolean"
    ? candidate.requestedSubordination
    : requestExplicitlyInstallsPuppet(request);

export const validateGameMasterRequestedPuppetCompleteness = (candidate, { request = "" } = {}) => {
  if (!gameMasterRequestAsksForPuppet(candidate, request)) return "";
  const hasInstall = Array.isArray(candidate?.puppetUpdates) && candidate.puppetUpdates.some(
    (entry) => String(entry?.op ?? "").trim().toLowerCase() === "install",
  );
  if (hasInstall) return "";
  return "The administrator explicitly requested creating a puppet/satellite/protectorate/client relationship, but $.puppetUpdates contains no install operation. Event prose, relation scores and agreements do not establish world.puppets. Add one canonical puppetUpdates install tied to the event that establishes the subordination.";
};
