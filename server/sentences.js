/*! Open Historia — where a sentence ends, in any script © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The game is written in the player's language, so where a sentence ends is
// never a list of characters: [.!?] split no Chinese or Japanese sentence, and
// Arabic's ؟ or Hindi's । ended none either. The Unicode property
// Sentence_Terminal holds them all (. ! ? 。 ！ ？ ؟ । ። ։ ۔ and the rest),
// and a run of them, with any closing bracket or quote after it, ends a
// sentence wherever it stands, except:
//   - inside a word or a number of a script with capitals or digits, between
//     two of them ("U.S", "e.g", "3.5", "v2.0"): the dot is part of it;
//   - before a comma or the like ("etc., and"): the sentence goes on;
//   - before a space and a small letter ("e.g. the", "U.S. troops"): in a
//     script with capitals a sentence starts with one.
// So a space after it is not needed: Chinese and Japanese put none after
// their full stop, and their next sentence starts at once. These are Unicode's
// own sentence-break rules (UAX #29), read by character category, never by
// a list of characters or of words.
//
// Server code never imports src/, and both read this: it lives here.
// DELIBERATELY IMPORT-FREE.

const TERMINAL_RUN = /\p{Sentence_Terminal}+(?:[\p{Pe}\p{Pf}]|(?=\p{Quotation_Mark})\p{Po})*/gu;
const FINAL_TERMINAL = /\p{Sentence_Terminal}+(?:[\p{Pe}\p{Pf}]|(?=\p{Quotation_Mark})\p{Po})*$/u;
const WORD_OR_NUMBER = /[\p{Lu}\p{Ll}\p{Lt}\p{N}]/u;
const SMALL_LETTER = /\p{Ll}/u;
const GOES_ON = /\p{Po}/u;
const SPACE = /\s/u;

const asText = (value) => String(value ?? "");

// The whole character at `index`, and the one that ends just before it (a
// character outside the first plane is two code units).
const charAt = (text, index) => {
    const point = text.codePointAt(index);
    return point === undefined ? "" : String.fromCodePoint(point);
};
const charBefore = (text, index) => {
    if (index <= 0) return "";
    const low = text.charCodeAt(index - 1);
    const start = low >= 0xdc00 && low <= 0xdfff && index >= 2 ? index - 2 : index - 1;
    return charAt(text, start);
};

// Where each sentence of `text` ends: the index just past its terminal and the
// closing marks after it, in order.
export const sentenceEnds = (text) => {
    const value = asText(text);
    const ends = [];
    for (const match of value.matchAll(TERMINAL_RUN)) {
        const end = match.index + match[0].length;
        const next = charAt(value, end);
        if (next && SPACE.test(next)) {
            let after = end;
            while (after < value.length && SPACE.test(value[after])) after += 1;
            if (SMALL_LETTER.test(charAt(value, after))) continue;
        } else if (next) {
            if (GOES_ON.test(next)) continue;
            if (WORD_OR_NUMBER.test(next) && WORD_OR_NUMBER.test(charBefore(value, match.index))) continue;
        }
        ends.push(end);
    }
    return ends;
};

// The sentences of `text` as written, each with the space after it, so that
// joined they are the text again; the last runs to the text's end, terminal or
// not.
export const sentenceSlices = (text) => {
    const value = asText(text);
    const slices = [];
    let from = 0;
    for (const end of sentenceEnds(value)) {
        let to = end;
        while (to < value.length && SPACE.test(value[to])) to += 1;
        if (to > from) slices.push(value.slice(from, to));
        from = to;
    }
    if (from < value.length) slices.push(value.slice(from));
    return slices;
};

// The sentences of `text`, each with its terminal, trimmed.
export const splitSentences = (text) => sentenceSlices(text).map((slice) => slice.trim()).filter(Boolean);

// The first sentence of `text` at least `min` characters long, with its
// terminal; "" when no sentence ends there.
export const firstSentence = (text, { min = 1 } = {}) => {
    const value = asText(text);
    for (const end of sentenceEnds(value)) {
        const sentence = value.slice(0, end).trim();
        if (sentence.length >= min) return sentence;
    }
    return "";
};

// Whether `text` ends as a sentence does: with a terminal, and any closing
// marks after it.
export const endsSentence = (text) => FINAL_TERMINAL.test(asText(text).trim());

// `text` without the terminal it ends with (a title made of a sentence).
export const withoutFinalTerminal = (text) => asText(text).trim().replace(/\p{Sentence_Terminal}+$/u, "").trim();
