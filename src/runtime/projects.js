import { compareGameDates } from "./gameDates.js";
import { sameName } from "../../server/nameKey.js";

/*! Open Historia — portions (projects & operations board: derived status, sorting, filtering) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Everything the Projects & Operations board works out for ITSELF, with no AI
// turn involved: which entries are open, whose they are, how they sort and
// filter, the covert operations that track a real agent, and which of a turn's
// ops address which entry. The clock itself is runtime/projectEngine.js.
//
// DELIBERATELY IMPORT-FREE apart from gameDates.js and server/nameKey.js (which
// import nothing), the same trick unitMotion.js / eventFocus.js use:
// gameState.js reaches assets.js, which imports maplibre-gl, so anything
// importing it cannot be tested without a full install.

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();

// Statuses that are still running. Mirrors projectEngine.js
// OPEN_ENGINE_STATUSES, duplicated only to keep this module import-free.
const OPEN_STATUSES = new Set(["planning", "active", "stalled", "paused"]);

export const isProjectOpen = (project) => OPEN_STATUSES.has(asText(project?.status) || "active");

// The complement, exported so the panel's Closed filter and its count cannot
// drift apart from each other or from the sort.
export const isProjectClosed = (project) => !isProjectOpen(project);

// The next checkpoint still ahead, from the plan: { title, atProgress } or null.
export const nextMilestoneOf = (project) => {
  const ahead = asArray(project?.plan?.milestones).filter((entry) => !entry?.reached && !entry?.missed);
  return ahead.length ? { title: asText(ahead[0].title), atProgress: Number(ahead[0].atProgress) || 0 } : null;
};

// What the card badges, all of it the engine's: open, set up and running (a
// programme), stalled and why, paid less than it is due (underfunded), and
// the next checkpoint.
export const deriveProjectFlags = (project) => {
  const open = isProjectOpen(project);
  const status = asText(project?.status) || "active";
  return {
    open,
    ongoing: Boolean(project?.ongoing || project?.plan?.ongoing),
    running: Boolean(project?.established) && open,
    planning: status === "planning",
    paused: status === "paused",
    stalled: open && status === "stalled",
    stallReason: status === "stalled" ? asText(project?.stallReason) : "",
    underfunded: open && status === "active" && Number(project?.paidShare ?? 1) < 0.9,
    nextMilestone: nextMilestoneOf(project),
  };
};

// ---- sorting ---------------------------------------------------------------

export const PROJECT_SORTS = [
  { key: "updated", label: "Recently updated" },
  { key: "finish", label: "Expected finish" },
  { key: "progress", label: "Progress" },
  { key: "cost", label: "Cost per month" },
  { key: "name", label: "Name" },
  { key: "status", label: "Status" },
];

// Running work above finished work, then by how much trouble it is in. This is
// the tiebreak under every sort.
const STATUS_RANK = {
  stalled: 0,
  active: 1,
  planning: 2,
  paused: 3,
  complete: 4,
  failed: 5,
  cancelled: 6,
};

const statusRank = (project) => {
  const rank = STATUS_RANK[asText(project?.status)];
  return rank === undefined ? 3 : rank;
};

// Undated things sort LAST under a date comparator, rather than first.
const compareDates = (a, b) => {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return compareGameDates(a, b);
};

export const sortProjects = (projects, key = "updated") => {
  const list = [...asArray(projects)];
  const byName = (a, b) => asText(a.name).localeCompare(asText(b.name));

  const comparators = {
    // Most recently touched first. updatedAt is an ISO stamp.
    updated: (a, b) => asText(b.updatedAt).localeCompare(asText(a.updatedAt)) || byName(a, b),
    finish: (a, b) => compareDates(asText(a.targetDate), asText(b.targetDate)) || byName(a, b),
    progress: (a, b) => (Number(b.progress) || 0) - (Number(a.progress) || 0) || byName(a, b),
    cost: (a, b) => (Number(b.plan?.monthlyCost) || 0) - (Number(a.plan?.monthlyCost) || 0) || byName(a, b),
    name: byName,
    status: (a, b) => statusRank(a) - statusRank(b) || byName(a, b),
  };

  const compare = comparators[key] || comparators.updated;
  // Open work always outranks closed work, whatever the chosen sort.
  return list.sort((a, b) => (isProjectOpen(b) ? 1 : 0) - (isProjectOpen(a) ? 1 : 0) || compare(a, b));
};

// ---- filtering -------------------------------------------------------------

// Owner is compared by NAME, because that is the namespace every polity-keyed
// field in world state uses, through the game's one name fold
// (server/nameKey.js, which imports nothing, so this file still runs in a bare
// checkout). Case, accents and punctuation do not make a different owner: the
// model spells a country back the way it remembers it, so the player's own
// programme may arrive owned by "Cote dIvoire" while game.country is "Côte
// d'Ivoire", and filing it under Foreign would cost the player the two levers
// they have over their own work.
//
// A blank ownerCode means the player: the model is not made to restate their
// own country on every entry, since a field it has to repeat is a field it
// eventually gets wrong. Blank is judged on the text itself, never on its fold:
// under the old a-z fold every Chinese or Russian name folded to nothing, so a
// programme owned by "中国" counted as the player's own.
export const isPlayerProject = (project, playerCountry) => {
  if (!asText(project?.ownerCode)) return true;
  return sameName(project.ownerCode, playerCountry);
};

export const isForeignProject = (project, playerCountry) => !isPlayerProject(project, playerCountry);

// The gate on the player's OWN two levers — priority and abandon.
//
// Both mean "how much of MY attention does this get" and "call MY effort off",
// and neither is a thing anyone can do to another government's programme. The
// board tracks a rival's shipbuilding because the player's services have learned
// of it; a slider on it would say they command it. So the panel hides the
// controls, and applyProjectOpsToWorld refuses the op behind them — see the
// `actor` argument there, which is the door that cannot be got round by a stale
// render.
//
// Closed work is excluded for the reason it always was: neither lever means
// anything on an entry that has already ended.
// Whether the player knows of an entry at all. Their own, always. Another
// country's when its owner does not hide it (public), when an agent of theirs
// told of it (linkedSpyIds, spyProvenanceOps), when their services have a view
// on it (verification), or when it was on their board before the engine
// (known: such an entry was there because their services had learned of it).
// What the panel's "Known projects abroad" lists. (Those three fields are what
// the board's own government knows; what anyone else knows is knowledgeOf's.)
export const isKnownToPlayer = (project, playerCountry) => {
  if (isPlayerProject(project, playerCountry)) return true;
  if ((asText(project?.secrecy) || "public") === "public") return true;
  return project?.known === true || asArray(project?.linkedSpyIds).length > 0 || Boolean(asText(project?.verification));
};

export const canPlayerDirect = (project, playerCountry) =>
  isProjectOpen(project) && isPlayerProject(project, playerCountry);

export const filterProjects = (projects, {
  owner = "all",
  query = "",
  statuses = null,
  tags = null,
  playerCountry = "",
} = {}) => {
  const needle = asText(query).toLowerCase();
  const wantedTags = asArray(tags).map((tag) => asText(tag).toLowerCase()).filter(Boolean);
  const wantedStatuses = asArray(statuses).map((status) => asText(status).toLowerCase()).filter(Boolean);

  return asArray(projects).filter((project) => {
    if (!project) return false;

    if (owner === "mine" && !isPlayerProject(project, playerCountry)) return false;
    if (owner === "foreign" && isPlayerProject(project, playerCountry)) return false;

    if (wantedStatuses.length && !wantedStatuses.includes(asText(project.status))) return false;

    // Ticked tags are OR-ed, not AND-ed: picking "military" and "naval" means
    // "show me either", which is what a player ticking two tags in the menu
    // means. AND-ing them mostly produces an empty board.
    if (wantedTags.length) {
      const own = asArray(project.tags).map((tag) => asText(tag).toLowerCase());
      if (!wantedTags.some((tag) => own.includes(tag))) return false;
    }

    if (!needle) return true;
    // Search covers the fields a player would actually type at: what it is
    // called, what it is about, how it is filed, and who is running it.
    return [
      project.name,
      project.summary,
      project.note,
      project.lastUpdate,
      project.ownerCode,
      nextMilestoneOf(project)?.title,
      ...asArray(project.tags),
    ].some((field) => asText(field).toLowerCase().includes(needle));
  });
};

// The tag vocabulary actually present on the board, most-used first, so the
// Tags menu reflects this campaign rather than a fixed list. Open-vocabulary
// tags (see countryTags.js) mean there is no other way to know what exists.
export const collectProjectTags = (projects) => {
  const counts = new Map();
  for (const project of asArray(projects)) {
    for (const tag of asArray(project?.tags)) {
      const key = asText(tag);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
};

// ---- covert operations that track a real agent -----------------------------
// A spy in the field IS a long-running covert operation, so it belongs on the
// board next to everything else the player is running — and the board is where
// the AI can then act on it (an exposed ring stalls the programme it served).
//
// The split of responsibility is deliberate. The ENGINE owns whether an entry
// exists and whether it has ended, because that is bookkeeping and must never
// drift from world.spies. Once it exists it is an ordinary board entry, which
// the projects engine runs like any other (a programme that runs on, set up in
// a month, at no cost of its own).
//
// Deliberately NOT handled here:
//  * `turned`. A double agent still looks alive to its owner, and the player is
//    never told — so the entry carries on exactly as it was. Ending it would
//    leak the one fact the whole mechanic depends on hiding.
//  * `suspected`. Stalling the entry on suspicion reads well, but the model is
//    free to set it back to active on the next jump and the two would flip-flop
//    forever. The Spy tab already flags it, which is the honest place for it.
//  * foreign agents. Another polity's operation inside the player is not the
//    player's programme, and the board is the player's.
const spyIdOf = (project) => asArray(project?.linkedSpyIds).map(asText).find(Boolean) ?? "";

const LIVE_SPY_STATUSES = new Set(["active", "turned"]);

export const spyOperationOps = (spies, projects, { date = "", playerPolity = "" } = {}) => {
  const ops = [];
  const bySpyId = new Map();
  for (const project of asArray(projects)) {
    // The player's OWN operations only. linkedSpyIds is written by two different
    // mechanisms that mean different things: here it means "this entry IS the
    // agent", and in spyProvenanceOps it means "this entry is what the agent told
    // us about someone else". Without this guard a recalled agent closed the
    // FOREIGN intelligence they had reported — stamping "Our agent in X was
    // withdrawn" onto a rival's programme, which is both the wrong entry and a
    // sentence that says out loud the thing the board must never say.
    if (asText(project?.ownerCode)) continue;
    const id = spyIdOf(project);
    if (id) bySpyId.set(id, project);
  }

  const player = asText(playerPolity).toLowerCase();
  for (const spy of asArray(spies)) {
    const id = asText(spy?.id);
    if (!id) continue;
    // A blank owner is a pre-ownership record, which was always the player's.
    const owner = asText(spy?.owner).toLowerCase();
    if (owner && player && owner !== player) continue;

    const target = asText(spy?.target);
    const project = bySpyId.get(id);
    const live = LIVE_SPY_STATUSES.has(asText(spy?.status) || "active");

    if (live && !project) {
      ops.push({
        op: "create",
        name: `Agent in ${target}`,
        kind: "operation",
        secrecy: "covert",
        // Blank means the player's own, so the model is never made to restate it.
        ownerCode: "",
        status: "active",
        // A planted agent runs until it is pulled or caught: a programme that
        // runs on, set up in a month, at no cost of its own (the agent's keep
        // is the Intelligence tab's business).
        ongoing: true,
        plan: { durationDays: 30, monthlyCost: 0, ongoing: true, milestones: [], effects: [], yields: [] },
        startedAt: asText(spy?.deployedAt) || asText(date),
        summary: `An agent of ours is in place inside ${target}, reading its private diplomacy.`,
        linkedSpyIds: [id],
      });
      continue;
    }

    if (!live && project && isProjectOpen(project)) {
      const exposed = asText(spy?.status) === "exposed";
      const silent = asText(spy?.status) === "dead";
      ops.push({
        op: exposed || silent ? "fail" : "cancel",
        id: asText(project.id),
        name: asText(project.name),
        note: exposed
          ? `Our agent in ${target} was caught and the operation is over.`
          : silent
            ? `Our agent in ${target} has gone silent and the operation is over.`
            : `Our agent in ${target} was withdrawn.`,
      });
    }
  }
  return ops;
};

// ---- doubting what a compromised agent told us ------------------------------
// A turned agent feeds planted material, and the board opens a foreign entry from
// it. That is the deception working, and it is meant to. What was missing is the
// end of it: the entry sat there forever and the player never found out they had
// been played, which makes a successful deception indistinguishable from noise.
//
// So the entry is marked DOUBTFUL rather than deleted, and settling it is a move
// the player makes: send someone else. Nobody — not the engine, not the player —
// is told outright that it was a lie. A fresh agent in that polity is what gives
// the model untainted material to confirm or refute it with.
//
// The engine owns "doubted" and nothing else here. "confirmed" and "refuted" are
// judgements about the world, which only the model can make, so they arrive as
// ordinary project ops (see the schema's verification field).
//
// WHAT A SERVICE KNOWS IS ITS OWN, NEVER THE PROJECT'S. Since the projects
// engine, another country's entry is that country's own work, which the engine
// runs: a doubt that stalled it stopped a real programme for good, and in a
// shared game a guest's own work lent to the game's board for the skip
// (seatBoards.js) was taken for the host's intelligence file, stamped with the
// host's agent, stalled when that agent fell under suspicion, and sent home to
// its owner saying so (the review of 2026-11-18). So these passes never move a
// project: they write only what the knower knows of it, and they read nothing
// lent as the board's own.
const spyIdsOf = (project) => asArray(project?.linkedSpyIds).map(asText).filter(Boolean);

// An entry another government lent to the game's board for a time skip
// (seatBoards.js lendBoards): that government's own work, never a file of the
// board's own government.
const isLent = (project) => Boolean(asText(project?.lentFrom));

// The knower's live agents, by the polity each is in: the first of each.
const liveAgentsByTarget = (spies, knower) => {
  const player = asText(knower).toLowerCase();
  const liveByTarget = new Map();
  for (const spy of asArray(spies)) {
    const owner = asText(spy?.owner).toLowerCase();
    if (owner && player && owner !== player) continue;
    if (!LIVE_SPY_STATUSES.has(asText(spy?.status) || "active")) continue;
    const target = asText(spy?.target);
    if (target && !liveByTarget.has(target.toLowerCase())) liveByTarget.set(target.toLowerCase(), spy);
  }
  return liveByTarget;
};

// The knower's agents whose reports may have been written by the other side.
// The trigger is `suspected` — the analysts' own warning, the same flag the Spy
// tab shows — not proof.
const compromisedAgents = (spies, knower) => {
  const player = asText(knower).toLowerCase();
  const compromised = new Set();
  for (const spy of asArray(spies)) {
    const owner = asText(spy?.owner).toLowerCase();
    if (owner && player && owner !== player) continue;
    // Suspected while still running, or exposed after having been turned: both
    // mean what this agent sent may have been written by the other side. A
    // turned agent nobody suspects yet is NOT here: doubting its reports would
    // tell the player what their own service has not worked out.
    const exposedAfterTurning = asText(spy?.status) === "exposed" && Boolean(asText(spy?.turnedAt));
    if (spy?.suspected === true || exposedAfterTurning) compromised.add(asText(spy?.id));
  }
  return compromised;
};

// A foreign entry the board learned while an agent was inside that polity is, by
// the prompt's own rules, sourced from that agent — it is the only channel that
// puts another power's programme on the board. Stamping the link is what lets the
// doubt find the right entries later, and it is retroactive on purpose: an entry
// opened before this existed still gets tied to the agent that must have produced
// it. For the board's own government, on its own board: what anyone else's agents
// tell them is agentKnowledgeChanges below.
export const spyProvenanceOps = (spies, projects, { playerPolity = "" } = {}) => {
  const liveByTarget = liveAgentsByTarget(spies, playerPolity);
  if (!liveByTarget.size) return [];

  const ops = [];
  for (const project of asArray(projects)) {
    if (!isProjectOpen(project) || isLent(project)) continue;
    // Only a FOREIGN entry: a blank ownerCode is the player's own work, which no
    // spy told them about.
    const owner = asText(project?.ownerCode);
    if (!owner) continue;
    if (spyIdsOf(project).length) continue;
    const spy = liveByTarget.get(owner.toLowerCase());
    if (!spy) continue;
    ops.push({
      op: "update",
      id: asText(project.id),
      name: asText(project.name),
      linkedSpyIds: [asText(spy.id)],
    });
  }
  return ops;
};

// Cast doubt on everything a compromised agent sourced, and hand the question to
// whoever is sent next.
//
// The player is never told their agent was turned, so the board must not say so
// either: the entry reads as unconfirmed (the panel's Doubtful badge), not as a
// lie. The doubt is the service's, so it is all that is written: the programme
// itself runs on as its owner runs it.
//
// Doubt is only cast once per entry (an entry already carrying a verification is
// left alone), so the model's later confirmed/refuted verdict is never overwritten
// by the engine on the next turn.
export const spyIntelDoubtOps = (spies, projects, { playerPolity = "" } = {}) => {
  const compromised = compromisedAgents(spies, playerPolity);
  if (!compromised.size) return [];

  const ops = [];
  for (const project of asArray(projects)) {
    if (!isProjectOpen(project) || isLent(project)) continue;
    // FOREIGN entries only. A blank ownerCode is the player's own work — including
    // the covert operation the agent itself IS (spyOperationOps), which is linked
    // to the same spy and would otherwise be doubted alongside what it reported.
    // That operation is not in question: the agent really is there. What cannot be
    // trusted is what they have been sending back.
    if (!asText(project?.ownerCode)) continue;
    if (asText(project?.verification)) continue;
    if (!spyIdsOf(project).some((id) => compromised.has(id))) continue;
    ops.push({ op: "update", id: asText(project.id), name: asText(project.name), verification: "doubted" });
  }
  return ops;
};

// ---- what other governments know of a project ---------------------------------
// The board's own government keeps what it knows on its own board's entries, as
// single player always has (linkedSpyIds, verification, known above). Anyone
// else's knowledge of an entry is kept on it by knower, `knownBy: { [country]:
// { spyIds, verification } }`, which no view but that knower's ever carries
// (seatBoards.js boardSeenBy): in a shared game every player's agents learn of
// the work of the countries they are in, wherever that work is kept, and only
// the host's could before.

// What `knower` knows of an entry not on its own board: { spyIds, verification },
// or null when it knows nothing of it.
export const knowledgeOf = (project, knower) => {
  const by = project?.knownBy && typeof project.knownBy === "object" && !Array.isArray(project.knownBy) ? project.knownBy : null;
  const key = by ? Object.keys(by).find((name) => sameName(name, knower)) : "";
  if (!key) return null;
  return { spyIds: asArray(by[key]?.spyIds).map(asText).filter(Boolean), verification: asText(by[key]?.verification) };
};

// The entry with `knower`'s knowledge of it set to `known`.
const withKnowledge = (project, knower, known) => {
  const by = project?.knownBy && typeof project.knownBy === "object" && !Array.isArray(project.knownBy) ? project.knownBy : {};
  const rest = Object.fromEntries(Object.entries(by).filter(([name]) => !sameName(name, knower)));
  return { ...project, knownBy: { ...rest, [asText(knower)]: { spyIds: known.spyIds, ...(known.verification ? { verification: known.verification } : {}) } } };
};

// What `knower`'s agents tell it this turn of other countries' work: the same
// two steps as on its own board, provenance and then doubt, written only into
// its knowledge of each entry. `entries` are [{ project, owner }], every one of
// them another country's work (`owner`) kept where the knower's own board is
// not. Returns the entries whose knowledge changed, as
// [{ index, project, doubted }], `index` into `entries`.
export const agentKnowledgeChanges = (spies, entries, { knower = "" } = {}) => {
  const liveByTarget = liveAgentsByTarget(spies, knower);
  const compromised = compromisedAgents(spies, knower);
  if (!liveByTarget.size && !compromised.size) return [];
  const changes = [];
  asArray(entries).forEach(({ project, owner } = {}, index) => {
    if (!project || !isProjectOpen(project) || !asText(owner) || sameName(owner, knower)) return;
    const known = knowledgeOf(project, knower) ?? { spyIds: [], verification: "" };
    let next = known;
    const spy = known.spyIds.length ? null : liveByTarget.get(asText(owner).toLowerCase());
    if (spy) next = { ...next, spyIds: [asText(spy.id)] };
    const doubted = !next.verification && next.spyIds.some((id) => compromised.has(id));
    if (doubted) next = { ...next, verification: "doubted" };
    if (next !== known) changes.push({ index, project: withKnowledge(project, knower, next), doubted });
  });
  return changes;
};

// Which doubted entries the player now has a CLEAN pair of eyes on. Two things
// have to be true, and the second is the one that matters:
//
//  1. a live agent in that polity who is neither compromised nor the agent the
//     doubt came from, and
//  2. that agent has actually REPORTED — untainted material exists.
//
// (2) is enforced through `planted`, which gatherIntelligence sets from the
// source's own status and which replaces the target's entry on every gather. So
// it is true exactly while the channel is the other side's writing, and false the
// moment a clean agent files anything. Without this check the question reached the
// board the instant a replacement was deployed, when the only material in hand was
// still the fabrication — and settling a doubt from the evidence the doubt is
// ABOUT is precisely the failure this mechanic exists to prevent. The prompt asks
// the model to hold off in that case; this makes it so it is never asked.
export const doubtedAwaitingFreshSource = (spies, projects, { playerPolity = "", intercepts = null } = {}) => {
  const player = asText(playerPolity).toLowerCase();
  const fresh = new Map();
  for (const spy of asArray(spies)) {
    const owner = asText(spy?.owner).toLowerCase();
    if (owner && player && owner !== player) continue;
    // A turned or suspected agent is not a clean source, however live it looks.
    if (asText(spy?.status) !== "active" || spy?.suspected === true) continue;
    const target = asText(spy?.target);
    if (target) fresh.set(target.toLowerCase(), spy);
  }

  // Intercepts are keyed by the target name as the agent filed it, which need not
  // match the entry's ownerCode in case — the whole polity namespace is compared
  // case-insensitively elsewhere for the same reason.
  const reported = new Map();
  for (const [target, entry] of Object.entries(intercepts || {})) {
    if (entry && entry.planted !== true) reported.set(asText(target).toLowerCase(), entry);
  }

  const out = [];
  for (const project of asArray(projects)) {
    if (!isProjectOpen(project)) continue;
    if (asText(project?.verification) !== "doubted") continue;
    const spy = fresh.get(asText(project?.ownerCode).toLowerCase());
    if (!spy || spyIdsOf(project).includes(asText(spy.id))) continue;
    if (!reported.has(asText(spy.target).toLowerCase())) continue;
    out.push({ project, spy });
  }
  return out;
};

export const describeDoubtedForPrompt = (pending) => {
  if (!pending.length) return "";
  return pending
    .map(({ project, spy }) => `- "${project.name}" (${project.ownerCode}) — doubted; you now have a fresh agent inside ${spy.target}.`)
    .join("\n");
};

// ---- Which Board entries an event concerns ------------------------------------
//
// The open entries the event's own board ops address (impacts.projectOps: an
// update, a checkpoint or an ending names its entry by id, or by the name the
// Board gives it, case aside; opTargetsEntry below), in the Board's order. What
// the event SAYS it did to the Board, never what its words resemble: its title
// and description used to be compared with each entry's name, summary and
// owner as stemmed English words, so "Projet Québec" was found in "Quebec
// project advances", a Board kept in Chinese was found only where punctuation
// cut a name out of a sentence, and a request was bought on the strength of it.
// Read by the world director's consequence check (nativeWorldDirector.js) and
// by boardPassReasons below. (The options a caller passes are not needed.)
export const boardEntriesConcernedByEvent = (event, board) => {
  const ops = asArray(event?.impacts?.projectOps).filter((op) => op && typeof op === "object");
  if (!ops.length) return [];
  return asArray(board).filter((entry) => isProjectOpen(entry) && ops.some((op) => opTargetsEntry(op, entry)));
};

// ---- Where the board pass's ops go ------------------------------------------
//
// The board pass reads one numbered list: the visible events, then the Hidden
// events (Canonical events the timeline cleanup kept off the timeline). This
// plans how its ops are applied: grouped by the event that caused them, one
// carrier per event, in DATE order across both lists, so a Hidden event that
// opens an entry is applied before the visible event that moves it. A Hidden
// event's carrier is marked off the timeline: applied like any other, but never
// stamped into an entry's activity, which lists timeline events only.
//
// An op that names no usable event keeps the board pass's long-standing
// fallback, riding on the last visible event — but in a carrier of its own,
// after that event's, so it can never be what proves that event changed a Board
// entry (see materiallyChangedEntryIds), nor put that event in the entry's
// activity (stampsActivity).

const withoutAddress = ({ eventIndex, ...op }) => op;

export const boardPassCarriers = ({ ops, visibleEvents = [], hiddenEvents = [] } = {}) => {
  const visible = asArray(visibleEvents);
  const hidden = asArray(hiddenEvents);
  const carriers = new Map();
  const carrierFor = (onTimeline, index, fallback = false) => {
    const key = `${onTimeline ? "v" : "h"}${index}${fallback ? "f" : ""}`;
    if (!carriers.has(key)) {
      const event = onTimeline ? visible[index] : hidden[index];
      carriers.set(key, {
        onTimeline,
        eventIndex: onTimeline ? index : null,
        hiddenIndex: onTimeline ? null : index,
        fallback,
        // Whether applying these ops puts the event in each moved entry's
        // activity. A fallback rides on an event it did not come from — usually
        // the turn's last, often an espionage one — so it moves the entry but
        // never claims that event as the entry's history.
        stampsActivity: onTimeline && !fallback,
        date: asText(event?.date),
        // Visible events first, in their own order, then Hidden ones: the tie-break
        // for events on the same day, and for undated ones.
        sequence: (onTimeline ? index : visible.length + index) * 2 + (fallback ? 1 : 0),
        ops: [],
      });
    }
    return carriers.get(key);
  };

  for (const op of asArray(ops)) {
    if (!op || typeof op !== "object") continue;
    const raw = Number(op.eventIndex);
    const index = Number.isInteger(raw) && raw >= 0 && raw < visible.length + hidden.length ? raw : -1;
    if (index >= visible.length) carrierFor(false, index - visible.length).ops.push(withoutAddress(op));
    else if (index >= 0) carrierFor(true, index).ops.push(withoutAddress(op));
    else if (visible.length) carrierFor(true, visible.length - 1, true).ops.push(withoutAddress(op));
    else if (hidden.length) carrierFor(false, hidden.length - 1, true).ops.push(withoutAddress(op));
  }

  return [...carriers.values()].sort((a, b) =>
    (a.date && b.date ? compareGameDates(a.date, b.date) : 0) || a.sequence - b.sequence);
};

// Which Board entries changed MATERIALLY between two states of the Board: opened,
// a status change, a plan given, a setback or breakthrough recorded, or a
// checkpoint reached. Words alone (a new lastUpdate) are not a change.
//
// Compared on the Board itself rather than read off the ops, so every spelling
// the Board's own normalizer accepts counts exactly as it does when applied.
// This is how the turn proves that a provisional major event was backed.
export const materiallyChangedEntryIds = (before, after) => {
  const previous = new Map(asArray(before).map((entry) => [asText(entry?.id), entry]));
  const changed = [];
  for (const entry of asArray(after)) {
    const id = asText(entry?.id);
    const prior = previous.get(id);
    if (!prior) {
      changed.push(id);
      continue;
    }
    const statusMoved = (asText(entry.status) || "active") !== (asText(prior.status) || "active");
    const progressMoved = Math.round(Number(entry.progress) || 0) !== Math.round(Number(prior.progress) || 0);
    const planned = Boolean(entry.plan) !== Boolean(prior.plan);
    const adjusted = asArray(entry.adjustments).length !== asArray(prior.adjustments).length;
    const reached = asArray(entry.plan?.milestones).filter((milestone) => milestone?.reached).length
      !== asArray(prior.plan?.milestones).filter((milestone) => milestone?.reached).length;
    if (statusMoved || progressMoved || planned || adjusted || reached) changed.push(id);
  }
  return changed;
};

// Does this op address this Board entry? By id, or by its name, case and
// accents aside — the same two ways the Board's own ops find an entry.
export const opTargetsEntry = (op, entry) => {
  const id = asText(op?.projectId || op?.id);
  const name = asText(op?.name);
  return Boolean((id && id === asText(entry?.id)) || (name && (name.toLowerCase() === asText(entry?.name).toLowerCase() || sameName(name, entry?.name))));
};

// ---- Does a turn's board need looking at? -----------------------------------
//
// The engine moves every entry by itself (runtime/projectEngine.js), so what is
// left for a model to say about the board is what an event DID to it: opened an
// effort, set one back, brought one on, ended one. A turn's board is looked at
// when one of its events says it did (its own board ops address an open entry,
// or open a new one), and never because of the calendar. Returns the reasons,
// for the turn log; empty means there is nothing to look at.
export const eventOpensEffort = (event) =>
  asArray(event?.impacts?.projectOps).some((op) => asText(op?.op).toLowerCase() === "create");

export const boardPassReasons = ({ board, events = [] } = {}) => {
  const open = asArray(board).filter(isProjectOpen);
  const reasons = [];
  for (const event of asArray(events)) {
    const concerned = open.length ? boardEntriesConcernedByEvent(event, open) : [];
    if (concerned.length) {
      reasons.push(`"${asText(event?.title)}" concerns ${concerned.slice(0, 2).map((entry) => `"${asText(entry?.name)}"`).join(", ")}`);
    } else if (eventOpensEffort(event)) {
      reasons.push(`"${asText(event?.title)}" opens a new entry`);
    }
  }
  return reasons;
};
