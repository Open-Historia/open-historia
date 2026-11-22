/*! Open Historia — the feature types the GM tools offer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Map Feature Editor and Add Map Feature (Cheats) offer the kinds the
// Workshop offers (Editor/mapFeatures.js), plus a city, a temporary marker and
// a custom type. Each is shown with the glyph the map actually draws for it
// (Map/vnext/presentationPolicy.js), as the Workshop's map does: the panel
// used to keep icons of its own, and a player picked ⚓ and got ■.
// "temporary marker" has no family of its own and draws as a landmark (•).

import { MAP_FEATURE_FAMILIES, MAP_FEATURE_KINDS as WORKSHOP_FEATURE_KINDS } from "../../Editor/mapFeatures.js";
import { kindFamily, normalizeMarkerFamily } from "../../runtime/markerFamily.js";
import { getMarkerPresentation } from "../Map/vnext/presentationPolicy.js";

export const GM_MAP_FEATURE_KINDS = Object.freeze([
    { id: "city", label: "City / town" },
    ...WORKSHOP_FEATURE_KINDS,
    { id: "temporary marker", label: "Temporary" },
].map((kind) => Object.freeze({ ...kind, icon: getMarkerPresentation({ kind: kind.id }).glyph }))
    // A type the player names: drawn as the family picked for it ("Drawn as"),
    // never as the words they type suggest.
    .concat(Object.freeze({ id: "other", label: "Other", icon: "+" })));

// The families a type of the player's own can be drawn as, each with the
// glyph the map draws it with.
export const GM_MAP_FEATURE_FAMILIES = Object.freeze(MAP_FEATURE_FAMILIES.map((family) => Object.freeze({
    ...family,
    icon: getMarkerPresentation({ family: family.id }).glyph,
})));

// The family a structure the Game Master makes or edits is drawn as: its
// type's, for a type the tools offer; the one picked, for a type of the
// player's own ("other"); "" for none, which is a landmark.
export const gmFeatureFamily = (kindId, picked = "") => (kindId === "other" ? normalizeMarkerFamily(picked) : kindFamily(kindId));
