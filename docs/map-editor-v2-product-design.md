# Map Editor V2 — Product and architecture design specification

Status: **Approved direction / implementation specification, first checkpoint** (2026-11-20). Owner has designated this workstream the **foremost OpenHistoria development priority**. The Scenario Editor is in better shape and should receive only required integration/navigation improvements rather than an unrelated rewrite.

Workstream: [Notion — Scenario & Map Editors V2](https://app.notion.com/p/41eb30293f50812db843dc9fb6bd2712).
Branch: feat/beta-map-editor-v2-2026-11-20.
Source baseline: official Beta 6b822bcf4875be4d9f8276c5c21b7ac80bca5d9d.
Read-only source audit: D:/OpenHistoria/QAReports/MAP_EDITOR_V2_WHOLE_SYSTEM_AUDIT_20261120/CHECKPOINT.md.

**Design-first review (2026-11-20):** The proposed full-editor navigation, creator workflows, error/empty/save states, safe operations and acceptance journeys are documented in [Map Editor V2 - Complete UX blueprint](map-editor-v2-ux-blueprint.md). The standalone read-only design prototype and its fixture-based test were removed before the P12 commit at the creator request. Creator review and design acceptance now use the actual Map Editor on localhost:3001. This document remains the authoritative product/architecture companion, with M0-M4 release gates tracked separately from the implemented P12 workspaces.

### Native integration checkpoint — 2026-11-20 (live beta, not yet accepted)

The creator reviewed the separate UX prototype and explicitly **rejected its removal of the existing Photoshop-style map tool icons** and the way its permanent controls consumed the map workspace. The independent design prototype is now a reference only; it must not be mistaken for the production editor or automatically shipped with scenario-derived assets. The author explicitly requested integration directly into the real Map Editor on the disposable 1912 scenario copy at localhost:3001.

**What is now implemented in this branch's actual editor:**

- `editorToolCatalog.js` centralizes all **17 original map tools** without dropping IDs or changing `OlMap` behavior. `EditorToolDock.jsx` exposes them in a compact, themed desktop dock over the actual map, including the existing Undo/Redo/Fit API. Mobile preserves the original touch sidebar tools.
- `editorWorkspaces.js` and `EditorWorkspaceNav.jsx` create named, task-oriented navigation for Overview, Countries, Territory & borders, Places & units, Groups, Terrain & war, Maps & appearance, Import or generate, and Review & save. Each real panel/action resolves to the existing `MapEditor.jsx` handlers; the same `d` document state, `OlMap` geometry APIs and scenario save bridge remain canonical.
- `CountryDetailsNavigation.jsx` and `countryDetailTabs.js` reorganize the original `PolitiesPanel.jsx` into Overview, Names, Territory, Government & forces, Appearance and Create & manage. These sections reuse current native callbacks for alias add/remove, rename, assignments/transfers, flags/colors/tags, puppet settings, military numbers, roster import, deletion and creation—no simulated state layer. Choosing a country collapses the long browser list while keeping it one click away.
- The **real** Apply & Play / Save & Exit primary button uses `--oh-ui-accent` and a contrasting `--oh-ui-bg` text color, with original `#2bc1f3` fallback for Default. `persistScenario` call signatures and guards remain unchanged.
- The editor's "All saved" document label is clarified to **Working map saved**; scenario unapplied changes retain their separate status warning.

**Validated behavior as of this checkpoint:** Native 1912 Scenario Editor was opened in an isolated headless browser on localhost:3001; the new toolbar and workspaces were present, Country Details selected Bulgaria, Names/aliases were visible, a unique test alias was added and removed through the **real** callback, and the real War geography panel opened. Four new native contract tests passed alongside the alias/theme regressions. Production desktop build passed. Full-suite and web-build results must be recorded only after observed completion.

**Still NOT implemented or claimed:** native whole-country regime replacement, policy/Political World editing inside Map Editor, universal property Undo, fail-closed checkpointing for all destructive imports, fully reviewed theme consistency of every specialist dialog, or visual human acceptance. These remain P0 design/engine work, not fake buttons. The standalone preview remains a review-only prototype and its locally generated 1912 geography fixture must not be distributed upstream without provenance/permission review.

### Native Country Details refinement — 2026-11-20 (P0 continuing, not released)

Source inspection found a genuine placement regression from the initial native tab reorganization: the real **Remove from the map** action appeared under Government & forces, and a nested Manage condition could never run. A focused regression first failed, then passed after the action was moved into the dedicated **Create & manage** danger section, with accurate native ownership/claim/record consequences and explicit warning that map Undo is not comprehensive. The existing deletion and confirmation handlers were retained.

**Country Overview is now factual and editable through its established tabs:** `CountryOverview.jsx` with pure `countryOverviewFacts.js` reads the selected polity's canonical name, actual aliases/former names, owned/claimed region counts, only authored population, only authored military overrides (including explicit zero), live protectorate/puppet/subordinate relationships, flag presence, tags and scenario note. Every card routes to the original native Country Details section. A missing authored fact remains unset; the overview does not invent ideology, parties or a government record. Source tests cover independent/subject relationships, landlessness, key stability, unset-vs-zero and no mutation.

**Improve the real authoring workflow without a second state owner:**
- On opening Countries with **one** region selected, initialize Country Details to that region's exact native `owner` key (from `api.getRegionSummary`), never its fuzzy alias. A bulk/mixed selection does not guess a country, and later map clicks do not override the author's selected country.
- Creating a new country no longer inserts its own primary name as a redundant alternative alias. After creation, it opens that country's Overview and collapses the picker, preserving a registered landless polity until the author assigns territory.
- **Transfer all territory** now presents a region-counted consent dialog *before* selecting or moving any regions. It explains the source country's continued existence without territory and that map Undo may not reverse the transaction. The native owner-update call, stable keys and user choice are preserved.
- Updated the existing English source localization catalog without changing established translated packs or the Institutions localization assertions.

**Verification scope:** Earlier initial-native UX integration completed full suite, desktop/web builds and disposable 1912 browser tests. This follow-up's 34 focused editor/identity/localization checks passed with 0 failures; targeted ESLint 0 errors / one existing Hooks warning; `git diff --check` 0. A new full-suite/build checkpoint is still being validated separately; do not report final results without observing them. See `D:\OpenHistoria\QAReports\MAP_EDITOR_V2_NATIVE_HUMAN_UX_PASS3_20261120\CHECKPOINT.md`.

**Not a complete Map Editor V2 release:** author visual approval, full UI theme coverage, deep native regime replacement, fully reversible bulk/import/projection actions and complete scenario readiness remain on N022. Preserve the branch uncommitted and N022's stable ID.

### Same-identity creation preflight — 2026-11-20 (source-rooted follow-up, not release)

The original **Create country** and the Region Inspector's **Create** button followed different native paths. Both compared only literal keys or case-folded display names; this permitted a creator to accidentally register a second country under an existing country's alternative name, former name, or Unicode/punctuation variant. One path also inserted the country's main name as its own redundant alias. This is an identity collision problem, not a matter of visual polish.

**Narrow correction on existing native owners:** `countryCreationPlan.js` now provides an import-free, pure fail-closed name preflight using the canonical Unicode `server/nameKey.js` folding and all occupied/registered keys, display names, aliases and former names. Both `PolitiesPanel.createPolity` and `SelectionInspector.commitOwner` call this before inserting any new polity or reassigning selected regions. A collision reports the existing country's name and tells the author to edit that country; on refusal no new polity record/owner mutation is requested. Both paths register a distinct new name with empty aliases, since the main name resolves independently. `SelectionInspector` also uses `nameKey` rather than its older simple lowercase match for existing key/display lookup. The native `useMapDocument.upsertPolity` and `OlMap.setRegionAttrs` remain the actual owners of mutations.

Regression tests `countryCreationPlan.test.js` cover Unicode-script names, key/name/alias/former-name/territory-only collisions, valid new names and both native UI entry points. **Legacy ambiguous records are not retroactively merged or silently normalized.** `SelectionInspector`'s existing ambiguous-first-match lookup for pre-existing colliding key/name registries is a separate follow-up watch item that may need full collision-aware resolution; do not confuse this creation guard with a general identity-engine overhaul.

QA and package: `D:\OpenHistoria\QAReports\MAP_EDITOR_V2_IDENTITY_CREATION_PASS4_20261120`, to be finalized only after exact full-suite/build/ZIP checks have returned. Remains `N022` Implementing / Partial / Not released.

### Country creation now starts with setup, not registration — 2026-11-20 (N022, P0, WIP)

Creator acceptance feedback showed the existing Countries panel's `name → Create country (no regions yet)` flow to be backwards: it minted an almost empty registered polity before authors could choose anything else about it. The new **draft-first country setup** replaces that quick-create row directly inside the **native** Countries panel. From its now-permanent **+ Create country** action (also visible while editing an existing country), the author enters a bounded, clearly labeled wizard with the sections **Identity**, **Appearance**, **People & forces**, **Relations & land** and **Review**. Country creation happens only after the final review and explicit Create click. The editor returns to the newly authored country's actual Overview, rather than abandoning it in the list.

**Authorable before creation:** canonical name, alternative names and explicitly authored former names, scenario note, optional flag via existing FlagPicker, custom map colour or automatic palette, starting tags (native 8 × 32-character limit), starting population, optional full native MilitaryFields overrides (including explicit zero), starting overlord / relationship kind / secrecy / loyalty, and an explicit choice whether to assign currently selected regions. Choosing a flag is staged in the draft; uploading a flag also saves that file into the reusable **My flags library** as the existing FlagPicker already does, and the new setup tells the author so.

**State and safety:** `CountryCreationForm.jsx` holds only ephemeral React draft fields; no registered polity or map owner is written while navigating, cancelling or previewing. `countryCreationDraft.js` performs a pure fail-closed preflight on final data, reusing the existing canonical Unicode identity collision planner, runtime population/military/tag normalizers, and `scenarioPuppets.setOverlord` contract. No invented population or army figures are filled in. A name, alias, or former name that duplicates registered identity is refused before any write. Optional authoring callbacks (colour, flag, tags, puppets) must exist if their draft settings were provided; missing callbacks fail closed instead of dropping a property. The existing `useMapDocument.upsertPolity`, `setColorOverride`, `setFlag`, `setTags`, `setPuppets`, and `OlMap.setRegionAttrs` remain the only canonical mutation owners, invoked only after validation and any required explicit selected-region transfer confirmation. This does **not** claim cross-geometry/doc transactional rollback or universal Undo: optional starting territory assignment remains subject to the same map Undo limitations, made explicit before commitment.

**Integration:** `PolitiesPanel.jsx` now toggles a separate creation view, keeping existing search, roster management and Country Details editing intact; `MapEditor.jsx` routes draft-flag picks back to the local form without applying a live country's flag until Create. The standalone UX mock remains separate and must not be packaged into the PR. The Scenario Editor still owns deeper political actors/ideology and those fields are **not** faked in this Map Editor form.

**Evidence:** `countryCreationDraft.test.js` covers complete authored records, unset vs zero, aliases/former name collisions, population/tag bounds, native puppet constraints, invalid colour/flag and no state mutation. Focused editor tests passed; desktop production build passed. The full source suite returned **10,066 pass / 0 fail / 2 skipped / 2 TODO**, process exit 0. Browser QA on a completely isolated port 3002 scenario copy verified opening the real Countries panel and wizard, Cancel discarding without country creation, setting alias/map colour/tag/population/puppet, reviewing, and creating a country whose true Overview reflected the chosen values. A separate browser pass selected an existing Bulgaria flag in the reusable FlagPicker, confirmed it remained staged, then cancelled; the registered country count stayed at 80. Browser automation does not substitute for creator visual acceptance in Firefox. All evidence: `D:\OpenHistoria\QAReports\MAP_EDITOR_V2_COUNTRY_SETUP_20261120`. Final exact-source desktop/web builds and packaging are checkpointed separately.

**Status:** N022 is still **Implementing / Partial / Not released**. This is a necessary creator-workflow improvement, not the complete Map Editor V2, native full-identity/regime migration, global Undo or destructive import/recovery implementation.

### Stable toolbar positioning — creator feedback hotfix 2026-11-20 (N022 P7, WIP)

The creator observed that switching tools shifted **every icon horizontally**, because the selected tool's variable-length name was a normal flex child at the right edge of the centered toolbar. Source inspection confirmed the exact cause in `EditorToolDock.jsx`. The active-tool name is now shown as a small themed label **above** the toolbar (absolute-positioned against the toolbar's own relative container, horizontally centered, non-interactive); no tool is removed or reordered. This preserves button and dock geometry when selecting tools with short or long names.

