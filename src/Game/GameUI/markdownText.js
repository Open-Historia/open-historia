// Cleaning up what a model actually writes when it is trying to format a reply,
// so the markdown renderer can make something of it.
//
// The renderer (react-markdown + remark-gfm + remark-breaks, see markdown.jsx)
// understands GFM and nothing else: raw HTML is deliberately NOT enabled, since
// every one of these strings comes out of a model. So a model that reaches for
// <br> to break a line gets the literal text "<br>" in the player's chat — which
// is exactly the bug this file was written for. Rather than switching raw HTML
// on (which would hand model output a straight line to the DOM), the handful of
// tags a model actually reaches for are rewritten into their markdown
// equivalents here, and everything else is left alone to render as text.
//
// The other half is block spacing. GFM tables are the fussiest block in the
// language: a table whose header row is glued to the paragraph above it does not
// parse at all (the player sees a wall of pipes), and a paragraph glued to the
// last row is swallowed INTO the table as a one-cell row. Models get this wrong
// constantly, so the blank lines are inserted here instead.
//
// DELIBERATELY IMPORT-FREE, the same as advisorBlocks.js and eventFocus.js, so
// its tests run in a bare checkout.

// Tags in, markdown out. Ordered: <br> first because it is the common case, and
// the paragraph-ish tags before the inline ones so their newlines are already in
// place when the blank-line collapsing below runs.
//
// Opening and closing tags of a symmetrical pair map to the SAME replacement
// (<b> and </b> both become **), which is all markdown needs.
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
    // Tags that carry no formatting worth keeping — drop the tag, keep the text.
    [/<\/?(?:u|span|small|sup|sub|font)(?:\s[^>]*)?>/gi, ""],
];

const NAMED_ENTITIES = {
    nbsp: " ", amp: "&", quot: '"', apos: "'",
    lt: "<", gt: ">",
    ndash: "\u2013", mdash: "\u2014", hellip: "\u2026",
    lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d",
    bull: "\u2022", middot: "\u00b7", deg: "\u00b0", times: "\u00d7",
    pound: "\u00a3", euro: "\u20ac", trade: "\u2122", copy: "\u00a9",
    laquo: "\u00ab", raquo: "\u00bb", rarr: "\u2192", larr: "\u2190",
};

// &lt; &gt; &amp; are decoded LAST and only after the tag rewriting above, so a
// model that writes &lt;br&gt; gets a visible "<br>" rather than a line break —
// escaping a tag is how you say "I mean the text", and honouring that is the
// whole point of the entity.
const decodeEntities = (text) => text
    .replace(/&([a-zA-Z]+);/g, (whole, name) => {
        const decoded = NAMED_ENTITIES[name.toLowerCase()];
        return decoded === undefined ? whole : decoded;
    })
    // Numeric references, minus the three that would turn decoded text back into
    // markup we have already decided not to trust.
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, code) => {
        const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
        if (!Number.isFinite(point) || point < 32) return whole;
        if (point === 38 || point === 60 || point === 62) return whole;
        return String.fromCodePoint(point);
    });

// A GFM table's second line: |---|:--:|---:| and every spelling of it.
const isDelimiterRow = (line) => /^\s{0,3}\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-") && line.includes("|");

const isTableRow = (line) => line.includes("|") && line.trim() !== "";

const isBlank = (line) => line.trim() === "";

const opensFence = (line) => /^\s{0,3}(?:`{3,}|~{3,})/.test(line);

// Inserts the blank lines GFM needs around a table, and only those: a table that
// is already spaced correctly comes back byte-for-byte unchanged.
const spaceOutTables = (lines) => {
    const out = [];
    let inTable = false;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const next = lines[index + 1];

        // A header row is only a header row if a delimiter row follows it.
        const startsTable = !inTable && isTableRow(line) && next !== undefined && isDelimiterRow(next);

        if (startsTable) {
            const previous = out[out.length - 1];
            // Glued to the paragraph above: without this the whole table renders
            // as literal pipes.
            if (previous !== undefined && !isBlank(previous)) out.push("");
            inTable = true;
        } else if (inTable && (isBlank(line) || !isTableRow(line))) {
            inTable = false;
        }

        out.push(line);

        // Glued to the paragraph below: without this the paragraph is absorbed
        // into the table as a one-cell row.
        if (inTable && next !== undefined && !isBlank(next) && !isTableRow(next)) {
            out.push("");
            inTable = false;
        }
    }

    return out;
};

// One row's cells, split on the pipes that actually separate them: an escaped
// \| is content, not a boundary.
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

// Keep each kept column's alignment marker; anything unrecognised becomes plain.
const buildDelimiter = (cells) => buildRow(cells.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return ":---:";
    if (right) return "---:";
    if (left) return ":---";
    return "---";
}));

// Repairs the two ways a model's column count goes wrong, both of which cost the
// player something real:
//
//   - A row with MORE cells than the header. GFM silently drops the extras, so
//     content the model wrote never reaches the screen. Widen the header instead.
//   - A column no row ever fills. GFM pads the missing cells, so a header of
//     three columns over rows that only ever fill the first renders as one
//     column of text and two empty ones — which in a 20rem panel is most of the
//     width spent on nothing. Drop the columns that are empty all the way down.
//
// Rows are only rewritten when one of those actually applies: a well-formed
// table is returned exactly as the model wrote it, spacing and all.
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
        // A column counts as filled if ANY row has something in it. With no body
        // rows at all there is nothing to judge, so keep every column.
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

// "###Heading" is not a heading in CommonMark — the space is required, and a
// model dropping it is common enough to be worth repairing.
const spaceOutHeadings = (line) => line.replace(/^(\s{0,3})(#{1,6})([^#\s])/, "$1$2 $3");

// Runs the rewrites over one stretch of non-fenced text, with inline code spans
// held out: `<br>` inside backticks is a model TALKING about the tag, and
// rewriting it there would destroy the very thing being shown.
const normalizeSegment = (segment) => {
    const spans = [];
    const held = segment.replace(/`+[^`\n]*`+/g, (span) => {
        spans.push(span);
        return `\u0000${spans.length - 1}\u0000`;
    });

    let text = held;
    for (const [pattern, replacement] of HTML_REPLACEMENTS) text = text.replace(pattern, replacement);
    text = decodeEntities(text);
    // The paragraph tags above can leave runs of blank lines behind.
    text = text.replace(/\n{3,}/g, "\n\n");

    // Spacing first: repairTableColumns can only see a table the parser would
    // see, and a table glued to the paragraph above is not one yet.
    const lines = repairTableColumns(spaceOutTables(text.split("\n").map(spaceOutHeadings)));

    return lines.join("\n").replace(/\u0000(\d+)\u0000/g, (whole, index) => spans[Number(index)] ?? whole);
};

// The public entry point. Fenced code blocks pass through untouched — whatever
// is inside one is being shown to the player as literal text, and rewriting it
// would be rewriting the example.
export const normalizeMarkdown = (value) => {
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

    // An unterminated fence (a reply cut off mid-block) keeps its contents
    // verbatim rather than being rewritten on the way out.
    if (inFence) out.push(buffer.join("\n"));
    else flush();

    return out.join("\n");
};
