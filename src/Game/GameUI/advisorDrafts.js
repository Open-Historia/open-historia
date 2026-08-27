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

export const buildMessageDrafts = (draftsRaw, sourceText) => {
    const allQuotes = extractBlockquotes(sourceText);
    // Where the paired run starts within allQuotes — the same end-alignment the
    // slice below performs, kept as a number so each draft can say WHICH
    // blockquote it belongs under. The Send button is rendered directly beneath
    // that quote, and the filter at the end of this function can drop entries,
    // so the position within the returned array is not a reliable answer.
    const offset = Math.max(0, allQuotes.length - draftsRaw.length);
    const blockquotes = allQuotes.slice(offset);
    return draftsRaw
        .map((draft, index) => {
            const country = draft && String(draft.country ?? "").trim();
            if (!country) return null;
            // A "text" field is still honored if present — older saved messages
            // have one, and an explicit value beats the positional guess.
            // Plain text: this string goes into the diplomacy composer, which
            // renders the player's own messages verbatim.
            const text = toPlainText(String(draft?.text ?? "").trim() || blockquotes[index] || "");
            return text ? { country, text, quoteIndex: offset + index } : null;
        })
        .filter(Boolean);
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
