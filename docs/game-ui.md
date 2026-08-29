# In-Game UI (HUD, Panels & Buttons)

The in-game UI is a flat set of `position: fixed` React components layered over a full-screen MapLibre canvas — there is no single container div, each widget positions itself against the viewport edges and competes for the stacking order through an explicit z-index ladder. `src/Game/GameUI/main.jsx` is the shell: it mounts every HUD element, owns the panel-open booleans, and computes `rightShift` (the horizontal offset that slides the bottom-right cluster left when the advisor drawer opens). Everything the UI reads or writes flows through the runtime state stores (`readJson`/`writeJson`, `readGameData`/`readWorldState`, `useLibraryState`) and the AI layer (`src/Game/AI/*`) — the components hold almost no game data of their own, they poll the stores on a 5-second cadence and push edits back.

- Shell & mount point: `src/App.jsx` (`GameApp`) renders `<UI>` = `src/Game/GameUI/main.jsx` once `isReady`, passing `mapRef`, `isGlobeEnabled`, `isTerrainEnabled`, and their setters.
- Related pages: [World state](world-state.md) · [AI gameplay pipeline](ai-gameplay.md) · [Map rendering](map-rendering.md) · [Library & scenarios runtime](library-runtime.md) · [Diplomacy & chat](diplomacy.md)

---

## 1. The GameUI shell — `src/Game/GameUI/main.jsx`

