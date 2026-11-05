/*! Open Historia — a picture in model or scenario text is never fetched from another website © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/markdownImages.test.js
//
// Runs in a bare checkout: markdownText.js is import-free, and the renderer is
// read as source (it is JSX, which bare node cannot load).
//
// ![alt](https://somewhere/x.png) in an advisor reply, an event body or a
// scenario's text used to be drawn like any picture: the player's device asked
// "somewhere" for it, unprompted, which tells whoever runs that host the
// player's address and when the text was on screen. A model can be talked into
// writing one and a scenario's author can simply write one.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { imageLoadsElsewhere } from "./markdownText.js";

const PAGE = "http://127.0.0.1:3000/";

test("a picture on another host is somebody else's, however the address is spelled", () => {
    for (const src of [
        "https://example.com/x.png",
        "http://example.com/x.png",
        "HTTPS://EXAMPLE.COM/x.png",
        "//example.com/x.png",
        // A browser reads a backslash in these as a slash.
        "/\\example.com/x.png",
        "\\\\example.com\\x.png",
        "  https://example.com/x.png  ",
        // Same machine, another port: another origin, and another program.
        "http://127.0.0.1:8080/x.png",
        "http://localhost:3000/x.png",
        // The page's host as somebody else's user name.
        "http://127.0.0.1:3000@example.com/x.png",
    ]) {
        assert.equal(imageLoadsElsewhere(src, PAGE), true, src);
    }
});

test("a picture from the game's own address is not", () => {
    for (const src of ["/flags/fr.svg", "flags/fr.svg", "./logo.png", "../logo.png", "http://127.0.0.1:3000/logo.png", "//127.0.0.1:3000/logo.png"]) {
        assert.equal(imageLoadsElsewhere(src, PAGE), false, src);
    }
});

test("a data: picture is its own bytes and asks nobody", () => {
    assert.equal(imageLoadsElsewhere("data:image/png;base64,iVBORw0KGgo=", PAGE), false);
    assert.equal(imageLoadsElsewhere("DATA:image/gif;base64,R0lGODlh", PAGE), false);
});

test("the game's own server is not a picture shelf: nothing under /api/ is fetched for a picture", () => {
    // The community file route fetches from GitHub for whoever asks it.
    for (const src of [
        "/api/hub/file?url=https://github.com/someone/repo/releases/download/v1/x.png",
        "/API/hub/file?url=https://github.com/x",
        "api/presence",
        "/x/../api/log",
        "http://127.0.0.1:3000/api/app-kind",
        "/api",
    ]) {
        assert.equal(imageLoadsElsewhere(src, PAGE), true, src);
    }
    assert.equal(imageLoadsElsewhere("/apiary.png", PAGE), false, "a file that merely starts with the letters");
});

test("with no page to compare with, every address that names a host is somebody else's", () => {
    assert.equal(imageLoadsElsewhere("https://example.com/x.png"), true);
    assert.equal(imageLoadsElsewhere("//example.com/x.png"), true);
    assert.equal(imageLoadsElsewhere("/logo.png"), false);
    assert.equal(imageLoadsElsewhere("/logo.png", "not a page address"), false);
});

test("nothing to fetch is nothing fetched elsewhere", () => {
    for (const src of ["", "   ", null, undefined]) assert.equal(imageLoadsElsewhere(src, PAGE), false);
});

const renderer = fs.readFileSync(new URL("./markdown.jsx", import.meta.url), "utf8");

test("the renderer draws a picture only after asking, and links to the others", () => {
    assert.match(renderer, /const COMPONENTS = \{[^}]*img: LocalImage/, "every picture in rendered text goes through LocalImage");
    const at = renderer.indexOf("const LocalImage = ");
    assert.notEqual(at, -1, "LocalImage has moved; this guard needs updating");
    const body = renderer.slice(at, renderer.indexOf("const COMPONENTS = "));
    assert.equal(renderer.split("<img").length - 1, 1, "one <img> in the renderer");
    assert.match(body, /if \(!imageLoadsElsewhere\(address\)\) return <img /, "and it is behind the check");
    assert.match(body, /return <ExternalLink href=\{address\}[^>]*>\{alt \|\| address\}<\/ExternalLink>;/, "another host's picture is its alt text, as a link");
    // A link cannot hold a link: a picture that was a link's text stays text.
    assert.match(body, /if \(insideLink\) return alt \|\| address;/);
});

test("raw HTML stays off, so an <img> tag in the text is text", () => {
    assert.doesNotMatch(renderer, /from "rehype-raw"|rehypePlugins=|dangerouslySetInnerHTML/);
    // The library's own address filter is left as it is: it is what drops
    // javascript: and the like before a link or a picture ever sees them.
    assert.doesNotMatch(renderer, /urlTransform=/);
});

test("the shared renderer is the only place model or scenario text becomes markup", () => {
    // If another file starts rendering markdown or injecting HTML, its pictures
    // need the same rule: this list is where that gets noticed.
    const root = new URL("../../", import.meta.url);
    const found = [];
    const walk = (directory) => {
        for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
            const next = new URL(`${item.name}${item.isDirectory() ? "/" : ""}`, directory);
            if (item.isDirectory()) {
                if (item.name !== "generated" && item.name !== "node_modules") walk(next);
            } else if (/\.jsx?$/.test(item.name) && !/\.test\.js$/.test(item.name)) {
                const text = fs.readFileSync(next, "utf8");
                if (/from "react-markdown"|dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/.test(text)) {
                    found.push(next.href.slice(root.href.length));
                }
            }
        }
    };
    walk(root);
    assert.deepEqual(found, ["Game/GameUI/markdown.jsx"]);
});
