/*! Open Historia — community browse UX architecture © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/communityHubBrowseUx.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./communityHub.jsx", import.meta.url), "utf8");

test("community discovery has one featured shelf and one sortable browse grid", () => {
  assert.match(source, /title="📌 Featured"/);
  assert.match(source, />Browse Community</);
  assert.match(source, /const \[browseSort, setBrowseSort\] = useState\("installs"\)/);
  assert.match(source, /posts=\{rows\.browse\}/);
  assert.match(source, /layout="grid"/);
  assert.match(source, /const COMMUNITY_GRID_TEMPLATE = "repeat\(auto-fill, minmax\(min\(100%, 16\.5rem\), 1fr\)\)"/);
  assert.match(source, /gridTemplateColumns: COMMUNITY_GRID_TEMPLATE/);
  assert.match(source, /fillWidth/);
  assert.doesNotMatch(source, /COMMUNITY_GRID_MAX_WIDTH/);
  assert.doesNotMatch(source, /rows\.byInstalls/);
  assert.doesNotMatch(source, /rows\.byLikes/);
  assert.doesNotMatch(source, /rows\.byRecent/);
});

test("featured posts are excluded from the ordinary browse list to avoid repetition", () => {
  assert.match(source, /const pinned = filteredPosts\.filter\(\(post\) => post\.pinned\)/);
  assert.match(source, /const browse = filteredPosts\.filter\(\(post\) => !post\.pinned\)/);
  for (const label of ["Most Installed", "Most Liked", "Newest"]) {
    assert.match(source, new RegExp(`['\"]${label}['\"]`));
  }
});
