/*! Open Historia - read-only campaign lore records. AGPL-3.0-or-later. */
import { compareGameDates, isGameDate, normalizeGameDate } from "./gameDates.js";
import { normalizePublicStatement } from "./publicCommunications.js";
import { normalizeInteractiveTranscript } from "./interactiveTranscript.js";
import { eventNamesPolity } from "./eventConcerns.js";
import { polityMatches } from "../Game/AI/audience.js";

export const LORE_SCHEMA_VERSION = 1;
export const LORE_DEFAULT_OPTIONS = Object.freeze({
  scope: "global",
  from: "",
  to: "",
  actions: false,
  conversations: false,
  transcripts: false,
  snapshot: true,
});

const list = (value) => (Array.isArray(value) ? value : []);
const eventRows = (value) => (
  Array.isArray(value)
    ? value
    : Array.isArray(value?.events)
      ? value.events
      : value && typeof value === "object"
        ? Object.values(value)
        : []
)
  .map((row) => (typeof row === "string" ? { title: row } : row))
  .filter((row) => row && typeof row === "object" && !Array.isArray(row));
const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
const str = (value) => (typeof value === "string" ? value : "");
const pickFields = (item, keys) => Object.fromEntries(
  keys.flatMap((key) => {
    const value = item?.[key];
    return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))
      ? [[key, value]]
      : [];
  }),
);
const stringList = (value) => list(value).filter((item) => typeof item === "string");
const samePolity = (left, right) => polityMatches(left, right);
const byDate = (left, right) => compareGameDates(left.date, right.date);
const inDateRange = (date, from, to) => (
  !isGameDate(date)
  || ((!from || compareGameDates(date, from) >= 0) && (!to || compareGameDates(date, to) <= 0))
);
const isPrivateEvent = (event) => (
  event?.source === "espionage"
  || event?.kind === "espionage"
  || (event?.audience != null && (!Array.isArray(event.audience) || event.audience.length > 0))
);

