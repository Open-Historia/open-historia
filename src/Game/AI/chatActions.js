/*! Open Historia — one request speaks for every AI participant © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A four-way chat used to cost four requests for one player message: one to
// decide who speaks next (the `nextSpeaker` task) and one for each leader who
// answered, capped at three. On a free key — a few hundred requests a day
// (requestBudget.js) — a single afternoon of diplomacy was the day's allowance.
//
// So a turn of a thread is ONE request that returns an ordered ACTION BATCH,
// acting for every AI participant at once:
//
//   send_message · add_reaction · rename_chat · add_member · remove_member
//   create_poll · add_poll_option · poll_vote
//
// Each action is validated on its own and applied on its own: a batch with one
// bad action still lands the rest, and what was refused is fed back into the
// next turn in words the model can act on — the same discipline as the
// application receipt for a time skip.
//
// The batch is then said a line at a time, a few seconds apart, and the player
// may cut in on what has not been said yet (planChatReveal, below).
//
// Two rules the reference taught, kept because they are what make a batch
// coherent rather than a list of messages:
//   - REFS, NOT IDS. A poll invented in this batch is addressed by the
//     `pollRef` the batch itself introduced, so it can be created and voted in
//     one answer. The engine mints the real id.
//   - A POLL IS BINDING. Every AI participant that would vote must vote in the
//     same batch; a poll nobody answered is a failed action, not a mood check.
//
// Actors are named by their exact display name — never an internal id, and
// never the player: a model may not speak for a human.
//
// DELIBERATELY IMPORT-FREE: the rules on plain data. The caller hands in the
// roster and applies the resulting events (runtime/chatThreads.js).

export const CHAT_ACTION_KINDS = Object.freeze([
    "send_message",
    "add_reaction",
    "rename_chat",
    "add_member",
    "remove_member",
    "create_poll",
    "add_poll_option",
    "poll_vote",
]);

export const MAX_ACTIONS_PER_BATCH = 16;
export const MESSAGE_MAX_CHARS = 20000;
export const TITLE_MAX_CHARS = 200;
export const EMOJI_MAX_CHARS = 10;

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const fold = (value) => asText(value).toLowerCase();
// An option's label, usable as its ref when the model gave none.
const refFromLabel = (label) => fold(label).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// ---------------------------------------------------------------------------
// Reading one action
// ---------------------------------------------------------------------------

export const normalizeChatAction = (entry) => {
    if (!entry || typeof entry !== "object") return null;
    const type = fold(entry.type ?? entry.action ?? entry.op);
    if (!CHAT_ACTION_KINDS.includes(type)) return null;
    const actorName = asText(entry.actorName ?? entry.actor ?? entry.speaker);
    if (!actorName) return null;
    const base = { type, actorName };

    if (type === "send_message") {
        const content = clip(asText(entry.content ?? entry.text ?? entry.message), MESSAGE_MAX_CHARS);
        return content ? { ...base, content } : null;
    }
    if (type === "add_reaction") {
        const emoji = clip(asText(entry.emoji), EMOJI_MAX_CHARS);
        const targetEntryId = asText(entry.targetEntryId ?? entry.target ?? entry.messageId);
        return emoji && targetEntryId ? { ...base, targetEntryId, emoji } : null;
    }
    if (type === "rename_chat") {
        const title = clip(asText(entry.title), TITLE_MAX_CHARS);
        return title ? { ...base, title } : null;
    }
    if (type === "add_member" || type === "remove_member") {
        const targetName = asText(entry.targetName ?? entry.target ?? entry.member);
        return targetName ? { ...base, targetName } : null;
    }
    if (type === "create_poll") {
        const pollRef = asText(entry.pollRef ?? entry.ref);
        const question = clip(asText(entry.question), 500);
        // A live run wrote its options as bare strings ("Accept", "Refuse") and
        // lost the whole poll — and the votes that referenced it — to a missing
        // optionRef. A label IS a usable ref, so one is derived from it: the
        // model meant the option it wrote, and refusing it over bookkeeping is
        // the kind of loss the flat markerOps build exists to prevent.
        const options = asArray(entry.options)
            .map((option) => {
                const label = clip(asText(typeof option === "string" ? option : option?.label ?? option?.text), 120);
                const explicit = asText(typeof option === "object" ? option?.optionRef ?? option?.ref ?? option?.id : "");
                return { optionRef: explicit || refFromLabel(label), label };
            })
            .filter((option) => option.optionRef && option.label);
        if (!pollRef || !question || options.length < 2) return null;
        return { ...base, pollRef, question, options, allowCustom: entry.allowCustom === true };
    }
    if (type === "add_poll_option") {
        const pollRef = asText(entry.pollRef ?? entry.ref);
        const optionRef = asText(entry.optionRef);
        const label = clip(asText(entry.label), 120);
        return pollRef && optionRef && label ? { ...base, pollRef, optionRef, label } : null;
    }
    // poll_vote
    const pollRef = asText(entry.pollRef ?? entry.ref);
    const optionRef = asText(entry.optionRef);
    return pollRef && optionRef ? { ...base, pollRef, optionRef } : null;
};

// ---------------------------------------------------------------------------
// Applying a batch
// ---------------------------------------------------------------------------
//
// `roster`: { aiParticipants: [name], humanParticipants: [name], knownPolities:
// [name], messageIds: [id], polls: [{ id, options: [{id, label}], votes }] }.
// Returns { events, applied, rejected, unansweredPolls } — events are
// chatThreads.js events, ready to append.
//
// `takenIds` are the ids already in the thread's log. An id is minted from the
// turn's date and a count, so a second turn on the same game day minted the
// first turn's ids again — and the log keeps only the first event of an id
// (chatThreads.js normalizeChatEvents), so that turn's replies vanished, and a
// reaction meant for one landed on the old line. A taken id is skipped.

export const applyChatActionBatch = (actions, roster = {}, { time = "", takenIds = [], disallowMembershipChanges = false } = {}) => {
    const ai = asArray(roster.aiParticipants).map(asText).filter(Boolean);
    const humans = asArray(roster.humanParticipants).map(asText).filter(Boolean);
    const known = asArray(roster.knownPolities).map(asText).filter(Boolean);
    const messageIds = new Set(asArray(roster.messageIds).map(asText).filter(Boolean));
    const aiByFold = new Map(ai.map((name) => [fold(name), name]));
    const humanFolds = new Set(humans.map(fold));
    const knownByFold = new Map(known.map((name) => [fold(name), name]));

    const events = [];
    const applied = [];
    const rejected = [];
    // What this batch invented: ref -> the id the engine minted for it.
    const pollIdByRef = new Map();
    const optionIdByRef = new Map();
    // Polls of THIS batch, and who has voted in them, for the binding rule.
    const pollsThisBatch = new Map();
    const membersNow = new Set([...ai.map(fold), ...humans.map(fold)]);
    const taken = new Set(asArray(takenIds).map(asText).filter(Boolean));
    let sequence = 0;
    const nextId = (prefix) => {
        let id = "";
        do {
            sequence += 1;
            id = `${prefix}-${asText(time) || "turn"}-${sequence}`;
        } while (taken.has(id));
        taken.add(id);
        return id;
    };
    const refuse = (action, reason) => rejected.push({ action, reason });

    for (const raw of asArray(actions).slice(0, MAX_ACTIONS_PER_BATCH)) {
        const action = normalizeChatAction(raw);
        if (!action) { refuse(raw, "not a chat action, or missing what its type needs"); continue; }

        // An actor must be an AI participant of THIS thread. A model may never
        // speak for a human, and never for a polity that is not in the room.
        const actor = aiByFold.get(fold(action.actorName));
        if (!actor) {
            refuse(action, humanFolds.has(fold(action.actorName))
                ? `${action.actorName} is played by a human: you may never speak or act for them`
                : `${action.actorName} is not a participant in this chat`);
            continue;
        }

        if (action.type === "send_message") {
            const id = nextId("msg");
            events.push({ id, kind: "message", time, by: actor, role: "leader", code: "", text: action.content });
            messageIds.add(id);
            applied.push({ ...action, actorName: actor, id });
            continue;
        }

        if (action.type === "add_reaction") {
            if (!messageIds.has(action.targetEntryId)) {
                refuse(action, `there is no message ${action.targetEntryId} in this chat to react to`);
                continue;
            }
            events.push({ id: nextId("react"), kind: "reaction", time, by: actor, target: action.targetEntryId, emoji: action.emoji });
            applied.push({ ...action, actorName: actor });
            continue;
        }

        if (action.type === "rename_chat") {
            events.push({ id: nextId("title"), kind: "title_changed", time, by: actor, title: action.title });
            applied.push({ ...action, actorName: actor });
            continue;
        }

        if (action.type === "add_member") {
            if (disallowMembershipChanges) {
                refuse(action, "institution membership is governed by the institution ledger, not by chat membership actions");
                continue;
            }
            const member = knownByFold.get(fold(action.targetName));
            if (!member) { refuse(action, `"${action.targetName}" is not a polity on this map`); continue; }
            if (membersNow.has(fold(member))) { refuse(action, `${member} is already in this chat`); continue; }
            membersNow.add(fold(member));
            events.push({ id: nextId("join"), kind: "member_joined", time, by: actor, member: { name: member, code: "" } });
            applied.push({ ...action, actorName: actor, targetName: member });
            continue;
        }

        if (action.type === "remove_member") {
            if (disallowMembershipChanges) {
                refuse(action, "institution membership is governed by the institution ledger, not by chat membership actions");
                continue;
            }
            const target = aiByFold.get(fold(action.targetName)) ?? knownByFold.get(fold(action.targetName));
            if (humanFolds.has(fold(action.targetName))) {
                refuse(action, `${action.targetName} is played by a human and cannot be removed from their own chat`);
                continue;
            }
            if (!target || !membersNow.has(fold(target))) { refuse(action, `${action.targetName} is not in this chat`); continue; }
            membersNow.delete(fold(target));
            events.push({ id: nextId("leave"), kind: "member_left", time, by: actor, member: { name: target, code: "" } });
            applied.push({ ...action, actorName: actor, targetName: target });
            continue;
        }

        if (action.type === "create_poll") {
            if (pollIdByRef.has(action.pollRef)) { refuse(action, `the poll ref "${action.pollRef}" was already used in this batch`); continue; }
            const pollId = nextId("poll");
            const options = action.options.map((option, index) => {
                const optionId = `${pollId}-o${index + 1}`;
                // Addressable by the ref it was given AND by what it says on the
                // ballot: a model that writes `optionRef: "Accept"` on the vote
                // means the option labelled Accept, and always did.
                optionIdByRef.set(`${action.pollRef}/${option.optionRef}`, optionId);
                optionIdByRef.set(`${action.pollRef}/${fold(option.label)}`, optionId);
                optionIdByRef.set(`${action.pollRef}/${refFromLabel(option.label)}`, optionId);
                return { id: optionId, label: option.label };
            });
            pollIdByRef.set(action.pollRef, pollId);
            pollsThisBatch.set(pollId, { pollId, question: action.question, voters: new Set() });
            events.push({ id: nextId("pollev"), kind: "poll_created", time, by: actor, pollId, question: action.question, options, allowCustom: action.allowCustom });
            applied.push({ ...action, actorName: actor, pollId });
            continue;
        }

        // The two poll actions that address something: a ref this batch
        // introduced, or a poll already open in the thread.
        const openPoll = asArray(roster.polls).find((poll) => fold(poll?.id) === fold(action.pollRef));
        const pollId = pollIdByRef.get(action.pollRef) ?? (openPoll ? asText(openPoll.id) : "");
        if (!pollId) {
            refuse(action, `no poll called "${action.pollRef}" — use a pollRef this batch created, or the id of a poll already open`);
            continue;
        }

        if (action.type === "add_poll_option") {
            const optionId = `${pollId}-${asText(action.optionRef).replace(/[^a-z0-9-]+/gi, "-")}`;
            optionIdByRef.set(`${action.pollRef}/${action.optionRef}`, optionId);
            events.push({ id: nextId("pollopt"), kind: "poll_option_added", time, by: actor, pollId, optionId, label: action.label });
            applied.push({ ...action, actorName: actor, pollId, optionId });
            continue;
        }

        // poll_vote
        const optionId = optionIdByRef.get(`${action.pollRef}/${action.optionRef}`)
            ?? optionIdByRef.get(`${action.pollRef}/${fold(action.optionRef)}`)
            ?? optionIdByRef.get(`${action.pollRef}/${refFromLabel(action.optionRef)}`)
            ?? asArray(openPoll?.options).find((option) => fold(option?.id) === fold(action.optionRef) || fold(option?.label) === fold(action.optionRef))?.id;
        if (!optionId) { refuse(action, `poll "${action.pollRef}" has no option "${action.optionRef}"`); continue; }
        const batchPoll = pollsThisBatch.get(pollId);
        if (batchPoll?.voters.has(fold(actor))) { refuse(action, `${actor} has already voted in this poll; the first vote stands`); continue; }
        if (openPoll?.votes && Object.keys(openPoll.votes).some((voter) => fold(voter) === fold(actor))) {
            refuse(action, `${actor} has already voted in this poll; the first vote stands`);
            continue;
        }
        batchPoll?.voters.add(fold(actor));
        events.push({ id: nextId("vote"), kind: "poll_vote_cast", time, by: actor, pollId, optionId });
        applied.push({ ...action, actorName: actor, pollId, optionId });
    }

    // A poll opened in this batch that the AI participants did not answer: the
    // reference's rule, and the reason polls are worth having at all. An
    // unanswered poll is reported back, not undone — the vote stands as far as
    // it went, and the model is told to finish it.
    const unansweredPolls = [];
    for (const poll of pollsThisBatch.values()) {
        const missing = ai.filter((name) => !poll.voters.has(fold(name)));
        if (missing.length) unansweredPolls.push({ pollId: poll.pollId, question: poll.question, missing });
    }

    return { events, applied, rejected, unansweredPolls };
};

// What the next turn is told about what went wrong — per action, in words it
// can act on (the same shape as the application receipt's notes).
export const describeChatActionFeedback = ({ rejected = [], unansweredPolls = [] } = {}) => {
    const lines = [];
    for (const { action, reason } of asArray(rejected)) {
        const what = asText(action?.type) || "an action";
        const who = asText(action?.actorName);
        lines.push(`- ${what}${who ? ` by ${who}` : ""} was refused: ${reason}.`);
    }
    for (const poll of asArray(unansweredPolls)) {
        lines.push(`- the poll "${poll.question}" was opened but ${poll.missing.join(", ")} did not vote. Every participant that would vote must vote in the same answer.`);
    }
    if (!lines.length) return "";
    return `[What your last actions did]\n${lines.join("\n")}`;
};

// ---------------------------------------------------------------------------
// Saying a batch a line at a time
// ---------------------------------------------------------------------------
//
// One request answers for the whole table, but a table does not talk all at
// once. A batch's events are shown in steps: the first message at once (the
// request was the wait for it), and each later message only after its speaker
// has been seen typing for CHAT_REVEAL_PAUSE_MS. A step is a message and what
// follows it up to the next message (a reaction, a vote, a newcomer); what
// comes before the first message goes with the first. A batch with fewer than
// two messages is one step.
//
// A step not shown yet has not been said. If the player speaks first it never
// is (GameUI/chat.jsx), the way Intervene discards the events of a time skip
// the reveal has not reached, and the next turn is told whose lines went
// unsaid (describeChatCutIn).

export const CHAT_REVEAL_PAUSE_MS = 5000;

export const planChatReveal = (events) => {
    const steps = [];
    let step = null;
    for (const event of asArray(events)) {
        if (!event || typeof event !== "object") continue;
        const isMessage = event.kind === "message";
        if (isMessage && step?.speaker) {
            steps.push(step);
            step = null;
        }
        if (!step) step = { speaker: "", events: [] };
        if (isMessage) step.speaker = asText(event.by);
        step.events.push(event);
    }
    if (step) steps.push(step);
    return steps;
};

// What the next turn is told when the player spoke before the last one was
// said in full: whose lines went unsaid. Not the lines themselves — they were
// never said, and a model shown them would only say them again.
export const describeChatCutIn = ({ player = "", steps = [] } = {}) => {
    const speakers = [...new Set(asArray(steps)
        .flatMap((step) => asArray(step?.events))
        .filter((event) => event?.kind === "message")
        .map((event) => asText(event.by))
        .filter(Boolean))];
    if (!speakers.length) return "";
    const who = asText(player) || "The player";
    const names = speakers.length === 1 ? speakers[0] : `${speakers.slice(0, -1).join(", ")} and ${speakers.at(-1)}`;
    return `[The player cut in]\n- ${who} spoke before ${names} had finished: what ${speakers.length === 1 ? "it was" : "they were"} about to say was never said. Answer what ${who} has just said.`;
};
