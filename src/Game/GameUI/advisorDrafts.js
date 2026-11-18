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

// Pairs each ```senddraft entry with the blockquote holding its actual text.
// `sourceText` is the reply as it stood right before the senddraft fence was
// stripped, so the drafted letters are the LAST blockquotes in it — the
// directive puts the fence immediately after them. Aligning from the end
// rather than from index 0 is what makes that safe: the advisor also quotes
// the player (or its own earlier line) mid-reply, and pairing forwards would
// hand a draft the wrong body — silently sending the wrong letter to a live
// diplomacy thread, which is worse than dropping the button.
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

// New replies delimit each whole letter with numbered markers. The body remains
// readable Markdown, and senddraft holds ONLY validated recipient metadata.
// Canonicalize blank physical lines to quoted blank lines, so each multi-
// paragraph letter is one visible quote and one atomic composer payload.
// Malformed markers fail closed; they never fall back to positional pairing.
export const prepareAdvisorDraftLetters = (sourceText, draftCount) => {
    const source = String(sourceText ?? "");
    const lines = source.split("\n");
    if (!lines.some((line) => line.includes("[[draft:") || line.includes("[[/draft:"))) {
        return { text: source, quoteIndices: null, error: "" };
    }
    const fail = (why) => ({ text: source, quoteIndices: null, error: "draft boundaries " + why });
    const output = [];
    const quoteIndices = [];
    let active = null;
    for (const line of lines) {
        const marker = /^\[\[(\/?)draft:(\d+)\]\]$/.exec(line.trim());
        if (!marker) {
            if (line.includes("[[draft:") || line.includes("[[/draft:")) return fail("contained an invalid marker");
            if (active) active.body.push(line);
            else output.push(line);
            continue;
        }
        const number = Number(marker[2]);
        if (!marker[1]) {
            if (active || number !== quoteIndices.length + 1 || number > draftCount) {
                return fail("were nested, duplicated, or out of recipient order");
            }
            active = { number, body: [] };
            continue;
        }
        if (!active || active.number !== number) return fail("did not close the matching letter");
        const body = [...active.body];
        while (body.length && !body[0].trim()) body.shift();
        while (body.length && !body.at(-1).trim()) body.pop();
        if (!body.length || body.some((entry) => entry.trim() && !entry.startsWith(">"))) {
            return fail("contained missing or unquoted letter text");
        }
        const normalized = body.map((entry) => entry.trim() ? entry : ">").join("\n");
        if (!extractBlockquotes(normalized).length || !toPlainText(normalized)) {
            return fail("contained an empty letter");
        }
        // Force a quote boundary, even after unrelated quotes in the prose.
        if (output.at(-1) !== "") output.push("");
        quoteIndices.push(extractBlockquotes(output.join("\n")).length);
        output.push(normalized, "");
        active = null;
    }
    if (active || quoteIndices.length !== draftCount) {
        return fail("were incomplete or did not match the recipient count");
    }
    return { text: output.join("\n"), quoteIndices, error: "" };
};

// Legacy replies have no native letter IDs. An extra quote separated from the
// chosen final-N quotes by ONLY blank lines may be a previous paragraph of the
// SAME letter. Never guess that it is another recipient's whole letter.
const ambiguousLegacyDrafts = (sourceText, count) => {
    const lines = String(sourceText ?? "").split("\n");
    const runs = [];
    let start = -1;
    for (let i = 0; i <= lines.length; i += 1) {
        if (i < lines.length && /^>/.test(lines[i])) {
            if (start < 0) start = i;
        } else if (start >= 0) {
            if (lines.slice(start, i).some((line) => /^>\s*\S/.test(line))) {
                runs.push({ start, end: i - 1 });
            }
            start = -1;
        }
    }
    // With no quoted letters the existing per-entry diagnostics are precise;
    // nothing can be handed off. With some but too few, pairing is unsafe.
    if (runs.length > 0 && runs.length < count) return "had fewer quoted letters than recipients";
    // In an unmarked reply, blank lines cannot distinguish two letters from
    // two paragraphs of one letter. Inspect BOTH the preceding fragment and
    // the chosen quote run; prose between distinct letters is unambiguous.
    const selected = runs.slice(-count);
    if (runs.length > count) {
        const previous = runs[runs.length - count - 1];
        if (lines.slice(previous.end + 1, selected[0].start).every((line) => !line.trim())) {
            return "were ambiguous: unmarked multi-paragraph quotes cannot be paired safely";
        }
    }
    for (let index = 1; index < selected.length; index += 1) {
        if (lines.slice(selected[index - 1].end + 1, selected[index].start)
            .every((line) => !line.trim())) {
            return "were ambiguous: distinct letters have no reliable boundary";
        }
    }
    return "";
};

// `problems`, when given, collects a sentence for every entry that got no
// button, for the advisor's receipt (advisorBlocks.js describeReplyProblems).
export const buildMessageDrafts = (draftsRaw, sourceText, problems = [], quoteIndices = null) => {
    const allQuotes = extractBlockquotes(sourceText);
    // A marked letter is authoritative. A duplicate JSON text field must not
    // silently replace the visible body with different words in the composer.
    if (Array.isArray(quoteIndices) && draftsRaw.some((entry, index) => {
        const explicit = String(entry?.text ?? "").trim();
        return explicit && toPlainText(explicit) !== toPlainText(allQuotes[quoteIndices[index]] ?? "");
    })) {
        problems.push("marked letter text conflicted with duplicate senddraft text; no Send shortcuts were offered");
        return [];
    }
    if (!Array.isArray(quoteIndices) && !draftsRaw.every((entry) => String(entry?.text ?? "").trim())) {
        const ambiguity = ambiguousLegacyDrafts(sourceText, draftsRaw.length);
        if (ambiguity) {
            problems.push("the diplomatic drafts " + ambiguity + "; no Send shortcuts were offered");
            return [];
        }
    }
    // Where the paired run starts within allQuotes — the same end-alignment the
    // slice below performs, kept as a number so each draft can say WHICH
    // blockquote it belongs under. The Send button is rendered directly beneath
    // that quote, and the filter at the end of this function can drop entries,
    // so the position within the returned array is not a reliable answer.
    const offset = Math.max(0, allQuotes.length - draftsRaw.length);
    const indices = quoteIndices ?? draftsRaw.map((_, index) => offset + index);
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
            // A "text" field is still honored if present — older saved messages
            // have one, and an explicit value beats the positional guess.
            // Plain text: this string goes into the diplomacy composer, which
            // renders the player's own messages verbatim.
            const quoteIndex = indices[index];
            const text = toPlainText(Array.isArray(quoteIndices)
                ? allQuotes[quoteIndex] || ""
                : String(draft?.text ?? "").trim() || allQuotes[quoteIndex] || "");
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
