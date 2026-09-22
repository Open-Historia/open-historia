/*! Open Historia — Player focus: how much of a jump belongs to the player © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/Game/AI/playerFocus.test.js
//
// A player chooses how much of each jump is about their own country: World
// first, Balanced, Focused or Spotlight. Each level is a minimum share of Player
// events, the mirror of the world share a scenario author sets for World events
// (worldDirection.js). When the two ask for more than the whole jump, the
// player's focus wins and the world keeps what is left (docs/adr/0003).
//
// The minimum only counts what the player actually has going on. A quiet
// stretch lowers it rather than inventing Player events, and the World fills
// the jump up to its usual event count, never beyond it.
//
// Import-free: the rules on plain data, tested under bare node. gameplay.js
// gathers the data and wires the answers in.

const asText = (value) => String(value ?? "").trim();

export const PLAYER_FOCUS_LEVELS = Object.freeze([
  Object.freeze({ key: "world-first", label: "World first", share: 25, contextShare: 1 }),
  Object.freeze({ key: "balanced", label: "Balanced", share: 40, contextShare: 1 }),
  Object.freeze({ key: "focused", label: "Focused", share: 60, contextShare: 0.6 }),
  Object.freeze({ key: "spotlight", label: "Spotlight", share: 75, contextShare: 0.4 }),
]);

export const PLAYER_FOCUS_DEFAULT = "balanced";

const levelOf = (focus) => PLAYER_FOCUS_LEVELS.find((level) => level.key === normalizePlayerFocus(focus));

export const normalizePlayerFocus = (value) => {
  const key = asText(value).toLowerCase().replace(/[\s_]+/g, "-");
  return PLAYER_FOCUS_LEVELS.some((level) => level.key === key) ? key : PLAYER_FOCUS_DEFAULT;
};

// --- Player events ---
//
// Anything involving the player's polity: what it does, what is done to it or
// said about it (the simulator's playerRelated mark, or its name in the words),
// and what happens inside its territory — the regions and cities it holds and
// the polities it absorbed, so riots in Lahore are the British Empire's even
// when the event never names it. Whole words, case and accents folded.
const fold = (value) => ` ${asText(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

// Shorter names match too much ("Ob", "Uri"); the polity's own names are
// allowed down to three letters, as the world share counts them.
const TERRITORY_NAME_MIN = 4;

export const createPlayerEventTest = ({ playerNames = [], territoryNames = [] } = {}) => {
  const needles = [
    ...playerNames.map(fold).filter((needle) => needle.trim().length >= 3),
    ...territoryNames.map(fold).filter((needle) => needle.trim().length >= TERRITORY_NAME_MIN),
  ];
  const unique = [...new Set(needles)];
  return (event) => {
    if (event?.playerRelated === true) return true;
    const text = fold(`${asText(event?.title)} ${asText(event?.description)}`);
    return unique.some((needle) => text.includes(needle));
  };
};

// --- What the player has going on ---
//
// Everything a jump could write a Player event about, for its window:
//   order       a queued order                         — must be answered
//   milestone   a pending or slipped milestone due by the window's end
//               — must be answered; one due in the month after is a lead-up
//   target      an open Project's target date by the window's end — must be answered
//   storyline   an unresolved Storyline the player is part of
//   war         a war the player is in
//   relation    a relation with the player that moved recently
//   chat        a thread with the player carrying recent diplomatic memory
//   consequence one of the player's own recent events, so it can be followed through
// `required` marks what the jump must give an outcome; the rest is what the
// player's share may be drawn from. Only the player's own Board entries count.
const LEAD_UP_DAYS = 30;
const RECENT_DAYS = 60;
const CHAT_MEMORY_DAYS = 90;
const MAX_CONSEQUENCES = 3;
// Entries whose dates a jump is asked to answer. A paused entry is deliberately
// absent: its dates are not being worked towards, so neither its milestones nor
// its target date belong in what the player "has going on". Its milestones can
// still slip (SLIPPABLE_PROJECT_STATUSES), because a date passes whether or not
// anyone is working. The Board's own isProjectOpen is a different question — what
// still counts as running — and projects.js owns that one.
const PACED_PROJECT_STATUSES = new Set(["proposed", "active", "stalled"]);
const SLIPPABLE_PROJECT_STATUSES = new Set([...PACED_PROJECT_STATUSES, "paused"]);
const UNREACHED_MILESTONE_STATUSES = new Set(["pending", "slipped"]);

const asArray = (value) => (Array.isArray(value) ? value : []);
const nameKey = (value) => fold(value).trim();

// A date as a count of days: proleptic Gregorian, negative years included.
export const dayNumber = (iso) => {
  const match = /^(-?)(\d{1,4})-(\d{2})-(\d{2})/.exec(asText(iso));
  if (!match) return null;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[2]) * (match[1] ? -1 : 1), Number(match[3]) - 1, Number(match[4]));
  const value = Math.round(date.getTime() / 86400000);
  return Number.isFinite(value) ? value : null;
};

const isPlayersEntry = (project, playerKeys) => {
  const owner = nameKey(project?.ownerCode);
  return !owner || playerKeys.has(owner);
};

export const collectPlayerMaterial = ({
  playerNames = [],
  isPlayerEvent = () => false,
  originDate = "",
  targetDate = "",
  actions = [],
  projects = [],
  storylines = [],
  wars = [],
  relations = [],
  chats = [],
  recentEvents = [],
} = {}) => {
  const playerKeys = new Set(asArray(playerNames).map(nameKey).filter(Boolean));
  const isPlayer = (name) => playerKeys.has(nameKey(name));
  const origin = dayNumber(originDate);
  const end = dayNumber(targetDate) ?? origin;
  const within = (iso, from, to) => {
    const day = dayNumber(iso);
    return day !== null && (from === null || day >= from) && (to === null || day <= to);
  };
  const recentFrom = origin === null ? null : origin - RECENT_DAYS;
  const items = [];

  for (const action of asArray(actions)) {
    if (asText(action?.status) !== "planned") continue;
    items.push({ kind: "order", id: asText(action.id), label: asText(action.text || action.rawInput), overdue: action.overdue === true, required: true });
  }

  for (const project of asArray(projects)) {
    if (!PACED_PROJECT_STATUSES.has(asText(project?.status) || "active") || !isPlayersEntry(project, playerKeys)) continue;
    const name = asText(project.name);
    for (const milestone of asArray(project.milestones)) {
      if (!UNREACHED_MILESTONE_STATUSES.has(asText(milestone?.status) || "pending")) continue;
      const due = within(milestone.date, null, end);
      const leadUp = !due && end !== null && within(milestone.date, end + 1, end + LEAD_UP_DAYS);
      if (!due && !leadUp) continue;
      items.push({
        kind: "milestone",
        id: asText(milestone.id),
        projectId: asText(project.id),
        projectName: name,
        label: `${name}: ${asText(milestone.title)} (${asText(milestone.date)})`,
        date: asText(milestone.date),
        required: due,
      });
    }
    if (!project.ongoing && within(project.targetDate, null, end)) {
      items.push({ kind: "target", id: asText(project.id), projectId: asText(project.id), projectName: name, label: `${name}: target date ${asText(project.targetDate)}`, date: asText(project.targetDate), required: true });
    }
  }

  for (const storyline of asArray(storylines)) {
    if (asText(storyline?.status) === "resolved" || !asArray(storyline?.participants).some(isPlayer)) continue;
    items.push({ kind: "storyline", id: asText(storyline.id), label: asText(storyline.title), required: false });
  }

  for (const war of asArray(wars)) {
    if (asText(war?.status) === "ended" || ![...asArray(war?.sideA), ...asArray(war?.sideB)].some(isPlayer)) continue;
    items.push({ kind: "war", id: asText(war.id), label: asText(war.title), required: false });
  }

  for (const relation of asArray(relations)) {
    const other = isPlayer(relation?.a) ? relation?.b : isPlayer(relation?.b) ? relation?.a : "";
    if (!asText(other) || !within(relation.lastUpdatedDate, recentFrom, end)) continue;
    items.push({ kind: "relation", id: asText(relation.id) || asText(other), label: `Relations with ${asText(other)}: ${asText(relation.status)}`, required: false });
  }

  const chatFrom = origin === null ? null : origin - CHAT_MEMORY_DAYS;
  for (const chat of asArray(chats)) {
    if (!asArray(chat?.countries).some((country) => isPlayer(typeof country === "string" ? country : country?.name ?? country?.code))) continue;
    const remembered = asArray(chat.messages).some((message) => asText(message?.memorySummary) && within(message.time, chatFrom, end));
    if (remembered) items.push({ kind: "chat", id: asText(chat.id), label: asText(chat.title), required: false });
  }

  const consequences = asArray(recentEvents)
    .filter((event) => within(event?.date, recentFrom, origin) && isPlayerEvent(event))
    .slice(-MAX_CONSEQUENCES);
  for (const event of consequences) {
    items.push({ kind: "consequence", id: asText(event.id), label: asText(event.title), date: asText(event.date), required: false });
  }

  return items;
};

// The two minimums a jump is held to, in percent.
export const combinedShares = ({ focus, worldShare = 0 } = {}) => {
  const player = levelOf(focus).share;
  const world = Math.max(0, Math.min(Number(worldShare) || 0, 100 - player));
  return { player, world };
};

// Below this many events a share is not a meaningful thing to ask for — the
// same threshold the world share uses (worldDirection.js).
export const PLAYER_FOCUS_MIN_EVENTS = 3;

// null when the minimum is met or does not apply; otherwise what to tell the
// simulator at the top of its next turn. Never a reason to ask again.
export const playerFocusShortfall = (events, { focus, isPlayerEvent = () => false, material = [], playerName = "" } = {}) => {
  const list = asArray(events);
  if (list.length < PLAYER_FOCUS_MIN_EVENTS) return null;
  const level = levelOf(focus);
  const needed = Math.min(Math.ceil((list.length * level.share) / 100), asArray(material).length);
  const have = list.filter((event) => isPlayerEvent(event)).length;
  if (have >= needed) return null;
  const player = asText(playerName) || "the player's polity";
  return {
    needed,
    have,
    text: `${have} of your ${list.length} events involved ${player}; the player's focus (${level.label}) asks for at least ${needed} while ${player} has this much going on. `
      + `Give ${player}'s orders, Projects, wars, Storylines and recent events their consequences before reaching for distant news.`,
  };
};

// --- After the jump: orders ---
//
// A queued order is resolved only by an event that says so in its actionIds.
// One the jump left unanswered stays queued, marked overdue, and the next jump
// is told to answer it first. Resolving the whole queue whenever a jump ran is
// how orders used to disappear with nothing to show for them.
// A queued entry no event could ever cite is settled by the engine instead: a
// Deploy request, which the unit engine accepts, and a chat request, which is
// answered by the conversation opening. Only an ordinary order needs an event.
export const actionNeedsEvent = (action) => asText(action?.kind) !== "chat" && !action?.unitRevert;

export const settleOrders = (actions, events) => {
  const answered = new Set(asArray(events).flatMap((event) => asArray(event?.impacts?.actionIds)).map(asText).filter(Boolean));
  return asArray(actions).map((action) => {
    if (asText(action?.status) !== "planned") return action;
    if (!actionNeedsEvent(action)) {
      const { overdue: _overdue, ...rest } = action;
      return { ...rest, status: "resolved" };
    }
    if (answered.has(asText(action.id))) {
      const { overdue: _overdue, ...rest } = action;
      return { ...rest, status: "resolved" };
    }
    return action.overdue === true ? action : { ...action, overdue: true };
  });
};

// --- After the jump: milestones ---
//
// A milestone the jump reached its date on without an outcome is marked
// slipped: late, not yet reached, and still something the next jump must
// answer. The Board shows it as such rather than a stale pending date.
export const slipPassedMilestones = (projects, { date = "" } = {}) => {
  const today = dayNumber(date);
  if (today === null) return projects;
  const passed = (milestone) => (asText(milestone?.status) || "pending") === "pending"
    && dayNumber(milestone?.date) !== null && dayNumber(milestone.date) <= today;
  return asArray(projects).map((project) => {
    if (!SLIPPABLE_PROJECT_STATUSES.has(asText(project?.status) || "active")) return project;
    if (!asArray(project?.milestones).some(passed)) return project;
    return { ...project, milestones: project.milestones.map((milestone) => (passed(milestone) ? { ...milestone, status: "slipped" } : milestone)) };
  });
};

// --- The filler filter ---
//
// An event that answers one of the player's orders, or that names a Project
// with a milestone or target due in the window, is exactly what the player
// asked the jump for. The filler filter may not remove it, however routine it
// reads; the rest of the player's events are judged as usual.
export const createSpareTest = (material) => {
  const dueProjects = [...new Set(asArray(material)
    .filter((item) => item?.required && item.projectName)
    .map((item) => fold(item.projectName))
    .filter((needle) => needle.trim().length >= 3))];
  return (event) => {
    if (asArray(event?.impacts?.actionIds).length) return true;
    if (!dueProjects.length) return false;
    const text = fold(`${asText(event?.title)} ${asText(event?.description)}`);
    return dueProjects.some((needle) => text.includes(needle));
  };
};

// --- The jump's context ---
//
// How much of the other powers' part of the jump context survives: all of it
// at World first and Balanced, about 60% at Focused, about 40% at Spotlight.
// Items arrive ranked, most pressing first, so the world keeps its strongest
// lanes and evidence and loses the weakest; everything about the player stays,
// and at least one world item always does.
export const trimWorldForFocus = (items, { focus, isPlayerItem = () => false } = {}) => {
  const list = asArray(items);
  const worldCount = list.filter((item) => !isPlayerItem(item)).length;
  const keep = Math.max(1, Math.ceil(worldCount * levelOf(focus).contextShare));
  let kept = 0;
  return list.filter((item) => {
    if (isPlayerItem(item)) return true;
    kept += 1;
    return kept <= keep;
  });
};

// --- What the simulator is told ---
//
// Appended by code after the scenario's own guidance, beside the world
// direction block, so an author's edits cannot remove it. It names the level
// and its minimum, lists what the jump must answer (overdue orders first, each
// with the id its event cites in actionIds), and what the player's share may be
// drawn from. A quiet stretch asks for no share at all.
const MATERIAL_HEADINGS = {
  storyline: "Storylines",
  war: "Wars",
  relation: "Relations",
  chat: "Diplomatic threads",
  consequence: "Recent events to follow through",
  milestone: "Coming up",
};

export const buildPlayerFocusDirective = ({ focus, worldShare = 0, material = [], playerName = "" } = {}) => {
  const level = levelOf(focus);
  const player = asText(playerName) || "the player's polity";
  const items = asArray(material);
  const heading = `[Player Focus — ${level.label}, chosen by the player]`;
  if (!items.length) {
    return `${heading}\n${player} has nothing in particular going on this period: no orders, no dates due, no open threads. Let the world fill the period, within its usual number of events; do not invent business for ${player}.`;
  }
  const { player: playerShare } = combinedShares({ focus, worldShare });
  const orders = items.filter((item) => item.kind === "order").sort((a, b) => Number(b.overdue === true) - Number(a.overdue === true));
  const due = items.filter((item) => item.required && item.kind !== "order");
  const optional = items.filter((item) => !item.required);
  const lines = [
    heading,
    `At least ${playerShare}% of this period's events should be Player events — anything ${player} does, anything done to or said about ${player}, and anything that happens inside ${player}'s territory — but never more than the ${items.length} thing${items.length === 1 ? "" : "s"} listed below gives reason for. `
      + `The share is a ceiling on attention, not a quota: never invent business for ${player} to reach it, and when these run out the world fills the period within its usual number of events.`,
  ];
  if (orders.length) {
    lines.push("", `ORDERS — every one gets an outcome this period (success, partial success, delay or failure), in an event that lists its id in actionIds. One event may answer several orders when they are genuinely the same thing.`);
    for (const order of orders) lines.push(`- [${order.id}] ${order.label}${order.overdue ? " (OVERDUE: carried over unanswered from the last period; answer it first)" : ""}`);
  }
  if (due.length) {
    lines.push("", `DUE THIS PERIOD — each gets an outcome in an event that names the Project exactly: reached, slipped or missed. Never leave a date behind with nothing said.`);
    for (const item of due) lines.push(`- ${item.label}`);
  }
  const grouped = new Map();
  for (const item of optional) grouped.set(item.kind, [...(grouped.get(item.kind) ?? []), item]);
  if (grouped.size) {
    lines.push("", `ALSO GOING ON — draw ${player}'s share from these, following through on what earlier events set in motion. A milestone coming up may get a lead-up event; it does not need one.`);
    for (const [kind, group] of grouped) lines.push(`${MATERIAL_HEADINGS[kind] ?? kind}: ${group.map((item) => item.label).join("; ")}`);
  }
  return lines.join("\n");
};
