/*! Open Historia — Country panel presentation regressions © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const stats = fs.readFileSync(new URL("./stats.jsx", import.meta.url), "utf8");
const mapPopup = fs.readFileSync(new URL("../Selection/Regions.jsx", import.meta.url), "utf8");
const infoPanel = fs.readFileSync(new URL("../Selection/CountryPanel.jsx", import.meta.url), "utf8");

test("the Country drawer uses the shared polity flag authority, including chosen-only landless flags", () => {
  assert.match(stats, /import \{ resolveChosenPolityFlag, resolvePolityFlag \} from "\.\.\/\.\.\/runtime\/polityFlags\.js"/);
  assert.match(stats, /identityIndex: polityIndex\?\.identityIndex/);
  assert.match(stats, /suppressDerivedFlag\s*\? resolveChosenPolityFlag\(flagArgs\)\s*:\s*resolvePolityFlag\(flagArgs\)/);
  assert.doesNotMatch(stats, /customFlags\[targetCountry\]\s*\|\|\s*polity\?\.flag/);
  assert.match(stats, /window\.addEventListener\("oh:flags-updated", onFlagsUpdated\)/);
  assert.match(stats, /window\.removeEventListener\("oh:flags-updated", onFlagsUpdated\)/);
});

test("flags in the Country drawer and region popup show the whole image without cropping", () => {
  assert.match(stats, /src=\{bundledFlagUrl\(flagUrl\)\}[\s\S]{0,260}objectFit: "contain"/);
  assert.match(mapPopup, /src=\{bundledFlagUrl\(flagState\.imageUrl\)\}[\s\S]{0,250}objectFit: "contain"/);
  assert.match(infoPanel, /src=\{bundledFlagUrl\(currentFlag\.imageUrl\)\}[\s\S]{0,280}objectFit: "contain"/);
  // Full flag proportions require the popup banner itself to grow or shrink,
  // not merely object-fit: contain inside the old fixed 96px slot.
  assert.match(mapPopup, /src=\{bundledFlagUrl\(flagState\.imageUrl\)\}[\s\S]{0,260}height: "auto"/);
  assert.match(mapPopup, /height: "96px"/, "an empty/loading banner retains a predictable height");
  assert.match(mapPopup, /ref=\{popupBodyRef\}/);
  assert.match(mapPopup, /clampAnchoredCardTop\(screenPos\.y, popupBodyHeight \+ pointerHeight, window\.innerHeight\)/);
  assert.match(mapPopup, /top: popupTop/);
  assert.match(mapPopup, /maxHeight: asSheet \? [^\n]+ : "calc\(100dvh - 2rem\)"/);
  assert.doesNotMatch(mapPopup, /translateY\(-100%\)/, "floating popup animation must not translate the clamped card off-screen");
});

test("custom index metrics share the section grid and keep scenario order", () => {
  assert.match(stats, /definition\.sections[\s\S]*?sections\.map\(\(section, sectionIndex\)/);
  assert.match(stats, /section\.stats\.map\(\(stat\) => \(\s*<CustomStatCard/);
  assert.match(stats, /if \(stat\.kind === "index"\) \{\s*return <IndexMetricCard/);
  assert.doesNotMatch(stats, /stat\.kind === "index"[\s\S]{0,160}gridColumn: "1 \/ -1"/);
});

test("standard indices also use the compact grid without changing their order", () => {
  assert.match(stats, /gridTemplateColumns: "repeat\(auto-fit, minmax\(min\(12rem, 100%\), 1fr\)\)"[^\n]*\}[\s\S]{0,150}indexRows\.map\(\(row\) =>/);
  assert.match(stats, /indexRows\.map\(\(row\) => \(\s*<IndexMetricCard/);
});
