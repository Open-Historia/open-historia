/*! Open Historia — what a player is told when the host's AI fails © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// When the host's AI cannot do what a player asked (a stat sheet, a country's
// parties, its figures) or cannot write the round, the player is told why, as
// rule 10 asks. It was told in the provider's own words, the same text the
// host's log keeps: what the host's model and provider are, a local server's
// address, and in some providers' refusals part of a key (the review of
// 2026-11-18, security S14, core 10, views 13 N4). A turn's own fallbackReason
// was kept from guests for that reason (host/projection.js); these were not.
//
// So the host is told the failure as it came, and every other player is told
// it in the host's words, one whole sentence (a language puts its words in
// its own order): what kind of failure it was, where the provider's answer
// said so in its own fields (Game/AI/providerErrors.js
// classifyProviderFailure, which a failed request carries as
// `providerFailure`), else what was not done. Never by reading the words of
// the error.
//
// Pure.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const KIND_WORDS = Object.freeze({
  busy: "The host's AI was busy: ask again in a moment.",
  rateLimited: "The host's AI was asked too often just then: ask again in a moment.",
  spent: "The host's AI has used up what it may ask for today.",
  unusable: "The host's AI could not be used.",
  tooBig: "That was too long for the host's AI.",
});

// The kind of failure a request carries, by the provider's own fields; "" for none said.
export const failureKindOf = (failure) => {
  const kind = clean(failure?.providerFailure?.kind ?? failure?.cause?.providerFailure?.kind);
  return Object.hasOwn(KIND_WORDS, kind) ? kind : "";
};

// What a player other than the host is told of a failure of the host's AI:
// its kind when the provider said it, else `fallback` (the host's words for
// what was not done).
export const guestFailureWords = (failure, fallback) => KIND_WORDS[failureKindOf(failure)] ?? clean(fallback);

// What `toHost` or anyone else is told of `failure`.
export const failureWords = (failure, { toHost = false, fallback = "" } = {}) => (toHost
  ? clean(failure?.message || failure) || clean(fallback)
  : guestFailureWords(failure, fallback));
