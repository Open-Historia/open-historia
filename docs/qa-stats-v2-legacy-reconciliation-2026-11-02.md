# Statistics V2: reviewed legacy-to-native reconciliation (2026-11-02)

## Status and source
Implementation candidate against Beta Statistics V2 integration source (base commit `b1c820c6755b820c8e4aad0f4876bc8f341e5598` plus the preexisting 77 uncommitted source paths). Keep those original changes; the source overlay contains only the reconciliation delta.

### Reproducing evidence
Iszlev's exported Modern Day 2026 scenario showed 238/238 existing country sheets but 0 ready, because seven native-bound custom cards still had independent legacy `customStats` readings. The review CSV showed 1,666 readings, 618 differing and 1,048 matching.

Native inflation and unemployment were zero in 238 countries; legacy inflation was nonzero in 238 and legacy unemployment nonzero in 237. This is consistent with compatibility zeros created by the custom-sheet generation path, **not** proof that any particular zero was intentionally authored or should automatically be replaced.

The standalone read-only replay of the actual exported `scenario.json` (the author's ZIP was left untouched) evaluated seven explicitly chosen per-metric policies in memory:
- Promote inflation and unemployment from equally-scaled legacy percent values.
- Retain native total population, GDP, GDP per capita, public debt and budget balance.
- Preserve the prior values, archive duplicates, and require exact source-sheet equality before proposed persistence.

Result: 0/238 to 238/238 **presentation-ready**. This does **not** assert that all native economic baselines are accurate; the independent `gdpGrowthPerMonth` custom metric remains separate from annual native `gdpGrowth`, and native GDP units can differ from legacy custom GDP.

## Author-facing contract
The Starting Statistics panel now offers **Reconcile legacy copies** with:
1. Exactly one explicitly bound card per operation (no ambiguous multi-metric side effects).
2. Explicit choice to *keep native* (archive legacy only) or *use legacy 1:1* for supported scalar fields (archive both former readings).
3. Scopes: all comparisons, different only, matching only, or native zero / legacy nonzero only.
4. Read-only preview with country/readings counts and examples, plus affirmative per-operation confirmation referring to the exported CSV and scenario backup.
5. Guarded scenario write through the existing `applyToScenario`: fresh starting date, Statistics definition, map roster/asset and per-country sheet fingerprint checks, and Political World authority checks.

The old whole-scenario archival action is disabled whenever **any** reviewed native-bound copy differs, preventing silent mass retention of compatibility zeros. The existing archive planner and its lossless `archived*` key contract remain unchanged.

## Invariants
- Missing or malformed numeric values cannot turn into explicit zero. A genuine native zero remains valid when the author chooses it.
- Aggregate GDP, per-capita GDP and population **cannot** be promoted by this bulk scalar path. Their territory/unit/scope relationship requires the map-aware authoring reducer and human review. No million/billion conversion is inferred.
- A scalar promotion checks the native metric's allowed range, rejects fractional index values and preexisting economic continuity cursors, and retains both previous native and legacy numeric evidence in unique `archived*` keys within the 60-slot limit.
- The planner is pure, checks archive save/reload normalization and preserves the territorial ledger, population and unrelated native economy fields.
- An alias set with multiple independent readings cannot be promoted to one native scalar without manual resolution.
- Applied plans affect **future newly started campaigns only**, never running campaigns. There is no scenario mutation from preview or failed validation.
- The author's scenario export is evidence, not a fixture copied into the shipped overlay.

## Remaining work / explicit non-goals
This change does not automatically migrate `gdpGrowthPerMonth` to annual native `gdpGrowth`, resolve ambiguous GDP/PPP/nominal accounting bases, or produce historically authoritative inflation figures. Display readiness is not an all-fields economic correctness certification. Individual map-aware edits remain necessary when the native aggregate is wrong.

Live UI acceptance, external author validation, export/import roundtrip after an actual editor save, and a separate decision on derived economic-unit reconciliation remain follow-up checks. Do not present a source-level replay as a completed live QA session.

## Regression coverage
- `src/runtime/statsBoundAliasReconciliation.test.js`: decision scopes, compatibility zero, archival of both readings, preservation of existing fields/territory, aggregate promotion rejection, currency accounting and limit guards.
- `src/Game/GameUI/statsMetricAliasReviewWiring.test.js`: visible opt-in workflow, guarded save path and bulk mismatch block.
- Existing archive/binding regression tests remain authoritative.
- `public/lang/catalog-en.json`: extends the shared source catalog with new interface strings without regenerating provider translations or discarding unrelated branch entries.

Uncommitted working source remains the authority for implementation. Reconcile this note with `docs/world-state.md` at the stable integration checkpoint, preserving other tracks, unresolved QA debt and prior checkpoints.