Regression `editorToolDockLayout.test.js` enforces that the label is absolutely positioned outside the flex layout. **Native browser acceptance** on a disposable isolated 1912 Map Editor at localhost:3002 measured all 18 tool-button positions while activating nine modes: V, B, M, L, C, T, X, W, D; **zero detected shifts**, and toolbar width remained **1040 px** for all nine states. Each tool's active label remained above its border. `DOCK_STABILITY_BROWSER.json` records the measurements. The focused tests **7/7** passed; the exact-source desktop build passed; and full `npm test` completed **10,075 pass / 0 fail / 2 skipped / 2 TODO (10,079 total)**. Cumulative 41-file source overlay and Notion N022 acceptance checkpoint preserved separately under `D:\OpenHistoria\QAReports\MAP_EDITOR_V2_DOCK_STABILITY_20261120`. This does not imply the full Map Editor V2 is released.

### Panel-side Settings accessibility - BETA-6 N022 follow-up (not released)

Source-verified root cause: when the sidebar was docked on the left, its 200px Settings popup opened outward into a higher-layer editor panel, hiding the "Right" option. The existing uncommitted `EditorSidebar.jsx` now anchors the popup with `right: 0` on both sides, inside the 268px sidebar. `MapEditor.jsx` retains the single side-position state owner; the higher-layer editor panel is not globally reordered.

BETA-6 checks: focused docking/workspace/theme tests 11/11; full `npm.cmd test` 10,077 passed / 0 failed / 2 skipped / 2 TODO (10,081 total); desktop `npm.cmd run build` exit 0. In disposable 1912 Chrome QA at localhost:3001, the sidebar switched left -> right -> left (x=0 -> 1156 -> 0 at 1414px viewport), the country setup panel shifted to avoid it (x=295 -> 27 -> 295), and a staged, unsaved country-name draft survived both switches. The test used React DOM interactions and observed layout, not accepted physical pointer hit-testing: unrelated full-screen landing-page artwork still covered the editor in this isolated headless browser. Human Firefox mouse/visual acceptance remains pending. No final Create or Apply occurred, and no new polity was registered by this test.

The branch remains uncommitted, unpushed and unreleased. Remaining N022 work includes consistent Polity wording, starting relations, Scissors reliability, map-detail levels, other tool workflows, safe imports and Undo.

### N022 P11 - starting diplomatic scores, canonical commentary and working-document persistence (2026-11-20, unmerged)

**Underlying correction and store completeness:** The new scenario starting-score authoring uses native `world.relations`, not a separate country metric or puppet record. In the first actual Save test on a disposable 1912 source clone, exactly one of 23 bilateral rows changed: Bulgaria-Serbia +12 / neutral to +37 / cordial with the same stable relation ID; 22 other relation rows remained identical. That Save also revealed an unacceptable erasure of the author's existing relationship summary. The narrowly revised `scenarioStartingRelations.js` updates score/status and stable endpoint identity without clearing an existing authored summary or historical provenance. Newly created pairs can have a blank initial summary, but editing an existing pair cannot erase its text. Focused regressions reproduced this defect before the fix (4 failing) and passed afterward (16/16).

**Working-map persistence:** A separate source audit found `MapEditor.jsx` did not emit `relations` and `relationEdits` in `buildDocumentFields`, while `server/mapEditorFields.js` also omitted them from `DOCUMENT_FIELDS` shared by both desktop JSON and web IndexedDB document stores. This would silently drop a draft on working-document Save/Reload, even where a direct scenario Apply succeeded. Added native field handling to both exact owners, preserving default empty arrays for legacy documents, and added tests to `server/mapEditorFields.test.js`, `src/runtime/web/editorStore.test.js`, and `src/Editor/editorNativeWorkspaceIntegration.test.js`. Five targeted tests failed first; then 37/37 focused passes verified desktop, web and UI payload contracts. No separate relation ledger, new store or weakened schema was introduced.

**Final automated gates on corrected P11 source:** Windows `npm.cmd test` **10,099 total / 10,095 passed / 0 failed / 2 skipped / 2 TODO**, exit 0. Production desktop `npm.cmd run build` and `npm.cmd run build:web` exited 0, with six verified web map assets (66.1 MB); existing large-bundle warnings unchanged. English catalog remains additively expanded by 21 source strings and i18n tests passed at the preceding corrected checkpoint. Full-file source packaging and latest lint/diff checks are recorded in the corresponding D-drive QA checkpoint.

**Second real-client scenario replay:** An independent disposable 1912 copy of 17 scenario source files was restored from original SHA-256 evidence and served from a separate isolated localhost:3004 runtime. The actual rebuilt Map Editor Countries > Diplomatic relations tab updated Bulgaria-Serbia +12 to +37 and used the application's normal Save (Quick border-clean path), never Apply & Play. Read-only comparison after native Save confirmed 23/23 canonical relations retained, exactly one changed ID (`relation-scenario1-v12-01`), new score +37, cordial status, **all 182 characters of the original authored summary retained**, and 22 other relationship rows unchanged. Evidence: `D:\OpenHistoria\QAReports\MAP_EDITOR_V2_STARTING_RELATIONS_20261120\P11_SCENARIO_RELATIONS_ACCEPTANCE.json`, source-world hashes and live browser logs. The real Save can also invoke existing map topology cleanup; the comparison establishes relation integrity, not universal whole-scenario byte identity.

**Custody and remaining gates:** This is an isolated, uncommitted, unpushed, unmerged Beta Map Editor V2 implementation, not a public installer or release. The original scenario and game save remain untouched, while P10 failed-state and P11 successful QA copies are both preserved. The broader N022 release and human Firefox physical-click, multi-platform, Undo, import, Scissors, Streets, and complete creator acceptance are still open. A verified cumulative repository-relative ZIP and SHA-256 manifest are kept under `D:\OpenHistoria\QAReports\MAP_EDITOR_V2_STARTING_RELATIONS_20261120`; prior P9 source/QA evidence remains historical rather than overwritten.

### Native starting bilateral diplomatic relations - BETA-6 N022 P9 (2026-11-20; not released)

The Map Editor now provides author-controlled **starting diplomatic scores (-100 to +100)** for both the draft-first new country wizard and the selected existing polity's dedicated Diplomatic relations tab. This is separate from the existing overlord/puppet relationship and from authored treaties/agreements, which remain Scenario Editor concerns. Unset means no authored pair, **0 is an explicit neutral score**; no AI-invented scores, blanket neutral backfill or hidden simulation writer.

**Canonical ownership:** `world.relations` remains the only authoritative bilateral record. `scenarioStartingRelations.js` validates stable polity keys and an unordered pair, strict whole-number range, uniqueness, and the existing maximum of **256** relations. It supports name-key folding and explicit scenario-authored aliases/former names when reconciling historical endpoint spellings; ambiguous identity or duplicate canonical rows fail closed for the affected pair. No other relationship is rebaselined. An explicit edit updates a single pair's score/status; Unset deletes that pair, and untouched source rows, treaties, and unrelated historical metadata stay intact. The Map Editor loads actual scenario relations through `libraryBar.jsx`, stages edits in the existing `useMapDocument.js` owner, serializes through `buildGameSeed`, then applies only explicitly changed pairs against the latest world in the native scenario-save seam after existing polity rename/reconciliation. Explicitly removed polities also drop their own bilateral references (including source-authored aliases), without deleting unrelated pair records. A source save with no relations edits does not overwrite the existing world ledger.

**Concurrency and durability:** A saved operation is settled by the exact staged edit objects included in that successful request, not by removing the first N pending objects. A new edit of the same pair made while Save is in flight remains pending for the next save even if it has the same score. Existing scenario/geometry and game-bridge authority boundaries remain unchanged, and no unsupported cross-document transaction or universal Undo is claimed.

