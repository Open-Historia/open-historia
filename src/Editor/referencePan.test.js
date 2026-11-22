import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=f=>readFileSync(new URL(f,import.meta.url),"utf8");
test("Hand mode suspends reference move and resize handlers without resetting the session extent",()=>{
 const source=read("./OlMap.jsx");
 const start=source.indexOf("const referencePan = activeTool");
 assert.ok(start>=0);
 const effect=source.slice(start);
 assert.match(effect,/const referencePan = activeTool === "pan"/);
 assert.match(effect,/const canAdjust = !locked && !referencePan/);
 assert.match(effect,/if \(!canAdjust\) return;\s*for \(const corner/);
 assert.match(effect,/if \(!extent \|\| !canAdjust \|\| activeToolRef\.current === "pan"\) return null/);
 assert.match(effect,/if \(!drag \|\| !extent \|\| activeToolRef\.current === "pan"\) return/);
 assert.match(effect,/if \(canAdjust\) map\.addInteraction\(interaction\)/);
 assert.match(effect,/if \(canAdjust\) map\.removeInteraction\(interaction\)/);
 assert.match(effect,/if \(canAdjust\) map\.on\("pointermove", showCursor\)/);
 assert.match(effect,/\[referenceAdjust, referenceImage\?\.dataUrl, referenceImage\?\.locked, referencePan\]/);
 const placement=source.slice(source.indexOf("// Reference image:"),start);
 assert.doesNotMatch(placement,/referencePlaceNonce\s*,\s*referencePan/);
});
test("reference panel explains navigation override using the actual active tool",()=>{
 assert.match(read("./MapEditor.jsx"),/<ReferencePanel\s+activeTool=\{d.activeTool\}/);
 assert.match(read("./ReferencePanel.jsx"),/activeTool === "pan"\s*\? "Hand tool: dragging pans the map/);
});
