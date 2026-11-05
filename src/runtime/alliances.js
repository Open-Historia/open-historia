/*! Open Historia — alliances that bind © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "Alliances that pull members into wars, with broken treaties costing
// reputation. Alpha's prompt currently says alliances do not create
// belligerency, so this is a rule change."
//
// An alliance was a line in a ledger: the story could remember it or not, and
// nothing in the game made anybody fight for anybody. Now a DEFENSIVE BOND
// binds, and the game itself acts on it. No model is asked.
//
// WHO IS BOUND TO DEFEND WHOM (defendersOf). Three things make a bond:
//
//   an agreement of type alliance or mutual_defense   every party is bound to every other
//   a guarantee                                       its guarantor is bound to its beneficiary, one way
//   a security alliance or defence pact               (world.institutions) every full member to every other
//
// while the agreement is active, or the institution is and the membership full.
//
// WHEN IT COMES DUE. When a war begins, the country it was begun AGAINST (the
// first of its second side) calls on those bound to defend it. A country
// bound to both sides, or already in the war, is not called.
//
//   an ally nobody plays   comes into the war on the defender's side, unless
//                          its relation with the defender is bad
//                          (HONOUR_RELATION_LEAST) or it is too weary of war
//                          already (HONOUR_WEARINESS_MOST): then it BREAKS
//                          the treaty
//   an ally a person plays is ASKED (world.callsToArms): honour it and join
//                          the war, or break the treaty. Nobody joins a war
//                          on a person's behalf. A call left unanswered for
//                          CALL_STANDS_ROUNDS turns is a treaty broken.
//
// A TREATY BROKEN costs the breaker TREATY_BROKEN_REPUTATION of its standing
// in the world (world.internationalReputation), and the bond is gone: it
// leaves the agreement (which ends when fewer than two are left in it). A
// member of an institution that will not fight keeps its seat and pays the
// same.
//
// Pure, and loads in plain Node.

export const DEFENSIVE_AGREEMENT_TYPES = Object.freeze(["alliance", "mutual_defense"]);
export const GUARANTEE_TYPE = "guarantee";
export const DEFENSIVE_INSTITUTION_KINDS = Object.freeze(["security_alliance", "defense_pact"]);
export const CALL_STATUSES = Object.freeze(["open", "honoured", "refused", "lapsed"]);
export const TREATY_BROKEN_REPUTATION = 15;
export const CALL_STANDS_ROUNDS = 2;
// The most allies a war brings in on a side in one turn: the strongest first.
export const ALLIES_CALLED_MOST = 6;
// The most countries the war ledger keeps on a side (Game/AI/nativeWarLedger.js).
export const WAR_SIDE_MOST = 12;
export const HONOUR_RELATION_LEAST = -30;
export const HONOUR_WEARINESS_MOST = 70;
export const CALLS_KEPT_MOST = 40;

const clean = (value, most = 160) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, most).trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);
const figure = (value) => {
  const read = Number(value);
  return Number.isFinite(read) ? read : 0;
};

// ---- who is bound to whom -----------------------------------------------------------------

// Those bound to come to a country's defence: [{ ally, via: { kind, id, title } }],
// each ally once, by the first bond found (an agreement before an institution).
//   kind   "agreement" or "institution"
export const defendersOf = (world, country) => {
  const wanted = fold(country);
  if (!wanted) return [];
  const found = new Map();
  const add = (ally, via) => {
    const key = fold(ally);
    if (key && key !== wanted && !found.has(key)) found.set(key, { ally: clean(ally), via });
  };
  for (const agreement of list(world?.agreements)) {
    if (fold(agreement?.status) !== "active") continue;
    const type = fold(agreement.type);
    const via = { kind: "agreement", id: clean(agreement.id), title: clean(agreement.title) };
    if (type === GUARANTEE_TYPE) {
      const parties = list(agreement.parties);
      const guarantor = clean(agreement.guarantor) || clean(parties[0]);
      const beneficiary = clean(agreement.beneficiary) || clean(parties[1]);
      if (fold(beneficiary) === wanted) add(guarantor, via);
      continue;
    }
    if (!DEFENSIVE_AGREEMENT_TYPES.includes(type)) continue;
    const parties = list(agreement.parties).map((name) => clean(name)).filter(Boolean);
    if (!parties.some((name) => fold(name) === wanted)) continue;
    for (const name of parties) add(name, via);
  }
  const institutions = world?.institutions?.byId && typeof world.institutions.byId === "object" ? Object.values(world.institutions.byId) : [];
  for (const institution of institutions) {
    if (fold(institution?.status) !== "active" || !DEFENSIVE_INSTITUTION_KINDS.includes(fold(institution.kind))) continue;
    const members = list(institution.members).filter((member) => fold(member?.status || "member") === "member").map((member) => clean(member?.polity)).filter(Boolean);
    if (!members.some((name) => fold(name) === wanted)) continue;
    const via = { kind: "institution", id: clean(institution.id), title: clean(institution.shortName) || clean(institution.name) };
    for (const name of members) add(name, via);
  }
  return [...found.values()];
};

// Whether one country is bound to defend another.
export const isBoundToDefend = (world, ally, country) => defendersOf(world, country).some((entry) => fold(entry.ally) === fold(ally));

// ---- calls to arms ------------------------------------------------------------------------

// world.callsToArms: { id, warId, ally, defender, attackers: [names], via: { kind, id, title }, date, round, status, answeredRound? }
export const normalizeCallToArms = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = clean(raw.id, 120);
  const warId = clean(raw.warId);
  const ally = clean(raw.ally);
  const defender = clean(raw.defender);
  if (!id || !warId || !ally || !defender || fold(ally) === fold(defender)) return null;
  const status = CALL_STATUSES.includes(raw.status) ? raw.status : "open";
  const answered = Math.round(figure(raw.answeredRound));
  return {
    id,
    warId,
    ally,
    defender,
    attackers: [...new Set(list(raw.attackers).map((name) => clean(name)).filter(Boolean))].slice(0, WAR_SIDE_MOST),
    via: { kind: raw.via?.kind === "institution" ? "institution" : "agreement", id: clean(raw.via?.id), title: clean(raw.via?.title) },
    date: clean(raw.date, 40),
    round: Math.max(0, Math.round(figure(raw.round))),
    status,
    ...(status !== "open" && answered > 0 ? { answeredRound: answered } : {}),
  };
};

export const normalizeCallsToArms = (value) => {
  const kept = new Map();
  for (const raw of list(value)) {
    const call = normalizeCallToArms(raw);
    if (call) kept.set(call.id, call);
  }
  return [...kept.values()].slice(-CALLS_KEPT_MOST);
};

// The calls that wait for one country's answer ("" for anybody's).
export const openCallsFor = (calls, country = "") => normalizeCallsToArms(calls).filter((call) => call.status === "open" && (!fold(country) || fold(call.ally) === fold(country)));

const callId = (warId, ally) => `call:${clean(warId)}:${fold(ally)}`;
const sidesOf = (war) => [list(war?.sideA).map((name) => clean(name)).filter(Boolean), list(war?.sideB).map((name) => clean(name)).filter(Boolean)];
const active = (war) => fold(war?.status || "active") === "active";

// What the wars that began this turn call for.
//   world        for the bonds (agreements and institutions as the turn ends)
//   wars         the war ledger as the turn ends
//   began        the ids of the wars that began this turn
//   calls        world.callsToArms as the turn began
//   players      the countries people play
//   honours      (ally, defender) => whether an ally nobody plays stands by it (honoursCall)
//   strengthOf   (name) => its weight, to call the strongest first
//   round, date  the turn it now is
// Returns { calls, joins, broken }:
//   calls    the list to keep
//   joins    [{ warId, ally, defender, via }]: allies nobody plays that come in, on the defender's side
//   broken   [{ ally, defender, via, warId }]: treaties broken this turn (an ally that would
//            not come, and a person's call left unanswered too long)
export const callsForTurn = ({ world = {}, wars = [], began = [], calls = [], players = [], honours = null, strengthOf = null, round = 0, date = "" } = {}) => {
  const played = new Set(list(players).map(fold).filter(Boolean));
  const now = Math.max(0, Math.round(figure(round)));
  const warsById = new Map(list(wars).map((war) => [clean(war?.id), war]));
  const joins = [];
  const broken = [];
  const kept = normalizeCallsToArms(calls).map((call) => {
    if (call.status !== "open") return call;
    const war = warsById.get(call.warId);
    const [sideA, sideB] = sidesOf(war);
    // The war is over, or the country came into it some other way: nothing is owed.
    if (!war || !active(war) || [...sideA, ...sideB].some((name) => fold(name) === fold(call.ally))) return { ...call, status: "lapsed", answeredRound: now };
    if (now - call.round < CALL_STANDS_ROUNDS) return call;
    // Silence is an answer.
    broken.push({ ally: call.ally, defender: call.defender, via: call.via, warId: call.warId });
    return { ...call, status: "refused", answeredRound: now };
  });
  const seen = new Set(kept.map((call) => call.id));
  const next = [...kept];
  for (const id of new Set(list(began).map((value) => clean(value)).filter(Boolean))) {
    const war = warsById.get(id);
    if (!war || !active(war)) continue;
    const [attackers, defenders] = sidesOf(war);
    const defender = defenders[0];
    if (!defender || attackers.length === 0) continue;
    const inWar = new Set([...attackers, ...defenders].map(fold));
    let room = WAR_SIDE_MOST - defenders.length;
    const candidates = defendersOf(world, defender)
      .filter((entry) => !inWar.has(fold(entry.ally)))
      // (Bound to the other side as well: it stands aside, and breaks nothing.)
      .filter((entry) => !attackers.some((attacker) => isBoundToDefend(world, entry.ally, attacker)))
      .map((entry) => ({ ...entry, weight: typeof strengthOf === "function" ? figure(strengthOf(entry.ally)) : 0 }))
      .sort((a, b) => b.weight - a.weight || a.ally.localeCompare(b.ally));
    let called = 0;
    for (const entry of candidates) {
      const key = callId(id, entry.ally);
      if (seen.has(key)) continue;
      seen.add(key);
      const call = { id: key, warId: id, ally: entry.ally, defender, attackers, via: entry.via, date: clean(date, 40), round: now };
      if (played.has(fold(entry.ally))) {
        next.push({ ...call, status: "open" });
        continue;
      }
      if (called >= ALLIES_CALLED_MOST || room <= 0) break;
      if (typeof honours === "function" && honours(entry.ally, defender) === false) {
        broken.push({ ally: entry.ally, defender, via: entry.via, warId: id });
        next.push({ ...call, status: "refused", answeredRound: now });
        continue;
      }
      joins.push({ warId: id, ally: entry.ally, defender, via: entry.via });
      next.push({ ...call, status: "honoured", answeredRound: now });
      called += 1;
      room -= 1;
    }
  }
  return { calls: normalizeCallsToArms(next), joins, broken };
};

// Whether an ally nobody plays stands by a defender: it does unless they are on bad terms or it is too weary of war.
//   relation    their relation's score, -100 to 100 (0 where none is recorded)
//   weariness   the ally's own, 0 to 100
export const honoursCall = ({ relation = 0, weariness = 0 } = {}) => figure(relation) >= HONOUR_RELATION_LEAST && figure(weariness) < HONOUR_WEARINESS_MOST;

// ---- a treaty broken ----------------------------------------------------------------------

// The world's agreements with one country out of one of them: it leaves the
// agreement, which ends when fewer than two are left in it. An institution is
// left as it is (a member that will not fight keeps its seat).
//   via   { kind, id } of the bond
export const agreementsWithout = (agreements, via, breaker, { date = "", round = 0 } = {}) => {
  if (via?.kind !== "agreement" || !clean(via.id)) return list(agreements);
  const turn = Math.max(0, Math.round(figure(round)));
  return list(agreements).map((agreement) => {
    if (clean(agreement?.id) !== clean(via.id) || fold(agreement.status) !== "active") return agreement;
    const parties = list(agreement.parties).filter((name) => fold(name) !== fold(breaker));
    if (parties.length === list(agreement.parties).length) return agreement;
    const over = parties.length < 2 || fold(agreement.type) === GUARANTEE_TYPE;
    return {
      ...agreement,
      parties: over ? list(agreement.parties) : parties,
      status: over ? "ended" : agreement.status,
      endedDate: over ? clean(date, 40) : clean(agreement.endedDate, 40),
      lastUpdatedDate: clean(date, 40) || clean(agreement.lastUpdatedDate, 40),
      updatedRound: turn,
    };
  });
};

// A country's standing in the world after breaking a treaty: 0 to 100, from 50 where none is recorded.
export const reputationAfterBreaking = (before) => {
  const was = before === null || before === undefined || before === "" || !Number.isFinite(Number(before)) ? 50 : Number(before);
  return Math.max(0, Math.min(100, Math.round(was - TREATY_BROKEN_REPUTATION)));
};

// Who is bound to defend whom, in lines, for the story: the countries at war
// and the countries people play first, as many as fit.
export const describeBonds = (world, countries, { most = 10 } = {}) => {
  const lines = [];
  const seen = new Set();
  for (const country of list(countries)) {
    const key = fold(country);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const allies = defendersOf(world, country);
    if (allies.length === 0) continue;
    const shown = allies.slice(0, 8).map((entry) => entry.ally).join(", ");
    lines.push(`${clean(country)} is defended by ${shown}${allies.length > 8 ? ` and ${allies.length - 8} more` : ""}`);
    if (lines.length >= most) break;
  }
  return lines;
};