`Main` is the default export (`src/Game/GameUI/main.jsx:128`). It is mounted by `App.jsx` and **keyed on the active game id** (`key={\`ui-${activeGameId}\`}`, `src/App.jsx:179`) so the entire UI tree remounts when a game activates. That remount is why several open/closed flags live at module scope instead of component state (see [§4.1](#41-menuopendefault--the-remount-trap)).

### 1.1 Props

| Prop | Source | Used for |
|---|---|---|
| `mapRef` | `App.jsx` `useRef` handed to `<Map>` | Passed to `DateWidget`, `Toolbar`→n/a, `Search`, `ForcesPanel`; components call `mapRef.current.flyTo/fitBounds/getMap()` to move the camera |
| `isGlobeEnabled` / `setIsGlobeEnabled` | `App.jsx` state (persisted `localStorage["Globe"]`) | Fed to `SettingsMenu`'s **3D Globe** toggle; `App.jsx` re-projects the map |
| `isTerrainEnabled` / `setIsTerrainEnabled` | `App.jsx` state (persisted `localStorage["Terrain"]`) | Fed to `SettingsMenu`'s **3D Terrain** toggle |

### 1.2 Local state in `Main`

| State | Init | Purpose |
|---|---|---|
| `isSettingsOpen` | `false` | ⋮ settings menu visibility |
| `isCheatsOpen` / `shouldLoadCheats` | `false` | Cheats panel open + lazy-load latch (never imports the chunk until first opened) |
| `isAdvisorOpen` / `shouldLoadAdvisor` | `false` | Advisor drawer open + lazy-load latch |
| `advisorWidth` | `readAdvisorWidth()` | Drawer width in px, persisted (see [§5.1](#51-advisor-width-state)) |
| `isForcesOpen` | `false` | Forces panel open (also opened from the Cheats panel) |
| `activeBottomPanel` | `null` | Which bottom panel (`"chat"`, `"actions"`, `"skip"`, `"history"`) is open — single-slot, so opening one closes another |
| `isFullscreenEnabled` | `false` | Mirrors the Fullscreen API state; persisted `localStorage["Fullscreen"]` |
| `showWebGLWarning` | `false` | Set true if `checkWebGL()` fails on mount → renders `WebGLWarningPopup` |
| `apiProvider` | `getStoredProvider()` | AI provider id; persisted `localStorage["api_provider"]` via effect |
| `providerSettings` | `loadProviderSettingsFormState()` | Per-provider keys/models/params form state |
| `{ games, loaded }` | `useLibraryState()` | `hasNoGames = loaded && games.length === 0` gates the idle-diplomacy timer |

### 1.3 Side effects owned by the shell

| Effect | Behavior | Connects to |
|---|---|---|
| WebGL probe | On mount, `checkWebGL()`; on failure shows the popup | `src/Game/GameUI/main.jsx:55` |
| **Idle diplomacy drip** | Every 60 s, if the tab is visible and a game exists, lazy-imports `../AI/gameplay.js` and calls `maybeSendIdleDiplomacy()` | `src/Game/AI/gameplay.js`; drops a message into the diplomatic chat store unprompted |
| Advisor lazy-load latch | `isAdvisorOpen` → `setShouldLoadAdvisor(true)` (one-way) | Keeps the Chart.js/markdown chunk out of first paint |
| Fullscreen persist + sync | Writes `localStorage["Fullscreen"]`; listens `fullscreenchange`/`webkitfullscreenchange` | `toggleFullscreen()` probes prefixed APIs (mobile Safari safe) |
| Provider persist | Writes `localStorage["api_provider"]`; reloads provider form when settings opens | `src/Game/AI/providerConfig.js` |
| Advisor-width resize guard | On window `resize`, re-clamps `advisorWidth` so a shrunk window never leaves the drawer wider than the viewport | — |

### 1.4 What `Main` mounts (render order)

`WebGLWarningPopup?` → `LibraryTopBar` → `DateWidget` → `Toolbar` → `Other` → `Search` → `ForcesPanel` → `AdvisorButton` → lazy `AdvisorPanel` → lazy `CheatsPanel` → `SettingsButton` → `SettingsMenu?`.

| Mounted component | File | Role |
|---|---|---|
| `WebGLWarningPopup` | `main.jsx` (inline) | Full-screen blocker if WebGL is missing |
| `LibraryTopBar` | `libraryBar.jsx` | Main menu + game/scenario editor + country picker + map-editor host + server shutdown |
| `DateWidget` | `time.jsx` | Date/country pill + timeline-skip + event-history panels |
| `Toolbar` | `chat.jsx` | Bottom-left cluster: 💬 Chat + ✦ Actions launchers |
| `Other` | `other.jsx` | Player-country flag badge (desktop only) |
| `Search` | `search.jsx` | Place search (Nominatim) → `map.flyTo` |
| `ForcesPanel` | `forces.jsx` | Unit list + deploy controls + mode banner |
| `AdvisorButton` (🧭) | `main.jsx` (inline) | Toggles the advisor drawer; sits at `rightShift` |
| `AdvisorPanel` | `advisor.jsx` (lazy) | Advisor chat + Stats tabs, resizable drawer |
| `CheatsPanel` | `cheats.jsx` (lazy) | God-mode tools (opened from Settings) |
| `SettingsButton` (⋮) | `settings.jsx` | Toggles the settings menu |
| `SettingsMenu` | `settings.jsx` | AI provider, language, map/AI toggles, cheats/guides/social |

---

## 2. Z-index ladder

Every fixed element declares its own `zIndex`. From back to front (source-verified):

| z-index | Element | File |
|---:|---|---|
| 9997 | In-game floating cluster (session summary pill, **⌂ Exit Game**, **⏻**) | `libraryBar.jsx:1993` / `:2061` |
| 9998 | Timeline panels (`panelSurface`), **Actions** panel, **Chat** panel | `time.jsx:149`, `actions.jsx:427`, `chat.jsx:851` |
| 9999 | `DateWidget` pill, bottom `Toolbar`, `Search`, `Other` flag badge, 🧭 `AdvisorButton`, ⋮ `SettingsButton`, `SettingsMenu`, `ForcesPanel` body, `WebGLWarningPopup` | shared `baseStyle`/`widgetSurface` |
| 10000 | Forces **mode banner** (deploy hint) | `forces.jsx` |
| 10028 | "Loading games and scenarios…" indicator | `libraryBar.jsx:2565` |
| 10040 | **Advisor drawer** | `advisor.jsx:320` |
| 10045 | **Cheats panel** | `cheats.jsx:280` |
| 10046 | **Main menu** (full page) | `libraryBar.jsx:2302` |
| 10048 | **Editor drawer** (game/scenario editor) | `libraryBar.jsx:741` |
| 10050 | **Map editor** overlay | `libraryBar.jsx:2125` |
| 10060 | **Country / faction picker** modal | `libraryBar.jsx:2152` |
| 10070 | Cheats **click-capture toast** | `cheats.jsx:256` |
| 20000 | **Server stopped** full-screen overlay | `libraryBar.jsx:2113` |
| 99999 | Chat reaction tooltip (React portal to `document.body`) | `chat.jsx:260` |

Design intent captured in comments: the advisor drawer (10040) sits above every HUD button/panel so nothing covers it on phones, but below the editor/picker/server-down overlays. The editor drawer (10048) deliberately lands **above** the main menu (10046) because the menu's `+`/Edit buttons open it. The in-game cluster sits at 9997 — below the settings menu and date widget (9998/9999) — so opening either covers it rather than the reverse.

---

## 3. Bottom toolbar & diplomacy — `src/Game/GameUI/chat.jsx`

`Toolbar` (`chat.jsx:962`) is the bottom-left 2-button cluster (`bottom/left: 0.5rem`, z 9999). It's memoized and driven by `activePanel`/`onTogglePanel` from `Main`.

| Button | Component | Opens | Notes |
|---|---|---|---|
| 💬 Chat | `Chat` (`chat.jsx:886`) | `ChatPanel` (bottom-left, z 9998) | Unread badge: polls stored chats every 15 s, counts open chats that gained messages since last opened |
| ✦ Actions | `Actions` (`actions.jsx:700`) | `ActionsPanel` | See [§7](#7-actions-panel--srcgamegameuiactionsjsx) |
| 🎯 Projects | `Projects` (`projects.jsx`) | `ProjectsPanel` | The Projects & Operations board. See [§7-bis](#7-bis-projects--operations-panel--srcgamegameuiprojectsjsx) |

Both launchers use `hasOpened` latches so the panel body isn't mounted until first opened.

### 3.1 ChatPanel (diplomacy)

| Concern | Detail | Connects to |
|---|---|---|
| Data | `chats` from `readChatsState`/`writeChatsState`; player country + date polled from `JSON_URLS.game` every 5 s | `src/runtime/gameState.js` |
| Country list | `loadCountryNames()` (PMTiles-derived), filtered to exclude the player | `src/runtime/assets.js` |
| Live sync | While open, polls stored chats every 5 s and merges additions (jump invitations, idle drip) without clobbering the active conversation | — |
| Send | `sendDiplomaticMessage(text, countryName, countries)` → `{ reply, reaction }`; multi-country chats rotate speakers via `chooseNextDiplomaticSpeaker` | `src/Game/AI/main.jsx`, `src/Game/AI/gameplay.js` |
| Group turn UI | `phase` = `player`/`pending`/`leader`; "Let X speak →" vs "Speak" buttons offer each queued country | `ConversationView` |
| External trigger | `requestDiplomaticChat(country)` bridge (`chat.jsx:697`) lets the map region popup open/reuse a 1-on-1 chat | Map selection layer |
| Reactions | Leader reactions attach an emoji to the player's last message; hover tooltip is a portal at z 99999 | — |

---

## 4. Main menu & library — `src/Game/GameUI/libraryBar.jsx`

`LibraryTopBar` (exported at `libraryBar.jsx:1042`) is a single large component that renders the whole main menu, both editor drawers, the country picker, the map-editor host, and the in-game floating cluster. It subscribes to `useLibraryState()` (`src/runtime/library.js`) for `games`, `scenarios`, `activeGame`, `activeGameId`, `selectedScenarioId`, `countryNames`, `loaded`, `loading`, `error`.

### 4.1 `menuOpenDefault` — the remount trap

`menuOpenDefault` (`libraryBar.jsx:97`) is a **module-scoped boolean**, not state. The whole UI remounts on game activation (App keys on `activeGameId`), so per-component `useState("open")` would reset the menu back open mid game-start. Every open/close goes through `setMenuOpen` (`libraryBar.jsx:1060`), which writes the module var **first**, then the React state. Flows that activate a game (`startGameForCountry`, `handleGameActivate`, `applyMapToScenario`, …) call `setMenuOpen(false)` **before** awaiting the request, so the remounted instance mounts closed over the new game.

- `isMainMenuOpen()` (exported, `libraryBar.jsx:100`) lets background work (e.g. `maybeGeneratePregameHistory` in `time.jsx`) skip while the player is only browsing.
- `openLibraryTab(tab)` (exported, `libraryBar.jsx:89`) + module `_openLibraryTab` bridge lets outside callers open the menu on a specific tab.

### 4.2 Menu chrome

Full-page overlay at z 10046. Header is a 3-column grid: **logo/title** | **tab buttons** | **actions**.

| Tab | Content | Component |
|---|---|---|
| Games | `MenuRow`s: 🕐 Last Played, 🔥 Most Played | `GameCard` |
| Scenarios | 🔥 Most Played, 🕐 Last Updated, ✦ Your Scenarios (with `CreateScenarioTile`) | `ScenarioCard` |
| Community | Lazy `CommunityPanel fullPage` | `communityHub.jsx` |

Header action buttons (right cell): **Refresh** (`refreshLibraryCatalog({force:true})`, hidden on Community), **Import JSON** (Scenarios only → hidden file input `handleImportScenarioFile`), **⏻** shutdown (hidden on the web build via `import.meta.env.VITE_OH_WEB`).

The Games tab's empty state ("No games yet") offers **Start from a scenario** / **Browse community scenarios** shortcuts.

### 4.3 Menu shelves (derived, memoized)

| Shelf | Sort | Source |
|---|---|---|
| `lastPlayedGames` | `lastPlayedAt` desc | `games` |
| `mostPlayedGames` | `playCount` desc, then `round` | `games` |
| `mostPlayedScenarios` | `playCount` desc, then `gameCount` | `scenarios` |
| `lastUpdatedScenarios` | `updatedAt` desc | `scenarios` |
| `yourScenarios` | filter `!hubOrigin` and not the untouched built-in | `scenarios` |

### 4.4 Cards

**`GameCard`** (`libraryBar.jsx:519`) — cover image + accent gradient; shows country/date/round, pending-action & event counts. Buttons:

| Button | Handler | Effect |
|---|---|---|
| Play / Current | `onActivate`→`handleGameActivate` | `activateGame(id)`; closes menu (module flag first) |
| Edit | `onEdit`→`openGameEditor` | `loadGameDetails` → editor drawer |
| Clone Game | `onClone`→`handleGameClone` | `createGame({seedGameId, setActive})` → editor |

**`ScenarioCard`** (`libraryBar.jsx:360`) — asset badges (Cities/Colors/Countries/Regions PMTiles), game count. Buttons:

| Button | Handler | Effect |
|---|---|---|
| **New Game** / **⬆ Update** | `onPlay`→`handleScenarioPlay` **or** `onUpdate`→`handleScenarioUpdate` | Update replaces the primary action when a hub-imported, unmodified scenario has a newer bundle upstream (see [§4.7](#47-hub-update-detection)) |
| Edit | `onEdit`→`openScenarioEditor` | `loadScenarioDetails` → editor drawer |
| Clone Scenario | `onClone`→`handleScenarioClone` | `createScenario({seedScenarioId, setActive})` |
| (whole card) | `onSelect`→`selectScenario` | Marks `selectedScenarioId` |

### 4.5 Country / faction picker (New Game flow)

`handleScenarioPlay` (`libraryBar.jsx:1276`) opens a modal (z 10060) instead of starting immediately. Two nested steps:

| Step / state | UI | Resolves to |
|---|---|---|
| `pickerTab === "country"` | `CountryPickerMap` (lazy OpenLayers) + a country list built by `buildScenarioCountryOptions` (only factions the scenario actually contains: `world.ownerCodes` ∪ `polityOverrides`, incl. landless factions) | `pickCountry(code)` → `difficultyPick` |
| `pickerTab === "faction"` | `FactionCreator` (invent a nation: name/color/lore/flag/regions) | `pickFaction(faction)` → `difficultyPick` |
| `difficultyPick` set | Difficulty grid from `DIFFICULTY_LEVELS` (`src/runtime/difficulty.js`) | `pickDifficulty(id)` |

`pickDifficulty` routes to `startGameForCountry` (new game with country), `startGameForFaction` (new game seeded with an invented polity — merges into `world.polityOverrides`/`regionOwnershipOverrides`/`ownerCodes`, writes colors/flags), or `choosePlayCountry` (Apply-&-Play: `playGameId` set → refines an already-active game). Custom scenario geometry is loaded via `downloadScenarioJsonAsset(id, "regionsGeojson")` so the picker map shows real borders.

### 4.6 Editor drawer (game & scenario editor)

`EditorDrawer` (`libraryBar.jsx:692`) — the fixed right-side form (z 10048, `width: min(34rem, …)`), the primary scenario/game authoring surface. Driven by `editorKind` (`"scenario"`|`"game"`), `editorDetails`, `editorState`, `editorSection`, `promptSectionKey`.

Section tabs (`SectionTabs`): scenarios show `overview | world | prompts | assets | bundles`; games drop `bundles`.

| Section | Fields | Writes via |
|---|---|---|
| overview | Name, Eyebrow, Accent (color), Subtitle, Description, Hero Title, Hero Subtitle | `saveScenario`/`saveGame` meta |
| world | Player Country, Game Date, Language, **Deployable Troop Types** (scenario only, `UNIT_TYPES` toggles), World Before Round One (`startingTimelineText`), Simulation Rules, Country Label Font/Letter Color/Border Color | merged into `world` |
| prompts | `PromptSectionEditor`: per-section prompt textareas + helpers from `PROMPT_SECTION_DEFINITIONS` | `serializePromptPack` → `prompts` |
| assets | Upload/Reset per asset (cover; scenario adds cities/colors/countries/regions) via hidden file inputs | `uploadScenarioAsset`/`clearScenarioAsset` etc. |
| bundles | **Download .zip** / **Download JSON** (`exportScenarioBundle` + `splitScenarioBundleImage`) | disk download |

Footer: **Save** (`handleSave`), **🗺️ Open Map Editor** (scenario only — loads current geometry/owners/cities/palette/flags/background then opens the lazy `MapEditor` at z 10050; on apply → `applyMapToScenario`), **Delete** (if `record.canDelete`, `window.confirm`).

Save is careful: scenario/game meta writes merge `currentGame`/`currentWorld` so a partial write never wipes `startDate`/`gameDate`/`round` or `polityOverrides`/`ownerCodes` (the "Undated" and wiped-map bugs called out in comments).

### 4.7 Hub update detection

When the Scenarios tab shows any scenario carrying `hubOrigin`, an effect (`libraryBar.jsx:1308`) lazy-imports `communityHub.jsx`'s `fetchHubPosts()` and builds `hubPostById`. `scenarioUpdateAvailable(scenario)` returns true when the post's current `bundleUrl` differs from the imported one → the card's primary button flips to **⬆ Update**. `handleScenarioUpdate` calls `downloadHubBundle` + `updateScenarioFromBundle(id, bundle)`, replacing the copy in place (existing games keep working).

### 4.8 In-game floating cluster & server shutdown

When the menu is closed, `LibraryTopBar` renders a compact cluster (z 9997): a session-summary pill (`summaryText` = name / country / date), **⌂ Exit Game** (→ `setMenuOpen(true)`), and **⏻** (`handleShutdownServer` → `POST /api/server/shutdown`, then a full-screen "Server stopped" overlay at z 20000). Desktop lays them out top-left of the date widget; phones stack **⌂**/**⏻** vertically in the left gutter. **⏻** is stripped from the web build (`!import.meta.env.VITE_OH_WEB`).

---

## 5. Advisor drawer & stats — `src/Game/GameUI/advisor.jsx` + `stats.jsx`

`AdvisorPanel` (`advisor.jsx:186`) is the right-docked drawer (z 10040, full `100vh`). It slides in/out via `transform: translateX(...)` (a prior `right: calc(-min()…)` was invalid CSS and silently never slid). Two tabs, both kept mounted so flipping is instant:

| Tab | Component | Behavior |
|---|---|---|
| 🧭 Advisor | inline chat | Loads/saves history to `JSON_URLS.advisor`; `startChat()`/`loadHistory()` bootstrap; `sendMessage(text)` → advisor reply. Renders markdown (`react-markdown`) and inline ` ```chart ` blocks via `AdvisorChart` (Chart.js), plus ` ```actions ` blocks (JSON array) applied to the real queue by `applyAdvisorActions` — `readActionsState`/`writeActionsState`, the same storage `actions.jsx` uses — right when the reply arrives, then shown as an `AdvisorActionsCard` (added/updated/removed, with an "Open Actions" button). A drafted diplomatic message (blockquote + fenced ` ```senddraft ` JSON) gets one `AdvisorDraftSend` button per entry ("Send message to X") — clicking it calls `gameplay.js`'s `sendAdvisorDraftedMessage`, which finds/opens that country's Diplomacy thread, gets a reply, and writes both messages to `chat.json` directly (no manual copy-paste); the sent state is patched onto the message (`sentDrafts`) so the button stays "✓ Sent" after a reload. A `requestedPrompt` prop (from the Actions panel's "Help brainstorm actions" button, via `Main`'s `pendingAdvisorPrompt`) pre-fills — never auto-sends — the input once bootstrapped. 🗑 clears the chat; ✕ closes (the only exit on phones where the drawer covers 🧭) |
| 📊 Stats | `StatsPane` | National stat sheet (see [§5.2](#52-statspane--srcgamegameuistatsjsx)) |

### 5.1 Advisor width state

The drawer is user-resizable by dragging its **left edge**. Width lives in `Main` as px (drag maps 1:1 to the pointer):

| Constant / fn | Value / behavior | File |
|---|---|---|
| `ADVISOR_MIN_WIDTH` | `280` | `main.jsx:21` |
| `ADVISOR_DEFAULT_WIDTH` | `320` (the old fixed 20rem) | `main.jsx:22` |
| `clampAdvisorWidth(px)` | clamps to `[min(280, vw−16), vw−16]` | `main.jsx:23` |
| `readAdvisorWidth()` | reads `localStorage["oh-advisor-width"]`, else default | `main.jsx:27` |
| `handleAdvisorResize(px)` | sets state + writes `localStorage["oh-advisor-width"]` | `main.jsx:238` |

The drag handler lives in the drawer (`advisor.jsx:202`): on `pointerdown` it captures the pointer and, on each `pointermove`, calls `onResize(window.innerWidth - ev.clientX)` (docked right, so width = viewport − pointer x). `Main` clamps + persists. `rightShift = isAdvisorOpen ? \`calc(${advisorWidth}px + 0.5rem)\` : "0.5rem"` (`main.jsx:253`) is passed to the date widget, the flag badge (`Other`), and the 🧭 button so they slide left exactly the drawer's width when it's open.

### 5.2 `StatsPane` — `src/Game/GameUI/stats.jsx`

| Concern | Detail | Connects to |
|---|---|---|
| Target | `targetCountry` seeds from the player's country; **clicking any country on the map** re-targets it (`setRegionClickObserver`) | `src/Game/Selection/Regions.jsx` |
| Data | `generateCountryStatSheet({code, name})` (AI), validated by `validateGameplayPayload("countryStatSheet", …)` | `src/Game/AI/gameplay.js`, `gameplaySchemas.js` |
| Caching | Per `gameKey:code`, keyed by game date; memory + `localStorage["oh-stat-sheets"]` (cap 60); regenerated when the date moves; ↻ forces regen | — |
| Render | Flag/initials header, national stability bar, 6 strategic indices (`INDEX_ROWS`), economy cards (`compactEconomyValue` trims 30000000000→30.0B), GDP breakdown bar | — |
| Flag logic | author flag (`flags.json`) > polity flag > code-derived — but a **landless player** never borrows a code-derived flag (`isPolityLandless`) | `src/runtime/countryFlags.js` |

`Other` (`other.jsx`) is the standalone player-country flag badge at bottom-right (desktop only; hidden on mobile because the date widget already shows the country). It polls `JSON_URLS.game` + world every 5 s and applies the same landless-suppression logic; falls back emoji → `FallbackBadge` initials for non-ISO polities.

---

## 6. Date widget & timeline — `src/Game/GameUI/time.jsx`

`DateWidget` (`time.jsx:1226`) is the top-right pill (z 9999) plus two slide-up panels (z 9998). It's the time-advance control center.

### 6.1 The pill

Shows player country + formatted date (`«` opens Events history, `»` opens the Skip panel; `»` becomes a spinner during a jump). `rightShift`/`topOffset` come from `Main`. Polls `readGameData`/`readEventsState`/`readWorldState` every 5 s, but **never regresses** — a stale poll with a lower round/date than what's on screen is skipped (`gameStampRef`), so a just-completed jump is never reverted.

### 6.2 Timeline skip panel (`»`)

| Control | Effect | Connects to |
|---|---|---|
| Fixed jumps (6h…1yr) | `runJump(days, "jump")` → `simulateTimelineJump` | `src/Game/AI/gameplay.js` |
| Custom amount + unit | same, arbitrary days | — |
| **Auto-jump** | `runJump(365, "auto")` → `simulateAutoJump` (AI picks how far) | — |
| **↩ Undo last turn** | `runUndo()` → `rollBackToSnapshot(0)`; `undoCount` from `loadRollbackSnapshots` | rollback snapshots |
| Cancel (during load) | `cancelJump()` aborts the in-flight `AbortController` | — |

On success it swaps to the **history panel** with `visibleEventCount = 1`. Fallback generations surface a warning banner.

### 6.3 Event history panel (`«`) + staged reveal

Renders the latest turn's events (`buildTurnRecord`) one at a time; **Next event** / **Skip to end** reveal more. The camera follows every revealed event (`deriveEventFocusBounds` → `focusMapOnBounds`), unless the **Disable camera movement during events** map setting is on. A **staged reveal** (`time.jsx:1558`) replays the pre-jump world from the rollback snapshot and applies only revealed events' impacts through a purely visual override (`setWorldStateOverride`/`setUnitsOverride`) so ownership/units/markers animate in; finishing/closing clears the override.

### 6.4 Pregame history

If a fresh game (round 1, no events/turns) has a "World Before Round One" briefing and the menu is closed, `maybeGeneratePregameHistory()` runs once (`time.jsx:1351`). The `isMainMenuOpen()` gate ensures tokens aren't spent on a game the player is only hovering past in the menu.

---

## 7. Actions panel — `src/Game/GameUI/actions.jsx`

`ActionsPanel` (`actions.jsx:225`) — bottom-left slide-up (z 9998). The player's planned-action queue for the current turn.

| Control | Effect | Connects to |
|---|---|---|
| Composer (textarea) + ✈ send | `createManualAction` → `writeActionsState` | `src/runtime/gameState.js` |
| ✦ sparkle | `refinePlayerAction(text)` rewrites the draft in place (no persist) | `src/Game/AI/gameplay.js` |
| **Help brainstorm actions** | `onOpenAdvisor(seedPrompt)` — opens the advisor drawer AND pre-fills its input with a starter message | `Main.openAdvisor` |
| **Get/Refresh AI suggestions** | `generateActionSuggestions({force:true})` → `SuggestionCard`s | AI |
| Queue a suggestion | `normalizeSuggestionAction` → persisted; button flips to "✓ Queued" | — |
| Delete an action | `handleDelete`; if it was a queued unit order (`unitRevert`, still `planned`), also `revertUnitOrder` to undo its map effect | `src/Game/Map/unitsController.js` |
| *(passive)* Advisor-created/edited/removed actions | A 5s poll (`readActionsState({force:true})`, signature-gated) merges in changes `advisor.jsx`'s `applyAdvisorActions` made elsewhere, so they appear here without closing/reopening the panel | `src/Game/GameUI/advisor.jsx` |

Only `status === "planned"` actions render. Country + date poll `JSON_URLS.game` every 5 s (display only). The launcher button (`Actions`, `actions.jsx:700`) lives in the toolbar.

---

## 7-bis. Projects & Operations panel — `src/Game/GameUI/projects.jsx`

`ProjectsPanel` — bottom-left slide-up (z 9998), the third `activeBottomPanel` slot after Chat and Actions. Its launcher `Projects` (🎯) sits in the same `Toolbar` (`chat.jsx`), which widened from `8.75rem` to `12.05rem` to hold three buttons. The board is **read-only to the player**: entries are created and edited only by the AI, by design — see [World state](world-state.md) §2e-bis.

| Element | Behavior | Connects to |
|---|---|---|
| Data | Its own 5 s `setInterval` while open: `readWorldState({force:true})` + `JSON_URLS.game`, signature-gated so a poll that changed nothing does not re-render the list under the cursor | `src/runtime/gameState.js` |
| Cards | Kind glyph, name, status pill, owner, summary, tag chips, progress bar (`Bar`, copied from `stats.jsx:88`), timeline row, next milestone, last update | — |
| Derived badges | ⚠ Overdue / ⏳ Due in Nd / Milestone slipped / No recent progress — all from `deriveProjectFlags` against the game clock, never from what the model wrote, so they cannot go stale | `src/runtime/projects.js` |
| Sort & filter | `PROJECT_SORTS` dropdown, Mine/Foreign/All, and tag chips built from the live vocabulary (`collectProjectTags`). Open work always sorts above closed work whatever the chosen sort |
| Closed view | An **exclusive** switch, not an "also include" filter: off shows only running work, on shows only completed/failed/cancelled. It previously widened the list to everything, which — because the sort ranks open above closed — buried the closed entries under a screen of active ones and made the button look broken. `isProjectClosed` (`runtime/projects.js`) is the one definition the filter, the count and the sort all share | `src/runtime/projects.js` |
| **🧭 Ask advisor** | `onOpenAdvisor(seed)` — opens the drawer with a per-project brief request **pre-filled, never sent**; the same path the Actions panel's "Help brainstorm actions" button uses | `Main.openAdvisor` |
| **📍 Show on map** | Resolves `project.focus` → first linked marker → first linked unit, then `map.flyTo`. Hidden entirely when nothing resolves, rather than offered and inert | `mapRef`, threaded through `Toolbar` |
| Activity feed | Expanding a card resolves `project.eventIds` against `readEventsState()`, fetched **once and only after a first expand** — `events.json` is the largest runtime document and most opens never expand anything | `src/runtime/gameState.js` |
| Empty state | The **backfill path**, not a dead end: a button seeding the advisor with "put my ongoing efforts on the board". An existing campaign's history is already in the advisor's prompt, so it can reconstruct one | — |

Two authors write the board, never the player: events through `impacts.projectOps`, and the advisor through a ```` ```projects ```` block — `applyAdvisorProjects` in `advisor.jsx`, with an `AdvisorProjectsCard` receipt, the same "advisor creates, I review" contract as ```` ```actions ````. The advisor's write does a read-modify-write that spreads the **whole** world back; a shallow patch there would drop `polityOverrides`/`regionOwnershipOverrides` and blank the map.

## 8. Forces panel — `src/Game/GameUI/forces.jsx`

`ForcesPanel` (`forces.jsx:85`) — bottom-left panel (z 9999), a **controlled** component (open state owned by `Main.isForcesOpen`; opened from the toolbar historically, now primarily from the Cheats panel's "Manual force deployment"). Manual troop control is treated as a cheat.

| Element | Behavior | Connects to |
|---|---|---|
| Unit list | `subscribeUnits`/`getUnits`; split into "Your units" (`getPlayerCode`) and dimmed "Other forces". Clicking a unit `flyTo`s it | `src/Game/Map/unitsController.js` |
| Deploy controls | type (restricted by scenario `getAllowedUnitTypes()`), strength (1–100, percent of established strength), optional name and composition → `setInteractionMode({kind:"deploy", params})` then closes the panel | unitsController |
| **Mode banner** (z 10000) | Global hint while `mode.kind !== "idle"` (deploy is the only mode) + Cancel (`clearInteractionMode`) | interaction-mode state |

Owner codes render as full names via `ensurePolityNames`/`polityDisplayName` (re-renders once the lookup warms). `TYPE_GLYPH`/`TYPE_LABEL` map unit types to icons/labels; strength color-codes >600 green / >250 amber / else red.

---

## 9. Cheats panel — `src/Game/GameUI/cheats.jsx`

`CheatsPanel` (`cheats.jsx:164`) — right-side panel (z 10045), opened from Settings → 🧪 Cheats (lazy-loaded). A list of tools (`TOOLS`); selecting one renders `ToolView`. Several tools enter **click-capture mode**: the panel hides behind a toast (z 10070) and map clicks route through `setRegionClickInterceptor` instead of opening the region popup.

| Tool id | Does | Writes / calls |
|---|---|---|
| `master-ai` | Free-text world command | `applyGameMasterCommand(text)` (`src/Game/AI/gameplay.js`) — records a game-master event |
| `roll-back-turn` | Restore to the start of an earlier turn (discards later turns) | reads `JSON_URLS.snapshots`; writes game/world/events/actions/chat/colors |
| `your-country` | Switch which country you play | `writeGameData({…country})` |
| `difficulty` | Set difficulty | `writeGameData({…difficulty})` (`DIFFICULTY_LEVELS`) |
| `annex-country` | Click a country → fold all its regions into a target | resolves current owner via overrides + `loadRegionCatalog`; writes `regionOwnershipOverrides` |
| `annex-regions` | Click individual regions → transfer to a target | per-region `regionOwnershipOverrides` write |
| `edit-country` / `add-country` | Rename/recolor or create a polity (name **is** the identifier) | `polityOverrides` + `colors.json` |
| `regions` | Click a region → edit name/owner | owner via overrides; name only on custom-geometry maps (`regionsGeojson`) |
| `edit-feature` / `add-feature` / `clear-features` | Edit/add/clear cities & landmarks | `citiesGeojson`; adding the first custom feature flips `customCities: true` |
| `events` | Edit/delete recorded events | `writeEventsState` |

Ownership/name resolution is done in **one namespace** (country display name) — the file's comments call out the recurring bug where a GADM code (`RUS`) and a name (`Russia`) never compared equal. All map changes repaint within ~5 s (the map's own poll).

`loadPolities()` (`cheats.jsx:103`) enumerates the countries actually in the game (polity overrides ∪ current region owners ∪ owners of rendered geometry — custom regions when present, else the stock catalog), each resolved to a display name.

---

## 10. Settings — `src/Game/GameUI/settings.jsx`

`SettingsButton` (⋮, `settings.jsx:709`) sits top-left (z 9999); toggles `SettingsMenu` (`settings.jsx:727`), a scrollable panel below it.

| Section | Control | Persists to / calls |
|---|---|---|
| AI Provider | `ApiProviderSelector` — searchable catalog of `PROVIDER_OPTIONS` | `onApiProviderChange`→`Main.apiProvider`→`localStorage["api_provider"]` |
| Provider settings | `ProviderSettingsPanel` — per-provider API key/model/custom-params (gemini, openai, anthropic, openai-compatible, anthropic-compatible) + global **Model reasoning** toggle | `persistProviderSetting` (browser localStorage); `setReasoningEnabled` |
| Language | `LanguageSelector` — searchable; applying reloads the page | `setStoredLanguage` (server + browser) |
| Display | **Fullscreen**, **3D Globe**, **3D Terrain** (labeled "Very Experimental") toggles | `Main` toggles / `App.jsx` state |
| Map | Hide country labels, **Reduce motion** (umbrella over the two below), Disable idle globe rotation, Disable camera movement during events | `setMapSetting(MAP_SETTING_KEYS.*)` (`src/runtime/mapSettings.js`) |
| AI | **Limit AI generation** (5-min cap then canned fallback vs. wait-as-long-as-needed) | `MAP_SETTING_KEYS.limitAiGeneration` |
| Diagnostics | `DiagnosticsPanel` — **📋 Copy log** / **💾 Save as file** / **Clear**, a live entry count and size, and two persisted toggles: **Keep a diagnostics log** (default on) and **Detailed logging** (default off) | `buildDebugLogReport`, `debugLogFilename`, `clearDebugLog`, `setDebugLogEnabled`, `setDebugLogVerbose` (`src/runtime/debugLog.js`) |
| Footer | **🧪 Cheats** (→ `onOpenCheats`), **📖 Guides** (`/guides/`), Discord/Reddit/GitHub links | — |

`Toggle` (`settings.jsx:156`) is the shared switch primitive (also exported). Map-setting toggles read initial values from `getMapSetting` and mirror them locally.

**Diagnostics** is the paste-into-a-bug-report section: a rolling log of what the player did and what went wrong, kept by `src/runtime/debugLog.js` (see [Runtime services](runtime-services.md#diagnostics-log--srcruntimedebuglogjs) for the buffer, the redaction rules and the full list of hook sites). Copy goes through the shared `copyToClipboard` helper, not `navigator.clipboard` directly — that API needs a secure context and a browser reaching the game over plain http on the LAN does not have one. Save writes a `.txt` via a blob URL, revoked a tick after the click because Firefox cancels a download whose URL is revoked in the same task. The count is deliberately visible when nothing is wrong: "0 entries recorded" after a crash means the log is not recording, which is itself worth reporting. The footnote states that API keys are never included and that country names, queued orders and error messages are — the players most likely to check are the ones most likely to send nothing otherwise.

The two toggles sit **below** Copy/Save rather than above: detailed mode's description is a deliberately long list (the whole point is that a player can see what they would be sending before they turn it on), and with the toggles first it pushed the buttons off the bottom of the panel. Both read their value from the module rather than holding it only in `useState` — this panel unmounts every time the menu closes, so a `useState` default would be a second, disagreeing copy of a setting that actually lives in `localStorage`. The status line shows size as well as count, because the cap is otherwise invisible: a player watching the count sit at 400 cannot tell a quiet game from a log silently rolling its oldest entries off the front. With logging off it reads "Not recording."

---

## 11. Search — `src/Game/GameUI/search.jsx`

`Search` (`search.jsx:144`, memoized) — collapsed 3rem circle just right of the toolbar (z 9999), expands to an input (rightward on desktop, full-width above the toolbar on mobile). Debounced (200 ms) autocomplete against **Nominatim** (`nominatim.openstreetmap.org/search`), results deduped + cached in-module. Picking a result (click / Enter / ↑↓) calls `mapRef.current.flyTo({center:[lon,lat], zoom:5})`. Purely a camera control — it does not touch game state.

---

## 12. Legacy: `src/Game/GameUI/scenarios.jsx`

`ScenarioTopBar` (`scenarios.jsx:686`) is an **older, standalone** scenario deck + editor (full-width top bar z 10030, deck z 10029, editor z 10031) that reads from a separate `../../runtime/scenarios.js` store (`useScenarioState`) rather than `library.js`. It is **not imported anywhere** in `src/` — it has been superseded by `LibraryTopBar` + `EditorDrawer` in `libraryBar.jsx`. Its `ScenarioEditor` still shows the older flat prompt fields (Advisor Prompt / Leader Prompt / **Advanced AI Prompt Pack** JSON textarea) rather than the sectioned `PromptSectionEditor`. Treat it as reference/dead code unless you're wiring the old top-bar mode back in; new work goes in `libraryBar.jsx`.

---

## 13. Master reference — every panel/button

| # | UI element | File | Kind | Open/toggle driver | Reads | Writes / calls |
|---|---|---|---|---|---|---|
| 1 | ⋮ Settings button | `settings.jsx` | button | `Main.isSettingsOpen` | — | opens `SettingsMenu` |
| 2 | Settings menu | `settings.jsx` | panel | `isSettingsOpen` | provider/map settings | localStorage, `setMapSetting`, `setStoredLanguage` |
| 3 | 🧭 Advisor button | `main.jsx` | button | `Main.isAdvisorOpen` | — | opens advisor drawer |
| 4 | Advisor drawer (Advisor tab) | `advisor.jsx` | panel | `isAdvisorOpen` | `JSON_URLS.advisor`, `JSON_URLS.game` | `sendMessage`, `writeJson(advisor)` |
| 5 | Advisor resize handle | `advisor.jsx` | drag | pointer capture | — | `onResize`→`localStorage["oh-advisor-width"]` |
| 6 | Stats tab | `stats.jsx` | panel | advisor tab state | game/world, stat cache | `generateCountryStatSheet`, `localStorage["oh-stat-sheets"]` |
| 7 | Date pill `«` / `»` | `time.jsx` | buttons | `Main.activeBottomPanel` | game/events/world | opens skip/history panels |
| 8 | Timeline skip panel | `time.jsx` | panel | `activeBottomPanel==="skip"` | game date, snapshots | `simulateTimelineJump`/`simulateAutoJump`/`rollBackToSnapshot` |
| 9 | Event history panel | `time.jsx` | panel | `activeBottomPanel==="history"` | `simulationHistory`, events | `setWorldStateOverride`/`setUnitsOverride`, `fitBounds` |
| 10 | 💬 Chat button (+ unread badge) | `chat.jsx` | button | `activeBottomPanel==="chat"` | chats store | opens `ChatPanel` |
| 11 | Chat panel / conversation | `chat.jsx` | panel | `isOpen` | chats, country names, game | `sendDiplomaticMessage`, `writeChatsState`, `chooseNextDiplomaticSpeaker` |
| 12 | ✦ Actions button | `actions.jsx` | button | `activeBottomPanel==="actions"` | — | opens `ActionsPanel` |
| 13 | Actions panel | `actions.jsx` | panel | `isOpen` | `JSON_URLS.game`, actions | `writeActionsState`, `generateActionSuggestions`, `refinePlayerAction`, `revertUnitOrder` |
| 13a | 🎯 Projects button | `projects.jsx` | button | `activeBottomPanel==="projects"` | — | opens `ProjectsPanel` |
| 13b | Projects & Operations panel | `projects.jsx` | panel | `isOpen` | `readWorldState`, `JSON_URLS.game`, events (lazily) | read-only; `onOpenAdvisor(seed)`, `map.flyTo` |
| 14 | Forces panel + mode banner | `forces.jsx` | panel | `Main.isForcesOpen` | units, allowed types, player code | `setInteractionMode`/`clearInteractionMode`, `map.flyTo` |
| 15 | Cheats panel + tools | `cheats.jsx` | panel | `Main.isCheatsOpen` (+ `shouldLoadCheats`) | world/game/events/catalogs | many `writeWorldState`/`writeGameData`/`writeJson`, `applyGameMasterCommand`, `setRegionClickInterceptor` |
| 16 | Search box | `search.jsx` | widget | local `expanded` | Nominatim | `map.flyTo` |
| 17 | Player flag badge | `other.jsx` | badge | always (desktop) | `JSON_URLS.game`, world | — |
| 18 | Main menu (Games/Scenarios/Community) | `libraryBar.jsx` | full page | `menuOpenDefault` | `useLibraryState`, hub posts | `activateGame`, `createGame/Scenario`, catalog refresh |
| 19 | Game/Scenario editor drawer | `libraryBar.jsx` | panel | `editorKind`/`editorDetails` | scenario/game details | `saveScenario`/`saveGame`, asset up/clear, `exportScenarioBundle` |
| 20 | Country / faction picker | `libraryBar.jsx` | modal | `countryPicker` | country options, custom regions | `createGame`, `saveGame`, `activateGame` |
| 21 | Map editor host | `libraryBar.jsx` | overlay | `isMapEditorOpen` | scenario assets | `applyMapToScenario` → many asset writes + new game |
| 22 | ⌂ Exit Game / ⏻ shutdown / summary | `libraryBar.jsx` | cluster | `!menuOpen` | `activeGame` | `setMenuOpen(true)`, `POST /api/server/shutdown` |
| 23 | Community hub tab | `communityHub.jsx` | panel | menu tab | GitHub hub API, `/api/hub/*` | `downloadHubBundle`+`importScenarioBundle`, publish/export |

---

## 14. Shared conventions

- **Surface styling**: most HUD elements share a `baseStyle`/`surface` object — `rgba(17,24,39,0.9)` bg, `backdrop-filter: blur`, 12px radius, subtle border/shadow. The main menu/editor use `surfaceStyle` (darker gradient + heavier blur).
- **5-second polling**: Chat, Actions, Stats, `Other`, and `DateWidget` each run their own `setInterval(refresh, 5000)` against the runtime stores rather than sharing a subscription — the map's own poll then repaints ownership within ~5 s of any cheat/edit.
- **`data-no-translate`**: player-typed text, economic figures, and raw dropdown values are marked so the UI translator ([i18n](i18n.md)) leaves them verbatim.
- **Mobile branching**: `useIsMobile()` (`src/runtime/useIsMobile.js`) reshapes the search box, the date/country row, the exit cluster, and menu paddings. The advisor drawer and bottom panels clamp to `calc(100vw − …)`.
- **Lazy chunks**: advisor (Chart.js + markdown), cheats, community hub, the map editor, and the OpenLayers country picker are all `React.lazy` — none are in the first paint.
