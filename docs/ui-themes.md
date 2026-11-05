# Interface themes — Beta visual contract

Status: local Beta feature implementation, 2026-11-05; review, PR, and release pending.

## Purpose

Settings → General → Interface appearance, and the first-time setup's second page (`src/Game/GameUI/FirstSetup.jsx`), let the player choose among **Default (Original)**, five themed presets (Midnight Navy, Graphite, Forest, Oxblood, Sepia) and a **Custom preset** with exactly three colors: Background, Surface, and Accent. Presets are deliberately dark. The default is Default (Original), which removes theme overrides so each panel uses its own pre-theme authored colors. Midnight Navy is an opt-in palette, not the original appearance. Changes take effect immediately throughout the game's UI, survive restarting and changing campaigns, and can be reset to default.

This is a **client-local appearance preference**, never game state, scenario canon, or AI context. It must not influence political support colors, country flags, relations and war statuses, army progress or danger alerts, map ownership/terrain, or military status. The semantic colors that convey those facts are kept separate from user-chosen UI chrome.

## Source and ownership

- `src/runtime/uiTheme.js`: immutable preset catalog, normalizer and contrast validator, derived UI tokens, persistent client-local preference, storage synchronization, React subscription.
- `src/main.jsx`: calls `installUiTheme()` before the first React render, including the web build once its runtime is initialized.
- `src/Game/GameUI/UiThemeSettings.jsx` and `uiThemeSettings.css`: Settings UI. Built-in swatches, a custom swatch, three native color pickers plus hex inputs, inline validation, live preview, accessible pressed/focus states, and reset. New strings are represented in the existing English i18n catalog.
- `src/Game/GameUI/settings.jsx`: owns the General section and includes the theme picker in both app and game settings. Settings' own cards, selected navigation and accents consume UI theme tokens.
- `src/Game/GameUI/countryPanel.jsx`, `countryDossier.css`, `advisorDossier.css`, `actions.jsx`, `projects.jsx`, and `chat.jsx`: migrated the principal non-semantic chrome surfaces to CSS variable tokens. The Country toolbar uses themed header/text/accent variables with original fallbacks; National's live Intelligence Service rating uses the same unboxed ledger presentation as other metrics. Stat values, flag images, institutional status, political party colors, diplomacy speaker/nation accents, project status colors, and gameplay controls retain existing meaning.

## Device-local contract

The sole storage key is `openhistoria:ui-theme:v1`. The value is a validated JSON object `{ preset, custom: { background, surface, accent } }`. Unknown preset IDs and malformed/unsafe persisted data normalize to the default; no HTML, CSS declarations, arbitrary CSS variable names, or values beyond validated hexadecimal colors are accepted. If storage is unavailable, the selection works for the current session in memory. Other tabs on the same origin update through the standard storage event.

When a themed preset is selected, the app applies it to `document.documentElement` as `data-oh-ui-theme` and a bounded set of `--oh-ui-*` and legacy `--oh-grey-*` **chrome** variables. Selecting Default removes all theme-owned inline variables (including legacy-neutral overrides), restoring panel-level pre-theme fallbacks and :root neutral tokens. Stored explicit choices (including Midnight Navy) are still respected. The `--oh-hud-*` map/HUD variables and gameplay semantic color primitives are not changed. Colors for secondary neutrals and hover surfaces are derived deterministically; text retains its existing readable light tone. No background task or AI call is needed.

## Accessibility and validation

A custom background and surface each need at least **7:1** contrast against the UI's near-white text. The accent needs at least **4.5:1** contrast against both background and surface. The native color picker, textual hex fields, and the live swatch apply only valid changes; invalid edits show an explanation without replacing the current valid theme. Presets are checked against these same minimums in regression tests. Keyboard focus styling, pressed states, compact/mobile layouts and reduced-motion preferences are retained.

## Boundaries and known debt

This first system covers the major chrome backgrounds and shared controls of the main menu (its page, rail, cards, the scenario and game editors and their dialogs: `libraryBar.jsx`, `communityHub.jsx`), the Country (Politics, Diplomacy, National, Ranking), Advisor, Actions, Projects, Diplomacy, Events, Timeline and time-skip controls, game Tools/menu, Cheats, the AI Debug Console, the first-time setup, and the popups and toasts (the translation-model prompt, the app update banner, the AI setup prompt, interactive events, scenario suggestions, Discord invites, the generation-rating, fallback-switch, agent-waiting and borders notices). Floating panel colors derive translucent overlays so the map remains visible. Some older components still use literal colors for subcontrols, legacy special-purpose panels or semantic gameplay indicators; **this is not a blanket recolor of every element**. Do not replace every hex color by search/replace: audit whether the color represents gameplay meaning. New UI panels should consume the `--oh-ui-*` semantic tokens instead of defining isolated palettes.

No canonical state, runtime schema, public/private visibility, UI routing, message memory, country ranking, political logic, project operation, or turn simulation behavior was changed.

## Evidence

- `src/runtime/uiTheme.test.js` checks exactly five presets, contrast limits, malformed input fail-closed, persistence, live updates, and semantic token exclusions.
- `src/Game/GameUI/uiThemeArchitecture.test.js` checks Settings integration, app startup installation, scoped palette adoption, and preserved project/war status colors.
- Existing localization, Advisor, Country, diplomacy, no-gradients, and full Beta tests remain required.
- User live acceptance on localhost:3003 is required before committing and pushing. Patch notes and PR release status must reflect actual upstream merge, not merely a local implementation.
