# In-Game UI (HUD, Panels & Buttons)

The in-game UI is a flat set of `position: fixed` React components layered over a full-screen MapLibre canvas — there is no single container div, each widget positions itself against the viewport edges and competes for the stacking order through an explicit z-index ladder. `src/Game/GameUI/main.jsx` is the shell: it mounts every HUD element, owns the panel-open booleans, and computes `advisorDockStyle` (the `right`, `transform` and `transition` that keep the top-right cluster beside the advisor drawer as it opens, closes and is resized). Everything the UI reads or writes flows through the runtime state stores and the AI layer (`src/Game/AI/*`) — the components hold almost no game data of their own. Most read the shared HUD store (`useRuntimeState`, see [state distribution](world-state.md#9-state-distribution-three-stores-no-panel-polls)), which a write updates on arrival, with a 60 s backstop read (`RUNTIME_BACKSTOP_MS`), and push edits back through `writeJson` and the `gameState.js` writers; a few panels named below still poll on their own while open (see §14).

- Shell & mount point: `src/App.jsx` (`GameApp`) renders `<UI>` = `src/Game/GameUI/main.jsx` once `isReady`, passing `mapRef`, `isGlobeEnabled`, `isTerrainEnabled`, and their setters.
- Related pages: [World state](world-state.md) · [AI gameplay pipeline](ai-overview.md) · [Map rendering](game-map.md) · [Library & scenarios runtime](runtime-services.md) · [Diplomacy & chat](ai-overview.md)

---

## 1. The GameUI shell — `src/Game/GameUI/main.jsx`

`Main` is the default export (`src/Game/GameUI/main.jsx`). It is mounted by `App.jsx` and **keyed on the active game id** (`key={\`ui-${activeGameId}\`}`, `src/App.jsx`) so the entire UI tree remounts when a game activates. That remount is why several open/closed flags live at module scope instead of component state (see [§4.1](#41-menuopendefault--the-remount-trap)).

### 1.1 Props

| Prop | Source | Used for |
|---|---|---|
| `mapRef` | `App.jsx` `useRef` handed to `<Map>` | Passed to `DateWidget`, `Toolbar`→n/a, `Search`, `ForcesPanel`; components call `mapRef.current.flyTo/fitBounds/getMap()` to move the camera |
| `isGlobeEnabled` / `setIsGlobeEnabled` | `App.jsx` state (persisted `localStorage["Globe"]`) | Fed to `SettingsMenu`'s **3D Globe** toggle; `App.jsx` re-projects the map |
| `isTerrainEnabled` / `setIsTerrainEnabled` | `App.jsx` state (persisted `localStorage["Terrain"]`; before the first choice, off on a device `isConstrainedDevice()` calls constrained and on elsewhere) | Fed to `SettingsMenu`'s **3D Terrain** toggle |

### 1.2 Local state in `Main`

| State | Init | Purpose |
|---|---|---|
| `isSettingsOpen` | `false` | ☰ game menu visibility |
| `isCheatsOpen` / `shouldLoadCheats` | `false` | Cheats panel open + lazy-load latch (never imports the chunk until first opened) |
| `isAdvisorOpen` / `shouldLoadAdvisor` | `false` | Advisor drawer open + lazy-load latch |
| `advisorWidth` | `readAdvisorWidth()` | Drawer width in px, persisted (see [§5.1](#51-advisor-width-state)) |
| `isForcesOpen` | `false` | Forces panel open (also opened from the Cheats panel) |
| `activeBottomPanel` | `null` | Which bottom panel (`"chat"`, `"actions"`, `"skip"`, `"history"`) is open — single-slot, so opening one closes another |
| `isFullscreenEnabled` | `false` | Mirrors the Fullscreen API state; not persisted, so a game always opens windowed |
| `showWebGLWarning` | `false` | Set true if `checkWebGL()` fails on mount → renders `WebGLWarningPopup` |
| `aiSetup` | `readAiSetup()` | `{ ready, provider }`: whether the Fallback list has an entry its provider can call, and the top entry's provider for the start-of-game prompt. Re-read on `ai:fallback-changed` |
| `{ games, loaded }` | `useLibraryState()` | `hasNoGames = loaded && games.length === 0` gates the idle-diplomacy timer |

### 1.3 Side effects owned by the shell

| Effect | Behavior | Connects to |
|---|---|---|
| WebGL probe | On mount, `checkWebGL()`; on failure shows the popup | `src/Game/GameUI/main.jsx` |
| **Idle diplomacy drip** | Every 60 s, if the tab is visible, a game exists and the main menu (and the Workshop over it) is closed, lazy-imports `../AI/gameplay.js` and calls `maybeSendIdleDiplomacy()` | `src/Game/AI/gameplay.js`; drops a message into the diplomatic chat store unprompted |
| **Spy report timer** | Every 60 s, on the same guards, calls `maybeGatherIntelligence()`: roughly one report every twenty minutes per deployed agent, each an AI request, so none while the player is in the main menu or the Workshop | `src/Game/AI/gameplay.js`; writes the intercepts asset |
| Advisor lazy-load latch | `isAdvisorOpen` → `setShouldLoadAdvisor(true)` (one-way) | Keeps the Chart.js/markdown chunk out of first paint |
| Fullscreen sync | Listens `fullscreenchange`/`webkitfullscreenchange` | `toggleFullscreen()` probes prefixed APIs (mobile Safari safe) |
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
| `Search` | `search.jsx` | Place search: the world's own places first, then Photon → camera + the place's card |
| `ForcesPanel` | `forces.jsx` | Unit list + deploy controls + mode banner |
| `AdvisorButton` (🧭) | `main.jsx` (inline) | Toggles the advisor drawer; placed by `advisorDockStyle` |
| `AdvisorPanel` | `advisor.jsx` (lazy) | Advisor chat + Stats tabs, resizable drawer |
| `CheatsPanel` | `cheats.jsx` (lazy) | God-mode tools (opened from the game menu's Tools tab) |
| `InteractivePanel` | `interactive.jsx` (lazy) | Interactive events: an event a time skip offered, played out as a scene beat by beat (opened by `oh:open-interactive-event` from the offered event's card or the time panel). See [§10-bis](#10-bis-interactive-events--srcgamegameuiinteractivejsx) |
| `SettingsButton` (☰) | `settings.jsx` | Toggles the game menu; same corner and size as before, glass finish |
| `SettingsMenu` | `settings.jsx` | Ported from kernely's Continuum branch as it is there: a quick menu with Game / Tools / Settings / Help tabs (session card, Game Management, Cheats, Events, AI debug console, Guides, bug report, community links) and `SettingsWorkspace`, a full-screen portal with Continuum's four sections — General, Map (with the basemap picker), AI, Advanced. This branch's own settings (profiles, per-task models, segments, batching, telemetry, beta units, network sharing, the download cache (Storage), diagnostics) sit inside those four sections |
| `ApiSetupPrompt` | `apiSetupPrompt.jsx` | Shown once per game per session when nothing in the Fallback list has what its provider needs (`providerConfig.js isFallbackListConfigured`). The prompt IS the setup: a provider select, the key (or the endpoint for a self-hosted provider) and an optional model, saved by `applyQuickAiSetup` (completes a key-less connection for that provider or adds one, and moves its entry to the top of the list); the `ai:fallback-changed` refresh then hides the prompt. Above the form: an embedded YouTube tutorial on getting a free Gemini key (privacy-enhanced embed, hideable) and a **Get a key at Google AI Studio** button (external link). **Open full settings** opens the game menu on the AI section (`SettingsMenu initialSection`), **Not now** dismisses it |
| `GameLoadingScreen` | `gameLoadingScreen.jsx` | The screen a game opens under: the logo turning over a dark ground until the map is drawn. `useGameLoading` starts loading with every game (this UI is remounted per game), waits for `oh:map-polities-ready` for the game's regions asset (`runtime/mapReadiness.js`; Nations.jsx marks it after the boundary worker answers, or at once on a stock map) and then for the next `oh:map-idle` (World.jsx), with a 60 s ceiling; fades off through `Presence`. Also shown when the 3D globe is switched on or off: App.jsx calls `announceMapRerender()` before the projection state changes, since the map instance is keyed on it and redraws from nothing |
| `BordersFallbackNotice` | `bordersFallbackNotice.jsx` | A dismissible note, once the map has settled, when its borders and labels fell back to the simpler form: the boundary worker could not start, or failed twice (`politiesFailed()`, `runtime/mapReadiness.js`). Once per game |

---

## 2. Z-index ladder

Every fixed element declares its own `zIndex`. From back to front (source-verified):

| z-index | Element | File |
|---:|---|---|
| 9997 | In-game floating cluster (session summary pill, **⌂ Exit Game**) | `libraryBar.jsx` |
| 9998 | Timeline panels (`panelSurface`), **Actions** panel, **Chat** panel | `time.jsx`, `actions.jsx`, `chat.jsx` |
| 9999 | `DateWidget` pill, bottom `Toolbar`, `Search`, `Other` flag badge, 🧭 `AdvisorButton`, ☰ `SettingsButton`, `SettingsMenu`, `ForcesPanel` body, `WebGLWarningPopup` | shared `baseStyle`/`widgetSurface` |
| 10000 | Forces **mode banner** (deploy hint) | `forces.jsx` |
| 10028 | "Loading games and scenarios…" indicator | `libraryBar.jsx` |
| 10040 | **Advisor drawer** | `advisor.jsx` |
| 10045 | **Cheats panel** | `cheats.jsx` |
| 10046 | **Main menu** (full page) | `libraryBar.jsx` |
| 10048 | **Editor drawer** (game/scenario editor) | `libraryBar.jsx` |
| 10050 | **Map editor** overlay | `libraryBar.jsx` |
| 10060 | **Country / faction picker** modal | `libraryBar.jsx` |
| 10070 | Cheats **click-capture toast** | `cheats.jsx` |
| 20000 | **Server stopped** full-screen overlay | `libraryBar.jsx` |
| 99999 | Chat reaction tooltip (React portal to `document.body`) | `chat.jsx` |

Design intent captured in comments: the advisor drawer (10040) sits above every HUD button/panel so nothing covers it on phones, but below the editor/picker/server-down overlays. The editor drawer (10048) deliberately lands **above** the main menu (10046) because the menu's `+`/Edit buttons open it. The in-game cluster sits at 9997 — below the settings menu and date widget (9998/9999) — so opening either covers it rather than the reverse.

---

## 3. Bottom toolbar & diplomacy — `src/Game/GameUI/chat.jsx`

`Toolbar` (`chat.jsx`) is the bottom-left 2-button cluster (`bottom/left: 0.5rem`, z 9999). It's memoized and driven by `activePanel`/`onTogglePanel` from `Main`.

| Button | Component | Opens | Notes |
|---|---|---|---|
| 💬 Chat | `Chat` (`chat.jsx`) | `ChatPanel` (bottom-left, z 9998) | Unread badge plus incoming-message notifications: one event-driven watcher (runtime JSON writes, `oh:diplomacy-chats-updated`, tab visibility, a 30 s safety interval) keeps a per-chat cursor (`oh:chat-notification-cursors-v2`), toasts a foreign message that lands while its thread is not on screen (top-right, left of an open advisor or country drawer through `--oh-right-drawer-safe-offset`, which `main.jsx` sets; 12 s, click opens the thread), plays a two-note chime (`oh:chat-notification-sound-v1`, 🔊 toggle), keeps a 🔔 notification center bottom-left until the panel opens (bell and toasts stay off the main menu — `useMainMenuOpen` from `libraryBar.jsx`), and can raise desktop notifications once permitted; `window.__OH_DIPLO_NOTIFICATIONS__` (`status`, `test`, `testExistingChat`, `testSound`, `enableDesktop`, `clear`) exercises it |
| ✦ Actions | `Actions` (`actions.jsx`) | `ActionsPanel` | See [§7](#7-actions-panel--srcgamegameuiactionsjsx) |

Both launchers use `hasOpened` latches so the panel body isn't mounted until first opened.

### 3.1 ChatPanel (diplomacy)

| Concern | Detail | Connects to |
|---|---|---|
| Data | `chats` from `readChatsState`/`writeChatsState`; player country + date from `useRuntimeState("game", selectGameIdentity)`. A list that could not be read is not taken for an empty one: a strip says *Could not load your conversations.* with **Retry**, and nothing is saved until a read succeeds (chats begun meanwhile join the list when it loads). A save that fails says *Your latest messages were not saved.*, keeps the list in memory, and **Retry** saves it again. The advisor does the same for its conversation (`StorageProblemNotice`). | `src/runtime/gameState.js`, `src/runtime/runtimeStore.js` |
| Country list | `loadCountryNames()` (PMTiles-derived), filtered to exclude the player | `src/runtime/assets.js` |
| Live sync | While open, subscribes to the store's `chat` slice (`subscribeRuntime("chat")`, refreshed once on open) and merges additions (jump invitations, idle drip) without clobbering the active conversation. The list's puppet and overlord markers are re-read every 15 s | `src/runtime/runtimeStore.js` |
| Send | One-on-one sends directly to the sole AI counterpart via `sendDiplomaticMessage(text, countryName, countries)` → `{ reply, reaction, memorySummary }`. Group and institution conversations (an institution's Council even when only one AI member sits in it, and an accession hearing) use `runChatActionBatch` as the single canonical AI request: that batch decides which AI participants speak/react/vote/stay silent and their order. There is no standalone speaker-selection request or sequential group fallback. | `src/Game/AI/main.jsx`, `src/Game/AI/gameplay.js`, `src/Game/AI/chatActions.js` |
| Group turn UI | A group turn is revealed from the one-request action batch a line at a time; the player may cut in before later planned lines are written. No queued "Let X speak" legacy phase remains. | `ConversationView`, `planChatReveal` |
| Conversation view | A date separator opens every new game day; the last 12 messages render first with a "Show earlier" button; stacked flags on list rows; a leader's message is dated through `gameDates.js` (it used to show a day early west of Greenwich); a document delivered through diplomacy is a message like any other, its `📄` heading in bold ([§6.2-bis](#62-bis-documents-where-they-arrive)) | `ConversationView`, `ChatListItem` |
| External trigger | `requestDiplomaticChat(country)` bridge (`chat.jsx`) lets the map region popup open/reuse a 1-on-1 chat | Map selection layer |
| Reactions | Leader reactions attach an emoji to the player's last message; hover tooltip is a portal at z 99999 | — |
| Catch-up line | A line the player sends after the world moved on carries a note for the leader (`buildLeaderCatchUp` → `conversationCatchUp.js buildThreadCatchUp`, from the moment the player has been shown): the bubble shows `⏳ Since 1 December 2015 · 3 events · 1 border change`, the whole note on hover. Stored on the message (`catchUp`, `catchUpLabel`), sent ahead of the words one-to-one and in the group batch | `src/Game/AI/main.jsx`, `src/Game/AI/gameplay.js` |

---

## 4. Main menu & library — `src/Game/GameUI/libraryBar.jsx`

`LibraryTopBar` (exported at `libraryBar.jsx`) is a single large component that renders the whole main menu, both editor drawers, the country picker, the map-editor host, and the in-game floating cluster. It subscribes to `useLibraryState()` (`src/runtime/library.js`) for `games`, `scenarios`, `activeGame`, `activeGameId`, `selectedScenarioId`, `countryNames`, `loaded`, `loading`, `error`.

### 4.1 `menuOpenDefault` — the remount trap

`menuOpenDefault` (`libraryBar.jsx`) is a **module-scoped boolean**, not state. The whole UI remounts on game activation (App keys on `activeGameId`), so per-component `useState("open")` would reset the menu back open mid game-start. Every open/close goes through `setMenuOpen` (`libraryBar.jsx`), which writes the module var **first**, then the React state. Flows that activate a game (`startGameForCountry`, `handleGameActivate`, `applyMapToScenario`, …) call `setMenuOpen(false)` **before** awaiting the request, so the remounted instance mounts closed over the new game.

- `isMainMenuOpen()` (exported, `libraryBar.jsx`) lets background work (e.g. `maybeGeneratePregameHistory` in `time.jsx`) skip while the player is only browsing.
- `openLibraryTab(tab)` (exported, `libraryBar.jsx`) + module `_openLibraryTab` bridge lets outside callers open the menu on a specific tab.

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
| `yourScenarios` | filter `!hubOrigin` or `hubOrigin.editedAt` (a hub import the player has edited), and not the untouched built-in | `scenarios` |

### 4.4 Cards

**`GameCard`** (`libraryBar.jsx`) — cover image + accent gradient; shows country/date/round, pending-action & event counts. Buttons:

| Button | Handler | Effect |
|---|---|---|
| Play / Current | `onActivate`→`handleGameActivate` | `activateGame(id)`; closes menu (module flag first) |
| Edit | `onEdit`→`openGameEditor` | `loadGameDetails` → editor drawer |
| Clone Game | `onClone`→`handleGameClone` | `createGame({seedGameId, setActive})` → editor |

**`ScenarioCard`** (`libraryBar.jsx`) — asset badges (Cities/Colors/Countries/Regions PMTiles), game count. Cover art receives a stronger dark scrim and the title/body copy uses a dedicated multi-layer text shadow so authored scenario text stays legible over bright or detailed images without an opaque text panel. Buttons:

| Button | Handler | Effect |
|---|---|---|
| **New Game** / **⬆ Update** | `onPlay`→`handleScenarioPlay` **or** `onUpdate`→`handleScenarioUpdate` | Update replaces the primary action when a hub-imported, unmodified scenario has a newer bundle upstream (see [§4.7](#47-hub-update-detection)) |
| Edit | `onEdit`→`openScenarioEditor` | `loadScenarioDetails` → editor drawer |
| Clone Scenario | `onClone`→`handleScenarioClone` | `createScenario({seedScenarioId, setActive})` |
| (whole card) | `onSelect`→`selectScenario` | Marks `selectedScenarioId` |
| **💬 N suggestions** (only on the player's own posted scenario with suggestions waiting) | `SuggestionCountBadge` → `onEdit` | Opens the drawer, whose Community card lists them (see [§4.8](#48-suggested-changes)) |

### 4.5 Country / faction picker (New Game flow)

`handleScenarioPlay` (`libraryBar.jsx`) opens a modal (z 10060) instead of starting immediately. Two nested steps:

| Step / state | UI | Resolves to |
|---|---|---|
| `pickerTab === "country"` | `CountryPickerMap` (lazy OpenLayers) + a country list built by `buildScenarioCountryOptions` (`src/runtime/newGameWorld.js`, with `worldWithFaction` and `worldWithPlayerGroup`, unit-tested in `newGameWorld.test.js`; only factions the scenario actually contains: `world.ownerCodes` ∪ `polityOverrides`, incl. landless factions) | `pickCountry(code)` → `difficultyPick` |
| `pickerTab === "faction"` | `FactionCreator` (invent a nation: name/color/lore/flag/regions) | `pickFaction(faction)` → `difficultyPick` |
| `pickerTab === "group"` | **Play as a group**: the scenario's groups (`scenarioGroupsFor(world)`: colour, name, how many regions each controls) and, below, `FactionCreator mode="group"` (name, colour, flag, description, starting area — "controlled", never "claimed") | `pickGroup(group)` → `difficultyPick` (the header shows the group's swatch and name) |
| `difficultyPick` set | Difficulty grid from `DIFFICULTY_LEVELS` (`src/runtime/difficulty.js`) | `pickDifficulty(id)` |

`pickDifficulty` routes to `startGameForCountry` (new game with country), `startGameForFaction` (new game seeded with an invented polity — merges into `world.polityOverrides`/`regionOwnershipOverrides`/`ownerCodes` via `worldWithFaction`, writes colors/flags; if the new game's seeded world cannot be read the start stops with an error in its editor rather than writing a world holding only the faction — `seededWorldOf`, and the same for a group), `startGameForGroup` (the player leads a group: a landless polity of the group's exact name in `polityOverrides` and `ownerCodes`, the group in `world.groups` and its starting area in `groupAreas` — the regions stay their countries'; `worldWithPlayerGroup`; see world-state.md `groups`), or `choosePlayCountry` (Apply-&-Play: `playGameId` set → refines an already-active game). Creating a game with `setActive: true` remounts the whole UI (App keys it on `activeGameId`), so what a flow still owes the new game — the Apply-&-Play picker (`openPlayCountryPicker`), or an error from the setup after the activation, shown in the game's editor — is left with `handOffAfterActivation` (`src/runtime/afterActivation.js`) and taken by the instance mounted for that game. A successful New Game, faction or group start, or clone goes straight into the game with no drawer; an instance already unmounted never writes the menu flag. Custom scenario geometry is loaded via `downloadScenarioJsonAsset(id, "regionsGeojson")` so the picker map shows real borders. Every load the picker starts (countries, owners, groups, borders, basemap) is tied to that opening of it (`createLatestRequest`, `src/runtime/latestRequest.js`): closing it, or opening it on another scenario, drops whatever is still on its way.

### 4.6 Editor drawer (game & scenario editor)

`EditorDrawer` (`libraryBar.jsx`) — the fixed right-side form (z 10048, `width: min(34rem, …)`), the primary scenario/game authoring surface. Driven by `editorKind` (`"scenario"`|`"game"`), `editorDetails`, `editorState`, `editorSection`, `promptSectionKey`.

Section tabs (`SectionTabs`): scenarios show `overview | world | features | prompts | assets | bundles`; games drop `bundles`.

| Section | Fields | Writes via |
|---|---|---|
| overview | Scenarios only, at the top: the **Community card** (`ScenarioCommunityCard`, see [§4.8](#48-suggested-changes)). Then Name, Eyebrow, Accent (color), Subtitle, Description, Hero Title, Hero Subtitle | `saveScenario`/`saveGame` meta |
| world | Player Country (a list of the countries and factions the map offers, `buildScenarioCountryOptions` over the scenario's or the game's own world, and a warning under the field for a name not on it, `isOfferedCountry`; the warning does not block Save), Game Date, Language, **Deployable Troop Types** (scenario only, `UNIT_TYPES` toggles), World Before Round One (`startingTimelineText`), Simulation Rules, Country Label Font/Letter Color/Border Color | merged into `world` |
| history (**Pre-history**, scenario only) | `PrehistoryPanel.jsx`: the events before round one, kept with the scenario so a new game opens with them and asks no model ([§6.4](#64-pregame-history)). **Generate**: a prompt box and **Generate pre-history** (`generateScenarioPrehistory`, one request; it reads the scenario's map, start date, World Before Round One and Simulation Rules, and replaces the events after a confirm; Cancel aborts it). **Events**: one card each — Date (`YYYY-MM-DD`, a negative year is BC), Title, Description, and under *Advanced event metadata* Importance, Kind, Categories (the timeline's tags), Notable and an optional quotation (text, speaker, role); reorder, remove, **+ Add event** (up to 60). An event without a title, with a date that does not read, or not before the start date is marked and blocks Save. **Summary**, and the **Day-one facts** a generation wrote (wars, relations, agreements, subordinations, storylines), each removable. **Save pre-history** writes `world.prehistory` (`runtime/scenarioPrehistory.js`) on its own; **Discard changes** goes back to the saved record. A scenario with a briefing and no record yet may save an empty one on purpose: its games then open with no backstory rather than asking for one. | `saveScenario({ worldPatch: { prehistory } })` |
| features | `FeaturesSectionEditor` (`FeaturesSectionEditor.jsx`): one card per entry of `FEATURE_DEFINITIONS` (`server/gameFeatures.js`) — today Espionage, Puppet states (off: nothing about subordination reaches the simulator, the leaders, the map or the advisor, and the ledger waits as it was), Idle diplomacy with its "one attempt every N minutes" setting, Player focus (no on/off, `toggleable: false`: the level a new game starts on — World first, Balanced, Focused or Spotlight — which the player changes for their own game in Settings → AI → Generation behavior), and World direction (the pace, the world's share, the map's tempo, and two `type: "text"` settings — the priority rules and the scripted events, one dated beat per line, with a count of recognised beats and each ignored line listed under the box — rendered as textareas that show what was typed rather than the normalized value, because the normalizer trims and a field that trims on every keystroke cannot hold the space between two words. A scenario's number settings likewise show the typed text while it is being typed — the normalizer clamps and rounds, so each keystroke of "60" into a 40–250 field read 40 — and settle to the clamped value when the field is left; a game's override is clamped the same way on leaving the field; see [world direction](ai-overview.md#world-direction-what-an-author-sets-as-numbers)). A scenario edits its complete configuration (On/Off + settings), the default for every game made from it; a game edits only overrides, each control offering **Scenario default** so an unset field keeps following the scenario, including changes made to the scenario later (`resolveFeatures`). The library resolves the active game's features into `src/runtime/gameFeatures.js` (`useActiveFeatures` for the UI, `isActiveFeatureEnabled` for the simulation): espionage off hides the Spy tab and stops spy reports, intercept refreshes, the turn's espionage resolution and the simulator's spy orders; groups off gives no request the groups or the time skip's `[Groups]` rule, leaves out any `groupOps` the model writes (`validateGeneratedWorldChanges`), and hides group areas on the map and the region card's group line, while `world.groups` is kept for a game switched back on; idle diplomacy's setting sets the per-minute chance of the whole idle pulse, `maybeSendIdleDiplomacy` (one request that may send a note and move a few forces), and off stops it entirely, movement included. Scenario and game bundles carry `features`. | `saveScenario`/`saveGame` meta `features` (`readScenarioMeta`/`readGameMeta` normalise it on both stores) |
| prompts | `PromptSectionEditor`: one tab per section of `PROMPT_EDITOR_SECTIONS` (the prompts with guidance), and inside it one textarea per guidance passage declared in `promptGuidance.js` (the role, the tone, what to simulate, what makes a good event…) with **Reset to default** per passage and per section. The technical text — placeholders, output contracts, map rules — is never shown or stored, so it cannot be broken here and it follows the app's defaults as they change; a pack in the old whole-prompt shape is ignored (ai-prompts.md §2). | `serializePromptPack` → `prompts` as `{ promptModel: 2, guidance }` |
| assets | Upload/Reset per asset (cover; scenario adds cities/colors/countries/regions) via hidden file inputs; the form keeps whatever was typed and not yet saved | `uploadScenarioAsset`/`clearScenarioAsset` etc. |
| bundles | **Download .zip** / **Download JSON** (`exportScenarioBundle` + `splitScenarioBundleImage`) | disk download |

Closing the drawer (its ✕, or Back on a phone) asks first when the form or the Stats sheet holds changes not saved (`closeEditor`: `formDiffers` in `src/runtime/editorForm.js` against the form the saved record builds); staying keeps Back's step.

Footer: **Save** (`handleSave`), **🗺️ Open Map Editor** (scenario only — `openMapEditorFor` loads current geometry/owners/cities/palette/flags/background then opens the lazy `MapEditor` at z 10050; on apply → `applyMapToScenario`), **Suggest changes** (only on a scenario downloaded from the hub, `record.hubOrigin`; see [§4.8](#48-suggested-changes)), **Delete** (if `record.canDelete`, `window.confirm`).

Save is careful: scenario writes merge `currentGame`/`currentWorld` so a partial write never wipes `startDate`/`gameDate`/`round` or `polityOverrides`/`ownerCodes` (the "Undated" and wiped-map bugs called out in comments). A game's Save sends only the fields changed in the form (`changedFields`, `src/runtime/editorForm.js`) as `gamePatch`/`worldPatch`, which the store merges into the files as they are now: the drawer can stay open over the map while turns are played, and writing back the `game.json`/`world.json` it loaded rolled the date, round, borders, units and polities back. Both stores resolve a patched player country against the stored world with the patch merged in, not the patch alone.

### 4.7 Hub update detection

When the Scenarios tab shows any unedited hub import (`hubOrigin` without `editedAt`), an effect (`libraryBar.jsx`) calls `fetchHubPosts()` (`src/runtime/hubPosts.js`, cached five minutes) and builds `hubPostById`. `scenarioUpdateAvailable(scenario)` returns true when the post's current `bundleUrl` differs from the imported one (`hubUpdateAvailable`, `hubPosts.js`) → the card's primary button flips to **⬆ Update**. `handleScenarioUpdate` calls `downloadHubBundle` + `updateScenarioFromBundle(id, bundle)`, replacing the copy in place (existing games keep working) and re-stamping `hubOrigin` with the post's title and author. When the new version references a community basemap that cannot be downloaded, `resolveScenarioBundleBackground` (`communityBasemaps.js`) keeps the reference with the reason (`missingReason`) instead of deleting it; both stores' `updateScenarioFromBundle` then keep the scenario's existing `background.json` and its `world.background`, and the player is told why. An import that meets the same failure goes ahead without the basemap and says so ("…could not be downloaded (reason). Try again later."). An **edited** copy is never offered an update, which would overwrite the player's work: its player suggests their changes to the post instead (§4.8).

The Community tab asks the same question of every card. `hubCopiesByPostId` groups the library's scenarios by `hubOrigin.postId`, and `hubCopyStatus` says what the library holds of a post: **In your library** (an unedited copy of its current file), **Update available** (only unedited copies it has moved past) or **Edited copy in your library**. A card or detail page for a post the library holds asks before importing another copy: **Import again**, then **Import a second copy**. The detail page's main button is **▶ Play your copy** (the library's `handleScenarioPlay`, passed in as `onPlay`) when the library holds one, and **▶ Import & Play** otherwise, which imports and then opens the country picker over the menu. The Community tab stays open after an import, so its notice (and a missing-basemap warning) is seen.

### 4.8 Suggested changes

A player who downloaded a community scenario and changed it can send the changes, not the whole scenario, back to its author. The suggestion travels as a **comment on the original post** with a small `.zip` attached, and the author accepts or rejects each change, like tracked changes in a word processor. Everything reads the hub without signing in: GitHub's unauthenticated API allows 60 requests an hour, and no Worker writes to GitHub. The player posts the comment themselves.

**What each scenario remembers** (`server/hubProvenance.js`, shared by both stores; see [server.md](server.md#hub-provenance-where-a-scenario-came-from-and-where-it-went)):

| Field | Meaning |
|---|---|
| `hubOrigin` | The post this copy was downloaded from (`postId`, `bundleUrl`, `title`, `author`). An edit keeps it and stamps `editedAt`. **Unlink from the community post** (`handleUnlinkOrigin`, with a confirm) writes `hubOrigin: null`: the copy is the player's own from then on, and is compared with nothing. |
| `hubPublished` | The player's own posts of this scenario: `key` (the `Scenario-Key` written into the post by **Publish**), `postIds`, the `suggestions` found in their comments, the `blocked` contributors, and the `commentCounts` last seen. |
| `hubReviews` | Per suggestion: `reviewing` / `done` / `dismissed`, and the ids of the changes accepted and rejected. |

**The Community card** (`ScenarioCommunityCard`, at the top of the drawer's Overview) shows what applies:

- **From the community** (a download): the post (`View the post ↗`), whether the copy is changed, **Suggest changes** and **Unlink from the community post**.
- **Your post on the hub** (the player's own post): the suggestions waiting, grouped by contributor (each **Review**, **View the comment on GitHub ↗**, and **Reject all from @login**), the reviewed and dismissed ones behind **Reviewed suggestions (N)**, **Check for suggestions** (a forced read), **Open a suggestion file** (a `.zip` someone sent another way), the **Blocked contributors** with **Unblock**, and **Unlink the post** (stops looking; the post stays on the hub).
- **Link my post**: a scenario published before this version carries no key; the player gives the post's address or number (`handleLinkPost`). `postIdFromInput` (`hubPosts.js`) reads the number after `/issues/`, so an address copied from a comment (`…/issues/412#issuecomment-…`), or with a trailing slash or a query, links post 412; anything that is neither an address nor a number says *That is not a post's address or number.*

**Suggest changes** (`SuggestChangesDialog`, `ScenarioSuggestions.jsx`). Unsaved edits in the drawer are saved first, with a confirm (`handleSuggestChanges`). The dialog downloads the post's bundle and exports the copy (`exportScenarioBundle`), and `diffScenarioBundles` (`src/runtime/scenarioChanges.js`) lists what changed, in two parts: **Changes outside the map** and **Changes on the map**. An unchanged copy says so. The player may add a name and a note. **Save the file and open the post** then does three things. It opens the post at its comment box first, while the click still counts as the player's. It copies the comment (`buildSuggestionComment`) to the clipboard. It saves `<scenario>-suggestion.zip` (`buildSuggestionZip`). **Only save the file** skips the post. The dialog then shows the steps: paste the comment, drag the file in, click Comment. The comment's text is also shown there, for when the clipboard was refused.

**The author learns of it.** When the menu opens, the effect at `libraryBar.jsx` reads the post list once (`fetchHubPosts`: every page of the hub's scenario issues, `hubIssues.js`, cached five minutes and shared with the basemap and flag browsers; the effect itself runs at most once every five minutes). `refreshPublishedRecord` (`hubPosts.js`) finds the posts carrying the scenario's key. It then reads a post's comments only when the post's comment count has moved, every page of them (`fetchPostComments`); a page that fails fails the read, so the count is recorded only once every comment has been read. A comment is a suggestion when it has a `.zip` attachment, and either the file name says "suggestion" or the comment carries the marker line `Open-Historia-Suggestion: sug-…`. Where the author sees it:

- `SuggestionsBanner` above the Games and Scenarios tabs: **💬 People have suggested changes to your scenarios**, one button per scenario;
- the card's badge;
- the Community card.

A deleted comment takes its suggestion with it.

**The changelog** (`SuggestionReviewDialog`, `ScenarioSuggestions.jsx`). The dialog downloads the suggestion's file through `/api/hub/file`, exports the author's scenario as it is now, and marks each change outside the map with one of three states:

- *open*;
- *You changed this too* (a conflict: the author rewrote it since posting; accepting replaces their version);
- *Already in your scenario*.

Text changes show a word diff (`diffWords`, `suggestionApply.js`). **A scenario's pre-history** (`world.prehistory`) is reviewed one event at a time — each event added, changed or removed, found by its id and labelled with its title, showing the fields that changed — plus one change for its summary, prompt and Day-one facts together (`diffHistory`, `applyHistoryChange`); a record appearing is a change even when empty, since its games then ask for no backstory. **The Political World is reviewed one country or one institution at a time.** Three of its five parts are ledgers, a map of records inside a wrapper that carries its format (`politicalActors` and `powerStatus` by polity, `institutions` by id); `diffScenarioBundles` diffs inside the map (`politicsLedgerKeyOf`, `scenarioChanges.js`), so each edited, added or removed entry is its own change, labelled with the country or the institution's name and showing the fields that changed in it (`changedPathsOf`: `government.headOfGovernment.name: Olaf Scholz → Friedrich Merz`), and the wrapper's format fields are never a change. Its status is measured on that entry alone, so an author's edit to another country is no conflict, and accepting it puts that entry into the author's ledger and keeps every other one (a format counter takes the newer value; a first entry brings the wrapper with it). `agreements` was always diffed entry by entry, and `canonContext` is one setting, changed whole (`WHOLE_POLITICS_FIELDS`), shown field by field. **A player who generates the whole Political World and suggests it** sends every country, institution, agreement and power record as its own change, plus the canon context; Accept all gives the author exactly the world the player generated. The canon context is measured as the game reads it (`canonContextOf`: only a world with the current `canonModelVersion` has one, `readScenarioCanon`), and accepting it sets `canonModelVersion` as the Politics tab's Apply does (`materializeScenarioCanon`); before this the version was never carried, so the author's game ignored the accepted context, its divergence and reference packs with it. Accepting countries without the canon context leaves the author's canon as it was. A suggestion file made before this carries a ledger whole and still applies whole. Reading a file drops a Politics change that names a ledger this build does not know, or an entry key that would reach an object's prototype (`normalizeSuggestion`). It also drops any field the diff never makes, since each part of a field's path and a Politics change's field become keys of the author's scenario: only the listed meta, game and world fields, the features' known settings, the prompt passages (`isDetailFieldPath`, `scenarioChanges.js`) and the five Politics parts (`POLITICS_FIELDS`). A crafted file can never name the world whole, its storage or its hub provenance, and `buildDetailSave` checks again before it writes each key. **Accept** applies the change at once (`buildDetailSave` in `src/runtime/suggestionApply.js`: meta, game, world, features, prompts, Politics entries, cover, stats sheet and logos in one save). **Undo** puts back what was there (`inverseOf`: a Politics entry the change added is taken out again, and one it removed goes back in; `applyToSnapshot` keeps the statuses true), and the text diff is `diffWords`, all tested in `suggestionApply.test.js`. What Undo puts back is kept outside the dialog until the game closes, so closing the review or going to the Workshop and back keeps it. A change accepted before the game was last closed has none, and its row keeps its decision and says to change it back in the editor instead of offering Undo. **Reject** only records the decision. Accept all and Reject all are there too. The map's changes are summarised, with **🗺️ Review the map changes**. The footer offers **Reject all from @login**, **Mark as reviewed**, **Dismiss** (put away unreviewed, offered on a download error too) and **Done**. Decisions are kept in `hubReviews` as they are made, and a row or the review's status changes only once that save has worked. A save that fails shows its error above the changes and changes nothing on screen; Dismiss then stays open. When Accept has already changed the scenario and only the decision failed to save, the error says so: *Your scenario was changed, but the decision could not be saved: …* (Undo's says *changed back*).

**Review the map changes** (`openMapReview`) opens the Workshop with a `review` ({ suggestion, decisions, onSaved }). It lists and marks each change on the map, to accept or reject one by one ([map-editor.md §25](map-editor.md#25-reviewing-suggested-changes-suggestionreviewpaneljsx)). Its decisions are merged into `hubReviews` only when the map is saved. The suggestion is `done` once every change, on the map and off it, is decided.

**Reject all from @login** (`handleRejectContributor`) is for a contributor flooding a post with bad edits. After a confirm, the login goes into `hubPublished.blocked` on **every** scenario this player has posted (`withContributorBlocked`). Their suggestions are dropped, an open review of theirs closes, and anything they post later is never stored (logins compare case-insensitively). Blocking resets `commentCounts`, so the next look re-reads every comment. **Unblock** does the same the other way, and their suggestions come back on that next look. A suggestion opened from a file carries only a free-text name, so it cannot be blocked this way.

### 4.9 In-game floating cluster & server shutdown

When the menu is closed, `LibraryTopBar` renders a compact cluster (z 9997): a session-summary pill (`summaryText` = name / country / date), **⌂ Exit Game** (→ `setMenuOpen(true)`). Desktop lays them out top-left of the date widget; phones put **⌂** in the left gutter. The ⏻ server-shutdown button that used to sit beside it is gone from the beta; `POST /api/server/shutdown` stays for scripts and the launcher.

---

## 5. Advisor drawer & stats — `src/Game/GameUI/advisor.jsx` + `stats.jsx`

`AdvisorPanel` (`advisor.jsx`) is the right-docked drawer (z 10040, full `100vh`). It slides in/out via `transform: translateX(...)` (a prior `right: calc(-min()…)` was invalid CSS and silently never slid). Two tabs, both kept mounted so flipping is instant:

| Tab | Component | Behavior |
|---|---|---|
| 🧭 Advisor | inline chat | Loads/saves history to `JSON_URLS.advisor`; `startChat()`/`loadHistory()` bootstrap; `sendMessage(text)` → advisor reply. Renders markdown (`react-markdown`) and inline ` ```chart ` blocks via `AdvisorChart` (Chart.js) — only after `validateChartConfig` (`advisorBlocks.js`) passes them: bar, line, pie or doughnut, with labels and a number somewhere; one that fails shows `📉 The chart could not be drawn: <why>` instead of throwing mid-render. A question asked after the world moved on carries a line above it — `⏳ Since 1 January 2016 · 3 events · 1 change by the Game Master` — whose tooltip is the whole catch-up note the advisor was given (see [conversations](ai-overview.md#conversations-one-copy-a-stable-prefix-and-a-catch-up-note)). Dates under replies go through `gameDates.js` (they used to show a day early west of Greenwich). A reply's fences are taken apart by `parseAdvisorReply` (`advisorReply.js`); an ` ```actions ` block is applied once, on arrival, by `planAdvisorActionEdits` (`advisorBlocks.js`), and removing a planned troop order puts its unit back as the Actions panel's delete does. A ` ```deploy ` entry of a type the scenario does not allow (`world.allowedUnitTypes`) gets no **Place** button, and `deployUnit` refuses one too; a placement that fails says why under its button. A document that reached the government in a turn shows as a notice between the messages — `📄 A new paper on your desk: <title>, <how it came>` with **Read it** / **Put it away** (`AdvisorDocumentNotice`) — hidden until the reveal reaches its event, merged in while the drawer is open, never sent to the model, and taken back with an undone turn (see [reports](ai-overview.md#reports-what-only-some-governments-know)). Only the last 12 messages are drawn at first; **Show N earlier messages** at the top brings back 20 more at a time (the transcript itself is never trimmed). 🗑 clears the chat; ✕ closes (the only exit on phones where the drawer covers 🧭) |
| 📊 Stats | `StatsPane` | National stat sheet (see [§5.2](#52-statspane--srcgamegameuistatsjsx)) |

### 5.1 Advisor width state

The drawer is user-resizable by dragging its **left edge**. Width lives in `Main` as px (drag maps 1:1 to the pointer):

| Constant / fn | Value / behavior | File |
|---|---|---|
| `ADVISOR_MIN_WIDTH` | `280` | `main.jsx` |
| `ADVISOR_DEFAULT_WIDTH` | `320` (the old fixed 20rem) | `main.jsx` |
| `clampAdvisorWidth(px)` | clamps to `[min(280, vw−16), vw−16]` | `main.jsx` |
| `readAdvisorWidth()` | reads `localStorage["oh-advisor-width"]`, else default | `main.jsx` |
| `handleAdvisorResize(px)` | sets state + writes `localStorage["oh-advisor-width"]` | `main.jsx` |

The drag handler lives in the drawer (`advisor.jsx`): on `pointerdown` it captures the pointer and, on each `pointermove`, calls `onResize(window.innerWidth - ev.clientX)` (docked right, so width = viewport − pointer x). `Main` clamps + persists. `rightShift = isAdvisorOpen ? \`calc(${advisorWidth}px + 0.5rem)\` : "0.5rem"` (`main.jsx`) is passed to the date widget, the flag badge (`Other`), and the 🧭 button so they slide left exactly the drawer's width when it's open.

### 5.2 `StatsPane` — `src/Game/GameUI/stats.jsx`

| Concern | Detail | Connects to |
|---|---|---|
| Target | `targetCountry` seeds from the player's country; **clicking any country on the map** re-targets it while the tab is open: `Regions.jsx` dispatches `REGION_SELECTED_EVENT` (`"oh:region-selected"`) on every committed region click, and `StatsPane` listens for it and calls `setTargetCountry`; a map card's **Stats** button opens the Country drawer on that polity (`OPEN_COUNTRY_STATS_EVENT` → `main.jsx` → `requestedTarget`), the one way to reach another country on a phone, where the drawer covers the map | `src/Game/Selection/Regions.jsx`, `src/Game/Selection/CountryPanel.jsx` |
| Data | Economy view: `generateCountryStatSheet({code, name})` (AI, the player's request) when no valid sheet is saved, validated by `validateGameplayPayload("countryStatSheet", …)`; it first waits for a background reading of the same sheet (`pendingCountryStatSheet`). Politics and Diplomacy views show a saved sheet only and ask `ensureCountryAssessed` (background AI: off unless turned on, capped, deduplicated) | `src/Game/AI/gameplay.js`, `gameplaySchemas.js` |
| Caching | The canonical sheet is `world.countryStats[code]`, saved with the game. A per-`gameKey:code` copy keyed by game date sits in memory + `localStorage["oh-stat-sheets-v2"]` (cap 20) as a convenience fallback; regenerated when the date moves. ↻ (Economy view) opens a menu: **Refresh** (costs a request only if the state, the territory or the economic events changed since the last assessment; a custom sheet always costs 1) and **Rebuild baseline from scratch** (the hard audit, `forceReassess`: always 1 request and replaces the numbers, confirmed in a second step; standard sheet only) | `src/runtime/countryStats.js`, `generateCountryStatSheet` |
| Render | Flag/initials header, national stability bar, the intelligence service bar (the live `world.intelligence` rating), 6 strategic indices (`INDEX_ROWS`), economy cards (`compactEconomyValue` trims 30000000000→30.0B), GDP breakdown bar. A custom sheet (`CustomStatsSheet`) shows the same intelligence bar above its own sections and leaves out its own `intelligenceService` row, so one name never shows two numbers | `src/runtime/spycraft.js` |
| Historical tracking | The ⚙ modal (`HistoricalTrackingModal`): the auto-refresh cadence and up to `COUNTRY_STATS_TRACKING_MAX_POLITIES` tracked countries. A country is **Stats ready** only when `isTrackedStatSheetReady` (`runtime/countryStats.js`) says so, the scheduler's own rule (the scenario's values for a custom sheet, the whole standard sheet otherwise) under its canonical key; otherwise **baseline needed**, on the row and on the tracked chip. *Refresh status* shows the last batch (`lastBatchDate`), each tracked country's last refresh (`lastAutoRefreshByPolity`), and **Assess now** for a country with no complete sheet, which opens it on the Economy tab so the pane builds its first sheet (one player request) | `refreshTrackedCountryStatsIfDue` (`gameplay.js`) |
| Flag logic | author flag (`flags.json`) > polity flag > code-derived — but a **landless player** never borrows a code-derived flag (`isPolityLandless`); it shows only a flag chosen for it, from `flags.json` or its record, so a new faction or group shows the flag the player picked | `src/runtime/countryFlags.js` |
| Groups | Politics tab, after the political overview: **Groups on our territory** (or **on its territory** for another country) lists every group holding the country's regions — swatch, name, "Controls N regions" and its description — most regions first; a row fits the map to those regions (the country panel passes `mapRef` down). For a player leading a group, that group comes first with its own whole area, badged **Our group**. Built by `groupsOnTerritory` (`src/runtime/groups.js`) with the region owner from `regionOwnershipOverrides`, else the primed region catalog; hidden while the Groups feature is off | `src/runtime/groups.js` |

`Other` (`other.jsx`) is the standalone player-country flag badge at bottom-right (desktop only; hidden on mobile because it would cover the date widget, where the country name opens the same drawer). It reads the world once (forced) when a campaign activates, then follows `oh:game-updated`, `oh:world-updated` and `oh:runtime-json-updated` (for `flags.json`), and applies the same landless-suppression logic (for a landless player, `resolveChosenPolityFlag` in `polityFlags.js`: a flag from `flags.json` or the polity's record, never a map-ref or stock one); falls back emoji → `FallbackBadge` initials for non-ISO polities.

---

## 6. Date widget & timeline — `src/Game/GameUI/time.jsx`

`DateWidget` (`time.jsx`) is the top-right pill (z 9999) plus two slide-up panels (z 9998). It's the time-advance control center.

### 6.1 The pill

Shows player country + formatted date (`«` opens the Events panel, `»` the Timeline panel; `»` becomes a spinner while a skip, an undo, an intervention or a held turn's retry runs, and pressing it then always opens the Timeline panel). On a phone (`useIsMobile`) the country and date are a button that opens and closes the country drawer (`onToggleCountry`), since the flag badge is hidden there. Props from `Main`: `activePanel`/`onSetPanel`/`onTogglePanel` (the panel slot is `Main`'s `activeBottomPanel`), `mapRef`, `dockStyle` (`advisorDockStyle`) and `topOffset`. While something runs, `«` opens the Events panel only during a skip being watched live, so the player can go back to it after looking for Cancel.

It holds no copy of the game: `game`, `events` and `world` come from the shared HUD store (`useRuntimeState`), and a finished turn, undo or intervention is published straight back with `primeRuntimeValue`. The store owns the refresh and the **never-regress** guard — a read behind the published round and date is refused (`isStaleGameRead`, see [the HUD store](world-state.md#the-hud-store-srcruntimeruntimestorejs)), so a just-completed jump is never reverted; the widget only reacts to `oh:rolled-back` by dropping the undone turn's fallback warning.

### 6.2 Timeline skip panel (`»`)

| Control | Effect | Connects to |
|---|---|---|
| Fixed jumps (6h…1yr) | `runJump(days, "jump")` → `simulateTimelineJump` | `src/Game/AI/gameplay.js` |
| Custom amount + unit | same, arbitrary days | — |
| **Auto-jump** | `runJump(365, "auto")` → `simulateAutoJump` (AI picks how far) | — |
| **↩ Undo last turn** | `runUndo()` → `rollBackToSnapshot(0)`; `undoCount` is `undoableTurns` over the restore-point index (`loadRollbackSnapshotIndex`, the index, not the archive; `runtime/turnCommit.js`), re-read when the round changes: the unbroken run of restore points back from the last turn, so a turn that saved none disables Undo rather than letting it take two turns back — the engine refuses such an undo too (*The last turn has no restore point.*). A turn written without its restore point says so in the Events panel's warning (*This turn was saved, but its restore point was not, so it cannot be undone.*). The Spies file goes back with the turn | rollback snapshots |
| Cancel (during a skip or a held turn's retry) | `cancelJump()` aborts the in-flight `AbortController` (`jumpAbortRef`) | — |
| **Retry the segment** / **Retry the board** / **Discard the turn** | A held turn (amber, nothing written): `retryHeldSegment` → `retryPendingJumpSegment`, `retryHeldProjects` → `retryPendingProjectsJump`, or discard. A retry runs as a skip does (`isLoading`): the skips, Undo and Intervene wait, and the progress row carries its Cancel | `gameplay.js` |

Under the skip buttons a caption says what today has cost and what the next skip will (`RequestsTodayCaption`, `AI/requestBudget.js`): *N of M AI requests used today*, then *a skip uses N, at most M* (*, plus one per extra segment* when long skips are split) or *a skip can use twenty or more*, and *· the last used N*. It turns amber when a tenth of the day's requests or fewer are left (three at least), refreshes on `ai:request-budget` and every minute, and its tooltip says it counts on this device since midnight Pacific time.

**The live skip** (Settings → AI → **Show time skip events as they are written**, on by default, `MAP_SETTING_KEYS.liveSkipEvents`). A skip opens the **Events panel** at once and fills it as the model writes (`onEvents` → `streamedEvents`, from `AI/streamedEvents.js`): each streamed event becomes a card (`liveEventCard`, `buildLiveTurnRecord`, `turnReveal.js`) under a record keyed `live-turn`, with the panel's subtitle the span being written. **Next event** / **Skip to end** reveal them as they arrive; the camera follows, and the map stages each revealed event live onto the world on screen (`liveStageBase`, no snapshot needed since nothing is written yet). The spinner and **Cancel** sit under the cards (`SkipProgressRow`), and the Timeline panel shows the same row. When the turn lands, what the player uncovered is carried over (`captureRevealCarry` / `resolveRevealCarry`): by headline, through the furthest uncovered event that survived the engine's checks, or back to one event when none did; a fallback turn starts from its first event. With the setting off, the skip stays behind the Timeline panel's spinner and lands on the Events panel with its first event shown. Either way a failed, held or cancelled skip goes back to the Timeline panel, where those notices live. Fallback generations surface a warning banner.

While an interactive event is in progress (`isSceneInProgress(world.activeInteractive)`), the jumps, auto-jump and the custom amount are disabled and a yellow note says why, with **Return to the scene** (`oh:open-interactive-event`). Undo stays available, and undoing the turn a scene was built on takes the scene with it. While one is on offer instead (the last skip's, once the reveal has reached its event), a quieter yellow note names it — *⚡ An interactive event is on offer: «title». The next time skip lets it pass.* — with **Play it out**; the skips stay available.

While a skip runs the spinner says what it is doing, in the skip's own words as each phase starts (`showSkipPhase`, fed by `onProgress` from `skipPhases.js`): *Reading the world…*, *Writing 1 month of events… (part 2 of 3)*, *Moving the armies, redrawing the fronts and hearing from 2 agents…*, *Placing the armies and the fronts…*, *Updating the Projects board…*, *Folding older history into the history document…*, *Writing it into the record…*. Auto-jump and a held segment's retry report the same way.

### 6.2-ter Group chats: one request, said a line at a time, and binding votes

A group turn no longer rotates one leader at a time. `runGroupTurn` (`chat.jsx`) calls `runChatActionBatch` once for the whole table (see [group diplomacy](ai-overview.md#group-diplomacy-one-request-for-the-whole-table)); the answer is applied to the thread's event log and the panel re-renders from its projection. A failed group request is surfaced and leaves the canonical thread unchanged; there is no legacy sequential speaker fallback. A turn that comes back with nothing to show says why in a System bubble — *The AI could not be reached, so nobody at the table answered.* when the provider failed and the task's canned empty answer stood in (`outcome.generation.source === "fallback"`), how many actions were refused when every one was, or *Nobody at the table chose to answer.* — and what the batch got wrong still goes to the next one. When the turn answered a line the player typed, that bubble and a failed request's both carry **Retry** (`retry: { group: true, text }`), which asks the table again about the line already in the thread rather than adding a second copy; a hearing's and a Council's own requests have their own buttons for that.

The answer is **said a line at a time** (`planChatReveal`, `GameUI/chatReveal.js`): the first line at once, with anything before it and the reactions, votes or newcomers that follow it; then each later line after its speaker has been seen typing for five seconds — a *Typing…* bubble with the speaker's flag (`TypingBubble` with `label="Typing"`, where the request's own wait says *Thinking…*) and the hint *Send a message now to cut in: what is still to come will not be said.* The composer stays open meanwhile. **Sending a message cuts in**: the lines still to come are never said — they were never written into the thread — and the next request is told whose lines went unsaid. **Leaving the thread** (back, or another thread) is not cutting in: the rest is written at once. Each line is written onto the thread as it stands, so a vote cast in between is kept, and nothing is written once the player has switched campaign. A **committed** turn is different: a Council's or a hearing's comes back already saved whole with its governance (`outcome.committed`), so the thread takes the whole log at once, nothing is written again, and only the screen shows it a line at a time; cutting in shows the rest at once instead of dropping it, because it has been said and a recorded ballot counts.

A binding vote renders as a `PollCard` above the composer: who called it, each option as a bar with its share and tally, the voters on hover, and the player's own vote cast once by clicking. A model can never cast it for them — `chatActions.js` refuses any action whose actor is human-controlled — and there is no closing a poll or changing a vote, because neither is a thing a government gets to do.

### 6.2-bis Documents, where they arrive

There is no document panel (a Dossier launcher existed briefly in the lab and was removed). The documents the simulation writes — secret protocols, private letters, intelligence assessments, treaty articles (`world.reports`, see [reports](ai-overview.md#reports-what-only-some-governments-know)) — reach the player through the panels they already use (`runtime/reportDelivery.js`):

- **Diplomacy.** A document the player holds with other governments arrives as a message in the thread with them, spoken by its sender: a bold `📄` heading and dateline over the document in full. It raises the unread badge and the notification like any message — once the reveal reaches the event that brought it (see 6.3).
- **The Spy tab.** A document held by a government where the player has an agent arrives among that agent's intercepts, listed with `📄` rather than `📡`, sealed like the rest and redacted to the player's signal clarity.
- **The event card.** A published document, or one only the player's government holds, sits under the text of the event that produced it (`EventDocument` in `time.jsx`): `📄 title`, `Published` or `Our government's`, and the document a click away, rendered like the event's own text (`normalizeMarkdown` + remark-gfm + remark-breaks), so a letter keeps its lines and a treaty its tables.

The advisor reads all of them as the government's own staff; the dock is back to three launchers.

### 6.3 Event history panel (`«`) + staged reveal

Renders the latest turn's events (`buildTurnRecord`) one at a time; **Next event** / **Skip to end** reveal more. The camera follows every revealed event (`deriveEventFocusBounds` → `focusMapOnBounds`) — first to the regions it transferred, captured or contested (`regionControlOps`), claimed (`regionClaims`) or moved a group into or out of (`groupOps`), then to any coordinates it states, the polities it changes, and last the places its text names — unless the **Disable camera movement during events** map setting is on. A **staged reveal** replays the pre-jump world from the rollback snapshot and applies only revealed events' impacts through a purely visual override (`setWorldStateOverride`/`setUnitsOverride`) so ownership/units/markers animate in; finishing/closing clears the override. The restore point is read only while events remain unrevealed, and only once the snapshot index (`loadRollbackSnapshotIndex`, a few hundred bytes) lists one spanning the turn's dates (`findTurnSnapshot`, `turnReveal.js`); then only that one restore point is read (`loadRollbackSnapshot`, `assets.js`): from the archive when this tab already holds it (a turn's capture primes it), else alone from the store (`GET /api/runtime/snapshots/:id`), never the archive of up to twelve whole worlds. One that turns out not to hold the turn's world is remembered, so reopening the panel does not read it again. `viewAsSeen` finds its restore point the same way (`loadTurnRestorePoint`). The archive (`loadRollbackSnapshots`, `gameplay.js`) is read unforced everywhere: this tab is its only writer, each write primes the cache, and the cache is swept when the game changes. Under the cards of a written turn, a folded **What the engine changed** list (`EngineChangesNote`) shows the turn's application receipt: what the engine withheld, did not apply or adjusted of the answer, under player-facing headings; the notes themselves stay in the engine's English (`data-no-translate`). It costs no request.

The reveal is remembered (`runtime/unseenEvents.js`): each step marks what it uncovered, a reload resumes where the player was, and a turn with nothing left unseen — an older one, an undone-to one, a stopped one — opens whole. Until the reveal reaches an event, nothing it brought is shown anywhere else: a thread it opened or a letter it delivered is not in the chat list (nor its unread count or notification), a copy an agent stole in it is not in the Spy tab, and the advisor and the leaders speak from the world as the player has seen it (see [what the player has not been shown yet](ai-overview.md#what-the-player-has-not-been-shown-yet)).

The reveal, the staged base and the category filter are keyed on the turn record's id, `turnRecordId` (`turnReveal.js`): the landing date, the round, and the entry's own first event id or Game Master transaction id. The date alone was not enough — a **6 hours** skip lands on the date it left, so its record took the previous turn's id: the new turn kept the old reveal count (with live skips off its events past the first were never marked seen) and was staged onto the world from before the previous turn.

**✋ Intervene here** sits under those two while events remain unrevealed (and no category filter is on, since the count is by reveal order). It asks once — *Stop the round after "title"? The N events not yet revealed will be discarded — they never happen — and the date becomes …*, the date read as the event cards read it ("Mar 1, 218 BC") — then `runIntervene` calls `interveneAfterEvent(visibleEventCount)` (`gameplayLazy.js`): the engine rolls the game back to the turn's snapshot and applies the kept prefix of the turn's journal again, without a request (see [Intervene](ai-overview.md#intervene-stopping-a-round-where-the-player-wants-to-act)). The panel then shows the shorter turn fully revealed, the date widget the last kept event's date, and **Undo last turn** still works. Offered only when the newest snapshot carries a journal (`canInterveneInLastTurn`, re-checked with the round), never while a jump runs.

Each card shows what the event is about as **link chips** after its category tags — ⚑ a power, ⌖ a region, ⛊ a formation, ▣ a structure (`deriveEventLinks`, see [the event cards' links](ai-overview.md#the-event-cards-links)); a click flies the map there (`focusMapOnBounds`), which also serves a player who switched the event camera off. They replace the old unclickable participant tags wherever the map can frame something. The lookups they need (country names, the region catalog, the stock outlines) now load independently: a missing stock archive used to take the names and the catalog down with it, blinding the camera, the chips and the map-changes names alike. On a drawn map they frame by the map's own region boxes, and re-derive when the map's worker has primed them (`oh:region-catalog-primed`).

**⚡ Interactive event.** Now and then a skip offers one of its events to be played out as a scene (see [Interactive events](ai-overview.md#interactive-events-a-moment-a-time-skip-offers-to-play-out)). That event's card carries a yellow strip under its text (`InteractiveOfferStrip`, `time.jsx`): **Play it out** opens the interactive event panel (`oh:open-interactive-event`, §10-bis), **Let it pass** clears the offer (`declineInteractiveOffer`, free). Neither spends a request. The strip is there only once the reveal reaches the event, and goes when the offer is taken up, let pass or replaced by the next skip.

Each card's **N map changes** pill is a button: it opens a *What changed on the map* list under the card (`describeEventMapChanges`, `turnReveal.js`) — one line per territory transfer, control or contest change, claim, polity change (create / rename / restore / dissolve / update), unit spawn / move / strength / removal and structure build / update / rename / removal / population, with polity, region and unit names resolved (`resolvePolityName`, `resolveRegionName`, the unit resolver the panel hands in) — a unit's destination by its region's name, not its id. A structure update says what it changed, a line each: its state (*Stalingrad destroyed*, *… is damaged*, *…: construction under way*), its holder, its kind, a move, its founding date, the note as its new description; a population change gives the figure (*Lyon: population now 1,250,000*). The category column reads from `MAP_CHANGE_KIND_LABELS` (Territory, Control, Claim, Group, Polity, Unit, Structure), so it is catalogued and translated. The count on the pill is the length of that list, so the two never disagree.

### 6.4 Pregame history

A fresh game (round 1, no events/turns) gets its backstory once, when the menu is closed: `maybeGeneratePregameHistory()` (`time.jsx`). Its scenario's own pre-history (`world.prehistory`, inherited through `TEMPLATE_WORLD_OVERRIDE_KEYS`; written or generated in the Workshop's Pre-history tab) is applied without a request — the events dated before the start go on the timeline (`source` `"pregame"`), the Day-one facts into the war, diplomacy and storyline ledgers, and the record is dropped from the game's world. A game whose scenario has no record but a "World Before Round One" briefing still asks the model, as every game used to. The `isMainMenuOpen()` gate ensures tokens aren't spent on a game the player is only hovering past in the menu.

---

## 7. Actions panel — `src/Game/GameUI/actions.jsx`

`ActionsPanel` (`actions.jsx`) — bottom-left slide-up (z 9998). The player's planned-action queue for the current turn. An order that deploys or recalls a spy ("deploy a spy in Germany") is executed by the next time skip through the event's `impacts.spyOps` ([Espionage Orders] in `docs/ai-prompts.md`); the Spy tab still shows and manages the agents.

| Control | Effect | Connects to |
|---|---|---|
| Composer (textarea) + ✈ send | `createManualAction` → `writeActionsState` | `src/runtime/gameState.js` |
| ✦ sparkle | `refinePlayerAction(text)` rewrites the draft in place (no persist). When the AI fails (an error, or the canned template) the draft stays as typed and an amber line under the list says why, with the report button | `src/Game/AI/gameplay.js` |
| **Help brainstorm actions** | `onOpenAdvisor` (opens the advisor drawer) | `Main.openAdvisor` |
| **Get/Refresh AI suggestions** | `generateActionSuggestions({force:true})`, which saves the topics on `world.actionSuggestions`; the `SuggestionCard`s read that list (`useRuntimeState("world", selectSavedSuggestions)`, `actionSuggestions.js`), so reopening the panel shows the saved list without a request until a time skip clears it. The button says *Refresh* while there is a list. A canned list (`source: "fallback"` on its topics) is labelled generic, with the report button while the failure is known; a press that fails shows the error instead of "No AI suggestions generated yet." | AI |
| Queue a suggestion | `normalizeSuggestionAction` → persisted; button flips to "✓ Queued" while an order with its id waits in the queue (`queuedActionIds`), so restored cards know too, and an order deleted from the queue can be queued again | — |
| Delete an action | `handleDelete`; once the shorter list is saved, if it was a queued unit order (`unitRevert`, still `planned`), also `revertUnitOrder` to undo its map effect. Such an order's ✕ is disabled while a turn runs (the turn would put the unit back); any other order can be queued or deleted mid-turn, since the turn reads the queue again before writing it | `src/Game/Map/unitsController.js` |
| **🎯 Standing goal** (`StandingGoal`) | Under the date line: *Set a standing goal*, or the goal with **Edit**; editing offers Save (Enter; on a touch screen Enter is a new line), Cancel (Esc) and **Clear goal**. Every composer (advisor, diplomacy, Actions, this one) decides Enter through `runtime/composerKeys.js`: Shift+Enter is a new line, a touch screen never sends on Enter, and an Enter that confirms an input-method word never sends. Locked while a turn runs (polls `isSimulationBusy()`), since the turn writes the world the goal lives in. The advisor, the time skip and the suggestions steer by it; a leader never sees it | `withPlayerGoal` → `writeWorldState` (`src/runtime/playerGoal.js`); read with `useRuntimeState("world", playerGoalOf)` |

Only `status === "planned"` actions render. Every change to the queue (`persistActions`) shows only once `writeActionsState` has saved it, because the time skip reads actions.json, not the panel: when the save fails the list stays as stored, a typed order stays in the box, a suggestion stays unqueued, a unit order is not undone, and an amber line under the list says the order could not be saved (or removed) and to try again. Country + date come from `useRuntimeState("game", selectGameHeader)` (display only); the list follows the store's `actions` slice (`subscribeRuntime("actions")`). The launcher button (`Actions`, `actions.jsx`) lives in the toolbar.

---

## 7-bis. Projects & Operations panel — `src/Game/GameUI/projects.jsx`

`ProjectsPanel` (`projects.jsx`) — bottom-left slide-up (z 9998), the third `activePanel` slot after Chat and Actions. Its launcher `Projects` (the `ProjectsDockIcon` glyph) sits in the same `Toolbar` (`chat.jsx`), which widened to hold three buttons (`12.8rem` at this commit). Entries are created and edited by the AI, by design; the player owns exactly two things on the board — a project's priority (`PrioritySwitch`) and whether to abandon it — see [World state](world-state.md) §2e-bis.

| Element | Behavior | Connects to |
|---|---|---|
| Data | Slices of the shared store: `useRuntimeState("world", selectProjects)` and `selectPolities`, `useRuntimeState("game", selectGameStamp)`; a slice wakes the panel only when it changed, so a write that touched nothing here does not re-render the list under the cursor | `src/runtime/runtimeStore.js` |
| Cards | Kind glyph, name, status pill, owner, summary, tag chips, progress bar (`Bar`, copied from `stats.jsx`), timeline row, next milestone, last update | — |
| Derived badges | ⚠ Overdue / ⏳ Due in Nd / Milestone slipped / No recent progress — all from `deriveProjectFlags` against the game clock, never from what the model wrote, so they cannot go stale | `src/runtime/projects.js` |
| Sort & filter | `PROJECT_SORTS` dropdown, Mine/Foreign/All, and tag chips built from the live vocabulary (`collectProjectTags`). Open work always sorts above closed work whatever the chosen sort |
| Closed view | An **exclusive** switch, not an "also include" filter: off shows only running work, on shows only completed/failed/cancelled. It previously widened the list to everything, which — because the sort ranks open above closed — buried the closed entries under a screen of active ones and made the button look broken. `isProjectClosed` (`runtime/projects.js`) is the one definition the filter, the count and the sort all share | `src/runtime/projects.js` |
| **🧭 Ask advisor** | `onOpenAdvisor(seed)` — opens the drawer with a per-project brief request **pre-filled, never sent**; the same path the Actions panel's "Help brainstorm actions" button uses | `Main.openAdvisor` |
| **📍 Show on map** | Resolves `project.focus` → first linked marker → first linked unit, then `map.flyTo`. Hidden entirely when nothing resolves, rather than offered and inert | `mapRef`, threaded through `Toolbar` |
| Activity feed | Expanding a card resolves `project.eventIds` against `readEventsState()`, fetched **once and only after a first expand** — `events.json` is the largest runtime document and most opens never expand anything | `src/runtime/gameState.js` |
| Empty state | The **backfill path**, not a dead end: a button seeding the advisor with "put my ongoing efforts on the board". An existing campaign's history is already in the advisor's prompt, so it can reconstruct one | — |

Two authors create the board's entries (the player only sets a priority or abandons one): events through `impacts.projectOps` — supplied by the separate `projects` AI task after a jump, or inline by the game master — and the advisor through a ```` ```projects ```` block — `applyAdvisorProjects` in `advisor.jsx`, with an `AdvisorProjectsCard` receipt, the same "advisor creates, I review" contract as ```` ```actions ````. The advisor's write does a read-modify-write that spreads the **whole** world back; a shallow patch there would drop `polityOverrides`/`regionOwnershipOverrides` and blank the map. A reply that lands after the player switched campaign applies nothing: its orders, projects and transcript line are dropped (`runTurn`, `campaignGuard.js`), since the endpoints they would be written through already point at the other save.

## 8. Forces panel — `src/Game/GameUI/forces.jsx`

`ForcesPanel` (`forces.jsx`) — bottom-left panel (z 9999), a **controlled** component (open state owned by `Main.isForcesOpen`; opened from the toolbar historically, now only from the Cheats panel's **Force Manager**, "Deploy, inspect, edit, and repair forces on the map"). Manual troop control is treated as a cheat.

| Element | Behavior | Connects to |
|---|---|---|
| Unit list | `subscribeUnits`/`getUnits`; split into "Your units" (`getPlayerCode`) and dimmed "Other forces". Clicking a unit `flyTo`s it | `src/Game/Map/unitsController.js` |
| ✎ beside each unit | The Force Manager's repair form (`UnitEditor`): name, type (any), strength, status and note, saved straight to the unit with `updateUnitAdmin` (no order, no AI step); **Move on map** arms `setInteractionMode({kind:"admin-place", unitId})` and closes the panel, and the next map click places the unit there (`placeUnitAdmin`, which moves a patrol's station with it). A failed save says "The unit could not be saved. Try again." | unitsController |
| Deploy controls | type (restricted by scenario `getAllowedUnitTypes()`), strength (1–1000), optional name → `setInteractionMode({kind:"deploy", params})` then closes the panel. **Place on map** is disabled while a turn runs, with *A turn is running. This can be changed once it ends.* (`useTurnRunning`) | unitsController |
| **Mode banner** (z 10000) | Global hint while `mode.kind !== "idle"` (deploy, admin-place) + Cancel (`clearInteractionMode`). A placement whose save failed stays armed and the banner says why (`mode.error`) | interaction-mode state |

Owner codes render as full names via `ensurePolityNames`/`polityDisplayName` (re-renders once the lookup warms and on every name change, `subscribePolityNames`). `TYPE_GLYPH`/`TYPE_LABEL` map unit types to icons/labels; strength color-codes >600 green / >250 amber / else red.

---

## 9. Cheats panel — `src/Game/GameUI/cheats.jsx`

`CheatsPanel` (`cheats.jsx`) — right-side panel (z 10045), opened from the game menu's Tools tab → **Cheats** (lazy-loaded). A list of tools (`TOOLS`); selecting one renders `ToolView`. Several tools enter **click-capture mode**: the panel hides behind a toast (z 10070) and map clicks route through `setRegionClickInterceptor` instead of opening the region popup. Clicks are handled one at a time, in order (`createSerialQueue`, `src/runtime/serialQueue.js`): each reads, changes and writes the world, and two running at once lost the first one's change.

| Tool id | Does | Writes / calls |
|---|---|---|
| `master-ai` | **GM Console**: a natural-language request in one of three modes (direct correction, exact event, world intervention) is planned by the AI into a structured transaction, shown operation by operation, and only then applied. The preview's count chips and its exact-changes list come from `src/Game/GameUI/gmPreviewOps.js`, built on the normalizer's own impact families (`EVENT_IMPACT_KEYS`, `gameState.js`): groups and institutions have sections of their own, and a family with none is listed under *Other operations*, so nothing is applied unseen | `previewGameMasterCommand(text, { mode })` → `applyGameMasterPreview(preview)` (`src/Game/AI/gameplay.js`). Apply is refused while a turn runs or is held (*A turn is running. This can be changed once it ends.*), since the turn writes back the world it read. It revalidates the preview against a fresh world, fails closed if canonical state changed since the preview (fingerprint), and checks every territorial edit took effect before saving; those pure checks (polity lifecycle, breakaway sovereignty, chronology, post-apply territory, fingerprint) live in `src/Game/AI/gameMasterValidation.js`. It writes through the event-impact seam plus the war/diplomatic ledgers and the Stats seam, links the events into the Events panel, and records `world.gmAudit`. There is no direct prose execution: every edit goes through a preview. |
| `reminders` | **Simulation Reminders**: issue, edit and withdraw the Game Master's standing facts (twelve at most), which every AI in the game is told until withdrawn; below them, *What the next time skip will be told* — every change made by hand this round, exactly as the skip will read it | `addReminder` / `editReminder` / `removeReminder` on `world.simulationReminders`; reads `world.gmChanges` (`src/runtime/gmChanges.js`). See [the Game Master's hand](ai-overview.md#the-game-masters-hand-changes-made-outside-the-simulation-and-standing-reminders). |
| `events` | **Event Editor**: search, create ("exact events"), edit and delete canonical events with quotations and metadata; an exact event may allow one NPC diplomatic reaction after a 12-second undo window. An event carrying any impact array in `EVENT_IMPACT_KEYS` (`src/runtime/eventImpactKeys.js`: territory, control, claims, groups, polity, politics, institutions, units, markers, spies, projects, chats, reports, actions) is badged **State-linked**, and its delete and edit notices say those effects stay applied | `writeEventsState` — each save re-reads the ledger and applies its one add, edit or delete to the row it is for (`src/runtime/eventEditorRows.js`), so events a time skip wrote while the editor was open are kept; saves are refused while a turn is being generated, and the list refreshes whenever the ledger is written (`oh:runtime-json-updated`); manual events are linked into `world.simulationHistory` by `syncManualEventTimelineHistory` (`src/runtime/manualEventTimeline.js`: the turn whose date range holds the event, else a `manual-event` record of its own in date order; empty manual and GM records are pruned; a second pass changes nothing); reactions queue in `world.pendingEventOutreach` and are evaluated by `processPendingEventOutreach` (scheduled from the chat panel); a failed request is tried again after 30 s, 2 min and 10 min, then given up (`AI/eventReactionRetry.js`) with `npcReaction.result: "failed"`, its attempts and last error, which the row shows beside a Retry button; on the last attempt a speaker without political context gives way to an invited government that has it, or to silence |
| `interactive-event` | **Interactive Event**: pick any event on the record and it becomes the moment to play out as a scene — the offer a time skip makes on its own one skip in three (`runtime/interactiveOffer.js`). Rows say whether a skip could have offered that event (`isOfferableEvent`); an event the reveal has not reached cannot be offered, and neither can anything while a scene is in progress. Offering costs nothing; the scene costs what it always costs | writes `world.interactiveOffer` (never `lastInteractiveOfferRound`, so skips go on offering their own), dispatches `oh:open-interactive-event` and closes the Cheats panel so the scene is not covered |
| `history-document` | **History Document**: the living history the AI is shown in place of the folded events — read and edit it, fold the older events now, or reset compression; the timeline keeps every event in full | `world.historyDocument` and `world.consolidatedHistory` via `writeWorldState`; `consolidateHistoryNow` (`gameplay.js`) runs the `eventConsolidator` task on everything but the newest 24 events (`historyConsolidation.js` decides what a pass folds and how the document is revised) |
| `roll-back-turn` | Restore to the start of an earlier turn (discards later turns) | reads `JSON_URLS.snapshots`; writes game/world/events/actions/chat/colors |
| `your-country` | Switch which country you play | `writeGameData({…country})` |
| `difficulty` | Set difficulty (Difficulty 2.0: per-scope directives for simulation, diplomacy and interactive events) | `writeGameData({…difficulty})` (`DIFFICULTY_LEVELS`, `src/runtime/difficulty.js`) |
| `annex-country` | Click a country → fold all its regions into a target | every region the clicked country holds now (`regionsHeldBy`, `src/runtime/gmAnnex.js`: the override, else the owner the map gives the region — a hand-drawn region's `country` — else its stock country, names exact); nothing found is reported as a failure and nothing is written; then as `annex-regions` |
| `annex-regions` | Click individual regions → transfer to a target | `applyEventImpactsToWorld` with the `regionTransfers` `annexationImpacts` builds (`src/runtime/gmAnnex.js`) — the seam the Region Inspector and a time skip use, so the new owner becomes controller and sovereign and old claims are settled; a region the old owner only occupied also gets a control op and a clear-contest of the old occupier |
| `edit-country` / `add-country` | **Country Editor** (identity, colour, tags, reputation, the persistent stat sheet) or create a polity (name **is** the identifier; a name already in use anywhere — an override, `ownerCodes`, a map or stock owner, a sovereign or claimant — is refused, `polityNameInUse` in `src/runtime/gmPolityNames.js`, since changing a country is the Country Editor's job) | `polityOverrides` + `colors.json`; stats through `applyCountryStatPatchToWorld`. A Country Editor Save writes only the fields changed since the form loaded, and rebuilds the political actor only when its form was edited (`src/Game/GameUI/countryEditorStats.js`), so a turn that moved the country meanwhile is not undone |
| `regions` | **Region Inspector**: click a region → controller, lawful sovereign, claimants, provenance; change de-facto control (a control op), restore sovereign control, transfer legal sovereignty (a transfer), add/withdraw claims; rename on custom-geometry maps | `applyEventImpactsToWorld` with `regionTransfers` / `regionClaims` (the same seam events use); name via `regionsGeojson` |
| `groups` | **Groups**: list the world's groups (colour, name, region count); create one, edit its name, what it is (the AI's description) and its tint colour; **Edit the area on the map** (each click puts a region in the group's area or takes it out), **Clear the whole area**, **Erase group** (two clicks). The Region Inspector also has a **Group control** section: which group controls the region, **Release**, or put it under a group | `applyEventImpactsToWorld` with `groupOps` (the seam events use); every change is noted for the next skip (`gmChanges.js`, kind `groups`) |
| `puppets` | **Puppet States** (listed only while the game's **Puppet states** feature is on): the standing arrangements (overlord → puppet, kind, openly known or covert, loyalty) and the ended ones folded below; **New puppet state**; open one to change its kind or loyalty, **Make it public** (covert only; one-way), **Release** or **Annex** (each two clicks). Annex ends the arrangement, then moves the puppet's land to its overlord through the Annex Country transfer (`transferWholeCountry`). No AI request | `applyGmPuppetChange` (`puppetStatesTool.js`): the ledger's own verbs through `applyPuppetUpdates`, as the GM Console's `puppetUpdates` run, with the causal event waived; noted as kind `puppets` (an annexation's land also as `territory`) |
| `edit-feature` / `add-feature` / `clear-features` | **Map Feature Editor**: runtime features (`world.markers`, with lifecycle status, owner, kind, location) and scenario cities. The feature types are the Workshop's (`src/Editor/mapFeatures.js`) plus a city, a temporary marker (drawn as a landmark) and a custom type, each shown with the glyph the map draws for it (`src/Game/GameUI/mapFeatureKinds.js`, from `getMarkerPresentation`) | marker ops through `applyEventImpactsToWorld`; `citiesGeojson`; adding the first custom city flips `customCities: true` |

Every tool that changes the world records one sentence of it in `world.gmChanges` after its save succeeds (`noteGmChange`; a failed note never costs the edit): the GM console's transaction, a whole-country or region-by-region annexation (one growing line), a Region Inspector edit, a puppet state made, changed, released or annexed, a country edited or created, the player's country switched, cities and map features, an event written, edited or deleted, the history document rewritten, a rollback. The next time skip opens with them.

The log viewer that used to be a Cheats tool is now **View log** in Settings → Advanced → Diagnostics (section 10).

Ownership/name resolution is done in **one namespace** (country display name) — the file's comments call out the recurring bug where a GADM code (`RUS`) and a name (`Russia`) never compared equal. The map repaints on the write itself: its stores follow the `oh:world-updated` event every `writeWorldState` dispatches.

`loadPolities()` (`cheats.jsx`) enumerates the countries actually in the game (polity overrides ∪ current region owners ∪ owners of rendered geometry — custom regions when present, else the stock catalog), each resolved to a display name.

---

## 10. Settings — `src/Game/GameUI/settings.jsx`

`SettingsButton` (the ☰ game-menu button) sits top-left (z 9999) and toggles `SettingsMenu`. The menu has four quick tabs (`QUICK_MENU_TABS`): **Game** (the session card and **Game Management**), **Tools** (**Cheats**, **Events / Timeline**, the **AI debug console**, and the Discord and Reddit tiles), **Settings** (one button per section below) and **Help** (**Guides**, which opens `/guides/` in a new window that the desktop app hands to the system browser, or the website's copy on Android, whose APK leaves the guides out; **Report a Bug**; the community links). Cheats and Guides are buttons inside the Tools and Help panels, not tabs of their own. A Settings button opens `SettingsWorkspace`, a full-screen portal with four sections (`SETTINGS_SECTIONS`): General, Map, AI and Advanced.

| Section | Group | Controls | Persists to / calls |
|---|---|---|---|
| General | Language | `LanguageSelector` (UI language, searchable; applying reloads the page) and `ChatLanguageSelector` (the language the advisor and leaders reply in) | `setStoredLanguage` (server + browser), `setStoredChatLanguage` |
| General | Display | **Fullscreen** | `Main` toggle |
| General | Accessibility | **Reduce motion**: one switch over Disable idle globe rotation and Disable camera movement during events (on only while both are), and it also skips the ownership sweep; held on while the OS asks for reduced motion (`useSystemReducedMotion`) | `setMapSetting(MAP_SETTING_KEYS.disableIdleRotation / .disableEventCamera)` |
| Map | Map presentation | **Basemap** (Scenario default or a built-in ESRI basemap), **Country label font** (empty = the scenario's font), **Hide country labels**, **Performance mode** (Auto / Low memory / Full: the device profile the map runs with, applied after a reload; the Logging file names the profile running and the signal that decided it) | `setMapSettingValue(MAP_SETTING_KEYS.basemapStyle / .labelFont)`, `setMapSetting(MAP_SETTING_KEYS.hideCountryLabels)` (`src/runtime/mapSettings.js`); Performance mode writes `localStorage["oh_device_profile"]` (`setDeviceProfileOverride`, `src/runtime/deviceProfile.js`) |
| Map | 3D map | **3D Globe**, **3D Terrain** (marked Experimental) | `App.jsx` state (`localStorage["Globe"]` / `["Terrain"]`) |
| Map | Camera behavior | **Disable idle globe rotation**, **Disable camera movement during events** | `setMapSetting(MAP_SETTING_KEYS.*)` |
| AI | Models | `FallbackListSection` — the Fallback list: one row per entry with its status (ready / Spent until … / Unusable: reason / busy, for about …; a status is what the row shows, never where a call starts) and when it last answered; reorder, edit, reset, remove; **Add a backup**, **Fill…** (`FillPanel`), and the rate-limit choice. With one entry it is the old single form: provider (`ApiProviderSelector`), key or endpoint, model. See `docs/ai-overview.md` | `providerConfig.js` (`addEntry`, `updateEntry`, `moveEntry`, `fillFallbackList`, `setRateLimitPolicy`…) |
| AI | Connections | `ConnectionsSection` — saved provider + name + key + endpoint + custom parameters (+ **Strict tool schema** for OpenAI Compatible); templates for Groq, OpenRouter, Local Ollama | `addConnection`, `updateConnection`, `removeConnection` |
| AI | Model reasoning | `ReasoningSection` — the global **Model reasoning** toggle | `setReasoningEnabled` |
| AI | AI requests | `RequestBudgetSection` — today's count against the day's limit, **Save AI requests**, **Requests a day your key allows**, **Background AI**, **Background requests a day, at most**, and one switch per **Check after a time skip** (six, `REVIEW_SECTIONS`). See [the request budget](ai-overview.md#the-request-budget) | `requestSettings` (`src/Game/AI/requestBudget.js`) |
| AI | Generation behavior | `PlayerFocusSetting` (**Player focus** for this game: follow the scenario, or World first / Balanced / Focused / Spotlight), **Limit AI generation** (off by default), **Generate long time skips in segments** (off by default), **AI lookup functions** (on by default; lookups run only while **Save AI requests** is off, so meanwhile the switch is shown paused and the Logging file says "on (inactive: Save AI requests)"), **Show time skip events as they are written** (on by default), **Batch background AI tasks** (Anthropic only, off by default) | `saveGame(id, { features: { playerFocus } })`; `setMapSetting(MAP_SETTING_KEYS.limitAiGeneration / .chunkLongJumps / .lookupFunctions / .liveSkipEvents / .batchBackgroundTasks)` |
| Advanced | Per-task models | `TaskPicks` — a Fallback entry to try first for each task in `AI_TASK_ROUTING`, and a button back to the AI section | `setTaskPick` (`providerConfig.js`) |
| Advanced | Political World A/B Lab | **Open A/B Lab** (`PoliticalWorldABLab.jsx`): runs one frozen task with Political World context on and off, never applying either answer | — |
| Advanced | Telemetry | **Record AI telemetry** (on by default), **Rate AI generations** (off by default), **Open console** (`debugConsole.jsx`, lazy) | `telemetry.js` |
| Advanced | Network | `NetworkSharing` — **Let other devices connect** (desktop and local server only; the web build hides it) | `/api/server/network` |
| Advanced | Diagnostics | `DiagnosticsPanel` — **📋 Copy log** / **💾 Save as file** (the Logging file, Desktop log merged in), **🔎 View log** (`DiagnosticsLogViewer`: the same entries, newest first, problems-only filter, click to expand), Clear, and the **Keep a diagnostics log** / **Detailed logging** switches | `buildLoggingFile` / `getLoggingFileEntries` / `setDebugLogEnabled` / `setDebugLogVerbose` (`src/runtime/debugLog.js`, see `docs/runtime-services.md`) |

`Toggle` is the shared switch primitive (also exported). The workspace reads its switches once when the menu mounts (`getMapSetting`, or `getMapSettingDefaultOn` for the default-on AI switches) and mirrors them locally.


---

## 10-bis. Interactive events — `src/Game/GameUI/interactive.jsx`

`InteractivePanel` — a centred yellow-edged dialog (z 10001), lazy, opened by `oh:open-interactive-event`: from **Play it out** on the card of the event a time skip offered, from the time panel's note about that offer, and from its *Return to the scene*. There is no other way in: the player does not start an interactive event, a skip offers one now and then (see [Interactive events](ai-overview.md#interactive-events-a-moment-a-time-skip-offers-to-play-out)).

| State | Controls | Calls |
|---|---|---|
| On offer | the event's title, date and description; *Your angle (optional)*; **Play it out** and **Let it pass**, the cost said beside them; a note, and **Play it out** off, while the reveal is unfinished | `createInteractive({ eventId, angle })`, `declineInteractiveOffer()` (then the panel closes) |
| A scene | title, premise, *Your angle*, each move played (**↶ Take back**), the scene's current text, the offered choices and an own-move box with **Play**, **End the scene** (off with no move played) and **Set aside** (two presses once a move is played: the second press reads "You've played N moves — set it aside anyway?", and lapses after 4 s on a touch screen) | `advanceActiveInteractive`, `rewindActiveInteractive({ beatIndex })`, `endActiveInteractive`, `setAsideActiveInteractive` |
| Finished | *The scene is over and written into the record* with **See it on the timeline** | — |
| Nothing | *No interactive event is waiting*, and when one comes | — |

One engine call at a time; a failed step changes nothing and its reason shows in the panel. **✕ Leave** closes the dialog and leaves a scene where it is, and an offer until the next time skip. A scene an older skip proposed and nobody took up is not shown.

---

## 11. Search — `src/Game/GameUI/search.jsx`

`Search` (`search.jsx`, memoized) — a small 2.4rem square just right of the launcher dock (z 9999), its bottom edge level with the bottoms of the dock's buttons rather than the dock, so it reads as a utility beside the launchers and not another one; expands to an input (rightward on desktop, a full-width 3rem bar above the toolbar on mobile). Its position is derived from the dock's geometry in `hudDock.js`, which the `Toolbar` reads too: the two used to be separate literals, and when a fourth launcher (the since-removed Dossier) widened the dock the search control sat on top of it. Adding or removing a launcher moves it on its own.

What it finds, in this order (at most seven rows):

- **In world** (up to four, a pill says so). The world's own places, which no geocoder knows, built in memory while the bar is open with no request and no debounce (`buildLocalPlaceEntries` in `src/runtime/placeSearch.js`): scenario cities and polity label sites that `Cities.jsx` and `Nations.jsx` publish (`publishCustomCityIndex`, `publishPolityIndex`), structures (`world.markers`), city renames (`world.cityRenames`), groups at the point their label is drawn (`publishGroupIndex`, from the regions worker's group-areas labels; found by a former name too), and units as the map shows them (`unitsController.getUnits()`, so a turn's unrevealed units stay hidden). A name matches whole (best), as a prefix, as a later word, or anywhere; prominence breaks ties. The same name within 0.75° is one place (a city rebuilt as a structure); groups and units are kept apart from that.
- **The geocoder**: [Photon](https://photon.komoot.io) (`photon.komoot.io/api/`), debounced 300 ms, answers cached in-module, deduped and ranked (`rankGeocodedPlaces`). Not Nominatim: the OSM Foundation's Nominatim usage policy forbids client-side autocomplete. A result whose name an In-world row already has is dropped; an answer to an older query stays, dimmed, only while what is typed still starts with it.

Picking a row (click, Enter, ↑↓): an extent is framed with `fitBounds` (up to 120° × 80°); otherwise the camera flies to a per-kind zoom (a country 4, a region 5, a settlement 7, a group 5, any other In-world place 7, else 9). An In-world place with no coordinates (a renamed stock city, a renamed stock country) is looked up by its old name through the geocoder (`flyToQuery`). Search is not only a camera control: a city or structure opens its card (`focusFeature`) and a unit its card (`focusUnit`, which first closes a region or feature card), without the click's toggle. A group has no card and only moves the camera.

---

## 12. The old scenario deck (removed)

The standalone `ScenarioTopBar` (`scenarios.jsx`) and its `runtime/scenarios.js` store, which nothing imported, were deleted; the scenario deck and editor are `LibraryTopBar` + `EditorDrawer` in `libraryBar.jsx`.

---

## 13. Master reference — every panel/button

| # | UI element | File | Kind | Open/toggle driver | Reads | Writes / calls |
|---|---|---|---|---|---|---|
| 1 | ☰ Game menu button | `settings.jsx` | button | `Main.isSettingsOpen` | — | opens `SettingsMenu` |
| 2 | Settings menu | `settings.jsx` | panel | `isSettingsOpen` | provider/map settings | localStorage, `setMapSetting`, `setStoredLanguage` |
| 3 | 🧭 Advisor button | `main.jsx` | button | `Main.isAdvisorOpen` | — | opens advisor drawer |
| 4 | Advisor drawer (Advisor tab) | `advisor.jsx` | panel | `isAdvisorOpen` | `JSON_URLS.advisor`, `JSON_URLS.game` | `sendMessage`, `writeJson(advisor)` |
| 5 | Advisor resize handle | `advisor.jsx` | drag | pointer capture | — | `onResize`→`localStorage["oh-advisor-width"]` |
| 6 | Stats tab | `stats.jsx` | panel | advisor tab state | game/world, stat cache | `generateCountryStatSheet`, `world.countryStats`, `localStorage["oh-stat-sheets-v2"]` |
| 7 | Date pill `«` / `»` | `time.jsx` | buttons | `Main.activeBottomPanel` | game/events/world | opens skip/history panels |
| 8 | Timeline skip panel | `time.jsx` | panel | `activeBottomPanel==="skip"` | game date, snapshots | `simulateTimelineJump`/`simulateAutoJump`/`rollBackToSnapshot` |
| 9 | Event history panel | `time.jsx` | panel | `activeBottomPanel==="history"` | `simulationHistory`, events | `setWorldStateOverride`/`setUnitsOverride`, `fitBounds` |
| 10 | 💬 Chat button (+ unread badge) | `chat.jsx` | button | `activeBottomPanel==="chat"` | chats store | opens `ChatPanel` |
| 11 | Chat panel / conversation | `chat.jsx` | panel | `isOpen` | chats, country names, game | `sendDiplomaticMessage`, `runChatActionBatch`, `writeChatsState` |
| 12 | ✦ Actions button | `actions.jsx` | button | `activeBottomPanel==="actions"` | — | opens `ActionsPanel` |
| 13 | Actions panel | `actions.jsx` | panel | `isOpen` | `JSON_URLS.game`, actions | `writeActionsState`, `generateActionSuggestions`, `refinePlayerAction`, `revertUnitOrder` |
| 14 | Forces panel + mode banner | `forces.jsx` | panel | `Main.isForcesOpen` | units, allowed types, player code | `setInteractionMode`/`clearInteractionMode`, `map.flyTo` |
| 15 | Cheats panel + tools | `cheats.jsx` | panel | `Main.isCheatsOpen` (+ `shouldLoadCheats`) | world/game/events/catalogs | many `writeWorldState`/`writeGameData`/`writeJson`, `previewGameMasterCommand`/`applyGameMasterPreview`, `consolidateHistoryNow`, `setRegionClickInterceptor` |
| 16 | Search box | `search.jsx` | widget | local `expanded` | `getWorldPlaceIndex` (placeSearch.js), `useWorldState` markers/renames/overrides/groups, `unitsController.getUnits`, Photon | `map.flyTo`/`fitBounds`, `focusFeature`, `focusUnit` |
| 17 | Player flag badge | `other.jsx` | badge | always (desktop) | `JSON_URLS.game`, world | — |
| 18 | Main menu (Games/Scenarios/Community) | `libraryBar.jsx` | full page | `menuOpenDefault` | `useLibraryState`, hub posts | `activateGame`, `createGame/Scenario`, catalog refresh |
| 19 | Game/Scenario editor drawer | `libraryBar.jsx` | panel | `editorKind`/`editorDetails` | scenario/game details | `saveScenario`/`saveGame`, asset up/clear, `exportScenarioBundle` |
| 20 | Country / faction picker | `libraryBar.jsx` | modal | `countryPicker` | country options, custom regions | `createGame`, `saveGame`, `activateGame` |
| 21 | Map editor host | `libraryBar.jsx` | overlay | `isMapEditorOpen` | scenario assets | `applyMapToScenario` → many asset writes + new game |
| 22 | ⌂ Exit Game / summary | `libraryBar.jsx` | cluster | `!menuOpen` | `activeGame` | `setMenuOpen(true)` |
| 23 | Community hub tab | `communityHub.jsx` (posts read by `runtime/hubPosts.js`) | panel | menu tab | GitHub hub API, `/api/hub/*` | `downloadHubBundle`+`importScenarioBundle` (stamps `hubOrigin`), publish/export (writes `Scenario-Key`, see [§4.8](#48-suggested-changes); the prefilled post also stays on the page as **Open the GitHub post ↗**, because a browser may block the page a slow export tries to open) |

---

## 14. Shared conventions

- **Surface styling**: most HUD elements share a `baseStyle`/`surface` object — `rgba(17,24,39,0.9)` bg, `backdrop-filter: blur`, 12px radius, subtle border/shadow. The main menu/editor use `surfaceStyle` (darker gradient + heavier blur).
- **Runtime state**: panels do not poll. They subscribe to a slice of the shared store (`src/runtime/runtimeStore.js`, usually via `useRuntimeState`), which is pushed by canonical write events (same-tab, and cross-tab over a `BroadcastChannel`) rather than polled, and wakes a panel only when its own slice changed. A 60-second backstop read covers writers no event reaches. See [World state §9](world-state.md#9-state-distribution-three-stores-no-panel-polls).
- **`data-no-translate`**: player-typed text, economic figures, raw dropdown values and what the AI wrote in the player's language (timeline events it wrote, advisor and leader replies) are marked so the UI translator ([i18n](i18n.md)) leaves them verbatim.
- **Mobile branching**: `useIsMobile()` (`src/runtime/useIsMobile.js`) reshapes the search box, the date/country row, the exit cluster, and menu paddings. The advisor drawer and bottom panels clamp to `calc(100vw − …)`.
- **Lazy chunks**: advisor (Chart.js + markdown), cheats, community hub, the map editor, and the OpenLayers country picker are all `React.lazy` — none are in the first paint.
