// Pairing a drafted diplomatic letter with the blockquote that holds its text,
// and with the place in the reply where its Send button belongs.
//
// Lifted out of advisor.jsx for the same reason advisorBlocks.js was: advisor.jsx
// is JSX and reaches maplibre-gl through assets.js, so nothing in it can be unit
// tested — and this is positional string handling whose failure mode is sending
// the WRONG letter to a live diplomacy thread. That has to be tested.

// DELIBERATELY IMPORT-FREE, so its tests run in a bare checkout.

// Pulls each contiguous "> "-quoted block out of the reply text, in the order
// it appears. Used to recover a drafted message's text positionally from the
// ```senddraft JSON (see ADVISOR_MESSAGE_DRAFT_DIRECTIVE in main.jsx) instead
// of trusting the model to retype it into a JSON string field a second time —
// that used to be how this worked, and an unescaped quote or a real line
// break in the letter was enough to make the fence invalid JSON and silently
// drop the button with no trace. A short "> " line still needs a match group
// that can be empty (a bare "> " paragraph break inside a longer quote).
export const extractBlockquotes = (text) => {
    const quotes = [];
    let current = null;
    for (const line of text.split("\n")) {
        const match = line.match(/^>\s?(.*)$/);
        if (match) {
            current = current ?? [];
            current.push(match[1]);
        } else if (current !== null) {
            quotes.push(current.join("\n").trim());
            current = null;
        }
    }
    if (current !== null) quotes.push(current.join("\n").trim());
    return quotes.filter(Boolean);
};

