import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STAND_IN_REPLY = [
  "**The budget comes first.** Every other lever we hold hangs on the deficit, so I have queued the cabinet meeting we settled on and opened the consolidation plan on the board.",
  "",
  "## What I would do next",
  "- Freeze discretionary spending for *one quarter*",
  "- Agree a common line on the fiscal rules with Berlin",
  "- Leave the defence budget untouched",
  "",
  "| Measure | Effect |",
  "|---|---|",
  "| Spending freeze | -0.4% deficit |",
  "| Bond issue | flat |",
  "",
  "I have drafted a note to Germany you could send today:",
  "",
  "> Chancellor, France proposes that our finance ministers meet before the next summit to agree a common position on the fiscal rules.",
  "```senddraft",
  "[{\"targetType\":\"private\",\"country\":\"Germany\"}]",
  "```",
  "```actions",
  "[{\"title\":\"Convene the budget cabinet\",\"text\":\"Convene the cabinet this week to agree a one-quarter freeze on discretionary spending.\",\"kind\":\"action\"}]",
  "```",
  "```projects",
  "[{\"op\":\"create\",\"name\":\"Fiscal Consolidation Plan\",\"summary\":\"A three-year plan to bring the deficit under three percent.\",\"kind\":\"project\",\"tags\":[\"economic\"],\"status\":\"active\",\"progress\":0,\"targetDate\":\"2027-12-31\"}]",
  "```",
  "```chart",
  "{\"type\":\"bar\",\"data\":{\"labels\":[\"Now\",\"+1 year\",\"+2 years\",\"+3 years\"],\"datasets\":[{\"label\":\"Deficit (% of GDP)\",\"data\":[3.6,3.2,2.9,2.7]},{\"label\":\"Target\",\"data\":[3,3,3,3]}]},\"options\":{\"unit\":\"percent\"}}",
  "```",
  "```deploy",
  "[{\"type\":\"infantry\",\"name\":\"Brigade de Lorraine\",\"composition\":\"2 infantry regiments\",\"strength\":80,\"lng\":6.18,\"lat\":48.69}]",
  "```",
  "ADVISOR_MEMORY: The player wants the budget steadied first; a note to Germany on the fiscal rules was drafted.",
].join("\n");

const STAND_IN_INSTITUTION_REPLY = [
  "The cleanest next step is to put the fiscal rules on the agenda formally, and I have prepared that for you to confirm.",
  "```institutiondraft",
  "[{\"type\":\"table-proposal\",\"institutionId\":\"european-union\",\"proposalType\":\"resolution\",\"title\":\"Common fiscal rules\",\"summary\":\"Adopt a shared deficit path for the next three years.\"}]",
  "```",
  "ADVISOR_MEMORY: The player wants the budget steadied first and the fiscal rules tabled formally.",
].join("\n");

const STAND_IN_CHARACTER_REPLY = [
  "I only know what the papers print and what people say in the market. The talk is of the budget, and of little else.",
  "```actions",
  "[{\"title\":\"Hold a rally for the budget\",\"text\":\"Hold a rally in the capital in support of the budget.\",\"kind\":\"action\"}]",
  "```",
  "```projects",
  "[{\"op\":\"create\",\"name\":\"Neighbourhood Budget Committee\",\"summary\":\"A committee of citizens to watch the budget.\",\"kind\":\"project\",\"tags\":[\"economic\"],\"status\":\"active\",\"progress\":0}]",
  "```",
  "ADVISOR_MEMORY: The player asked a citizen about the budget.",
].join("\n");

const ADVISOR_MARK = "[Drafting Messages to Send]";
const CHARACTER_MARK = "[Character Conversation — Public Context Only]";
const PRIVATE_MARKS = ["[Action Planning]", "[Current Planned Actions]", "[Current Projects]", ADVISOR_MARK];
const FAIL_MARK = "fleet";

const lastUserText = (body) => {
  const entries = Array.isArray(body?.contents) ? body.contents : [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.role === "user") return (entries[index].parts ?? []).map((part) => part?.text ?? "").join("\n");
  }
  return "";
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const splitForStream = (text, count) => {
  const pieces = [];
  const size = Math.max(1, Math.ceil(text.length / count));
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + size);
    const space = text.indexOf(" ", end);
    if (end < text.length && space !== -1 && space - end < 40) end = space + 1;
    pieces.push(text.slice(at, end));
    at = end;
  }
  return pieces;
};

