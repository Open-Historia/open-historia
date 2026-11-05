/*! Open Historia — the community hub in the library's interface © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/communityHubUx.test.js
//
// What the screens do with the hub, read out of their source: a picture is
// shown from its checked copy only, and the website's hub route answers for a
// file and nothing else. (The links stamped where a post's checked copy is
// downloaded, the Update of an unchecked copy, Import & play's prompt and
// Suggest changes on a copy whose original is gone: libraryLandingUx.test.js.)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const hub = read("./communityHub.jsx");

test("a post's picture is shown from its checked copy, never from the post's own attachment", () => {
  // The Community tab's cover is the copy parsePost found, or the default cover.
  assert.match(hub, /src=\{post\.coverImageUrl \|\| DEFAULT_SCENARIO_COVER\}/);
  assert.match(read("../../runtime/hubPosts.js"), /const coverImageUrl = releaseCopyOf\(hubIndex, firstHubImage\(body\)\);/);
  // The flag and basemap browsers show pictureUrl, which their lists fill in
  // from the index; imageUrl and coverImageUrl are the addresses the posts
  // give, kept to look the copies up by.
  const pickers = {
    "src/Editor/FlagPicker.jsx": read("../../Editor/FlagPicker.jsx"),
    "src/Editor/BasemapPicker.jsx": read("../../Editor/BasemapPicker.jsx"),
    "src/Game/GameUI/GameFlagPicker.jsx": read("./GameFlagPicker.jsx"),
  };
  for (const [name, text] of Object.entries(pickers)) {
    assert.match(text, /post\??\.pictureUrl/, `${name} shows the checked copy`);
    assert.doesNotMatch(text, /(?:src|imageUrl)=\{post\??\.(?:imageUrl|coverImageUrl)\}/, `${name} loads nothing from a post`);
  }
  for (const file of ["communityFlags.js", "communityBasemaps.js"]) {
    assert.match(read(`../../runtime/${file}`), /pictureUrl: releaseCopyOf\(hubIndex, post\.(?:imageUrl|coverImageUrl)\)/);
  }
  // The hub closes a post once it has released its file, so the pages the
  // browsers link to list closed posts too.
  assert.doesNotMatch(pickers["src/Editor/BasemapPicker.jsx"], /is%3Aopen/);
});

test("the website's hub route answers for a file and nothing else", () => {
  const router = read("../../runtime/web/router.js");
  const route = router.slice(router.indexOf('if (domain === "hub") {'), router.indexOf("return errorResponse(`Unknown web-mode endpoint"));
  assert.match(route, /if \(segments\[0\] !== "file" \|\| method !== "GET"\) return errorResponse\(`Unknown hub endpoint: \$\{url\.pathname\}`, 404\);/);
  assert.match(route, /return fetch\(`\$\{base\}\/hub\/file\$\{url\.search\}`, \{ method \}\);/);
  // The counter's dedup by account went with its routes.
  assert.doesNotMatch(router, /getSession|Authorization/);
});
