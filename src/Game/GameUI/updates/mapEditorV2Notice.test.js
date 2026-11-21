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
  const newerId = "2026-11-interactive-event-history";
  assert.deepEqual(due.map(entry=>entry.id),[newerId,UPDATE_ID,"2026-11-project-currency-clarity","2026-11-gm-one-change"]);
  assert.deepEqual(noticePages(due).slice(0,7).map(page=>page.update.id),[...Array(4).fill(newerId),...Array(3).fill(UPDATE_ID)],"both staged major notices appear before the minor upstream notices");
  assert.deepEqual(pendingUpdates({seen:UPDATE_ID,keeps:true}).map(entry=>entry.id),[newerId]);
  assert.deepEqual(pendingUpdates({seen:newerId,keeps:true}),[]);
  assert.equal(previewedUpdates("?updateNotice="+UPDATE_ID)[0].id,UPDATE_ID);
  assert.equal(previewedUpdates("?updateNotice=latest")[0].id,newerId);
});


test("archive illustration stays within its own card instead of scaling the full editor atlas across the next one",()=>{
  const source=readFileSync(new URL("./themes/MapEditorV2.jsx",import.meta.url),"utf8");
  assert.match(source,/const ArchiveMap = \(\{ newWorld \}\)/);
  assert.match(source,/<ArchiveMap newWorld=\{newWorld\}\/>/);
  assert.doesNotMatch(source,/translate\(21 51\) scale\(0\.525\)/);
});

test("integrated Beta notice covers every campaign and authoring workstream",()=>{
  const id="2026-11-interactive-event-history";
  const entry=NOTICE_UPDATES.find(item=>item.id===id);
  assert.equal(UPDATES.filter(item=>item.id===id).length,1);
  assert.equal(entry.kind,"major");
  assert.equal(entry.channel,"beta");
  assert.deepEqual(entry.banners.map(b=>b.scene),["history","speech","finance","scenario"]);
  assert.ok(entry.banners.every(b=>b.theme==="campaignRecords"&&b.lead&&b.sections.length>=2));
  const lines=[...entry.banners,...UPDATES.find(item=>item.id===UPDATE_ID).banners].flatMap(b=>b.sections.flatMap(s=>s.items)).join("\n");
  for(const phrase of ["Campaign Lore","Markdown or JSON","interactive scene transcripts","domestic minister","Rostra","disbursements","arrears","human-controlled","capital relocations","256 Day-one facts","diplomatic scores and descriptions","selected interface theme","simulation rules","polity names","non-interactable territory","Discord Rich Presence","Scissors","Z1 to Z24","OpenStreetMap","Hand to pan","undo or redo the whole paste"])assert.ok(lines.includes(phrase),phrase);
  assert.equal(previewedUpdates("?updateNotice="+id)[0].id,id);
});