const installStreamingStandIn = () => {
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init = undefined) => {
    const response = await inner(input, init);
    const url = typeof input === "string" || input instanceof URL ? String(input) : String(input?.url ?? "");
    if (!url.includes("streamGenerateContent") || !response.ok || !String(init?.body ?? "").includes(ADVISOR_MARK)) return response;
    const raw = await response.text();
    let frame = null;
    try {
      frame = JSON.parse(raw.replace(/^data:\s*/, "").trim());
    } catch {
      frame = null;
    }
    const text = frame?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") {
      return new Response(raw, { status: response.status, headers: { "content-type": "text/event-stream" } });
    }
    const pieces = splitForStream(text, 9);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (let index = 0; index < pieces.length; index += 1) {
          await sleep(380);
          const last = index === pieces.length - 1;
          const candidate = { content: { role: "model", parts: [{ text: pieces[index] }] }, ...(last ? { finishReason: "STOP" } : {}) };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ candidates: [candidate] })}\n\n`));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
};

const splitAtBlockquotes = (text) => {
  const segments = [];
  let prose = [];
  let quote = null;
  let quoteIndex = 0;
  const flushProse = () => {
    if (prose.length === 0) return;
    const content = prose.join("\n");
    if (content.trim()) segments.push({ type: "text", content });
    prose = [];
  };
  const flushQuote = () => {
    if (quote === null) return;
    if (quote.join("\n").replace(/^>\s?/gm, "").trim()) {
      flushProse();
      segments.push({ type: "quote", content: quote.join("\n"), quoteIndex });
      quoteIndex += 1;
    } else {
      prose.push(...quote);
    }
    quote = null;
  };
  for (const line of String(text ?? "").split("\n")) {
    if (/^>/.test(line)) {
      quote = quote ?? [];
      quote.push(line);
      continue;
    }
    flushQuote();
    prose.push(line);
  }
  flushQuote();
  flushProse();
  return segments;
};

const institutionDraftButtonLabel = (draft = {}) => {
  if (draft.type === "table-proposal") return `Table proposal in ${draft.institutionId}`;
  if (draft.type === "submit-proposal") return `Open formal vote in ${draft.institutionId}`;
  if (draft.type === "vote") return `Vote ${String(draft.choice || "").toUpperCase()} in ${draft.institutionId}`;
  if (draft.type === "invite") return `Invite ${draft.polity} to ${draft.institutionId}`;
  return "Institution action";
};

const institutionDraftDetail = (draft) => (draft.type === "table-proposal"
  ? draft.title
  : draft.type === "vote"
    ? `${draft.proposalId} · ${String(draft.choice || "").toUpperCase()}`
    : draft.type === "submit-proposal"
      ? draft.proposalId
      : `${draft.polity} · ${draft.requestedStatus}`);

const formatReportFields = (fields = []) => {
  const lines = [];
  for (const [label, value] of fields) {
    if (value === "" || value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${label}:`);
      for (const entry of value) lines.push(`  ${String(entry)}`);
      continue;
    }
    const text = String(value);
    lines.push(text.includes("\n") ? `${label}:\n${text}` : `${label}: ${text}`);
  }
  return lines;
};

const errorReportFields = (message, diagnostics) => [
  ["Message", message],
  ...(diagnostics && typeof diagnostics === "object" ? Object.entries(diagnostics) : []),
];

const campaignChanged = (startedIn, current) => {
  const from = String(startedIn ?? "").trim();
  const to = String(current ?? "").trim();
  return Boolean(from) && Boolean(to) && from !== to;
};

const noticeHow = (notice) => (notice.channel === "intelligence"
  ? `a copy our agents took${notice.from ? ` in ${notice.from}` : ""}; they do not know we have it`
  : notice.channel === "diplomacy"
    ? `from ${notice.from || "abroad"}, filed in our correspondence with them`
    : "for our government's eyes alone");

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);

const HTML_REPLACEMENTS = [
  [/<br\s*\/?>/gi, "\n"],
  [/<hr\s*\/?>/gi, "\n\n---\n\n"],
  [/<\/?(?:p|div|section)(?:\s[^>]*)?>/gi, "\n\n"],
  [/<li(?:\s[^>]*)?>/gi, "\n- "],
  [/<\/li>/gi, ""],
  [/<\/?(?:ul|ol)(?:\s[^>]*)?>/gi, "\n\n"],
  [/<\/?(?:b|strong)(?:\s[^>]*)?>/gi, "**"],
  [/<\/?(?:i|em)(?:\s[^>]*)?>/gi, "*"],
  [/<\/?(?:code|tt|kbd)(?:\s[^>]*)?>/gi, "`"],
  [/<\/?(?:u|span|small|sup|sub|font)(?:\s[^>]*)?>/gi, ""],
];

const NAMED_ENTITIES = {
  nbsp: " ", amp: "&", quot: '"', apos: "'",
  lt: "<", gt: ">",
  ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  bull: "•", middot: "·", deg: "°", times: "×",
  pound: "£", euro: "€", trade: "™", copy: "©",
  laquo: "«", raquo: "»", rarr: "→", larr: "←",
};

const decodeEntities = (text) => text
  .replace(/&([a-zA-Z]+);/g, (whole, name) => {
    const decoded = NAMED_ENTITIES[name.toLowerCase()];
    return decoded === undefined ? whole : decoded;
  })
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, code) => {
    const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
    if (!Number.isFinite(point) || point < 32) return whole;
    if (point === 38 || point === 60 || point === 62) return whole;
    return String.fromCodePoint(point);
  });

const isDelimiterRow = (line) => /^\s{0,3}\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-") && line.includes("|");

const isTableRow = (line) => line.includes("|") && line.trim() !== "";

const isBlank = (line) => line.trim() === "";