**Verification, current source:** `scenarioStartingRelations.test.js` and `scenarioStartingRelations.integration.test.js` plus neighboring Country/Map Editor source tests give **42/42 focused passing**; the final post-concurrency complete Windows `npm.cmd test` ran **10,096 total / 10,092 pass / 0 fail / 2 skipped / 2 TODO**, exit 0. `src/runtime/i18nCatalog.test.js` passed after **21 additive English catalog entries**, preserving all previous catalog values. Targeted ESLint passed with zero errors (three prior React Hook warnings); `git diff --check` passed after removing one blank-line whitespace artifact. Exact-source desktop `npm.cmd run build` and web `npm.cmd run build:web` both exited 0; web staged six verified PMTiles/GeoJSON assets totaling 66.1MB. The existing large-bundle warnings remain. Tests include a real map document load/export, new-country plan, historical source identities, rename then score update, pair-specific unset, duplicate rejection and newer in-flight edit preservation. **Actual Firefox UI interaction, physical Save/Reload, game start and live-provider country-diplomacy acceptance are not yet verified**, and none of those are implied by unit tests or source builds.

This is a cumulative Map Editor V2 source candidate on `feat/beta-map-editor-v2-2026-11-20`, pinned at base `6b822bcf4875be4d9f8276c5c21b7ac80bca5d9d`, **uncommitted, unpushed and not released**. The additional standalone N022 backlog (Scissors rapid-cut, Streets reference detail, Polity-wide terminology and identity, Groups/Places/Terrain/imports, Undo and native acceptances) remains open. Preserve previous checkpoints.

### Native tool palette and multi-region editing — 2026-11-20 (N022 continuing, not released)

In creator review, the compact Map Editor tool dock required professional organization and visible single-key shortcuts, while the Move tool could only translate one clicked region despite a multi-region selection, and no rectangle-marquee selection existed for **regions** (the old `feature-box` handled only map features). These are functional editing issues, not just styling.

**Integrated native changes:** `editorToolCatalog.js` now retains all 17 original IDs and adds `region-box`; five task-based groups organize Select & navigate, Draw & edit borders, Move & paint, Places & units, and War geography. `EditorToolDock.jsx` uses 43px icon buttons with a compact bottom-right shortcut glyph and matching title/accessible labels. The advertised examples are **Select V**, **Move B**, **Rectangle M** and **Lasso L**; all 18 tools have distinct unmodified single-letter shortcuts. `editorToolHotkeys.js` and the existing `OlMap` keyboard listener route shortcuts through the current canonical `useMapDocument.setActiveTool`, without capturing text field typing, Ctrl/Cmd combinations, modifier keys, modal dialogs or incomplete drawing actions. Undo/redo/copy/paste remain with their existing native key contracts.

**Native rectangle select:** `OlMap` now mounts an OpenLayers `DragBox` for `region-box`, separate from the existing lasso and feature-box tools. A dragged rectangle includes all registered regions whose *geometry actually intersects the rectangle* (not a bbox false positive). Shift-drag adds to existing stable region IDs; normal drag replaces the selection. The pure `regionsInRectangle` helper in `regionSelectionTools.js` has regression tests for intersected features, exclusion, replace, Shift-add and deduplication.

**Native multi-region Move:** `regionMoveInteractions.js` installs two real OpenLayers Translate interactions with source-owned features, group priority before single fallback. If the pointer starts inside **a selected region**, it moves all current selected regions together; on an unselected region, only that region moves. The pre-existing `shapeEdits.trackMove` captures the complete geometry group before and after the drag and commits one Undo/Redo command, preserving original feature IDs, owner fields and explicit `edited` geometry flags. Tests exercise actual OpenLayers Translate pointerdown/drag/release and undo/redo, including an unselected neighbor. **Limit:** moving regions relative to unmoved neighbors can create new border gaps/overlaps; the editor warns about this and existing border-repair/save safeguards still apply. This is not a new transactional topology engine.

**Validation:** Focused native tool/editor/shape/keyboard/localization tests **23/23 passed** and targeted lint returned **0 errors, two existing unused eslint-disable warnings**. English source catalog was expanded by 14 extracted strings with no loss of previous entries; initial `git diff --check` passed. Final full-suite, desktop/web builds and disposable-browser checks recorded separately at `D:\OpenHistoria\QAReports\MAP_EDITOR_V2_TOOL_WORKFLOW_20261120` after completion. The original scenario and existing N022 branch are not committed or pushed. This is another stable development checkpoint, not completion of the full Map Editor V2 acceptance.

## 1. Intent, scope, principles

The Map Editor is powerful but difficult to discover and operate. **The goal is not to simplify the simulation by removing functionality; it is to make every existing capability understandable, visible, and directly editable.** This is a complete creator-workspace redesign with clear navigation, polished responsive hierarchy, the same appearance preferences as the modern game, and safe workflows that protect scenario makers' work.

**Product decisions already accepted**
- Map Editor V2 is priority #1; do it on a dedicated Beta branch, preserving other worktrees.
- The Map Editor is the primary target; Scenario Editor gets only necessary cross-navigation and owned-data integration.
- Selecting a country should expose **everything known about that country** from one entry point, with direct editing or a clearly labeled link to the actual canonical editor.
- Use ordinary labels; show current values, including **all** aliases. Adding and removing an alias is an obvious interaction, not a JSON import.
- Rename is explicit and **does not automatically create an alias of the previous name**.
- Changing a country's political/entire identity must not require deleting it, building a replacement country and repainting all territory.
- Preserve working features, validators, identity invariants, and the distinction between intentionally unset data and zero.
- Follow the existing device-local UI appearance tokens consistently. Partially recolored navy/cyan chrome is not acceptable.

**Design goals**
1. *Find:* creators know where to start without Discord guidance.
2. *See:* the relevant country's/map's current data is visible, including absent/unset state.
3. *Change:* operations are direct, with explicit effect and scope.
4. *Trust:* saving, undo and destructive changes have predictable, documented consequences.
5. *Finish:* creators can review, export, launch, and re-open a playable scenario without losing authored facts.

This specification is not a claim that these behaviors exist now. Sections labeled **Proposed** are implementation targets subject to native contract/test validation.

## 2. Source-of-truth map (keep the boundaries)

| Data or behavior | Existing owner / implementation | V2 contract |
|---|---|---|
| Regions and geometry | OpenLayers VectorSource inside src/Editor/OlMap.jsx, exposed as api.* to MapEditor.jsx | Keep the performant geometry owner; UI manipulates it through validated commands |
| Workshop metadata, polities, flags, colors, tags, groups, units, war areas | src/Editor/useMapDocument.js | One source per editable map document; no duplicate React shadow truth |
| Published scenario world and player country | Scenario assets/write bridge in src/Game/GameUI/libraryBar.jsx | All scene-changing operations pass through the existing guarded scenario save/Apply bridge |
| Political World/government/party/actor state | World and dedicated Political World editor in GameUI; server/polityRename.js migrates actor keys | Country Details displays a grounded summary and links to the real editor, not a second independent political actor record |
| Polity identity resolution | src/runtime/polityIdentity.js; Workshop rename in server/polityRename.js | Preserve declared stable keys, reject ambiguous aliases, never infer identity from territory count |
| Local map document persistence | src/Editor/documentIO.js, documentSaving.js, MapEditor.jsx | Existing queued autosave/retries and save error recovery remain intact |
| Map undo | src/Editor/OlMap.jsx, documentUndo.js | Audit scope; aim for consistent undo for V2 user edits, without pretending existing map-only undo covers all fields |
| Theme preference | src/runtime/uiTheme.js and document-root --oh-ui-* variables | Entire UI chrome consumes existing tokens with original-style fallback; map/flag/status semantic colors remain independent |

**Current complexity:** embedded scenario mode has a **two-step persistence boundary**: Map Editor can autosave its working document while edits remain unapplied to the actual scenario. V2 must never collapse those states or display misleading “All saved” when the scenario is still pending.

## 3. Proposed information architecture and navigation

### Overall Map Editor shell

- **Header:** Map/scenario name, scenario context, selected country, explicit save/application state, Undo/Redo scope, Back to scenario.
- **Main navigation (human actions):**
  1. **Countries** — overview and full Country Details.
  2. **Territory & Borders** — select, assign, draw, merge, split, move, lasso, paint, claims, region types.
  3. **Places & Units** — cities, landmarks, bases, starting forces, group ownership.
  4. **Groups** — organizations/militias and their territory/military/description.
  5. **Terrain & War** — terrain, forts, climate zones, water freezing and simulation effects.
  6. **Maps & Appearance** — map layers, backgrounds, basemaps, reference images, projection, flags.
  7. **Import or Generate** — raster/GeoJSON/metadata, HOI4 inputs, world generation, clipboard and reuse.
  8. **Review & Save** — unsaved changes, scenario readiness, warnings, undo limits and apply/play/export.
- **Context panel:** changes with the selected entity, displaying its summary and immediately available actions; no permanent grid of 17 unlabeled icons as the main navigation.
- **Advanced tools:** grouped tool palettes in the relevant task space. A creator can still perform precision shared-border work, edit vertices, change pathfinding parameters, import province metadata, and use all existing expert functionality.
- **Search:** one search entry with explicit result types Country / Region / City / Map feature / Group. Never silently create an entity just because the search text matched no visible result.
- **Desktop and mobile:** responsive space management; no feature disappears solely because the window is narrow. Keyboard, mouse, touch and hover-independent labels are essential.

### UI terminology

Use *Country*, *Alternative names*, *Former names* (only if meaningful and authored), *Territory*, *Claims*, *Government*, *Starting forces*, *Regions*, *Map background*, *Saved map*, *Changes not yet applied*, *Change identity*, *Review changes*. Avoid requiring the user to understand *polity*, *GADM*, *owner key*, *alias normalization*, *metadata join*, *source*, *VectorSource*, *tier 1/2*, or *schema* just to complete routine tasks. Expert descriptions may still explain technical specifics.

## 4. Country Details (the first complete vertical slice)

**Entry:** click a country on the map, click Countries in navigation, search a country, select a region owner, or follow a political-world country link. Every route resolves to the same *declared country*, with no duplicate UI-specific identity.

### A. Overview

Show flag, current name, country color, existing alternative names count, territory count (zero is valid), claims count, starting population if set, starting forces summary, government/political status if authored, notable relationships, and warning/unset signals.

The Overview is a navigation surface, not a second mutable record. Every visible card has an obvious Edit or Open action. Values with no author-established canon display **Not set**; never populate zero/faux facts just to fill a tile.

### B. Name and identity

**Visible by default**
- **Country name:** current name + **Rename**.
- **Alternative names:** every existing alias in a readable list/chips, each with **Remove**, plus **Add alternative name**.
- **Former names:** only if the scenario record truly contains formerNames, clearly differentiated from authored aliases. No automatic history on Workshop rename.
- **Country identity:** *Change identity / government* for explicit in-place world change, separate from simple renaming and from creating a new country.

