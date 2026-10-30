/*! Open Historia — a player's advisor, who brings them their government's secrets © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In a shared game each player's government keeps secrets: the events only it
// knows of (event.audience, sharedGameDirective.js) and the documents its
// agents stole (world.reports interceptedBy; runtime/reports.js). A letter to
// it is not one: it is in the thread with its sender. Their advisor, the one the week
// names for them (AI/seatAdvice.js), tells them, in a conversation of its own
// in their Diplomacy panel, apart from the governments they write to.
//
// The thread is made for the player's view as it is sent
// (projection.js projectForViewer) and never stored: the time skip, the idle
// diplomacy and every other reader of the game's conversations never see it,
// and a player cannot write into it (chat.jsx reads `source: "advisor"`).

import { advisorOf } from "../../Game/AI/seatAdvice.js";

export const ADVISOR_SOURCE = "advisor";
// The most a thread holds: the newest secrets.
const MAX_LINES = 40;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const same = (a, b) => Boolean(clean(a)) && clean(a).toLocaleLowerCase() === clean(b).toLocaleLowerCase();
const slug = (value) => clean(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "seat";
const text = (value) => String(value ?? "").trim();

// `readers`: the seat's polity, and the names its government had before it
// founded a country of its own (foundings.js formerNamesOf). `shown`: the ids
// of the events the player's view holds; a secret outside it is never told.
const knows = (names, readers) => list(names).some((name) => readers.some((reader) => same(name, reader)));

// The thread for one player's view, or null when there is nothing to tell.
export const advisorThreadFor = ({ world = {}, events = [] } = {}, seat, { readers = [seat], shown = null } = {}) => {
  const who = list(readers).length ? list(readers) : [seat];
  const lines = [];
  for (const event of list(events)) {
    const audience = list(event?.audience);
    if (!audience.length || !knows(audience, who)) continue;
    if (shown && !shown.has(clean(event?.id))) continue;
    const title = text(event?.title);
    const body = text(event?.description);
    if (!title && !body) continue;
    lines.push({ id: `advisor-${clean(event?.id) || slug(title)}`, time: clean(event?.date), text: [title && `In confidence: ${title}`, body].filter(Boolean).join("\n\n") });
  }
  for (const report of list(world?.reports)) {
    if (!knows(report?.interceptedBy, who)) continue;
    const title = text(report?.title);
    const body = text(report?.body);
    if (!title && !body) continue;
    lines.push({ id: `advisor-${clean(report?.id) || slug(title)}`, time: clean(report?.dateline || report?.createdDate), text: [title && `Our agents took a copy of this: ${title}`, body].filter(Boolean).join("\n\n") });
  }
  const advisor = advisorOf(world, seat);
  if (!lines.length) return null;
  const name = advisor?.name || "Your keeper of secrets";
  const heading = advisor?.title ? `${name}, ${advisor.title}` : name;
  const seen = new Set();
  const messages = lines
    .filter((line) => (seen.has(line.id) ? false : seen.add(line.id)))
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(-MAX_LINES)
    .map((line) => ({ id: line.id, role: "leader", speaker: name, code: "", text: line.text, time: line.time }));
  return {
    id: `advisor-desk-${slug(seat)}`,
    source: ADVISOR_SOURCE,
    title: heading,
    countries: [{ code: "", name: heading }],
    messages,
  };
};
