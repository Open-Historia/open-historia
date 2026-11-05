# Viewport-safe region map popup (Beta — 2026-11-05)

## Scope and root cause

A region-click popup with a long visible subordinate-state list could lose its flag, country header and close button above the viewport. The popup body already had a viewport height cap and internal scrolling; the actual defect was inconsistent geometry:

- `clampAnchoredCardTop(anchorY, cardHeight, viewportHeight)` previously returned a position appropriate for the **visible top** of the card.
- The floating popup's CSS animation always ended at `transform: translateY(-100%)`, shifting the entire measured card up by its height **after** the clamp.

A long subordinate list exposed this, but flags, region information or smaller screens could trigger the same issue.

## New layout contract

- The anchored card uses one screen-space **visible top** coordinate. `clampAnchoredCardTop()` now prefers the measured card **above** its clicked map anchor, leaving room for the 9px pointer. The result is clamped to an 8px viewport inset.
- The measured height is the already viewport-capped popup body plus its pointer. The floating body uses `max-height: calc(100dvh - 2rem)` and internal `overflow-y: auto`; the rest of the screen stays accessible.
- Popup fade-in/out moves no more than 10px; it no longer imposes a persistent transform of `-100%` on a fixed-position element.
- The pointer is shown only if its tip still aligns with the selected region. When clamping makes that impossible, the misleading pointer is hidden.
- Mobile and short-touch **sheet** placement, its own maximum height, animation and dismissal remain separate and unchanged.
- Opening the popup, selecting another region, flag image sizing, information expansion and viewport resize still use the existing `ResizeObserver`/resize measurement and map anchor tracking.

## Subordinate-state preview

The map popup is not a second full political directory:

- It counts only rows already visible to the current player, from the existing `livePuppetsFor(worldState, playerCountry)` resolver, filtered to the current controller.
- It shows the total count, up to **two** sample polities with their canonical subordinate-kind labels, and `+N more` when applicable.
- A **Country → Diplomacy** breadcrumb uses the existing Country drawer-opening event. The Country drawer currently opens its own default tab; the player can then select Diplomacy for the full visibility-filtered list. No new tab-routing semantics are implied.
- No covert/undiscovered relationship is exposed, no saved or canonical puppet data is rewritten, and no AI/network call was added.
- The existing region info controls, Rostra button, country-info button and mobile behavior retain their handlers.

## Regression evidence and validation

Focused tests:

- `src/Game/Selection/mapCards.test.js`: normal anchors, tall flags, viewport extremes, capped bodies plus pointer and invalid dimensions.
- `src/Game/Selection/regionPopupLayout.test.js`: the geometry/animation contract, internal scroll and pointer alignment, bounded preview, existing Country drawer route, visible-puppet authority and mobile sheets.
- `src/Game/GameUI/countryPanelPresentation.test.js`: flag proportions, measured capped popup top and absence of the full-height transform.
- Existing `src/runtime/puppets.test.js` and `src/runtime/puppetVisibilityArchitecture.test.js` retain substantive covert-visibility tests.

The original community screenshot is sufficient as an acceptance scenario; the exact scenario export is **not required** for this generic UI bugfix. No community scenario was installed or opened during this fix.

## Worktree isolation / PR boundary

This bugfix is deliberately limited to `Regions.jsx`, `mapCards.js`, their focused tests and this document. The pending uncommitted UI-theme feature in the single Beta checkout must not be reset, stashed, overwritten or accidentally included in the popup PR. Use the separately validated repo-relative overlay ZIP for this patch. Do not claim this is committed or upstream before an authorized, separated branch/PR.