// Markdown out, plain prose in.
//
// The advisor writes its letters in markdown, because everything else it says is
// rendered as markdown. A diplomatic message is not: the player's own messages
// are shown verbatim in the chat (only the leaders' replies go through the
// renderer), so a letter handed over with its markup intact arrives as a wall of
// **asterisks** — and it would read that way to the recipient too.
//
// Deliberately conservative: it removes MARKUP, never words. Emphasis markers,
// heading hashes, link syntax and code ticks come off; the text, the line breaks
// and the paragraph structure of the letter all survive untouched.
export const toPlainText = (value) => String(value ?? "")
    .split("\n")
    .map((line) => line
        // Heading hashes and any blockquote marker that survived extraction.
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        // A markdown bullet becomes a plain one. "*" and "+" read as typos in a
        // letter; "-" reads as a dash, which is what was meant.
        .replace(/^(\s*)[*+]\s+/, "$1- ")
        // Trailing whitespace is markdown's hard line break — invisible markup.
        .replace(/\s+$/, ""))
    // A horizontal rule is pure presentation and has no plain-text meaning.
    .filter((line) => !/^\s{0,3}(\*{3,}|-{3,}|_{3,})\s*$/.test(line))
    .join("\n")
    // Links: keep the words, drop the syntax. Images lose their alt text marker
    // the same way.
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    // Emphasis, longest marker first so ** is never mistaken for two *.
    .replace(/\*\*\*(\S(?:[\s\S]*?\S)?)\*\*\*/g, "$1")
    .replace(/\*\*(\S(?:[\s\S]*?\S)?)\*\*/g, "$1")
    .replace(/(^|[^\w*])\*(\S(?:[\s\S]*?\S)?)\*(?![\w*])/g, "$1$2")
    .replace(/~~(\S(?:[\s\S]*?\S)?)~~/g, "$1")
    // Underscores only at word boundaries, so snake_case names survive.
    .replace(/(^|[^\w_])__(\S(?:[\s\S]*?\S)?)__(?![\w_])/g, "$1$2")
    .replace(/(^|[^\w_])_(\S(?:[\s\S]*?\S)?)_(?![\w_])/g, "$1$2")
    // Code ticks, including the fence lines a model sometimes wraps a letter in.
    .replace(/^```.*$/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    // A backslash-escaped markdown character meant the character itself.
    .replace(/\\([\\`*_{}[\]()#+\-.!~>])/g, "$1")
    .trim();

// WHICH QUOTE HOLDS EACH LETTER. A letter of several paragraphs is often
// written as several quotes with blank lines between them (the 1912 Tangier
// reply: two letters in 13 quotes), and pairing recipients with the last N
// quotes handed Britain its closing line and Spain its signature. So the
// letters are found first, then paired:
//   - marked: the advisor puts each letter between [[draft:N]] and
//     [[/draft:N]] lines (ADVISOR_MESSAGE_DRAFT_DIRECTIVE in AI/main.jsx), N in
//     recipient order. A marker that is malformed, nested, out of order or
//     unclosed, a letter with unquoted lines in it, or a count that is not
//     the recipients' pairs nothing: guessing would send a letter to the wrong
//     government;
//   - unmarked (a model that wrote none, a reply saved before them): quotes
//     with only blank lines between them are one letter, and the last N
//     letters are the N recipients', in order. Two letters with nothing but a
//     blank line between them read as one, so there are fewer letters than
//     recipients and nothing is paired.
// The text comes back as it is shown: markers gone, each letter one quote.
// { text, quoteIndices (into extractBlockquotes(text), one a recipient, or
// null when none can be paired), marked, problem ("" when they can) }.
const MARKER = /^\[\[(\/?)draft:(\d+)\]\]$/;
const isMarker = (line) => MARKER.test(line.trim());
const isQuote = (line) => /^>/.test(line);

export const draftLetters = (sourceText, count) => {
    const lines = String(sourceText ?? "").split("\n");
    const marked = lines.some((line) => line.includes("[[draft:") || line.includes("[[/draft:"));
    const shown = () => lines.filter((line) => !isMarker(line)).join("\n");
    const none = (problem) => ({ text: shown(), quoteIndices: null, marked, problem });
    if (!count) return { text: shown(), quoteIndices: [], marked, problem: "" };
    if (!marked) return unmarkedLetters(lines, count);

    const output = [];
    const quoteIndices = [];
    let letter = null;
    for (const line of lines) {
        const marker = MARKER.exec(line.trim());
        if (!marker) {
            if (line.includes("[[draft:") || line.includes("[[/draft:")) return none("had a draft marker that was not on a line of its own");
            (letter ?? output).push(line);
            continue;
        }
        const number = Number(marker[2]);
        if (!marker[1]) {
            if (letter || number !== quoteIndices.length + 1) return none("had draft markers nested or out of order");
            letter = [];
            continue;
        }
        if (!letter || number !== quoteIndices.length + 1) return none("closed a letter that was not open");
        const body = letter.join("\n").trim().split("\n");
        if (!body.some((entry) => entry.replace(/^>\s?/, "").trim()) || body.some((entry) => entry.trim() && !isQuote(entry))) {
            return none(`had letter ${number} empty or with unquoted lines in it`);
        }
        // One quote, the blank lines between its paragraphs quoted, set apart from what is around it.
        if (output.length && output.at(-1).trim()) output.push("");
        quoteIndices.push(extractBlockquotes(output.join("\n")).length);
        output.push(...body.map((entry) => (entry.trim() ? entry : ">")), "");
        letter = null;
    }
    if (letter) return none(`left letter ${quoteIndices.length + 1} open`);
    if (quoteIndices.length !== count) return none(`marked ${quoteIndices.length} letter(s) for ${count} recipient(s)`);
    return { text: output.join("\n"), quoteIndices, marked, problem: "" };
};

const unmarkedLetters = (lines, count) => {
    // A blank line between two quoted lines is a paragraph break inside one letter.
    const filled = lines.map((line, index) => {
        if (line.trim()) return line;
        const before = lines.slice(0, index).findLast((entry) => entry.trim());
        const after = lines.slice(index + 1).find((entry) => entry.trim());
        return before !== undefined && after !== undefined && isQuote(before) && isQuote(after) ? ">" : line;
    });
    const text = filled.join("\n");
    const found = extractBlockquotes(text).length;
    const quoteIndices = Array.from({ length: count }, (_, index) => found - count + index);
    // (No letter at all: each entry says so for itself, below.)
    return found >= count || found === 0
        ? { text, quoteIndices, marked: false, problem: "" }
        : { text, quoteIndices: null, marked: false, problem: `held ${found} letter(s) for ${count} recipient(s)` };
};

// `letters`: draftLetters' answer for the reply, or the reply's text (read with
// draftLetters here). `problems`, when given, collects a sentence for every
// entry that got no button, for the advisor's receipt (advisorBlocks.js
// describeReplyProblems).
export const buildMessageDrafts = (draftsRaw, letters, problems = []) => {
    const read = typeof letters === "string" ? draftLetters(letters, draftsRaw.length) : letters;
    const quotes = extractBlockquotes(read.text);
    // A "text" field in the JSON is an older reply's letter (before they were
    // read from the quote). It stands on its own in an unmarked reply; a
    // marked letter is the one the player sees, and a JSON text saying
    // something else pairs nothing.
    const written = (draft) => String(draft?.text ?? "").trim();
    const standsAlone = !read.marked && draftsRaw.every(written);
    if (!read.quoteIndices && !standsAlone) {
        problems.push(`the reply ${read.problem}, so no diplomatic draft got a button`);
        return [];
    }
    if (read.marked && draftsRaw.some((draft, index) => written(draft) && toPlainText(written(draft)) !== toPlainText(quotes[read.quoteIndices[index]]))) {
        problems.push("a draft's JSON text differs from its marked letter, so no diplomatic draft got a button");
        return [];
    }
    return draftsRaw
        .map((draft, index) => {
            const targetType = String(draft?.targetType || "private").trim().toLowerCase();
            const country = String(draft?.country ?? "").trim();
            const institutionId = String(draft?.institutionId ?? "").trim();
            const caseId = String(draft?.caseId ?? "").trim();
            const threadId = String(draft?.threadId ?? "").trim();
            const label = country ? `the draft to ${country}` : `draft ${index + 1}`;
            const drop = (why) => {
                problems.push(`${label} ${why}, so no button was drawn for it`);
                return null;
            };
            if (targetType === "private" && !country) return drop("named no country");
            if (targetType === "institution-council" && !institutionId && !threadId) return drop("named no institutionId or threadId");
            if (targetType === "institution-lifecycle" && ((!institutionId && !threadId) || (!caseId && !threadId))) return drop("named no caseId and institutionId, or threadId");
            if (!["private", "institution-council", "institution-lifecycle"].includes(targetType)) return drop(`had the targetType "${targetType}", which is not private, institution-council or institution-lifecycle`);
            // The quote the Send button is drawn under (the filter below can drop
            // entries, so the position in the returned list is no answer).
            const quoteIndex = read.quoteIndices ? read.quoteIndices[index] : Math.max(0, quotes.length - draftsRaw.length) + index;
            // Plain text: this string goes into the diplomacy composer, which
            // renders the player's own messages verbatim.
            const text = toPlainText(written(draft) && !read.marked ? written(draft) : quotes[quoteIndex] || "");
            if (!text) return drop("had no > blockquote holding its letter just before the block");
            return {
                targetType,
                country,
                institutionId,
                caseId,
                threadId,
                text,
                quoteIndex,
            };
        })
        .filter(Boolean);
};

// A drafted letter's own id: the advisor reply it is in, and its place among
// that reply's drafts. "" for a reply with no id (one saved before replies had
// them), whose drafts are then never marked as sent.
export const draftIdOf = (replyId, index) => {
    const reply = String(replyId ?? "").trim();
    return reply && Number.isInteger(index) && index >= 0 ? `${reply}#${index}` : "";
};

// When a drafted private letter has already gone to its recipient: the date of
// the player's message sent from this very draft (the diplomacy composer stamps
// the draft's id on it as `fromDraft`: chat.jsx), or "" when none was. "The
// same letter" used to be a word overlap of 0.9 or more, which took text in a
// script with no spaces between its words for a single word. A letter the
// advisor drafts again in a later reply is a new draft: the advisor is shown the
// player's correspondence and told not to draft a sent letter again
// (ADVISOR_MESSAGE_DRAFT_DIRECTIVE in AI/main.jsx).
export const sentLetterDate = (draft, chats) => {
    if (String(draft?.targetType || "private") !== "private") return "";
    const id = String(draft?.id ?? "").trim();
    if (!id) return "";
    for (const chat of Array.isArray(chats) ? chats : []) {
        const sent = (Array.isArray(chat?.messages) ? chat.messages : [])
            .filter((message) => message?.role === "user" && String(message?.fromDraft ?? "").trim() === id);
        if (sent.length) return String(sent.at(-1).time ?? "").trim() || "earlier";
    }
    return "";
};

// Splits a reply into the blockquotes and the prose between them, in order, so
// each drafted letter's Send button can be rendered directly under the letter
// instead of collected at the bottom of the message.
//
// Grouped EXACTLY as extractBlockquotes groups them, empty-quote filtering
// included, because the quoteIndex recorded above indexes into that same
// sequence — a quote counted here but not there (or the reverse) would put a
// "Send to France" button under the wrong letter.
export const splitAtBlockquotes = (text) => {
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
        // extractBlockquotes drops a quote with no body; keep the numbering in
        // step by treating it as ordinary text here too.
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