**Exact rename copy**
> Renaming this country updates its name on the map and in the scenario. Its previous name will **not** be added as an alternative name.

**Alias add/remove copy**
> Alternative names help the game recognize this country. They do not change its government, history or ideology.

**Validation contract**
- Empty, duplicate, own-name and normalized-colliding alias cases get a specific field message and no mutation.
- Check other *declared* country keys, display names, aliases and former names using native identity normalization; do not “pick the first match” or infer identity based on owned land.
- Do not silently merge countries. On an ambiguity show candidate countries and require the author to resolve it.
- Preserve the ability to author landless governments with distinct stable identities.
- No automatic alias creation on rename. Preserve other unrelated aliases only if they remain valid; the current server/polityRename.js Workshop contract removes aliases identical to previous names and retains unrelated aliases. The UI must state those consequences before commit.
- Changes must propagate through document, map owners/claimants, flags/tags/units/puppets, game player country and existing Political World associations through validated native code, not string substitutions in the view.

**Design decision required before implementing “Change identity”:**
The word “identity” can mean (1) rename/rebrand the same country, (2) change government/regime while preserving a state's continuity, or (3) a completely distinct country replacing the original on its land. These must be separate, comprehensible options with their own effects. An alias can never decide this. The native transaction must make the author's intended continuity and replacement scope explicit. Do not implement a fake destructive “Clear everything” button while this contract is unresolved.

**Proposed Change Identity flow**
1. Ask *What is changing?* — Name only / Government or regime of this country / A new country takes this one's place.
2. Display *What will stay?* — territory and claims, public name/aliases, flags, starting forces, relationships, government/actor details, historical references. Show defaults and author choices, no hidden wipes.
3. Check dependencies and collisions; explain any conflict in plain language.
4. Preview the exact country/world records affected, and whether the operation can be undone.
5. Apply one all-or-nothing validated native mutation, or fail closed without changing map/game canon.
6. Show the updated Country Details; save/reopen must reproduce it exactly.

No automatic rewriting of political canon from a modern/similar-sounding name; a new regime requires separately authored political state.

### C. Territory and claims

- Current owned regions and claimed regions (list, map highlight, counts), including zero-region states.
- Clear **Select territory**, **Give selected regions to this country**, **Paint territory**, **Transfer territory from another country**.
- Review impact before mass reassignment; keep legitimate border/claim disputes and other groups intact unless explicitly targeted.
- Link to a region's dedicated editing screen for type, freezing, ownership, disputed-by, group control and geometry; bulk actions describe scope before mutation.

### D. Politics and history (read + route)

- Show what is currently authored: descriptions/starting tags and Political World actor/government/party data only when available.
- A clearly labeled **Edit political setup** opens the existing Scenario Editor's canonical Political World tools. Avoid inventing or duplicating canonical political state inside Map Editor.
- A creator can tell whether this government is continuous with a previous one, a rebrand, a revolution or a separate entity by **explicit authored fields and links**, never an alias-derived assumption.
- If editing metadata requires a change in the other editor, preserve context/return route and indicate whether a save or Apply is needed.

### E. Military and dependencies

- Show the current starting military data, units assigned to the country, overlord/puppet relationships and any separate War Map geography relevant to it.
- Direct **Edit forces**, **Edit relationships** and **See units** actions. Preserve existing MilitaryFields/PuppetFields behavior and validation.
- No inferred force values when authored data is unset.

### F. Appearance

- Current flag preview, **Change flag**, **Remove custom flag / use default**, color preview/edit/reset and map labels where supported.
- Reuse current flag library and appearance sources. Country/map semantic colors must not be overridden by the user's application theme.

### G. Review & changes

- For the selected country show *Edited* / *Not yet applied to scenario* / *Saved* and a human-readable change list.
- Offer **Undo** only when the particular operation is actually enrolled in a complete history; otherwise warn before consequential non-undoable operations and offer recovery checkpoint.
- Keep the map selected country and related panels in sync after rename, transfer or undo; never strand context on an obsolete key.

## 5. Other Map Editor sections — complete inventory and direction

### Territory & Borders
Keep select, lasso, pan, draw region, vertices, shared border precision, move, delete, dissolve/merge, ownership paint, region type, region claims, groups, freeze, simplify/duplicate, selection clipboard, coastline fit and repair. Replace icon-only discoverability with permanently visible tool names. Explain what is edited on click vs drag, show current selection and active tool, and retain exact topology/region identity checks.

### Places & Units
Unify city and map-feature list/search, add city/port/base/landmark, marker properties, point imports, multi-select/tag, starting military units and their placement. Preserve CityPopup, FeatureManager, UnitPopup and UnitsPanel functionality. Context selection should clarify when the user is editing a location vs a polygon vs an army.

### Groups
First-class group detail entry: name, description, area on map, population, military, color and region assignment/removal. Distinguish **controls this area** from **owns it as a sovereign country**.

### Terrain & War
Accessible terrain, fortified lines, climate zones, seasons/weather, frozen water and imported real-world presets. Provide an “Effect in game” plain-language summary, with raw weights, blend widths, dates and advanced values in an optional Advanced section. Keep season/terrain validators and era semantics.

#### War & Fronts native integration — explicit creator acceptance

This section edits **real engine inputs**, not cosmetic overlays. The feature design must show **whether this scenario actually uses the setting** and what the player experiences, while retaining the separate Scenario Editor's canonical Wars & Fronts feature switches. `warSettingsOf(world).mechanics` defaults its settings to enabled unless a scenario explicitly disables them. An inactive setting needs an obvious **Turn on in scenario settings** action rather than a misleading editable panel whose values have no effect.

| Author-facing action | Existing native consumer | Simple explanation and preview |
|---|---|---|
| **Mark difficult terrain** | `world.terrainAreas` → `Game/AI/frontTurn.js` → `runtime/fronts/arena.js`, gated by `mechanics.terrain` | Draw areas and adjust difficulty levels (1–10). Show which ground is harder to cross and how the game interprets it; keep region-type movement effects available |
| **Set climate and seasons** | `world.climateZones` → `runtime/fronts/climate.js` / `weather.js` / map weather layers, gated by `mechanics.weather` | Draw zones; define weather probabilities, seasonal dates, transitions and effects on combat/movement. Explain that nearby zones blend and that built-in world climates can supply defaults |
| **Choose freezing water** | `world.freezingRegions` with `climateZones` and `frontTurn.frozenFor` | Pick water regions and see when they become traversable ice, governed by temperature/season and enabled weather |
| **Draw fortified lines** | `world.fortifications` → `runtime/fronts/walls.js` / `fortifyOps.js`, gated by `mechanics.walls` | Draw a line, choose its owner and level, show who it protects, and explain that attackers have to break through it and can damage/breach it; in-game War Room construction remains separate |

A **War geography overview** should list every existing terrain area, climate zone, frozen-water region and fortification line, counts, which mechanics are enabled, authors' current settings and validation warnings. Add map-highlighting and season/time preview without promising to run a full battle as a lightweight animation. Never automatically invent scenario climatology or erase unavailable but deliberately authored facts.

**Verification boundary (2026-11-20):** Native consumers and focused front-engine regressions are present in the source. This does not demonstrate that community scenario creators use these features, nor that every configuration produces expected outcomes in a packaged game. Add visual and live-front acceptance in M4.

### Maps & Appearance
One creator-visible distinction between **Scenario's starting map**, **Background map**, **Detailed map**, **Reference picture**, **Map layers**, **Projection and scale**, **Flags**. Show what is currently selected, what the player sees, and what is downloaded separately; preserve library/community/PMTiles flows.

### Import or Generate
- **Import provinces:** choose source (image/HOI4/GeoJSON), align/check, match owners/metadata, preview before/after, review affected countries/flags/cities, verified recovery snapshot, apply, results.
- **Generate world:** show destination clearly **Replace current map** or **Create a new map**; preview generated size/regions/countries/cities and show a recoverable named checkpoint before any replacement.
- **Conversion:** projection/whole-map transforms are special destructive operations; no silent irreversible rewrite. Preserve existing projection restrictions and topology safety.
- **Suggestions:** retain current accept/reject review by change and dependency; clearly show pending/accepted/rejected and when a save persists the decision.

### Review & Save
Show **Working map saved** and **Scenario updated** separately if both exist; emphasize pending scenario changes. Make **Save to scenario**, **Save & Exit**, **Apply & Play**, **Export**, **Close** unambiguous. Border cleanup should be a transparent “check/fix borders before save” step, with summary of what was changed or left unresolved. Existing autosave retries, unload guards, hydrated-map safeguards and guarded write pipelines stay intact.

## 6. Shared design system and accessibility

### 2026-11-20: Theme color compatibility - first implemented chrome pass

The first M1 Country aliases panel initially used `--oh-ui-surface` while the surrounding Workshop sidebar, panels, controls and map background still used fixed dark colors. This caused the author-reported burgundy-on-black mismatch under Settings -> General -> Theme (Oxblood).

In the current isolated V2 branch, shared `editorStyles.js` surfaces and button/field styles now consume **the game's existing `--oh-ui-*` tokens**; `Panel.jsx`, `EditorSidebar.jsx`, `PolitiesPanel.jsx`, `CountryAliases.jsx` and `MapEditor.jsx` align their immediate chrome with the same token family. The alias card is a raised layer *within* the themed parent, rather than a single themed surface inside a fixed-color panel. CSS variable resolution means changing the device-local theme updates styling without game-world state changes or a new theme store. Each token retains its original dark fallback so the **Default (Original)** preset preserves the prior Workshop appearance. War/territory semantic colors, flags and status severity remain independent.

Focused regression `src/Editor/mapEditorThemeIntegration.test.js` covers shared token wiring, all five presets plus custom, original/default fallbacks, immediate Countries and alias surfaces, and preservation of gameplay semantic colors. This is an **incremental theme integration**, not yet proof that all legacy War, import, popup, projection and third-party controls are completely themed. Those surfaces still require dedicated visual acceptance and later V2 design-system work before the overall Map Editor is declared polished.


- Use src/runtime/uiTheme.js tokens on application chrome (`--oh-ui-bg, --oh-ui-surface, --oh-ui-raised, --oh-ui-header, --oh-ui-active, --oh-ui-hover, --oh-ui-text, --oh-ui-muted, --oh-ui-line, --oh-ui-focus`) with fallback to intentional Default appearance. Check **every** popup, select, focus, drawer, hover, modal and overlay for consistent theme integration. Never recolor polity flags, map ownership, danger semantics or war indices.
- Replace scattered hard-coded chrome and tiny text with shared primitives/spacing and readable panel widths; avoid a new hard-coded navy/cyan theme.
- Support keyboard focus visible without hover; label icon-only actions and destructive consequences; make mobile controls reachable.
- Respect current i18n catalogs. New user-facing copy needs translation keys before release, and wiki/help screenshots must match current UI.
- Preserve large map performance; avoid recomputing 3,500+ polygons on every country field keystroke or copying the entire world for presentation.

