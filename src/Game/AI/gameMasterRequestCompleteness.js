/*! Open Historia — GM request completeness guards © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

const normalizeRequestText = (value) => String(value ?? "")
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const PUPPET_KIND_PATTERN = "(?:puppet(?:\\s+state)?|satellite(?:\\s+state)?|protectorate|client\\s+state)";

const PUPPET_INSTALL_PATTERNS = Object.freeze([
  new RegExp(`\\bmake\\b.{1,96}\\b(?:an?\\s+)?(?:open\\s+|covert\\s+|secret\\s+)?${PUPPET_KIND_PATTERN}\\b`, "i"),
  new RegExp(`\\bturn\\b.{1,96}\\binto\\s+(?:an?\\s+)?(?:open\\s+|covert\\s+|secret\\s+)?${PUPPET_KIND_PATTERN}\\b`, "i"),
  new RegExp(`\\b(?:install|set)\\b.{1,96}\\bas\\s+(?:an?\\s+)?(?:open\\s+|covert\\s+|secret\\s+)?${PUPPET_KIND_PATTERN}\\b`, "i"),
  new RegExp(`\\bestablish\\b.{0,96}\\b(?:an?\\s+)?(?:open\\s+|covert\\s+|secret\\s+)?${PUPPET_KIND_PATTERN}\\b`, "i"),
  new RegExp(`\\bbecom(?:e|es|ing|came)\\b.{0,72}\\b(?:an?\\s+)?(?:open\\s+|covert\\s+|secret\\s+)?${PUPPET_KIND_PATTERN}\\b`, "i"),
]);

const NEGATED_INSTALL_PREFIX = /(?:\bdo\s+not\b|\bdon't\b|\bdont\b|\bnever\b|\bmust\s+not\b|\bshould\s+not\b|\bwithout\b|\bprevent(?:s|ed|ing)?\b(?:\s+\w+){0,3}\s+from\b|\bavoid(?:s|ed|ing)?\b|\bstop(?:s|ped|ping)?\b)\s*$/i;
const NEGATED_INSTALL_WINDOW = /\b(?:not|never|without|prevent|preventing|avoid|avoiding|stop|stopping)\b/i;

const hasNonNegatedInstallMatch = (text, pattern) => {
  const match = pattern.exec(text);
  if (!match) return false;
  const start = Number(match.index) || 0;
  const prefix = text.slice(Math.max(0, start - 24), start);
  if (NEGATED_INSTALL_PREFIX.test(prefix)) return false;
  if (NEGATED_INSTALL_WINDOW.test(match[0])) return false;
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

export const validateGameMasterRequestedPuppetCompleteness = (candidate, { request = "" } = {}) => {
  if (!requestExplicitlyInstallsPuppet(request)) return "";
  const hasInstall = Array.isArray(candidate?.puppetUpdates) && candidate.puppetUpdates.some(
    (entry) => String(entry?.op ?? "").trim().toLowerCase() === "install",
  );
  if (hasInstall) return "";
  return "The administrator explicitly requested creating a puppet/satellite/protectorate/client relationship, but $.puppetUpdates contains no install operation. Event prose, relation scores and agreements do not establish world.puppets. Add one canonical puppetUpdates install tied to the event that establishes the subordination.";
};
