/*! Open Historia — how each war ended © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A war's end used to record no outcome. The ledger said "ended", and nothing in
// the game knew who had lost: not the occupations the war left (issue #1000,
// Poland still German in 1947), not the loser itself. In that save the German
// Reich surrendered in 1945, the story dissolved its government and divided it
// among the Allies, and in 1947 it was still a great power of 38 regions with a
// fleet, a budget and a seat in every block of the prompt. The story had told
// all of it in prose; the one structured way to end a state (a dissolve, with
// every region handed over in the same event) was never written.
//
// So the time skip is asked, in a field its answer must hold (warEndings), how
// each ended war that has no outcome yet ended: which side had lost when it
// ended, whether the losing state's government was dissolved, and if so which
// powers took its land. The game keeps the answer on the war (war.outcome) and
// acts on it: a state dissolved in defeat ends through the one door every
// polity ends by (gameState.js dissolvePolity), its land divided among the
// powers named, each region to the one standing nearest it; and the
// occupations the war left are settled from it (Game/AI/gameplay.js).
//
// The answer is read by its closed set of choices and the map's own names,
// nothing else. Pure, and loads in plain Node.

export const WAR_ENDINGS_FIELD = "warEndings";
// At most this many wars are asked in one skip, the latest ended first; the rest wait for the next.
export const WAR_ENDING_KEYS_MOST = 8;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

// A recorded outcome as the war ledger keeps it: { lost: [names], dissolved: [names], date }, or null.
export const normalizeWarOutcome = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const names = (entries) => [...new Map(list(entries).map(clean).filter(Boolean).map((name) => [fold(name), name])).values()].slice(0, 64);
  const lost = names(value.lost);
  const dissolved = names(value.dissolved).filter((name) => lost.some((loser) => fold(loser) === fold(name)));
  const date = clean(value.date);
  return { lost, dissolved, ...(date ? { date } : {}) };
};

const dissolvedPolity = (world, name) => fold(world?.polityOverrides?.[clean(name)]?.status) === "dissolved";

// The ended wars the skip is asked about: no outcome yet, and on each side a
// polity still standing (a war whose whole side is gone has nobody left to
// settle anything with). The latest ended first, at most `most`, keyed w1, w2…
// [{ key, id, title, ended, note, sideA, sideB }]
export const warsAwaitingOutcome = (world, { most = WAR_ENDING_KEYS_MOST } = {}) => list(world?.wars)
  .filter((war) => fold(war?.status) === "ended" && !normalizeWarOutcome(war?.outcome))
  .filter((war) => [war?.sideA, war?.sideB].every((side) => list(side).some((name) => clean(name) && !dissolvedPolity(world, name))))
  .sort((a, b) => clean(b?.endedDate).localeCompare(clean(a?.endedDate)) || clean(a?.id).localeCompare(clean(b?.id)))
  .slice(0, Math.max(0, most))
  .map((war, index) => ({
    key: `w${index + 1}`,
    id: clean(war.id),
    title: clean(war.title),
    ended: clean(war.endedDate),
    note: clean(war.note).slice(0, 200),
    sideA: list(war.sideA).map(clean).filter(Boolean),
    sideB: list(war.sideB).map(clean).filter(Boolean),
  }));

// A side as the choices name it: its one member, or its members (the first three, and how many more).
export const sideLabel = (side) => {
  const names = list(side);
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
};
export const NEITHER_LOST = "neither side lost";
const LOST = " lost at the end";
const DISSOLVED = "; its government was dissolved";

// What each key may answer: a side lost, or (a side of one state) lost and its
// government was dissolved, or neither. Asked "who lost", a live skip answered
// the side that lost the war's first year (issue #1000: "Poland lost", Poland
// having fallen in 1939); who had lost when it ENDED is what is asked.
export const warOutcomeChoices = (entry) => {
  const choices = [];
  for (const side of [entry?.sideA, entry?.sideB]) {
    choices.push(`${sideLabel(side)}${LOST}`);
    if (list(side).length === 1) choices.push(`${sideLabel(side)}${LOST}${DISSOLVED}`);
  }
  choices.push(NEITHER_LOST);
  return choices;
};

// The answer as written: { w1: { outcome, landTo }, … } (or several such objects, a skip in segments),
// read against the wars asked (`entries`). `knownPolity(name)` gives a polity's name as the map writes it,
// or "" for none. [{ warId, lost: [names], won: [names], dissolved: name or "", landTo: [names] }]
export const readWarEndings = (value, entries, { knownPolity = (name) => clean(name) } = {}) => {
  const byKey = new Map(list(entries).map((entry) => [fold(entry.key), entry]));
  const read = [];
  const done = new Set();
  for (const object of (Array.isArray(value) ? value : [value]).filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))) {
    for (const [key, answer] of Object.entries(object)) {
      const entry = byKey.get(fold(key));
      if (!entry || done.has(entry.id)) continue;
      const said = fold(typeof answer === "string" ? answer : answer?.outcome);
      if (!said) continue;
      let lost = null;
      let won = null;
      let dissolved = "";
      if (said === fold(NEITHER_LOST)) {
        lost = [];
        won = [];
      } else {
        for (const [side, other] of [[entry.sideA, entry.sideB], [entry.sideB, entry.sideA]]) {
          if (said === fold(`${sideLabel(side)}${LOST}`)) [lost, won] = [side, other];
          else if (side.length === 1 && said === fold(`${sideLabel(side)}${LOST}${DISSOLVED}`)) [lost, won, dissolved] = [side, other, side[0]];
        }
      }
      if (!lost) continue;
      done.add(entry.id);
      const landTo = dissolved
        ? [...new Map(String(typeof answer === "object" ? answer?.landTo ?? "" : "").split(/[,;\n]/)
          .map((name) => knownPolity(clean(name))).filter(Boolean)
          .filter((name) => fold(name) !== fold(dissolved))
          .map((name) => [fold(name), name])).values()]
        : [];
      read.push({ warId: entry.id, lost, won, dissolved, landTo });
    }
  }
  return read;
};

// The wars with what was read recorded on them, a new list (the same list when nothing was read).
export const recordWarEndings = (wars, read, { date = "" } = {}) => {
  const byId = new Map(list(read).map((entry) => [entry.warId, entry]));
  if (byId.size === 0) return wars;
  return list(wars).map((war) => {
    const entry = byId.get(clean(war?.id));
    if (!entry || normalizeWarOutcome(war?.outcome)) return war;
    return { ...war, outcome: normalizeWarOutcome({ lost: entry.lost, dissolved: entry.dissolved ? [entry.dissolved] : [], date }) };
  });
};

// The side of a recorded outcome a polity is on: "lost", "won", or "" (not a party, or nobody lost).
export const outcomeSideOf = (war, name) => {
  const outcome = normalizeWarOutcome(war?.outcome);
  if (!outcome || outcome.lost.length === 0) return "";
  if (outcome.lost.some((loser) => fold(loser) === fold(name))) return "lost";
  const losers = new Set(outcome.lost.map(fold));
  const sideA = list(war?.sideA).map(fold);
  const losingSide = sideA.some((member) => losers.has(member)) ? sideA : list(war?.sideB).map(fold);
  const winningSide = losingSide === sideA ? list(war?.sideB).map(fold) : sideA;
  return winningSide.includes(fold(name)) ? "won" : "";
};

// A dissolved state's land, divided among the powers that took it, in shares as
// near equal as the count allows (a defeated state divided among four powers is
// divided four ways), each region to the nearest of them that still has room:
// every pair of region and heir is taken in order of distance (centroid to the
// nearest land the heir holds, east-west the short way round the world and
// scaled by latitude), and a region goes to the first heir it meets that has
// not yet its share. Nearest alone gave all of Germany to the two powers with
// land beside it, and none to the two that held none there (issue #1000's save:
// the United States and the United Kingdom); with shares, the far ones take the
// land left between, as their zones of occupation did.
// `regions`: [{ id, centroid: [lng, lat] }] of the land to divide; `heldBy(heir)`:
// the centroids of the land each heir holds. An heir holding nothing on the map
// stands nowhere and takes nothing, unless no heir holds anything; a region with
// no position goes to the heir with the fewest so far. Map regionId -> heir.
export const divideLand = (regions, heirs, heldBy) => {
  const names = [...new Set(list(heirs).map(clean).filter(Boolean))];
  const out = new Map();
  if (names.length === 0) return out;
  const valid = (point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));
  const at = (point) => [Number(point[0]), Number(point[1])];
  const apart = (a, b) => {
    const dx = ((((a[0] - b[0]) % 360) + 540) % 360) - 180;
    return Math.hypot(dx * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), a[1] - b[1]);
  };
  const sites = names.map((name) => ({ name, points: list(typeof heldBy === "function" ? heldBy(name) : []).filter(valid).map(at) }));
  const standing = sites.some((site) => site.points.length > 0) ? sites.filter((site) => site.points.length > 0) : sites;
  const land = list(regions).filter((region) => clean(region?.id));
  const share = Math.ceil(land.length / standing.length);
  const taken = new Map(standing.map((site) => [site.name, 0]));
  const give = (id, name) => {
    out.set(id, name);
    taken.set(name, taken.get(name) + 1);
  };
  const pairs = [];
  for (const region of land) {
    if (!valid(region.centroid)) continue;
    const point = at(region.centroid);
    for (const site of standing) {
      let nearest = site.points.length ? Infinity : 0;
      for (const other of site.points) nearest = Math.min(nearest, apart(point, other));
      pairs.push({ id: clean(region.id), name: site.name, distance: nearest });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance || names.indexOf(a.name) - names.indexOf(b.name));
  for (const { id, name, distance } of pairs) {
    if (out.has(id) || taken.get(name) >= share || !Number.isFinite(distance)) continue;
    give(id, name);
  }
  // A region with no position (or none left a place by the shares): the heir with the fewest.
  for (const region of land) {
    const id = clean(region.id);
    if (out.has(id)) continue;
    give(id, [...standing].sort((a, b) => taken.get(a.name) - taken.get(b.name) || names.indexOf(a.name) - names.indexOf(b.name))[0].name);
  }
  return out;
};
