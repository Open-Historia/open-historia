# In-Game UI (HUD, Panels & Buttons)

The in-game UI is a flat set of `position: fixed` React components layered over a full-screen MapLibre canvas — there is no single container div, each widget positions itself against the viewport edges and competes for the stacking order through an explicit z-index ladder. `src/Game/GameUI/main.jsx` is the shell: it mounts every HUD element, owns the panel-open booleans, and computes `rightShift` (the horizontal offset that slides the bottom-right cluster left when the advisor drawer opens). Everything the UI reads or writes flows through the runtime state stores (`readJson`/`writeJson`, `readGameData`/`readWorldState`, `useLibraryState`) and the AI layer (`src/Game/AI/*`) — the components hold almost no game data of their own, they poll the stores on a 5-second cadence and push edits back.

- Shell & mount point: `src/App.jsx` (`GameApp`) renders `<UI>` = `src/Game/GameUI/main.jsx` once `isReady`, passing `mapRef`, `isGlobeEnabled`, `isTerrainEnabled`, and their setters.
- Related pages: [World state](world-state.md) · [AI gameplay pipeline](ai-overview.md) · [Map rendering](game-map.md) · [Library & scenarios runtime](runtime-services.md) · [Diplomacy & chat](ai-overview.md)

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
| `aiSetup` | `readAiSetup()` | `{ ready, provider }`: whether the Fallback list has an entry its provider can call, and the top entry's provider for the start-of-game prompt. Re-read on `ai:fallback-changed` |
| `{ games, loaded }` | `useLibraryState()` | `hasNoGames = loaded && games.length === 0` gates the idle-diplomacy timer |

### 1.3 Side effects owned by the shell

