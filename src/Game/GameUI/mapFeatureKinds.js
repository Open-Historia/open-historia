/*! Open Historia — the feature types the GM tools offer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Map Feature Editor and Add Map Feature (Cheats) offer the kinds the
// Workshop offers (Editor/mapFeatures.js), plus a city, a temporary marker and
// a custom type. Each is shown with the glyph the map actually draws for it
// (Map/vnext/presentationPolicy.js), as the Workshop's map does: the panel
// used to keep icons of its own, and a player picked ⚓ and got ■.
// "temporary marker" matches no family and draws as a landmark (•).

import { MAP_FEATURE_KINDS as WORKSHOP_FEATURE_KINDS } from "../../Editor/mapFeatures.js";
import { getMarkerPresentation } from "../Map/vnext/presentationPolicy.js";

export const GM_MAP_FEATURE_KINDS = Object.freeze([
    { id: "city", label: "City / town" },
    ...WORKSHOP_FEATURE_KINDS,
    { id: "temporary marker", label: "Temporary" },
].map((kind) => Object.freeze({ ...kind, icon: getMarkerPresentation({ kind: kind.id }).glyph }))
    // A type the player names: its glyph follows the words they type.
    .concat(Object.freeze({ id: "other", label: "Other", icon: "+" })));
