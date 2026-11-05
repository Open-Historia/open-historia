/*! Open Historia — how a document reaches the player © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/reportDelivery.test.js
//
// A government does not keep its papers in a separate app. A letter from
// another head of state arrives through the ambassador; a rival's secret
// protocol arrives, if it arrives at all, through an agent; a published treaty
// is in the news. world.reports (runtime/reports.js) is the file — what the
// simulation and the leaders know — and this module decides, for each document
// that changed hands in a turn, how the PLAYER comes to read it:
//
//   diplomacy     the player holds it with other governments: it is filed in
//                 the thread with them, spoken by its sender (a letter from the
//                 Tsar lands in the chat with Russia);
//   intelligence  the player does not hold it, but has an agent in a
//                 government that does: the agent brings a copy, filed in the
//                 Spies tab among that agent's intercepts — sealed, and decoded
//                 only as far as the player's service can read the target's;
//   event         it was published, or the player's own government is its only
//                 holder (a cable to the ministry, an assessment from its own
//                 service): it is shown on the event that produced it.
//
// Anything else — a secret between two other powers with no agent of the
// player's among them — stays in the file, where the simulation and its holders
// know it and the player does not.
//
// Who may read a document is the one audience rule (AI/audience.js
// audienceSeesReport), asked here for the player's government. Its only import
// is that import-free module: gameplay.js plans and files, time.jsx shows the
// event's own, and all of it is tested under bare node.

import { audienceSeesReport, viewerAudience } from "../Game/AI/audience.js";

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();
const fold = (value) => asText(value).toLowerCase();
const has = (names, name) => asArray(names).some((entry) => fold(entry) === fold(name));

// Whether the player's government can read a report: it holds it, it was
// published, or its agents took a copy.
const readableBy = (report, player) => Boolean(report) && audienceSeesReport(viewerAudience([player]), report);

export const DELIVERY_CHANNELS = Object.freeze(["diplomacy", "intelligence", "event"]);

// The holder who handed `holder` their copy, if the share said (reports.js).
const giverOf = (report, holder) => {
  const entry = Object.entries(report?.receivedFrom && typeof report.receivedFrom === "object" ? report.receivedFrom : {})
    .find(([name]) => fold(name) === fold(holder));
  return entry ? asText(entry[1]) : "";
};

// Everything that changed hands between two versions of the file: a document
// created, or one whose holders grew.
const changesBetween = (before, after) => {
  const previous = new Map(asArray(before).map((report) => [asText(report?.id), report]));
  const changes = [];
  for (const report of asArray(after)) {
    const id = asText(report?.id);
    if (!id) continue;
    const prior = previous.get(id);
    if (!prior) {
      changes.push({ report, created: true, added: report.visibleTo === null ? [] : asArray(report.visibleTo) });
      continue;
    }
    const added = asArray(report.visibleTo).filter((name) => !has(prior.visibleTo, name));
    if (added.length) changes.push({ report, created: false, added });
  }
  return changes;
};

// [{ channel, report, created, ... }] for one turn. `agents` are the player's
// agents in place after the turn, as { target } (a turned one is its handlers'
// creature and brings nothing real). `created` says the turn wrote the document
// rather than passed on a copy of an older one — which event it arrived with.
export const planReportDeliveries = ({ before = [], after = [], player = "", agents = [] } = {}) => {
  const me = asText(player);
  if (!me) return [];
  const deliveries = [];
  for (const { report, created, added } of changesBetween(before, after)) {
    // Published: everyone reads it, with the event that published it.
    if (report.visibleTo === null) {
      if (created) deliveries.push({ channel: "event", report, created });
      continue;
    }
    // The player's government holds it now, and did not before.
    if (has(added, me) || (created && has(report.visibleTo, me))) {
      const others = asArray(report.visibleTo).filter((name) => fold(name) !== fold(me));
      if (!others.length) {
        deliveries.push({ channel: "event", report, created });
        continue;
      }
      // A copy passed on by one holder comes from that holder alone, in the
      // thread with them — not from every government that ever held it.
      const giver = created ? "" : giverOf(report, me);
      if (giver && others.some((name) => fold(name) === fold(giver))) {
        deliveries.push({ channel: "diplomacy", report, created, with: [giver], sender: giver });
        continue;
      }
      const sender = others.find((name) => fold(name) === fold(report.from)) ?? others[0];
      deliveries.push({ channel: "diplomacy", report, created, with: others, sender });
      continue;
    }
    // Not the player's: stolen, if an agent sits in a government that holds it.
    if (readableBy(report, me)) continue;
    const agent = asArray(agents).find((entry) => has(report.visibleTo, entry?.target));
    if (!agent) continue;
    const target = asArray(report.visibleTo).find((name) => fold(name) === fold(agent.target));
    const counterparts = asArray(report.visibleTo).filter((name) => fold(name) !== fold(target));
    // The agent's own spelling of where it sits is the key its file is kept under.
    deliveries.push({ channel: "intelligence", report, created, target, agentTarget: asText(agent.target), counterparts });
  }
  return deliveries;
};

// The event a delivery is shown with (runtime/unseenEvents.js): the one that
// wrote the document, or — for a copy passed on or taken from an older one —
// the turn's last, since the change is only known to have happened by its end.
export const deliveryEventId = (delivery, lastEventId = "") => (delivery?.created && asText(delivery.report?.sourceEventId)
  ? asText(delivery.report.sourceEventId)
  : asText(lastEventId));

const datelineOf = (report) => (asText(report.dateline) ? ` — ${asText(report.dateline)}` : "");

// The note a diplomatic document becomes: one message in the thread with the
// other holders, spoken by its sender, the document in full beneath its heading.
// `eventId` is the event it is shown with (deliveryEventId).
export const documentNote = (delivery, { eventId = "" } = {}) => {
  const { report } = delivery;
  return {
    countries: asArray(delivery.with),
    speaker: delivery.sender,
    title: report.title,
    source: "report",
    messages: [{
      role: "leader",
      speaker: delivery.sender,
      text: `📄 **${report.title}**${datelineOf(report)}\n\n${report.body}`,
      reportId: report.id,
      ...(asText(eventId) ? { eventId: asText(eventId) } : {}),
    }],
  };
};

// The id a stolen copy is filed under: the report's, so filing it twice files it
// once, and so the file can be checked against the reports it came from.
export const documentExchangeId = (reportId) => `doc-${asText(reportId)}`.toLowerCase().replace(/\s+/g, "-");

// The intercept a stolen document becomes, beside the agent's other traffic.
// `eventId` is the event it is shown with (deliveryEventId).
export const documentExchange = (delivery, { date = "", eventId = "" } = {}) => {
  const { report } = delivery;
  // Its sender when that is one of its holders; otherwise the government the
  // agent took it from.
  const speaker = report.from && has(report.visibleTo, report.from) ? report.from : delivery.target;
  return {
    id: documentExchangeId(report.id),
    counterpart: delivery.counterparts?.length ? delivery.counterparts.join(", ") : "internal document",
    date: asText(report.dateline) || asText(date),
    subject: report.title,
    messages: [{ speaker, text: report.body }],
    ...(asText(eventId) ? { eventId: asText(eventId) } : {}),
  };
};

export const isDocumentExchange = (exchange) => asText(exchange?.id).startsWith("doc-");

// The advisor's notice of a paper this turn put in the government's hands: one
// line in the advisor's conversation with the document a click away, the way
// the reference's advisor announces a new report. A published text is news, not
// a paper on the desk, and gets none. Not a turn of the conversation — the
// advisor already reads every paper — and shown with the event it came with.
export const documentNotices = (deliveries, { lastEventId = "", date = "" } = {}) => asArray(deliveries)
  .filter((delivery) => delivery?.report && delivery.report.visibleTo !== null)
  .map((delivery) => ({
    id: `notice-${documentExchangeId(delivery.report.id)}`,
    role: "notice",
    kind: "document",
    reportId: asText(delivery.report.id),
    channel: delivery.channel,
    ...(asText(delivery.channel === "intelligence" ? delivery.target : delivery.sender)
      ? { from: asText(delivery.channel === "intelligence" ? delivery.target : delivery.sender) }
      : {}),
    eventId: deliveryEventId(delivery, lastEventId),
    time: asText(date),
  }));

// The advisor's conversation after a turn is undone or cut short: a notice stays
// only while the paper it announced is still one the government can read.
// Returns the same list when nothing had to go.
export const withoutOrphanedNotices = (messages, reports, player) => {
  const list = asArray(messages);
  const byId = new Map(asArray(reports).map((report) => [asText(report?.id), report]));
  const kept = list.filter((message) => message?.role !== "notice"
    || readableBy(byId.get(asText(message.reportId)), player));
  return kept.length === list.length ? messages : kept;
};

// The agents' file after a turn is undone or cut short: a stolen copy stays only
// while the report it copies is still on file as stolen. An undone turn takes its
// reports back with it, and a copy of a document that never existed — or that no
// agent ever took — must not be left in the Spies tab. Returns the same object
// when nothing had to go.
export const withoutOrphanedDocuments = (intercepts, reports) => {
  const source = intercepts && typeof intercepts === "object" && !Array.isArray(intercepts) ? intercepts : {};
  const stolen = new Set(asArray(reports)
    .filter((report) => asArray(report?.interceptedBy).length > 0)
    .map((report) => documentExchangeId(report.id)));
  let changed = false;
  const next = {};
  for (const [target, entry] of Object.entries(source)) {
    const exchanges = asArray(entry?.exchanges);
    const kept = exchanges.filter((exchange) => !isDocumentExchange(exchange) || stolen.has(asText(exchange.id)));
    if (kept.length === exchanges.length) {
      next[target] = entry;
      continue;
    }
    changed = true;
    if (kept.length) next[target] = { ...entry, exchanges: kept };
  }
  return changed ? next : intercepts;
};

// The file after the player's service has read what it stole: the narrator is
// told who has a copy; the holders are not.
export const markIntercepted = (reports, deliveries, player) => {
  const stolen = new Set(asArray(deliveries)
    .filter((delivery) => delivery?.channel === "intelligence")
    .map((delivery) => asText(delivery.report?.id)));
  if (!stolen.size || !asText(player)) return asArray(reports);
  return asArray(reports).map((report) => (stolen.has(asText(report?.id)) && !has(report.interceptedBy, player)
    ? { ...report, interceptedBy: [...asArray(report.interceptedBy), asText(player)] }
    : report));
};

// What an event's card shows: the documents it produced that reached the
// player through the event itself — published, or held by the player's
// government alone.
export const documentsForEvent = (reports, eventId, player) => {
  const id = asText(eventId);
  const me = asText(player);
  if (!id) return [];
  return asArray(reports).filter((report) => asText(report?.sourceEventId) === id
    && (report.visibleTo === null
      || (asArray(report.visibleTo).length === 1 && fold(report.visibleTo[0]) === fold(me))));
};

// Every document the player's government can read — held, published or
// stolen — newest first. The advisor is the government's own staff.
export const documentsReadableBy = (reports, player) => {
  return asArray(reports)
    .filter((report) => readableBy(report, player))
    .reverse();
};

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// What the advisor is shown of the government's papers: a bounded list, each
// saying how the government came to have it — so a stolen copy is spoken of as
// what it is, and never cited to a foreign government as though it were open.
export const describeDocumentsForAdvisor = (reports, player, { limit = 8, bodyChars = 220 } = {}) => {
  const me = asText(player);
  const list = documentsReadableBy(reports, me).slice(0, Math.max(0, limit));
  if (!list.length) return "";
  const how = (report) => {
    if (report.visibleTo === null) return "published";
    if (has(report.visibleTo, me)) {
      const others = asArray(report.visibleTo).filter((name) => fold(name) !== fold(me));
      return others.length ? `held with ${others.join(", ")}` : "ours alone";
    }
    return `a copy our agents took from ${asArray(report.visibleTo).join(", ")} — they do not know we have it`;
  };
  return [
    "[Documents Our Government Holds]",
    "The papers that have reached this government — letters, treaties, intelligence — newest first. Speak from them as its own staff.",
    ...list.map((report) => `- "${report.title}"${asText(report.dateline) ? ` (${asText(report.dateline)})` : ""}${report.from ? ` · from ${report.from}` : ""} · ${how(report)}: ${clip(String(report.body ?? "").replace(/\s+/g, " ").trim(), bodyChars)}`),
  ].join("\n");
};
