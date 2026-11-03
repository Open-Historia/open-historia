import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STAT_DASHBOARD_WIDGETS, DEFAULT_NATIONAL_DASHBOARD, nationalDashboardForDisplay, shouldShowStandaloneMilitaryCard, isRequiredMilitaryWidget, dashboardColumnsForWidth, normalizeStatsDashboard, projectDashboardGrid, snapDashboardWidgetSize, updateDashboardWidget, duplicateDashboardWidget, insertDashboardWidget, placeDashboardWidget } from './statsDashboardLayout.js';
import { NATIONAL_NATIVE_METRICS, normalizeStatSheetDefinition, serializeStatSheet } from './statIndexDefinitions.js';
const sources = new Set([...Object.keys(NATIONAL_NATIVE_METRICS).map(key=>`native:${key}`), 'custom:timber']);
const normalize = (dashboard) => normalizeStatsDashboard(dashboard, { allowedSources: sources });
test('Country Details military fallback supports absent legacy dashboard without duplicate native card', () => {
 const standard = nationalDashboardForDisplay({ custom: false, sections: [] });
 const legacyCustom = nationalDashboardForDisplay({ custom: true, sections: [] });
 assert.equal(shouldShowStandaloneMilitaryCard(legacyCustom, 'overview'), true);
 assert.equal(shouldShowStandaloneMilitaryCard(legacyCustom, 'details'), true);
 assert.equal(shouldShowStandaloneMilitaryCard(standard, 'overview'), false);
 assert.equal(shouldShowStandaloneMilitaryCard(standard, 'details'), false,
   'native Details dashboard owns its military card');
 const noMilitary = normalize({version:1, widgets:[]});
 assert.equal(shouldShowStandaloneMilitaryCard(noMilitary, 'overview'), false);
 assert.equal(shouldShowStandaloneMilitaryCard(noMilitary, 'details'), true,
   'a custom Details dashboard without a military card keeps the native fallback');
 const overviewMilitary = {version:1, widgets:[
   {id:'overview-military',source:'system:military',page:'overview',style:'military',x:0,y:0,w:6,h:6}]};
 assert.equal(shouldShowStandaloneMilitaryCard(normalize(overviewMilitary), 'details'), true);
});

test('Wars & Fronts military is a mandatory native system module, with a legacy display fallback', () => {
 const standard = normalize(DEFAULT_NATIONAL_DASHBOARD);
 const module = standard.widgets.find(widget => widget.style === 'military');
 assert.equal(isRequiredMilitaryWidget(module), true);
 assert.equal(isRequiredMilitaryWidget({ ...module, style: 'value' }), false);
 assert.equal(isRequiredMilitaryWidget({ ...module, source: 'native:militaryPower' }), false);
 assert.equal(shouldShowStandaloneMilitaryCard(standard, 'details'), false);
 const oldCustom = normalize({ version: 1, widgets: [
  { id: 'metric', source: 'custom:timber', style: 'value', page: 'details', x: 0, y: 0, w: 2, h: 1 },
 ] });
 assert.equal(shouldShowStandaloneMilitaryCard(oldCustom, 'details'), true,
  'older authored layouts may omit the widget, but the player must still receive native Military');
 const moved = normalize({ version: 1, widgets: [
  { ...module, page: 'overview', y: 0 },
 ] });
 assert.equal(shouldShowStandaloneMilitaryCard(moved, 'details'), true,
  'a military visualization on Overview may not hide the mandatory Details view');
 assert.equal(shouldShowStandaloneMilitaryCard(moved, 'overview'), false);
 assert.equal(shouldShowStandaloneMilitaryCard(null, 'details'), true);
});

