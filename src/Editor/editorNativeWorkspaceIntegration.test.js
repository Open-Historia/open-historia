import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOOL_GROUPS, TOOLS } from "./editorToolCatalog.js";
import { EDITOR_WORKSPACES, EDITOR_PANEL_IDS, workspaceOfPanel } from "./editorWorkspaces.js";
import { COUNTRY_DETAIL_TABS } from "./countryDetailTabs.js";
const src = name => readFileSync(new URL(name, import.meta.url), "utf8");

test("all original native map tools remain, plus the new rectangle marquee for regions", () => {
  assert.equal(TOOLS.length, 18);
  assert.equal(TOOL_GROUPS.length, 5);
  const ids=TOOLS.map(x=>x.id);
  assert.equal(new Set(ids).size,ids.length);
  for (const existing of [
    "select","lasso","pan","draw","modify","border","move","delete","dissolve","paint",
    "feature","marker","unit","feature-box","terrain","fortification","climate",
  ]) assert.ok(ids.includes(existing), "Lost original native tool: " + existing);
  assert.ok(ids.includes("region-box"));
  assert.equal(new Set(TOOLS.map(x=>x.hotkey)).size, 18);
  const dock=src("./EditorToolDock.jsx");
  const sidebar=src("./EditorSidebar.jsx");
  const map=src("./MapEditor.jsx");
  assert.match(dock,/TOOL_GROUPS\.map\(/);
  assert.match(dock,/onToolChange\(tool\.id\)/);
  assert.match(dock,/aria-keyshortcuts=\{tool\.hotkey\}/);
  assert.match(dock,/\{tool\.hotkey\}<\/span>/);
  assert.match(src("./OlMap.jsx"), /toolForHotkey\(e/);
  assert.match(src("./OlMap.jsx"), /onToolShortcutRef\.current\(toolShortcut\)/);
  assert.match(src("./MapEditor.jsx"), /onToolShortcut=\{d\.setActiveTool\}/);
  assert.match(dock,/onUndo/);
  assert.match(dock,/onRedo/);
  assert.match(dock,/onFit/);
  assert.match(sidebar,/isMobile && TOOL_GROUPS\.map/,"mobile must keep access to the icon tools");
  assert.match(map,/<EditorToolDock/);
  assert.match(map,/onToolChange=\{d\.setActiveTool\}/);
  assert.match(map,/onUndo=\{\(\) => api\?\.undo\(\)\}/);
  assert.match(map,/onRedo=\{\(\) => api\?\.redo\(\)\}/);
});

test("every previous native panel remains discoverable from the new task navigation", () => {
  const sections=["overview","countries","territory","places","groups","war","appearance","import","review"];
  assert.deepEqual(EDITOR_WORKSPACES.map(x=>x.id),sections);
  for(const id of EDITOR_PANEL_IDS){
    const nav=EDITOR_WORKSPACES.filter(w=>w.items.some(item=>item.id===id));
    assert.ok(nav.length>=1, "Native panel missing from navigation: "+id);
    assert.ok(workspaceOfPanel(id), "Cannot resolve panel for "+id);
  }
  assert.equal(EDITOR_WORKSPACES.find(w=>w.id==="countries")?.panel,"polities");
  assert.equal(EDITOR_WORKSPACES.find(w=>w.id==="war")?.panel,"war");
  assert.equal(EDITOR_WORKSPACES.find(w=>w.id==="import")?.panel,"province-import");
  assert.ok(EDITOR_WORKSPACES.some(w=>w.items.some(i=>i.id==="generator" && i.action==="generator")));
  const nav=src("./EditorWorkspaceNav.jsx");
  assert.match(nav,/onSetPanel\?\.\(id\)/);
  assert.match(nav,/onOpenBasemaps\?\.\(\)/);
  assert.match(nav,/onOpenGenerator\?\.\(\)/);
  const map=src("./MapEditor.jsx");
  for(const panel of EDITOR_PANEL_IDS){
    assert.match(map, new RegExp('openPanel === "'+panel+'"'), "Original native panel lost: "+panel);
  }
  assert.match(map,/onSetPanel=\{setOpenPanel\}/);
  assert.match(map,/onOpenBasemaps=\{\(\) => setBasemapPickerOpen\(true\)\}/);
  assert.match(map,/onOpenGenerator=\{\(\) => setFmgOpen\(true\)\}/);
});

test("Country Details are organized without swapping any existing native mutation handlers", () => {
  assert.deepEqual(COUNTRY_DETAIL_TABS.map(x=>x.id),
    ["overview","names","territory","governance","relations","appearance","manage"]);
  const countries=src("./PolitiesPanel.jsx");
  assert.match(countries,/<CountryDetailsNavigation/);
  for(const tab of COUNTRY_DETAIL_TABS.filter(x=>x.id!=="overview")){
    assert.match(countries, new RegExp('detailsTab === "'+tab.id+'"'));
  }
  for(const fn of [
    "renamePolity","upsertPolity","assignSelection","transferAll","onPaintPolity",
    "setColorOverride","onOpenFlagPicker","setTags","setPuppets",
    "MilitaryFields","removeFromMap","readRosterFile","applyRoster","createPolity"
  ]) assert.ok(countries.includes(fn),"Country editing control lost: "+fn);
  assert.match(countries,/setCountryListOpen\(false\)/);
  assert.match(countries,/countryListOpen \?/);
});

test("the native Map Editor save whitelist includes baseline and pending diplomatic edits", () => {
  const map = src("./MapEditor.jsx");
  assert.match(map, /relations:\s*d\.relations,/);
  assert.match(map, /relationEdits:\s*d\.relationEdits,/);
});

test("the real Apply & Play still calls the native game bridge and now uses theme colors", () => {
  const map=src("./MapEditor.jsx");
  assert.match(map,/background: primary \? "var\(--oh-ui-accent, #2bc1f3\)"/);
  assert.match(map,/border: primary \? "1px solid var\(--oh-ui-accent, #2bc1f3\)"/);
  assert.match(map,/color: primary \? "var\(--oh-ui-bg, #fff\)"/);
  assert.match(map,/onClick=\{\(\) => persistScenario\(\{ play: true \}\)\}/);
  assert.match(map,/onClick=\{\(\) => persistScenario\(\{ play: false, closeAfter: false \}\)\}/);
  assert.match(src("./EditorSidebar.jsx"),/Working map saved/);
  assert.match(src("./EditorWorkspaceNav.jsx"),/working map and the playable scenario are saved separately/i);
});
