/*! Open Historia — GM Console UX architecture checks © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./cheats.jsx", import.meta.url), "utf8");

test("long GM territory previews collapse large operation lists instead of using Jump To", () => {
  assert.doesNotMatch(source, /gmJumpSections|gm-preview-jump|Choose preview section|Jump To/i);
  assert.match(source, /GM_COLLAPSED_OPERATION_LIMIT\s*=\s*4/);
  assert.match(source, /entries\.slice\(0, GM_COLLAPSED_OPERATION_LIMIT\)/);
  assert.match(source, /click to show all/);
  assert.match(source, /Show fewer/);
  assert.match(source, /visibleOperationRows\("territory-sovereignty", transferOps\)/);
  assert.match(source, /visibleOperationRows\("territory-control", controlOps\)/);
  assert.match(source, /visibleOperationRows\("territory-claims", claimOps\)/);
});

test("GM Apply stays pinned while reviewing long exact-operation lists", () => {
  const applyStart = source.indexOf("const result = await applyGameMasterPreview(gmPreview)");
  assert.ok(applyStart >= 0, "expected the exact-preview Apply branch");
  const applySection = source.slice(applyStart, applyStart + 2600);
  assert.match(applySection, /position: "sticky"/);
  assert.match(applySection, /bottom: "[^"]+"/);
});

test("GM post-apply panel refresh no longer blocks the canonical apply interaction", () => {
  const applyStart = source.indexOf("const result = await applyGameMasterPreview(gmPreview)");
  assert.ok(applyStart >= 0, "expected the exact-preview Apply branch");
  const applySection = source.slice(applyStart, applyStart + 2200);
  assert.match(applySection, /requestIdleCallback\(refreshLater, \{ timeout: \d+ \}\)/);
  assert.match(applySection, /deferred admin refresh failed/);
  assert.match(applySection, /setTimeout\(refreshLater, 0\)/);
  assert.doesNotMatch(applySection, /await refresh\(\)/);
});

test("GM Preview exposes exact Political Actor operations instead of hiding PWv2 mutations", () => {
  assert.match(source, /eventOps\("politicalActorOps"\)/);
  assert.match(source, /countChip\("politics"/);
  assert.match(source, /data-gm-political-actor-ops="true"/);
  assert.match(source, /Political Actor \/ PWv2/);
});


test("GM Preview exposes canonical Puppet operations instead of hiding world.puppets mutations", () => {
  assert.match(source, /const puppetUpdates = Array\.isArray\(transaction\?\.puppetUpdates\)/);
  assert.match(source, /countChip\("subordinations", puppetUpdates\.length\)/);
  assert.match(source, /data-gm-puppet-updates="true"/);
  assert.match(source, /subsectionTitle\("Subordinations", puppetUpdates\.length, "world\.puppets"\)/);
  assert.match(source, /entry\.overlord.*entry\.puppet/s);
  assert.match(source, /Loyalty:/);
});
