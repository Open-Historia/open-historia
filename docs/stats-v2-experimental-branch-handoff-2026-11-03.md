# Statistics V2 experimental Beta: contributor and release handoff (2026-11-03)

## Status and source custody

**Experimental source, NOT regular Beta or a production-certified release.** Official repository: `Open-Historia/open-historia`; public collaboration branch: `beta-stats-v2`. Regular `beta`, default `main`, Alpha, and Continuum are different tracks; no Stats V2 code has been merged into `beta` by this checkpoint. The branch is intended for fixes, reproducible creator QA and pull requests **targeting `beta-stats-v2`**, not as an automatic release channel.

The authoritative local integration checkout is a local path on the contributor's machine, branch `integrate/stats-v2-upstream-2026-11-03`. Preserve these separate clean historical worktrees:

- a local path on the contributor's machine: original Stats feature at `7bad77fc`.
- a local path on the contributor's machine: independently verified Statistics V2 creator-QA checkpoint `f99ba819`.
- This integration checkout: two-parent upstream merge `f5b0064f6e3896c5d4c9c8f40a4d1d4a2a24caa0` (parents `f99ba819` and public Beta `21a29e698910737c40fcf4e632060830f4f1a8df`), followed by `79805a5` to enable experimental branch tests.

The historical November 3 Electron QA ZIP and matching source snapshot in the developer's Windows Downloads reflect the **pre-upstream-merge** `f99ba819` implementation; do not distribute them as an executable of this integrated commit. No new merged Electron package, signed installer, creator live-playtest or public production deployment is certified here. Publication of new Git commits is separately verifiable on the remote branch; local commits alone are not releases.

## What the integration preserves

- One authoritative national `world.countryStats` ledger, native economic, demographic, production, migration, fiscal and dated naval/front settlement where evidence suffices; deterministic history and receipts; guarded legacy fallback where it does not.
- Typed `statsEffects`/economic accounting, Game Master Preview/Apply authority, strict event-shape/war-ID checks, bounded AI correction, source-linked receipts, and no silent periodic AI national rebaselining.
- Scenario Statistics authoring, explicit legacy/native bound-card reconciliation, nondestructive archive and author consent, missing-versus-zero protections, country-grouped optional GDP context, and the shared editable player/editor dashboard.
- Separate nominal fiscal transaction and tax-policy ledgers **without pretending that authorizations/forecasts settle actual cash, public debt or national GDP**.
- Upstream Beta's newer military, map, social, localization, AI, and multiplayer changes without intentionally weakening existing Statistics invariants.

The upstream merge required explicit reconciliation at gameplay import/schema, fiscal receipt labels, air-strike/national Stats source ownership, neutral wartime Stats, localization source entries, military unit tests and war-figure source guards. A full native national tick must **not** double-book a city air strike's separate legacy GDP/population writer; the full writer refuses that turn and neutral partial settlement excludes affected country accounts. The merge also fixes a test-harness race by comparing the *same* air-patrol starting unit rather than separately generating wall-clock `createdAt` timestamps. These are generic safeguards, not one-case historical hardcodes.

## Verified checks and limits

On this exact integrated working source **before committing the two-parent merge**:

- Focused overlapping Stats, GM, war-figure, military, localization and notice subset: **89/89 pass**.
- Air-patrol test fixture after correction: **66/66 pass**.
- Full Windows `npm.cmd test`: **8,756 total / 8,753 pass / zero failures / one skipped / two TODO**, exit 0. An earlier full run had one genuine one-millisecond timestamp fixture failure; it was repaired and the entire suite rerun green.
- `npm.cmd run build`: exit 0; Vite chunk/dynamic-import and Babel large-module warnings, no build failure.
- `npm.cmd run build:web`: exit 0; six externally sourced web map assets verified and staged, **66.1 MB**. No hosted web smoke.
- Staged `git diff --check`: exit 0; no unmerged index entries. UTF-8 source catalog compared with the staged Git file by raw Node decoding: all 15,886 original strings retained and two fiscal-operation strings added.
- The merge commit is `f5b0064f` with two verified parent SHAs, authored by GitHub `thekernely`; CI configuration is a separate `79805a5` commit. These are local Git/Windows results. GitHub CI and live-playtest acceptance require separate observation.

Local acceptance logs: a local path on the contributor's machine (prior test failure), `full-test-r2.log` (green), `focused-merge.log`, `unit-motion-focused-r2.log`. Original QA logs and screenshots are **not** silently bundled into the public repository. Source-level tests establish a supported implementation, not broad historical economic accuracy or real provider reliability.

