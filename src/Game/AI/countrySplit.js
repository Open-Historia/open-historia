/*! Open Historia — a country split in two: which of its regions a breakaway takes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make it so the ai can very easily create a civil war and split a country in 2"
// (the owner, 2026-11-10).
//
// Before this, a civil war on the map was one control entry per region, each
// named: forty lines for half of a large country, which no model writes in a
// skip. Now one entry does it. A control (civil war) or transfer (an agreed
// partition) whose region is "country: <name>" carries `part`: the side of the
// country the breakaway holds ("north", "the southeast") or the place its half
// centres on ("around Aleppo", "Benghazi"), with a share if it is not half
// ("east 30%"). This module picks the regions; gameplay.js (splitCountryOps)
// writes one entry for each and, for a civil war, the war.
//
// The government keeps the region of its capital, unless the part names it.
// Pure: positions in, region ids out.

import { noteReceipt } from "../../runtime/applicationReceipt.js";
import { warBetween } from "../../runtime/peaceTerms.js";
import { decodeWarUpdates } from "./nativeWarLedger.js";

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const fold = (value) => clean(value).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export const SPLIT_SHARE_DEFAULT = 0.5;
export const SPLIT_SHARE_LEAST = 0.15;
export const SPLIT_SHARE_MOST = 0.85;

// A unit vector for each way a part can lie, east and north positive.
const DIAGONAL = Math.SQRT1_2;
const DIRECTIONS = Object.freeze({
  north: [0, 1],
  south: [0, -1],
  east: [1, 0],
  west: [-1, 0],
  northeast: [DIAGONAL, DIAGONAL],
  northwest: [-DIAGONAL, DIAGONAL],
  southeast: [DIAGONAL, -DIAGONAL],
  southwest: [-DIAGONAL, -DIAGONAL],
});

// "north", "the North-East", "northern half", "east 30%", "around Aleppo 40%", "Benghazi":
// { direction } or { place }, and the share (0.15 to 0.85; half when none is given).
export const readSplitPart = (value) => {
  let text = clean(value);
  let share = SPLIT_SHARE_DEFAULT;
  const percent = text.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
  if (percent) {
    share = Number(percent[1].replace(",", ".")) / 100;
    text = text.replace(percent[0], " ");
  } else {
    const fraction = text.match(/\b(0?[.,]\d+)\b/);
    if (fraction) {
      share = Number(fraction[1].replace(",", "."));
      text = text.replace(fraction[0], " ");
    }
  }
  share = Math.min(SPLIT_SHARE_MOST, Math.max(SPLIT_SHARE_LEAST, Number.isFinite(share) ? share : SPLIT_SHARE_DEFAULT));
  const words = fold(text)
    .replace(/\b(the|of|half|part|side|regions?|country|its|around|centred|centered|on|in|from)\b/g, " ")
    .replace(/\b(north|south)\s+(east|west)/g, "$1$2")
    .replace(/\b(north|south|east|west)(?:ern)?\b/g, "$1")
    .replace(/\b(northeast|northwest|southeast|southwest)(?:ern)?\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (DIRECTIONS[words]) return { direction: words, share };
  const place = clean(text).replace(/^(?:around|centred on|centered on|from|in)\s+/i, "").replace(/^region:\s*/i, "").trim();
  return { place: place || "", share };
};

// Longitudes of a country that crosses the antimeridian read on one side of it.
const unwrap = (rows) => {
  const angles = rows.map((row) => (row.centroid[0] * Math.PI) / 180);
  const reference = Math.atan2(
    angles.reduce((sum, angle) => sum + Math.sin(angle), 0),
    angles.reduce((sum, angle) => sum + Math.cos(angle), 0),
  ) * (180 / Math.PI);
  return (lng) => {
    let shifted = lng;
    while (shifted - reference > 180) shifted -= 360;
    while (shifted - reference < -180) shifted += 360;
    return shifted;
  };
};