test('mandatory military cannot be duplicated, pasted, or moved to Overview through native layout helpers', () => {
 const before = normalize(DEFAULT_NATIONAL_DASHBOARD);
 const military = before.widgets.find(isRequiredMilitaryWidget);
 const snapshot = structuredClone(before);
 assert.equal(duplicateDashboardWidget(before, military.id), null);
 assert.equal(insertDashboardWidget(before, military), null);
 assert.equal(insertDashboardWidget(before, military, 'overview'), null);
 assert.equal(updateDashboardWidget(before, military.id, { page: 'overview' }), null);
 assert.equal(placeDashboardWidget(before, military.id, { page: 'overview', y: 0 }), null);
 const placed = placeDashboardWidget(before, military.id, { y: 24 });
 assert.ok(placed, 'position changes on Details remain permitted');
 assert.equal(placed.widgets.find(isRequiredMilitaryWidget).page, 'details');
 assert.deepEqual(before, snapshot, 'failed mutations must not change the source layout');
 const legacyOverview = normalize({ version: 1, widgets: [
  { ...military, page: 'overview', x: 0, y: 0 },
 ] });
 assert.equal(legacyOverview.widgets[0].page, 'overview', 'pre-existing authored layouts remain valid');
 assert.equal(shouldShowStandaloneMilitaryCard(legacyOverview, 'details'), true);
 const legacyMove = updateDashboardWidget(legacyOverview, military.id, { y: 2 });
 assert.equal(legacyMove?.widgets[0].y, 2,
  'editing the position of a pre-existing Overview card must remain supported without forcing migration');
});

test('native GDP can have several views but one canonical source identity', () => {
 const duplicated = {version:1, widgets:[{...DEFAULT_NATIONAL_DASHBOARD.widgets[0]},
  {id:'gdp-copy',source:'native:gdp',style:'value',page:'overview',x:0,y:3,w:3,h:1}]};
 assert.equal(normalize(duplicated).widgets.filter((widget)=>widget.source==='native:gdp').length,2);
});
test('grid rejects unknown metric references, overlaps, duplicate IDs and invalid dimensions', () => {
 const valid = structuredClone(DEFAULT_NATIONAL_DASHBOARD);
 assert.equal(normalize(valid).widgets.length,31);
 for (const patch of [{source:'custom:gdp'}, {x:5}, {w:7}, {y:-1}, {id:'population'}, {style:'bogus'}]) {
  const bad=structuredClone(valid); Object.assign(bad.widgets[0],patch);
  assert.throws(()=>normalize(bad));
 }
 const bad=structuredClone(valid);bad.widgets.push({...bad.widgets[0],id:'overlap'});
 assert.throws(()=>normalize(bad));
});
test('move/resize is atomic, collisions fail, and the original dashboard remains unchanged', () => {
 const source=normalize(DEFAULT_NATIONAL_DASHBOARD);
 assert.equal(updateDashboardWidget(source,'population',{x:1}),null);
 const moved=updateDashboardWidget(source,'population',{x:0,y:9,w:3});
 assert.equal(moved.widgets[1].w,3);
 assert.equal(source.widgets[1].w,2);
});
test('responsive reflow is deterministic and never overlaps at two columns',()=>{
 const baseline=normalize(DEFAULT_NATIONAL_DASHBOARD);
 const a=projectDashboardGrid(baseline.widgets,2),b=projectDashboardGrid(baseline.widgets,2);
 assert.deepEqual(a,b);
 assert.equal(a[0].w,2);
 for(const [i,item] of a.entries()) for(const other of a.slice(i+1))
   assert.ok(item.y+item.h<=other.y || other.y+other.h<=item.y || item.x+item.w<=other.x || other.x+other.w<=item.x);
 assert.equal(projectDashboardGrid(baseline.widgets,6,'details').length,21);
});

test('drag resizing snaps to supported footprints without changing existing saved sizes',()=>{
 const item={id:'w',source:'native:gdp',style:'trend',page:'overview',x:0,y:0,w:3,h:2};
 assert.deepEqual(snapDashboardWidgetSize(item,1,0),{w:6,h:2});
 assert.deepEqual(snapDashboardWidgetSize(item,0,1),{w:3,h:3});
 assert.deepEqual(snapDashboardWidgetSize(item,-1,-1),{w:3,h:2});
 const old={...item,w:4,h:2};
 assert.deepEqual(snapDashboardWidgetSize(old,1,0),{w:6,h:2});
 assert.equal(old.w,4);
 const result=normalize({version:1,widgets:[old]});
 assert.equal(result.widgets[0].w,4,'existing arbitrary P4A sizing remains readable');
});