## Remaining release gates for contributors

1. **P0 — Original 1991 war and model-output failures.** Obtain authorized disposable `Swan Lake Ballet - 18th August 1991` campaign export, active war roster and accepted event/receipt evidence. A Yugoslav artillery event lacked `warId`/opposing combatants; lenient narrative was subsequently screened as routine military. Identify the native writer/visibility seam and repair only proven generic failures; never infer war membership from location or prose. Re-run real configured beam:cloud events after source corrections to test missing `economicAccounting`, claim-array normalization and bounded corrective feedback. See `docs/qa-iszlev-external-stats-v2-2026-11-02.md`.
2. **P0 — Creator editor persistence and reconciliation.** On a *copy* of the 238-country Modern Day creator export, exercise choose native/legacy per metric, invalid/zero/unset cases, author confirmation, CSV, Save/Reload/Export/Import/Undo, and legacy/custom sheets. The previous read-only 238/238 presentation-ready replay is not author approval or proof of actual saved values. Avoid paid mass regeneration.
3. **P0 — Fresh integrated Electron QA release and privacy.** Build a uniquely branded, reproducible experimental executable from the final integrated commit; verify physical dependencies and generated FMG files inside `app.asar`, isolated QA data profile, launch, scenario editor and gameplay. The previously packaged November 3 QA app predates this upstream merge. Check multiplayer host-only fiscal/private ledgers and cross-seat projections with native tests and live acceptance.
4. **P1 — Native chronology and model causality.** Test the 1912 Italo-Turkish War's positive blockade, front/control and neutral/belligerent monthly accrual with identical accepted events under long-versus-split skips, actual save/reload/Undo and no double settlement. Real financial crises may remain unquantified until evidence supports a bounded typed effect; do not turn narrative into invented GDP/shock coefficients.
5. **P1 — Fiscal #009 and historical calibration.** Nominal grant authorization/payment and tax-holiday forecasts exist; true tax receipts, funding/borrowing, currency-to-GDP valuation and double-count-safe annual fiscal flows do **not**. A 1912/1991 GDP displayed in constant 2026 EUR is not validated merely because schema/arithmetic passes. Keep GDP/population/territorial components and public-debt bases separate.
6. **P1/P2 — UI, scenarios and accessibility.** Validate responsive/touch/keyboard/RTL, all 22 languages, custom/sparse/historical scenario data, demographic current-rate reader versus start-date anchors, default Scenario Editor pre-generation coverage, and original 17-item joint QA disposition without inflating its 8 source-fixed / 7 partial / 2 watch score. See `docs/qa-17-finding-source-closure-2026-10-31.md`, `docs/qa-fiscal-operations-design-2026-10-31.md`, and `docs/stats-dashboard-v2.md`.

These are **scoped acceptance items, not approval to broaden Statistics V2 into universal per-person, herd or arbitrary state simulation**. Preserve canonical IDs, schema bounds, lossless migrations, provenance, host privacy, and fail-closed transaction guards. Known unrelated upstream bugs should be reported separately rather than slipped into Stats hotfixes.

## Contributor workflow and branch policy

- Work from `origin/beta-stats-v2` into a personal topic branch. Target PRs at **`beta-stats-v2`**, not `beta` or `main`, until the release gates are explicitly met.
- The repository's `.github/workflows/tests.yml` now includes pushes to and pull requests targeting `beta-stats-v2`, in addition to its existing Beta/main rules. This adds automated tests, **not** installer/deployment publication. Check actual GitHub Actions status after push; no pass is implied by a local test log.
- On Windows: `npm.cmd test`, `npm.cmd run build`, `npm.cmd run build:web`, plus focused regressions and `git diff --check`. Actual creator/provider/save/Undo QA remains an independent gate. Prefer isolated saves and full hashes; never mutate a player's only live campaign or private provider credentials.
- Periodically reconcile upstream `beta` in a disposable integration worktree with explicit parent SHA, manual inspection, focused tests, full suite/builds and a reviewed merge. Do not force-push or rewrite published `beta-stats-v2`, and do not auto-promote it into stable/default branches.
- At stable milestones, update `docs/world-state.md`, this handoff and the five external Project canonical documents **additively**. Current implementation is authoritative for source behavior; historical docs remain evidence, not instructions to replay obsolete patches.

**Status:** suitable for collaborative experimental QA after public branch verification; **not** a complete Statistics V2 public release, historical calibration certification, or every-model gameplay acceptance.