const opensFence = (line) => /^\s{0,3}(?:`{3,}|~{3,})/.test(line);

const spaceOutTables = (lines) => {
  const out = [];
  let inTable = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1];
    const startsTable = !inTable && isTableRow(line) && next !== undefined && isDelimiterRow(next);
    if (startsTable) {
      const previous = out[out.length - 1];
      if (previous !== undefined && !isBlank(previous)) out.push("");
      inTable = true;
    } else if (inTable && (isBlank(line) || !isTableRow(line))) {
      inTable = false;
    }
    out.push(line);
    if (inTable && next !== undefined && !isBlank(next) && !isTableRow(next)) {
      out.push("");
      inTable = false;
    }
  }
  return out;
};

const splitCells = (line) => {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  for (let index = 0; index < inner.length; index += 1) {
    if (inner[index] === "\\" && inner[index + 1] === "|") {
      current += "\\|";
      index += 1;
      continue;
    }
    if (inner[index] === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += inner[index];
  }
  cells.push(current.trim());
  return cells;
};

const buildRow = (cells) => `| ${cells.join(" | ")} |`;

const buildDelimiter = (cells) => buildRow(cells.map((cell) => {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return ":---:";
  if (right) return "---:";
  if (left) return ":---";
  return "---";
}));

const repairTableColumns = (lines) => {
  const out = [];
  let index = 0;
  while (index < lines.length) {
    const next = lines[index + 1];
    if (!(isTableRow(lines[index]) && next !== undefined && isDelimiterRow(next))) {
      out.push(lines[index]);
      index += 1;
      continue;
    }
    const header = splitCells(lines[index]);
    const delimiter = splitCells(next);
    const bodyStart = index + 2;
    let bodyEnd = bodyStart;
    while (bodyEnd < lines.length && isTableRow(lines[bodyEnd]) && !isDelimiterRow(lines[bodyEnd])) bodyEnd += 1;
    const body = lines.slice(bodyStart, bodyEnd).map(splitCells);
    const width = Math.max(header.length, ...body.map((row) => row.length));
    const pad = (row) => (row.length >= width ? row.slice(0, width) : [...row, ...Array(width - row.length).fill("")]);
    const paddedHeader = pad(header);
    const paddedBody = body.map(pad);
    const keep = paddedBody.length === 0
      ? paddedHeader.map((cell, column) => column)
      : paddedHeader
        .map((cell, column) => column)
        .filter((column) => paddedBody.some((row) => row[column] !== ""));
    const kept = keep.length > 0 ? keep : paddedHeader.map((cell, column) => column);
    const widened = width > header.length;
    const pruned = kept.length < width;
    if (!widened && !pruned) {
      for (let line = index; line < bodyEnd; line += 1) out.push(lines[line]);
    } else {
      const pick = (row) => kept.map((column) => row[column] ?? "");
      out.push(buildRow(pick(paddedHeader)));
      out.push(buildDelimiter(pick(pad(delimiter))));
      for (const row of paddedBody) out.push(buildRow(pick(row)));
    }
    index = bodyEnd;
  }
  return out;
};

const spaceOutHeadings = (line) => line.replace(/^(\s{0,3})(#{1,6})([^#\s])/, "$1$2 $3");

const normalizeSegment = (segment) => {
  const spans = [];
  const held = segment.replace(/`+[^`\n]*`+/g, (span) => {
    spans.push(span);
    return `\u0000${spans.length - 1}\u0000`;
  });
  let text = held;
  for (const [pattern, replacement] of HTML_REPLACEMENTS) text = text.replace(pattern, replacement);
  text = decodeEntities(text);
  text = text.replace(/\n{3,}/g, "\n\n");
  const lines = repairTableColumns(spaceOutTables(text.split("\n").map(spaceOutHeadings)));
  return lines.join("\n").replace(/\u0000(\d+)\u0000/g, (whole, index) => spans[Number(index)] ?? whole);
};

const normalizeMarkdown = (value) => {
  const source = String(value ?? "");
  if (!source) return "";
  const out = [];
  let buffer = [];
  let inFence = false;
  const flush = () => {
    if (buffer.length > 0) out.push(normalizeSegment(buffer.join("\n")));
    buffer = [];
  };
  for (const line of source.split("\n")) {
    if (opensFence(line)) {
      if (inFence) {
        out.push(`${buffer.join("\n")}\n${line}`);
        buffer = [];
      } else {
        flush();
        buffer.push(line);
      }
      inFence = !inFence;
      continue;
    }
    buffer.push(line);
  }
  if (inFence) out.push(buffer.join("\n"));
  else flush();
  return out.join("\n");
};

