/*! Open Historia — chat threads as an event log © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A diplomatic thread used to be a title, a list of countries and a list of
// messages. That shape cannot answer the questions a real negotiation asks:
//
//   Who was in the room when this was said? (a polity added on turn six did not
//   hear turn two, and must not be written as though it had)
//   Who renamed it, and when did Italy leave?
//   What was the vote, and who voted which way?
//
// So a thread is an EVENT LOG — chat_created, member_joined, member_left,
// title_changed, message, reaction, poll_created, poll_option_added,
// poll_vote_cast — and everything else is a projection of it. The projection
// produces exactly the old shape (countries, messages, title, status), so every
// existing reader of a chat goes on working unchanged; the new things (polls,
// membership windows, per-participant knowledge cursors) read the log.
//
// A thread saved before this existed is migrated on read, idempotently: its
// countries become joins and its messages become message events, in order.
//
// DELIBERATELY IMPORT-FREE, like projects.js and reports.js: the rules on plain
// data, tested on their own.

export const CHAT_EVENT_KINDS = Object.freeze([
    "chat_created",
    "member_joined",
    "member_left",
    "title_changed",
    "message",
    "reaction",
    "poll_created",
    "poll_option_added",
    "poll_vote_cast",
    // A demand an Overlord makes of its own Puppet, and each answer to it, in the
    // one-on-one thread between them (see "Demands" below).
    "demand_made",
    "demand_answered",
]);

// Demands. An Overlord telling its own Puppet to do something is kept the way a
// poll is — as events appended to the thread's log, its state projected from
// them — and never as a flag written onto a message: a flag on a message was
// erased by the next save from any chat panel holding an older copy, which is
// how the refusal rule this replaces spent three commits never firing.
//
//   open ──accepted──────────────────► accepted     (no cost)
//   open ──refused───────────────────► refused      (costs Loyalty, once)
//   open ──alternative───────────────► countered
//   countered ──alternative_accepted─► settled      (no cost)
//   open | countered ──superseded────► superseded   (no cost)
//
// An Overlord that declines an alternative does so by DEMANDING AGAIN — revised,
// or the same demand restated — which supersedes the old one. Countering is
// negotiating, so it never costs anything; only a refusal does.
export const DEMAND_ANSWERS = Object.freeze(["accepted", "refused", "alternative", "alternative_accepted"]);
export const DEMAND_SUMMARY_MAX_CHARS = 240;
export const DEMAND_ALTERNATIVE_MAX_CHARS = 600;
const DEMAND_SETTLED = new Set(["accepted", "refused", "settled", "superseded"]);
// What a Puppet may still answer. A REFUSAL is not the end of the conversation:
// a player who refuses, thinks again and agrees is answering the same demand
// over, not being handed a new one — so the card stays live. What has been
// AGREED is final, by either side. The refusal's Loyalty cost is the turn's
// (gameState.chargeRefusals): changing your mind before the turn ends costs
// nothing, and after it the price has already been paid.
const DEMAND_ANSWERABLE = new Set(["open", "refused"]);

// A thread keeps this many events. A long negotiation is summarised into the
// rolling memory on its messages (diplomaticEnvelope.js), not kept whole.
export const CHAT_EVENTS_LIMIT = 600;
export const POLL_OPTION_LIMIT = 10;
export const POLL_QUESTION_MAX_CHARS = 500;
export const POLL_LABEL_MAX_CHARS = 120;

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const fold = (value) => asText(value).toLowerCase();

let sequence = 0;
const mintId = (prefix) => {
    sequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
};

// A participant is a name, or {name, code} — the shape chats have always
// stored. Kept as an object so the projection can hand back what readers expect.
export const normalizeMember = (value) => {
    if (!value) return null;
    if (typeof value === "string") {
        const name = asText(value);
        return name ? { code: "", name } : null;
    }
    if (typeof value !== "object") return null;
    const name = asText(value.name ?? value.label ?? value.country);
    const code = asText(value.code ?? value.id);
    if (!name && !code) return null;
    const polityKey = asText(value.polityKey);
    return { code, name: name || code, ...(polityKey ? { polityKey } : {}) };
};

const sameMember = (left, right) => (Boolean(asText(left?.polityKey)) && fold(left?.polityKey) === fold(right?.polityKey))
    || fold(left?.name) === fold(right?.name)
    || (Boolean(asText(left?.code)) && fold(left?.code) === fold(right?.code));

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const normalizeChatEvent = (entry, index = 0) => {
    if (!entry || typeof entry !== "object") return null;
    const kind = fold(entry.kind ?? entry.type);
    if (!CHAT_EVENT_KINDS.includes(kind)) return null;
    const base = {
        id: asText(entry.id) || `chat-event-${index + 1}`,
        kind,
        // In-game date, as messages have always carried.
        time: asText(entry.time ?? entry.date),
        // Who did it: a polity name, or "" for the engine/system.
        by: asText(entry.by ?? entry.actor ?? entry.speaker),
    };

    if (kind === "chat_created") {
        return { ...base, title: asText(entry.title), source: asText(entry.source) || "manual", linkedEventId: asText(entry.linkedEventId) };
    }
    if (kind === "member_joined" || kind === "member_left") {
        const member = normalizeMember(entry.member ?? entry.country ?? entry.target);
        return member ? { ...base, member } : null;
    }
    if (kind === "title_changed") {
        const title = asText(entry.title);
        return title ? { ...base, title } : null;
    }
    if (kind === "message") {
        const text = asText(entry.text ?? entry.message ?? entry.content);
        if (!text) return null;
        return {
            ...base,
            role: asText(entry.role) || (base.by ? "leader" : "system"),
            code: asText(entry.code),
            text,
            memorySummary: asText(entry.memorySummary),
            // A turn's own message: shown when this event is revealed
            // (runtime/unseenEvents.js).
            ...(asText(entry.eventId) ? { eventId: asText(entry.eventId) } : {}),
            // The catch-up the player's message was sent with
            // (AI/conversationCatchUp.js buildThreadCatchUp).
            ...(asText(entry.catchUp) ? { catchUp: asText(entry.catchUp), ...(asText(entry.catchUpLabel) ? { catchUpLabel: asText(entry.catchUpLabel) } : {}) } : {}),
        };
    }
    if (kind === "reaction") {
        const emoji = asText(entry.emoji);
        const target = asText(entry.target ?? entry.targetId ?? entry.messageId);
        return emoji && target ? { ...base, target, emoji, code: asText(entry.code) } : null;
    }
    if (kind === "poll_created") {
        const pollId = asText(entry.pollId ?? entry.id);
        const question = clip(asText(entry.question), POLL_QUESTION_MAX_CHARS);
        const options = asArray(entry.options)
            .map((option, optionIndex) => ({
                id: asText(option?.id ?? option?.optionId) || `option-${optionIndex + 1}`,
                label: clip(asText(option?.label ?? option), POLL_LABEL_MAX_CHARS),
            }))
            .filter((option) => option.label)
            .slice(0, POLL_OPTION_LIMIT);
        if (!pollId || !question || options.length < 2) return null;
        return { ...base, pollId, question, options, allowCustom: entry.allowCustom === true };
    }
    if (kind === "poll_option_added") {
        const pollId = asText(entry.pollId);
        const label = clip(asText(entry.label), POLL_LABEL_MAX_CHARS);
        return pollId && label ? { ...base, pollId, optionId: asText(entry.optionId) || mintId("option"), label } : null;
    }
    if (kind === "demand_made") {
        const demandId = asText(entry.demandId);
        const target = asText(entry.target);
        const summary = clip(asText(entry.summary), DEMAND_SUMMARY_MAX_CHARS);
        if (!demandId || !base.by || !target || !summary) return null;
        return {
            ...base,
            demandId,
            target,
            summary,
            ...(asText(entry.messageId) ? { messageId: asText(entry.messageId) } : {}),
            ...(asText(entry.supersedes) ? { supersedes: asText(entry.supersedes) } : {}),
        };
    }
    if (kind === "demand_answered") {
        const demandId = asText(entry.demandId);
        const answer = fold(entry.answer);
        if (!demandId || !base.by || !DEMAND_ANSWERS.includes(answer)) return null;
        const text = clip(asText(entry.text), DEMAND_ALTERNATIVE_MAX_CHARS);
        if (answer === "alternative" && !text) return null;
        return { ...base, demandId, answer, ...(text ? { text } : {}) };
    }
    // poll_vote_cast
    const pollId = asText(entry.pollId);
    const optionId = asText(entry.optionId);
    return pollId && optionId && base.by ? { ...base, pollId, optionId } : null;
};

export const normalizeChatEvents = (events) => {
    const seen = new Set();
    const list = [];
    asArray(events).forEach((entry, index) => {
        const event = normalizeChatEvent(entry, index);
        if (!event || seen.has(event.id)) return;
        seen.add(event.id);
        list.push(event);
    });
    // The newest events are the ones a negotiation needs; an ancient join is
    // still needed to know who is in the room, so those are never dropped.
    if (list.length <= CHAT_EVENTS_LIMIT) return list;
    const structural = new Set(["chat_created", "member_joined", "member_left", "title_changed"]);
    const keep = list.filter((event) => structural.has(event.kind));
    const rest = list.filter((event) => !structural.has(event.kind)).slice(-(CHAT_EVENTS_LIMIT - keep.length));
    return list.filter((event) => keep.includes(event) || rest.includes(event));
};

// ---------------------------------------------------------------------------
// Migration: the old shape becomes a log
// ---------------------------------------------------------------------------

// A thread stored before the log existed: its countries joined at the start and
// its messages were said in order. Idempotent — a thread that already has a log
// is returned untouched — so this can run on every read.
export const eventsFromLegacyChat = (chat) => {
    const created = {
        id: `${asText(chat?.id) || "chat"}-created`,
        kind: "chat_created",
        time: asText(asArray(chat?.messages)[0]?.time),
        by: "",
        title: asText(chat?.title),
        source: asText(chat?.source) || "manual",
        linkedEventId: asText(chat?.linkedEventId ?? chat?.eventId),
    };
    const joins = asArray(chat?.countries ?? chat?.participants)
        .map(normalizeMember)
        .filter(Boolean)
        .map((member, index) => ({
            id: `${created.id}-join-${index + 1}`,
            kind: "member_joined",
            time: created.time,
            by: "",
            member,
        }));
    const messages = [];
    asArray(chat?.messages).forEach((message, index) => {
        const text = asText(message?.text ?? message?.message ?? message?.content);
        if (!text) return;
        const id = asText(message?.id) || `${created.id}-message-${index + 1}`;
        messages.push({
            id,
            kind: "message",
            time: asText(message?.time ?? message?.date),
            by: asText(message?.speaker ?? message?.senderName),
            role: asText(message?.role ?? message?.sender) || "system",
            code: asText(message?.code),
            text,
            memorySummary: asText(message?.memorySummary ?? message?.diplomaticMemorySummary),
            eventId: asText(message?.eventId),
            catchUp: asText(message?.catchUp),
            catchUpLabel: asText(message?.catchUpLabel),
        });
        // Reactions were a map on the message; each becomes its own event.
        const reactions = message?.reactions && typeof message.reactions === "object" ? message.reactions : {};
        Object.entries(reactions).forEach(([by, value], reactionIndex) => {
            const emoji = asText(typeof value === "object" ? value?.emoji : value);
            if (!emoji) return;
            messages.push({
                id: `${id}-reaction-${reactionIndex + 1}`,
                kind: "reaction",
                time: asText(message?.time),
                by: asText(typeof value === "object" ? value?.country : "") || asText(by),
                target: id,
                emoji,
                code: asText(typeof value === "object" ? value?.code : ""),
            });
        });
    });
    return normalizeChatEvents([created, ...joins, ...messages]);
};

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

// Everything a reader wants, derived from the log: the participants as they
// stand, the messages with their reactions folded back on, the polls with their
// tallies, and — new — which members were present for each message.
export const projectChatThread = (events) => {
    const log = normalizeChatEvents(events);
    let title = "";
    let source = "manual";
    let linkedEventId = "";
    const members = [];
    const messages = [];
    const messageById = new Map();
    const polls = new Map();
    const demands = new Map();

    for (const event of log) {
        if (event.kind === "chat_created") {
            title = event.title || title;
            source = event.source || source;
            linkedEventId = event.linkedEventId || linkedEventId;
            continue;
        }
        if (event.kind === "title_changed") { title = event.title; continue; }
        if (event.kind === "member_joined") {
            if (!members.some((member) => sameMember(member, event.member))) members.push({ ...event.member });
            continue;
        }
        if (event.kind === "member_left") {
            const index = members.findIndex((member) => sameMember(member, event.member));
            if (index >= 0) members.splice(index, 1);
            continue;
        }
        if (event.kind === "message") {
            const message = {
                id: event.id,
                code: event.code,
                role: event.role,
                speaker: event.by,
                text: event.text,
                time: event.time,
                memorySummary: event.memorySummary,
                reactions: {},
                // Who was in the room when this was said (E5): a member added
                // later did not hear it, and must not be written as though it did.
                heardBy: members.map((member) => member.name),
                ...(event.eventId ? { eventId: event.eventId } : {}),
                ...(event.catchUp ? { catchUp: event.catchUp, ...(event.catchUpLabel ? { catchUpLabel: event.catchUpLabel } : {}) } : {}),
            };
            messages.push(message);
            messageById.set(event.id, message);
            continue;
        }
        if (event.kind === "reaction") {
            const message = messageById.get(event.target);
            if (message && event.by) {
                // A participant may react more than once to the same line. The
                // old country-keyed projection silently replaced the earlier
                // reaction, which made the UI capable of showing only one.
                // Keep the first legacy key stable, suffix later entries, and
                // carry the real country name in the value so round-tripping
                // the projected shape still recreates the correct actor.
                let key = event.by;
                let suffix = 2;
                while (Object.prototype.hasOwnProperty.call(message.reactions, key)) {
                    key = `${event.by}#${suffix}`;
                    suffix += 1;
                }
                message.reactions[key] = {
                    emoji: event.emoji,
                    code: event.code,
                    ...(key === event.by ? {} : { country: event.by }),
                };
            }
            continue;
        }
        if (event.kind === "poll_created") {
            polls.set(event.pollId, {
                id: event.pollId,
                question: event.question,
                options: event.options.map((option) => ({ ...option })),
                allowCustom: event.allowCustom,
                openedBy: event.by,
                time: event.time,
                votes: {},
            });
            continue;
        }
        if (event.kind === "poll_option_added") {
            const poll = polls.get(event.pollId);
            if (poll && poll.options.length < POLL_OPTION_LIMIT && !poll.options.some((option) => option.id === event.optionId)) {
                poll.options.push({ id: event.optionId, label: event.label });
            }
            continue;
        }
        if (event.kind === "demand_made") {
            // A demand made again replaces the one it answers — but only one still
            // in play. A refusal that stands is still charged, whatever follows.
            const replaced = event.supersedes ? demands.get(event.supersedes) : null;
            if (replaced && !DEMAND_SETTLED.has(replaced.status)) {
                replaced.status = "superseded";
                replaced.supersededBy = event.demandId;
            }
            if (!demands.has(event.demandId)) {
                demands.set(event.demandId, {
                    id: event.demandId,
                    by: event.by,
                    target: event.target,
                    summary: event.summary,
                    messageId: event.messageId || "",
                    time: event.time,
                    status: "open",
                    alternative: "",
                    ...(event.supersedes ? { supersedes: event.supersedes } : {}),
                });
            }
            continue;
        }
        if (event.kind === "demand_answered") {
            // Only the Puppet answers a demand, and only its Overlord accepts the
            // Puppet's alternative: a model may not answer for either side, nor a
            // third party for anyone. The first answer that settles it is final.
            const demand = demands.get(event.demandId);
            if (!demand) continue;
            const byPuppet = fold(event.by) === fold(demand.target);
            const byOverlord = fold(event.by) === fold(demand.by);
            if (event.answer === "alternative_accepted") {
                if (byOverlord && demand.status === "countered") demand.status = "settled";
                continue;
            }
            if (!byPuppet || !DEMAND_ANSWERABLE.has(demand.status)) continue;
            if (event.answer === "alternative") {
                demand.status = "countered";
                demand.alternative = event.text;
            } else {
                demand.status = event.answer;
            }
            demand.answeredAt = event.time;
            continue;
        }
        // poll_vote_cast — the first vote an actor casts on a poll is final.
        const poll = polls.get(event.pollId);
        if (!poll || poll.votes[event.by] || !poll.options.some((option) => option.id === event.optionId)) continue;
        poll.votes[event.by] = event.optionId;
    }

    return {
        title,
        source,
        linkedEventId,
        countries: members,
        messages,
        polls: [...polls.values()].map((poll) => ({
            ...poll,
            tally: poll.options.map((option) => ({
                ...option,
                votes: Object.values(poll.votes).filter((optionId) => optionId === option.id).length,
            })),
        })),
        demands: [...demands.values()],
    };
};

// The members present at a point in the log — what a newcomer may be shown of
// what was said before it arrived (nothing), and what the roster was then.
export const membersAtEvent = (events, eventId) => {
    const log = normalizeChatEvents(events);
    const members = [];
    for (const event of log) {
        if (event.kind === "member_joined" && !members.some((member) => sameMember(member, event.member))) members.push({ ...event.member });
        else if (event.kind === "member_left") {
            const index = members.findIndex((member) => sameMember(member, event.member));
            if (index >= 0) members.splice(index, 1);
        }
        if (event.id === eventId) break;
    }
    return members;
};

// What one participant may be shown of a thread: everything said while it was a
// member. A polity that joined on turn six is not shown turn two — it was not
// there, and showing it is how a model comes to write as though it had been.
export const threadAsSeenBy = (events, polity) => {
    const log = normalizeChatEvents(events);
    const wanted = fold(polity);
    if (!wanted) return projectChatThread(log);
    let inside = false;
    const visible = [];
    for (const event of log) {
        if (event.kind === "chat_created") { visible.push(event); continue; }
        if (event.kind === "member_joined") {
            if (fold(event.member?.name) === wanted || fold(event.member?.code) === wanted) inside = true;
            visible.push(event);
            continue;
        }
        if (event.kind === "member_left") {
            if (fold(event.member?.name) === wanted || fold(event.member?.code) === wanted) inside = false;
            visible.push(event);
            continue;
        }
        if (inside) visible.push(event);
    }
    return projectChatThread(visible);
};

// Messages a writer put in a thread's `messages` without going through its log
// — the one-on-one panel, the rotation fallback, a note a turn folded into an
// open thread, the player's own line before a group turn — appended to the log
// in the order they appear. Without this the log, being the truth of a thread,
// silently dropped them on the next read: the second one-request group turn
// lost the very message the player had just sent.
//
// A message is already in the log when the log has one with its id, or with the
// same speaker and the same words. An error bubble is the panel's, not the
// thread's, and never enters it. A message that came without an id gets one from
// its content, so reading a thread twice gives the same log.
const contentId = (text) => {
    let value = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        value ^= text.charCodeAt(index);
        value = Math.imul(value, 0x01000193) >>> 0;
    }
    return value.toString(36);
};

export const withUnloggedMessages = (events, messages, { threadId = "" } = {}) => {
    const log = normalizeChatEvents(events);
    if (!log.length) return log;
    const logged = projectChatThread(log).messages;
    const ids = new Set(logged.map((message) => asText(message.id)).filter(Boolean));
    const said = new Set(logged.map((message) => `${fold(message.speaker)}|${asText(message.text)}`));
    const additions = [];
    for (const message of asArray(messages)) {
        const role = asText(message?.role ?? message?.sender);
        if (role === "error") continue;
        const text = asText(message?.text ?? message?.message ?? message?.content);
        if (!text) continue;
        const speaker = asText(message?.speaker ?? message?.senderName);
        const id = asText(message?.id);
        const key = `${fold(speaker)}|${text}`;
        if ((id && ids.has(id)) || said.has(key)) continue;
        said.add(key);
        additions.push({
            id: id || `${asText(threadId) || "chat"}-unlogged-${contentId(`${key}|${asText(message?.time)}`)}`,
            kind: "message",
            time: asText(message?.time ?? message?.date),
            by: speaker,
            role: role || (speaker ? "leader" : "system"),
            code: asText(message?.code),
            text,
            memorySummary: asText(message?.memorySummary ?? message?.diplomaticMemorySummary),
            eventId: asText(message?.eventId),
            catchUp: asText(message?.catchUp),
            catchUpLabel: asText(message?.catchUpLabel),
        });
    }
    return additions.length ? normalizeChatEvents([...log, ...additions]) : log;
};
