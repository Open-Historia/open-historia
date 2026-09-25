/*! Open Historia — the editable guidance inside each system prompt © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every system prompt is a fixed technical template that the game depends on —
// the placeholders that inject the world, the output contracts, the map rules —
// with a few passages of GUIDANCE inside it: the role, the tone, what to
// simulate and how much, what makes a good event. Only the guidance is shown
// and editable in the scenario and game editors; the technical text is never
// stored anywhere but here, so a change to it reaches every scenario and game.
//
// A segment is located in its default prompt (defaultPrompts.json) by a short
// `start` and `end` anchor, both copied verbatim from that text: the segment is
// the text from the first character of `start` to the last of `end`. A
// prompt's segments must appear in order and must not overlap
// (promptGuidance.test.js checks every one). Composing a prompt replaces each
// segment's default text with the author's, and nothing else moves — so an
// unedited pack renders byte-for-byte the prompt the game ships with.
//
// The registry key is the prompt's section key: "advisor", "leader", or a task
// key. A prompt with no entry here has no guidance and does not appear in the
// editor; the model-facing tasks (curator, directors, resolver, stat sheet,
// spy desks, the board) are entirely technical by design.

import { readUnderTaskKey } from "./formerTaskKeys.js";

const segment = (id, label, start, end, hint = "") => Object.freeze({ id, label, start, end, hint });

export const PROMPT_GUIDANCE = Object.freeze({
  advisor: Object.freeze([
    segment("role", "Who the advisor is and how it speaks",
      "You are roleplaying as the chief advisor",
      "Roleplay as their advisor. With that said, here are some more game details.",
      "The advisor's role, immersion, formatting and length."),
    segment("guidelines", "How it advises",
      "[Other Guidelines] There are some specific rules",
      "as an advisor who is actually living in the world the player polity is in.",
      "How committed, how specific, how it handles statistics and pushback."),
    segment("reminders", "Final reminders",
      "[Final Reminders] Remember, it is crucially important",
      "Don’t just leave the player with too many options.",
      "The closing instruction before the chat history."),
  ]),
  leader: Object.freeze([
    segment("stance", "How a polity negotiates",
      "With that being said, respond as a competent government pursuing its own current interests.",
      "Your visible output is only the responding polity's message in this conversation.",
      "Decision posture, decisiveness, and neutrality about whether a proposal came from the player."),
    segment("tone", "Tone",
      "[Tone]Lightly match the player's level of formality while keeping the responding polity's own institutional voice, culture, leadership, and intent.",
      "Do NOT speak like a robot.",
      "Light tone matching without forcing grammatical person, threats, slang, or filler."),
    segment("leaving", "When polities leave a chat",
      "[Speakers leaving the chat]In our game, polities during chats can simply choose to leave.",
      "such as if each polity in the chat is demanding that polity's silence.",
      "Why and when a participant stops speaking."),
    segment("reply", "What a reply should be",
      "**REMEMBER: Your reply should**1. Be a natural continuation of the conversation.",
      "do not invent actions or agreements that have not occurred. Speak logically.",
      "The qualities every in-character message must have, without outcome-forced threats or celebration."),
  ]),
  tasks: Object.freeze({
    actions: Object.freeze([
      segment("role", "What the suggestions cover",
        "[Your Role] Your job is to provide a wide array of suggested actions",
        "This is the format in which you will provide suggested actions.",
        "Topics of concern and how many actions each gets."),
    ]),
    jumpForward: Object.freeze([
      segment("role", "The simulator's role",
        "[Your Role]\nThe player is playing as the polity of ${PLAYER_POLITY}.",
        "experience the EFFECTS of those actions and thereby change or simulate history.",
        "Who simulates what."),
      segment("history", "Historical, alt-historical or fictional",
        "[Historical, Alt-Historical, or Fictional]",
        "NEVER put words like (fictional) or (a-historical) in the title or description of any event.",
        "How far the world may diverge from history."),
      segment("difficulty", "How difficulty applies",
        "Difficulty is expressed in the difficulty of the player's LONG-TERM goals",
        "game-specific context, and any alt-historical preparation the player built up.",
        "What difficulty makes harder and what it never forbids."),
      segment("agency", "Player agency",
        "[Player Agency — critical]",
        "always refer to the player's polity as ${PLAYER_POLITY}.",
        "Never acting for the player."),
      segment("orders", "What an order can do",
        "[What an Order Can Do]",
        "not with 1939's under new dates.",
        "Feasibility, the chain of authority, failure, and the pace of a war."),
      segment("scope", "What to simulate and how much",
        "[What to Simulate]",
        "and whenever an event warrants a region change, get that change right.",
        "Breadth, event count per month, and consequences of the player's actions."),
      segment("reactions", "The world answers back",
        "[The World Answers Back]",
        "Bring the pressure to the player's door and stop there.",
        "Other powers reacting on their own initiative, and how much of a jump is theirs."),
      segment("flags", "Flags",
        "[Flags]\nSome polities have flags, and flags sometimes change.",
        "(such as Vichy France in a WWII game).",
        "When flags change and how they are described."),
      segment("quality", "Event quality",
        "[Event Quality]\nEvery event is a headline, a description, and potentially map changes.",
        "Only newsworthy events belong in the output.",
        "Headlines, description lengths, quotes, filler and dates."),
      segment("voice", "Event voice",
        "[Event Voice]",
        "rather than gesturing at \"the proposal\" or \"the plan.\"",
        "Reporting instead of commenting: adjectives, attributed opinions, endings, atmosphere, intent."),
    ]),
    autoJumpForward: Object.freeze([
      segment("role", "The simulator's role",
        "[Your Role]\nThe player is playing as the polity of ${PLAYER_POLITY}.",
        "always refer to the player as ${PLAYER_POLITY}.",
        "Who simulates what."),
      segment("difficulty", "How difficulty applies",
        "Difficulty is expressed in the difficulty of the player's LONG-TERM goals",
        "with difficulty and with how realistic and logical the action is.",
        "What difficulty makes harder and what it never forbids."),
      segment("agency", "Player agency",
        "[Player Agency — critical]",
        "If the player chooses not to act, assume it was deliberate and simulate the world accordingly.",
        "Never acting for the player."),
      segment("orders", "What an order can do",
        "[What an Order Can Do]",
        "not with 1939's under new dates.",
        "Feasibility, the chain of authority, failure, and the pace of a war."),
      segment("scope", "What to simulate",
        "[What to Simulate]",
        "Never generate a duplicate or exact copy of an event that already exists.",
        "Breadth and the consequences of the player's actions."),
      segment("reactions", "The world answers back",
        "[The World Answers Back]",
        "Bring the pressure to the player's door and stop there.",
        "Other powers reacting on their own initiative, and how much of a jump is theirs."),
      segment("stopping", "Where the auto-jump stops",
        "[Immersive Events — also stop for the great moments]",
        "A good game surprises the player and demands their engagement.",
        "Stopping for decisions and for the memorable moments."),
      segment("count", "How many events",
        "[How Many Events]",
        "Stick to this VERY STRICTLY.",
        "The number of events per auto-jump."),
      segment("quality", "Event quality",
        "[Event Quality]\nEvery event is a headline, a description, and potentially map changes.",
        "even in fictional and a-historical gamestates.",
        "Headlines, descriptions and quotes."),
      segment("voice", "Event voice",
        "[Event Voice]",
        "rather than gesturing at \"the proposal\" or \"the plan.\"",
        "Reporting instead of commenting: adjectives, attributed opinions, endings, atmosphere, intent."),
      segment("flags", "Flags",
        "[Flags]\nSome polities have flags.",
        "and a polity's flag changes when its regime changes.",
        "When flags change and how they are described."),
      segment("donot", "What not to write",
        "[Do Not]",
        "Only newsworthy events belong in the output.",
        "Filler, meta events and mechanical spacing."),
    ]),
    interactiveCreation: Object.freeze([
      segment("guidelines", "What makes a good interactive event",
        "[Important Guidelines] Interactive events are NOT a clone of one of the listed events",
        "Think of variety and fun, not just bland and generic political meetings.**",
        "The kinds of scenes worth simulating, with examples."),
      segment("reminders", "Writing reminders",
        "Reminders:\nDialogue should always be surrounded by double quotes",
        "your output shouldn’t include “the player decided” or “this will make the player”.\nGiven this, begin outputting.",
        "Dialogue, tone, immersion and the choices offered."),
    ]),
    interactiveExecutor: Object.freeze([
      segment("style", "How an interactive event reads",
        "The Interactive event MUST be engaging and immersive but not overdramatic and meaningless.",
        "Do not just make it boring busywork.",
        "Engagement, length and personality."),
      segment("duration", "How much time an interactive event covers",
        "[Length/In-game Duration of the Interactive event]",
        "Overall, each action and passage you make should be logical and not reflect something bizarre happening for the sake of a variety of actions for the player. Always keep it fun but immersive.",
        "Days, replies and pacing inside an interactive event."),
      segment("reminders", "Writing reminders",
        "Reminders:\nDialogue should always be surrounded by double quotes",
        "your output shouldn’t include “the player decided” or “this will make the player”.\nGiven this, begin outputting.",
        "Dialogue, tone, reaction to the player's choice, and the choices offered."),
    ]),
    interactiveSummary: Object.freeze([
      segment("style", "How the summary is written",
        "The simulation MUST be engaging and immersive but not overdramatic and meaningless.",
        "“Diplomat from Polity X spoke to the prime minister of Polity Y about trade”.",
        "What the summary keeps and how it refers to the player."),
    ]),
    descriptionToAction: Object.freeze([
      segment("kinds", "Actions versus chats",
        "Almost every action should be transformed into an ACTION type",
        "ONLY and I MEAN ONLY make chat actions if the player wants to open a chat.",
        "When a written decision becomes a chat instead of an action."),
      segment("length", "Length and tone",
        "Convert this into a more descriptive and clear version for the A.I. to act on",
        "Not the tone of ALL of the player’s actions.",
        "How much detail is added and how the tone is kept."),
      segment("closing", "What the rewrite must do",
        "Remember, what you write should enhance and make the player’s written action",
        "So ADD content to the player’s action, lots of it, but don’t remove any of the player’s intent.",
        "Enhance without removing the player's intent."),
    ]),
    eventConsolidator: Object.freeze([
      segment("style", "How history is summarised",
        "The text should be introduced like a summary of events",
        "Any successful or even failed deals and long chats that the player had MUST, absolutely MUST be included in the consolidation.",
        "Date ranges, clarity, and what must never be dropped."),
    ]),
    pregameHistory: Object.freeze([
      segment("scope", "What the backstory covers",
        "Write 4 to 10 events that dramatize the briefing",
        "never contradict the briefing or the map.",
        "How many events and how faithful to the briefing."),
    ]),
    idleDiplomacy: Object.freeze([
      segment("reasons", "When a polity reaches out",
        "Send a note only when some polity has a live reason to speak",
        "and never repeat a note already visible in the existing chats.",
        "What counts as a live reason to write, and what never does."),
    ]),
  }),
});

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// The segments declared for a section: "advisor" / "leader" are root prompts,
// anything else is a task key. Empty for a prompt with no guidance.
export const guidanceSegmentsFor = (sectionKey) => {
  if (sectionKey === "advisor" || sectionKey === "leader") return PROMPT_GUIDANCE[sectionKey] ?? [];
  return PROMPT_GUIDANCE.tasks[sectionKey] ?? [];
};

export const hasGuidance = (sectionKey) => guidanceSegmentsFor(sectionKey).length > 0;

// Where a segment sits in a prompt, or null when an anchor is missing or the
// anchors are out of order. `from` bounds the search so segments stay ordered.
export const locateSegment = (text, seg, from = 0) => {
  const source = String(text ?? "");
  const start = source.indexOf(seg.start, from);
  if (start < 0) return null;
  const endAt = source.indexOf(seg.end, start);
  if (endAt < 0) return null;
  const end = endAt + seg.end.length;
  return { start, end, text: source.slice(start, end) };
};

// The default guidance of every segment of a section, keyed by segment id.
export const defaultGuidanceFor = (sectionKey, defaultText) => {
  const result = {};
  let cursor = 0;
  for (const seg of guidanceSegmentsFor(sectionKey)) {
    const found = locateSegment(defaultText, seg, cursor);
    if (!found) continue;
    result[seg.id] = found.text;
    cursor = found.end;
  }
  return result;
};

// A section's guidance overrides, normalised: only strings for known segment
// ids, trimmed, blank ones dropped (blank means "use the default") and, when
// the defaults are given, any text identical to its default dropped too, so a
// stored pack holds nothing but real edits. Placeholders are welcome in
// guidance: composition happens before rendering, so "${PLAYER_POLITY}" in an
// author's passage fills in exactly as it does in the default.
export const normalizeSectionGuidance = (sectionKey, raw, defaults = null) => {
  const source = isRecord(raw) ? raw : {};
  const known = new Set(guidanceSegmentsFor(sectionKey).map((seg) => seg.id));
  const result = {};
  for (const [id, value] of Object.entries(source)) {
    if (!known.has(id) || typeof value !== "string") continue;
    const text = value.trim();
    if (!text) continue;
    if (defaults && typeof defaults[id] === "string" && defaults[id].trim() === text) continue;
    result[id] = text;
  }
  return result;
};

// A stored prompt pack is { promptModel: 2, guidance }: the author's edits
// alone, keyed by section and segment. Whole prompts are never stored.
export const PROMPT_MODEL_VERSION = 2;

// The guidance defaults of a whole pack, every section's default passages,
// from the default prompt texts ({ advisor, leader, tasks }).
export const buildGuidanceDefaults = (defaults) => ({
  advisor: defaultGuidanceFor("advisor", defaults?.advisor ?? ""),
  leader: defaultGuidanceFor("leader", defaults?.leader ?? ""),
  tasks: Object.fromEntries(
    Object.keys(PROMPT_GUIDANCE.tasks).map((key) => [key, defaultGuidanceFor(key, defaults?.tasks?.[key] ?? "")]),
  ),
});

// The edits a stored pack carries, normalised: known sections and segments
// only, trimmed, with blanks and default-identical text dropped. A pack of any
// other shape carries nothing — the old model stored whole prompts, technical
// text included, and those froze at the time of the save; they are ignored so
// every scenario and game runs the current defaults plus its guidance. A
// renamed task's edits are read from its old key when its new one has none
// (formerTaskKeys.js), and kept under the new one.
export const normalizePackGuidance = (rawPack, guidanceDefaults = null) => {
  const pack = isRecord(rawPack) ? rawPack : {};
  const source = Number(pack.promptModel) === PROMPT_MODEL_VERSION && isRecord(pack.guidance) ? pack.guidance : {};
  const tasks = isRecord(source.tasks) ? source.tasks : {};
  const taskGuidance = {};
  for (const key of Object.keys(PROMPT_GUIDANCE.tasks)) {
    const bucket = normalizeSectionGuidance(key, readUnderTaskKey(tasks, key), guidanceDefaults?.tasks?.[key] ?? null);
    if (Object.keys(bucket).length) taskGuidance[key] = bucket;
  }
  return {
    advisor: normalizeSectionGuidance("advisor", source.advisor, guidanceDefaults?.advisor ?? null),
    leader: normalizeSectionGuidance("leader", source.leader, guidanceDefaults?.leader ?? null),
    tasks: taskGuidance,
  };
};

// Materialize every editable passage for an explicit transfer/export. Stored
// scenario packs stay sparse via normalizePackGuidance; this helper is only for
// moving the complete author-editable layer between scenarios/files.
export const materializePackGuidance = (rawPack, guidanceDefaults = null) => {
  const defaults = isRecord(guidanceDefaults) ? guidanceDefaults : {};
  const overrides = normalizePackGuidance(rawPack, guidanceDefaults);
  const defaultTasks = isRecord(defaults.tasks) ? defaults.tasks : {};
  return {
    advisor: { ...(isRecord(defaults.advisor) ? defaults.advisor : {}), ...overrides.advisor },
    leader: { ...(isRecord(defaults.leader) ? defaults.leader : {}), ...overrides.leader },
    tasks: Object.fromEntries(
      Object.keys(PROMPT_GUIDANCE.tasks).map((key) => [
        key,
        { ...(isRecord(defaultTasks[key]) ? defaultTasks[key] : {}), ...(overrides.tasks?.[key] ?? {}) },
      ]),
    ),
  };
};

// The prompt the game runs: the default text with each segment's default
// replaced by the author's text where one was written.
export const composePrompt = (sectionKey, defaultText, guidance) => {
  const overrides = normalizeSectionGuidance(sectionKey, guidance);
  if (!Object.keys(overrides).length) return String(defaultText ?? "");
  let text = String(defaultText ?? "");
  let cursor = 0;
  for (const seg of guidanceSegmentsFor(sectionKey)) {
    const found = locateSegment(text, seg, cursor);
    if (!found) continue;
    const replacement = overrides[seg.id] ?? found.text;
    text = text.slice(0, found.start) + replacement + text.slice(found.end);
    cursor = found.start + replacement.length;
  }
  return text;
};