test('classic 345px panel retains a three-card strip and ordered full-width condition rows', () => {
 const widgets = normalize(DEFAULT_NATIONAL_DASHBOARD).widgets;
 const narrow = projectDashboardGrid(widgets, 6);
 const row = narrow.filter(w => w.y === 2);
 assert.deepEqual(row.map(w => [w.id,w.x,w.w]), [['population',0,2], ['employment',2,2], ['debt',4,2]]);
 assert.equal(narrow.find(w => w.style === 'heading').label, 'National condition');
 assert.deepEqual(narrow.filter(w => w.style === 'bar').map(w => w.y), [4,5,6,7]);
 assert.equal(narrow.find(w => w.style === 'change').y,8);
});
test('section headers are presentation-only, full-width and have validated bounded labels', () => {
 const valid = normalize(DEFAULT_NATIONAL_DASHBOARD);
 const row = valid.widgets.find(w => w.style === 'heading');
 assert.equal(row.source,'');
 for (const patch of [{source:'native:gdp'}, {label:''}, {label:' '.repeat(3)}, {w:3}, {h:2}]) {
  const bad = structuredClone(valid); Object.assign(bad.widgets.find(w => w.id === row.id),patch);
  assert.throws(() => normalize(bad));
 }
 const bad = structuredClone(valid);
 bad.widgets.find(w => w.id === 'change-summary').w=3;
 assert.throws(() => normalize(bad));
});

test('country-width panel preserves a six-column metric strip until genuinely narrow',()=>{
 assert.equal(dashboardColumnsForWidth(345),6);
 assert.equal(dashboardColumnsForWidth(300),6);
 assert.equal(dashboardColumnsForWidth(299),3);
 assert.equal(dashboardColumnsForWidth(209),2);
});

test('card accent is validated presentation metadata and never adds numerical state', () => {
 const definition = normalize(DEFAULT_NATIONAL_DASHBOARD);
 const changed = updateDashboardWidget(definition,'gross-output',{accent:'blue'});
 assert.equal(normalize(changed).widgets[0].accent,'blue');
 assert.equal(changed.widgets[0].source,'native:gdp');
 assert.equal(changed.widgets[0].value,undefined);
 assert.equal(updateDashboardWidget(changed,'gross-output',{accent:'url(javascript:bad)'}),null);
 const bad=structuredClone(definition);
 bad.widgets[0].accent='rgb(0,0,0)';
 assert.throws(()=>normalize(bad),/accent/);
});

test('copying GDP creates another visual card at a non-overlapping position, never another GDP ledger',()=>{
 const original=normalize(DEFAULT_NATIONAL_DASHBOARD);
 const copy=duplicateDashboardWidget(original,'gross-output');
 assert.ok(copy);
 assert.notEqual(copy.id,'gross-output');
 assert.equal(copy.dashboard.widgets.at(-1).source,'native:gdp');
 assert.equal(copy.dashboard.widgets.at(-1).value,undefined);
 assert.equal(normalize(copy.dashboard).widgets.length,original.widgets.length+1);
 assert.equal(original.widgets.length,31);
});

test('cut/paste of display metadata works without retaining the original widget, and full grid fails closed',()=>{
 const before=normalize(DEFAULT_NATIONAL_DASHBOARD);
 const template=before.widgets.find(w=>w.id==='population');
 const cut={...before,widgets:before.widgets.filter(w=>w.id!==template.id)};
 const paste=insertDashboardWidget(cut,template,'details');
 assert.ok(paste);
 assert.equal(paste.dashboard.widgets.at(-1).source,template.source);
 assert.equal(paste.dashboard.widgets.at(-1).page,'details');
 assert.ok(normalize(paste.dashboard));
 assert.equal(insertDashboardWidget({...before,widgets:Array.from({length:MAX_STAT_DASHBOARD_WIDGETS},(_,i)=>({...template,id:`a${i}`,page:'details'}))},template),null);
});

test('dragging onto one matching-size card swaps them atomically without affecting other slots',()=>{
 const baseline=normalize(DEFAULT_NATIONAL_DASHBOARD);
 const swapped=placeDashboardWidget(baseline,'population',{x:2,y:2});
 assert.ok(swapped);
 assert.deepEqual(swapped.widgets.find(w=>w.id==='population'),{...baseline.widgets[1],x:2});
 assert.equal(swapped.widgets.find(w=>w.id==='employment').x,0);
 assert.equal(baseline.widgets.find(w=>w.id==='population').x,0);
 assert.equal(normalize(swapped).widgets.length,31);
 assert.equal(placeDashboardWidget(baseline,'population',{x:4,y:3}),null,'do not displace unlike footprints');
});


