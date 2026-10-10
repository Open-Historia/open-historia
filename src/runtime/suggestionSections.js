/*! Open Historia — how a suggestion's map changes are grouped © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The Workshop's review panel lists a suggestion's map changes under these
// headings, and the library's Suggested changes dialog counts them the same
// way. Import-free, so both sides share it without the editor's modules.

export const REVIEW_SECTIONS = [
  { id: "countries", kinds: ["polity-add", "polity-remove", "polity-rename", "polity-change"] },
  { id: "ownership", kinds: ["region-owner"] },
  { id: "borders", kinds: ["borders"] },
  { id: "regions", kinds: ["region-name", "region-type"] },
  { id: "claims", kinds: ["region-claims"] },
  { id: "groups", kinds: ["group-add", "group-remove", "group-change", "region-group"] },
  { id: "cities", kinds: ["city-add", "city-remove", "city-change", "cities-replace"] },
  { id: "units", kinds: ["unit-add", "unit-remove", "unit-change"] },
  { id: "features", kinds: ["marker-add", "marker-remove", "marker-change"] },
  { id: "puppets", kinds: ["puppet-add", "puppet-remove", "puppet-change"] },
  // The basemap and the maps players may switch to, and apart from them the
  // detailed map, which is optional and drawn on top of the basemap.
  { id: "basemaps", kinds: ["background", "allowed-basemaps", "own-basemap-add", "own-basemap-remove", "own-basemap-change"] },
  { id: "detailedMap", kinds: ["detailed-map"] },
  { id: "settings", kinds: ["projection", "map-field"] },
];

export const sectionOfChange = (change) => REVIEW_SECTIONS.find((section) => section.kinds.includes(change?.kind))?.id ?? "settings";
