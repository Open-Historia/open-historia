/*! Open Historia — deterministic ASCII-safe ids for player-authored labels. */

// The id of a label (an institution, a proposal, a case): the game's one rule
// for an id made from a name (server/nameId.js). A label written wholly in a-z
// and 0-9, case and accents aside, keeps the slug it always had, byte for byte;
// any other is "u-" and a hash of the whole label, the hash a label with no
// a-z or 0-9 in it was always given. A label mixing the two used to keep only
// its ASCII part, so "Договор 1997 года" was "1997", every other treaty of
// that year too, and "Пётр I" was "i".
import { latinSlug, nameId } from "../../server/nameId.js";

export const stableAsciiId = (value, { maxLength = 72 } = {}) => {
  const max = Math.max(1, maxLength);
  return nameId(value, (label) => latinSlug(label, max)).slice(0, max);
};
