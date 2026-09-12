import { addGameDays, compareGameDates, diffGameDays, formatGameDate, gameDateDaysInMonth, parseGameDate, shiftGameYear } from "./gameDates.js";

/*! Open Historia — portions (projects & operations board: derived status, sorting, filtering) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Everything the Projects & Operations board can work out for ITSELF, with no AI
// turn involved.
//
// This split is the point of the feature. The model owns what only it can know —
// what a programme is, how far along it is, what comes next — and this file owns
// everything that follows from the calendar. A project whose target date slips
// past is flagged the moment the clock moves, whether or not the AI ever
// mentions it again. That is what stops the board reading like a snapshot of
// whenever the model last thought about it.
//
// DELIBERATELY IMPORT-FREE, the same trick unitMotion.js / eventFocus.js /
// forcePosture.js use: gameState.js reaches assets.js, which imports maplibre-gl,
// so anything importing it cannot be tested without a full install. Keeping this
// file dependency-free means `node --test src/runtime/projects.test.js` runs in a
// bare checkout. Worth preserving.

// A milestone landing inside this window is "due soon". Sized against the jump
// buttons the player actually uses: the 1-month jump is the common one, so a
// month of look-ahead means the board warns you before the jump that would blow
// through the milestone, not after it.
export const DUE_SOON_DAYS = 30;

// Rounds without an update before a project reads as drifting. Three is roughly
// "the AI has narrated three turns of this campaign and had nothing to say about
// this programme", which is the point at which the player should probably ask.
export const STALE_ROUNDS = 3;

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();

// Signed day difference, unlike unitMotion's daysBetweenDates which clamps at 0.
// The sign IS the information here: -12 means the target slipped twelve days ago.
// Returns null for anything that is not a strict YYYY-MM-DD, which deliberately
// includes the non-Gregorian dates some scenarios run on ("1200 BCE") — those get
// no date-derived flags rather than nonsense ones.
export const signedDaysBetween = (from, to) => diffGameDays(from, to);

// Statuses that are still running. Mirrors PROJECT_OPEN_STATUSES in gameState.js
// — duplicated rather than imported ONLY to keep this module import-free (see the
// banner). No test can compare the two without importing gameState.js and giving
// that up, so this is a hand-kept invariant: add a status to PROJECT_STATUSES and
// you must decide here whether it is open.
const OPEN_STATUSES = new Set(["proposed", "active", "stalled", "paused"]);

export const isProjectOpen = (project) => OPEN_STATUSES.has(asText(project?.status) || "active");

// The complement, exported so the panel's Closed filter and its count cannot
// drift apart from each other or from the sort — this used to be an inline
// ["complete","failed","cancelled"] literal written out in two separate places.
export const isProjectClosed = (project) => !isProjectOpen(project);

// The soonest outstanding milestone. Reads the stored `nextMilestone` first
// (normalizeProjectEntry already derived it from the milestone list on the way
// in, so it is the authoritative answer) and only falls back to scanning when a
// project arrived without one.
export const deriveNextMilestone = (project) => {
  if (project?.nextMilestone && asText(project.nextMilestone.title)) return project.nextMilestone;
  const pending = asArray(project?.milestones).filter((entry) => entry?.status === "pending");
  if (pending.length === 0) return null;
  const dated = pending.filter((entry) => asText(entry.date)).sort((a, b) => compareGameDates(a.date, b.date));
  const next = dated[0] || pending[0];
  return {
    title: asText(next.title),
    date: asText(next.date),
    note: asText(next.note),
    repeat: asText(next.repeat),
    completedCount: Number(next.completedCount) || 0,
  };
};

// What the card badges. Every field here is a pure function of the project and
// the game clock, so none of it can be stale in the way an AI-written status can.
//
// Returns, for one project:
//   overdue     - target date is behind us and the project is still running
//   dueSoon     - the next milestone lands within DUE_SOON_DAYS
//   milestoneMissed - a milestone's date passed while it was still pending
//   stale       - explicitly stalled, or untouched for STALE_ROUNDS rounds
//   daysToTarget / daysToMilestone - signed, null when undateable
export const deriveProjectFlags = (project, gameDate, round = 0) => {
  const open = isProjectOpen(project);
  const nextMilestone = deriveNextMilestone(project);

  const daysToTarget = signedDaysBetween(gameDate, project?.targetDate);
  const daysToMilestone = nextMilestone ? signedDaysBetween(gameDate, nextMilestone.date) : null;

  // A milestone whose date has passed while it is still pending. Distinct from
  // `overdue`, which is about the whole programme: a slipped milestone on a
  // project with a year still to run is a warning, not a failure.
  const milestoneMissed = asArray(project?.milestones).some((entry) => {
    if (entry?.status !== "pending" || !asText(entry.date)) return false;
    const delta = signedDaysBetween(gameDate, entry.date);
    return delta !== null && delta < 0;
  });

  const updatedRound = Number(project?.updatedRound) || 0;
  const roundsSinceUpdate = round > 0 && updatedRound > 0 ? round - updatedRound : 0;

  return {
    open,
    ongoing: Boolean(project?.ongoing),
    nextMilestone,
    daysToTarget,
    daysToMilestone,
    // An ongoing effort can never be overdue — there is no date it was meant to
    // finish by. It can still miss a milestone, which is the useful signal.
    overdue: open && !project?.ongoing && daysToTarget !== null && daysToTarget < 0,
    dueSoon: open && daysToMilestone !== null && daysToMilestone >= 0 && daysToMilestone <= DUE_SOON_DAYS,
    milestoneMissed: open && milestoneMissed,
    stale: open && (asText(project?.status) === "stalled" || roundsSinceUpdate >= STALE_ROUNDS),
  };
};

// ---- recurring milestones --------------------------------------------------
//
// A standing commitment that comes round again: an annual drill, a quarterly
// review, a monthly patrol rotation. Marking one done does not retire it — the
// engine rolls it to its next occurrence and sets it pending again, so the board
// always shows when the next one is due instead of going blank the moment the
// last one was ticked off.
export const MILESTONE_REPEATS = ["weekly", "monthly", "quarterly", "annual", "biennial"];

// What a model actually writes when it means "every year". Same reasoning as the
// project-op aliases: reject the synonym and the feature silently does nothing.
const REPEAT_ALIASES = {
  yearly: "annual", annually: "annual", year: "annual", "every year": "annual", "1y": "annual",
  biannual: "biennial", "two-yearly": "biennial", "2y": "biennial",
  quarter: "quarterly", "3m": "quarterly",
  month: "monthly", "1m": "monthly",
  week: "weekly", "1w": "weekly",
  daily: "", day: "",
};

// Months to advance per occurrence; weekly is handled as days instead.
const REPEAT_MONTHS = { monthly: 1, quarterly: 3, annual: 12, biennial: 24 };

export const normalizeMilestoneRepeat = (value) => {
  const raw = asText(value).toLowerCase();
  if (!raw) return "";
  if (MILESTONE_REPEATS.includes(raw)) return raw;
  return REPEAT_ALIASES[raw] ?? "";
};

// Any game date, BC included (runtime/gameDates.js).
const parseYmd = (value) => parseGameDate(value);

// Clamps the day into the target month, so an exercise on the 31st does not
// vanish in February — it lands on the 28th (or 29th) and keeps its slot. The
// year carry steps over the missing year zero.
const buildYmd = ({ year, month, day }) => {
  const carry = Math.floor((month - 1) / 12);
  const normYear = shiftGameYear(year, carry);
  const normMonth = ((month - 1) % 12 + 12) % 12 + 1;
  return formatGameDate({ year: normYear, month: normMonth, day: Math.min(day, gameDateDaysInMonth(normYear, normMonth)) });
};

// The next occurrence of a recurring date STRICTLY AFTER `notBefore`.
//
// Rolls from the milestone's own date rather than from today, so an annual drill
// on 1 June stays on 1 June year after year instead of drifting to whenever it
// happened to be marked off. A commitment that was missed for several cycles
// advances as many times as it takes to get ahead of the clock — the board should
// show the next one that is actually coming, not a date already behind us.
export const advanceRecurringDate = (date, repeat, notBefore = "") => {
  const cadence = normalizeMilestoneRepeat(repeat);
  const start = parseYmd(date);
  if (!cadence || !start) return "";

  const floor = parseYmd(notBefore);
  const floorKey = floor ? buildYmd(floor) : "";

  let next = { ...start };
  // Bounded: a weekly commitment missed for a decade is ~520 rolls, and the cap
  // keeps a nonsense date (year 0001) from spinning here forever.
  for (let guard = 0; guard < 600; guard += 1) {
    next = cadence === "weekly"
      ? parseGameDate(addGameDays(formatGameDate(next), 7))
      : { year: next.year, month: next.month + REPEAT_MONTHS[cadence], day: start.day };

    const candidate = buildYmd(next);
    if (!floorKey || compareGameDates(candidate, floorKey) > 0) return candidate;
    // Re-seed from the normalised value so month overflow accumulates correctly.
    const reparsed = parseYmd(candidate);
    if (!reparsed) return candidate;
    next = { ...reparsed, day: start.day };
  }
  return buildYmd(next);
};

// ---- sorting ---------------------------------------------------------------

export const PROJECT_SORTS = [
  { key: "updated", label: "Recently updated" },
  { key: "priority", label: "Priority" },
  { key: "milestone", label: "Next milestone" },
  { key: "progress", label: "Progress" },
  { key: "name", label: "Name" },
  { key: "status", label: "Status" },
];

// Running work above finished work, then by how much trouble it is in. This is
// the tiebreak under every sort, so a completed project never sits above an
// overdue one just because it was touched more recently.
const STATUS_RANK = {
  stalled: 0,
  active: 1,
  proposed: 2,
  paused: 3,
  complete: 4,
  failed: 5,
  cancelled: 6,
};

const statusRank = (project) => {
  const rank = STATUS_RANK[asText(project?.status)];
  return rank === undefined ? 3 : rank;
};

// The player's own dial (world.projects[].priority). Same shape and same
// defaulting rule as STATUS_RANK above: an entry from a save written before the
// field existed reads as normal, so it sorts in the middle rather than being
// swept to one end of a board the player has never touched.
//
// Deliberately NOT folded into the other comparators as a tiebreak. Doing that
// would reshuffle every existing player's board under the sort they already had
// selected, for a reason they did not ask for and cannot see; priority is its own
// sort, chosen deliberately.
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

const priorityRank = (project) => {
  const rank = PRIORITY_RANK[asText(project?.priority)];
  return rank === undefined ? 1 : rank;
};

// Undated things sort LAST under every date-driven comparator, rather than
// first, which is what a bare string compare against "" would do — a project
// with no milestone is not the most urgent one on the board.
const compareDates = (a, b) => {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
};

export const sortProjects = (projects, key = "updated") => {
  const list = [...asArray(projects)];
  const byName = (a, b) => asText(a.name).localeCompare(asText(b.name));

  const comparators = {
    // Most recently touched first. updatedAt is an ISO stamp, so a plain reverse
    // string compare is correct and needs no Date parsing.
    updated: (a, b) => asText(b.updatedAt).localeCompare(asText(a.updatedAt)) || byName(a, b),
    milestone: (a, b) => compareDates(deriveNextMilestone(a)?.date, deriveNextMilestone(b)?.date) || byName(a, b),
    progress: (a, b) => (Number(b.progress) || 0) - (Number(a.progress) || 0) || byName(a, b),
    name: byName,
    status: (a, b) => statusRank(a) - statusRank(b) || byName(a, b),
    // Status second, so within one priority band the work in trouble surfaces
    // first — that is the order the player actually wants to read down.
    priority: (a, b) => priorityRank(a) - priorityRank(b) || statusRank(a) - statusRank(b) || byName(a, b),
  };

  const compare = comparators[key] || comparators.updated;
  // Open work always outranks closed work, whatever the chosen sort — a board
  // whose first screen is finished projects is not telling you anything.
  return list.sort((a, b) => (isProjectOpen(b) ? 1 : 0) - (isProjectOpen(a) ? 1 : 0) || compare(a, b));
};

// ---- filtering -------------------------------------------------------------

// Case-, diacritic- and punctuation-insensitive identity for an owner name.
//
// A HAND-KEPT DUPLICATE of ownerIdentityKey in ownerNames.js — same reasoning as
// OPEN_STATUSES above: importing it would cost this file its import-free promise,
// and the two must not drift. If you change the fold there, change it here.
//
// A plain toLowerCase() was not enough. The model spells a country back the way
// it remembers it, so the player's own programme arrives owned by "Cote dIvoire"
// while game.country is "Côte d'Ivoire", the entry files itself under Foreign,
// and the player loses the two levers they have over their own work.
const ownerIdentity = (value) => String(value ?? "")
  .normalize("NFD")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "");

// Owner is compared by NAME, because that is the namespace every polity-keyed
// field in world state uses. A blank ownerCode means the player: the model is not
// made to restate their own country on every entry, since a field it has to
// repeat is a field it eventually gets wrong.
export const isPlayerProject = (project, playerCountry) => {
  const owner = ownerIdentity(project?.ownerCode);
  if (!owner) return true;
  return owner === ownerIdentity(playerCountry);
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

    // Tag chips are OR-ed, not AND-ed: picking "military" and "naval" means "show
    // me either", which is what a player clicking two chips on a short list
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
      deriveNextMilestone(project)?.title,
      ...asArray(project.tags),
    ].some((field) => asText(field).toLowerCase().includes(needle));
  });
};

// The tag vocabulary actually present on the board, most-used first, so the
// filter chips reflect this campaign rather than a fixed list. Open-vocabulary
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

// A short, human summary of where a project stands, for the card's timeline row.
// Kept here rather than in the panel so the wording is testable and the same
// phrasing can be reused (the advisor's seed prompt quotes it).
export const describeTimeline = (project, gameDate) => {
  const started = asText(project?.startedAt);
  const target = asText(project?.targetDate);
  // A standing effort is not "missing" its end date; say so, rather than showing
  // a bare start date that reads like an entry nobody finished filling in.
  if (project?.ongoing) return started ? `Began ${started} · ongoing` : "Ongoing";
  if (!started && !target) return "";
  if (started && !target) return `Began ${started}`;
  if (!started) return `Target ${target}`;

  const delta = signedDaysBetween(gameDate, target);
  if (delta === null) return `${started} → ${target}`;
  if (delta < 0) return `${started} → ${target} (${Math.abs(delta)}d overdue)`;
  return `${started} → ${target} (${delta}d left)`;
};

// ---- covert operations that track a real agent -----------------------------
// A spy in the field IS a long-running covert operation, so it belongs on the
// board next to everything else the player is running — and the board is where
// the AI can then act on it (an exposed ring stalls the programme it served).
//
// The split of responsibility is deliberate. The ENGINE owns whether an entry
// exists and whether it has ended, because that is bookkeeping and must never
// drift from world.spies. The MODEL owns the story: progress, milestones and
// lastUpdate arrive through the ordinary projects task, because the entry is an
// ordinary board entry once it exists.
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
        // A planted agent runs until it is pulled or caught; it has no target
        // date, and `ongoing` is what stops the board calling that overdue.
        ongoing: true,
        startedAt: asText(spy?.deployedAt) || asText(date),
        summary: `An agent of ours is in place inside ${target}, reading its private diplomacy.`,
        linkedSpyIds: [id],
      });
      continue;
    }

    if (!live && project && isProjectOpen(project)) {
      const exposed = asText(spy?.status) === "exposed";
      ops.push({
        op: exposed ? "fail" : "cancel",
        id: asText(project.id),
        name: asText(project.name),
        note: exposed
          ? `Our agent in ${target} was caught and the operation is over.`
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
const spyIdsOf = (project) => asArray(project?.linkedSpyIds).map(asText).filter(Boolean);

// A foreign entry the board learned while an agent was inside that polity is, by
// the prompt's own rules, sourced from that agent — it is the only channel that
// puts another power's programme on the board. Stamping the link is what lets the
// doubt find the right entries later, and it is retroactive on purpose: an entry
// opened before this existed still gets tied to the agent that must have produced
// it.
export const spyProvenanceOps = (spies, projects, { playerPolity = "" } = {}) => {
  const player = asText(playerPolity).toLowerCase();
  const liveByTarget = new Map();
  for (const spy of asArray(spies)) {
    const owner = asText(spy?.owner).toLowerCase();
    if (owner && player && owner !== player) continue;
    if (!LIVE_SPY_STATUSES.has(asText(spy?.status) || "active")) continue;
    const target = asText(spy?.target);
    if (target && !liveByTarget.has(target.toLowerCase())) liveByTarget.set(target.toLowerCase(), spy);
  }
  if (!liveByTarget.size) return [];

  const ops = [];
  for (const project of asArray(projects)) {
    if (!isProjectOpen(project)) continue;
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
// The trigger is `suspected` — the analysts' own warning, the same flag the Spy
// tab shows — not proof. The player is never told their agent was turned, so the
// board must not say so either: the entry reads as unconfirmed, not as a lie.
//
// Doubt is only cast once per entry (an entry already carrying a verification is
// left alone), so the model's later confirmed/refuted verdict is never overwritten
// by the engine on the next turn.
export const spyIntelDoubtOps = (spies, projects, { playerPolity = "", date = "" } = {}) => {
  const player = asText(playerPolity).toLowerCase();
  const compromised = new Set();
  for (const spy of asArray(spies)) {
    const owner = asText(spy?.owner).toLowerCase();
    if (owner && player && owner !== player) continue;
    const status = asText(spy?.status) || "active";
    // Suspected while still running, or exposed after having been turned: both
    // mean what this agent sent may have been written by the other side.
    if (spy?.suspected === true || status === "turned") compromised.add(asText(spy?.id));
  }
  if (!compromised.size) return [];

  const ops = [];
  for (const project of asArray(projects)) {
    if (!isProjectOpen(project)) continue;
    // FOREIGN entries only. A blank ownerCode is the player's own work — including
    // the covert operation the agent itself IS (spyOperationOps), which is linked
    // to the same spy and would otherwise be doubted alongside what it reported.
    // That operation is not in question: the agent really is there. What cannot be
    // trusted is what they have been sending back.
    if (!asText(project?.ownerCode)) continue;
    if (asText(project?.verification)) continue;
    if (!spyIdsOf(project).some((id) => compromised.has(id))) continue;
    ops.push({
      op: "update",
      id: asText(project.id),
      name: asText(project.name),
      verification: "doubted",
      status: "stalled",
      lastUpdate: `Our analysts no longer trust how we came by this${date ? ` (as of ${date})` : ""}.`
        + " It stands unconfirmed until someone else can look.",
    });
  }
  return ops;
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
// The engine's own answer to "is this event about something on the Board?", so
// nothing new has to be asked of the model. Its one job is the world director's
// consequence check: a major event with no other consequence may pass it
// provisionally when it concerns an open Board entry, and the board pass then
// has to prove it by actually changing a Board entry. A false match therefore
// costs one provisional pass that verification takes back, while a miss costs a
// retried segment — so this leans towards matching.
//
// Words are folded the way ownerIdentity folds a polity name (accents dropped,
// case ignored), then compared as crude stems so "shipyards" meets "shipyard".

// Words that say what KIND of thing an entry is rather than which one, so they
// can never be the reason an event matches.
const GENERIC_ENTRY_WORDS = new Set([
  "project", "projects", "operation", "operations", "programme", "programmes",
  "program", "programs", "plan", "initiative", "campaign", "effort", "scheme",
  "the", "and", "for", "with", "from", "into", "its", "their", "our", "new",
  "national", "state", "phase", "stage", "first", "second", "third",
]);

const foldWords = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .split(" ")
  .filter(Boolean);

const stemWord = (word) => (word.length > 4 ? word.replace(/(?:ies|es|s)$/, "") : word);

const distinctiveStems = (value, minLength) => [
  ...new Set(
    foldWords(value)
      .filter((word) => word.length >= minLength && !GENERIC_ENTRY_WORDS.has(word))
      .map(stemWord),
  ),
];

// Enough of the summary to name the thing without its name: three distinctive
// words, or two when the event also names the owner.
const SUMMARY_WORDS_ALONE = 3;
const SUMMARY_WORDS_WITH_OWNER = 2;

export const boardEntriesConcernedByEvent = (event, board, { playerCountry = "" } = {}) => {
  const eventWords = foldWords(`${asText(event?.title)} ${asText(event?.description)}`);
  if (!eventWords.length) return [];
  const eventStems = new Set(eventWords.map(stemWord));
  const eventPhrase = ` ${eventWords.join(" ")} `;

  const matches = [];
  for (const entry of asArray(board)) {
    if (!isProjectOpen(entry)) continue;

    const nameWords = foldWords(entry?.name).filter((word) => !GENERIC_ENTRY_WORDS.has(word));
    const namedExactly = nameWords.length > 0 && eventPhrase.includes(` ${nameWords.join(" ")} `);

    const nameStems = distinctiveStems(entry?.name, 3);
    const nameHits = nameStems.filter((stem) => eventStems.has(stem)).length;
    const namedEnough = nameStems.length > 0 && nameHits >= Math.ceil(nameStems.length / 2);

    // At the start of a word, so "Iranian" names Iran but "Romania" never names
    // Oman. A blank owner is the player's, as everywhere on the Board.
    const ownerWords = foldWords(asText(entry?.ownerCode) || playerCountry);
    const ownerNamed = ownerWords.length > 0 && eventPhrase.includes(` ${ownerWords.join(" ")}`);

    const summaryHits = distinctiveStems(entry?.summary, 4).filter((stem) => eventStems.has(stem)).length;
    const describedEnough = summaryHits >= (ownerNamed ? SUMMARY_WORDS_WITH_OWNER : SUMMARY_WORDS_ALONE);

    if (!namedExactly && !namedEnough && !describedEnough) continue;
    matches.push({ entry, ownerNamed, score: (namedExactly ? 10 : 0) + nameHits * 3 + summaryHits });
  }

  // The owner decides between entries the words alone cannot tell apart — two
  // countries' naval Projects. Only when at least one matched entry's owner is
  // named: an event that names nobody keeps every candidate.
  const anyOwnerNamed = matches.some((match) => match.ownerNamed);
  return matches
    .filter((match) => !anyOwnerNamed || match.ownerNamed)
    .sort((a, b) => b.score - a.score)
    .map((match) => match.entry);
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
// entry (see materiallyChangedEntryIds).

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
// a status or a (rounded) progress change, or a checkpoint reached or missed —
// including a recurring one that rolled over. Words alone (a new lastUpdate) and
// a restated figure are not a change, and neither is re-dating a checkpoint.
//
// Compared on the Board itself rather than read off the ops, so every spelling
// the Board's own normalizer accepts ("reached", "launch", a nested patch)
// counts exactly as it does when applied. This is how the turn proves that a
// provisional major event was backed: the Board before its ops, the Board after.
const REACHED_MILESTONE_STATUSES = new Set(["done", "missed"]);

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
    const priorMilestones = new Map(asArray(prior.milestones).map((milestone) => [asText(milestone?.id), milestone]));
    const checkpointReached = asArray(entry.milestones).some((milestone) => {
      const was = priorMilestones.get(asText(milestone?.id));
      if ((Number(milestone?.completedCount) || 0) > (Number(was?.completedCount) || 0)) return true;
      return REACHED_MILESTONE_STATUSES.has(asText(milestone?.status)) && asText(was?.status) !== asText(milestone?.status);
    });
    if (statusMoved || progressMoved || checkpointReached) changed.push(id);
  }
  return changed;
};

// Does this op address this Board entry? By id, or by name as the board pass
// copies it (case aside) — the same two ways the Board's own ops find an entry.
export const opTargetsEntry = (op, entry) => {
  const id = asText(op?.projectId || op?.id);
  const name = asText(op?.name).toLowerCase();
  return Boolean((id && id === asText(entry?.id)) || (name && name === asText(entry?.name).toLowerCase()));
};

// HIGH PRIORITY buys an explicit assessment every jump — "no material change,
// because..." included — so an open, player-owned HIGH PRIORITY entry the board
// pass returned no op for is worth a line in the turn log. Reported, never
// retried: the story may genuinely have nothing to say, and a second call to make
// it say something is how progress gets invented.
export const unassessedHighPriorityEntries = (board, ops, { playerCountry = "" } = {}) =>
  asArray(board).filter((entry) =>
    canPlayerDirect(entry, playerCountry)
    && asText(entry?.priority) === "high"
    && !asArray(ops).some((op) => opTargetsEntry(op, entry)));
