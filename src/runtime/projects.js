/*! Open Historia — portions (projects & operations board: derived status, sorting, filtering) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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
export const signedDaysBetween = (from, to) => {
  const parse = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asText(value));
    if (!match) return null;
    const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isFinite(time) ? time : null;
  };
  const a = parse(from);
  const b = parse(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86400000);
};

// Statuses that are still running. Mirrors PROJECT_OPEN_STATUSES in gameState.js
// — duplicated rather than imported ONLY to keep this module import-free (see the
// banner). No test can compare the two without importing gameState.js and giving
// that up, so this is a hand-kept invariant: add a status to PROJECT_STATUSES and
// you must decide here whether it is open.
const OPEN_STATUSES = new Set(["proposed", "active", "stalled", "paused"]);

export const isProjectOpen = (project) => OPEN_STATUSES.has(asText(project?.status) || "active");

// The soonest outstanding milestone. Reads the stored `nextMilestone` first
// (normalizeProjectEntry already derived it from the milestone list on the way
// in, so it is the authoritative answer) and only falls back to scanning when a
// project arrived without one.
export const deriveNextMilestone = (project) => {
  if (project?.nextMilestone && asText(project.nextMilestone.title)) return project.nextMilestone;
  const pending = asArray(project?.milestones).filter((entry) => entry?.status === "pending");
  if (pending.length === 0) return null;
  const dated = pending.filter((entry) => asText(entry.date)).sort((a, b) => a.date.localeCompare(b.date));
  const next = dated[0] || pending[0];
  return { title: asText(next.title), date: asText(next.date), note: asText(next.note) };
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
    nextMilestone,
    daysToTarget,
    daysToMilestone,
    overdue: open && daysToTarget !== null && daysToTarget < 0,
    dueSoon: open && daysToMilestone !== null && daysToMilestone >= 0 && daysToMilestone <= DUE_SOON_DAYS,
    milestoneMissed: open && milestoneMissed,
    stale: open && (asText(project?.status) === "stalled" || roundsSinceUpdate >= STALE_ROUNDS),
  };
};

// ---- sorting ---------------------------------------------------------------

export const PROJECT_SORTS = [
  { key: "updated", label: "Recently updated" },
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
  };

  const compare = comparators[key] || comparators.updated;
  // Open work always outranks closed work, whatever the chosen sort — a board
  // whose first screen is finished projects is not telling you anything.
  return list.sort((a, b) => (isProjectOpen(b) ? 1 : 0) - (isProjectOpen(a) ? 1 : 0) || compare(a, b));
};

// ---- filtering -------------------------------------------------------------

// Owner is compared by NAME, verbatim, because that is the namespace every
// polity-keyed field in world state uses. A blank ownerCode means the player:
// the model is not made to restate their own country on every entry, since a
// field it has to repeat is a field it eventually gets wrong.
export const isPlayerProject = (project, playerCountry) => {
  const owner = asText(project?.ownerCode);
  if (!owner) return true;
  return owner.toLowerCase() === asText(playerCountry).toLowerCase();
};

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
  if (!started && !target) return "";
  if (started && !target) return `Began ${started}`;
  if (!started) return `Target ${target}`;

  const delta = signedDaysBetween(gameDate, target);
  if (delta === null) return `${started} → ${target}`;
  if (delta < 0) return `${started} → ${target} (${Math.abs(delta)}d overdue)`;
  return `${started} → ${target} (${delta}d left)`;
};
