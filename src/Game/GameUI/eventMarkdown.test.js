/*! Open Historia — the timeline renders an event body like every other model text © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/eventMarkdown.test.js
//
// Runs without node_modules — it reads the source rather than rendering it.
//
// Event descriptions are written in paragraphs, with bold on the names and
// numbers that matter. The timeline card called ReactMarkdown bare, which is
// plain CommonMark: a lone newline is a SPACE there, so two paragraphs written
// one line apart came out as one block, and a model that reached for <br> got
// the literal tag. The advisor and the chat have had the fix since markdown.jsx
// (remark-gfm + remark-breaks + normalizeMarkdown); this holds the timeline to
// the same three, because the text comes from the same place.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "time.jsx"), "utf8");

test("the timeline event body is rendered with breaks, gfm and the repair pass", () => {
    const render = source.match(/<ReactMarkdown[^>]*>\{[^}]*event\.description[^}]*\}<\/ReactMarkdown>/);
    assert.ok(render, "the event description is still rendered by ReactMarkdown");
    assert.match(render[0], /remarkPlugins=/, "with plugins, not bare CommonMark");
    assert.match(render[0], /normalizeMarkdown\(/, "and through the <br>/<b> repair pass");
    const list = source.match(/const EVENT_REMARK_PLUGINS = \[([^\]]*)\]/);
    assert.ok(list, "the plugin list is named");
    for (const plugin of ["remarkGfm", "remarkBreaks"]) {
        assert.ok(source.includes(`import ${plugin} from`), `${plugin} is imported`);
        assert.ok(list[1].includes(plugin), `${plugin} is in the list`);
    }
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
