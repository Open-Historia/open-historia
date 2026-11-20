# Map Editor V2 — Complete UX blueprint (design-first checkpoint)

**Status:** Design exploration, NOT a shipped editor or an accepted native implementation. OpenHistoria Beta, Notion N022, P0 / #1 Active. 20 November 2026.

**Design-review status (2026-11-20):** The standalone read-only UX prototype, fixture and associated test were removed before the P12 commit at the creator request. This document remains a design and acceptance blueprint. Functional review happens in the native Map Editor on localhost:3001, not in a second non-persistent demo.

## Native integration supersedes the preview (2026-11-20)

Following direct user critique of the prototype, the next development step was revised from another mockup to an **integrated real Map Editor pass**. The author asked to keep the Photoshop-like map drawing icons in a compact dock and connect existing functionality to the disposable 1912 scenario editor. The prototype below remains a UX reference only; it is **not** the accepted live UI, and its locally derived 1912 geography must not be shipped with a PR without source provenance review.

The active integrated source now includes an actual floating icon dock with every original mode, task-oriented native panel navigation, six country-information tabs built around the original country manager, accurate working-map versus scenario save labels, and the real Apply & Play action themed with General > Theme tokens. This preserves the existing OpenLayers map, its geometry/history callbacks, importers, War geography and scenario save bridge. Current scope/validation is tracked in the [product and architecture spec](map-editor-v2-product-design.md), under Native integration checkpoint.

The next human acceptance pass must evaluate the **actual** localhost:3001 editor, not the preview screenshots. Remaining identity-regime replacement, universal Undo, import backups and theme-specialist work are not implied to be working merely because their categories are present.

## North star

Every scenario maker should know: What am I editing? What is set? How do I change it? What else will change? What has been saved and where?

The old Map Editor contains substantial functionality but forces authors to reconstruct workflows from 17 mostly icon-only tools, separate inspector panels, a long country form, and developer terminology. The V2 redesign groups capabilities by what a human wants to accomplish. No established expert feature may be silently removed.

**Agreed sequence:** Complete the full UX design and validate creator journeys FIRST. Then define native state/validation contracts and implement multiple coherent areas per patch. Existing alias controls and foundational theme improvements remain preserved.

## The whole editor: consistent layout

- **Top bar:** scenario breadcrumb, active map, current editing context, accurate Save/Undo state, General > Theme colors and help. Preview mode is explicitly marked.
- **Task navigation:** permanently readable category names and short descriptions. No primary navigation of unlabeled icon mini-grids.
- **Main map:** the largest working surface. The current map, active tool, selected country/region, drawing behavior and contextual help remain visible. All expert geometry tools still exist.
- **Contextual editor:** one selected country/region/group/place/war setting, with its current values, related settings and clear actions. Never a duplicate canonical world store.
- **Status and main CTA:** distinguish locally saved working map from scenario application. Apply & Play responds to General > Theme instead of fixed bright cyan.
- **Small screens:** contextual editor collapses to a drawer; essential controls remain reachable without hover. No feature deletion on mobile.

## Full capability and screen inventory

| Main section | What users can do | Existing source areas to preserve |
|---|---|---|
| Overview | Find unfinished work and launch creator tasks | MapEditor shell, scenario status |
| Countries | Find/create countries; inspect every current attribute, aliases, rename, government, territorial and visual context | PolitiesPanel, SelectionInspector, useMapDocument, Political World integration |
| Territory & Borders | Select, assign, paint, draw, split/reshape, merge, dissolve, simplify, claims and precision tools | OlMap, RegionsPanel, claimant edits, geometry/undo |
| Places & Units | Cities, ports, bases, landmarks, units, placement, bulk edits and imports | FeatureManager, UnitsPanel, marker/city popups |
| Groups | Group identities, memberships, regions, authored population/forces, organization vs sovereignty | GroupsPanel, scenario groups |
| Terrain & War | Terrain difficulty, climate/seasons, fortifications, freezing waterways, native Wars & Fronts effects | WarMapPanel, war geography, fronts runtime and scenario mechanics |
| Maps & Appearance | Territory map, background/detailed/reference maps, flags, colors, layers and projection | BasemapPicker, FlagPicker, ReferencePanel, ProjectionPanel, LayersPanel |
| Import or Generate | GeoJSON, HOI4, raster/metadata, generator, safe conversion and verified restore | ProvinceImportPanel, fmg/FmgPanel, topology guards |
| Review & Save | Draft status, scenario status, pending changes, validation, warnings and Apply & Play | documentSaving, MapEditor, scenario Apply bridge |

All advanced tools remain available in labeled Advanced sections, including shared-border precision, pathfinding weights, polygon properties, weather blend, map projection and complex import metadata joins.

## Country Details: the primary design anchor

**Entry points:** click country territory, search the Country list, follow a region owner, or open a Political World country. Every route must resolve the SAME canonical identity, never a newly inferred record.

**Overview:** flag, current name, color, number of owned regions, claims, alternative names and only genuinely authored population/forces/government/relationships. Empty canon displays “Not set,” not an invented zero.

**Names & identity:** the current name with Rename, all existing aliases visible with Add/Remove, former names distinguished from aliases, and a dedicated Change Identity action with three distinct choices:
1. Rename the SAME country. Do not automatically save its former name as an alias.
2. Change the government/regime of this SAME country while reviewing political continuity.
3. Replace it with a genuinely DIFFERENT country, with author-approved handling of territory, parties, history, units, diplomacy and relationships.