## 7. Implementation stages and independent release gates

**M0 — This design specification (first checkpoint)**
- Complete area and owner inventory, endorsed outcome and UX copy, branch and Notion workstream.
- Resolve the three identity-operation semantics before coding any destructive country replacement.
- Gate: source review and product acceptance; no claim that UI is implemented.

**M1 — Country Details vertical slice**
- Country selection from map and list; Overview and Names & Identity first, direct alias CRUD (using strict native validation and clear errors), Rename with no auto-alias, existing country flags/territory/tags/policies visible or linked.
- Implement native in-place Change identity/regime transaction only after source-of-truth design is approved. Do not ship a fake or partial replacement path.
- Regression suite: duplicate and normalized-colliding aliases, exact stable keys, landless polities, map-owner inputs, rename/re-key and political actor/relations, save/reopen scenario, refusal atomicity, theme focus/hover.
- Gate: first-time author can do the Discord example end-to-end without JSON or technical help.

**M2 — Workspace shell and state clarity**
- New task-first navigation, labeled tools, country/region context, consistent theme tokens, desktop/mobile layout.
- Reliable Undo scope and visibly distinct document vs scenario save/application state.
- Gate: every one of the 17 existing editing tools and all present panel workflows remain discoverable and functional.

**M3 — Map authoring and recovery**
- Safe generate/import/replace/conversion, recoverable checkpoints, import impact previews, border cleanup as reviewed operation; Geometry/War/Types/Map-asset specialized sections.
- Gate: no unexpected map replacement; imported maps and scenario assets round-trip with no lost edits; checks/guards not weakened.

**M4 — Creator acceptance and release**
- Updated wiki/inline onboarding and translations; real creator sessions with at least three scenario makers spanning historical, fictional, and complex imported maps.
- Run focused regressions, full suite, desktop/web builds, installed Electron/web visual acceptance across every theme, export/re-import/playtest, scenario compare and manual PR review.
- Do not mark released until source merged, installer built from reviewed commit, installed and actually verified.

## 8. Adversarial acceptance matrix

| Journey | Mandatory result |
|---|---|
| Select a country via map/list/search | Same canonical country shown; no duplicate UI state |
| Add/remove alternative name | List immediately reflects state, survives save/reopen, cannot silently collide |
| Rename a country | Previous name is not auto-added as alias; all owned region/claims/actor references remain correct; no merged polity |
| Change government of existing country | Keeps/changes exactly author-selected canon; no deleted territory or spurious inherited ideology |
| Replace country with a different one | Explicit consequences/preview and all-or-nothing native operation; no orphaned foreign keys |
| Landless polity | Can be selected, renamed and authored without territory |
| Flag, color, tags, population, units, puppet status | Visible from Country Details and persist through scenario apply |
| Bulk region reassignment | Correct owner/claims and geography; author sees affected count; undo or recovery is truthful |
| Generate world/import provinces | Cannot unexpectedly destroy current map; preflight and recoverable snapshot before replace |
| Standalone document save | Saved working copy remains recoverable after close and reopen |
| Embedded scenario save | Working copy vs scenario application statuses are clear and correct |
| Apply & Play | Launches a new game that reflects authored country/region/political state |
| Theme selection | ALL editor chrome matches selected theme; map/polity semantics remain unchanged |
| Validation failure | Refuses mutation; explains problem; author can recover without broken canonical state |
| Advanced specialist tool | Existing capability preserved and discoverable; no deleted options |

## 9. Implementation watch items: do not paper over

- Current SelectionInspector.resolvePolityKey accepts country key/display name but not aliases; its first-match fallback is unsafe for collisions. Design one editor-native resolver whose behavior matches canonical polityIdentity, while retaining explicit existing keys.
- PolitiesPanel.createPolity currently starts with aliases containing its own name; the new alias management must be clear whether that self-name is redundant/hidden, and migrate it consistently without corrupting existing records.
- Current rename in MapEditor first calls OlMap.renameOwner then d.renamePolity (React state); d.renamePolity catches a refusal and returns the old document. Investigate this potential cross-owner atomicity seam before implementing rename improvements. Do not assert it is a reproduced bug until a focused regression demonstrates it.
- Some map document edits bypass command undo; test each promised command, not just geometry operations.
- Current FMG generateFromFmg directly loads regions and replaces cities/background with no inspected author confirmation/snapshot. Preserve the current source until a safer transaction can be implemented.
- Province import explicitly allows continuing after failed backup with no Undo; revisit as a release-critical safety decision.
- docs/map-editor.md is detailed but contains stale file descriptions (e.g., references to retired Toolbar/BottomBar), and the user-facing wiki describes aliases as editable without visible direct alias input. Update only documented discrepancies when implementation catches up.
- The current source baseline and requested rework are **Beta**, not Continuum, a published installer, or another worktree. Keep all tracks distinct.

## 10. Open decisions requiring evidence before production mutations

1. For a new political regime: what in world.politicalActors, diplomacy, leaders, party state and history is preserved or cleared by author choice, and how does a save perform an atomic transition?
2. Should explicit Alias CRUD accept self-name aliases retained in legacy documents? Define normalization, UI display and migration without inventing a second canonical registry.
3. Do generated worlds default to a new document, or may they replace the current map with a verified checkpoint? Ensure all source layers and cities follow the same transaction.
4. Is the right implementation of global Undo a compound transaction log spanning MapDocument + OL, or a bounded “Undo on map” plus explicit property-edit history? Choose based on actual callsites and persistence.
5. How does Country Details link to the existing Scenario Editor's Political World panel while preserving in-progress context and explicit save boundaries?
6. Verify the default and themed color token contracts in live desktop/mobile UI before accepting visual completion.

**Next implementation action:** Complete M0 acceptance, then start M1 with a small, independently tested native alias/identity editing contract and full Country Details UI. A source-only UI mock or an alias patch alone does not complete the requested rework.

---

## P12 - Four native management workspaces (2026-11-20, Beta / N022)

This section supplements, rather than replaces, the initial M0-M4 design and the P11 relationship-authoring checkpoint. Source code and tests are authoritative for actual behavior. P12 is an intermediate implementation, **not a release or completion of all M0-M4 gates**.

### Creator feedback and the UX problem

Actual 1912 scenario editor screenshots showed Regions (4,426 regions), Places (3,045 features), starting Units (empty), and Groups (16 non-sovereign actors) as almost entirely flat lists or undiscoverable forms. In particular, region browsing cut off at 300 rows, there were no useful region owner/type/group filters, the feature manager displayed generic "Coordinate" instead of readable geographic positions, the Groups roster emphasized "0 regions" even though political organizations can be landless, and the Units empty state gave no explanation or creation guidance.

The chosen root-cause response is **management workspaces backed by the already authoritative canonical editor state**, rather than adding parallel registries or copying national military data into units. The Polity detail navigation pattern informs the Group editor, while Polities, Groups, regional ownership, point features and units remain separate simulation domains.

### P12 implementation contract

| Workspace | Implemented native interaction | Canonical owner / boundary |
|---|---|---|
| Regions | Query the full OpenLayers region registry without the old 300-result truncation; filter by polity, region type, group control, selected-only; sort; page 60 results at a time; select single, Ctrl/Cmd-toggle, Shift-range, add all matching, invert matching, clear and map-focus; show selected region attributes/claims; edit selected region name, owner, type or group (bulk operations confirm) | The existing OlMap region source, IDs, attributes, selection and native Undo history. Group control does not transfer sovereign ownership. |
| Places & map features | Search/filter category, native kind, owner, and selection across the full feature registry; page through 3,045+ rows; display actual coordinates, owner, kind, IDs, region links and authored context; place cities or non-city features via original map tools; open the existing full CityPopup/MarkerPopup from a row; preserve seed/file imports, bulk tags, multi-selection and Undo-backed delete | The existing document feature list, point geometry, map selection and native city/marker editors. No separate city database. |
| Starting Units | Proper empty-state explanation: absence of placed counters is not proof of zero national military power; use native click-on-map placement; filter by owner and base type, search unit type/composition/orders; inspect formation position, type, strength and notes; open existing full UnitPopup; remove a unit or all units through existing documentUndo row operations and the map command history | The scenario starting unit list and world.units, not country military statistics. Existing user-defined unit types and owner contracts. |
| Groups | Searchable roster, territorial-presence filter, explanatory summaries for landless groups, creation form with optional description/tint; selected-map-region assignment is explicitly opt-in and confirmed; six detail tabs (Overview, Identity, Territory, Forces, Appearance, Manage); descriptions, population, military, ownership-of-a-country's-forces, area, rename/dissolve via current native state and Undo | world.groups + world.groupAreas; area control overlays existing sovereign regions. A group's optional owner is the polity whose military force it represents, **not** arbitrary affiliation, party membership or annexation. |

The new shared UI shell is src/Editor/EditorWorkspaceControls.jsx, and the pure search/sort/selection projections live in src/Editor/editorWorkspaceFilters.js. Neither owns canonical map data. Native component entry points are RegionsPanel.jsx, FeatureManager.jsx, UnitsPanel.jsx and GroupsPanel.jsx, wired by MapEditor.jsx. The old map drawing tools remain present. Region and feature browser pagination bounds rendered DOM rows, not the number of canonical records available to filtering, bulk selection or source export.

### Regression evidence and acceptance limits

- Pure editor workspace regressions cover full 4,426-row region inventories (no 300-row cap), alias-aware polity search, type/group/owner and selected-only filtering, map/list Ctrl/Shift selection semantics, city-versus-marker category filtering, native unit type/composition lookup, and groups that have no controlled territory.
- P12 source tests also exercise existing document undo, map editor wiring, polity-tab safety and region search. All new UI operations must remain under existing native save semantics; no additional save ledger or scenario persistence whitelist was introduced in this batch.
- A read-only desktop Chrome DevTools browser walkthrough uses **only localhost:3001**, the owner's established 1912 QA data directory and existing QA Chrome. Its DOM assertions do not substitute for Firefox physical pointer, visual comparison, destructive bulk-edit, full Save/Reload/Undo, or installed Electron acceptance. An existing headless screenshot session produced stale frames; do not treat those PNGs as validated UI images.
- Source changes stay in the dirty feat/beta-map-editor-v2-2026-11-20 worktree at pinned HEAD 6b822bcf4875be4d9f8276c5c21b7ac80bca5d9d. No Git commit, push, merge or deployment has been authorized. The localhost:3001 backend retains its original QA scenario data.