export const register = (ctx) => {
  const { engine, emit, plain, storage, clean, list } = ctx;
  const gameState = engine.gameState;
  const urls = engine.JSON_URLS;
  const dates = engine.gameDates;
  const threads = engine.advisorThreads;
  const CHIEF = threads.CHIEF_ADVISOR_THREAD;
  let loadFailed = false;
  let storedNotices = [];
  let lastNoticeViews = "";

  if (ctx.standIn) {
    ctx.addStandIn(({ tool, text, body }) => {
      if (!tool && String(text).includes(CHARACTER_MARK)) {
        const leaked = PRIVATE_MARKS.filter((mark) => String(text).includes(mark));
        return { text: leaked.length ? `LEAKED ${leaked.join(" ")}\n${STAND_IN_CHARACTER_REPLY}` : STAND_IN_CHARACTER_REPLY };
      }
      if (tool || !String(text).includes(ADVISOR_MARK)) return null;
      const asked = lastUserText(body).toLowerCase();
      if (asked.includes(FAIL_MARK)) return null;
      const named = /Your name is (.+?), and your position is/.exec(String(text));
      const reply = asked.includes("institution") ? STAND_IN_INSTITUTION_REPLY : STAND_IN_REPLY;
      return { text: named ? `I am ${named[1]}.\n\n${reply}` : reply };
    });
    installStreamingStandIn();
  }

  const formatAdvisorDate = (value) => {
    if (!value) return "";
    return dates.formatGameDateReadable(value, "MMM D, YYYY") || String(value);
  };

  const readWorld = () => engine.readJson(urls.world, { defaultValue: {}, clone: false }).catch(() => ({}));

  const flags = () => {
    const stored = storage.getItem("oh_debug_log_enabled");
    const ui = String(storage.getItem("ui_language") ?? "").trim() || "en";
    const chat = String(storage.getItem("ai_chat_language") ?? "").trim() || ui;
    return {
      loggingOn: stored === null || stored === undefined ? true : stored === "1",
      chatDir: chat === ui ? "" : (RTL_LANGUAGES.has(chat) ? "rtl" : "ltr"),
    };
  };

  let lastAllowed = null;

  const allowedTypesOf = (world) => {
    const joined = Array.isArray(world?.allowedUnitTypes) ? world.allowedUnitTypes.join(",") : "";
    return joined ? joined.split(",") : null;
  };

  const noticeView = (notice, world, unseen) => {
    if (unseen.has(String(notice?.eventId ?? ""))) return { hidden: true };
    const reports = Array.isArray(world?.reports) ? world.reports : [];
    const report = reports.find((entry) => String(entry?.id) === String(notice?.reportId));
    if (!report) return { hidden: true };
    return {
      hidden: false,
      title: String(report.title ?? ""),
      how: noticeHow(notice),
      body: `${report.dateline ? `${report.dateline}\n\n` : ""}${report.body ?? ""}`,
      date: formatAdvisorDate(notice.time),
    };
  };

  const unseenOf = (world) => {
    try {
      return engine.unseenEvents.unseenEvents.unseenInTurn(engine.unseenEvents.latestTurnEventIds(world));
    } catch {
      return new Set();
    }
  };

  const sentNote = (draft, chats) => {
    if (!Array.isArray(chats)) return "";
    const sentOn = engine.advisorDrafts.sentLetterDate(draft, chats);
    if (!sentOn) return "";
    const country = String(draft?.country ?? "");
    return sentOn === "earlier"
      ? `Already sent to ${country}.`
      : `Already sent to ${country} on ${dates.formatGameDateReadable(sentOn) || sentOn}.`;
  };

  const readChats = async () => {
    try {
      return await gameState.readChatsState({ force: true });
    } catch {
      return null;
    }
  };

  const readActions = async () => {
    try {
      return list(await gameState.readActionsState());
    } catch {
      return [];
    }
  };

  const proposalTargetsOf = (message, actions) => {
    const targets = {};
    for (const proposal of list(message?.actionProposals)) {
      const id = String(proposal?.targetId ?? "");
      if (!id) continue;
      const action = list(actions).find((entry) => String(entry?.id) === id);
      const title = String(action?.title || action?.text || "").trim();
      if (title) targets[String(proposal.id)] = title;
    }
    return targets;
  };

  const viewOf = (message, world, unseen = null, chats = null, actions = null) => {
    const role = message?.role;
    if (role === "notice") return noticeView(message, world, unseen ?? unseenOf(world));
    if (role === "advisor") {
      const parsed = engine.advisorReply.parseAdvisorReply(message.text, { allowedUnitTypes: allowedTypesOf(world), streaming: Boolean(message.streaming) });
      const drafts = parsed.messageDrafts ? parsed.messageDrafts.map((draft) => ({ ...draft, sentNote: sentNote(draft, chats) })) : null;
      return {
        proposalTargets: proposalTargetsOf(message, actions),
        text: parsed.text,
        md: normalizeMarkdown(parsed.text),
        chartConfig: parsed.chartConfig,
        chartProblem: parsed.chartProblem,
        messageDrafts: drafts,
        segments: drafts && drafts.length
          ? splitAtBlockquotes(parsed.text).map((segment) => ({ ...segment, md: normalizeMarkdown(segment.content) }))
          : null,
        institutionDrafts: parsed.institutionDrafts
          ? parsed.institutionDrafts.map((draft) => ({ ...draft, label: institutionDraftButtonLabel(draft), detail: institutionDraftDetail(draft) }))
          : null,
        deployments: parsed.deployments,
        date: formatAdvisorDate(message.time),
      };
    }
    if (role === "error") {
      const fields = errorReportFields(message.text, message.diagnostics);
      return {
        text: String(message.text ?? ""),
        md: normalizeMarkdown(String(message.text ?? "")),
        details: formatReportFields(fields).join("\n"),
        reportFields: fields,
        hasDetail: Boolean(message.diagnostics && Object.keys(message.diagnostics).length > 0),
        date: formatAdvisorDate(message.time),
      };
    }
    return { text: String(message?.text ?? "") };
  };

  const viewsOf = async (messages) => {
    const [world, chats, actions] = await Promise.all([readWorld(), readChats(), readActions()]);
    const unseen = unseenOf(world);
    return list(messages).map((message) => viewOf(message, world, unseen, chats, actions));
  };

  const loadMessages = async () => {
    try {
      const saved = await gameState.readAdvisorMessages();
      loadFailed = false;
      return saved;
    } catch (error) {
      loadFailed = true;
      console.warn("[advisor] The advisor conversation could not be loaded; nothing is saved until it is.", error?.message ?? error);
      return null;
    }
  };

  const saveMessages = async (messages, threadId = CHIEF, options = {}) => {
    if (loadFailed) return { saved: false, blocked: true };
    try {
      await gameState.mutateAdvisorState((stored) => threads.replaceAdvisorThread(stored, threadId, messages, options));
      return { saved: true, blocked: false };
    } catch (error) {
      console.error("Failed to save advisor conversation:", error?.message ?? error);
      return { saved: false, blocked: false };
    }
  };

  const readPolity = async () => {
    const game = await engine.readJson(urls.game, { defaultValue: {}, force: false }).catch(() => ({}));
    return String(game?.country || "");
  };

  const contactsOf = async (saved, worldIn = null) => {
    const world = worldIn ?? await readWorld();
    const polity = await readPolity();
    const government = engine.polActors.getPoliticalProfile(world || {}, polity)?.government ?? null;
    const political = government ? { politicalActors: { byPolity: { [polity]: { polityKey: polity, government } } } } : {};
    const labels = threads.ADVISOR_RECIPIENT_TYPE_LABELS;
    const chief = threads.chiefAdvisorProfile(saved);
    return {
      contacts: threads.advisorContacts(saved).map((contact) => {
        const recipientType = threads.advisorRecipientType(contact) || "";
        return {
          id: contact.id,
          name: String(contact.name ?? ""),
          title: String(contact.title ?? ""),
          personality: String(contact.personality ?? ""),
          recipientType,
          typeLabel: recipientType ? String(labels[recipientType] ?? "") : "",
          archived: Boolean(contact.archived),
          binding: contact.binding ?? null,
          status: threads.advisorOfficeStatus(contact, political),
        };
      }),
      offices: threads.politicalAdvisorOffices(political, polity),
      chief: chief ? { name: chief.name, title: chief.title, personality: chief.personality } : null,
      types: Object.entries(labels).map(([value, label]) => ({ value, label })),
      minister: threads.ADVISOR_RECIPIENT_TYPES.MINISTER,
    };
  };

  let lastContacts = "";
  const pushContacts = async (saved = null) => {
    let stored = saved;
    if (stored === null) {
      try {
        stored = await gameState.readAdvisorMessages();
      } catch {
        return;
      }
    }
    const view = await contactsOf(stored);
    const payload = JSON.stringify(view);
    if (payload === lastContacts) return;
    lastContacts = payload;
    emit("advisor.contacts", plain(view));
  };

  const threadOf = (threadId) => String(threadId || CHIEF);

  const contactMutation = async (change) => {
    await gameState.mutateAdvisorState(change);
    const saved = await gameState.readAdvisorMessages({ force: true });
    const view = await contactsOf(saved);
    lastContacts = JSON.stringify(view);
    return view;
  };

  const readSeenMoment = async (gameDate) => {
    try {
      const [events, world] = await Promise.all([
        engine.readJson(urls.events, { defaultValue: [] }),
        engine.readJson(urls.world, { defaultValue: {}, clone: false }),
      ]);
      const seen = await gameState.viewAsSeen({ world, events, game: { gameDate } });
      return { events: seen.events, world, date: seen.game?.gameDate || gameDate || "" };
    } catch {
      return { events: [], world: {}, date: gameDate || "" };
    }
  };

  const buildAdvisorCatchUp = async (messages, moment, { publicOnly = false } = {}) => {
    const previous = [...list(messages)].reverse()
      .find((msg) => (msg.role === "user" || msg.role === "advisor") && !msg.streaming);
    if (!previous) return { text: "", label: "" };
    try {
      const { events, world, date } = moment;
      return engine.conversationCatchUp.buildCatchUpNote({
        previousDate: previous.time || "",
        currentDate: date || "",
        events: publicOnly ? engine.characterConversations.publicCharacterEvents(events, { gameDate: date }) : events,
        gmChanges: publicOnly ? [] : previous.at ? engine.gmChanges.gmChangesSince(world, previous.at) : [],
        replyProblems: !publicOnly && previous.role === "advisor" ? engine.advisorBlocks.describeReplyProblems(previous) : [],
        compareDates: dates.compareGameDates,
        formatDate: (value) => dates.formatGameDateReadable(value),
      });
    } catch (error) {
      console.warn("[advisor] could not work out what changed since the last exchange:", error?.message ?? error);
      return { text: "", label: "" };
    }
  };

  const newReplyId = () => `advisor-reply-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`}`;

  const fromWire = (json, fallback) => {
    if (typeof json !== "string" || !json) return fallback;
    return JSON.parse(json);
  };

  const noticesOf = (messages) => list(messages).filter((message) => message?.role === "notice");

  const pushNotices = async () => {
    const world = await readWorld();
    const unseen = unseenOf(world);
    const views = storedNotices.map((notice) => viewOf(notice, world, unseen));
    const payload = JSON.stringify([storedNotices, views]);
    if (payload === lastNoticeViews) return;
    lastNoticeViews = payload;
    emit("advisor.notices", plain({ notices: storedNotices, views }));
  };

  let noticeTimer = null;
  const scheduleNotices = () => {
    if (noticeTimer) return;
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      pushNotices().catch(() => {});
    }, 300);
  };

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("oh:runtime-json-updated", (event) => {
      if (event?.detail?.url !== urls.advisor) return;
      storedNotices = noticesOf(event.detail.value);
      scheduleNotices();
      if (lastContacts) pushContacts(list(event.detail.value)).catch(() => {});
    });
    globalThis.addEventListener("oh:world-updated", (event) => {
      if (storedNotices.length) scheduleNotices();
      if (lastContacts) pushContacts().catch(() => {});
      const world = event?.detail?.world;
      if (!world || lastAllowed === null) return;
      const allowed = Array.isArray(world.allowedUnitTypes) ? world.allowedUnitTypes.join(",") : "";
      if (allowed === lastAllowed) return;
      lastAllowed = allowed;
      emit("advisor.allowed", {});
    });
    globalThis.addEventListener("oh:unseen-events-changed", () => {
      if (storedNotices.length) scheduleNotices();
    });
  }

  return {
    "advisor.load": async ({ restore = true, threadId = CHIEF } = {}) => {
      const thread = threadOf(threadId);
      const saved = await loadMessages();
      const messages = saved === null ? [] : threads.advisorMessagesFor(saved, thread);
      if (restore) {
        if (saved !== null) engine.aiMain.loadHistory(messages, thread);
        else engine.aiMain.startChat(thread);
      }
      storedNotices = noticesOf(saved ?? []);
      lastNoticeViews = "";
      const world = await readWorld();
      lastAllowed = Array.isArray(world?.allowedUnitTypes) ? world.allowedUnitTypes.join(",") : "";
      const people = await contactsOf(saved ?? [], world);
      lastContacts = JSON.stringify(people);
      return plain({
        failed: saved === null,
        messages,
        views: await viewsOf(messages),
        ...people,
        ...flags(),
      });
    },
    "advisor.select": async ({ threadId = CHIEF } = {}) => {
      const thread = threadOf(threadId);
      const saved = await gameState.readAdvisorMessages({ force: true });
      if (thread !== CHIEF && !threads.advisorContacts(saved).some((contact) => contact.id === thread)) {
        throw new Error("The selected Advisor recipient no longer exists.");
      }
      const messages = threads.advisorMessagesFor(saved, thread);
      engine.aiMain.loadHistory(messages, thread);
      const people = await contactsOf(saved);
      lastContacts = JSON.stringify(people);
      return plain({ messages, views: await viewsOf(messages), ...people });
    },
    "advisor.contacts": async () => {
      const saved = await gameState.readAdvisorMessages();
      const people = await contactsOf(saved);
      lastContacts = JSON.stringify(people);
      return plain(people);
    },
    "advisor.contact.create": async ({ draft = {} } = {}) => {
      const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "")
        || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 15)}`;
      const id = `advisor-${random}`;
      const people = await contactMutation((all) => threads.createAdvisorContact(all, { ...draft, id }));
      return plain({ id, ...people });
    },
    "advisor.contact.revise": async ({ id = "", draft = {} } = {}) => plain(await contactMutation((all) => threads.reviseAdvisorContact(all, String(id), draft))),
    "advisor.contact.archive": async ({ id = "", archived = true } = {}) => plain(await contactMutation((all) => threads.archiveAdvisorContact(all, String(id), Boolean(archived)))),
    "advisor.chief.save": async ({ draft = {} } = {}) => plain(await contactMutation((all) => threads.saveChiefAdvisorProfile(all, draft))),
    "advisor.chief.reset": async () => plain(await contactMutation((all) => threads.resetChiefAdvisorProfile(all))),
    "advisor.proceed": async ({ threadId = CHIEF, messageId = "", proposalId = "" } = {}) => {
      const thread = threadOf(threadId);
      const campaignId = clean(engine.getLibraryState()?.activeGameId);
      try {
        engine.simulationStatus.assertNoTurnRunning();
        const { round } = await engine.readJson(urls.game, { defaultValue: { round: 0 }, force: true });
        if (campaignChanged(campaignId, engine.getLibraryState()?.activeGameId)) {
          throw new Error("The campaign changed before the Action could be queued.");
        }
        const receipt = await engine.advisorActionApproval.approveAdvisorAction({
          threadId: thread,
          messageId: String(messageId),
          proposalId: String(proposalId),
          readAdvisorMessages: gameState.readAdvisorMessages,
          mutateActionsState: gameState.mutateActionsState,
          mutateAdvisorState: gameState.mutateAdvisorState,
          normalizeAction: gameState.normalizeActionEntry,
          repeatOf: (queue, title) => engine.playerFocus.repeatedOrder(queue, title, { round: Number(round) || 0 }),
          sharedGame: engine.mpBridge.inSharedGame(),
          assertReady: engine.simulationStatus.assertNoTurnRunning,
        });
        if (campaignChanged(campaignId, engine.getLibraryState()?.activeGameId)) {
          throw new Error("The campaign changed while the Action was being reviewed. Reopen the correct game.");
        }
        const saved = await gameState.readAdvisorMessages({ force: true });
        const stored = threads.advisorMessagesFor(saved, thread).find((entry) => entry?.role === "advisor" && entry.id === String(messageId));
        return plain({ ok: true, receipt, receipts: stored?.actionReceipts ?? { [String(proposalId)]: receipt } });
      } catch (error) {
        console.warn("[advisor] the Action proposal was not fully confirmed:", error?.message ?? error);
        return { ok: false, error: `${error?.message || String(error)} If a write succeeded before an error, retrying uses the same Action ID.` };
      }
    },
    "advisor.history": async ({ messages = [], json = "", threadId = CHIEF } = {}) => {
      messages = fromWire(json, messages);
      engine.aiMain.loadHistory(list(messages), threadOf(threadId));
      return true;
    },
    "advisor.views": async ({ messages = [], json = "" } = {}) => plain({ views: await viewsOf(fromWire(json, messages)) }),
    "advisor.notices": async () => {
      let stored = [];
      try {
        stored = await gameState.readAdvisorMessages();
      } catch {
        stored = null;
      }
      if (stored === null) return plain({ notices: storedNotices, views: await viewsOf(storedNotices), ...flags() });
      storedNotices = noticesOf(stored);
      const views = await viewsOf(storedNotices);
      lastNoticeViews = JSON.stringify([storedNotices, views]);
      return plain({ notices: storedNotices, views, ...flags() });
    },
    "advisor.save": async ({ messages = [], json = "", threadId = CHIEF, clearNotices = false } = {}) => saveMessages(list(fromWire(json, messages)), threadOf(threadId), { clearNotices: Boolean(clearNotices) }),
    "advisor.report": async ({ kind = "", title = "", fields = [] } = {}) => {
      const debugLog = engine.debugLog;
      const incident = { kind: String(kind), title: String(title), fields: list(fields).filter(Array.isArray) };
      const loggingOn = Boolean(debugLog?.isDebugLogEnabled?.());
      if (loggingOn) {
        let report = "";
        try {
          report = await debugLog.buildLoggingFile({ incident });
        } catch {
          return { loggingOn, state: "failed" };
        }
        try {
          const folder = process.env.OH_NATIVE_DOWNLOADS || path.join(os.homedir(), "Downloads", "Open Historia");
          fs.mkdirSync(folder, { recursive: true });
          const file = path.join(folder, debugLog.debugLogFilename(incident.kind));
          fs.writeFileSync(file, report);
          return { loggingOn, state: "saved", path: file };
        } catch {
          return { loggingOn, state: report ? "copied" : "failed", text: report || "" };
        }
      }
      const text = debugLog?.buildIncidentReport?.(incident) ?? "";
      return { loggingOn, state: text ? "copied" : "failed", text };
    },
    "advisor.clear": async ({ threadId = CHIEF } = {}) => {
      const thread = threadOf(threadId);
      engine.aiMain.startChat(thread);
      return saveMessages([], thread, { clearNotices: true });
    },
    "advisor.width": async ({ width } = {}) => {
      const value = Math.round(Number(width) || 0);
      if (value > 0) {
        storage.setItem("oh-advisor-width", String(value));
        storage.flush?.();
      }
      const saved = Number(storage.getItem("oh-advisor-width"));
      return Number.isFinite(saved) && saved > 0 ? saved : 0;
    },
    "advisor.ask": async ({ text = "", messages = [], json = "", retry = false, token = "", threadId = CHIEF } = {}) => {
      messages = fromWire(json, messages);
      const thread = threadOf(threadId);
      let recipient = null;
      if (thread !== CHIEF) {
        const saved = await gameState.readAdvisorMessages().catch(() => []);
        recipient = threads.advisorContacts(saved).find((contact) => contact.id === thread && !contact.archived) || null;
        if (!recipient) return plain({ unavailable: true, problem: "This recipient is unavailable." });
      }
      const question = String(text ?? "");
      const transcript = list(messages);
      const library = engine.getLibraryState();
      const campaignId = clean(library?.activeGameId);
      const leftCampaign = () => campaignChanged(campaignId, engine.getLibraryState()?.activeGameId);
      const { gameDate, round: gameRound } = await engine.readJson(urls.game, {
        defaultValue: { gameDate: null, round: 0 },
        force: true,
      }).catch(() => ({ gameDate: null, round: 0 }));
      const askedBefore = retry ? [...transcript].reverse().find((msg) => msg.role === "user") : null;
      const moment = await readSeenMoment(gameDate);
      const askedOn = moment.date || gameDate;
      const catchUp = retry
        ? { text: askedBefore?.catchUp || "", label: askedBefore?.catchUpLabel || "" }
        : await buildAdvisorCatchUp(transcript, moment, {
          publicOnly: Boolean(recipient && threads.advisorRecipientType(recipient) !== threads.ADVISOR_RECIPIENT_TYPES.MINISTER),
        });
      const asked = retry ? null : {
        role: "user",
        text: question,
        time: askedOn,
        at: new Date().toISOString(),
        ...(catchUp.text ? { catchUp: catchUp.text, catchUpLabel: catchUp.label } : {}),
      };
      emit("advisor.asked", plain({ token, message: asked, view: asked ? viewOf(asked, moment.world) : null }));

      let pending = null;
      let timer = null;
      const flushChunk = () => {
        timer = null;
        if (pending === null) return;
        const full = pending;
        pending = null;
        const streaming = { role: "advisor", text: engine.advisorMemory.stripAdvisorMemory(full), time: askedOn, streaming: true };
        emit("advisor.chunk", plain({ token, message: streaming, view: viewOf(streaming, moment.world) }));
      };
      const onChunk = (_delta, full) => {
        pending = full;
        if (!timer) timer = setTimeout(flushChunk, 60);
      };
      const stopChunks = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        pending = null;
      };

      try {
        const raw = await engine.aiMain.sendMessage(question, { threadId: thread, recipient, onChunk, catchUp: catchUp.text });
        stopChunks();
        if (leftCampaign()) {
          console.warn("[advisor] Advisor reply dropped: the campaign was switched while it was being written, so none of its orders or projects were applied.");
          return { dropped: true };
        }
        const { reply, memory } = engine.advisorMemory.splitAdvisorMemory(raw);
        const blocks = engine.advisorBlocks;
        const replyId = newReplyId();
        const { json: actionsProposal, reason: actionsReason } = blocks.extractFencedJson(reply, "actions");
        const minister = thread === CHIEF || threads.advisorRecipientType(recipient) === threads.ADVISOR_RECIPIENT_TYPES.MINISTER;
        const { proposals: actionProposals, problems: invalidProposals } = minister
          ? engine.advisorActionReview.actionProposalsFromReply(actionsProposal, replyId)
          : { proposals: [], problems: [] };
        const actionsProblems = [
          ...(actionsReason ? [`the Action block was ${actionsReason}; no Action was queued`] : []),
          ...invalidProposals,
        ];
        const { chartProblem, draftProblems, institutionDraftProblems, deployProblems } = engine.advisorReply.parseAdvisorReply(reply, {
          allowedUnitTypes: Array.isArray(moment.world?.allowedUnitTypes) ? moment.world.allowedUnitTypes : null,
        });
        const { json: projectsProposal, truncated: projectsTruncated, reason: projectsReason,
          dropped: projectsDropped, excerpt: projectsExcerpt } = blocks.extractFencedJson(reply, "projects", { salvageTruncated: true });
        const canApplyProjects = engine.advisorProjectRouting.canAdvisorApplyProjectOps(thread, recipient);
        const projectsSummary = canApplyProjects
          ? await engine.advisorProjectRouting.applyAdvisorProjectProposal({
            proposal: projectsProposal,
            gameDate,
            round: gameRound,
            mutateWorldState: gameState.mutateWorldState,
            applyProjectOpsToWorld: gameState.applyProjectOpsToWorld,
          }).catch((error) => {
            console.error("Failed to apply advisor-proposed projects:", error?.message ?? error);
            return null;
          }) : null;
        const projectsProblem = !canApplyProjects ? ""
          : projectsSummary
            ? (projectsTruncated ? "truncated" : (projectsDropped > 0 ? "partial" : ""))
            : (blocks.looksLikeProjectOps(reply) ? (projectsTruncated ? "truncated-empty" : "unusable") : "");
        const projectsDetail = projectsProblem === "partial"
          ? `${projectsDropped} entr${projectsDropped === 1 ? "y was" : "ies were"} malformed and skipped.`
          : projectsProblem === "unusable"
            ? (projectsReason || "every entry referred to a project that is not on the board")
            : "";
        const projectsExcerptText = (projectsProblem === "unusable" || projectsProblem === "partial") ? projectsExcerpt : "";
        const actionSuggestionsBlocked = !minister && Boolean(actionsProposal);
        const projectsNotApplied = !canApplyProjects && Boolean(projectsProposal);
        const unapproved = actionSuggestionsBlocked || projectsNotApplied;
        const finalMessage = {
          id: replyId,
          role: "advisor",
          text: reply,
          time: askedOn,
          ...(unapproved ? { suggestionsNotApplied: true } : {}),
          at: new Date().toISOString(),
          ...(memory ? { memory } : {}),
          ...(chartProblem ? { chartProblem } : {}),
          ...(actionsProblems.length ? { actionsProblems } : {}),
          ...(actionProposals.length ? { actionProposals } : {}),
          ...(draftProblems.length ? { draftProblems } : {}),
          ...(institutionDraftProblems.length ? { institutionDraftProblems } : {}),
          ...(deployProblems.length ? { deployProblems } : {}),
          ...(projectsSummary ? { projectsSummary } : {}),
          ...(projectsProblem ? { projectsProblem } : {}),
          ...(projectsDetail ? { projectsDetail } : {}),
          ...(projectsExcerptText ? { projectsExcerpt: projectsExcerptText } : {}),
        };
        const [world, chats, actions] = await Promise.all([readWorld(), readChats(), readActions()]);
        return plain({ message: finalMessage, view: viewOf(finalMessage, world, null, chats, actions) });
      } catch (error) {
        stopChunks();
        if (leftCampaign()) return { dropped: true };
        const failed = {
          role: "error",
          text: error?.message ?? String(error),
          time: askedOn,
          ...(error?.diagnostics ? { diagnostics: error.diagnostics } : {}),
        };
        return plain({ error: failed, view: viewOf(failed, {}) });
      }
    },
    "advisor.deploy": async ({ deployment = {} } = {}) => {
      try {
        const placed = await engine.unitsController.deployUnit({
          type: String(deployment.type).toLowerCase(),
          strength: Math.max(1, Math.min(100, Number(deployment.strength) || 100)),
          name: String(deployment.name).trim(),
          composition: String(deployment.composition ?? "").trim(),
          lng: Number(deployment.lng),
          lat: Number(deployment.lat),
        });
        if (placed === null) {
          if (engine.simulationStatus.isSimulationBusy()) return { ok: false, error: engine.simulationStatus.TURN_RUNNING_NOTE };
          throw new Error("This scenario does not allow that troop type, so the unit was not placed.");
        }
        if (!placed?.ok) return { ok: false, error: placed?.error ?? "" };
        return { ok: true };
      } catch (error) {
        console.warn("[advisor] could not place the recommended deployment:", error?.message ?? error);
        return { ok: false, error: error?.message || String(error) };
      }
    },
    "advisor.institution": async ({ draft = {} } = {}) => {
      try {
        engine.simulationStatus.assertNoTurnRunning();
        const game = await engine.readJson(urls.game, { defaultValue: { gameDate: "", country: "" }, force: true });
        const playerCountry = String(game?.country || "").trim();
        const date = String(game?.gameDate || "").trim();
        const expectedGameId = String(engine.getLibraryState()?.activeGameId || "").trim();
        if (!playerCountry) throw new Error("No player polity is active.");
        const governance = engine.institutionalGovernance;
        if (draft.type === "table-proposal") {
          await governance.commitInstitutionalPlayerProposal({
            institutionId: draft.institutionId,
            playerCountry,
            date,
            expectedGameId,
            proposal: { type: draft.proposalType || "resolution", title: draft.title, summary: draft.summary || "" },
          });
        } else if (draft.type === "submit-proposal") {
          await engine.instGovernanceRetry.commitWithVotingRuleBackfill(() => governance.commitInstitutionalPlayerVoteRequest({
            institutionId: draft.institutionId,
            proposalId: draft.proposalId,
            playerCountry,
            date,
            expectedGameId,
          }), { institutionId: draft.institutionId, proposalId: draft.proposalId, expectedGameId });
        } else if (draft.type === "vote") {
          await governance.commitInstitutionGovernanceCommand({
            institutionId: draft.institutionId,
            playerCountry,
            date,
            expectedGameId,
            command: {
              type: "vote",
              proposalId: draft.proposalId,
              polity: playerCountry,
              choice: draft.choice,
              reason: draft.reason || "",
              authority: "player",
              finalizeWhenComplete: true,
              implementWhenPassed: true,
            },
          });
        } else if (draft.type === "invite") {
          await engine.institutionLifecycle.commitInstitutionLifecycleCommand({
            playerCountry,
            date,
            expectedGameId,
            command: {
              type: "invite",
              institutionId: draft.institutionId,
              initiatedBy: playerCountry,
              polity: draft.polity,
              requestedStatus: draft.requestedStatus || "member",
              reason: draft.reason || "",
              authority: "player",
            },
          });
        } else {
          throw new Error(`Unsupported Advisor institution draft ${draft.type || "<blank>"}.`);
        }
        return { ok: true };
      } catch (error) {
        console.warn("[advisor] could not execute the recommended institution action:", error?.message ?? error);
        return { ok: false, error: error?.message || String(error) };
      }
    },
  };
};
