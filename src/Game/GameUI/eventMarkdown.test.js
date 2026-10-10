/*! Open Historia — the timeline renders an event body like every other model text © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/eventMarkdown.test.js
//
// Runs without node_modules — it reads the source rather than rendering it
// (the renderer is JSX, which bare node cannot load).
//
// Event descriptions are written in paragraphs, with bold on the names and
// numbers that matter. The timeline card called ReactMarkdown bare, which is
// plain CommonMark: a lone newline is a SPACE there, so two paragraphs written
// one line apart came out as one block, and a model that reached for <br> got
// the literal tag. The documents on a card, the country panel's Advisor Report
// and the institutions' documents did the same, or printed the body raw. All of
// them now go through markdown.jsx (remark-gfm + remark-breaks +
// normalizeMarkdown + links that open in the system browser), because the text
// comes from the same place.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8");
const source = read("time.jsx");
const renderer = read("markdown.jsx");

test("the shared renderer has breaks, gfm, the repair pass and external links", () => {
    const list = renderer.match(/const REMARK_PLUGINS = \[([^\]]*)\]/);
    assert.ok(list, "the plugin list is named");
    for (const plugin of ["remarkGfm", "remarkBreaks"]) {
        assert.ok(renderer.includes(`import ${plugin} from`), `${plugin} is imported`);
        assert.ok(list[1].includes(plugin), `${plugin} is in the list`);
    }
    assert.match(renderer, /normalizeMarkdown\(children\)/, "every body goes through the <br>/<b> repair pass");
    assert.match(renderer, /components=\{COMPONENTS\}/);
    assert.match(renderer, /const COMPONENTS = \{[^}]*a: ExternalLink/, "links open outside the app");
});

test("model text on the timeline, the country panel and the institutions goes through it", () => {
    const users = {
        "time.jsx": source,
        "../Selection/CountryPanel.jsx": read("../Selection/CountryPanel.jsx"),
        "InstitutionsWorkspace.jsx": read("InstitutionsWorkspace.jsx"),
    };
    for (const [file, text] of Object.entries(users)) {
        assert.doesNotMatch(text, /from "react-markdown"/, `${file} does not call ReactMarkdown bare`);
        assert.match(text, /import Markdown, \{ MarkdownStyleInjector \} from "\.\.?\/(?:GameUI\/)?markdown\.jsx"/, `${file} imports the shared renderer`);
        assert.match(text, /<MarkdownStyleInjector \/>/, `${file} mounts the shared sheet, which styles tables`);
    }
    assert.match(source, /<Markdown bare className="timeline-markdown"[^>]*>\s*\{event\.description\}\s*<\/Markdown>/, "the event body");
    assert.match(source, /<Markdown bare className="timeline-markdown"[^>]*>\s*\{report\.body\}\s*<\/Markdown>/, "a document on a card");
    assert.match(users["../Selection/CountryPanel.jsx"], /<Markdown bare[^>]*>\s*\{String\(report\)\}\s*<\/Markdown>/, "the Advisor Report");
    assert.match(users["InstitutionsWorkspace.jsx"], /<Markdown bare[^>]*>\{report\.body\}<\/Markdown>/, "an institution document, no longer raw pre-wrap text");
});

test("the card still styles the blocks that a paragraphed body produces", () => {
    for (const selector of [".timeline-markdown p", ".timeline-markdown strong"]) {
        assert.ok(source.includes(selector), `${selector} is styled`);
    }
    // Paragraphs need to be told apart; a zero margin would render two of them
    // as one wall of text however correctly they parsed.
    const start = source.indexOf(".timeline-markdown p {");
    const paragraph = source.slice(start, source.indexOf("}", start));
    const bottom = paragraph.match(/margin:\s*\S+\s+\S+\s+(\S+)/);
    assert.ok(bottom && parseFloat(bottom[1]) > 0, `paragraphs are spaced apart, got ${bottom?.[1]}`);
});

test("canonical event quotes render beneath prose with an italic speaker attribution", () => {
    assert.match(source, /data-event-quotation="true"/);
    assert.match(source, /“\{entry\.text\}”/);
    assert.match(source, /fontStyle: "italic"/);
    assert.match(source, /\[entry\.speaker, entry\.role\]\.filter\(Boolean\)\.join\(", "\)/);
    assert.match(source, /<EventQuotation quote=\{event\.quote\} \/>/);
});