### Still outstanding

This workspace implementation addresses the specific Regions, Places, Units and Groups screenshot failures at the functional-navigation level, but it does not complete all V2 sections or sign-off. Remaining work includes Region Types and Clipboard workflow, native Scissors/border-cut reliability, Streets and geographical reference layers, Terrain/War management, Maps/Appearance, import/generate safety and recovery, Review/Save usability, wider Polity terminology consistency and remaining identity invariants. Human visual/pointer acceptance, all scenario creator journeys, translation coverage and release gates remain open. Do not mark N022 complete or released on the strength of this checkpoint alone.

### P12 sealed QA verification and remaining visual acceptance

After recovering three actual regressions in the first full test run (English i18n catalog coverage; existing Map features title; Groups' established starting-population label) and one new institution-localization collision, all targeted tests passed without reducing test or schema strictness. An interrupted run had then passed, but the developer corrected a few accidental Windows-transcoded question-mark separators/icons in the Places workspace and re-ran the entire validation pipeline on the final source.

**Sealed final P12 validation, Windows 2026-11-20:** `N022_P12_VALIDATE_SEALED.ps1` exited 0. `npm.cmd test`: **10,105 total, 10,101 passed, zero failures, two skipped, two TODO** (`P12_FULL_SUITE_SEALED.log`). Desktop Vite production build exited 0 (`P12_DESKTOP_BUILD_SEALED.log`); `build:web` exited 0 with **six individually verified source map assets totaling 66.1 MB** (`P12_WEB_BUILD_SEALED.log`). Targeted ESLint and `git diff --check` exited 0, with no lint output and Git's existing LF-to-CRLF advisories only. The main asset served by the existing **localhost:3001** exactly matched the newly built desktop `dist/index.html` bundle. Existing Babel transform/large-chunk advisory warnings remain; no validation was bypassed.

**Real application browser smoke:** `p12BrowserWorkspaceAcceptanceSealed.mjs` navigated the established 1912 scenario on the existing localhost:3001 browser and passed **7 of 7 DOM functional assertions**, with zero runtime exceptions: native map editor rendered; Regions filters and selected-region inspector; six Groups detail tabs; Places category/owner filters and Addis Ababa's expandable full-city-editor action; and a useful zero-starting-unit explanation. Observed scenario inventories: 4,422 regions, 3,045 places and 16 groups. Previously completed first-run browser checks were also 6/6. The onboarding buttons were already completed in the persisted QA profile; their absence on a return visit is expected. CDP screenshots were obscured by an existing VaultDoor splash and are **not** accepted as live visual or physical-click evidence. No P12 scenario Save or Apply was performed.

The final full-file source custody is maintained by the reviewed `packageSourceOverlayP12.ps1`, which builds the **59-file cumulative P12 overlay** from the original 52-file P11 manifest plus seven P12 panel/helper/test source files, preserving repo-relative paths, the pinned Beta branch/HEAD and per-member SHA-256 comparisons. Its ZIP hash and manifest are stored in the separate QA report, not duplicated as a mutable source-code claim. **N022 remains Implementing / Partial / Not released.** Human Firefox visual, actual pointer input, cross-workspace Save/Undo, import recovery and the remaining N022 sections are still release gates.

---

## P13 - Editor workspace continuity + verified native integrity (2026-11-20, Beta N022)

**Authoring state:** development checkpoint in `feat/beta-map-editor-v2-2026-11-20`, based on the clean P12 commit `57603776adc3a3f45f3b1d2c6df04a4a9cd86d43`. **This section documents a partial implementation, not a final Map Editor V2 release or completed creator acceptance.** Preserve earlier P11/P12 architecture, contracts, evidence and outstanding gates.

### Workspaces now implemented natively

- **Region Types:** `TypeManager.jsx` now has all-type and used/unused search/filter, usage counts, clear create controls, and Identity / Appearance / Gameplay tabs. The 64-type limit comes directly from exported `MAX_REGION_TYPES` in `runtime/regionTypes.js` (previously a private constant). The type-delete command refuses to delete the last type or any type still referenced by a region; changing a type in the Regions workspace first is the explicit recovery. `MapEditor.jsx` now updates the type usage count after each native region-change epoch (including Undo/Redo) instead of only when region count or selection changes. Existing type schema and game rules are unchanged. Pure guards and tests in `regionTypeManagement.js` and `regionTypeManagement.test.js`.
- **Clipboard:** Retains original IndexedDB cross-map clipboard format and native `OlMap.pasteRegions` geometry/Undo path. A paste now requires explicit confirmation of destructive overlap and clarifies that imported metadata is persistent. Native type registry capacity is validated **before** carving. The editor imports missing Polity/type/group/color/flag/tag metadata **only when** the native geometry paste actually reports added regions; an empty or unusable paste leaves document metadata untouched. The clipboard UI now shows copied-region/source summary and an explicit clear confirmation. **Known debt:** geometry Undo does not yet atomically undo newly imported document metadata; the UI explicitly discloses that boundary and full transaction-level Undo remains an acceptance gate.
- **Maps & Appearance:** `LayersPanel.jsx` upgraded to a management workspace with counts, grouped descriptions and live visibility toggles, plus Show all / Focus on political regions presets. All seven existing OpenLayers layer keys are authoritative; no new scenario-state layer ledger. Pure `editorLayerVisibility.js` and focused test check the exact keys.
- **Terrain & War:** `WarMapPanel.jsx` now presents terrain, fortified-line and climate-zone counts, name/metadata search, fortification owner filter and paginated roster; uses the existing detailed shape editors, drawn geometry, season/weather semantics and native document storage. Search projection is in `editorWorkspaceFilters.js` with regression coverage.
- **Review & Save:** `EditorWorkspaceNav.jsx` shows native counts for regions/polities/groups/types/features/starting units, the saved/unsaved state, and calls the **existing** `persistScenario({play:false})`, `persistScenario({play:true})` or working-document `saveNow()` through `EditorSidebar.jsx` props. Loading/action busy states disable these actions; no new persistence API was introduced.
- **Polity terminology:** top-level Country menu text is now “Polities”, corresponding detail entry is “Polity details”, while stable editor section IDs, region owners, canonical Polity IDs, country alias lists and engine schemas are **unchanged**. Groups description no longer implies nonexistent membership modeling.
- **Border draw Undo:** The native polygon Draw interaction already uses the OpenLayers region R-tree for candidate carve selection. A verified state-integrity defect was found: Undo restored previously carved neighbour geometry but retained `edited:true` even when the pre-draw region was unedited or explicitly false. The previous `edited` value is now snapshotted per carved neighbour, restored exactly on Undo and reasserted on Redo. `regionCarveHistory.js` and its OpenLayers-feature regression cover unset / false / true semantics. This is **not** a complete scissors/splitting-performance fix: no dedicated line-split tool exists in the audited native tool registry, and complex polygon-clipping latency still requires real playtest evidence before further architectural changes.

### Streets/admin reference design constraint

The current `streets` preset is Esri ArcGIS raster `World_Street_Map`; the engine also supports other Esri raster/PMTiles user detailed maps. Esri's legacy Street Map and World Boundaries & Places raster services have a scheduled December 2029 retirement. **Do not add a new administrative boundary overlay by depending on another sunset service or by treating authored scenario-region borders as present-day administrative reference geography.** A supported vector/boundary provider, licensing/attribution, zoom strategy, caching/offline fallback and historical-versus-present-day reference semantics must be established and tested before implementing Streets outlines. Reference layer redesign remains open.

### Verification and acceptance

Focused regressions and English extraction/language-pack tests were run during development. The post-change full Windows test suite and fresh desktop/web production builds must be recorded in a separate P13 QA checkpoint once they have actually completed; do not infer their outcomes from P12 verification. The live browser acceptance target is exclusively `localhost:3001` and its existing QA scenario; do not start another app server. Human Firefox physical pointer and visual/theme, scenario Save/Reload and Undo/Redo end-to-end, true split/cut performance, Streets reference, import/generator recovery and installed-electron compatibility remain outstanding gates.

**Release truth:** Beta N022 remains `Implementing / Partial / Not released` and must not be conflated with Continuum or a shipped upstream Beta build.

### P13 architecture audit addendum - same checkpoint

**Re-inspected source paths and owners:** `src/Editor/MapEditor.jsx` owns native scenario/apply orchestration and the document field whitelist, which remains mirrored by `server/mapEditorFields.js`; `useMapDocument.js` owns the scenario/draft registries; `OlMap.jsx` owns region source geometry, map command history, and event propagation; `documentUndo.js` supplies document-side commands; `runtime/regionTypes.js` and `runtime/warGeography.js` remain game canonical interpreters. No P13 feature added a parallel mutable ledger or changed world serialization schema. `OlMap` retains the 18 existing native tool IDs. Both desktop and web persist through the pre-existing adapters.

**Corrections after the first testing pass:**

- The `clipboard` panel is intentionally reachable from Territory and Import. The active workspace now passes the selected workspace as a preference to the `workspaceOfPanel` resolver; opening Clipboard under Import no longer unexpectedly highlights and expands Territory. Default one-argument routing is preserved.
- Real-world Terrain or Climate preset replacement now uses `replaceRowsStep` and `api.pushStep` (the existing native Undo stack), restoring the prior complete authored list in one Undo and the preset in Redo. The existing confirmation when replacing a nonempty list is retained.
- The previous region `edited` export-flag restoration bug was also present in **clipboard paste**, **reviewed geometry patches**, and **two simplification paths**, not just draw-and-carve. These native operations now reuse `restoreCarvedEdited` for exact previous `undefined`, `false`, or `true` semantics. Geometry itself is not altered by this flag restoration.
- The actual Polity roster and new-Polity wizard now use Polity wording for visible identity/creation/overview labels; stable country/polity keys, `country-draft` wiring, `CountryCreationForm` source name and political world schemas remain deliberately unchanged. The full cross-application vocabulary audit remains a separate gate.
- English UI extraction coverage is additive, never deletes old catalog strings, and must be validated again after the new labels.

**Further architectural watch items, not silently patched:** Clipboard geometry + imported metadata still lack a guaranteed **atomic** one-command Undo; the UI warns that imported polity/group/type metadata persists and must be reviewed. Most individual authored text/field edits in war geography and other document panels still update canonical document state directly, not via the map's geometry command history. Save-time topology cleanup can stop or fail while allowing a save to continue with original geometry: that established policy and its user-facing diagnostics need a separate verified release decision, not an unreviewed behavioral change. Existing map drawing/tracing, shared-border precision and border dissolve are **not** a true dedicated line-scissors split tool, and their real-world latency/complex-border errors need reproducible interaction evidence. Source inspection does not by itself establish Firefox pointer/theme acceptance or actual scenario Save/Reload coverage.

These are explicit N022 release gates. Do not conflate P13's interface and targeted invariant fixes with an entirely completed or released Map Editor V2.

**Mobile navigation audit:** `EditorWorkspaceNav.activate` now calls the existing mobile sidebar-close callback only when navigation opens a panel or modal. Overview and Review & Save are *sidebar-only* workspaces with no `openPanel` target; closing the sidebar on those actions hid all useful UI and made Review & Save inaccessible. The corrected behavior preserves all other panel/modal navigation and is pinned in `editorNativeWorkspaceIntegration.test.js`. Visual and physical-touch acceptance in a real mobile/Firefox session remains pending.

---

## P14-P15 — Atomic clipboard authoring and session-only modern street reference (2026-11-20, Beta N022)

This implementation continues from the **uncommitted P13 verified worktree** based on committed Beta P12 HEAD `57603776adc3a3f45f3b1d2c6df04a4a9cd86d43`. No commit, push, reset or merge was performed. The Map Editor V2 release state remains **Implementing / Partial / Not released**.

### P14: Clipboard geometry and canonical metadata as one native Undo command

Source evidence: the original `OlMap.pasteRegions` carved or replaced territory and pushed a geometry history command, while `MapEditor.pasteClipboard` separately invoked `d.setTypes`, `d.setGroups`, `d.upsertPolity`, `d.setColorOverride`, `d.setFlag` and `d.setTags` after the paste. This left imported canonical metadata behind if the user pressed Undo.

The new `clipboardDocumentHistory.js` is a pure document-side addition/reversal contract: only missing polity, type, group, colour, flag and tag records are merged; existing target records and their stable IDs win; Polity aliases are normalized as the former `upsertPolity` setter did. An original-document snapshot prevents Undo from deleting a preexisting *identical* record, and records independently edited after paste are retained. The history step is provided to `OlMap.pasteRegions` as an optional `documentStep`: the native geometry operation applies it **only after successfully adding polygon(s)** and nests its Undo/Redo into the **same map history entry**. If the document step throws synchronously, added geometry is rolled back and the command is not pushed. The 64-type preflight guard remains before any geometry changes. The editor's `useMapDocument.setDoc` stays the canonical document owner; there is no alternative ledger.

The Clipboard panel and confirmation now explain that one Undo reverses geometry and automatically imported metadata. This does not imply that Undo also reverses later independent manual edits to imported records—those are intentionally preserved. Tests cover successful merge, both reversals, repeated redo, original-record protection, case-insensitive group identity, empty plans, and the one-command native wiring.

### P15: Optional online street/reference mode without changing scenario map canon

The audited editor already has a live OpenLayers `OSM` source and offline-aware basemap renderer. `World_Street_Map` is a legacy Esri raster provider, and forcing a different URL into the persisted `streets` ID would make preview and gameplay disagree. Rather than changing the meaning of any saved builtin map, Maps & Appearance now exposes a **session-only OpenStreetMap street reference** toggle. The state lives in `MapEditor.jsx`, **not** in `d.doc.metadata`; the existing `OlMap` basemap effect temporarily displays `new OSM()` (with the source's attribution) beneath authored regions when enabled and online. Offline mode retains the editor's established fallback; imported custom image, vector, raster and plain backgrounds take precedence. Closing the editor or reloading resets the preview. `editorStreetReference.js` and tests cover opt-in/online/custom-source precedence.

OSM is **modern reference geography**. Street and available administrative boundary depiction depends on raster tile style and zoom; this is **not** a separate, zoom-independent licensed administrative-boundary vector layer, and it does **not** change historical polity/region shapes. Full independent administrative outlines, historical-vs-modern boundary source provenance, real tile/network acceptance and cut/scissors geometry reliability remain distinct work items.

### QA and release boundary

Native code and pure regression tests were updated, preserving all existing P13/P12 tests and the backend field whitelist. Full Windows regression counts, desktop/web build outcomes, source ZIP hash and browser evidence must be recorded from the actual P14/P15 run in the QA checkpoint before claiming final verification. The test server remains the **existing localhost:3001 only**. Human Firefox pointer, real scenario Save/Reload/Undo author journeys, import/generator recovery, independent boundary source and true Scissors remain open N022 gates.

**P14 follow-up integrity finding:** The legacy `d.setTags` path passes imported tags through `runtime/countryTags.js.normalizeTagList` (trim/collapse whitespace, case-insensitive dedupe, bounded tag count/length). The first atomic-history implementation was audited against that actual setter and corrected to use the **same native normalizer** in its pure planned-field additions and reversible comparison; a focused regression covers duplicates, excess entries, whitespace, and exact Undo. This prevents the new document command from bypassing existing tag invariants.

---

## P16 - High-precision close-up zoom and region-boundary export (Beta N022)

**Base:** clean, user-authorized P13-P15 Beta commit `104040c3dbad05a26adac655c9d71c7e4e9d81c6`. The P16 edits are separate, uncommitted until authorized. P16 is a targeted response to the author's observation that they could not zoom sufficiently close to draw accurate boundaries.

### Verified source-level root cause

The editor's OpenLayers View was configured with `maxZoom: 20`, even though the native region-type presentation supports zoom bands through level 24. The map's "Zoom to region/selection/war shape" helpers also hard-clamped their focus to zoom 8 (owner/group helpers to 7, suggested bbox review to 8). Importantly, the three region geometry writers—working-map full-save, incremental-save and cross-map clipboard—previously exported WGS84 at **five decimal places**, coarsening sub-metre boundary movements regardless of canvas magnification.

### Implemented narrow native behavior

- `editorZoomPrecision.js` establishes one contract: editor zoom **1–24**, region/group/selection/war/suggestion focus ceiling **20**, WGS84 region polygon serialization **7 decimal places**. View `maxZoom` is native OpenLayers, not an overlay scale hack; mousewheel, existing +/- controls, vertex modify, snapping, and region drawing continue through the established map interactions and source.
- The existing +/− zoom control now carries a tiny **live numeric view-level readout** (e.g., `Z 22.0 / 24`). The view's native `change:resolution` event updates the DOM without React canvas rerenders. Unsubscription and element removal occur in the map lifecycle cleanup. Editor-specific stylesheet rules use existing UI theme tokens.
- Automatic navigation to small regions, groups, owners and war shapes can fit as close as zoom 20, but remains bounded to avoid unexpected extreme jumps; the author can zoom manually through 24.
- The **same** seven-decimal `GeoJSON` writer contract is used by full export, incremental `regionChanges.js` persistence and cross-map Clipboard export. Existing Delta IDs, hash comparison, server `regionDelta.js` merge, geometry storage and reference integrity remain unchanged. City/unit point coordinate contracts are not modified.
- Region rendering and editing still use full-resolution canonical polygon geometry. More view zoom does **not** claim new detail from raster basemaps: their native tile providers often stop well before zoom 24 and the imagery will be upscaled. Uploaded high-resolution reference backgrounds can still help when tracing detail. This pass does not implement native line Scissors or redefine historical boundaries.
- `editorZoomPrecision.test.js` exercises OpenLayers View zoom reach/clamping, exact 7-decimal WGS84 export/rehydration, unchanged delta detection and changed delta persistence, and demonstrates that five-decimal rounding would collapse two nearby coordinates the new contract preserves.

### Validation still required
Desktop/web builds, full regression suite and live Chrome `localhost:3001` zoom-to-24 test against a rebuilt bundle must be recorded before declaring this checkpoint verified. Real Firefox physical-pointer drawing and destructive Save/Reload authoring on a disposable QA scenario remain independent acceptance gates.

### P16 follow-up: progressive zoom and integrated zoom control (2026-11-21)

The user validated that zoom 24 is reachable but noted that **one full zoom level per click/wheel notch** is too abrupt when editing a region close up. Because Web Mercator view zoom is logarithmic, each whole level doubles the linear screen magnification; a fine **0.7-level** step instead multiplies screen scale by about **1.625**, allowing finer positioning without doubling the number of clicks. The final behavior is **1.0-level steps below zoom 7** and **0.7 above zoom 7**. A monotonic step-coordinate mapping keeps + followed by - reversible even when crossing the threshold, while maintaining the unchanged hard zoom-1/24 bounds. From zoom 7 to 24 is 25 fine steps, versus 34 for 0.5.

The OL default Zoom control only accepts a constant `delta` and would diverge from the mouse wheel. Editor-only `createEditorZoomControl` replaces **only this map's** stock Zoom control with a standard OL `Control` using accessible keyboard-activatable +/- buttons and native view animation. The existing `MouseWheelZoom` remains responsible for wheel accumulation, trackpad/pinch distinction, mouse anchoring and animation; its already-used `deltaPerZoom_` compatibility seam is updated from the current native view zoom so ordinary wheel notches use the same 1.0/0.7 speed. Trackpad fractional input is not discretized. This intentionally does not change other game/map selectors.

The prior tiny, trailing zoom-level footer becomes a **single vertically integrated zoom unit** with +/- separated by a legible central `Z n.n` value and a muted `ZOOM / 24` caption, clear disabled limits, keyboard focus styling and existing theme tokens. A single view-resolution listener synchronizes the new value and wheel sensitivity; it is removed during map cleanup and the custom control disposes its click handlers. Only the editor-specific class is styled, leaving other OpenLayers controls unchanged. Pure regressions cover step math, threshold reversibility, maximum reach, view limits and native ownership. Browser acceptance must explicitly confirm both buttons and wheel around zoom 7 and the final DOM/CSS presentation.

## P17 - Native safety, canonical government and live acceptance checkpoint (2026-11-21)

**Track:** Beta N022 Map Editor V2, branch feat/beta-map-editor-v2-2026-11-20. The P16 zoom checkpoint was authorized and committed as 6539002b1d0d8e41b1cc27e325bdaa8af6cc1758; P17 source edits remain **uncommitted**, unmerged and unreleased. The original 1912 QA scenario is unchanged. These are implementation/QA findings, not human visual acceptance or a declaration that all N022 work is complete.

- **Scissors:** src/Editor/regionScissors.js implements native line splitting, integrated into OlMap with existing tool dock and single-step native Undo/Redo. Pure regressions cover bent cuts, holes, multipolygons and invalid cuts. Firefox on localhost:3001 confirmed one region split to two, Undo back to one, Redo to two, and Save/reload retaining both canonical IDs.
- **Destructive-map safeguards:** src/Editor/mapRecoveryCheckpoint.js saves and reads back a separate full-map document before destructive replacement. An unverified recovery fails closed. The province importer and fantasy world generator use recovery preflight. src/Editor/fmgReplacementPlan.js defines a coherent regenerated world rather than leaking old polities/terrain/relations into it. A real server recovery checkpoint passed verification without altering the source document. Full interactive importer/generator destructive browser QA is still open.
- **Atomic polity authoring:** src/Editor/polityIdentityTransaction.js validates and rekeys country identity. MapEditor, PolitiesPanel and OlMap combine region ownership and document changes in one native Undo/Redo command for creation and rename. Firefox verified country creation/assignment Undo/Redo, rename Undo/Redo, government working-map Save and reload.
- **Political World canonical ownership:** GovernmentIdentityFields stages only explicit government form and ideology; scenarioGovernmentEdits applies them after canonical country renames in the scenario Save bridge. Only world.politicalActors owns Political Actors. Existing leaders, stable party IDs, territory and diplomatic relations remain intact. After a successful scenario save, the working-map queue is settled field-by-field without discarding newer authored changes.
- **Working-map vs scenario revisions:** useMapDocument tracks user-authored scenario revisions separately from local bookkeeping/working-map autosave. Internal settlement does not imply a new unsaved scenario. MapEditor compares the authored revision with its Save snapshot to keep genuine concurrent edits pending. In Firefox on the freshly rebuilt desktop bundle, government staging cleared after Save, the canonical value displayed and the false Scenario unsaved warning did not recur after working-map autosave.
- **Real scenario Save / Apply & Play acceptance:** Tested solely against isolated clone p17-isolated-apply-qa-1795222011501 of original scenario 1912-a-world-in-balance-2-2-2. Plain Save updated Belgium government form while preserving 79 actors, 79 polity records, 4,422 ownership overrides and 23 diplomatic relations. Apply & Play saved an explicit government ideology and created/activated game p17-isolated-apply-qa-1795222011501-session; the game contained the new Political Actor ideology. QA restored the prior active game and selected original scenario, and the original 1912 scenario world was verified unchanged.

**Evidence and custody:** Focused settlement/source contract tests were green (21/21). An earlier full suite passed 10,154 tests (10,150 pass, 0 fail, 2 skipped, 2 TODO); this preceded the final revision-isolation/source-test addition. Current desktop production rebuild passed, and its exact bundled runtime was tested in Firefox. The QA server on port 3001 serves built dist files, not Vite hot reload. Further final test/build evidence is recorded separately. QA logs and scripts: D:/OpenHistoria/QAReports/MAP_EDITOR_V2_STARTING_RELATIONS_20261120/. Repo-relative source overlays and SHA manifests: D:/OpenHistoria/QAReports/MAP_EDITOR_V2_P17_CHECKPOINT_20261121/.

**Not a release sign-off:** Human UI/theme review, broader editor completeness, interactive full-destructive import/generator QA, referential-integrity and comprehensive Undo audits, region performance at scale and remaining N022 M0-M4 release criteria remain open. No Git commit, push, merge, reset or track crossover is implied.

## P18 - Actual destructive import and generated-world canonical safety (2026-11-21)

**Beta N022 implementation evidence, not release sign-off.** P17's isolated source branch remains uncommitted. Real Firefox against compiled localhost:3001, with an isolated D-drive data root, verified a two-region GeoJSON importer end-to-end: first replacement refusal did not change the scenario; accepting replacement saved/read back a separate 4,422-region recovery document; Save published exactly two regions and preserved all 79 Political Actors. The intended P18 scenario clone was identified through its exact card-scoped Edit button. An earlier QA automation script used a positional Edit button and wrongly altered the P17 clone; that error was diagnosed, evidence-preserved and the P17 and historical source files restored byte-for-byte from a SHA-verified complete QA backup. This was a QA harness mistake, not an editor engine fix.

P18 strengthened `mapRecoveryCheckpoint.js`: its comparison now derives its fields from the single native `DOCUMENT_FIELDS` whitelist, including staged `actorGovernmentEdits`, and verifies all map metadata except store-managed timestamps. Red-first regression proved a recovery could previously pass while silently losing a pending government edit or projection/background. The original localhost:3001 server also held an older imported module predating `actorGovernmentEdits`; it was restarted solely against the same QA data to test current source. The new recovery verifier passed its real server readback without relaxing a check.

**Real generated-world failure and deliberate authority boundary.** With the repository's pinned prepared Azgaar v1.109 asset installed by its existing required vendor script, Firefox generated 86 regions, 12 polities and 340 cities and verified recovery. On a copy of the 1912 scenario, the old scenario Save bridge kept 79 obsolete Political Actors, 23 historical diplomatic relations, wars, agreements, institutions, country Statistics, prehistory and scenario-specific narrative. This was a real canonical integrity defect: replacing an editor map document is not authority to reuse or erase the scenario's independently owned history.

A new source-owned generated-world marker `metadata.generatedWorldReplacementId` survives working-map storage; MapEditor passes explicit intent at Save, and the scenario host checks the latest independent ledgers **before any scenario or asset write**. A generated-world Save against populated independent history fails closed with an explanation to create a fresh scenario, preserving the original and the generated working map/recovery. After a successful Save, only the matching accepted marker is settled; a newer generation made during the write remains pending. Ordinary map imports, polity edits and renames are unchanged. The pure guard and source wiring have red-first tests, focused 9/9 green.

**Actual two-sided acceptance:** A fresh scenario with no independent established canon accepted the generated 86-region/12-polity world, with zero inherited Political Actors, zero orphan actors and zero inherited diplomatic relations; a new QA game created from it retained those records exactly and preserved the previously active game. In an isolated historical clone, the same real generator and recovery worked, but Save was refused before any historical world mutation. Both runs restored prior game/scenario selection. The correct destination depends on *scenario canon*, not the existence of land or the map's geometry alone.

**Still OPEN:** The author-facing destination choice "Create a new map" versus "Replace current map" is not delivered as an integrated seamless flow; a creator currently creates an empty-canon scenario first. Whole-scenario migration or reset of independent treaties, wars, political offices, institutions, historical scripts, Statistics and custom prompt content requires a separate explicit product/owner transaction, not silent deletion. Broad geometry/reference and Undo audit, real creator/theme/localization sessions, installed-client acceptance, upstream merge and public release remain mandatory under M3/M4. Full post-fix suite/build and final package details are recorded separately after execution.

### P18 final source/QA verification and residual watch (2026-11-21)

On the final uncommitted P18 source: `npm.cmd test` returned **10,160 total / 10,156 passed / zero failed / 2 skipped / 2 TODO**, desktop Vite build exit 0, web Vite build exit 0 with six map-cache assets (66.1 MB) verified, changed-file ESLint exit 0 and `git diff --check` exit 0. Source-level recovery/generator/guard tests passed 9/9. Live Firefox successfully tested a two-region import, a fresh generated-world Save, a historical-canon refusal before Save and restored game/scenario selection. Native creation of a game from the fresh generated world preserved 86 regions and 12 polities with zero inherited actors or relations. Original 1912 scenario, P17 QA clone and original QA game's full backed-up source files were finally SHA-verified byte-identical (17/17 + 17/17 + 13/13). Full 129-file pre-QA data backup was independently hash verified. All code changes remain uncommitted; product M4 release gate remains closed.

**Observed working-map persistence watch:** after immediate browser close following successful fresh generated-world scenario Save, the separate Saved Map record still carried the full-world replacement marker even though the canonical scenario was correct. The in-memory settlement guard is source-tested, but its local working-document persistence across immediate unmount is not accepted; a dedicated Save/Exit/Apply race test and native durable-settlement follow-up are required before broad lifecycle sign-off. Do not remove the marker without preserving protection against applying a generated universe over pre-existing independent canon. Also pending are explicit Create new map/scenario destination UX, broad referential/Undo and performance audit, human UI/theme/accessibility and localization reviews, installer QA, merge and publication.

### P18B - Durable local reconciliation before Save & Play unmount (2026-11-21)

**Later, verified correction to the P18 working-map provenance watch above.** The original local document writer `server/mapEditorStore.js` merges nested `metadata`, so simply deleting `generatedWorldReplacementId` from React state did not clear the already-stored marker. In addition, `applyMapToScenario` created/activated the new game and unmounted the Map Editor before its post-save reconciliation could persist. These are general post-save lifecycle concerns affecting accepted polity renames, relation edits and government edits, not just fantasy generation.

`settleGeneratedWorldReplacement` now records an explicit null tombstone for the accepted marker while preserving a newer generated-world ID. The native scenario host accepts an optional `beforePlay` callback and awaits it after scenario+asset persistence but **before** game activation. `MapEditor.persistScenario` synchronously commits accepted bookkeeping into the latest working document via React `flushSync` and awaits the serialized native `saveNow` before returning or permitting game activation/unmount. The reconciled local write does not increment the scenario-authored revision, and an actual newer edit remains pending. If the local reconciliation fails after scenario persistence, the editor remains open with a truthful "scenario saved, follow-up failed" message rather than pretending scenario Save itself failed. An explicit backend regression confirms native metadata merge honors the null tombstone and preserves geometry.

**Verified real Firefox:** on distinct empty-canon P18 QA scenarios, generated 86 regions/12 polities and tested ordinary Save and Apply & Play separately. Before Save the Saved Map had a nonempty `fmg-replacement` marker; after Save an independent server GET confirmed the marker is persistently `null`, matching canonical scenario geography, and on Apply & Play the marker was already null by the time the new QA game became active. Both tests restored the original game/scenario selection. Focused saved-document/settlement regressions 23/23 and backend/provenance 13/13 passed. The prior stale-marker watch is **closed for these verified paths**, but Save & Exit, interrupted local write, concurrent authors, mobile and full release acceptance remain separate tests; do not generalize beyond the observed contracts.