// Which of a country's regions the breakaway takes.
//   regions        [{ id, name, centroid: [lng, lat] }] the country holds now
//   part           what the entry said (readSplitPart reads it)
//   capitalRegion  the id of the region its capital is in, or ""
//   places         [{ name, point: [lng, lat] }] towns the part may name
//   most           a cap on the share (the player's own country)
// Returns { ids, seed, share, why }: ids empty when the country cannot be split.
export const splitRegions = ({ regions = [], part = "", capitalRegion = "", places = [], most = SPLIT_SHARE_MOST } = {}) => {
  const rows = regions.filter((row) => clean(row?.id) && Array.isArray(row?.centroid) && row.centroid.every(Number.isFinite));
  if (rows.length < 2) return { ids: [], seed: "", share: 0, why: "the country holds fewer than two regions" };
  const read = readSplitPart(part);
  const share = Math.min(read.share, most);
  const lngOf = unwrap(rows);
  const meanLat = rows.reduce((sum, row) => sum + row.centroid[1], 0) / rows.length;
  const scale = Math.cos((meanLat * Math.PI) / 180) || 1;
  const point = ([lng, lat]) => [lngOf(lng) * scale, lat];
  const at = new Map(rows.map((row) => [row.id, point(row.centroid)]));
  const count = Math.min(rows.length - 1, Math.max(1, Math.round(rows.length * share)));
  const capital = clean(capitalRegion);

  let order;
  let seed = "";
  if (read.direction) {
    const [dx, dy] = DIRECTIONS[read.direction];
    order = [...rows].sort((a, b) => (at.get(b.id)[0] * dx + at.get(b.id)[1] * dy) - (at.get(a.id)[0] * dx + at.get(a.id)[1] * dy));
    seed = read.direction;
  } else {
    // A place: a region of that name, or a town in the country, else no place at all.
    const wanted = fold(read.place);
    const named = wanted ? rows.find((row) => fold(row.name) === wanted) : null;
    const town = !named && wanted ? places.find((entry) => fold(entry?.name) === wanted && Array.isArray(entry?.point)) : null;
    let from = named ? at.get(named.id) : town ? point(town.point) : null;
    seed = named?.name || town?.name || "";
    if (!from) {
      // Nothing named: the far side of the country from its capital (or from its middle).
      const middle = capital && at.get(capital)
        ? at.get(capital)
        : [rows.reduce((sum, row) => sum + at.get(row.id)[0], 0) / rows.length, rows.reduce((sum, row) => sum + at.get(row.id)[1], 0) / rows.length];
      const far = [...rows].sort((a, b) => distance(at.get(b.id), middle) - distance(at.get(a.id), middle))[0];
      from = at.get(far.id);
      seed = far.name || far.id;
    }
    order = [...rows].sort((a, b) => distance(at.get(a.id), from) - distance(at.get(b.id), from));
  }
  // The government keeps its capital, unless the part names that very region.
  const keepsCapital = capital && !(read.place && fold(read.place) === fold(rows.find((row) => row.id === capital)?.name));
  const ids = order.filter((row) => !(keepsCapital && row.id === capital)).slice(0, count).map((row) => row.id);
  return { ids, seed, share, why: "" };
};

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// A country split in two by one entry (AI/countrySplit.js): a control (a civil
// war) or transfer (a partition) whose region is "country: <name>" and which
// carries `part`. Written out here as one entry for each region the breakaway
// takes, before the transfers are resolved; for a civil war the war is started
// too, unless the answer already starts or has one between them. The player's
// own country loses at most a third in one entry.
const PLAYER_SPLIT_MOST = 1 / 3;
export const splitCountryOps = async (candidate, containers, { receipt = null, lookupContext, playerCountry = "", titleAt = () => "", wars = [] } = {}) => {
  const same = (value) => clean(value).toLowerCase();
  const entries = [];
  for (const [index, { impacts, path }] of containers.entries()) {
    for (const family of ["regionControlOps", "regionTransfers"]) {
      for (const entry of list(impacts?.[family])) {
        if (!clean(entry?.part) || !/^country:/i.test(clean(entry?.regionId))) continue;
        if (family === "regionControlOps" && clean(entry?.op).toLowerCase() !== "control") continue;
        entries.push({ index, impacts, path, family, entry });
      }
    }
  }
  if (!entries.length) return 0;
  let context;
  try {
    context = await lookupContext();
  } catch (error) {
    console.warn("[split] the map could not be read; the split entries are left to the resolver.", error);
    return 0;
  }
  const player = context.resolveOwner(playerCountry) || clean(playerCountry);
  const warLines = [];
  const startedWars = decodeWarUpdates(candidate?.warUpdates);
  const atWar = (a, b) => Boolean(warBetween(wars, a, b)) || list(startedWars).some((war) => {
    const sides = [list(war?.actors), list(war?.opponents)].map((side) => side.map((name) => same(name)));
    return (sides[0].includes(same(a)) && sides[1].includes(same(b))) || (sides[0].includes(same(b)) && sides[1].includes(same(a)));
  });
  let written = 0;
  for (const { index, impacts, path, family, entry } of entries) {
    const country = context.resolveOwner(clean(entry.regionId).replace(/^country:\s*/i, "")) || context.resolveOwner(entry.fromCode);
    const breakaway = clean(entry.toCode);
    const rows = country ? list(context.ownerRows.get(country)) : [];
    const title = titleAt(path);
    const label = `${title ? `Event "${title}": ` : ""}`;
    if (!country || !breakaway || context.resolveOwner(breakaway) === country || rows.length < 2) {
      noteReceipt(receipt, "dropped", `${label}the split of ${clean(entry.regionId).replace(/^country:\s*/i, "")} (${clean(entry.part)}) was not made: ${!country ? "no country of that name holds land" : !breakaway ? "it names no breakaway" : rows.length < 2 ? "it holds fewer than two regions" : "the breakaway is the country itself"}.`);
      impacts[family] = list(impacts[family]).filter((item) => item !== entry);
      continue;
    }
    const capital = (() => {
      const held = context.cityRows.filter((city) => city.capital && context.regionOfCity(city)?.owner === country);
      const byPopulation = (cities) => [...cities].sort((a, b) => b.population - a.population);
      return byPopulation(held.filter((city) => same(city.capital) === "primary"))[0] ?? byPopulation(held)[0] ?? null;
    })();
    const places = context.cityRows.filter((city) => context.regionOfCity(city)?.owner === country).map((city) => ({ name: city.name, point: city.coordinates }));
    const picked = splitRegions({
      regions: rows.map((row) => ({ id: row.id, name: row.name, centroid: row.centroid })),
      part: entry.part,
      capitalRegion: capital ? context.regionOfCity(capital)?.id ?? "" : "",
      places,
      most: country === player ? PLAYER_SPLIT_MOST : undefined,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const { part, ...base } = entry;
    delete base.wholeCountry;
    const expanded = picked.ids.map((id) => ({
      ...base,
      regionId: id,
      regionName: byId.get(id)?.name || id,
      fromCode: country,
      toCode: breakaway,
    }));
    impacts[family] = list(impacts[family]).flatMap((item) => (item === entry ? expanded : [item]));
    // A breakaway not yet on the map is founded by this event, so its land has an owner the resolver knows.
    const declared = list(impacts.polityChanges).some((change) => ["create", "restore"].includes(same(change?.operation)) && same(change?.code) === same(breakaway));
    if (!context.resolveOwner(breakaway) && !declared) impacts.polityChanges = [...list(impacts.polityChanges), { operation: "create", code: breakaway }];
    written += expanded.length;
    const civilWar = family === "regionControlOps";
    noteReceipt(receipt, "adjusted", `${label}${breakaway} takes ${expanded.length} of ${country}'s ${rows.length} regions (${clean(part)}${picked.seed && picked.seed !== clean(part) ? `, from ${picked.seed}` : ""})${civilWar ? ", held in a civil war" : " by partition"}.`);
    console.info(`[ai] ${path}.${family}: ${breakaway} splits from ${country}: ${expanded.length} region(s) (${clean(part)}).`);
    if (civilWar && !atWar(country, breakaway) && !warLines.some((line) => line.includes(`~${breakaway}~${country}~`))) {
      const slug = fold(`${country} ${breakaway}`).replace(/\s+/g, "-").slice(0, 60);
      warLines.push(`war-civil-${slug}~start~${breakaway}~${country}~${index + 1}~Title: ${country} Civil War; ${breakaway} breaks away from ${country}`);
    }
  }
  if (warLines.length) {
    const before = candidate.warUpdates;
    candidate.warUpdates = Array.isArray(before)
      ? [...before, ...warLines]
      : [clean(before), ...warLines].filter(Boolean).join("\n");
    for (const line of warLines) console.info(`[ai] warUpdates: ${line.split("~")[0]} started for the split.`);
  }
  return written;
};

