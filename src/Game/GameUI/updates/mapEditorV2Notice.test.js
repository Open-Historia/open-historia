import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { NOTICE_UPDATES, UPDATES } from "./notes.js";
import { noticePages, pendingUpdates, previewedUpdates } from "./updateNotices.js";

const UPDATE_ID = "2026-11-map-editor-v2";

test("Map Editor V2 has exactly one newly dated major Beta notice, with three themed pages",()=>{
  const entries = UPDATES.filter((entry)=>entry.id===UPDATE_ID);
  assert.equal(entries.length,1);
  const update=entries[0];
  assert.equal(update.kind,"major");
  assert.equal(update.channel,"beta");
  assert.equal(update.date,"2026-11-21");
  assert.equal(update.banners.length,3);
  assert.deepEqual(update.banners.map(b=>b.scene),["draft","polities","publish"]);
  assert.ok(update.banners.every(b=>b.theme==="mapEditorV2" && b.title && b.lead && b.sections.length>=2));
  assert.equal(NOTICE_UPDATES.filter(entry=>entry.id===UPDATE_ID).length,1);
  assert.deepEqual(noticePages([update]).map(({key})=>key),[0,1,2].map(i=>UPDATE_ID+"#"+i));
});
test("a returning beta player sees Map Editor V2 at login, but a previous dismissal and preview keep the established contracts",()=>{
  const previous=NOTICE_UPDATES.find(entry=>entry.id==="2026-11-shared-game-replies");
  assert.ok(previous,"keep historical notices");
  const due=pendingUpdates({seen:previous.id,keeps:true});
  assert.equal(due[0].id,UPDATE_ID);
  assert.deepEqual(pendingUpdates({seen:UPDATE_ID,keeps:true}),[]);
  assert.equal(previewedUpdates("?updateNotice="+UPDATE_ID)[0].id,UPDATE_ID);
  assert.equal(previewedUpdates("?updateNotice=latest")[0].id,UPDATE_ID);
});


test("archive illustration stays within its own card instead of scaling the full editor atlas across the next one",()=>{
  const source=readFileSync(new URL("./themes/MapEditorV2.jsx",import.meta.url),"utf8");
  assert.match(source,/const ArchiveMap = \(\{ newWorld \}\)/);
  assert.match(source,/<ArchiveMap newWorld=\{newWorld\}\/>/);
  assert.doesNotMatch(source,/translate\(21 51\) scale\(0\.525\)/);
});
