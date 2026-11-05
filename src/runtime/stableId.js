/*! Open Historia — deterministic ASCII-safe ids for player-authored labels. */

// Preserve the legacy ASCII slug exactly whenever the input has any ASCII
// letters/numbers. For labels written wholly in another script, fall back to a
// deterministic compact hash instead of collapsing the id to "".
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const hash53 = (value) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

export const stableAsciiId = (value, { maxLength = 72 } = {}) => {
  const folded = clean(value)
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

  const legacy = folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  // Compatibility first: every id the previous implementation could derive
  // stays byte-for-byte identical.
  if (legacy) return legacy.slice(0, Math.max(1, maxLength));

  // Punctuation/whitespace alone is not an identity. Unicode letters/numbers
  // are: Cyrillic, Arabic, CJK, Devanagari, etc. Hash the normalized source so
  // the result stays ASCII-safe for URLs/storage while remaining deterministic.
  if (!/[\p{L}\p{N}]/u.test(folded)) return "";
  return `u-${hash53(folded)}`.slice(0, Math.max(1, maxLength));
};
