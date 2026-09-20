/*! Open Historia — stray JSX closer guard © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/jsxStrayClosers.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// A LEFTOVER ")}" IS NOT AN ERROR — IT IS TEXT. An edit that replaced a block
// and left its old closing line behind shipped `)}` onto the map's country card,
// under the puppet panel, in a build that passed every test and compiled
// cleanly: JSX puts unmatched text in the children, and neither the parser nor
// eslint has anything to say about it.
//
// The signature is two IDENTICAL closer lines, same indentation, one after the
// other: the first closes the expression, the second closes nothing. Different
// indentation is ordinary nesting and is left alone.
const jsxFiles = (dir, found = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!/node_modules|generated/.test(full)) jsxFiles(full, found);
        } else if (full.endsWith(".jsx")) found.push(full);
    }
    return found;
};

test("no JSX file closes the same expression twice — a stray closer renders as text", () => {
    const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
    const closer = /^\s*\)\}\s*$/;
    const stray = [];
    for (const file of jsxFiles(root)) {
        const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
        for (let index = 1; index < lines.length; index += 1) {
            const previous = lines[index - 1];
            const current = lines[index];
            if (closer.test(previous) && previous === current) stray.push(`${path.relative(root, file)}:${index + 1}`);
        }
    }
    assert.deepEqual(stray, [], "these lines close nothing and are drawn on screen as \")}\"");
});