// The first export deliberately excludes intelligence, scoped events and raw
// impacts. No narrator/world-state dump, credit/key/settings fields or prompts.
// This is a visible-history presentation, NOT a reloadable save.
export const buildCampaignLore = ({
  metadata = {},
  game = {},
  world = {},
  events = [],
  actions = [],
  chats = [],
  advisor = [],
} = {}, options = {}) => {
  const config = { ...LORE_DEFAULT_OPTIONS, ...options };
  const from = normalizeGameDate(config.from);
  const to = normalizeGameDate(config.to || game.gameDate);
  if ((config.from && !from) || (config.to && !to) || (from && to && compareGameDates(from, to) > 0)) {
    throw new Error("Enter a valid campaign date range.");
  }
  if (to && isGameDate(game.gameDate) && compareGameDates(to, game.gameDate) > 0) {
    throw new Error("The end date cannot be later than the recorded campaign date.");
  }

  const player = str(game.country);
  const retained = eventRows(events);
  const eventsInRange = retained.filter((event) => inDateRange(event.date, from, to));
  const publicEvents = retained.filter((event) => !isPrivateEvent(event));
  const hiddenIds = new Set(retained.filter(isPrivateEvent).map((event) => event.id).filter(Boolean));
  const sourceEvents = new Map(publicEvents.filter((event) => event.id).map((event) => [event.id, event]));
  const included = eventsInRange.filter(
    (event) => !isPrivateEvent(event) && (config.scope !== "player" || event.playerRelated === true || eventNamesPolity(event, player)),
  );

  const chronology = included
    .map((event) => {
      const title = str(event.title || event.headline || event.name);
      const description = str(event.description || event.summary || event.text);
      const entry = {
        ...pickFields(event, ["id", "date", "title", "description", "importance", "kind", "source", "playerRelated", "notable", "warId"]),
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
        tags: stringList(event.tags),
        concerns: stringList(event.concerns),
        combatants: stringList(event.combatants),
        ...(isRecord(event.quote) && str(event.quote.text) ? { quote: pickFields(event.quote, ["text", "speaker", "role"]) } : {}),
      };
      const statement = normalizePublicStatement(event);
      if (statement) entry.publicStatement = statement;
      if (event.kind === "interactive" || event.kind === "catalyst") {
        const archive = normalizeInteractiveTranscript(event.interactiveTranscript);
        const permitted = archive && !hiddenIds.has(archive.sourceEventId);
        entry.transcriptStatus = !archive ? "unavailable" : !permitted || !config.transcripts ? "excluded" : "included";
        if (permitted && config.transcripts) entry.interactiveTranscript = archive;
      }
      return entry;
    })
    .sort(byDate);

  const ownActions = config.actions
    ? list(actions)
      .map((item) => (typeof item === "string" ? { text: item } : item))
      .filter((item) => isRecord(item) && (!item.ownerCode || samePolity(item.ownerCode, player)))
      .map((item) => pickFields(item, ["id", "title", "text", "status", "kind", "resolvedRound", "overdue"]))
    : [];

  // A former shared campaign can retain seat-owned threads and advisors. Never
  // export seat archives; only the host/current player's own message projection.
  const diplomatic = config.conversations
    ? list(chats)
      .filter(
        (chat) => isRecord(chat)
          && (!chat.player || samePolity(chat.player, player))
          && !list(chat.retiredFor).some((name) => samePolity(name, player))
          && !hiddenIds.has(chat.linkedEventId),
      )
      .map((chat) => ({
        ...pickFields(chat, ["id", "title", "status", "institutionId", "linkedEventId"]),
        participants: list(chat.countries).flatMap((party) => (
          typeof party === "string" ? [party] : isRecord(party) ? [pickFields(party, ["name", "code"])] : []
        )),
        messages: list(chat.messages)
          .filter((message) => isRecord(message) && str(message.text) && !hiddenIds.has(message.eventId) && inDateRange(message.time, from, to))
          .map((message) => pickFields(message, ["id", "role", "speaker", "code", "text", "time", "eventId"])),
      }))
      .filter((chat) => chat.messages.length)
    : [];

  const advisorMessages = config.conversations
    ? list(advisor)
      .filter(
        (message) => isRecord(message)
          && ["user", "advisor"].includes(message.role)
          && message.streaming !== true
          && str(message.text)
          && !hiddenIds.has(message.eventId)
          && inDateRange(message.time, from, to),
      )
      .map((message) => pickFields(message, ["id", "role", "text", "time", "threadId", "speakerId"]))
    : [];

  // Snapshot rows describe the saved present, not the historical state at the
  // end of a filtered period. Do not flatten hidden foreign project boards.
  const snapshot = config.snapshot
    ? {
      date: str(game.gameDate),
      wars: list(world.wars)
        .filter((war) => isRecord(war) && (config.scope !== "player" || [...list(war.sideA), ...list(war.sideB)].some((name) => samePolity(name, player))))
        .map((war) => ({
          ...pickFields(war, ["id", "title", "status", "startedDate", "endedDate", "lastUpdatedDate"]),
          sideA: stringList(war.sideA),
          sideB: stringList(war.sideB),
          sourceEventIds: stringList(war.sourceEventIds).filter((id) => sourceEvents.has(id)),
        })),
      projects: list(world.projects)
        .filter((project) => isRecord(project) && (!project.ownerCode || samePolity(project.ownerCode, player)) && (config.actions || project.secrecy === "public"))
        .map((project) => pickFields(project, ["id", "name", "kind", "status", "summary", "progress", "startedAt", "targetDate", "completedAt", "lastUpdate", "secrecy"])),
      ...(config.actions ? { standingGoal: pickFields(world.playerGoals?.[player], ["text", "date", "round"]) } : {}),
      ...(isRecord(world.countryStats?.[player])
        ? {
          playerMetrics: {
            ...pickFields(world.countryStats[player], ["asOf", "date", "source"]),
            population: pickFields(world.countryStats[player].population, ["total", "annualGrowthRate"]),
            economy: pickFields(world.countryStats[player].economy, ["gdp", "gdpGrowth", "gdpPerCapita"]),
            units: {
              population: "people",
              annualGrowthRate: "percent/year",
              gdp: "2026 USD equivalent",
              gdpGrowth: "percent/year",
              gdpPerCapita: "2026 USD equivalent/person",
            },
          },
        }
        : {}),
    }
    : null;

  const dates = chronology.map((event) => event.date).filter(isGameDate);
  return {
    schemaVersion: LORE_SCHEMA_VERSION,
    campaign: {
      ...pickFields(metadata, ["name", "scenario"]),
      ...pickFields(game, ["country", "startDate", "gameDate", "round", "difficulty"]),
    },
    coverage: {
      scope: config.scope === "player" ? "player" : "global",
      from: from || null,
      to: to || null,
      firstRecordedDate: dates[0] || null,
      lastRecordedDate: dates.at(-1) || null,
      eventCount: chronology.length,
      retainedPublicEventCount: publicEvents.length,
      excludedBySelection: publicEvents.length - chronology.length,
      undatedEvents: chronology.filter((event) => !isGameDate(event.date)).length,
      actionsIncluded: Boolean(config.actions),
      conversationsIncluded: Boolean(config.conversations),
      transcriptsIncluded: Boolean(config.transcripts),
      snapshotIncluded: Boolean(config.snapshot),
      limitations: [
        "Only retained records are exported, not reconstructed history. Early records already removed from the save cannot be recovered here.",
        "Intelligence, scoped events, hidden seat archives, raw impacts, settings, debug logs, and rollback snapshots are excluded. Compressed AI history documents are not treated as original records.",
        "Undated records cannot be reliably assigned to a selected period; retained undated records are labeled.",
        "Orders are the retained action board, with their recorded status and resolved round when known, not a complete historical order ledger. They are not date-filtered.",
        "Current state describes the saved campaign date rather than a reconstructed past snapshot. Stats are recorded estimates, not real-world facts.",
        "Conversations are attributed dialogue, not proof of executed agreements. Missing historical transcripts are not reconstructed.",
        "Player-focused events use recorded player-related markers and structured polity references, not name guesses from prose.",
        "Review private narrative text before sharing; free text may itself contain information you entered.",
      ],
    },
    events: chronology,
    actions: ownActions,
    diplomacy: diplomatic,
    advisor: advisorMessages,
    snapshot,
  };
};