These require different native transactions. The preview demonstrates their differences but cannot yet implement them. Never infer historical ideology from an alias.

**Territory & claims:** show the full list and map, selectable regions, bulk transfer and claim effects. A country with zero regions remains a legitimate editable polity.

**Politics & history:** display authored canonical summary and link to the Scenario Editor where Political World data actually lives. Preserve selected country and pending changes across navigation; do not create a duplicate Political Actor model in the Map Editor.

**Military & relationships:** starting military, placed units, dependents and related parties with the correct scenario-era defaults, and only when authored.

**Appearance:** flag, map color, labels and asset source. The interface theme must NEVER recolor country/owner flags, military or semantic status.

**Review:** human-readable operation impact, unresolved name collisions, changed owner/claim/actor references, accurate Save/Undo limits and safe cancellation.

## Wars & Fronts must be understandable to scenario authors

| Setting | Honest native effect | Author-facing V2 controls |
|---|---|---|
| Difficult terrain | Impacts front movement and battlefield difficulty | Draw affected ground; show level, movement impact and scenario enabled/disabled switch |
| Climate & seasons | Influences weather, front conditions and seasonal changes | Draw zones; view seasons and weather likelihoods, plus disabled-state warning |
| Fortifications | Defend lines and can be damaged/breached | Draw lines, assign owner and level, explain breach role |
| Freezing waterways | Seasonal freezing can affect traversal | Mark water; show when ice may form and whether climate mechanics apply |

The new interface must read the real Wars & Fronts switches from scenario state. A visible disabled mechanic is not the same as absent authoring data. Real community adoption cannot be inferred from the source code.

## Safety and recovery are part of UX, not optional polish

**Working map vs scenario:** distinguish loading, unsaved, saving, saved, scenario needs apply, applied, failed/retry, stale conflict and confirmed exit. Never show “All saved” if scenario application is still pending.

**Undo:** show exactly what can be undone. Geometry history exists, but not every country/document edit currently uses it. Do not promise universal Undo until the native transaction history actually covers it.

**Import and generator:** Choose file or generation → inspect matching and validation → preview changed countries, regions, places and flags → create and verify recovery point → explicit Apply → review result. The importer currently offers a continue-without-backup path after backup failure; V2 should reject unsafe whole-world replacement instead of making loss seem routine.

**Projection/whole map transforms:** show before/after, describe effects on other data and require recovery because existing map Undo cannot reverse all such transformations.

**Border cleanup:** explain before saving whether topology repair changes map geometry, and show what was changed/left unresolved.

**Identity mutation:** all-or-nothing referential integrity for aliases, owners, claims, units and Political World. Reject ambiguous country names rather than picking the first match.

## States that the design needs to show

| Situation | Required feedback |
|---|---|
| No country selected | Search/select/create prompt, not an empty sprawling form |
| Landless country | “No territory assigned” with an Assign action |
| No aliases, flag or country stats | Visible Add/Choose/Not set states |
| Country name collision | Exact conflicting identities and a safe correction |
| Incomplete political setup | Shows the canonical editor and missing authored facts |
| War mechanic disabled | Clear Inactive label and link to scenario settings |
| Working map saved, scenario pending | Two separate and accurate statuses |
| Autosave failure or stale write | Preserve local draft and explain recovery |
| Destructive import/projection | Preview plus verified checkpoint or refusal |
| UI theme change | Every panel, button, overlay, selection and focus state responds; geographic data does not |

## Creator acceptance before coding the whole native editor

1. A first-time author finds a country, edits aliases and renames it without JSON or Discord guidance.
2. A fictional state changes regime without deleting/recreating its geography, and the author understands continuity.
3. A landless entity can be edited and assigned new territory without changing its identity.
4. A border dispute is authored through ownership/claims with clear impact and no orphaned references.
5. A creator finds terrain, climate, seasonal freezing and fortified lines, and knows whether the game uses them.
6. A creator imports a complex HOI4/GeoJSON map without losing the previous working map.
7. A creator understands draft autosave versus actual scenario save and launches a disposable playtest.
8. A creator uses Original, Oxblood, Forest, Graphite, Midnight, Sepia and Custom without partially recolored UI.
9. Three different real scenario makers can complete historical, fictional and complex import tasks without developer coaching.

## What the prototype IS and IS NOT

The prototype has **79 country choices** and maps **2,726 visible regions out of 4,422**, using region ownership/colors/geography from an isolated copy of the 1912 scenario. Its source-generator is stored under D:\OpenHistoria\QAReports\MAP_EDITOR_V2_UX_DESIGN_20261120. No live campaign or scenario file is touched by fixture extraction.

The prototype is a static design application separate from the production editor. Clicking between pages, selecting countries or adding an alias only changes in-memory preview state. Rename/identity/import/Save buttons show the intended consequences but cannot mutate canonical state. Missing political or military records are labelled “Not loaded in preview,” never fabricated.

### First implementation batch after design acceptance

Country Details + labelled editor navigation + complete theme treatment (including Apply & Play) + collision-aware country selection and its true save/Undo status, with all existing functionality retained.

Later batches: robust native identity/government transition; Undo and recoverable imports/generation/projection; complete War/terrain/asset and scenario readiness workflows. Each batch must have focused native regression tests, the full suite, production builds and disposable-scenario human playtests.

**Release gate:** A visually coherent mockup is not a shipped feature. N022 stays Implementing / Partial / Not released until the real editor is integrated, validated, merged and published.
