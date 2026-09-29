/*! Open Historia — the region card's Region info © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the region card's "Region info" button opens: the cities in the region
// and the regions next to it, with who holds each. The same questions the AI's
// region_info lookup answers (AI/lookupTools.js), answered from what the map
// already holds in memory — the compact region catalog the map primes
// (assets.js getPrimedScenarioRegionCatalog) and the city rows it publishes
// for the search bar (placeSearch.js) — so it costs no read and no request.
// Pure, so it runs in node tests.

const MAX_CITIES = 12;
const MAX_NEIGHBOURS = 24;
// Two regions whose boxes come this close are taken to touch (lookupTools.js).
const ADJACENCY_GAP_DEGREES = 0.05;

const clean = (value) => String(value ?? "").trim();

// [[west, south], [east, north]], east beyond 180 for a box that crosses the
// antimeridian (assets.js geometryBounds).
const boxOf = (entry) => {
  const bounds = entry?.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 2) return null;
  const [[west, south] = [], [east, north] = []] = bounds;
  return [west, south, east, north].every(Number.isFinite) ? { west, south, east, north } : null;
};

const boxesTouch = (a, b) => {
  if (!a || !b) return false;
  const latTouch = a.south <= b.north + ADJACENCY_GAP_DEGREES && b.south <= a.north + ADJACENCY_GAP_DEGREES;
  if (!latTouch) return false;
  return [-360, 0, 360].some((shift) =>
    a.west <= b.east + shift + ADJACENCY_GAP_DEGREES && b.west + shift <= a.east + ADJACENCY_GAP_DEGREES);
};

const boxHolds = (box, lng, lat) =>
  Boolean(box) && lat >= box.south && lat <= box.north
  && [lng, lng + 360].some((x) => x >= box.west && x <= box.east);

const centroidOf = (entry, box) => {
  const lng = Number(entry?.lng);
  const lat = Number(entry?.lat);
  if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
  return box ? [(box.west + box.east) / 2, (box.south + box.north) / 2] : null;
};

const distanceSquared = ([lng, lat], [x, y]) => {
  const dLng = Math.min(Math.abs(lng - x), 360 - Math.abs(lng - x));
  return dLng ** 2 + (lat - y) ** 2;
};

/**
 * @param regionId  the region's id (GID_1 or a drawn region's id)
 * @param catalog   [{ id, name, country, lng, lat, adjacencies, bounds }]
 * @param cities    [{ name, lng, lat, population, capital }]
 * @param ownerOf   (regionId, entry) => the region's current holder ("" if unowned)
 * @param cityRenames world.cityRenames ({ lowercased old name: new name })
 * @returns { cities: [{ name, population, capital }], neighbours: [{ owner, regions: [name] }] }
 *          or null when the catalog does not know the region
 */
export const regionInfoFor = ({ regionId, catalog, cities = [], ownerOf = (_id, entry) => clean(entry?.country), cityRenames = {} } = {}) => {
  const id = clean(regionId);
  const rows = Array.isArray(catalog) ? catalog.filter((entry) => clean(entry?.id)) : [];
  const row = id ? rows.find((entry) => clean(entry.id) === id) : null;
  if (!row) return null;
  const box = boxOf(row);

  // Neighbours: the map author's declared adjacencies where the map has them
  // (either direction counts), else the regions whose boxes touch this one's.
  const declared = new Set(Array.isArray(row.adjacencies) ? row.adjacencies.map(clean).filter(Boolean) : []);
  for (const other of rows) {
    if (Array.isArray(other.adjacencies) && other.adjacencies.map(clean).includes(id)) declared.add(clean(other.id));
  }
  declared.delete(id);
  const neighbourRows = declared.size
    ? rows.filter((other) => declared.has(clean(other.id)))
    : box
      ? rows.filter((other) => other !== row && boxesTouch(box, boxOf(other)))
      : [];
  const byOwner = new Map();
  for (const other of neighbourRows.slice(0, MAX_NEIGHBOURS)) {
    const owner = clean(ownerOf(clean(other.id), other));
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(clean(other.name) || clean(other.id));
  }
  const neighbours = [...byOwner.entries()]
    .map(([owner, regions]) => ({ owner, regions: regions.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => b.regions.length - a.regions.length || a.owner.localeCompare(b.owner));

  // Cities: inside this region's box, and nearer its centre than the centre of
  // any other region whose box also holds them. Without polygons that is the
  // best the catalog can say, as it is for the AI's lookup.
  const renames = new Map(Object.entries(cityRenames ?? {}).map(([from, to]) => [clean(from).toLowerCase(), clean(to)]));
  const boxes = rows.map((entry) => ({ entry, box: boxOf(entry) }));
  const inRegion = [];
  for (const city of Array.isArray(cities) ? cities : []) {
    const lng = Number(city?.lng);
    const lat = Number(city?.lat);
    const name = clean(city?.name);
    if (!name || !Number.isFinite(lng) || !Number.isFinite(lat) || !boxHolds(box, lng, lat)) continue;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const { entry, box: otherBox } of boxes) {
      if (!boxHolds(otherBox, lng, lat)) continue;
      const centre = centroidOf(entry, otherBox);
      if (!centre) continue;
      const distance = distanceSquared(centre, [lng, lat]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = entry;
      }
    }
    if (nearest !== row) continue;
    inRegion.push({
      name: renames.get(name.toLowerCase()) || name,
      population: Math.max(0, Number(city.population) || 0),
      capital: Boolean(city.capital),
    });
  }
  inRegion.sort((a, b) => Number(b.capital) - Number(a.capital) || b.population - a.population || a.name.localeCompare(b.name));

  return { cities: inRegion.slice(0, MAX_CITIES), neighbours };
};
