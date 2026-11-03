/*! Open Historia - source-wiring regression for scenario-driven Statistics dashboard.
 * Browser behavior and the complete npm suite must still be verified on Windows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(path)=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
test('Scenario Editor authoring owns layout, save/upload and opt-in standard-sheet persistence',()=>{
 const editor=read('./libraryBar.jsx');
 assert.match(editor,/StatsDashboardEditor value=\{statsValue\} onChange=\{onStatsChange\}/);
 assert.match(editor,/editorStats\.custom \|\| editorStats\.dashboard/);
 assert.match(editor,/JSON\.stringify\(serializeStatSheet\(definition\)/);
 assert.match(editor,/adoptSavedStats\(normalizeStatsEditorValue\(definition\)\)/);
});
test('player and editor use one presentation renderer without writing numeric Stats',()=>{
 const player=read('./stats.jsx');const editor=read('./StatsDashboardEditor.jsx');
 assert.match(player,/StatsDashboard dashboard=\{visibleNationalDashboard\}/);
 assert.match(player,/const visibleNationalDashboard = nationalDashboardForDisplay\(statSheetDefinition\);/);
 assert.match(editor,/const dashboard = nationalDashboardForDisplay\(definition\);/);
 assert.match(player,/history=\{worldSnapshot\?\.countryStatsHistory/);
 assert.match(player,/MilitaryCard world=\{worldSnapshot\}/);
 assert.match(editor,/import StatsDashboard, \{ DashboardMilitaryPreview, canShowDashboardBar, dashboardMetricFor \} from '\.\/StatsDashboard\.jsx'/);
 assert.match(editor,/onResizeStart=\{\(event, widget, edge\) => start\(event, widget, edge\)\}/);
 assert.doesNotMatch(read('./StatsDashboard.jsx'),/writeWorldState|generateCountryStatSheet/);
});

test('authoring uses one live panel renderer, explicit sample history and edge snapping',()=>{
 const editor=read('./StatsDashboardEditor.jsx');
 const renderer=read('./StatsDashboard.jsx');
 assert.match(editor,/aria-label="Player panel preview"/);
 assert.match(editor,/history=\{sampleHistory\} page=\{page\}/);
 assert.match(renderer,/className=\{`oh-dashboard-edge \$\{edge\}`\}/);
 assert.match(renderer,/Resize \$\{edge\}/);
 assert.match(renderer,/onPointerDown=\{editable \? event/);
 assert.match(renderer,/canShowDashboardBar/);
 assert.match(editor,/Progress bars require a bounded index or percentage/);
 assert.doesNotMatch(renderer,/Wider.*Narrower/s);
});

test('classic presentation stays a faithful three-up player-width preview without hiding modern military',()=>{
 const player=read('./stats.jsx'),editor=read('./StatsDashboardEditor.jsx');
 const renderer=read('./StatsDashboard.jsx');
 assert.match(player,/shouldShowStandaloneMilitaryCard\(visibleNationalDashboard, dashboardPage\)/);
 assert.match(player,/MilitaryCard world=\{worldSnapshot\}/);
 assert.match(editor,/Classic layout/);
 assert.match(editor,/structuredClone\(DEFAULT_NATIONAL_DASHBOARD\)/);
 assert.match(editor,/Section title/);
 assert.match(renderer,/dashboardColumnsForWidth/);
 assert.match(renderer,/dashboardRecordedChange/);
 assert.match(renderer,/widget\.style === 'heading'/);
});

test('mandatory Military readout identifies disabled supply mechanics instead of inventing resources', () => {
 const player = read('./stats.jsx');
 assert.match(player, /MILITARY_FIGURE_ORDER\.map\(\(key\) => \{/,
   'all military rows remain visible in their stable order regardless of optional supply mechanics');
 assert.match(player, /key === "resources" && !profile\.supplied/);
 assert.match(player, /data-oh-war-resources-disabled/);
 assert.match(player, /Supplies disabled/);
 assert.match(player, /profile\.supplied && profile\.refill !== null/);
 assert.match(player, /militaryProfile\(world, country\)/,
   'the live military engine remains the only numeric source');
});

test('author preview reads scenario supply settings and displays the same disabled mechanic as the player', () => {
 const library=read('./libraryBar.jsx'), editor=read('./StatsDashboardEditor.jsx'), renderer=read('./StatsDashboard.jsx');
 assert.match(library, /StatsDashboardEditor value=\{statsValue\} onChange=\{onStatsChange\}\s+warSettings=\{formState\.warSettings\}/);
 assert.match(editor, /warSettingsOf\(\{ warSettings \}\)\.mechanics\.supply/);
 assert.match(editor, /sampleSuppliesEnabled=\{suppliesEnabled\}/);
 assert.match(editor, /RequiredMilitaryPreview suppliesEnabled=\{suppliesEnabled\}/);
 assert.match(renderer, /DashboardMilitaryPreview suppliesEnabled=\{sampleSuppliesEnabled\}/);
 assert.match(renderer, /title === 'War resources' && !suppliesEnabled/);
 assert.match(renderer, /Supplies disabled/);
});

test('military system readout is locked against editor deletion, relocation and clipboard workarounds', () => {
 const editor=read('./StatsDashboardEditor.jsx');
 assert.match(editor, /isRequiredMilitaryWidget\(widget\)/);
 assert.match(editor, /if \(isRequiredMilitaryWidget\(widget\)\) \{/);
 assert.match(editor, /editorButton\('Remove', \(\) => remove\(selected\.id\), isRequiredMilitaryWidget\(selected\)\)/);
 assert.match(editor, /disabled=\{isRequiredMilitaryWidget\(selected\)\}/);
 assert.match(editor, /shouldShowStandaloneMilitaryCard\(dashboard, page\)/,
   'the editor must preview the same mandatory military fallback as the player');
 assert.match(editor, /DashboardMilitaryPreview/);
 assert.match(editor, /Required by Wars & Fronts/);
 const player=read('./stats.jsx');
 assert.match(player, /shouldShowStandaloneMilitaryCard\(visibleNationalDashboard, dashboardPage\)/);
 assert.match(player, /MilitaryCard world=\{worldSnapshot\}/);
 assert.match(read('./StatsDashboard.jsx'), /militaryCard \|\|/);
});

test('visual card property inspector and keyboard interactions are scoped to dashboard, not campaign state',()=>{
 const editor=read('./StatsDashboardEditor.jsx');
 const renderer=read('./StatsDashboard.jsx');
 const library=read('./libraryBar.jsx');
 assert.match(editor,/advancedEditor = null/);
 assert.match(library,/advancedEditor=\{<StatsSheetEditor/);
 assert.match(editor,/if \(textField\(event.target\) \|\| event.altKey\) return;/);
 assert.match(editor,/\[data-dashboard-canvas\]/);
 assert.match(editor,/modifier && key === 'z'/);
 assert.match(editor,/modifier && key === 'y'/);
 assert.match(editor,/modifier && key === 'c'/);
 assert.match(editor,/modifier && key === 'v'/);
 assert.match(editor,/onWidgetContextMenu/);
 assert.match(editor,/Card settings/);
 assert.match(editor,/closest\('\[data-widget-id\]'\)\?\.focus/);
 assert.match(editor,/Selected card metric/);
 assert.match(renderer,/onPointerMove=\{onPointerMove\} onPointerUp=\{onPointerEnd\}/);
 assert.match(renderer,/prefers-reduced-motion/);
 assert.match(renderer,/tabIndex=\{editable \? 0 : undefined\}/);
 assert.match(editor,/querySelector\('\[data-dashboard-canvas\]'\)\?\.focus/);
 assert.doesNotMatch(editor,/generateCountryStatSheet|saveGame\(/);
});


test('size presets use standalone catalogued words, not generated translation variants', () => {
 const editor = read('./StatsDashboardEditor.jsx');
 const catalog = new Set(JSON.parse(read('../../../public/lang/catalog-en.json')));
 for (const word of ['Compact', 'Wide', 'Full', 'Tall', 'Extra tall'])
   assert.ok(catalog.has(word), `missing size label: ${word}`);
 assert.match(editor, /const SIZE_WIDTH_LABELS = \{ 2: 'Compact', 3: 'Wide', 6: 'Full' \}/);
 assert.match(editor, /const SIZE_HEIGHT_LABELS = \{ 2: 'Tall', 3: 'Extra tall' \}/);
 assert.match(editor, /aria-pressed=\{chosen\}/);
 assert.match(editor, /\{SIZE_WIDTH_LABELS\[w\]\}/);
 assert.match(editor, /\{SIZE_HEIGHT_LABELS\[h\]\}/);
 assert.doesNotMatch(editor, /\$\{w===2\?'Compact'/);
 assert.doesNotMatch(editor, /\$\{selected\.w===w&&selected\.h===h\?' ✓'/);
});


test('complete Details reuses existing live military formula and intelligence, with editor-only examples',()=>{
 const player=read('./stats.jsx');
 const editor=read('./StatsDashboardEditor.jsx');
 const renderer=read('./StatsDashboard.jsx');
 assert.match(player,/militaryCard=\{worldSnapshot \? <MilitaryCard world=\{worldSnapshot\}/);
 assert.match(player,/intelligence=\{intelligence\}/);
 assert.match(player,/shouldShowStandaloneMilitaryCard\(visibleNationalDashboard, dashboardPage\)/);
 assert.doesNotMatch(player,/statSheetDefinition\.dashboard\.widgets/);
 assert.match(editor,/sampleModules sampleSuppliesEnabled=\{suppliesEnabled\} intelligence=\{58\}/);
 assert.match(renderer,/function DashboardMilitaryPreview/);
 assert.match(renderer,/function DashboardBreakdown/);
 assert.match(renderer,/raw\?\.\[key\]/);
 assert.doesNotMatch(renderer,/militaryProfile|intelligenceOf|writeWorldState|saveGame\(/);
});

test('published canonical world updates refresh the already-visible country Statistics sheet', () => {
 const source=read('./stats.jsx');
 const start=source.lastIndexOf('const onWorldUpdated = (event) => {');
 assert.notEqual(start,-1);
 const end=source.indexOf('window.addEventListener("oh:world-updated"',start);
 assert.ok(end>start);
 const handler=source.slice(start,end);
 assert.match(handler,/world\?\.countryStats\?\.\[targetCountry\]/);
 assert.match(handler,/isValidStatSheet\(persisted, statSheetDefinition\)/);
 assert.match(handler,/rememberSheet\(cacheKey,/);
 assert.match(handler,/setState\(\(current\) => current\.status === "ready"/);
 assert.doesNotMatch(handler,/writeWorldState\(|generateCountryStatSheet\(/);
});