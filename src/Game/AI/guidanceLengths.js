/*! Open Historia — how long the shipped translations of the default guidance run © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Written by scripts/prompts/record-shipped-guidance.mjs; do not edit by hand.
// For each default guidance passage (keyed by its English text's
// guidanceFingerprint) that a shipped translation (public/lang/prompts/) makes
// longer than the English, the longest translation's length in characters
// (promptCharCount). An edited passage may be 20% longer than the longest
// built-in version of it (guidanceCharLimit in promptGuidance.js). One entry
// per line; a key that appears twice (after a union merge) counts its longest.
const LENGTHS = [
  ["10dh4xsmc04", 1087],
  ["14mgelpun67", 2262],
  ["1ey34rc4y0v", 906],
  ["1h71172kd4s", 3263],
  ["1l1bbetmsml", 877],
  ["1pthcz6y4gd", 419],
  ["1rsdw35p717", 2769],
  ["1szcrjqa717", 1836],
  ["1t4zdj6vgts", 1009],
  ["1un1wf33hnh", 945],
  ["1z148fgshni", 1748],
  ["23im0486m1y", 1882],
  ["24gquibb8zq", 357],
  ["272n6ti45eg", 2865],
  ["27igp7p32cs", 387],
  ["27iifwkovf2", 1587],
  ["290lylkq3bt", 1846],
  ["2a8pnfmf7zx", 7204],
  ["3hh82xw3oc", 2211],
  ["3pgztmnodt", 1192],
  ["acw1b5knmx", 1563],
  ["di3xvtb5hc", 489],
  ["jfc86ycth8", 522],
  ["jvqqg8hpoc", 613],
  ["p2wnpfybgg", 635],
  ["po74hiuj74", 1013],
  ["q8y14dh0f6", 1399],
  ["qd4t5uw5m3", 908],
  ["qp80w3pyt7", 1152],
  ["t6a1fxa6cg", 1602],
  ["v7y724y977", 1217],
  ["yppp07mwus", 365],
];

export const TRANSLATED_GUIDANCE_LENGTHS = new Map();
for (const [fingerprint, length] of LENGTHS) {
  TRANSLATED_GUIDANCE_LENGTHS.set(fingerprint, Math.max(length, TRANSLATED_GUIDANCE_LENGTHS.get(fingerprint) ?? 0));
}
