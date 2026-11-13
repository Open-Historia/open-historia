import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");
const drawer = read("./countryPanel.jsx");
const stats = read("./stats.jsx");
const politics = read("./PoliticalOverview.jsx");
const css = read("./countryDossier.css");

test("the redesigned Country drawer is isolated from the generic map popup", () => {
  assert.match(drawer, /import "\.\/countryDossier\.css"/);
  assert.match(drawer, /className="oh-country-dossier"/);
  assert.match(drawer, /className="oh-country-dossier-toolbar"/);
  assert.match(drawer, /<StatsPane active=\{open\}/);
  assert.match(css, /\.oh-country-dossier\s*\{/);
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:body|html|\*)\s*\{/);
});

test("country identity remains canonical and its flag aspect ratio is not distorted", () => {
  assert.match(stats, /resolveChosenPolityFlag\(flagArgs\) : resolvePolityFlag\(flagArgs\)/);
  assert.match(stats, /className="oh-country-hero-flag"/);
  assert.match(stats, /src=\{bundledFlagUrl\(flagUrl\)\}/);
  assert.match(stats, /objectFit: "contain"/);
  assert.match(stats, /className="oh-country-hero-title"/);
});

test("the four authorized Country views and their existing actions remain accessible", () => {
  assert.match(stats, /className="oh-country-dossier-tabs"/);
  const views = [...stats.matchAll(/onClick=\{\(\) => setStatsView\("(politics|diplomacy|economy|ranking)"\)\}/g)].map((m) => m[1]);
  assert.deepEqual(views, ["politics", "diplomacy", "economy", "ranking"]);
  assert.match(stats, /aria-pressed=\{statsView === "politics"\}/);
  assert.match(stats, /aria-pressed=\{statsView === "diplomacy"\}/);
  assert.match(stats, /aria-pressed=\{statsView === "economy"\}/);
  assert.match(stats, /aria-pressed=\{statsView === "ranking"\}/);
  assert.match(css, /\.oh-country-dossier-tabs\s*\{[\s\S]*?position: sticky/);
  assert.match(css, /:focus-visible/);
});

test("the new Diplomatic ledger does not bypass canonical visibility or war controls", () => {
  assert.match(stats, /className="oh-country-diplomacy-summary"/);
  assert.match(stats, /<section className="oh-country-ledger-section">/);
  assert.match(stats, /livePuppetsFor\(world, viewer\)/);
  assert.match(stats, /puppetSummaryFor\(world, viewer, target\)/);
  assert.doesNotMatch(stats, /world\.puppets/);
  assert.match(stats, /<PeaceControls war=\{war\} world=\{world\} viewer=\{viewerPolity\}/);
  assert.match(stats, /<WarReportsList world=\{world\}/);
  assert.match(stats, /<ReparationsNote world=\{world\}/);
});

test("political composition is still driven by the bounded public projection", () => {
  assert.match(politics, /buildPoliticalLandscapeViews\(profile\)/);
  assert.match(politics, /<GovernmentOverview profile=\{profile\}/);
  assert.match(politics, /className="oh-country-landscape-overview"/);
  assert.match(politics, /landscape\.slices\.slice\(0, 4\)\.map/);
  assert.match(politics, /<PartyDonut/);
  assert.match(politics, /<PartyRow/);
  assert.match(politics, /<InstitutionPortfolio rows=\{institutions\}/);
  assert.match(politics, /<IntelligenceAssessment intelligence=\{intelligence\}/);
});

test("the new visual density does not override custom Stats author control", () => {
  assert.match(stats, /definition\.sections\s*\.map/);
  assert.match(stats, /section\.stats\.map\(\(stat\) =>/);
  assert.match(stats, /<CustomStatCard key=\{stat\.key\}/);
  assert.match(stats, /className="oh-country-index-datum"/);
  assert.match(stats, /className="oh-country-economic-datum"/);
  assert.match(css, /@media \(max-width: 375px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("scenario-authored National categories have deliberate separation without reordering or dropping fields", () => {
  assert.match(stats, /definition\.sections\s*\.map/);
  assert.match(stats, /section\.stats\.map\(\(stat\) =>/);
  assert.match(stats, /className="oh-country-stat-category"/);
  assert.match(css, /\.oh-country-content\[data-view="economy"\] \.oh-country-stat-category\s*\{/);
  assert.match(css, /margin-top:\s*1\.9rem/);
  assert.match(css, /margin-bottom:\s*0\.9rem/);
});

test("institution memberships become a ledger without losing status, history or show-all behavior", () => {
  assert.match(politics, /const items = Array\.isArray\(rows\) \? rows : \[\]/);
  assert.match(politics, /className="oh-country-institution-ledger"/);
  assert.match(politics, /className="oh-country-institution-row"/);
  assert.match(politics, /className="oh-country-institution-meta"/);
  assert.match(politics, /\(showAll \? items : items\.slice\(0, INSTITUTIONS_SHOWN\)\)\.map/);
  assert.match(politics, /\{lifecycleLabel\(entry\)\}/);
  assert.match(politics, /formatGameDateReadable\(entry\.member\.sinceDate\)/);
  assert.match(politics, /pending\.slice\(0, 2\)\.map/);
  assert.match(politics, /setShowAll\(\(open\) => !open\)/);
  assert.match(css, /\.oh-country-institution-row\s*\{/);
});

test("sticky country navigation meets the fixed toolbar without exposing scrolled content", () => {
  // The initial top-padding/negative-hero-margin offset looked correct while
  // unscrolled, but leaked a strip of underlying content when tabs stuck.
  assert.match(stats, /className="oh-country-dossier-scroll"[^\n]+padding: "0 1rem 1\.25rem"/);
  assert.match(css, /\.oh-country-hero\s*\{[\s\S]*?margin: 0 -1rem 0;/);
  assert.match(css, /\.oh-country-dossier-tabs\s*\{[\s\S]*?position: sticky;\s*top: 0;/);
  assert.doesNotMatch(css, /margin:\s*-0\.9rem -1rem 0/);
});

test("the bilateral relation search controls have breathing room on both sides", () => {
  assert.match(stats, /className="oh-country-relation-tools"/);
  assert.match(css, /\.oh-country-relation-tools\s*\{[\s\S]*?padding:\s*0\.75rem 0\.65rem 0\.8rem;/);
  assert.match(stats, /aria-label="Search bilateral relations"/);
  assert.match(stats, /aria-label="Sort bilateral relations"/);
});

test("Ranking uses a single complete metric selector instead of a wrap of metric pills", () => {
  assert.match(stats, /className="oh-country-ranking-dossier"/);
  assert.match(stats, /className="oh-country-ranking-select"/);
  assert.match(stats, /aria-label="Ranked by"/);
  assert.match(stats, /\{metrics\.map\(\(entry\) => \(\s*<option key=\{entry\.key\} value=\{entry\.key\}>\{entry\.label\}<\/option>/);
  assert.match(stats, /onChange=\{\(event\) => \{ setMetricKey\(event\.target\.value\); setShowAll\(false\); \}\}/);
  assert.doesNotMatch(stats, /rankingMetricStyle\(/);
});

test("Ranking ledger retains actual values, tie ranks, canonical flags and country inspection", () => {
  assert.match(stats, /className="oh-country-ranking-list"/);
  assert.match(stats, /className="oh-country-ranking-row oh-tap-row"/);
  assert.match(stats, /className="oh-country-ranking-rank"/);
  assert.match(stats, /className="oh-country-ranking-flag"/);
  assert.match(stats, /className="oh-country-ranking-value"/);
  assert.match(stats, /row\.rank/);
  assert.match(stats, /formatRankingValue\(metric, row\.value, displayCurrency\)/);
  assert.match(stats, /if \(metric\.stat\) return formatCustomStatValue\(metric\.stat, value, \{ economicDisplayCurrency: displayCurrency \}\)/,
    "ranking values must preserve the campaign GDP display currency for scenario-defined GDP metrics");
  assert.match(stats, /const flagUrl = resolvePolityFlag\(\{ polity: \{ name: row\.label, code: row\.key \}, world: world \|\| \{\}, flags: flags \|\| \{\}, identityIndex: flagIdentityIndex \}\)\.imageUrl/);
  assert.match(stats, /onClick=\{\(\) => onPick\(row\.key\)\}/);
  assert.match(stats, /aria-current=\{open \? "true" : undefined\}/);
  assert.match(stats, /const shown = showAll \? ranking\.rows : ranking\.rows\.slice\(0, RANKING_ROWS_FIRST\)/);
  assert.match(stats, /<span data-no-translate>\(\{ranking\.rows\.length\}\/\{ranking\.total\}\)<\/span>/);
  assert.match(css, /\.oh-country-ranking-row\s*\{/);
  assert.match(css, /\.oh-country-ranking-row\[data-rank-tier="top"\]/);
  assert.match(css, /\.oh-country-ranking-row\[data-mine="true"\]/);
  assert.match(css, /@media \(max-width: 375px\)/);
});

test("Politics switches between public parties and blocs without mutating representation", () => {
  assert.match(politics, /buildPoliticalLandscapeViews\(profile\)/);
  assert.match(politics, /views\.canSwitch &&/);
  assert.match(politics, /const activeView = views\.canSwitch && viewChoice\.polityKey === polityKey/);
  assert.match(politics, /className="oh-country-landscape-switch"/);
  assert.match(politics, /aria-label="Political structure view"/);
  assert.match(politics, /aria-pressed=\{activeView === "parties"\}/);
  assert.match(politics, /aria-pressed=\{activeView === "blocs"\}/);
  assert.match(politics, /onClick=\{\(\) => chooseView\("parties"\)\}/);
  assert.match(politics, /onClick=\{\(\) => chooseView\("blocs"\)\}/);
  assert.match(politics, /setSelectedId\(""\)/);
  assert.match(politics, /activeView === "parties" && landscape\.slices\.length > 0/);
  assert.match(politics, /activeView === "blocs" && <PowerBlocLedger/);
  assert.doesNotMatch(politics, /setPoliticalRepresentation/);
});

test("power bloc ledger displays independent recorded influence and retains qualitative details", () => {
  assert.match(politics, /className="oh-country-bloc-ledger"/);
  assert.match(politics, /className="oh-country-bloc-entry"/);
  assert.match(politics, /aria-expanded=\{selectedId === bloc\.id\}/);
  assert.match(politics, /Number\.isFinite\(bloc\.influence\)/);
  assert.match(politics, /role="meter" aria-valuemin=\{0\} aria-valuemax=\{100\} aria-valuenow=\{bloc\.influence\}/);
  assert.match(politics, /bloc\.displayValue \|\| "Not quantified"/);
  assert.match(politics, /width: `\$\{bloc\.influence\}%`/);
  assert.match(politics, /<PowerBlocDetail bloc=\{bloc\}/);
  assert.match(css, /\.oh-country-bloc-track\s*\{/);
  assert.match(css, /\.oh-country-bloc-entry\[data-expanded="true"\]/);
});
test("a compact rectangular view switch stays below the displayed chart or bloc ledger", () => {
  const chartIndex = politics.indexOf('className="oh-country-landscape-overview"');
  const blocIndex = politics.indexOf('activeView === "blocs" && <PowerBlocLedger');
  const switchIndex = politics.indexOf('className="oh-country-landscape-switch"');
  const rowsIndex = politics.indexOf('className="oh-country-landscape-party-list"');
  assert.ok(chartIndex >= 0 && chartIndex < blocIndex && blocIndex < switchIndex && switchIndex < rowsIndex,
    "the single selector must follow either visual display and precede the party record list");
  assert.equal(politics.match(/className="oh-country-landscape-switch"/g)?.length, 1);
  assert.match(politics, /maxWidth: "185px"/);
  assert.match(css, /\.oh-country-landscape-overview\s*\{[\s\S]*?grid-template-columns: minmax\(170px, 1\.05fr\) minmax\(0, 1fr\);/);
  const switchStyle = css.split(".oh-country-landscape-switch {")[1]?.split("}")[0] || "";
  const buttonStyle = css.split(".oh-country-landscape-switch button {")[1]?.split("}")[0] || "";
  assert.match(switchStyle, /width:\s*max-content;/);
  assert.match(switchStyle, /border-radius:\s*6px;/);
  assert.match(buttonStyle, /min-height:\s*2\.1rem;/);
  assert.match(buttonStyle, /border-radius:\s*4px;/);
  assert.doesNotMatch(switchStyle + buttonStyle, /999px|999rem|50%/);
});
test("Country toolbar follows opt-in palette and retains original styling as CSS fallback", () => {
  assert.match(css, /\.oh-country-dossier-toolbar\s*\{[\s\S]*?background: var\(--oh-ui-header, rgba\(10, 16, 25, \.74\)\);/);
  assert.match(drawer, /aria-hidden="true" style=\{\{ color: "var\(--oh-ui-accent, #8ecbe8\)"/);
  assert.match(drawer, /color: "var\(--oh-ui-text, #d7e5f0\)"[\s\S]*?>Country<\/div>/);
  assert.match(css, /\.oh-country-dossier-toolbar\s*\{[\s\S]*?backdrop-filter: blur\(12px\)/,
    "toolbar must remain a legible translucent header in Original mode");
});

test("Live Intelligence Service matches National ledger without replacing its canonical intelligence score", () => {
  const card = stats.split("const IntelligenceServiceCard = ")[1]?.split("// ---- the Military card")[0] || "";
  assert.match(card, /className="oh-country-intelligence-stat"/);
  assert.match(card, /className="oh-country-intelligence-stat-heading"/);
  assert.match(card, /className="oh-country-intelligence-stat-label"/);
  assert.match(card, /className="oh-country-intelligence-stat-value">\{value\}\/100<\/span>/);
  assert.match(card, /<Bar value=\{value\} color="#38bdf8" \/>/);
  assert.doesNotMatch(card, /\.\.\.cardStyle|backgroundColor: "rgba\(/,
    "the legacy boxed stats treatment must not return");
  assert.match(css, /\.oh-country-intelligence-stat\s*\{[\s\S]*?background: transparent;[\s\S]*?border-bottom: 1px solid var\(--dossier-line\)/);
  assert.match(css, /\.oh-country-intelligence-stat-label\s*\{[\s\S]*?color: var\(--dossier-muted\)/);
  assert.match(css, /\.oh-country-intelligence-stat-value\s*\{[\s\S]*?color: var\(--dossier-text\)/);
  assert.match(stats, /const intelligence = targetCountry && worldSnapshot \? intelligenceOf\(worldSnapshot, targetCountry\) : null;/);
  assert.equal((stats.match(/intelligence !== null && <IntelligenceServiceCard value=\{intelligence\}/g) || []).length, 2,
    "both custom and standard National sheets must retain the live service rating");
  assert.match(stats, /hiddenKeys=\{intelligence !== null \? LIVE_INTELLIGENCE_STAT_KEYS : \[\]\}/,
    "the live rating must not be doubled with a generated custom metric");
});
