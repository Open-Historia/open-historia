/*! Open Historia — the name under a counter © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What sits under a counter on the map: a unit's (Units.jsx), and a named
// formation's among a battlefield's troops (FrontLayers.jsx). Loads in plain
// Node.
//
// The unit's name, as written. It used to lose its English formation words
// ("Division", "Squadron", "Strike Group") and be cut to two words, with a list
// of English and Romance connectives ("of", "the", "de", "von") kept from
// dangling. A French or a Russian name was cut wherever its words happened to
// fall, and its formation words stayed (the owner, 2026-11-13: no keywording
// anywhere). The map wraps a long name under its counter, and where labels
// collide the strongest formation's is the one kept (Units.jsx).
export const shortUnitLabel = (name) => String(name ?? "").replace(/\s+/g, " ").trim();
