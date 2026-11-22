/*! Open Historia — the diplomatic map's borders, picked from the sovereign ones © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Each segment of the sovereign borders carries the owners either side of it
// (vnext/politicalBoundaryTopology.js: ownerKey, the names sorted and joined by
// U+001F, and ownerList). The diplomatic map lights some of them with a filter
// alone (DiplomaticLayers.jsx): no new geometry.

const NOTHING = ["==", ["get", "ownerKey"], "\u0000"];

// The borders where belligerents meet, by their pairs (diplomaticViews.js boundaryPairKey).
export const frontFilter = (pairs) => (pairs?.length ? ["in", ["get", "ownerKey"], ["literal", pairs]] : NOTHING);

// The focus country's own border, every segment it is on.
export const focusFilter = (owners) => (owners?.length
  ? ["any", ...owners.map((owner) => ["in", owner, ["get", "ownerList"]])]
  : NOTHING);
