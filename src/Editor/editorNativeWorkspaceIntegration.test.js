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
  assert.equal(EDITOR_WORKSPACES.find(w=>w.id==="appearance")?.panel,"layers",
    "opening Maps & appearance must show native layers, not block the workspace behind the basemap modal");
  assert.equal(EDITOR_WORKSPACES.find(w=>w.id==="import")?.panel,"province-import");
  assert.equal(workspaceOfPanel("clipboard")?.id, "territory",
    "default panel routing remains backward compatible");
  assert.equal(workspaceOfPanel("clipboard", "import")?.id, "import",
    "a shared panel must remain in the workspace from which the user opened it");
  assert.equal(workspaceOfPanel("clipboard", "territory")?.id, "territory");
  assert.ok(EDITOR_WORKSPACES.some(w=>w.items.some(i=>i.id==="generator" && i.action==="generator")));
  const nav=src("./EditorWorkspaceNav.jsx");
  assert.match(nav,/onSetPanel\?\.\(id\)/);
  assert.match(nav, /if \(id != null\) onAfterNavigate\?\.\(\)/,
    "sidebar-only Overview and Review must remain accessible on mobile");
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

test("Region Types use the native region-change epoch and never delete referenced type IDs", () => {
  const map = src("./MapEditor.jsx");
  const manager = src("./TypeManager.jsx");
  assert.match(map, /\[api, d\.types, d\.selection, d\.regionCount, regionEpoch\]/);
  assert.match(manager, /regionTypeDeletionReason\(types, usage, t\.id\)/);
  assert.match(manager, /canCreateRegionType\(types\)/);
  assert.match(manager, /<WorkspaceTabs/);
});

test("clipboard metadata participates in the same native region-paste Undo command", () => {
  const map = src("./MapEditor.jsx");
  const method = map.slice(map.indexOf("  const pasteClipboard = () => {"), map.indexOf("  const clipboardKeysRef ="));
  const nativeMap = src("./OlMap.jsx");
  assert.match(method, /documentStep: clipboardMetadataStep\(plan, d\.doc, d\.setDoc, d\.setSaveStatus\)/);
  assert.match(method, /if \(!result\?\.added\?\.length\)/);
  assert.match(method, /MAX_REGION_TYPES/);
  assert.match(method, /window\.confirm/);
  assert.match(nativeMap, /documentStep\?\.redo\(\);/);
  assert.match(nativeMap, /documentStep\?\.undo\(\);/);
  const pasteBlock = nativeMap.slice(nativeMap.indexOf("      pasteRegions: ("), nativeMap.indexOf("      applyRegionPatch: ("));
  assert.ok(pasteBlock.indexOf("documentStep?.redo()") < pasteBlock.indexOf("pushCmd({"), "metadata commits before the same history entry");
  assert.ok(pasteBlock.indexOf("if (!pasted.length) return") < pasteBlock.indexOf("documentStep?.redo()"), "empty paste cannot import metadata");
});

test("Review & Save routes buttons to the native save and apply actions", () => {
  const map = src("./MapEditor.jsx");
  const sidebar = src("./EditorSidebar.jsx");
  const nav = src("./EditorWorkspaceNav.jsx");
  assert.match(map, /onReviewSave=\{scenarioMode \? \(\) => persistScenario/);
  assert.match(map, /onReviewPlay=\{scenarioMode \? \(\) => persistScenario/);
  assert.match(sidebar, /onReviewSave=\{onReviewSave\}/);
  assert.match(sidebar, /onReviewPlay=\{onReviewPlay\}/);
  assert.match(nav, /onClick=\{onReviewSave\}/);
  assert.match(nav, /onClick=\{onReviewPlay\}/);
  assert.match(nav, /reviewBusy \|\| !onReviewSave/);
});

test("native geometry operations restore the pre-edit export flag through one tested contract", () => {
  const map = src("./OlMap.jsx");
  assert.match(map, /import \{ restoreCarvedEdited \} from "\.\/regionCarveHistory\.js"/);
  assert.match(map, /restoreCarvedEdited\(c\.feature, c\.edited\)/,
    "new region drawing restores flags on carved neighbours");
  assert.match(map, /restoreCarvedEdited\(entry\.feature, entry\.edited\)/,
    "clipboard paste restores the pre-existing region export flag");
  assert.match(map, /restoreCarvedEdited\(existing, before\.edited\)/,
    "suggestion patch restores previously unset/false export flags");
  assert.equal((map.match(/restoreCarvedEdited\(change\.feature, change\.edited\)/g) || []).length, 2,
    "simplification and contour edits must both restore unset/false flags");
});
test("world geography starter presets are undoable without a second map history", () => {
  const map = src("./MapEditor.jsx");
  assert.match(map, /const replaceWarPreset = \(kind, replacement\) =>/);
  assert.match(map, /replaceRowsStep\(warListOf\(kind\), warSetters\[kind\], replacement\)/);
  assert.match(map, /api\.pushStep\(step\)/);
  assert.match(map, /onReplacePreset=\{replaceWarPreset\}/);
  const war = src("./WarMapPanel.jsx");
  assert.match(war, /onReplacePreset\?\.\(tab,/);
});

test("Polity presentation terminology does not rename canonical country IDs or draft contracts", () => {
  const panel = src("./PolitiesPanel.jsx");
  const form = src("./CountryCreationForm.jsx");
  const nav = src("./EditorWorkspaceNav.jsx");
  assert.match(panel, /<Panel title="Polities"/);
  assert.match(panel, /Create polity/);
  assert.match(form, /<Panel title="Create a polity"/);
  assert.match(form, /Polity setup sections/);
  assert.match(form, /Set polity relationships and territory/);
  assert.match(nav, /\{polityCount\} polities/);
  assert.match(panel, /<CountryCreationForm/);
  assert.match(form, /planCountryDraft\(\{ draft, polities, occupiedKeys, puppets, polityChoices \}\)/);
  assert.match(src("./editorWorkspaces.js"), /panel: "polities"/);
});

test("temporary OSM street reference is controlled by the editor session, never document persistence", () => {
  const map = src("./MapEditor.jsx");
  const native = src("./OlMap.jsx");
  const layers = src("./LayersPanel.jsx");
  assert.match(map, /const \[streetReference, setStreetReference\] = useState\(false\)/);
  assert.match(map, /streetReference=\{streetReference\}/);
  assert.match(map, /onStreetReferenceChange=\{setStreetReference\}/);
  assert.match(native, /streetReferenceActive\(\{ enabled: streetReference, online, background: customBackground \}\)/);
  assert.match(native, /source: new OSM\(\)/);
  assert.match(native, /\[basemap, customBackground, online, streetReference\]/);
  assert.match(layers, /aria-label="Show OpenStreetMap street reference"/);
  assert.match(layers, /disabled=\{hasCustomBackground\}/);
  assert.doesNotMatch(map, /patchMetadata\(\{ streetReference/);
});
