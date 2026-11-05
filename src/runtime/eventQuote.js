/*! Open Historia — canonical event quotation and prose repair helpers © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

const clean = (value) => String(value ?? "").trim();

const stripOuterQuotes = (value) => {
  const text = clean(value);
  if (text.length < 2) return text;
  const first = text[0];
  const last = text[text.length - 1];
  if ((first === '"' && last === '"') || (first === "“" && last === "”")) return text.slice(1, -1).trim();
  return text;
};

export const normalizeEventQuote = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const text = stripOuterQuotes(value.text ?? value.quote ?? value.content);
  if (!text) return null;
  const speaker = clean(value.speaker ?? value.author ?? value.by);
  const role = clean(value.role ?? value.title ?? value.position);
  return {
    text,
    ...(speaker ? { speaker } : {}),
    ...(role ? { role } : {}),
  };
};

// Gemini tool calls have occasionally returned prose that is JSON-escaped twice:
// the JS string itself contains the two characters "\\n" and "\\\"", so saving it
// faithfully leaves the player staring at "\\n\\n> \\\"...\\\"". Repair only strings
// that carry escaped layout markers. A lone backslash sequence such as C:\\new is
// data, not formatting, and must remain untouched.
export const repairEscapedEventProse = (value) => {
  const source = String(value ?? "");
  const escapedLayout = /\\r\\n|\\n\\n|\\n\s*>/.test(source);
  const repaired = escapedLayout
    ? source
      .replace(/\\r\\n\\r\\n/g, "\n\n")
      .replace(/\\n\\n/g, "\n\n")
      .replace(/\\r\\n(?=\s*>)/g, "\n")
      .replace(/\\n(?=\s*>)/g, "\n")
      .replace(/\\\"/g, '"')
    : source;
  return repaired.replace(/\r\n?/g, "\n").trim();
};

const attributionFromTail = (tailInput) => {
  const raw = clean(tailInput);
  if (!raw) return {};
  const dashed = /^[—–-]\s*(.+)$/.exec(raw);
  const attribution = clean((dashed ? dashed[1] : raw).replace(/^[,;:]\s*/, ""));
  if (!attribution) return {};

  // A dash attribution is commonly the canonical "Speaker, Role" form. A prose
  // attribution after a comma ("..., the minister said") stays whole rather
  // than pretending we can infer a role from natural language.
  if (dashed) {
    const comma = attribution.indexOf(",");
    if (comma > 0) {
      const speaker = clean(attribution.slice(0, comma));
      const role = clean(attribution.slice(comma + 1));
      return {
        ...(speaker ? { speaker } : {}),
        ...(role ? { role } : {}),
      };
    }
  }
  return { speaker: attribution };
};

// Old/frozen prompts tell the model to put a quotation at the END of an event as
// a Markdown blockquote. New canonical events store that same presentation as
// {quote:{text,speaker,role}}. This converter is intentionally narrow: only the
// final blockquote is lifted, so blockquotes elsewhere in authored prose remain
// ordinary Markdown.
export const extractTrailingEventQuote = (value) => {
  const source = repairEscapedEventProse(value);
  if (!source) return { description: "", quote: null };

  const match = /(?:^|\n{2,})((?:[ \t]*>[^\n]*(?:\n|$))+)[ \t\n]*$/u.exec(source);
  if (!match) return { description: source, quote: null };

  const block = match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!block) return { description: source, quote: null };

  let quoteText = block;
  let tail = "";
  const opening = block[0];
  const closingMark = opening === "“" ? "”" : opening === '"' ? '"' : "";
  if (closingMark) {
    const closing = block.lastIndexOf(closingMark);
    if (closing > 0) {
      quoteText = block.slice(1, closing).trim();
      tail = block.slice(closing + 1).trim();
    }
  }

  quoteText = stripOuterQuotes(quoteText);
  if (!quoteText) return { description: source, quote: null };
  const quote = { text: quoteText, ...attributionFromTail(tail) };
  return {
    description: source.slice(0, match.index).trim(),
    quote,
  };
};

export const normalizeEventPresentation = ({ description = "", quote = null } = {}) => {
  const extracted = extractTrailingEventQuote(description);
  return {
    description: extracted.description,
    quote: normalizeEventQuote(quote) || extracted.quote,
  };
};