// Escape structure and HTML without altering the original narrative inside
// fenced text sections. Fence length is chosen from the actual stored text.
const escapeMarkdown = (value) => str(value).replace(/[\\`*_{}[\]()<>#+.!|]/g, "\\$&").replace(/\r?\n/g, " ");
const fencedBlock = (value) => {
  const text = str(value);
  const fence = "`".repeat((text.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length + 1), 3));
  return `${fence}text\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
};
const namedLine = (label, value) => (value === undefined || value === null || value === "" ? "" : `- ${label}: ${escapeMarkdown(String(value))}`);
const sourceRefLine = (item) => (item.id ? namedLine("Source ID", item.id) : "- Source ID: not recorded");

export const campaignLoreMarkdown = (lore) => {
  const { campaign, coverage } = lore;
  const out = [
    `# Campaign record: ${escapeMarkdown(campaign.name || "Unnamed campaign")}`,
    "Deterministic export of retained Open Historia records. Not an AI-generated chronicle or a reloadable save.",
    [
      namedLine("Scenario", campaign.scenario),
      namedLine("Player polity", campaign.country),
      namedLine("Start date", campaign.startDate),
      namedLine("Recorded date", campaign.gameDate),
      namedLine("Commit round", campaign.round),
      namedLine("Difficulty", campaign.difficulty),
    ].filter(Boolean).join("\n"),
    "## Coverage",
    [
      namedLine("Scope", coverage.scope),
      namedLine("Selected start", coverage.from || "All retained earlier dates"),
      namedLine("Selected end", coverage.to),
      namedLine("First available dated event", coverage.firstRecordedDate),
      namedLine("Last available dated event", coverage.lastRecordedDate),
      namedLine("Events", coverage.eventCount),
      namedLine("Available public events", coverage.retainedPublicEventCount),
      namedLine("Events outside selected scope or dates", coverage.excludedBySelection),
      namedLine("Undated events", coverage.undatedEvents),
      namedLine("Orders included", coverage.actionsIncluded),
      namedLine("Conversations included", coverage.conversationsIncluded),
      namedLine("Interactive transcripts included", coverage.transcriptsIncluded),
      namedLine("Current snapshot included", coverage.snapshotIncluded),
    ].filter(Boolean).join("\n"),
    ...coverage.limitations.map((text) => `- ${text}`),
    "## Chronology",
  ];

  if (!lore.events.length) out.push("No matching retained events.");
  for (const event of lore.events) {
    out.push(
      `### ${escapeMarkdown(event.date || "Undated")} - ${escapeMarkdown(event.title || "Untitled event")}`,
      [
        sourceRefLine(event),
        namedLine("Kind", event.kind),
        namedLine("Importance", event.importance),
        namedLine("Source", event.source),
        namedLine("Categories", event.tags.join(", ")),
        namedLine("Concerns", event.concerns.join(", ")),
        namedLine("Combatants", event.combatants.join(", ")),
        namedLine("War ID", event.warId),
      ].filter(Boolean).join("\n"),
    );
    if (event.publicStatement) {
      out.push(
        "**Official public statement**",
        [
          namedLine("Issuer", event.publicStatement.issuer),
          namedLine("Intended audience", event.publicStatement.audienceLabel),
        ].filter(Boolean).join("\n"),
        fencedBlock(event.publicStatement.body),
      );
    } else if (event.description) {
      out.push(fencedBlock(event.description));
    }
    if (event.quote?.text) {
      out.push(
        "**Attributed quotation**",
        [namedLine("Speaker", event.quote.speaker), namedLine("Role", event.quote.role)].filter(Boolean).join("\n"),
        fencedBlock(event.quote.text),
      );
    }
    if (event.transcriptStatus && !event.interactiveTranscript) {
      out.push(`Interactive transcript: ${event.transcriptStatus}.`);
    }
    const transcript = event.interactiveTranscript;
    if (transcript) {
      out.push(
        `#### Interactive transcript: ${escapeMarkdown(transcript.title)}`,
        [
          namedLine("Source event ID", transcript.sourceEventId),
          namedLine("Scene date", transcript.startedOn),
          namedLine("Ending", transcript.endedBy),
        ].filter(Boolean).join("\n"),
      );
      for (const [label, text] of [["Premise", transcript.premise], ["Player angle", transcript.request], ["Opening", transcript.firstOpening]]) {
        if (text) out.push(`**${label}**`, fencedBlock(text));
      }
      transcript.beats.forEach((beat, index) => {
        out.push(`##### Move ${index + 1}`);
        if (beat.before) out.push("Before move", fencedBlock(beat.before));
        if (beat.offered) out.push("Offered choices", ...beat.offered.map(fencedBlock));
        out.push("Accepted choice", fencedBlock(beat.choice), "Response", fencedBlock(beat.summary));
      });
    }
  }

  if (coverage.actionsIncluded) {
    out.push("## Retained orders (intent and execution status)");
    for (const action of lore.actions) {
      out.push(
        `### ${escapeMarkdown(action.title || "Order")}`,
        [
          sourceRefLine(action),
          namedLine("Status", action.status),
          namedLine("Resolved round", action.resolvedRound),
          namedLine("Overdue", action.overdue),
        ].filter(Boolean).join("\n"),
        fencedBlock(action.text),
      );
    }
  }

  if (coverage.conversationsIncluded) {
    out.push("## Retained diplomatic conversations");
    for (const chat of lore.diplomacy) {
      out.push(
        `### ${escapeMarkdown(chat.title || "Diplomatic thread")}`,
        [
          sourceRefLine(chat),
          namedLine("Status", chat.status),
          namedLine("Participants", chat.participants.map((party) => (typeof party === "string" ? party : party.name || party.code)).join(", ")),
        ].filter(Boolean).join("\n"),
      );
      for (const message of chat.messages) {
        out.push(
          `**${escapeMarkdown(message.time || "Undated")} | ${escapeMarkdown(message.speaker || message.code || message.role || "Speaker not recorded")}**`,
          sourceRefLine(message),
          fencedBlock(message.text),
        );
      }
    }
    out.push("## Advisor conversations");
    for (const message of lore.advisor) {
      out.push(
        `**${escapeMarkdown(message.time || "Undated")} | ${escapeMarkdown(message.role)}**`,
        [
          sourceRefLine(message),
          namedLine("Thread ID", message.threadId),
          namedLine("Speaker ID", message.speakerId),
        ].filter(Boolean).join("\n"),
        fencedBlock(message.text),
      );
    }
  }

  if (lore.snapshot) {
    out.push("## Recorded current state (not reconstructed history)", fencedBlock(JSON.stringify(lore.snapshot, null, 2)));
  }

  return `${out.filter(Boolean).join("\n\n")}\n`;
};

export const campaignLoreFileName = (lore, format = "md") => {
  const stem = (lore.campaign.name || "campaign")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "campaign";
  const datePart = normalizeGameDate(lore.campaign.gameDate) || "undated";
  const ext = format === "json" ? "json" : "md";
  return `${stem}-lore-${datePart}.${ext}`;
};