| Effect | Behavior | Connects to |
|---|---|---|
| WebGL probe | On mount, `checkWebGL()`; on failure shows the popup | `src/Game/GameUI/main.jsx:55` |
| **Idle diplomacy drip** | Every 60 s, if the tab is visible and a game exists, lazy-imports `../AI/gameplay.js` and calls `maybeSendIdleDiplomacy()` | `src/Game/AI/gameplay.js`; drops a message into the diplomatic chat store unprompted |
| Advisor lazy-load latch | `isAdvisorOpen` → `setShouldLoadAdvisor(true)` (one-way) | Keeps the Chart.js/markdown chunk out of first paint |
| Fullscreen persist + sync | Writes `localStorage["Fullscreen"]`; listens `fullscreenchange`/`webkitfullscreenchange` | `toggleFullscreen()` probes prefixed APIs (mobile Safari safe) |
| AI header + setup | `syncAiDebugContext()` on mount; re-reads `aiSetup` whenever the Fallback list or a Connection changes | `src/Game/AI/providerConfig.js` |
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
| `InteractivePanel` | `interactive.jsx` (lazy) | Interactive events: an event a time skip offered, played out as a scene beat by beat (opened by `oh:open-interactive-event` from the offered event's card or the time panel). See [§10-bis](#10-bis-interactive-events--srcgamegameuiinteractivejsx) |
| `SettingsButton` (☰) | `settings.jsx` | Toggles the game menu; same corner and size as before, glass finish |
| `SettingsMenu` | `settings.jsx` | Ported from kernely's Continuum branch as it is there: a quick menu with Game / Tools / Settings / Help tabs (session card, Game Management, Cheats, Events, AI debug console, Guides, bug report, community links) and `SettingsWorkspace`, a full-screen portal with Continuum's four sections — General, Map (with the basemap picker), AI, Advanced. This branch's own settings (profiles, per-task models, segments, batching, telemetry, beta units, network sharing, diagnostics) sit inside those four sections |
| `ApiSetupPrompt` | `apiSetupPrompt.jsx` | Shown once per game per session when nothing in the Fallback list has what its provider needs (`providerConfig.js isFallbackListConfigured`). The prompt IS the setup: a provider select, the key (or the endpoint for a self-hosted provider) and an optional model, saved by `applyQuickAiSetup` (completes a key-less connection for that provider or adds one, and moves its entry to the top of the list); the `ai:fallback-changed` refresh then hides the prompt. Above the form: an embedded YouTube tutorial on getting a free Gemini key (privacy-enhanced embed, hideable) and a **Get a key at Google AI Studio** button (external link). **Open full settings** opens the game menu on the AI section (`SettingsMenu initialSection`), **Not now** dismisses it |
| `GameLoadingScreen` | `gameLoadingScreen.jsx` | The screen a game opens under: the logo turning over a dark ground until the map is drawn. `useGameLoading` starts loading with every game (this UI is remounted per game), waits for `oh:map-polities-ready` for the game's regions asset (`runtime/mapReadiness.js`; Nations.jsx marks it after the boundary worker answers, or at once on a stock map) and then for the next `oh:map-idle` (World.jsx), with a 60 s ceiling; fades off through `Presence`. Also shown when the 3D globe is switched on or off: App.jsx calls `announceMapRerender()` before the projection state changes, since the map instance is keyed on it and redraws from nothing |

---

## 2. Z-index ladder

Every fixed element declares its own `zIndex`. From back to front (source-verified):

| z-index | Element | File |
|---:|---|---|
| 9997 | In-game floating cluster (session summary pill, **⌂ Exit Game**) | `libraryBar.jsx:1993` / `:2061` |
| 9998 | Timeline panels (`panelSurface`), **Actions** panel, **Chat** panel | `time.jsx:149`, `actions.jsx:427`, `chat.jsx:851` |
| 9999 | `DateWidget` pill, bottom `Toolbar`, `Search`, `Other` flag badge, 🧭 `AdvisorButton`, ⋮ `SettingsButton`, `SettingsMenu`, `ForcesPanel` body, `WebGLWarningPopup` | shared `baseStyle`/`widgetSurface` |
| 10000 | Forces **mode banner** (deploy hint) | `forces.jsx:156` |
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
| 💬 Chat | `Chat` (`chat.jsx:886`) | `ChatPanel` (bottom-left, z 9998) | Unread badge plus incoming-message notifications: one event-driven watcher (runtime JSON writes, `oh:diplomacy-chats-updated`, tab visibility, a 30 s safety interval) keeps a per-chat cursor (`oh:chat-notification-cursors-v2`), toasts a foreign message that lands while its thread is not on screen (top-right, 12 s, click opens the thread), plays a two-note chime (`oh:chat-notification-sound-v1`, 🔊 toggle), keeps a 🔔 notification center bottom-left until the panel opens (bell and toasts stay off the main menu — `useMainMenuOpen` from `libraryBar.jsx`), and can raise desktop notifications once permitted; `window.__OH_DIPLO_NOTIFICATIONS__` (`status`, `test`, `testExistingChat`, `testSound`, `enableDesktop`, `clear`) exercises it |
| ✦ Actions | `Actions` (`actions.jsx:700`) | `ActionsPanel` | See [§7](#7-actions-panel--srcgamegameuiactionsjsx) |

Both launchers use `hasOpened` latches so the panel body isn't mounted until first opened.

### 3.1 ChatPanel (diplomacy)

| Concern | Detail | Connects to |
|---|---|---|
| Data | `chats` from `readChatsState`/`writeChatsState`; player country + date polled from `JSON_URLS.game` every 5 s | `src/runtime/gameState.js` |
| Country list | `loadCountryNames()` (PMTiles-derived), filtered to exclude the player | `src/runtime/assets.js` |
| Live sync | While open, polls stored chats every 5 s and merges additions (jump invitations, idle drip) without clobbering the active conversation | — |
| Send | One-on-one sends directly to the sole AI counterpart via `sendDiplomaticMessage(text, countryName, countries)` → `{ reply, reaction, memorySummary }`. Group/institution conversations use `runChatActionBatch` as the single canonical AI request: that batch decides which AI participants speak/react/vote/stay silent and their order. There is no standalone speaker-selection request or sequential group fallback. | `src/Game/AI/main.jsx`, `src/Game/AI/gameplay.js`, `src/Game/AI/chatActions.js` |
| Group turn UI | A group turn is revealed from the one-request action batch a line at a time; the player may cut in before later planned lines are written. No queued "Let X speak" legacy phase remains. | `ConversationView`, `planChatReveal` |
| Conversation view | A date separator opens every new game day; the last 12 messages render first with a "Show earlier" button; stacked flags on list rows; a leader's message is dated through `gameDates.js` (it used to show a day early west of Greenwich); a document delivered through diplomacy is a message like any other, its `📄` heading in bold ([§6.2-bis](#62-bis-documents-where-they-arrive)) | `ConversationView`, `ChatListItem` |
| External trigger | `requestDiplomaticChat(country)` bridge (`chat.jsx:697`) lets the map region popup open/reuse a 1-on-1 chat | Map selection layer |
| Reactions | Leader reactions attach an emoji to the player's last message; hover tooltip is a portal at z 99999 | — |
| Catch-up line | A line the player sends after the world moved on carries a note for the leader (`buildLeaderCatchUp` → `conversationCatchUp.js buildThreadCatchUp`, from the moment the player has been shown): the bubble shows `⏳ Since 1 December 2015 · 3 events · 1 border change`, the whole note on hover. Stored on the message (`catchUp`, `catchUpLabel`), sent ahead of the words one-to-one and in the group batch | `src/Game/AI/main.jsx`, `src/Game/AI/gameplay.js` |

---

## 4. Main menu & library — `src/Game/GameUI/libraryBar.jsx`

`LibraryTopBar` (exported at `libraryBar.jsx:1042`) is a single large component that renders the whole main menu, both editor drawers, the country picker, the map-editor host, and the in-game floating cluster. It subscribes to `useLibraryState()` (`src/runtime/library.js`) for `games`, `scenarios`, `activeGame`, `activeGameId`, `selectedScenarioId`, `countryNames`, `loaded`, `loading`, `error`.

### 4.1 `menuOpenDefault` — the remount trap

`menuOpenDefault` (`libraryBar.jsx:97`) is a **module-scoped boolean**, not state. The whole UI remounts on game activation (App keys on `activeGameId`), so per-component `useState("open")` would reset the menu back open mid game-start. Every open/close goes through `setMenuOpen` (`libraryBar.jsx:1060`), which writes the module var **first**, then the React state. Flows that activate a game (`startGameForCountry`, `handleGameActivate`, `applyMapToScenario`, …) call `setMenuOpen(false)` **before** awaiting the request, so the remounted instance mounts closed over the new game.

- `isMainMenuOpen()` (exported, `libraryBar.jsx:100`) lets background work (e.g. `maybeGeneratePregameHistory` in `time.jsx`) skip while the player is only browsing.
- `openLibraryTab(tab)` (exported, `libraryBar.jsx:89`) + module `_openLibraryTab` bridge lets outside callers open the menu on a specific tab.

### 4.2 Menu chrome

Full-page overlay at z 10046. Header is a centered, width-bounded 3-column grid: **logo/title** | **tab buttons** | **actions**. The desktop shell now grows to **3000px** before capping, so 2560px and 3440px displays use substantially more of the viewport instead of rendering a 1080p-era island in the middle. Card widths remain independently capped, so additional width yields more cards per row rather than oversized cards; very wide displays still retain deliberate outer gutters instead of pinning chrome to the physical screen edges.

| Tab | Content | Component |
|---|---|---|
| Games | `MenuRow`s: 🕐 Last Played, 🔥 Most Played | `GameCard` |
| Scenarios | 🔥 Most Played, 🕐 Last Updated, ✦ Your Scenarios (with `CreateScenarioTile`) | `ScenarioCard` |
| Community | Lazy `CommunityPanel fullPage` | `communityHub.jsx` |

Header utility actions use the shared inline `ButtonIcon` glyphs: **Settings**, **Refresh**, and the tab-specific **Import Game** / **Import Scenario** action. The labels remain visible on desktop and use the same icon vocabulary on phones.

Each `MenuRow` carries a short description plus a subtle divider. Desktop rows use a responsive grid so a populated library scales across the available width; phones retain horizontally scrollable shelves. Sparse libraries are not stretched into oversized feature cards.

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

**`ScenarioCard`** (`libraryBar.jsx:360`) — asset badges (Cities/Colors/Countries/Regions PMTiles), game count. Cover art receives a stronger dark scrim and the title/body copy uses a dedicated multi-layer text shadow so authored scenario text stays legible over bright or detailed images without an opaque text panel. Buttons:

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

Section tabs (`SectionTabs`): scenarios show `overview | world | features | prompts | assets | bundles`; games drop `bundles`.

| Section | Fields | Writes via |
|---|---|---|
| overview | Name, Eyebrow, Accent (color), Subtitle, Description, Hero Title, Hero Subtitle | `saveScenario`/`saveGame` meta |
| world | Player Country, Game Date, Language, **Deployable Troop Types** (scenario only, `UNIT_TYPES` toggles), World Before Round One (`startingTimelineText`), Simulation Rules, Country Label Font/Letter Color/Border Color | merged into `world` |
| features | `FeaturesSectionEditor` (`FeaturesSectionEditor.jsx`): one card per entry of `FEATURE_DEFINITIONS` (`server/gameFeatures.js`) — today Espionage, Idle diplomacy with its "one attempt every N minutes" setting, and World direction (the pace, the world's share, the map's tempo, and two `type: "text"` settings — the priority rules and the scripted events, one dated beat per line — rendered as textareas that show what was typed rather than the normalized value, because the normalizer trims and a field that trims on every keystroke cannot hold the space between two words; see [world direction](ai-overview.md#world-direction-what-an-author-sets-as-numbers)). A scenario edits its complete configuration (On/Off + settings), the default for every game made from it; a game edits only overrides, each control offering **Scenario default** so an unset field keeps following the scenario, including changes made to the scenario later (`resolveFeatures`). The library resolves the active game's features into `src/runtime/gameFeatures.js` (`useActiveFeatures` for the UI, `isActiveFeatureEnabled` for the simulation): espionage off hides the Spy tab and stops spy reports, intercept refreshes, the turn's espionage resolution and the simulator's spy orders; idle diplomacy's setting sets the per-minute chance of `maybeSendIdleDiplomacy`'s chat half (off keeps only the movement pulse). Scenario and game bundles carry `features`. | `saveScenario`/`saveGame` meta `features` (`readScenarioMeta`/`readGameMeta` normalise it on both stores) |
| prompts | `PromptSectionEditor`: one tab per section of `PROMPT_EDITOR_SECTIONS` (the prompts with guidance), and inside it one textarea per guidance passage declared in `promptGuidance.js` (the role, the tone, what to simulate, what makes a good event…) with **Reset to default** per passage and per section. The technical text — placeholders, output contracts, map rules — is never shown or stored, so it cannot be broken here and it follows the app's defaults as they change; a pack in the old whole-prompt shape is ignored (ai-prompts.md §2). | `serializePromptPack` → `prompts` as `{ promptModel: 2, guidance }` |
| assets | Upload/Reset per asset (cover; scenario adds cities/colors/countries/regions) via hidden file inputs | `uploadScenarioAsset`/`clearScenarioAsset` etc. |
| bundles | **Download .zip** / **Download JSON** (`exportScenarioBundle` + `splitScenarioBundleImage`) | disk download |

Footer: **Save** (`handleSave`), **🗺️ Open Map Editor** (scenario only — loads current geometry/owners/cities/palette/flags/background then opens the lazy `MapEditor` at z 10050; on apply → `applyMapToScenario`), **Delete** (if `record.canDelete`, `window.confirm`).

Save is careful: scenario/game meta writes merge `currentGame`/`currentWorld` so a partial write never wipes `startDate`/`gameDate`/`round` or `polityOverrides`/`ownerCodes` (the "Undated" and wiped-map bugs called out in comments).

### 4.7 Hub update detection

When the Scenarios tab shows any scenario carrying `hubOrigin`, an effect (`libraryBar.jsx:1308`) lazy-imports `communityHub.jsx`'s `fetchHubPosts()` and builds `hubPostById`. `scenarioUpdateAvailable(scenario)` returns true when the post's current `bundleUrl` differs from the imported one → the card's primary button flips to **⬆ Update**. `handleScenarioUpdate` calls `downloadHubBundle` + `updateScenarioFromBundle(id, bundle)`, replacing the copy in place (existing games keep working).

### 4.8 In-game floating cluster & server shutdown

When the menu is closed, `LibraryTopBar` renders a compact cluster (z 9997): a session-summary pill (`summaryText` = name / country / date), **⌂ Exit Game** (→ `setMenuOpen(true)`). Desktop lays them out top-left of the date widget; phones put **⌂** in the left gutter. The ⏻ server-shutdown button that used to sit beside it is gone from the beta; `POST /api/server/shutdown` stays for scripts and the launcher.

---

## 5. Advisor drawer & stats — `src/Game/GameUI/advisor.jsx` + `stats.jsx`

`AdvisorPanel` (`advisor.jsx:186`) is the right-docked drawer (z 10040, full `100vh`). It slides in/out via `transform: translateX(...)` (a prior `right: calc(-min()…)` was invalid CSS and silently never slid). Two tabs, both kept mounted so flipping is instant:

| Tab | Component | Behavior |
|---|---|---|
| 🧭 Advisor | inline chat | Loads/saves history to `JSON_URLS.advisor`; `startChat()`/`loadHistory()` bootstrap; `sendMessage(text)` → advisor reply. Renders markdown (`react-markdown`) and inline ` ```chart ` blocks via `AdvisorChart` (Chart.js) — only after `validateChartConfig` (`advisorBlocks.js`) passes them: bar, line, pie or doughnut, with labels and a number somewhere; one that fails shows `📉 The chart could not be drawn: <why>` instead of throwing mid-render. A question asked after the world moved on carries a line above it — `⏳ Since 1 January 2016 · 3 events · 1 change by the Game Master` — whose tooltip is the whole catch-up note the advisor was given (see [conversations](ai-overview.md#conversations-one-copy-a-stable-prefix-and-a-catch-up-note)). Dates under replies go through `gameDates.js` (they used to show a day early west of Greenwich). A document that reached the government in a turn shows as a notice between the messages — `📄 A new paper on your desk: <title>, <how it came>` with **Read it** / **Put it away** (`AdvisorDocumentNotice`) — hidden until the reveal reaches its event, merged in while the drawer is open, never sent to the model, and taken back with an undone turn (see [reports](ai-overview.md#reports-what-only-some-governments-know)). 🗑 clears the chat; ✕ closes (the only exit on phones where the drawer covers 🧭) |
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
| **↩ Undo last turn** | `runUndo()` → `rollBackToSnapshot(0)`; `undoCount` from `loadRollbackSnapshots` — the Spies file goes back with the turn | rollback snapshots |
| Cancel (during load) | `cancelJump()` aborts the in-flight `AbortController` | — |

On success it swaps to the **history panel** with `visibleEventCount = 1`. Fallback generations surface a warning banner.

While an interactive event is in progress (`isSceneInProgress(world.activeInteractive)`), the jumps, auto-jump and the custom amount are disabled and a yellow note says why, with **Return to the scene** (`oh:open-interactive-event`). Undo stays available, and undoing the turn a scene was built on takes the scene with it. While one is on offer instead (the last skip's, once the reveal has reached its event), a quieter yellow note names it — *⚡ An interactive event is on offer: «title». The next time skip lets it pass.* — with **Play it out**; the skips stay available.

While a skip runs the spinner says what it is doing, in the skip's own words as each phase starts (`showSkipPhase`, fed by `onProgress` from `skipPhases.js`): *Reading the world…*, *Writing 1 month of events… (part 2 of 3)*, *Moving the armies, redrawing the fronts and hearing from 2 agents…*, *Placing the armies and the fronts…*, *Updating the Projects board…*, *Folding older history into the history document…*, *Writing it into the record…*. Auto-jump and a held segment's retry report the same way.

### 6.2-ter Group chats: one request, said a line at a time, and binding votes

A group turn no longer rotates one leader at a time. `runGroupTurn` (`chat.jsx`) calls `runChatActionBatch` once for the whole table (see [group diplomacy](ai-overview.md#group-diplomacy-one-request-for-the-whole-table)); the answer is applied to the thread's event log and the panel re-renders from its projection. A failed group request is surfaced and leaves the canonical thread unchanged; there is no legacy sequential speaker fallback.

The answer is **said a line at a time** (`planChatReveal`, `GameUI/chatReveal.js`): the first line at once, with anything before it and the reactions, votes or newcomers that follow it; then each later line after its speaker has been seen typing for five seconds — a *Typing…* bubble with the speaker's flag (`TypingBubble` with `label="Typing"`, where the request's own wait says *Thinking…*) and the hint *Send a message now to cut in: what is still to come will not be said.* The composer stays open meanwhile. **Sending a message cuts in**: the lines still to come are never said — they were never written into the thread — and the next request is told whose lines went unsaid. **Leaving the thread** (back, or another thread) is not cutting in: the rest is written at once. Each line is written onto the thread as it stands, so a vote cast in between is kept, and nothing is written once the player has switched campaign.

A binding vote renders as a `PollCard` above the composer: who called it, each option as a bar with its share and tally, the voters on hover, and the player's own vote cast once by clicking. A model can never cast it for them — `chatActions.js` refuses any action whose actor is human-controlled — and there is no closing a poll or changing a vote, because neither is a thing a government gets to do.

### 6.2-bis Documents, where they arrive

There is no document panel (a Dossier launcher existed briefly in the lab and was removed). The documents the simulation writes — secret protocols, private letters, intelligence assessments, treaty articles (`world.reports`, see [reports](ai-overview.md#reports-what-only-some-governments-know)) — reach the player through the panels they already use (`runtime/reportDelivery.js`):

- **Diplomacy.** A document the player holds with other governments arrives as a message in the thread with them, spoken by its sender: a bold `📄` heading and dateline over the document in full. It raises the unread badge and the notification like any message — once the reveal reaches the event that brought it (see 6.3).
- **The Spy tab.** A document held by a government where the player has an agent arrives among that agent's intercepts, listed with `📄` rather than `📡`, sealed like the rest and redacted to the player's signal clarity.
- **The event card.** A published document, or one only the player's government holds, sits under the text of the event that produced it (`EventDocument` in `time.jsx`): `📄 title`, `Published` or `Our government's`, and the document a click away.

The advisor reads all of them as the government's own staff; the dock is back to three launchers.

### 6.3 Event history panel (`«`) + staged reveal

Renders the latest turn's events (`buildTurnRecord`) one at a time; **Next event** / **Skip to end** reveal more. The camera follows every revealed event (`deriveEventFocusBounds` → `focusMapOnBounds`), unless the **Disable camera movement during events** map setting is on. A **staged reveal** replays the pre-jump world from the rollback snapshot and applies only revealed events' impacts through a purely visual override (`setWorldStateOverride`/`setUnitsOverride`) so ownership/units/markers animate in; finishing/closing clears the override.

The reveal is remembered (`runtime/unseenEvents.js`): each step marks what it uncovered, a reload resumes where the player was, and a turn with nothing left unseen — an older one, an undone-to one, a stopped one — opens whole. Until the reveal reaches an event, nothing it brought is shown anywhere else: a thread it opened or a letter it delivered is not in the chat list (nor its unread count or notification), a copy an agent stole in it is not in the Spy tab, and the advisor and the leaders speak from the world as the player has seen it (see [what the player has not been shown yet](ai-overview.md#what-the-player-has-not-been-shown-yet)).

**✋ Intervene here** sits under those two while events remain unrevealed (and no category filter is on, since the count is by reveal order). It asks once — *Stop the round after «title»? The N events not yet revealed will be discarded — they never happen — and the date becomes …* — then `runIntervene` calls `interveneAfterEvent(visibleEventCount)` (`gameplayLazy.js`): the engine rolls the game back to the turn's snapshot and applies the kept prefix of the turn's journal again, without a request (see [Intervene](ai-overview.md#intervene-stopping-a-round-where-the-player-wants-to-act)). The panel then shows the shorter turn fully revealed, the date widget the last kept event's date, and **Undo last turn** still works. Offered only when the newest snapshot carries a journal (`canInterveneInLastTurn`, re-checked with the round), never while a jump runs.

Each card shows what the event is about as **link chips** after its category tags — ⚑ a power, ⌖ a region, ⛊ a formation, ▣ a structure (`deriveEventLinks`, see [the event cards' links](ai-overview.md#the-event-cards-links)); a click flies the map there (`focusMapOnBounds`), which also serves a player who switched the event camera off. They replace the old unclickable participant tags wherever the map can frame something. The lookups they need (country names, the region catalog, the stock outlines) now load independently: a missing stock archive used to take the names and the catalog down with it, blinding the camera, the chips and the map-changes names alike. On a drawn map they frame by the map's own region boxes, and re-derive when the map's worker has primed them (`oh:region-catalog-primed`).

**⚡ Interactive event.** Now and then a skip offers one of its events to be played out as a scene (see [Interactive events](ai-overview.md#interactive-events-a-moment-a-time-skip-offers-to-play-out)). That event's card carries a yellow strip under its text (`InteractiveOfferStrip`, `time.jsx`): **Play it out** opens the interactive event panel (`oh:open-interactive-event`, §10-bis), **Let it pass** clears the offer (`declineInteractiveOffer`, free). Neither spends a request. The strip is there only once the reveal reaches the event, and goes when the offer is taken up, let pass or replaced by the next skip.

Each card's **N map changes** pill is a button: it opens a *What changed on the map* list under the card (`describeEventMapChanges`, `time.jsx`) — one line per territory transfer, control or contest change, claim, polity change (create / rename / restore / dissolve / update), unit spawn / move / strength / removal and structure build / update / rename / removal, with polity, region and unit names resolved (`resolvePolityName`, `resolveRegionName`, `getUnitById`). The count on the pill is the length of that list, so the two never disagree.

### 6.4 Pregame history

If a fresh game (round 1, no events/turns) has a "World Before Round One" briefing and the menu is closed, `maybeGeneratePregameHistory()` runs once (`time.jsx:1351`). The `isMainMenuOpen()` gate ensures tokens aren't spent on a game the player is only hovering past in the menu.

---

## 7. Actions panel — `src/Game/GameUI/actions.jsx`

`ActionsPanel` (`actions.jsx:225`) — bottom-left slide-up (z 9998). The player's planned-action queue for the current turn. An order that deploys or recalls a spy ("deploy a spy in Germany") is executed by the next time skip through the event's `impacts.spyOps` ([Espionage Orders] in `docs/ai-prompts.md`); the Spy tab still shows and manages the agents.

| Control | Effect | Connects to |
|---|---|---|
| Composer (textarea) + ✈ send | `createManualAction` → `writeActionsState` | `src/runtime/gameState.js` |
| ✦ sparkle | `refinePlayerAction(text)` rewrites the draft in place (no persist) | `src/Game/AI/gameplay.js` |
| **Help brainstorm actions** | `onOpenAdvisor` (opens the advisor drawer) | `Main.openAdvisor` |
| **Get/Refresh AI suggestions** | `generateActionSuggestions({force:true})` → `SuggestionCard`s | AI |
| Queue a suggestion | `normalizeSuggestionAction` → persisted; button flips to "✓ Queued" | — |
| Delete an action | `handleDelete`; if it was a queued unit order (`unitRevert`, still `planned`), also `revertUnitOrder` to undo its map effect | `src/Game/Map/unitsController.js` |
| **🎯 Standing goal** (`StandingGoal`) | Under the date line: *Set a standing goal*, or the goal with **Edit**; editing offers Save (Enter), Cancel (Esc) and **Clear goal**. Locked while a turn runs (polls `isSimulationBusy()`), since the turn writes the world the goal lives in. The advisor, the time skip and the suggestions steer by it; a leader never sees it | `withPlayerGoal` → `writeWorldState` (`src/runtime/playerGoal.js`); read with `useRuntimeState("world", playerGoalOf)` |

Only `status === "planned"` actions render. Country + date poll `JSON_URLS.game` every 5 s (display only). The launcher button (`Actions`, `actions.jsx:700`) lives in the toolbar.

---

## 7-bis. Projects & Operations panel — `src/Game/GameUI/projects.jsx`

`ProjectsPanel` (`projects.jsx:697`) — bottom-left slide-up (z 9998), the third `activePanel` slot after Chat and Actions. Its launcher `Projects` (the `ProjectsDockIcon` glyph) sits in the same `Toolbar` (`chat.jsx:2962`), which widened to hold three buttons (`12.8rem` at this commit). Entries are created and edited by the AI, by design; the player owns exactly two things on the board — a project's priority (`PrioritySwitch`) and whether to abandon it — see [World state](world-state.md) §2e-bis.

| Element | Behavior | Connects to |
|---|---|---|
| Data | Its own 5 s `setInterval` while open: `readWorldState({force:true})` + `JSON_URLS.game`, signature-gated so a poll that changed nothing does not re-render the list under the cursor | `src/runtime/gameState.js` |
| Cards | Kind glyph, name, status pill, owner, summary, tag chips, progress bar (`Bar`, copied from `stats.jsx:153`), timeline row, next milestone, last update | — |
| Derived badges | ⚠ Overdue / ⏳ Due in Nd / Milestone slipped / No recent progress — all from `deriveProjectFlags` against the game clock, never from what the model wrote, so they cannot go stale | `src/runtime/projects.js` |
| Sort & filter | `PROJECT_SORTS` dropdown, Mine/Foreign/All, and tag chips built from the live vocabulary (`collectProjectTags`). Open work always sorts above closed work whatever the chosen sort |
| Closed view | An **exclusive** switch, not an "also include" filter: off shows only running work, on shows only completed/failed/cancelled. It previously widened the list to everything, which — because the sort ranks open above closed — buried the closed entries under a screen of active ones and made the button look broken. `isProjectClosed` (`runtime/projects.js`) is the one definition the filter, the count and the sort all share | `src/runtime/projects.js` |
| **🧭 Ask advisor** | `onOpenAdvisor(seed)` — opens the drawer with a per-project brief request **pre-filled, never sent**; the same path the Actions panel's "Help brainstorm actions" button uses | `Main.openAdvisor` |
| **📍 Show on map** | Resolves `project.focus` → first linked marker → first linked unit, then `map.flyTo`. Hidden entirely when nothing resolves, rather than offered and inert | `mapRef`, threaded through `Toolbar` |
| Activity feed | Expanding a card resolves `project.eventIds` against `readEventsState()`, fetched **once and only after a first expand** — `events.json` is the largest runtime document and most opens never expand anything | `src/runtime/gameState.js` |
| Empty state | The **backfill path**, not a dead end: a button seeding the advisor with "put my ongoing efforts on the board". An existing campaign's history is already in the advisor's prompt, so it can reconstruct one | — |

Two authors create the board's entries (the player only sets a priority or abandons one): events through `impacts.projectOps` — supplied by the separate `projects` AI task after a jump, or inline by the game master — and the advisor through a ```` ```projects ```` block — `applyAdvisorProjects` in `advisor.jsx`, with an `AdvisorProjectsCard` receipt, the same "advisor creates, I review" contract as ```` ```actions ````. The advisor's write does a read-modify-write that spreads the **whole** world back; a shallow patch there would drop `polityOverrides`/`regionOwnershipOverrides` and blank the map.

## 8. Forces panel — `src/Game/GameUI/forces.jsx`

`ForcesPanel` (`forces.jsx:85`) — bottom-left panel (z 9999), a **controlled** component (open state owned by `Main.isForcesOpen`; opened from the toolbar historically, now primarily from the Cheats panel's "Manual force deployment"). Manual troop control is treated as a cheat.

| Element | Behavior | Connects to |
|---|---|---|
| Unit list | `subscribeUnits`/`getUnits`; split into "Your units" (`getPlayerCode`) and dimmed "Other forces". Clicking a unit `flyTo`s it | `src/Game/Map/unitsController.js` |
| Deploy controls | type (restricted by scenario `getAllowedUnitTypes()`), strength (1–1000), optional name → `setInteractionMode({kind:"deploy", params})` then closes the panel | unitsController |
| **Mode banner** (z 10000) | Global hint while `mode.kind !== "idle"` (deploy) + Cancel (`clearInteractionMode`) | interaction-mode state |

Owner codes render as full names via `ensurePolityNames`/`polityDisplayName` (re-renders once the lookup warms). `TYPE_GLYPH`/`TYPE_LABEL` map unit types to icons/labels; strength color-codes >600 green / >250 amber / else red.

---

## 9. Cheats panel — `src/Game/GameUI/cheats.jsx`

`CheatsPanel` (`cheats.jsx:164`) — right-side panel (z 10045), opened from Settings → 🧪 Cheats (lazy-loaded). A list of tools (`TOOLS`); selecting one renders `ToolView`. Several tools enter **click-capture mode**: the panel hides behind a toast (z 10070) and map clicks route through `setRegionClickInterceptor` instead of opening the region popup.

| Tool id | Does | Writes / calls |
|---|---|---|
| `master-ai` | **GM Console**: a natural-language request in one of three modes (direct correction, exact event, world intervention) is planned by the AI into a structured transaction, shown operation by operation, and only then applied | `previewGameMasterCommand(text, { mode })` → `applyGameMasterPreview(preview)` (`src/Game/AI/gameplay.js`). Apply revalidates the preview against a fresh world, fails closed if canonical state changed since the preview (fingerprint), writes through the event-impact seam plus the war/diplomatic ledgers and the Stats seam, links the events into the Events panel, and records `world.gmAudit`. Direct prose execution (`applyGameMasterCommand`) is disabled. |
| `reminders` | **Simulation Reminders**: issue, edit and withdraw the Game Master's standing facts (twelve at most), which every AI in the game is told until withdrawn; below them, *What the next time skip will be told* — every change made by hand this round, exactly as the skip will read it | `addReminder` / `editReminder` / `removeReminder` on `world.simulationReminders`; reads `world.gmChanges` (`src/runtime/gmChanges.js`). See [the Game Master's hand](ai-overview.md#the-game-masters-hand-changes-made-outside-the-simulation-and-standing-reminders). |
| `events` | **Event Editor**: search, create ("exact events"), edit and delete canonical events with quotations and metadata; an exact event may allow one NPC diplomatic reaction after a 12-second undo window | `writeEventsState`; manual events are linked into `world.simulationHistory`; reactions queue in `world.pendingEventOutreach` and are evaluated by `processPendingEventOutreach` (scheduled from the chat panel) |
| `interactive-event` | **Interactive Event**: pick any event on the record and it becomes the moment to play out as a scene — the offer a time skip makes on its own one skip in three (`runtime/interactiveOffer.js`). Rows say whether a skip could have offered that event (`isOfferableEvent`); an event the reveal has not reached cannot be offered, and neither can anything while a scene is in progress. Offering costs nothing; the scene costs what it always costs | writes `world.interactiveOffer` (never `lastInteractiveOfferRound`, so skips go on offering their own), dispatches `oh:open-interactive-event` and closes the Cheats panel so the scene is not covered |
| `history-document` | **History Document**: the living history the AI is shown in place of the folded events — read and edit it, fold the older events now, or reset compression; the timeline keeps every event in full | `world.historyDocument` and `world.consolidatedHistory` via `writeWorldState`; `consolidateHistoryNow` (`gameplay.js`) runs the `eventConsolidator` task on everything but the newest 24 events (`historyConsolidation.js` decides what a pass folds and how the document is revised) |
| `roll-back-turn` | Restore to the start of an earlier turn (discards later turns) | reads `JSON_URLS.snapshots`; writes game/world/events/actions/chat/colors |
| `your-country` | Switch which country you play | `writeGameData({…country})` |
| `difficulty` | Set difficulty (Difficulty 2.0: per-scope directives for simulation, diplomacy and interactive events) | `writeGameData({…difficulty})` (`DIFFICULTY_LEVELS`, `src/runtime/difficulty.js`) |
| `annex-country` | Click a country → fold all its regions into a target | resolves current owner via overrides + `loadRegionCatalog`; writes `regionOwnershipOverrides` |
| `annex-regions` | Click individual regions → transfer to a target | per-region `regionOwnershipOverrides` write |
| `edit-country` / `add-country` | **Country Editor** (identity, colour, tags, reputation, the persistent stat sheet) or create a polity (name **is** the identifier) | `polityOverrides` + `colors.json`; stats through `applyCountryStatPatchToWorld` |
| `regions` | **Region Inspector**: click a region → controller, lawful sovereign, claimants, provenance; change de-facto control (a control op), restore sovereign control, transfer legal sovereignty (a transfer), add/withdraw claims; rename on custom-geometry maps | `applyEventImpactsToWorld` with `regionTransfers` / `regionClaims` (the same seam events use); name via `regionsGeojson` |
| `groups` | **Groups**: list the world's groups (colour, name, region count); create one, edit its name, what it is (the AI's description) and its tint colour; **Edit the area on the map** (each click puts a region in the group's area or takes it out), **Clear the whole area**, **Erase group** (two clicks). The Region Inspector also has a **Group control** section: which group controls the region, **Release**, or put it under a group | `applyEventImpactsToWorld` with `groupOps` (the seam events use); every change is noted for the next skip (`gmChanges.js`, kind `groups`) |
| `edit-feature` / `add-feature` / `clear-features` | **Map Feature Editor**: runtime features (`world.markers`, with lifecycle status, owner, kind, location) and scenario cities | marker ops through `applyEventImpactsToWorld`; `citiesGeojson`; adding the first custom city flips `customCities: true` |

Every tool that changes the world records one sentence of it in `world.gmChanges` after its save succeeds (`noteGmChange`; a failed note never costs the edit): the GM console's transaction, a whole-country or region-by-region annexation (one growing line), a Region Inspector edit, a country edited or created, the player's country switched, cities and map features, an event written, edited or deleted, the history document rewritten, a rollback. The next time skip opens with them.

The log viewer that used to be a Cheats tool is now **View log** in Settings → Diagnostics (section 10).

Ownership/name resolution is done in **one namespace** (country display name) — the file's comments call out the recurring bug where a GADM code (`RUS`) and a name (`Russia`) never compared equal. All map changes repaint within ~5 s (the map's own poll).

`loadPolities()` (`cheats.jsx:103`) enumerates the countries actually in the game (polity overrides ∪ current region owners ∪ owners of rendered geometry — custom regions when present, else the stock catalog), each resolved to a display name.

---

## 10. Settings — `src/Game/GameUI/settings.jsx`

`SettingsButton` (⋮, `settings.jsx:709`) sits top-left (z 9999); toggles `SettingsMenu` (`settings.jsx:727`), a scrollable panel below it.

| Section | Control | Persists to / calls |
|---|---|---|
| Models | `FallbackListSection` — the Fallback list: one row per entry with its status (ready / Spent until … / Unusable: reason / busy, for about …; a status is what the row shows, never where a call starts) and when it last answered; reorder, edit, reset, remove; **Add a backup**, **Fill…** (`FillPanel`), and the rate-limit choice. With one entry it is the old single form: provider (`ApiProviderSelector`), key or endpoint, model. See `docs/ai-overview.md` | `providerConfig.js` (`addEntry`, `updateEntry`, `moveEntry`, `fillFallbackList`, `setRateLimitPolicy`…) |
| Connections | `ConnectionsSection` — saved provider + name + key + endpoint + custom parameters (+ **Strict tool schema** for OpenAI Compatible); templates for Groq, OpenRouter, Local Ollama | `addConnection`, `updateConnection`, `removeConnection` |
| Model reasoning | `ReasoningSection` — the global **Model reasoning** toggle | `setReasoningEnabled` |
| Language | `LanguageSelector` — searchable; applying reloads the page | `setStoredLanguage` (server + browser) |
| Display | **Fullscreen**, **3D Globe**, **3D Terrain** (labeled "Very Experimental") toggles | `Main` toggles / `App.jsx` state |
| Map | Hide country labels, **Reduce motion** (umbrella over the two below), Disable idle globe rotation, Disable camera movement during events | `setMapSetting(MAP_SETTING_KEYS.*)` (`src/runtime/mapSettings.js`) |
| AI | **Limit AI generation** (off by default; 5-min silence cap then canned fallback vs. wait-as-long-as-needed); **Generate long time skips in segments** (off by default); **AI lookup functions** (on by default: the model may call lookup functions before answering, see `docs/ai-overview.md`); **Batch background AI tasks** (Anthropic only, off by default — the event consolidator rides the Message Batches API, see `docs/ai-overview.md`) | `MAP_SETTING_KEYS.limitAiGeneration`, `MAP_SETTING_KEYS.batchBackgroundTasks`; **Record AI telemetry** / **Rate AI generations** (`telemetry.js`; recording on, rating off by default) and the **📊 AI debug console** button (`debugConsole.jsx`, lazy; see `docs/ai-overview.md`) |
| Diagnostics | `DiagnosticsPanel` — **📋 Copy log** / **💾 Save as file** (the Logging file, Desktop log merged in), **🔎 View log** (`DiagnosticsLogViewer`: the same entries, newest first, problems-only filter, click to expand), Clear, and the **Keep a diagnostics log** / **Detailed logging** switches | `buildLoggingFile` / `getLoggingFileEntries` / `setDebugLogEnabled` / `setDebugLogVerbose` (`src/runtime/debugLog.js`, see `docs/runtime-services.md`) |
| Footer | **🧪 Cheats** (→ `onOpenCheats`), **📖 Guides** (`/guides/`), Discord/Reddit/GitHub links | — |

`Toggle` (`settings.jsx:156`) is the shared switch primitive (also exported). Map-setting toggles read initial values from `getMapSetting` and mirror them locally.


---

## 10-bis. Interactive events — `src/Game/GameUI/interactive.jsx`

`InteractivePanel` — a centred yellow-edged dialog (z 10001), lazy, opened by `oh:open-interactive-event`: from **Play it out** on the card of the event a time skip offered, from the time panel's note about that offer, and from its *Return to the scene*. There is no other way in: the player does not start an interactive event, a skip offers one now and then (see [Interactive events](ai-overview.md#interactive-events-a-moment-a-time-skip-offers-to-play-out)).

| State | Controls | Calls |
|---|---|---|
| On offer | the event's title, date and description; *Your angle (optional)*; **Play it out** and **Let it pass**, the cost said beside them; a note, and **Play it out** off, while the reveal is unfinished | `createInteractive({ eventId, angle })`, `declineInteractiveOffer()` (then the panel closes) |
| A scene | title, premise, *Your angle*, each move played (**↶ Take back**), the scene's current text, the offered choices and an own-move box with **Play**, **End the scene** (off with no move played) and **Set aside** | `advanceActiveInteractive`, `rewindActiveInteractive({ beatIndex })`, `endActiveInteractive`, `setAsideActiveInteractive` |
| Finished | *The scene is over and written into the record* with **See it on the timeline** | — |
| Nothing | *No interactive event is waiting*, and when one comes | — |

One engine call at a time; a failed step changes nothing and its reason shows in the panel. **✕ Leave** closes the dialog and leaves a scene where it is, and an offer until the next time skip. A scene an older skip proposed and nobody took up is not shown.

---

## 11. Search — `src/Game/GameUI/search.jsx`

`Search` (`search.jsx:144`, memoized) — a small 2.4rem square just right of the three-launcher toolbar (13.8rem from the left, z 9999), its bottom edge level with the bottoms of the dock's buttons rather than the dock, so it reads as a utility beside the launchers and not another one; expands to an input (rightward on desktop, a full-width 3rem bar above the toolbar on mobile). Its position is derived from the dock's geometry in `hudDock.js`, which the `Toolbar` reads too: the two used to be separate literals, and when a fourth launcher (the since-removed Dossier) widened the dock the search control sat on top of it. Adding or removing a launcher moves it on its own. Debounced (200 ms) autocomplete against **Nominatim** (`nominatim.openstreetmap.org/search`), results deduped + cached in-module. Picking a result (click / Enter / ↑↓) calls `mapRef.current.flyTo({center:[lon,lat], zoom:5})`. Purely a camera control — it does not touch game state.

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
| 11 | Chat panel / conversation | `chat.jsx` | panel | `isOpen` | chats, country names, game | `sendDiplomaticMessage`, `runChatActionBatch`, `writeChatsState` |
| 12 | ✦ Actions button | `actions.jsx` | button | `activeBottomPanel==="actions"` | — | opens `ActionsPanel` |
| 13 | Actions panel | `actions.jsx` | panel | `isOpen` | `JSON_URLS.game`, actions | `writeActionsState`, `generateActionSuggestions`, `refinePlayerAction`, `revertUnitOrder` |
| 14 | Forces panel + mode banner | `forces.jsx` | panel | `Main.isForcesOpen` | units, allowed types, player code | `setInteractionMode`/`clearInteractionMode`, `map.flyTo` |
| 15 | Cheats panel + tools | `cheats.jsx` | panel | `Main.isCheatsOpen` (+ `shouldLoadCheats`) | world/game/events/catalogs | many `writeWorldState`/`writeGameData`/`writeJson`, `applyGameMasterCommand`, `setRegionClickInterceptor` |
| 16 | Search box | `search.jsx` | widget | local `expanded` | Nominatim | `map.flyTo` |
| 17 | Player flag badge | `other.jsx` | badge | always (desktop) | `JSON_URLS.game`, world | — |
| 18 | Main menu (Games/Scenarios/Community) | `libraryBar.jsx` | full page | `menuOpenDefault` | `useLibraryState`, hub posts | `activateGame`, `createGame/Scenario`, catalog refresh |
| 19 | Game/Scenario editor drawer | `libraryBar.jsx` | panel | `editorKind`/`editorDetails` | scenario/game details | `saveScenario`/`saveGame`, asset up/clear, `exportScenarioBundle` |
| 20 | Country / faction picker | `libraryBar.jsx` | modal | `countryPicker` | country options, custom regions | `createGame`, `saveGame`, `activateGame` |
| 21 | Map editor host | `libraryBar.jsx` | overlay | `isMapEditorOpen` | scenario assets | `applyMapToScenario` → many asset writes + new game |
| 22 | ⌂ Exit Game / summary | `libraryBar.jsx` | cluster | `!menuOpen` | `activeGame` | `setMenuOpen(true)` |
| 23 | Community hub tab | `communityHub.jsx` | panel | menu tab | GitHub hub API, `/api/hub/*` | `downloadHubBundle`+`importScenarioBundle`, publish/export |

---

## 14. Shared conventions

- **Surface styling**: most HUD elements share a `baseStyle`/`surface` object — `rgba(17,24,39,0.9)` bg, `backdrop-filter: blur`, 12px radius, subtle border/shadow. The main menu/editor use `surfaceStyle` (darker gradient + heavier blur).
- **Runtime state**: panels do not poll. They subscribe to a slice of the shared store (`src/runtime/runtimeStore.js`, usually via `useRuntimeState`), which is pushed by canonical write events (same-tab, and cross-tab over a `BroadcastChannel`) rather than polled, and wakes a panel only when its own slice changed. A 60-second backstop read covers writers no event reaches. See [World state §9](world-state.md#9-state-distribution-three-stores-no-panel-polls).
- **`data-no-translate`**: player-typed text, economic figures, and raw dropdown values are marked so the UI translator ([i18n](i18n.md)) leaves them verbatim.
- **Mobile branching**: `useIsMobile()` (`src/runtime/useIsMobile.js`) reshapes the search box, the date/country row, the exit cluster, and menu paddings. The advisor drawer and bottom panels clamp to `calc(100vw − …)`.
- **Lazy chunks**: advisor (Chart.js + markdown), cheats, community hub, the map editor, and the OpenLayers country picker are all `React.lazy` — none are in the first paint.
