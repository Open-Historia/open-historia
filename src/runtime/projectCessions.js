/*! Open Historia — a person's land is theirs to give © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A completed project may cede a region to whomever its plan names (runtime/
// projectEngine.js territory effects, applied as a border change by the turn,
// AI/gameplay.js runProjectsEngine). A region a person holds, where the project
// is not that person's own, is left out of it: a player's project took another
// player's region with no war and no consent, and an AI's could do the same to
// the player (the gap audit of 2026-11-18). War still takes land; a cession is
// signed by the side that gives it.
//
// Held as the title settlement reads it (runtime/gameState.js
// applyEventImpactsToWorld): the recorded sovereign, else the controller, else
// the map's own owner (the region catalog's bakedOwner, else its country), else
// the transfer's own fromCode. Pure.

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
// The same fold the turn compares polity names by (gameplay.js regionKey).
const fold = (value) => text(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// `transfers`: a completion's regionTransfers, resolved to region ids. `owner`:
// the project's own government. `people`: the countries people play.
// `catalog`: the active map's region rows ({ id, bakedOwner?, country? }).
// Returns { kept, refused }, each refused transfer with its `holder`.
export const cessionsPeopleKeep = ({ transfers = [], owner = "", people = [], world = {}, catalog = null } = {}) => {
  const persons = list(people).map(fold).filter(Boolean);
  if (!persons.length) return { kept: list(transfers), refused: [] };
  const mapOwner = new Map(list(catalog).filter((row) => text(row?.id))
    .map((row) => [text(row.id), text(Object.hasOwn(row, "bakedOwner") ? row.bakedOwner : row.country || row.countryCode)]));
  const holderOf = (regionId) => text(world?.regionSovereigntyOverrides?.[regionId])
    || text(world?.regionOwnershipOverrides?.[regionId])
    || mapOwner.get(regionId) || "";
  const kept = [];
  const refused = [];
  for (const transfer of list(transfers)) {
    const holder = holderOf(text(transfer?.regionId)) || text(transfer?.fromCode);
    const theirs = Boolean(holder) && persons.includes(fold(holder)) && fold(holder) !== fold(owner) && fold(holder) !== fold(transfer?.toCode);
    if (theirs) refused.push({ ...transfer, holder });
    else kept.push(transfer);
  }
  return { kept, refused };
};