test('classic Details covers every registered national metric and the three authoritative system views', () => {
 const dashboard = normalize(DEFAULT_NATIONAL_DASHBOARD);
 const details = dashboard.widgets.filter(w=>w.page==='details');
 assert.equal(details.length,21);
 const sourcesInPreset = new Set(dashboard.widgets.map(w=>w.source));
 for(const key of Object.keys(NATIONAL_NATIVE_METRICS))
   assert.ok(sourcesInPreset.has(`native:${key}`),`native metric omitted: ${key}`);
 for(const [style,source] of [['intelligence','system:intelligence'],['breakdown','system:gdpBreakdown'],['military','system:military']]) {
   const card = details.find(w=>w.style===style);
   assert.equal(card?.source,source);
   assert.equal(card.w,6);
 }
 assert.deepEqual(details.map(w=>w.id).slice(-2),['d-breakdown','d-military']);
 assert.equal(dashboard.widgets.length,31);
 assert.ok(MAX_STAT_DASHBOARD_WIDGETS > dashboard.widgets.length,'preset must leave room to customize');
});

test('system cards have exact approved sources and sizes; no fake native military ledger',()=>{
 const baseline = normalize(DEFAULT_NATIONAL_DASHBOARD);
 const military = baseline.widgets.find(w=>w.id==='d-military');
 assert.equal(military.source,'system:military');
 for(const patch of [{source:'native:militaryPower'},{source:'native:gdp'},{w:3},{h:4},{h:7}]) {
   const altered=structuredClone(baseline);Object.assign(altered.widgets.find(w=>w.id==='d-military'),patch);
   assert.throws(()=>normalize(altered));
   assert.equal(updateDashboardWidget(baseline,'d-military',patch),null);
 }
 assert.equal(updateDashboardWidget(baseline,'d-military',{y:19}).widgets.find(w=>w.id==='d-military').y,19);
 for (const style of ['intelligence','breakdown']) {
   const w=baseline.widgets.find(w=>w.style===style);
   const corrupt=structuredClone(baseline);corrupt.widgets.find(row=>row.id===w.id).source='custom:timber';
   assert.throws(()=>normalize(corrupt));
 }
});

test('comprehensive Details preset round-trips through ordinary standard sheet',()=>{
 const standard={custom:false,version:2,sections:[],dashboard:structuredClone(DEFAULT_NATIONAL_DASHBOARD)};
 const read=normalizeStatSheetDefinition(standard);
 assert.equal(read.custom,false);
 assert.equal(read.dashboard.widgets.length,31);
 const saved=serializeStatSheet(read);
 assert.equal(saved.dashboard.widgets.length,31);
 assert.equal(saved.dashboard.widgets.find(w=>w.style==='military').source,'system:military');
 assert.equal(saved.custom,false);
});

test('bounded expanded authoring supports 48 widgets but rejects the 49th',()=>{
 const widgets=[];
 for(let i=0;i<MAX_STAT_DASHBOARD_WIDGETS;i++)
   widgets.push({id:`card${i}`,source:'native:gdp',style:'value',page:'details',x:i%6,y:Math.floor(i/6),w:1,h:1});
 assert.equal(normalize({version:1,widgets}).widgets.length,MAX_STAT_DASHBOARD_WIDGETS);
 assert.throws(()=>normalize({version:1,widgets:[...widgets,{...widgets[0],id:'card49',y:30}]}));
});

test('standard national sheets display the modern preset without an authored stats asset', () => {
 const standard = normalizeStatSheetDefinition(null);
 assert.equal(standard.custom, false);
 assert.equal(standard.dashboard, undefined, 'default presentation must not become a saved authoring change');
 assert.equal(nationalDashboardForDisplay(standard), DEFAULT_NATIONAL_DASHBOARD);
 assert.equal(nationalDashboardForDisplay({ custom: false, sections: [] }), DEFAULT_NATIONAL_DASHBOARD);
 assert.equal(serializeStatSheet(standard).dashboard, undefined, 'no implicit scenario asset required');
 const authored = normalizeStatSheetDefinition({ custom: false, sections: [], dashboard: { version: 1, widgets: [
  { id: 'myGDP', source: 'native:gdp', style: 'value', page: 'overview', x: 0, y: 0, w: 2, h: 1 },
 ] } });
 assert.equal(nationalDashboardForDisplay(authored), authored.dashboard, 'author override wins');
 assert.equal(nationalDashboardForDisplay(normalizeStatSheetDefinition({ custom: true, sections: [
  { label: 'Resources', stats: [{ key: 'grain', label: 'Grain', kind: 'number' }] },
 ] })), null, 'independent custom sheet keeps its own legacy presentation');
});
