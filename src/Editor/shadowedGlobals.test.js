/*! Open Historia — imports that shadow a global © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Editor/shadowedGlobals.test.js
//
// `import Map from "ol/Map"` takes the name Map for the rest of the file, so a
// plain `new Map()` further down builds an OpenLayers map instead of the one
// the author meant. It does not fail loudly either: an OL object answers get()
// and set(), so a cache made this way appears to work, and the first call to
// something only a real Map has — clear(), has(), size — throws in the browser,
// minified, far from the line that caused it. That is exactly how
// "oe.clear is not a function" reached the map editor on open.
//
// The rule: in a file that shadows one of these names, build the global through
// globalThis. An empty `new X()` or one built from a list is unmistakably the
// global; `new Map({ layers })` is OpenLayers' and is left alone.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

// Globals a library is likely to take the name of, and that code then builds.
const SHADOWABLE = ["Map", "Set", "WeakMap", "WeakSet", "Image", "Text", "Blob", "Worker", "Event"];

const sourceFiles = (dir, found = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!/node_modules|generated/.test(full)) sourceFiles(full, found);
        } else if (/\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name)) {
            found.push(full);
        }
    }
    return found;
};

test("a file that imports a global's name builds the real global through globalThis", () => {
    const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
    const offenders = [];

    for (const file of sourceFiles(root)) {
        const source = fs.readFileSync(file, "utf8");
        for (const name of SHADOWABLE) {
            // `import Map from "…"`, `import { Map } from "…"`, `… as Map`
            const shadowed = new RegExp(`import\\s+(?:${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\})\\s+from|\\bas\\s+${name}\\b`).test(source);
            if (!shadowed) continue;
            // An empty construction, or one from a list: unmistakably the global.
            const global = new RegExp(`(?<!globalThis\\.)\\bnew\\s+${name}\\s*\\(\\s*(\\)|\\[)`, "g");
            for (const match of source.matchAll(global)) {
                const line = source.slice(0, match.index).split(/\r?\n/).length;
                offenders.push(`${path.relative(root, file)}:${line} new ${name}(…) while ${name} is imported`);
            }
        }
    }

    assert.deepEqual(offenders, [], `use globalThis here:\n${offenders.join("\n")}`);
});
