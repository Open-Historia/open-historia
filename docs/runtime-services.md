# Runtime Services

The `src/runtime/` folder holds the framework-light services that sit between the server API and the React UI: the library/scenario/game catalog stores, the AI-powered UI translator and its language setting, the country-name resolver, and the small tag/label/flag/map-setting helpers. Most of these are plain modules with module-scope state plus a `useSyncExternalStore`/`useState` React hook, deliberately kept free of OpenLayers/heavy deps so the **editor**, the **game**, and the **server** can all import the same rules. This page maps each service, its exported API, and — most importantly — how data flows in from `/api/*` and back out to the components.

Related pages: [World state](world-state.md) · [Game state](world-state.md) · [Assets](assets-and-data.md) · [AI system](ai-overview.md)

---

## Module map

| Service | File | Owns | Consumed by |
|---|---|---|---|
| Library store | `src/runtime/library.js` | games + scenarios + active-game catalog, country-name overrides | `src/App.jsx`, `src/Game/GameUI/libraryBar.jsx` |
| Country-name resolver | `src/runtime/assets.js` (+ `polityNames.js`) | code→display-name plumbing, runtime asset endpoints/token | every map/name renderer |
| Language setting | `src/runtime/i18n.js` | UI language choice, `LANGUAGES`, RTL, `languageDirective` | Settings UI, `translator.js`, `callAI` |
| Translator | `src/runtime/translator.js` (+ `phraseBook.js`, `promptTranslations.js`, `aiTranslation.js`) | shipped packs applied to the live DOM; content translated by the model on the device, or by the player's AI with Translate with my AI on | `src/main.jsx` (boot), map labels, content writers |
| Browser dialogs | `src/runtime/nativeDialogs.js` | `alert`, `confirm` and `prompt` wrapped once so their message is looked up in the pack, whole, by pattern or line by line ([i18n.md](i18n.md#writing-interface-code-that-translates-well)) | `src/main.jsx` (boot) |
| On-device model files | `src/runtime/modelStore.js` | where a downloaded model's files are kept, by URL: Cache Storage where the page has it, otherwise IndexedDB `oh-model-store:<name>` (the Android app's `http://` origin is not secure, so it has no Cache Storage) answering `match`, `put`, `keys` and `delete` | `translationWorker.js` and the modules that load or forget its models (the related-events model ships with the game and is not kept here) |
| Country tags | `src/runtime/countryTags.js` | tag normalization + author-vs-live resolution | editor, game, server, `promptContext.js` |
| Related past events | `src/runtime/embeddingModels.js` (the pinned model, pooling), `embeddingWorker.js` (the model), `embeddingModel.js` (the page's side), `eventVectorStore.js` (the vectors, events' and chats'), `openConversation.js` (the thread on screen); `src/Game/AI/relatedEvents.js` (queries, ranking, the prompt block), `chatArchive.js` (older conversations: eligibility, chunks, queries, the prompt's part), `relatedEventsSearch.js` (index, search, lookups) | one vector per event of a game and per chunk of an older conversation kept on file, made on the device, and the past events and talks nearest each skip ([below](#related-past-events--srcgameairelatedeventsjs)) | `gameplay.js` (the skip, `buildTaskLookups`), `main.jsx` (the advisor, a leader's reply), `promptContext.js`, `chat.jsx` (the open thread), `library.js` (`removeGame`) |
| Country labels | `src/runtime/countryLabels.js` | coarse region shapes for the country picker; label diagnostics | `src/Game/GameUI/CountryPickerMap.jsx`, `src/Game/Map/Nations.jsx` |
| Community flags | `src/runtime/communityFlags.js` | hub-hosted shared flags & flag packs | `src/Editor/FlagPicker.jsx` |
| Hub issue lists | `src/runtime/hubIssues.js` | the hub repo's addresses (`HUB_URL`, `HUB_API`; `HUB_OWNER` and `HUB_REPO` handed on from `server/hubProvenance.js`) and its posts by label, read from the hub's own index and never from GitHub's API (`fetchHubIssues`, `fetchHubScenarioIssues`: the posts the hub has released, open or closed, or an error a player can read); a post's comments page by page, the one thing still read through the API (`fetchHubPages`: `Link: rel="next"`, at most `MAX_HUB_PAGES` = 10 pages of 100, a failed page fails the read); the image a post attached, by its address (`firstHubImage`, `hubImageUrl`: https on github.com or *.githubusercontent.com only), which is what its checked copy is looked up by | `hubPosts.js`, `communityBasemaps.js`, `communityFlags.js` |
| Hub files | `src/runtime/hubFiles.js` | the hub's `index.json` and everything read from it: the list of posts, each file's checked copy in the hub's **releases**, the downloads of each file (never shown), the suggestions the hub has checked (`HUB_INDEX_URL`, on the hub's `hub-index` branch, read from raw.githubusercontent.com, kept five minutes: `fetchHubIndex`, `normalizeHubIndex`, `hubIndexProblem`); a copy looked up by the attachment's address (`releaseCopyOf`, `requireReleaseCopy`), a scenario post's downloads (`importCountOf`, not the import count: `hubImportCount.js`), a post's checked suggestions (`checkedSuggestionsOf`), and the one fetch every hub download goes through (`fetchHubFile`: the checked copy through `/api/hub/file` or an error, never the attachment; `copy: false` for a suggestion the hub has checked); what kind of image a copy is, by its bytes (`imageTypeOfBytes`); and the same route as an address, for what loads a hub file itself instead of through `fetch` (`hubFileAddress`: a hub track's `<audio>`, `hubMusic.js`) | `hubIssues.js`, `hubPosts.js`, `communityFlags.js`, `communityBasemaps.js`, `ScenarioSuggestions.jsx` |
| Hub posts | `src/runtime/hubPosts.js` | reading the community hub: scenario posts (`Scenario-Key`), a post's comments, the checked suggestions among them (`refreshPublishedRecord`, which never finds again a post the scenario was unlinked from), file downloads (`downloadHubFile`, through `hubFiles.js`), a post's import count, checked copy and cover (`parsePost(issue, hubIndex)`), a post's file downloaded and stamped with where it came from (`downloadHubScenario`), why a copy should be updated (`hubUpdateReason`, `hubCopyStatus`, `hubOriginalGone`), and a scenario file's bytes read into one bundle (`readScenarioBundleBytes`: zip or JSON by its bytes, basemap re-embedded, a referenced community basemap fetched, a link the file brought along dropped) for a hub download and a file import alike | `communityHub.jsx`, `libraryBar.jsx`, `ScenarioSuggestions.jsx` |
| Suggested changes | `src/runtime/scenarioChanges.js` (the diff), `scenarioSuggestion.js` (the `.zip` and the comment), `suggestionApply.js` (accepting a change outside the map), `suggestionSections.js` | what a player changed in a community scenario, carried to its author and applied change by change ([game-ui.md §4.8](game-ui.md#48-suggested-changes)) | `ScenarioSuggestions.jsx`, `src/Editor/suggestionReview.js` |
| Rostra's posts | `src/runtime/socialFeed.js` | the social network's feed (`world.socialFeed`, in the save: the newest 300 posts), the player's posts as their leader, what a time skip's posts become and the `[Social Media]` block it is told | `GameUI/social.jsx`, `AI/gameplay.js`, `multiplayer/host/gameHost.js` |
| Map settings | `src/runtime/mapSettings.js` | localStorage map/AI toggles | map + settings components |
| Music | `src/runtime/ambientMusic.js` | plays the game's music by scene (`MUSIC_SCENES`: `menu`, `loading`, `game`, `atWar`, `war`). Passage Of Time plays on **two elements** of the one file, `calm` (the menu) and `drama` (the build and the loud stretch), so that going from one part of the piece to another is a crossfade and never a cut on one element. **The menu** plays the piece from its start to the lull before its build, round and round (`PASSAGE_CALM`: it fades out from 141.5 s, is silent at 143.5 s, where the piece itself is all but silent as its opening is, starts again from 0 and comes in over 2.5 s; it never plays past 144.5 s, the build starting at 145.45 s). It is **levelled**: the gain follows where the music is, from a table of the piece's own loudness (RMS for every 5 s, each figure standing for the middle of its stretch and read linearly between them), `calmGainAt(t)` = (0.065 / rms(t))^0.75 held between 0.5 and 1.6, so the nearly inaudible opening is turned up to the most, a stretch at 0.065 is left alone and the loud plateau comes down to about 0.55; it is a factor on the menu's volume, on top of the player's and never past full volume, set by the watch that does the loop (about every 200 ms, a few percent a look at most; every 40 ms through the fade at the seam). While the menu sounds the build is **made ready**: its element made with `preload` "auto" and held silent and paused at the entry the next game opening would use, aimed again when the expected load time changes; only while the music is on and sound is allowed, since this is the one thing fetched before it plays. **The menu's other pieces** (`MUSIC_MENU_PIECES`: Clear Skies; a list, `channels.themes`): each time Passage Of Time's part ends, in the silence of its seam, they play one after the other, each whole and on an element of its own made only then, levelled the same way from a loudness table of their own (`MUSIC_TRACKS.<name>.loud`, read by `calmGainAt` with the menu's level, power, least and most); after the last of them Passage Of Time begins again from its start. Few players idle on a menu for the two minutes and more a seam takes (the owner: "its always playing passage of time"), so **which piece a visit to the menu plays is picked at random** ("have it randomly pick one track or the other"): when the game is started and each time the menu is come back to from a game, one of Passage Of Time and the others, evenly (`pickMenu`, `nextVisit`), from the piece's start; the same one can come up twice running, and nothing about it is kept between sessions. The picks are the director's `random` (Math.random on the page; a test gives its own). **Each of the menu's pieces has a build of its own** for a game opening (the owner: "why do they both crossfade into the same song, they should crossfade into their own song for the loading"): Passage Of Time's is `PASSAGE_DRAMA` on the `drama` element, and another piece's is `MUSIC_TRACKS.<name>.drama` (Clear Skies: `CLEAR_SKIES_DRAMA`, entries 70.85 to 93.6, big hit 97.6, loud stretch to 154.3, measured from its file) on a second element of its own file, `<name>Drama`, made ready on the menu like Passage Of Time's; the director's `loud` and `drama` point at the build of the piece the menu is on (`aim`). A game opened under Clear Skies before its build crosses into Clear Skies' own build at the entry for the expected load, exactly as Passage Of Time does into its own, and ends on Clear Skies' own hits. A game opened while the menu's piece is already in its build or loud stretch (from 0.9 s before its first entry to 2 s before the stretch's end) has nothing to cross to: the menu's own element carries on as the loading music (`loud = themes`) and swells from the menu's level to the full boost, by the big hit, or over `MUSIC_SWELL.seconds` (6) of the music when that has passed (`boostAt(time, entry, drama, from, until)`); it goes round its loud stretch like any build and stops on its next hit. A piece with no build of its own goes into Passage Of Time's. A piece that cannot be played leaves the menu to Passage Of Time alone, round and round, until a game has been played. **Going back into a game already drawn this session** has no build at all (the owner: "When entering a game thats already opened, opening the game is super fast so dont do the whole music ramp up thing"): `noteGameDrawn(id)` remembers each game once the screen has drawn it (`GameUI/main.jsx`, when the game is entered and its loading cover is gone), and while `gameDrawnBefore(id)` is true the screen reports no loading for it (`reopening`, so `musicSceneOf` gets `loading: false`), and the menu's piece gives way straight to the game's own music, as for a game drawn from the menu. The memory is the page's (a `Set`, nothing stored), so a game's first opening in a session keeps its build, however fast it loads (the earlier ruling that a fast load must not cut the music off). **A game opening** is a crossing of the two over 1.8 s (`PASSAGE_DRAMA.crossfade`), equal-power: the build starts 0.9 s before its entry (`lead`) and comes in on a sine while the menu's music goes out on a cosine, then pauses and goes back to 0; with no menu music to cross with (the first click came while the game was opening) the build comes in from the entry itself over the same 1.8 s. The entry is the phrase from which the big hit at 168.60 s lands just after the game is expected to be drawn (`entryFor(expectedSeconds)` over `PASSAGE_DRAMA.entries`, 145.30 to 164.70: the latest whose lead to the hit is at least the expected load time and half a second, and never later than 164.70, so a game that opens at once still has four seconds of build), and the build grows louder by where the music is, from the player's volume at the entry to `PASSAGE_DRAMA.boost` at the hit (`boostAt`). The expected load time is learned: each loading is timed from the scene becoming `loading` to it becoming `game`, `atWar` or `war`, whether or not anything sounds; the last five of at least half a second are kept (`localStorage` `audio_load_seconds`, `loadSecondsMemory`), and their median, held between 1 and 40 s, is expected (`expectedLoadSeconds`; 6 s before any). A game opened before the first click takes its entry at that click, for what is left of the loading. A game still loading at 226.4 s goes round the loud stretch again from 168.45 s, at the full boost. **The game drawn** (`exitAfter`): the music always runs at least to the big hit, and to the next hit after it if that one has passed (`PASSAGE_DRAMA.cuts`, which start at the big hit), lets the hit ring 0.35 s and is gone over 150 ms, so a game that opens fast has the build carry on under its first seconds instead of being cut off as it began. The exception is a guess that was badly wrong: a game drawn while the big hit is still more than 12 s away fades out over 1.5 s from the build's next accent (149.90 or 157.45), a soft exit and not a stop. Either way a breath of silence follows, and then **the game's own music** comes in over 3 s (`MUSIC_GAME_PIECES`: Frankincense and Myrrh, Discovery, Honour Among Thieves and A Kind Of Hope, a list, `channels.game`): one after the other, round again at the end, each levelled from its own loudness table exactly as the menu's pieces are (a look every 200 ms while it sounds), so that it stays in the background. A Kind Of Hope is the exception: at the owner's word ("for this one dont actually flatten the loudness, let it be") its entry in `MUSIC_TRACKS` has no `loud` table, so it is never levelled and plays as recorded, its quiet opening quiet and its climax full, at the game's level like the others; which of them a game starts on is picked at random (`pickFresh`, once a game: the list is fresh again when the menu is gone back to), from its start, and it carries on from where it was after the war room. A scenario's own `game` list takes its place altogether. **At war** (`atWar`: in the game, with the player's country on a side of a war being fought in the war ledger, `runtime/playerAtWar.js`, or its troops on a battlefield) plays the war room's pieces, the same list, so going into the war room and out of it never breaks the piece off (the owner: "when in war, it doesnt play the war song"); a scenario's `atWar` list, or failing that its `game` list, takes their place; **the war room** or a battlefield shown plays the game's own war pieces as a list (`MUSIC_WAR_PIECES`: Legionnaire and Vanguard, one after the other, round again; which of them a game's war room starts on is picked at random, once a game, from its start; the next piece is asked for only when the one before has ended, and leaving the war room fades the list out where it is, to carry on from there), and stops the loading music at once. **How loud each situation is** (`levels`, `levelOf`): a share of the player's own volume, never more than it. The game's own figures are `SCENARIO_MUSIC_VOLUMES` in `server/scenarioMusic.js`: a game opening 100, in the game 50, at war 50, the war room 75 (the owner: "background music when in game and in war should be quieter"); the menu is always the whole. A scenario sets its own in its record's `volume` ("the volume should be tunable by scenario designers"; whole numbers from 0 to 100, only those that differ from the game's kept), for whatever plays in that situation, its tracks or the game's; `followScenarioMusic` hands them to `setMusicLevels` with the record, at once, without waiting for the hub's list. A voice comes in at its scene's level (`bring(voice, ms, levelOf(scene))`), one carried from a scene to another glides to the new level without being restarted (the war pieces, from a game at war at 50 into the war room at 75), and a change of levels while something sounds glides too. The build's growth and the in-game levelling multiply on top of it. **A scenario's own lists** (`setPlaylists`, fed by `scenarioMusic.js`) take the place of the game's own music for a game opening, the game, at war and the war room where the scenario names tracks the hub's list still has (its `battle` tracks replace the game's war pieces entirely): in order, the next when one ends, round again at the end; leaving the situation fades the list out where it is and coming back carries on from there; at war with no list of its own plays the scenario's game list, never the war pieces; a scenario's loading tracks replace the loading music altogether (no build, no stop on a hit); the menu is never a scenario's. A track is an `<audio>` given the address of **the copy kept on this device** (`keptMusic.js`, the Kept music row below): the director asks for it when the track is about to play (`trackAddress`, wired by `startMusic` to `keptMusicAddress`) and gives the element the answer when it comes, starting it then; an answer that fails, is empty or has not come within 20 s (`ADDRESS_WAIT_MS`) is the track's own `src`, the address every hub file is fetched through, and a late answer is given back unused (`releaseAddress`), as is the address an element held once it is given another. The game's own war pieces are never asked for. A track that cannot be played is passed over, and a list none of whose tracks can be played gives the situation back to the game's own piece until the player has been back to the menu. The scene comes from `GameUI/main.jsx` (`musicSceneOf`). Nothing sounds before the first click, a file is fetched only when it is about to play (but for the build made ready on the menu) and only while music is on, and everything, both of Passage Of Time's elements included, pauses while the page is hidden or a track is being tried out in the scenario editor (`holdMusic`). **One page of the game sounds at a time** within a browser profile: `startMusic` opens a `BroadcastChannel` (`MUSIC_CHANNEL`, "oh-music"; none, and every page plays as before) on which a page says it is playing, with an id of its own, whenever the player turns to it (a click, tap, key press or focus while music is on); a page that hears another's holds its music until the player turns to it again (`createMusicTurn`). That hold and the preview's are two reasons kept apart (`createMusicHolds`), so letting go of one does not let go of the other; none of it is in the director. Settings → General → Sound shows whose music it is, and under it **Now playing:** with the credit and source of the hub track that is sounding (`subscribeNowPlaying`, `getNowPlaying`); the game's own eight files (Passage Of Time, Clear Skies, Frankincense and Myrrh, Discovery, Honour Among Thieves, A Kind Of Hope, Legionnaire, Vanguard, each with its `work` name in `MUSIC_TRACKS`) and their credits are in `public/audio` (CC BY 4.0, `CREDITS.txt`). All but one are the composer's recordings **re-encoded** to about half the size together (MP3; with the piece, its composer, the licence and the fact of the re-encoding written into each file's tags), whole and at their own length to the sample. Passage Of Time and Clear Skies, which the game is put at a time in part of the way through, are **constant bitrate** (`ffmpeg -c:a libmp3lame -b:a 192k`): a browser put at a time in a variable-bitrate MP3 lands about 0.3 s off (measured in Chrome with `seek-check.mjs`: the hit at 168.6 s was heard at 168.9), which would move every hit the loading music stops on; the other re-encoded pieces, which are only ever played from their start, are variable bitrate (`-q:a 4`), which is smaller. `a-kind-of-hope.mp3` is not re-encoded: it is the composer's own 320 kbps file (13.7 MB), with only the licence added to its tags, and `CREDITS.txt` and the README say so beside the others. A piece that gets a `drama` profile must be constant bitrate (pinned by the music tests), so every time and loudness table above is the same in them; `CREDITS.txt` and the README say so, as the licence asks of a change | `src/main.jsx` (boot), `GameUI/main.jsx` (scene, the scenario's music), `scenarioMusic.js` (lists), `ScenarioMusicPanel.jsx` (previews), `settings.jsx` (credits) |
| Hub music list | `src/runtime/hubMusic.js` (+ `useHubMusic.js`) | the community hub's list of music a scenario may play, which only the hub's contributors can add to: `music.json` on the hub repository's `music-index` branch (`HUB_MUSIC_URL`, schema `open-historia-music-index/1`), read from raw.githubusercontent.com. `fetchHubMusic` never throws: a list the hub answers with is kept in memory five minutes and in `localStorage` (`oh:hub-music:v1`) for a week, so a second start knows it at once (`knownHubMusic`) and a start with no connection still knows the names and credits; a list that is not there yet (404) or is another schema is no hub music (`listed: false`, `hubMusicProblem`: *The hub's music list cannot be read yet.*) and forgets the kept copy; a hub that cannot be asked leaves the last list known. `normalizeHubMusic` reads it as a stranger's file: each field only as the type it should be and cut to a length, a track's `file` only an https address in the hub's own releases (`hubReleaseUrl`), and a track taken down (`removed`) kept with no file so a scenario that names it can say it is gone. `trackById`; `offeredTracks` (what an author may choose from); `playableAddressOf(track)` (the address every hub file is fetched from, or "" for a track that must not be played; it is what a track is played from where no copy of it can be kept, see Kept music: `hubFileAddress` in `hubFiles.js`, the local server's `/api/hub/file` proxy and its hub cache in the desktop app, the hub proxy's own `/hub/file` on the website and in the Android app, where an element's request never passes the page's fetch). `useHubMusic(wanted)` is the list for a screen: what is known at once, then the hub's answer | `scenarioMusic.js`, `ScenarioMusicPanel.jsx`, `libraryBar.jsx` (the credits before a game) |
| Scenario music | `server/scenarioMusic.js` (the record, both stores), `src/runtime/scenarioMusic.js` (the page's side) | which hub tracks a scenario plays in four situations: `music: { loading, game, atWar, battle }`, each a list of at most twelve `{ id, version }` in the order they play, and no `music` at all when every list is empty (`normalizeScenarioMusic`, `scenarioMusicField`, `scenarioMusicTrackIds`). It is a scenario detail like `features`: both stores read and write it through the one module on a save, an export (`scenario.music` in the bundle), an import, a clone and a hub Update, which takes the new version's music or takes the old away. On the page: the situations' names (`MUSIC_SITUATION_LABELS`), the record resolved against the hub's list into what the director plays (`resolveScenarioPlaylists`: tracks the list no longer has, has taken down or cannot be played from are left out; the hub's current file for an id plays whatever version the scenario noted), the credits its tracks' licences ask for (`scenarioMusicCredits`, `trackCredit`, `creditSiteOf`), and `followScenarioMusic(music)`, which keeps the director's lists those of the open game's scenario: what this device already knows of the hub's list at once, then the hub's answer, asked only while the music is on | both stores, `GameUI/main.jsx`, the scenario editor's Music tab, `scenarioChanges.js` (one `music` change in a suggestion) |
| Scenario language packs | `server/scenarioLanguages.js` (the record, both stores), `src/runtime/scenarioLanguagePacks.js` (collecting, planning, reading answers, the game's fetch), `src/Game/AI/scenarioTranslation.js` (the request), `src/runtime/useScenarioLanguagePack.js` (in a game) | a scenario's own text in other languages, `languages: { <code>: { <English>: <translation> } }`, generated in the Workshop's Languages tab with the author's AI and read first in a game in that language, with no request ([i18n.md](i18n.md#a-scenarios-own-language-packs)). Carried like `music` on a save, an export, an import, a clone and a hub Update; never in a listing, which has `languageCodes`; one language at a time for a game (`GET /api/scenarios/:id/languages/:code`) | both stores, `ScenarioLanguagesPanel.jsx`, `translator.js` (`setScenarioLanguagePack`), `scenarioChanges.js` (one `languages` change per language), the Community tab |
| The played country | `src/runtime/library.js` (`setOpenGameCountry`), `GameUI/main.jsx` | which country a game is played as is in the game's own record (`game.json`), and the library's list has it only as it stood when the list was last read. It changes in play (the **Play As Country** cheat writes the record), and for as long as nothing told the list, everything that reads the record (the AI, the orders, the chat) took the player for the new country while everything that reads the list's entry (the country in the game's bar and its drawer, the war room's button, the music) kept the old one, or none. So the game's screen reads the record's country (`useRuntimeState("game", selectPlayedCountry)`, null until the record is read, an empty name for a game with no country) and tells the library, whose entry for the open game then names it, at once and for every reader; the list's listeners are woken only when that changes what an entry shows. A shared game's entry is the view's and wins (`setSharedGameEntry`) | `libraryOpenGameCountry.test.js` |
| Kept music | `src/runtime/keptMusic.js` (the page's side), `server/keptMusic.js` (the record, both sides), `server/musicLibrary.js` (the desktop's folder) | a hub track is **downloaded to the device once and kept by its sha256**, not by which scenario, track id or address asked for it, so another scenario that plays the same song fetches nothing. `keptMusicAddress(track, { preview })` is the one function that says where a track is played from, async and platform-aware, used by the music director and by the scenario editor's preview (which keeps the track too). **Desktop app and local server**: `/api/music/<sha256>?url=<the track's file in the hub's releases>&track=<id>[&preview=1]`; the server keeps `<data dir>/music/<sha256>.mp3|.ogg` with one `index.json` and serves it from disk with byte ranges ([server.md](server.md)). **Website**: a cache of its own in Cache Storage (`oh-music-v1`, exempt from the old-cache sweep at the top of `assets.js`), one entry a sha256 with the record beside them; the first play fetches the file through `/api/hub/file` (the hub proxy), checks its sha256 (`sha256.js`), keeps it, and plays from a `blob:` address made from the kept copy, as every later play does; a blob address is revoked when its `<audio>` moves on (`releaseMusicAddress`). **Where it cannot be kept** (no Cache Storage: the Android app, whose page is served from an http address; a fetch that fails; a file that is not the one the hub's list describes; a track with no sha256) the answer is `playableAddressOf(track)`, so the music still plays and nothing is kept. The record (`normalizeKeptMusic`): `{ [sha256]: { type, bytes, playedAt, ids, previewed } }`, where `ids` are the hub track ids a **game** asked for the file as and a preview adds none. **Limit**: 1 GB on the desktop, 300 MB on the website, the tracks played longest ago going first (`keptMusicOverLimit`). **The kept music follows the scenarios**: when a scenario is deleted (moved to Recently deleted counts: restoring it restores no file, and its music is downloaded again when it is played), saved with a track taken out, or replaced by a hub Update, both stores delete every kept file that was a game's and that no scenario left in the library names any more (`usedMusicTrackIds`, `keptMusicUnused`; `sweepMusicLibrary` on the desktop, `sweepKeptMusic` on the website); a file only ever previewed has no ids and is left to the limit. A game carries no music of its own (it plays its scenario's), and a scenario a game uses cannot be deleted. Settings → General → Sound shows how much is kept and clears it (`keptMusicUsage`, `clearKeptMusic`) | `ambientMusic.js`, `ScenarioMusicPanel.jsx`, `settings.jsx`, both library stores |
| Vault door sounds | `src/runtime/vaultSounds.js` | the sounds of the vault door the app opens on (`GameUI/VaultDoor.jsx`), **made with the Web Audio API, not played from files** (noise through filters and a few tones: nothing to download, no licence to carry): `rattle()` when the door shudders to be clicked, `spin(seconds)` the wheel's ratchet, quick and then slowing, over a whirr, `unlock()` the bolts' clunk and the ring of struck steel, `open(seconds)` the seal's hiss, the leaves' grind for as long as they move and the boom of their stops. `createVaultSounds({ makeContext, enabled })` makes one `AudioContext` at the first sound and closes it when the door is gone (`dispose`); every method does nothing where there is no audio. A browser lets a page make no sound before the first click, so on the website the first rattles are not heard (the context is suspended and asked to resume at every sound) and the click on the wheel is what lets the rest sound; the desktop app sounds from the start. Off with **Sound effects** in Settings → General → Sound (`soundEffectsEnabled`, on by default), when not even the context is made. The menu's music waits behind the door as a third reason of `createMusicHolds` (`holdMusicBehindDoor`, "door") | `GameUI/VaultDoor.jsx`, `App.jsx` |
| Vault door's openings | `src/runtime/vaultDoorDue.js`, `src/runtime/buildId.js` | whether this opening of the game shows the vault door: the first time the game opens after an update, or at every opening with **Every time the game opens** (`vaultDoorDue`, pure; `decideVaultDoor`); the build the door last opened for (`localStorage` `oh-vault-door-build`, kept by `rememberVaultDoorBuild` when it has opened). The running build's id (`appBuildId`): the Android app's `VITE_APP_BUILD` with its track, the website's `VITE_WEB_BUILD`, the desktop app's `OH_DESKTOP_BUILD` asked of its own server (`GET /api/app-kind`, 1.5 s at most), otherwise the address of the running code, which a release build names after a hash of its content (a development run's never changes) | `App.jsx` |
| Visit counters | `src/runtime/visitCount.js`, `public/consent.js` | adds the gate (`consent.js`), which asks the player and, only after a yes, loads Google Analytics and Umami, with a tag naming the application: `website`, `desktop-main`, `desktop-beta`, `desktop-multiplayer`, `self-hosted`. Global Privacy Control and Do Not Track count as a no. The answer can be changed in Settings → General → Privacy (`src/runtime/visitConsent.js`). The desktop builds serve one page, so it asks its server which it is (`GET /api/app-kind`, `server/appKind.js`). Never in the Android app, a development run, a page not on this computer's own address, or a server started with `OH_VISIT_COUNT=0`. The website's other pages carry the gate's tag in their HTML and no counter; `public/privacy/index.html` says all of this and must follow any change | `src/main.jsx` (boot) |
| Diagnostics log | `src/runtime/debugLog.js` | rolling event log for bug reports, the Logging file (Desktop log merged in), secret redaction, the on/off + detailed settings | `src/main.jsx` (boot), Settings → Diagnostics, library/assets/time/actions/settings/gameplay hooks |
| Desktop log | `server/logStore.js` (+ `server/logRedaction.js`) | the desktop app's and server's own entries, on disk; read back into the Logging file | `server/server.js` (`GET`/`DELETE /api/log`), `electron/main.cjs` |

---

## Library store — `src/runtime/library.js`

The single source of truth for the player's **games**, **scenarios**, and which of each is active. It holds one module-scope object (`libraryState`), exposes it through a `useSyncExternalStore` subscription, and wraps every catalog mutation as an `/api/*` call that refreshes the store afterwards.

### State shape (`INITIAL_LIBRARY_STATE`, `library.js`)

| Field | Type | Meaning |
|---|---|---|
| `activeGame` | object \| null | The active game record (resolved from `games` by `activeGameId`) |
| `activeGameId` | string \| null | Server-chosen active game, falls back to `games[0].id` |
| `baseSaves` | array | Base-save descriptors returned by the catalog |
| `countryNames` | object | Catalog-level country-name map (`{}` when absent) |
| `error` | string \| null | Last catalog error message |
| `games` | array | All game records |
| `loaded` | boolean | Catalog has completed at least once |
| `loading` | boolean | A catalog fetch is in flight |
| `runtimeScenario` | object \| null | The scenario whose assets are currently live (drives overrides + token) |
| `scenarios` | array | All scenario records |
| `selectedScenario` / `selectedScenarioId` | object/string \| null | The scenario selected in the library UI |
| `token` | string | Cache-busting asset token (`catalog.token` → `activeGame.cacheToken` → `""`) |

`runtimeScenario` resolution (`library.js`) is layered: the scenario matching `catalog.runtimeScenario.id`, else the raw `catalog.runtimeScenario`, else the active game's `scenarioId` scenario. This is the scenario whose `countryNameOverrides` and `cacheToken` become live.

### Store API

| Export | Kind | Purpose |
|---|---|---|
| `getLibraryState()` | getter | Current `libraryState` snapshot |
| `subscribeToLibraryState(listener)` | subscribe | Adds/removes a listener; returns unsubscribe |
| `useLibraryState()` | React hook | `useSyncExternalStore` binding — components re-render on any state change |
| `refreshLibraryCatalog({ force })` | async | GET `/api/library`, apply into state; de-dupes concurrent calls via `libraryCatalogRequest` unless `force` |
| `ensureLibraryCatalog()` | async | Refresh only if not already `loaded` |

`emitLibraryState()` fans out to the `listeners` Set; `setLibraryState()` is the choke point that (1) stores the new object, (2) calls `syncLibraryRuntime()`, then (3) emits — so the country-name resolver and asset token are **always re-wired before** React sees the new state.

### Catalog mutations (each refreshes the store)

All go through `requestJson()` (thin `fetch` + `parseApiResponse`, which throws `payload.error || payload.message || "HTTP <status>"`). Two patterns: functions that receive a fresh `catalog` in the response apply it directly via `applyLibraryCatalog`; the rest call `refreshLibraryCatalog({ force: true })` after mutating. `saveScenario`, `saveGame` and the four asset upload/clear helpers take a last `{ refresh = true }` option: a caller making several writes in a row passes `{ refresh: false }` to each inside `withSingleLibraryRefresh(write)`, which refreshes once after the last write, whether or not the writes succeeded (the Workshop save and accepting suggested changes do this; a Workshop save used to rebuild the catalog seven times).

| Export | HTTP | Route | Notes |
|---|---|---|---|
| `loadScenarioDetails(id)` | GET | `/api/scenarios/:id` | Returns details, no state change |
| `createScenario(payload)` | POST | `/api/scenarios` | Then `enqueueContentStrings(payload)` + force refresh |
| `saveScenario(id, payload)` | PUT | `/api/scenarios/:id` | Same translate-on-save + force refresh |
| `selectScenario(id)` | PUT | `/api/scenarios/selected` | Body `{ scenarioId }`; applies returned catalog |
| `removeScenario(id)` | DELETE | `/api/scenarios/:id` | Applies returned catalog |
| `downloadScenarioJsonAsset(id, key)` | GET | `/api/scenarios/:id/assets/:key` | Returns `null` on 404 only (missing = "use default"); any other failure, a parse included, throws, so a caller never saves the default over an asset it failed to read. The web store answers 500, not 404, for a read that failed |
| `uploadScenarioAsset(id, key, file)` | PUT | `/api/scenarios/:id/assets/:key` | Raw body via `toUploadBuffer`; force refresh |
| `clearScenarioAsset(id, key)` | DELETE | `/api/scenarios/:id/assets/:key` | Force refresh |
| `exportScenarioBundle(scenarioId)` | GET | `/api/scenarios/:id/export` | Returns bundle JSON; always the whole scenario, custom PMTiles included (there is no light export) |
| `importScenarioBundle(bundle)` | POST | `/api/scenarios/import` | New local scenario; force refresh |
| `updateScenarioFromBundle(id, bundle)` | PUT | `/api/scenarios/:id/import` | Hub **Update** button — replaces content, **keeps the local id** so games keep working |
| `loadGameDetails(id)` | GET | `/api/games/:id` | Returns details |
| `createGame(payload)` | POST | `/api/games` | `enqueueContentStrings` + force refresh |
| `saveGame(id, payload)` | PUT | `/api/games/:id` | `enqueueContentStrings` + force refresh |
| `activateGame(id)` | PUT | `/api/games/active` | Body `{ gameId }`; applies returned catalog |
| `removeGame(id)` | DELETE | `/api/games/:id` | Applies returned catalog |
| `uploadGameAsset(id, key, file)` | PUT | `/api/games/:id/assets/:key` | Raw body; force refresh |
| `clearGameAsset(id, key)` | DELETE | `/api/games/:id/assets/:key` | Force refresh |

`toUploadBuffer()` (`library.js`) accepts `Blob`, `ArrayBuffer`, a typed-array view, or coerces anything else to a UTF-8 buffer, so callers can upload files or serialized JSON identically.

### Country-name override resolver (in this module)

`resolveCountryNameOverride(overrides, name, code)` (`library.js`) is the ordered lookup used to rename countries per-scenario. It reads `runtimeScenario.countryNameOverrides` and returns the first hit:

1. by **code** (uppercased via `normalizeLookupKey`) — e.g. `overrides["RUS"]`
2. by **exact name** — `overrides["Russia"]`
3. by **normalized (uppercased) name** — `overrides["RUSSIA"]`
4. otherwise the original `name`

The exit into the shared asset layer:

- `syncLibraryRuntime()` (`library.js`) runs on every `setLibraryState` and once at module load (`library.js`). It pushes the token to `setRuntimeAssetEndpoints({ token })` and installs the resolver via `setCountryNameResolver((name, code) => resolveCountryNameOverride(runtimeScenario.countryNameOverrides, name, code))`. From then on every `resolveCountryDisplayName` call inside `assets.js`/`countryLabels.js`/`polityNames.js` honors the active scenario's renames.

### Boot / data flow

`src/App.jsx` calls `ensureLibraryCatalog()` and reads `useLibraryState()` (only `activeGameId` in that file). On any library mutation the token changes → `setRuntimeAssetEndpoints` sweeps and rotates all runtime URLs (see [resolver plumbing](#country-name-resolver-plumbing--srcruntimeassetsjs)) → components subscribed to the store re-render → asset fetches now carry the new `?v=<token>`.

---

## Country-name resolver plumbing — `src/runtime/assets.js`

Codes (`"RUS"`, `"KHAL"`) are the load-bearing identifiers in the data; the player must only ever see full names. The resolver is a single mutable function slot in `assets.js` that the library/scenario stores install into.

| Export (`assets.js`) | Role |
|---|---|
| `setCountryNameResolver(resolver)` | Installs the active resolver (`(name, code) => string`); non-functions reset to identity |
| `resolveCountryDisplayName(name, code)` | The single call site used across the asset layer — delegates to the installed resolver |
| `setRuntimeAssetEndpoints({ token })` | Rebuilds every `JSON_URLS.*` and `PMTILES_ARCHIVES.*` with `?v=<token>`, and **sweeps stale caches** on token change |

Default resolver is identity (`countryNameResolver = (name) => name`, `assets.js`) until a store installs one. `loadCountryNames` (`assets.js`) and `loadRegionCatalog` decode the countries PMTiles z0 tile and run each raw `Country/NAME` through `resolveCountryDisplayName(name, code)`, so scenario renames flow into the country dropdowns and map labels without those modules knowing about scenarios.

**Token sweep (memory + correctness).** When the token changes, `setRuntimeAssetEndpoints` deletes the previous generation's entries from `jsonValueCache`, `jsonRequestCache`, `jsonLoadedUrls`, the PMTiles archive/header/directory caches, and clears the key-based `runtimeJsonValueCache`/`runtimeJsonRequestCache` — **before** rebuilding the URLs, because the old URL strings are the only handles to those entries. This prevents both the ~190 MB-per-switch GeoJSON leak and serving one scenario's bytes under another's cached PMTiles header. See [Assets](assets-and-data.md) for the full cache model.

### Sibling resolver — `src/runtime/polityNames.js`

Where the override resolver renames by scenario, `polityNames.js` resolves a **code → era-polity or base name** for single values, cached for sync access.

| Export | Purpose |
|---|---|
| `ensurePolityNames()` | Seeds `nameByCode` once per game from a plain cached read of `world.json` (no force, no clone); merges `loadCountryNames()` with `world.polityOverrides` (era polity wins **only when it carries a name**). After that the map is rebuilt from `oh:world-updated`'s `detail.world` on every world write, and cleared and re-seeded on `oh:active-game-changed`; nothing polls |
| `polityDisplayName(code)` | Sync lookup, falls back to the code until the seed has run |
| `subscribePolityNames(listener)` | Told whenever the names change (a world write, a game switch) |
| `useCountryDisplayName(code)` | Hook: renders the code, then the resolved name, and follows a rename as soon as it is written |

A switch to another save empties the cache at once and tells every subscriber, because the same code can name another polity in the save switched to; a seed still in flight for the previous save is disowned (its answer is dropped when it lands) and the names are read again for the new one.

---

## Language setting — `src/runtime/i18n.js`

Owns the UI-language *choice* and static catalog. The choice is stored on the **server** (shared by every device — desktop browser and the Android app that play through the same server) and mirrored to `localStorage["ui_language"]` so boot doesn't wait on a fetch. `"en"` (the authored language) means no translation happens at all.

| Export | Purpose |
|---|---|
| `DEFAULT_LANGUAGE` | `"en"` |
| `LANGUAGES` | 56-entry array of `{ code, name, native }` (top-50 most-spoken, then the six a translation model covers that are not: `lv lt sk et ga mt`; English name + endonym) |
| `getLanguageOptions()` | Returns `LANGUAGES` |
| `languageDisplayName(code)` | English display name, falls back to the code |
| `getStoredLanguage()` | Reads localStorage; returns `DEFAULT_LANGUAGE` on miss/error |
| `setStoredLanguage(code)` | Writes localStorage **and** PUT `/api/ui-settings` `{ language }` (offline-tolerant) |
| `syncLanguageFromServer()` | GET `/api/ui-settings`; server wins; returns `true` only when the new value reads back from localStorage and this tab has not already reloaded for it (sessionStorage `ui_language_reloaded`), so the caller reloads once. A value storage refuses (full or blocked) is held in memory for the page instead (`getStoredLanguage` returns it) and no reload is asked for |
| `isRtlLanguage(code)` | Membership in `RTL_LANGUAGES` = `{ ar, he, fa, ur }` |
| `languageDirective()` | System-prompt fragment appended to every AI call so replies arrive natively in-language |

Storage rule: writing `en` (or empty) **removes** the key rather than storing it (`writeLocalLanguage`, `i18n.js`), so "English" is represented by absence. `languageDirective()` returns `""` for English; otherwise it instructs the model to write all natural-language text in the target language while keeping JSON keys/ISO codes/date formats intact — this is why AI output does not need re-translation (see [AI system](ai-overview.md)).

---

## Translator — `src/runtime/translator.js`

Puts the running game into the player's language. The full design (the three kinds of text, the packs, patterns and runs, content, the prompts, regenerating the packs) is in **[Languages & Translation](i18n.md)**. In short:

1. **The interface** comes from the shipped pack (`public/lang/<code>.json`) in the 22 languages that have one (`SHIPPED_PACK_LANGUAGES`), applied to the DOM by a `MutationObserver` as it renders: exact strings, `{{slot}}` patterns and runs of text nodes (`phraseBook.js`). It never costs an AI request there.
2. **Content** (what a scenario's author or a player made) is gathered up front, at boot and on every switch of save, and translated on the device by the translation model (`translationModels.js`, `translationModel.js`, `translationWorker.js`) where the language has one and the player said yes to its download, then saved to the server's pack. Region names go only once they are shown. Nothing is an AI request unless the player turns on **Translate with my AI** (`aiTranslation.js`, Settings → General → Language, offered only where the model is downloaded): then what the model would translate goes to their AI provider in batches of up to 240 strings, cached on the device (`localStorage["i18n_ai_v1_<code>"]`), and the model takes every batch the AI fails.
3. In a language **without** a pack (`da hu ro cs fi lv lt sk et el he ga mt`, each of which a model covers), the interface goes to the model as well, as content does.
4. **Switching language** (`switchLanguage(code)`) happens in place, with no reload: a language with a model asks first (a card over whatever is on screen) and downloads the model on a yes; the translator then puts every node it wrote back to English (`restoreEnglish`) and starts in the new language, firing `i18n:updated` and `oh:ui-language-changed`. Declined, the game keeps the language it had; declined at start, it goes to English.

### Lifecycle

| Export | Purpose |
|---|---|
| `startTranslator()` | Called once from `src/main.jsx`. Syncs language from server (reload if changed and stored; a language held in memory starts the translator in place when the page booted in English), returns early for English, sets `<html lang>` + RTL `direction`, loads localStorage cache + server pack, waits out the startup screen, then starts the observer and pre-translation pass |

Boot order inside `startTranslator`: `syncLanguageFromServer()` (reload on a stored change; a held one starts `startInLanguage` in place) → bail if `en` → `loadPromptTranslations()` (pack languages) → set `lang`/`direction` → `loadCache()` → `loadServerPack()` → `whenStartupScreenGone()` (polls for `[data-startup-screen]`, 180 s cap) → activate observer + `scan()` → `collectContentStrings()` (again on `oh:active-game-changed`) → show progress if >10 pending → `processQueue()`.

### Public lookups (for callers/data outside the DOM)

| Export | Purpose |
|---|---|
| `translateNow(text)` | **Sync**, book only: the loading screen's own text (`StartupScreen.jsx`), which the DOM translator never touches. Never queues or requests; returns the text as is in English or when the book lacks it |
| `translateLabel(text)` | **Sync** best-effort translate for text drawn outside the DOM (map country labels). Returns the known translation, or the original while queuing the name as content + firing `i18n:updated` when it resolves |
| `uiString(text, params)` | **Sync** lookup of the interface's own words for a sentence the DOM translator never reaches: one put in a composer (textareas are skipped) or sent as the player's line (their bubbles are `data-no-translate`), such as the seeded advisor prompts and the demand card's replies. `text` is the English key, a `{{slot}}` pattern included, filled from `params` (`phraseBook.format`); never queued for the AI, the English without an entry |
| `enqueueStrings(strings)` | Proactively queue content (e.g. freshly-fetched hub posts); only unknown strings cost a call |
| `enqueueEventStrings(events)` | An event log as it is written: queues only the scenario's own events (`source` `"scenario"`); the AI's are written in the player's language |
| `enqueueContentStrings(payload)` | Deep-walk a saved payload (≤6 deep, arrays of ≤500; `collectContentText` in `translationRules.js`) pulling human-readable fields (`CONTENT_TEXT_KEYS` + `aliases`), skipping `features`/`geometry`/`coordinates`, and enqueue them. Called by `library.js` on `createScenario/saveScenario/createGame/saveGame` so edited names/descriptions translate **and reach the server pack** the moment they're saved |

The map's label builders call `translateLabel(...)` so map labels follow the UI language; when new translations land, the `"i18n:updated"` event (debounced in `announceUpdate`) tells them to rebuild.

### Server language pack

- `loadServerPack()` — GET `/api/lang/:language` (shipped over saved) laid over this device's cache, so a stale local translation never hides the pack's; what the device learned that the server lacks is sent to it again.
- `syncEntriesToServer()` — debounced (2 s) PUT `/api/lang/:language` `{ entries }` pushing newly-generated translations so every device and future session reuses them instead of translating them again. A switch of language sends what is left at once, for the language it was learned in.

### Translation model + config

`processQueue()` (`translator.js`) runs only while the model is in use for the language (`modelInUse()`: it has one, the player said yes, it has not failed this session). It loads the model once (`ensureModel`; a copy gone from the cache downloads again, the pill showing how far), then sends batches of `MODEL_BATCH_STRINGS` (8) or `MODEL_BATCH_CHARS` (1,200) to the worker one after another; what the model answers badly (`acceptModelOutput`) stays English for the session. Each language start is a `generation`, and work begun for an older one is dropped when it ends. Until 2026-11-05 the player's AI model translated in batches of up to 240 strings, whatever no pack or model covered; that path is gone. Since 2026-11-06 the opt-in **Translate with my AI** (`aiTranslation.js`, `createTranslationRouter`) hands the model's work to the player's AI again, in the same batches, only where the model is downloaded, with the model taking every batch the AI fails ([i18n.md](i18n.md#translate-with-my-ai)). The model's files are kept by `modelStore.js`: Cache Storage, or IndexedDB on the Android app's http origin, where there is no Cache Storage.

| Constant | Value | Meaning |
|---|---|---|
| `CACHE_PREFIX` | `i18n_v2_` | localStorage key prefix (`+language`): what the model translated on this device and the server does not have yet. The pre-pack `i18n_cache_*` keys are removed on boot |
| `CACHE_LIMIT` | `8000` | Max cached entries persisted (most-recent kept) |
| `SCAN_DEBOUNCE_MS` | `350` | Debounce before a DOM scan |
| `TRANSLATED_ATTRIBUTES` | `placeholder, title, aria-label, aria-description, alt` | Attributes also translated (and observed as they change) |
| `SKIP_SELECTOR` | `script, style, noscript, input, textarea, [contenteditable], [data-no-translate]` | Never-translated nodes; opt out with `data-no-translate` |

The `nodeRecords` and `attributeRecords` WeakMaps record, per text node and attribute, the English last seen there and what the translator wrote over it, so re-renders that bring new English are translated again and the translator recognizes its own writes, runs of text nodes included.

---

## Related past events — `src/Game/AI/relatedEvents.js`

Always on, with no setting (since 2026-11-07; before that it was an opt-in switch that downloaded the model). A small sentence-embedding model that ships with the game turns each event of the open game into a vector, and each time skip is shown the past events nearest to what the turn is about. No AI request is made for any of it.

**The model** (`embeddingModels.js`): all-MiniLM-L6-v2 (Apache-2.0), Xenova's ONNX copy at a pinned revision, int8: four files, 23,685,047 bytes (`EMBEDDING_MODEL.bytes`), shipped with the game in `public/models/all-MiniLM-L6-v2/` beside its Apache-2.0 `LICENSE` and a README naming the source (`embeddingModelFiles.test.js` pins the sizes and the weights' sha256, and that it is the only `.onnx` in `public/`), 384 dimensions, the first 128 word pieces of a text (what the model was trained on). It runs in `embeddingWorker.js` as the translator's model runs in `translationWorker.js`: Transformers.js 4.3.1 on ONNX Runtime's WebAssembly (`oh-ort-transformers/` in `vite.config.ts`, part of the build), one thread, the tokenizer built from `tokenizer.json`/`tokenizer_config.json` fetched from the game's own address, `AutoModel.from_pretrained("all-MiniLM-L6-v2", { local_files_only: true, dtype: "q8" })` with `env.allowRemoteModels = false` and `env.localModelPath` the build's `models/` (`embeddingModelRoot(import.meta.env.BASE_URL, origin)`: `/models/` on the desktop's local server and in the Android app, `/play/models/` on the website), one text a run (a padded batch was slower on WebAssembly), then mean pooling over the attention mask and scaling to length one (`meanPoolNormalize`). Nothing is downloaded from a model host and no copy is kept in a cache of the game's (`env.useBrowserCache = false`): the desktop and the Android app read their own files, and the website's are the site's own, fetched only when the model is first used in a session and kept by the browser's HTTP cache. Vite copies `public/` into every build, electron-builder packs `dist/**` whole, `mobile/scripts/stage-www.mjs` copies `dist-android/` into `www/`, and `assemble-site.mjs` copies `dist-web/` under `/play/`; the weights (21.9 MiB) are under Cloudflare Pages' 25 MiB a file, and the desktop's chunked updates cut them by content like any other file, so a release that does not change them fetches none of them again. **The old download:** a version before this kept the model downloaded from Hugging Face under `oh-embed-model-v1`; `assets.js` no longer keeps that cache from its sweep, and `forgetOldDownload` (run once by `installRelatedEventsIndexer`, where the old setting's key `ai_related_events` is still in localStorage) removes the key and deletes the store, IndexedDB included. EmbeddingGemma-300m also runs on 4.3.1, but its smallest download is 219 MB (q4 plus a 20 MB tokenizer; 331 MB at q8), about 14 times the model per event, under the Gemma terms. Measured 2026-11-07 with the built worker in headless Chrome on a desktop (one thread): the download and first load 2 s, a load from the device 0.5 s, 72 ms an event to index (a 769-event campaign in about a minute, once), a skip's queries in about 40 ms; in Node on ONNX Runtime's native build, 6 ms an event.

**The vectors** (`eventVectorStore.js`): IndexedDB `oh-event-vectors-v1`, one record per event keyed `<gameId>:<eventId>` with the game's id indexed, holding `contentHash` (FNV-1a over the model and the text) and the `Float32Array`. Derived: rebuilt from the game, so no migrations; a new shape is a new database name. `removeGame` (`library.js`) drops a deleted game's.

**The index** (`relatedEventsSearch.js` `indexOpenGame`): the text is an event's title and description (`eventEmbeddingText`); events without an id of their own are skipped. It runs after `oh:turn-complete`, `oh:active-game-changed`, and a game being opened (`gameEntry.js`), a moment later, and before every batch of 4 waits until `isSimulationBusy()` and `isGenerating()` are both false, so it never runs beside a turn or a reply. It embeds what is new or changed, drops what was deleted, and stops when the player switches games; the next trigger carries on.

**The skip** (`findRelatedForSkip`, called in `simulateTimelineJump` before `buildTemplateVariables`): one query per pending order, live war (with its sides), live storyline and one for the player and the powers in focus (`rankFocusPowers`), at most 12 (`buildRelatedQueries`); each is embedded, and the events are taken in turns from each query's nearest above a cosine of 0.25 (`relatedScores`), 30 candidates. The whole search is given `SKIP_SEARCH_TIMEOUT_MS` (1.5 s), the model's load from the device included; slower, failed, or nothing indexed, and the skip goes without, with a line in the diagnostics log. `buildPromptContext` (`relatedEvents` option) renders the first six that are folded into the history (or, while the skip has no "also recent" lines, older than the oldest event the window of recent events shows), never one the prompt shows, in date order, one line each (date, title, the event's `digest` or a 200-character cut), within 2,000 characters, under `RELATED PAST EVENTS` after `RECENT EVENTS` in `recentEventsLong`.

**The lookup.** Once the model has answered this session (`relatedEventsReady`), `buildTaskLookups` adds `similar_events` (`lookupTools.js` `SIMILAR_EVENTS_TOOL`, `withSimilarEvents`): a query and a limit (6, at most 12), answered with date, title, summary and similarity from the whole timeline, within 8 s.

**Older conversations kept on file** (`chatArchive.js`; the rule, its exceptions and what the prompt says: [ai-prompts.md §5.3](ai-prompts.md#53-older-conversations-kept-on-file-since-2026-11-07-beta)). The same model, worker and timings. *The vectors*: a sibling database, IndexedDB `oh-chat-vectors-v1` (`openChatVectorStore`), one record per chunk keyed `<gameId>:<chatId>:<chunk>`, holding `{ gameId, chatId, chunk, hash, vector }`, the game's id indexed; `forgetGameVectors` clears both databases when a game is deleted. *The index*: `indexOpenGame` runs `indexArchivedChats` after the events, on the same triggers and the same idle waits: it reads the chats, the game and the world, applies the rule as it stands (`partitionChats`, with the thread on screen from `openConversation.js`), embeds each archived chat's new or changed chunks two at a time (`embedTexts(texts, { maxTokens: 256 })`; the worker takes `maxTokens` up to `EMBEDDING_MODEL.maxSequence`), and drops the chunks of a chat no longer archived, so a chat used again leaves the archive by itself and is sent whole from the next prompt on. *The search*: `findPastTalks` (1.5 s; the skip, the advisor, a leader's reply) and `pastTalksSearch` (the `past_talks` lookup, 8 s). `scripts/prompt-size.mjs --past-talks` runs the same index and search under Node from `public/models`.

---

## Country tags — `src/runtime/countryTags.js`

Short traits describing what a country *is* (`"socialist"`, `"authoritarian"`, `"anti-nato"`). The map-maker sets starting tags in the editor (`tags.json` on the scenario); the AI reads them as context and rewrites them into `world.countryTags`. This module owns the two rules both halves must agree on — normalization and which source wins — and **imports nothing** so editor, game, and server share it.

| Export | Purpose |
|---|---|
| `MAX_TAGS` = 8 / `MAX_TAG_LEN` = 32 | Caps |
| `TAG_SUGGESTIONS` | 30 suggested spellings (open vocabulary — suggestions only, so the model converges on one spelling) |
| `normalizeTagList(list, {maxTags, maxLen})` | Trim, collapse whitespace, cap length, drop blanks/non-strings, dedupe case-insensitively, cap count |
| `resolveCountryTags(baseTags, world, country)` | Tags in force **now** for one country: the AI's live list if it ever set one, else the author's list — **not a merge** |
| `resolveAllCountryTags(baseTags, world)` | Same rule across every country that has tags; builds the world summary the model reads |

**Keying gotcha (documented in-file):** tags are keyed by the country's **name, verbatim** — no uppercasing. The code used to uppercase (fine when owners were uppercase GADM codes); with names it looked up `baseTags["RUSSIA"]` against a `tags.json` keyed `"Russia"` and silently dropped every author tag. `resolveAllCountryTags` emits keys verbatim for the same reason (the model's world summary must match `polityOverrides` casing). Consumed by `src/Game/AI/promptContext.js` and, at Round Zero, by `src/Game/AI/geopoliticalWorldGenerator.js` (the scenario's `tags.json` passed as `baseCountryTags`).

---

## Country labels — `src/runtime/countryLabels.js`

What is left of the stock modern-country label builder. The map's polity names come from the political worker (`src/Game/Map/vnext/polityLabels.js`); this file keeps:

| Export | Purpose |
|---|---|
| `loadRegionLabelGeometry()` | Coarse region shapes from the regions PMTiles z0 tile, memoized per archive, for the country picker (`CountryPickerMap.jsx`) |
| `summarizePolityLabelDiagnostics(collections)` | The label diagnostics `Nations.jsx` logs |

It also carries an older copy of the polity-label engine (`buildPolityLabelCollections` and its tiers) that nothing imports; the worker uses the one in `vnext/polityLabels.js`.

The stock atlas (`loadCountryLabelCollections`, `warmCountryLabelCollections`) is gone: every served world has `customRegions: true` (`normalizeRuntimeWorld`), so the layers it fed never drew, yet the startup screen built it on every launch and Cache Storage kept a copy per language and owner set. The startup preload now deletes those `country-labels-*` entries (`deleteRuntimeJsonByPrefix`, `assets.js`).

This module labels the stock countries only. A game's live polity labels are laid out by `src/Game/Map/vnext/polityLabels.js` inside the political worker (see [Game map](game-map.md)).

---

## The hub's index: its posts, its checked files, its counts (`hubFiles.js`)

A hub post is a GitHub issue with a file dragged into it. The hub repository's workflow (`.github/workflows/copy-post-files.yml` there) looks inside every such file before anyone plays it. A file that would not work, or that carries something it should not, is refused with a comment on its post. One that passes is copied into the repository's **releases** (`scenarios-1`, `flags-1`, `basemaps-1`, and a `-2` once one nears GitHub's 1000 files a release), repaired where that is safe: an SVG becomes a PNG, a zip is rebuilt from its checked entries. Suggestion comments are checked the same way, and one that fails is deleted. A post whose file was released may be closed by the hub.

The game takes two things from that, and nothing else:

- **The list of posts is the hub's own.** It is in the hub's index, not asked of GitHub's issue API: the posts whose file was released, open or closed. A post with a problem is not on it.
- **The only files downloaded are the checked copies in the releases.** A post's own attachment is never fetched, and never shown: a scenario's cover, a flag and a basemap's picture are drawn from their copies, and with no copy there is no picture.

| Piece | What it is |
|---|---|
| `index.json` on the hub's `hub-index` branch | `{ version: 2, generatedAt, files: { "<attachment address>": "<checked copy's address>" }, imports: { "<post number>": n }, posts: [ <post> ], suggestions: { "<comment id>": { post, zip } } }`, rewritten by the workflow whenever a post or a comment changes, and every half hour for the counts. A `<post>` is in the field names of a GitHub issue: `number, kind, state, title, body` (at most 20,000 characters), `user { login, avatar_url }, html_url, created_at, updated_at, labels` (names), `author_association, reactions { "+1" }, comments` |
| `fetchHubIndex({ force })` | Reads it from `raw.githubusercontent.com` (any origin may; no API request is spent), keeps it five minutes, shares one request between callers (a forced read too), and never throws: an index that cannot be read is one that lists nothing, and after a failed read the last good one is kept |
| `normalizeHubIndex` | Reads it as a stranger's file. Copies only under `github.com/Open-Historia/Open-historia-scenarios/releases/download/` (`hubReleaseUrl`, `server/hubProvenance.js`), whole non-negative counts, each post field only as the type it should be and cut to a length (`MAX_POST_BODY`), an avatar only on `avatars.githubusercontent.com`, a post's page built from its number and never read, a suggestion only with a numeric comment id, a post number and a `.zip` on github.com. An index with no `posts` (version 1, from before the hub checked anything) comes out `listed: false` with **no files**: its copies were made without a look inside |
| `hubIndexProblem(index)` | Why an index gives no list and no files, as a sentence for the player (`HUB_FILE_TEXTS`, in the language packs), or null |
| `releaseCopyOf(index, url)` / `requireReleaseCopy(url)` | The checked copy of a file, by the attachment's address as its post names it; the second reads the index and throws the sentence when there is none. An address that is itself one of the index's copies is its own copy |
| `checkedSuggestionsOf(index, postId)` | `{ comment id: zip }` for the suggestion comments on a post that passed the hub's check |
| `fetchHubFile(url, { copy })` | The one place the game calls `/api/hub/file`. The checked copy, or an error a player can read; **never the attachment**, whatever fails. `copy: false` is for a suggestion's `.zip`, which stays its comment's attachment and is fetched only once the index lists it |
| `imageTypeOfBytes(bytes)` | PNG, JPEG, GIF or WebP by the first bytes. A copy is not always what its attachment was called (an `.svg`'s copy is a PNG) and GitHub serves every release file as `application/octet-stream`, so the flag and basemap loaders ask the bytes |

A post's **identity is still its attachment's address** (`bundleUrl`, `hubOrigin.bundleUrl`): that is what the Update button compares, so the same file released again under another address never looks like a new version. The copy that was downloaded is kept beside it as `hubOrigin.release`, stamped by `downloadHubScenario` (`hubPosts.js`) for the Community tab's Import, the Scenarios tab's Update and Import & play. A link without one is an **old link**: the copy came from the post's own attachment, before the hub checked anything. `hubUpdateReason(scenario, post)` answers `"unchecked"` for it, whether the player has edited the copy or not, as long as the post is still on the hub; `"newer"` and `"basemap"` are the two older reasons, for an unedited copy only. The Scenarios tab's card says the first one in the open and offers the Update ([game-ui.md §4.7](game-ui.md#47-hub-update-detection)).

A **suggestion** is a comment's attachment and is never copied. `refreshPublishedRecord` keeps only the ones the index lists (`post.checkedSuggestions`, same comment and same `.zip`); a comment that reads as a suggestion and is not listed is still waiting for its check, or is about to be deleted, and while there is one the post's comment count is not recorded, so the next look reads the comments again. A bot's comment is never waited for: the hub does not check those.

When the hub cannot be read (offline, or its index is still a version 1 file) the Community tab, the flag and basemap browsers and every download fail with one of the `HUB_FILE_TEXTS` sentences. There is no fallback to GitHub's API or to a post's attachment.

**The import count is not the index's `imports`.** Those are downloads of the post's file, and anyone can download it. The count a post shows is the import counter's (`src/runtime/hubImportCount.js`, `tools/import-counter/worker.js`, [delivery-and-deploy.md §7.1](delivery-and-deploy.md#71-import-counter--toolsimport-counter)):

| Piece | What it is |
|---|---|
| `countHubImport(postId)` | Called by `downloadHubScenario` (`hubPosts.js`) on a post's first import on this install only: not for an Update, not when the library holds the post (`again`), not when ui-settings `hubImported` has it. Sends `POST /import { post, token }`; never awaited, never throws; a report that cannot be sent is a count lost |
| `installCountKey()` / `importToken(key, post)` | The install's random key, ui-settings `hubCountKey` (64 hex digits, made on first use, set once and never replaced by either store: `server/hubImported.js keepHubCountKey`), never sent. The token is SHA-256 of it and the post number, so the counter can count an install's import of a post once and cannot link one install's imports |
| `fetchImportCounts({ force })` | `GET /counts`, `{ "<post>": n }`, kept five minutes, one request shared; null when it cannot be read (the Community tab then shows no counts; never the index's downloads) |
| `importCountIn(counts, post)` | What `parsePost` puts in `post.installs` |

The counter takes the address's part: one count per post per address a day, and each post's number before it began is frozen as its starting count.

## Community flags — `src/runtime/communityFlags.js`

Reads flags shared by other players from the hub's own list of posts (`hubIssues.js`): a flag post is on it once the hub has checked its image and released a copy, a minute or so after its author submits. Deliberately mirrors `communityBasemaps.js` and stays free of React/OpenLayers deps so the editor (`src/Editor/FlagPicker.jsx`) and game can both use it.

| Constant | Value |
|---|---|
| Hub repo | `Open-Historia/Open-historia-scenarios` (`server/hubProvenance.js`, handed on by `hubIssues.js`) |
| Flag posts | `fetchHubIssues("flag")`: the index's posts labelled `flag` (label must exist in the repo or GitHub drops it) |
| Scenario posts | `fetchHubScenarioIssues()` — scanned for scenario posts carrying flags; the same list the Community tab and the basemap browser read |
| Cache | 5 min, the index's own, in `hubFiles.js` |

| Export | Purpose |
|---|---|
| `fetchCommunityFlags({ force })` | Reads both lists and the index (one request), parses, keeps the posts whose image or scenario file has a checked copy, and gives each its `pictureUrl`: the checked copy of its image, which is what a card shows. Returns `[...dedicatedFlagPosts, ...scenarioFlagPacks]` |
| `flagPostInstallable(post)` | True if a payload can be extracted: `imageUrl` for a flag post, `packUrl` for a scenario pack |
| `loadCommunityFlagDataUrl(post)` | Downloads a flag's checked copy **through the hub proxy** (`fetchHubFile` → `/api/hub/file?url=`, since GitHub's files send no CORS) and returns a `data:` URL typed by its bytes (`imageTypeOfBytes`; base64 in chunks, `bundleFiles.js` `bytesToBase64`) |
| `loadCommunityFlagPack(post)` | Downloads a scenario bundle via the proxy, finds `scenario.json` (zip or bare JSON; flags the export lifted into a zip entry of their own are put back with `restoreBundleFiles`), returns custom `{ code, dataUrl }` flags from `assets.flags` (flagcdn/built-in URLs skipped) |
| `communityFlagsHubUrl()` | Link to the filtered hub issue list |
| `flagPublishQuery({name, author, polity, code})` | The prefilled form's query. `technical` carries `Flag-Polity: <polity>` (the name exactly) and, only when the name is already a short code-like token, the `Flag-Code:` hint (upper-cased); a longer name used to arrive cut to its first word. `code` is for a My flags entry saved before the library kept `polity`: it goes in as the `Flag-Code:` hint when code-like, never as `Flag-Polity` |
| `openFlagPublishForm({name, author, polity})` | Opens the prefilled `flag.yml` issue form in a new tab (image left for the user to drag in), for a flag the author already has as a file |
| `publishFlag({name, author, polity, code, dataUrl})` | For a flag that only exists in the app as a data URL: saves it as a file first (`flagFileName`, `flagDataUrlToBlob`, `saveBlobToDisk`), then opens the form, and returns `{ fileName }` for the picker's "drag that file in" note — the flow `publishBasemap` uses |

**Two post shapes.** `parseFlagPost` turns a dedicated `[Flag]` issue into a card (`id, title, author, avatarUrl, url, createdAt, official, upvotes, code, polity, imageUrl`; `polity` is the exact `Flag-Polity:` name or null for older posts); `parseScenarioAsFlagPack` turns a `scenario` issue that stamped a **`Flags-Count:` tag** into one installable pack card (`fromScenario: true, flagCount, packUrl`), so flags shared inside a scenario surface here without downloading every bundle. Regex contracts: `imageUrl` is the body's first inline markdown/`<img>` image that GitHub hosts (`firstHubImage`, `hubIssues.js`), as the post names it, and the card shows its checked copy (`pictureUrl`), never that address; `FILE_LINK_PATTERN` (GitHub file/user-attachment/raw links), `CODE_PATTERN` (`Flag-Code:`), `POLITY_PATTERN` (`Flag-Polity:`, the rest of the line), `FLAGS_COUNT_PATTERN` (`Flags-Count:`). `OFFICIAL_ASSOCIATIONS` = `OWNER/MEMBER/COLLABORATOR` sets the `official` badge. `.zip` bundles are read with `unzipBundle`/`looksLikeZip` from `bundleZip.js`.

---

## Map settings — `src/runtime/mapSettings.js`

Small localStorage-backed settings read reactively instead of threaded as props through `GameUI`/`main.jsx`. Same getter/setter pattern as `src/Game/AI/providerConfig.js`; the hook sits beside the data it subscribes to, mirroring `useCountryDisplayName`. Several keys are not map settings at all: the AI switches in Settings → AI → Generation behavior use the same mechanism.

| `MAP_SETTING_KEYS` key | localStorage key | Default | Read with | Effect |
|---|---|---|---|---|
| `defaultBasemap` | `map_basemap_default` | empty (`DEFAULT_BASEMAP_ID` when turned on) | `getMapSettingValue` / `useMapSettingValue` | The player's default basemap (main menu Settings → Map): a built-in ESRI basemap id every game starts on wherever its scenario offers it, while `defaultBasemapOn` is on (`basemapShownFor`, `runtime/basemapPick.js`) |
| `defaultBasemapOn` | `map_basemap_default_on` | off | `getMapSetting` / `useMapSetting` | **Use my default basemap**. A game's own pick (`map_basemap_pick:<gameId>`, set in that game's Settings → Map, never shared in multiplayer: `Map/useBasemapPick.js`) still wins. The one device-wide pick before picks were per game, `map_basemap_style`, is moved here once (`migrateBasemapSettings`): a built-in id becomes the default, turned on; an `own:<id>` pick is dropped |
| `labelFont` | `map_label_font` | empty (the scenario's font, itself Georgia by default) | `getMapSettingValue` / `useMapSettingValue` | A font family overrides the scenario's country-label font on this device |
| `hideCountryLabels` | `map_hide_country_labels` | off | `getMapSetting` / `useMapSetting` | Hide country name labels |
| `disableIdleRotation` | `map_disable_idle_rotation` | off | `getMapSetting` / `useMapSetting` | Stop the idle globe spin |
| `disableEventCamera` | `map_disable_event_camera` | off | `getMapSetting` / `useMapSetting` | Suppress event camera moves |
| `limitAiGeneration` | `ai_limit_generation` | off | `getMapSetting` | An AI task gives up after 5 minutes of silence part-way through an answer, or 15 with no answer, and falls back to canned events; off waits as long as the model needs |
| `batchBackgroundTasks` | `ai_batch_background_tasks` | off | `getMapSetting` | Anthropic only: the event consolidator rides the Message Batches API at about half the price |
| `chunkLongJumps` | `ai_chunk_long_jumps` | off | `getMapSetting` / `useMapSetting` | Long time skips are generated in several shorter requests, one per segment |
| `lookupFunctions` | `ai_lookup_functions` | **on** | `getMapSettingDefaultOn` | Structured tasks declare the lookup functions (only while My key has no request limit is on; Settings → AI → AI requests → Advanced) |
| `liveSkipEvents` | `ai_live_skip_events` | **on** | `getMapSettingDefaultOn` | A skip fills the Events panel as the model writes |

| Export | Purpose |
|---|---|
| `getMapSetting(key)` | `localStorage.getItem(key) === "1"`: an absent key reads as **off** (and `false` with no `localStorage`) |
| `getMapSettingDefaultOn(key)` | `localStorage.getItem(key) !== "0"`: an absent key reads as **on**. Every reader of a default-on key must use this; `getMapSetting` would read a fresh install as off |
| `setMapSetting(key, value)` | Writes `"1"`/`"0"`, logs the flip to the diagnostics log, and dispatches a `mapSettings:updated` window event |
| `useMapSetting(key)` | `useState` hook over `getMapSetting` that re-reads on the `mapSettings:updated` event (so only for default-off keys) |
| `getMapSettingValue(key, fallback)` | A string setting: the in-memory value set this session, else localStorage, else `fallback` |
| `setMapSettingValue(key, value)` | Trims the value, keeps it in memory (so it applies even where localStorage refuses writes), stores it or removes the key when empty, logs it once it settles, and dispatches `mapSettings:updated` with `{ key, value }` |
| `useMapSettingValue(key, fallback)` | The hook for a string setting |
| `systemPrefersReducedMotion()` / `useSystemReducedMotion()` | The OS's `(prefers-reduced-motion: reduce)`, read once / as a hook that follows its `change` event |
| `useMotionSetting(key)` | `disableIdleRotation` or `disableEventCamera` in force: the player's switch, or the OS's reduced motion (GlobeEffects, the event camera in `time.jsx`) |
| `reduceMotionEnabled()` | The whole **Reduce motion** switch in force — both motion switches on, or the OS's reduced motion — read when the ownership sweep would start (Nations.jsx), which it skips |

Boolean settings are stored as `"1"`/`"0"` strings; string settings as the value itself, absent when empty. The custom `mapSettings:updated` event is the cross-component sync mechanism — any `setMapSetting` or `setMapSettingValue` call updates every subscriber in the same document. `LABEL_FONT_SUGGESTIONS` is the list the label-font pickers offer.

While the OS asks for reduced motion, the game behaves as if **Reduce motion** were on — no idle globe spin, no event camera, no ownership sweep — whatever is stored; Settings shows the three switches on, held there, with "On, following your system setting for reduced motion." The stored values are left alone, so turning the OS setting off gives back the player's own.

---

## Diagnostics log — `src/runtime/debugLog.js`

The log a player sends with a bug report: **Settings → Advanced → Diagnostics → Copy log / Save as file**. It answers the question the per-incident buttons cannot — *what sequence of things did they do?* — because the packaged desktop app binds no developer tools, so the console every failure was already being written to is unreachable to the people filing the reports.

The per-incident buttons — beside the timeline's fallback warning (`GameUI/time.jsx`), the advisor's error bubble and its board-update warning (`GameUI/advisor.jsx`) — save **this log** as a file: **💾 Save logging file** (`runtime/saveDebugLog.js`). They used to copy only the one failure, and that paste was what reached Discord, without the log around it. The failure's own details — for a fallback the reason, the requested range, the queued actions, and the raw model response the log's entries are too short to hold — go in a `-- Reported problem --` block between the header and the entries, passed as `buildLoggingFile({ incident })`. It is added when the file is built, not logged as an entry, so it is never clipped, never rolled off by the size cap, and still there with logging off. Fields the header already states (provider, model, polity, difficulty, round, game date) are dropped when they match it and kept when they differ.

Two fallbacks. **With logging off** the buttons go back to copying the failure alone under their old labels ("Copy debugging message", "Copy for a bug report"), with the header's context lines added (`buildIncidentReport`), and switch back live if logging is turned on. **In the Android app**, whose WebView cannot save a file, the full log is copied to the clipboard instead and the button says so; Settings' Save as file does the same.

### One log, one file: the Desktop log merged in

On desktop, the app's Electron process and its local server see things the page never can — a launch that failed before the page existed, an update that did not take, a server error — and they cannot reach the page's storage. So they write their own entries to the **Desktop log** (`server/logStore.js`, below), and the **Logging file** merges those entries into the page's by time. The player sends one file; each entry is stored **once**, by whoever saw it, in the place that writer can reach. The page never writes to the Desktop log.

Every way out goes through `buildLoggingFile({ incident })`: Settings' Copy and Save, View log, and every failure button.

* **Span.** Desktop entries from the page log's oldest remaining entry (else this page's start) until now. The page log survives reloads and restarts, so a launch that failed between two good ones — written only to the Desktop log, because the page never loaded — lands in the file. That is what makes the "could not start" dialog's "the full error is in the diagnostics log under Settings" true.
* **Sources.** Only the Electron process's (`main`, shown as `[desktop app]`) and the server's (`server`) entries. Older builds also had the page copy its entries and whole AI prompts into the Desktop log; those are never read back.
* **Each desktop entry** is trimmed to the same per-entry limit as a page entry in the current mode, folded when repeated exactly as page repeats are, and redacted with the full page redactor — including this device's stored keys, which the server and the Electron process cannot see. This is the choke point for everything that leaves the machine.
* **Size.** The header and the log get **1 MB** (`LOG_SECTION_MAX_CHARS`), about a third of a 1M-token context window, leaving the rest for reading the code; past it, the oldest entries are left out first and the header says how many. The reported problem comes **on top** and is not cut — it is what the player pressed the button about, and a normal one is a few kilobytes — unless it would take the whole file past **2 MB** (`LOGGING_FILE_MAX_CHARS`). Then it is cut in the middle, keeping its start and end (where a raw model response shows what it was and where it broke), with a line saying how much was cut.
* **Header.** States the Desktop log's status: `included (N entries …)`, `unavailable` (the request failed or timed out — the file is still made), or `none on this platform` (web and Android, whose in-browser API answers `/api/log` with a 404).
* **Fetching** (`fetchDesktopLog`) waits at most 2 s, so a dead server never holds the save and the save or copy still counts as the player's click.
* **Phones and LAN browsers** are served their page by the host, so the read reaches the host's Desktop log with no extra plumbing, and their file carries the host's errors.

### Game settings in the file

A report needs settings two ways, and gets both:

* **Every change, as it happens**, as a `setting` entry in words — "3D Globe turned on.", "Basemap set to World Imagery.", "Gemini model set to gemini-3.5-pro." — through `logSettingChange(label, value, { settle })` (or `logSettingMessage` for a line of its own wording). Fields that save on every keystroke (model names, per-task models, the endpoint, custom parameters, the label font) pass `settle`, so the line is written once the value has been still for 1.5 s, not once per keystroke.
* **Every setting's value as the file is saved**, in a `-- Settings when this file was saved --` block after the header, by section: Display, Map, AI, This save, Network, Diagnostics. A switch flipped before the log's span, or never touched, is in no log — and "was X on?" is the first question a report gets. `src/runtime/settingsLog.js` registers one reader per section (`registerSettingsSnapshot(section, read)`), each reading through the getter its owner already exports; `buildLoggingFile` calls them all as it builds the file (async ones — the server's LAN setting — within the same 2 s as the Desktop log), and a reader that throws says `(could not be read: …)` rather than vanishing. It is imported by `src/main.jsx` at boot, so the block is there however the file is saved.

Labels match the Settings panel word for word; `diagnosticsLogGuard.test.js` fails if a switch in the panel is missing from the snapshot. What a line may say is decided per setting: an API key is only ever `set` / `not set` (a change: "set" / "cleared"), custom parameters only their size (they can carry headers), an endpoint only its host (`endpointHostForLog`) — the path, the query and any URL credentials can carry a token. Everything is redacted again as the file is built.

Where changes are logged: `mapSettings.js` (every switch, the basemap and the label font), `providerConfig.js` (provider, every provider field, reasoning, AI profiles saved/updated/deleted), `GameUI/main.jsx` (Fullscreen, 3D Globe, 3D Terrain), `settings.jsx` (both languages, telemetry and ratings — `telemetry.js` imports nothing on purpose — and LAN sharing), `debugLog.js` (its own two switches).

**View log** (Settings → Advanced → Diagnostics, `DiagnosticsLogViewer` in `settings.jsx`) lists `getLoggingFileEntries({ desktop })`: the same entries the file holds, newest first, each with `problem` for the problems-only filter (page `error`/`warn`/`crash` entries, any page entry logged with `{ problem: true }` — a failed AI task — and desktop `error`/`warn` levels). It replaced the Cheats panel's old "Diagnostics Log" tool, which read only the Desktop log.

### Two settings, both persisted

Both live in `localStorage`, which is what makes them survive closing the app: the desktop build keeps its Chromium profile between runs, so a choice holds across restarts, save switches and new campaigns. Neither is stored in a save file — the choice is about this installation, not this campaign, and a save copied between machines must not carry someone else's logging preference. **Absent means default, and the two defaults differ, so the keys read differently on purpose.**

| Setting | Key | Default | Off/on means |
|---|---|---|---|
| Logging | `oh_debug_log_enabled` | **ON** (absent or anything but `"0"`) | Off: nothing is recorded, and the stored log is deleted — on the host machine, the Desktop log too — see below |
| Detailed logging | `oh_debug_log_verbose` | **off** (absent or anything but `"1"`) | On: the `{ verbose: true }` entries are kept, and every entry keeps far more of itself |

Both are cached in module state rather than read per entry — `logDebugEvent` runs in the hot path of a turn and of every console call the game makes — and primed at module load, so the very first entry (logged from `src/main.jsx` before anything mounts) already obeys a saved choice. `setDebugLogEnabled` / `setDebugLogVerbose` write through the cache.

**Turning logging off also clears what was collected**, storage included, and the toggle's helper text says so. A player switching this off is saying they would rather the game did not keep this; leaving the last session's log in storage would ignore half of that, and it would go on occupying the storage budget for a feature they just declined. `persistNow` refuses to write while disabled, so a stray flush (pagehide, the error boundary) cannot put the key back afterwards.

It also sends `DELETE /api/log`, which removes the Desktop log and every rotated file — **on the host only**: the server refuses any non-loopback caller, so a phone's switch covers the phone's log and never reaches into the desktop's files. The refusal, and the web and Android builds' 404, are ignored. The desktop app and the server go on noting their own start-up and server errors afterwards — never campaign text — and the Settings text says exactly that. Nothing else ever deletes the Desktop log: an upgraded install's old files (which can hold whole prompts written by older builds) stay until the player turns Logging off on the host, and the Logging file never reads them.

### What is recorded

Two sources:

1. **Explicit `logDebugEvent()` calls** at the milestones a report needs. Every one is listed under "Hook sites" below.
2. **Everything the game already logged.** `installDebugLogCapture()` wraps `console.warn`/`console.error` (plus `console.log`/`console.info`, verbose-only) and listens for `error` / `unhandledrejection` on `window`. The originals are still called, so a developer with DevTools open sees exactly what they saw before. A caller that writes to the console something it has already logged properly wraps the call in `withConsoleCaptureMuted` — the error boundary does, so a render crash appears once, as its `crash` entry.

Detailed mode is expressed at the call site as a fourth argument — `logDebugEvent(cat, msg, detail, { verbose: true })` — and gated at the top of `logDebugEvent` rather than by an `if` around each call, so a hook cannot drift out of sync with the setting. It also raises what each entry keeps: `MAX_DETAIL_CHARS` 600 → 20,000, and error stacks 1 frame → 8.

### What is never recorded

**API keys**, **the player's home folder**, and **whole AI prompts**.

`redactSecrets()` runs over the message and detail of every entry **on the way in**, so a key is never even held in the buffer (the category is always a literal at the call site). It runs before either is cut to the entry limit, so a key the cut runs through is not left half there. It runs again over anything pushed into the context and over every Desktop log entry as it enters the Logging file. Two passes:

* **Literal.** Every value in `localStorage` under a key ending `_api_key` / `_token` / `_secret`, matched by suffix so a provider added later is covered without anyone remembering to come back — and every `apiKey` field inside a stored list whose key ends `_connections` or `_presets`, which is where `Game/AI/providerConfig.js` keeps its Connections (and the profiles before them kept theirs). Values under 8 characters are skipped — they are not keys, and treating them as such would redact half the log. Only entries with those names are read (the name is tested first, so the log's own megabyte and the translator's cache are never copied out per entry), and their values become one alternation, longest first so a key that begins with another is redacted whole, rebuilt only when one of those entries changes. This is the only pass that can catch a self-hosted gateway key, which may be any string at all.
* **The shared rules** (`server/logRedaction.js`, `redactLogText`), the same ones the Desktop log's writers use, so no writer can miss a shape another catches. Key shapes: `sk-…`, `sk-ant-…`, `pk-`/`rk-`, `AIza…`, `hf_`/`gsk_`/`xai-`, GitHub `gh?_` tokens, `Authorization: Bearer|Basic …`, `api_key`/`token`/`password`/`secret` in a dumped object or query string, URL userinfo (`http://user:pass@host` → the host survives, the credentials do not), and JWTs. And the **home folder** — `C:\Users\<name>`, `/Users/<name>`, `/home/<name>`, with a Windows path's backslashes single or JSON-doubled — becomes `~`, keeping the path after it. The server and the Electron process also replace their literal `os.homedir()`.

Provider and model **names** are in the header on purpose — the model is the most useful line in an AI bug report and is not a secret. Campaign text is kept to titles, ids and counts: a log a player will paste in public beats a complete one they will not.

Whole prompts are replaced by the **prompt fingerprint** (detailed mode only, below): a jump's prompt alone could fill the file, and it can be rebuilt from the save.

### Buffer and persistence

| Constant | Value | Why |
|---|---|---|
| `MAX_LOG_CHARS` | 1 MB, both modes | **The real governor**, and the Logging file's own size, so the log never holds more than a report can carry. The modes differ in *what* they record, not how much they keep; a normal log just reaches much further back. It used to be 192 KB for a normal log, which on a busy campaign reached back barely an hour |
| `MAX_ENTRIES` | 5000, both modes | A ceiling on a quiet session |
| `MAX_DETAIL_CHARS` / `_VERBOSE` | 600 / 20,000 | Per entry, for the message as for the detail (the console capture passes a warning's whole first argument as the message). A truncated one keeps `… (+N chars)`. A clipped stack trace or model response is usually worth nothing, which is what detailed mode is for; 20k clears a long advisor answer whole |
| `STACK_FRAMES` / `_VERBOSE` | 1 / 8 | One frame is where it threw; the rest is React internals nine times out of ten |
| `MAX_STORED_CHARS` | 1200 KB | Backstop on the *serialized* form only, for when the JSON scaffolding costs more than `entryCost` estimated |
| `COALESCE_WINDOW` / `COALESCE_MS` | 25 entries / 60 s | Repeat collapsing (below) |
| `PERSIST_DEBOUNCE_MS` | 800 | A busy turn logs a dozen entries a second; a synchronous write per entry is a jank source |

localStorage is a ~5 MB budget per origin, shared with the translator cache and every setting; the log's budget is characters and Chromium stores UTF-16, so a full log is ~2 MB of it. The cost that grows with the budget is the background save, which rewrites the whole buffer: measured in Chromium (Electron, desktop hardware) at ~5 ms for a full 1 MB log, 6 ms at worst — inside one 60 fps frame. If that ever stops being true on real players' machines, the normal budget is the one to shrink (the spec's fallback is ~200 KB); moving the log to IndexedDB is the larger fix.

**Trimming (`trimToBudget`).** The buffer is bounded by **size**, not only by entry count, and drops its **oldest** entries until it is inside both ceilings — oldest-first because a report is read for what led up to the problem and the problem is at the end. `usedChars` is maintained incrementally (`entryCost` = message + detail + category + gameDate + ~120 chars of JSON scaffolding) rather than recomputed, because trimming runs on every entry and re-measuring a 5000-entry buffer each time is how a bad network becomes a frame-rate problem. Entries go one at a time, so a full log keeps as much history as it can hold. `droppedEntries` counts what went, and the report says so — "the log starts at 11:42 with no explanation" and "the log dropped 900 entries to stay under the cap" are very different things to a reader.

**Repeat collapsing.** An entry identical (category + message + detail) to one in the last `COALESCE_WINDOW` entries and within `COALESCE_MS` bumps that entry's `repeat` counter instead of appending; the report renders `(×48, last 10:50:58)`. Without this a dead basemap host evicts the whole campaign from the buffer — measured at ~100 entries in six seconds with the network down. It scans a window rather than only the previous entry because storms interleave (maplibre's `AJAXError` alternating with our own fetch rejection), which consecutive-only matching would collapse neither of. Desktop log entries are folded the same way as the Logging file is built.

**Persistence.** Mirrored to `localStorage` under `oh_debug_log_v1`, restored on the next boot behind a `— page reloaded —` separator, and flushed on `pagehide` and from the error boundary before its Reload button. The crash that killed the page is the whole point, and an in-memory buffer dies with it. Every storage access is wrapped: quota exceeded, private mode and disabled storage all degrade to an in-memory-only log rather than breaking the game.

### API

| Export | Purpose |
|---|---|
| `installDebugLogCapture()` | Once, at boot (`src/main.jsx`), before anything else runs. Restores the previous session (unless logging is off), wraps the console, binds the global error hooks |
| `logDebugEvent(category, message, detail?, { verbose, problem }?)` | The only way in. `detail` is flattened (Errors keep name + message + stack frames; objects are JSON; circular does not throw) and truncated, and so is the message. `verbose: true` marks an entry as detailed-mode-only; `problem: true` keeps it under View log's "problems only" whatever its category |
| `withConsoleCaptureMuted(run)` | Runs `run` with the console capture off, for a line already logged properly — the error boundary's own console line, and React's report of every caught error (`onCaughtError` in `src/main.jsx`), so a render crash is one entry |
| `isDebugLogEnabled()` / `setDebugLogEnabled(bool)` | The on/off switch. Turning it off clears the buffer, the stored copy, and (on the host) the Desktop log |
| `isDebugLogVerbose()` / `setDebugLogVerbose(bool)` | Detailed mode |
| `getDebugLogBytes()` / `getDebugLogLimitBytes()` / `getDebugLogDroppedCount()` / `formatLogSize(chars)` | Size reporting for the settings panel and the report header. `formatLogSize` renders anything under a kilobyte as `<1 KB`, never `0 KB` — beside a live entry count that reads like a broken counter. The panel's line is `N entries · X KB of 1024 KB`, and under it `N older entries dropped to stay within the limit` once the cap has rolled any off, read on the same `subscribeToDebugLog` tick as the count |
| `setDebugLogContext(patch)` | Merges campaign/build context for the report header. Redacted like everything else. The `Build:` line is `buildLabel(import.meta.env)` (`src/runtime/buildLabel.js`): `android <track> #<build>`, `web <deploy id>`, `dev` or `desktop/local`; the desktop app refines it to `desktop #<build id>` once its server's `/api/app-update` reply names it (`AppUpdateBanner.jsx`) |
| `buildLoggingFile({ incident }?)` | **The Logging file**: fetches the Desktop log and builds the report. What every button uses |
| `fetchDesktopLog()` | `{ status: "included" \| "unavailable" \| "none", entries }` from `GET /api/log?since=<span start>`. Never throws |
| `buildDebugLogReport({ incident, desktop }?)` | The plain-text file from what is passed in — header, reported problem, entries oldest-first, sized as above. Text, not JSON: it is going into a Discord message or a GitHub issue |
| `getLoggingFileEntries({ desktop })` | The file's entries, newest first, with `problem` — for View log |
| `debugLogFilename(tag?)` | `open-historia-log-<ISO stamp>[-tag].txt` |
| `clearDebugLog({ silent })` | Empties it. The player path leaves a "cleared" note so a gap never reads as lost entries; `silent` is for the tests |
| `flushDebugLog()` | Persist now, skipping the debounce |
| `getDebugLogEntries()` / `getDebugLogSize()` / `getDebugLogContext()` | Reads |
| `subscribeToDebugLog(listener)` | Returns an unsubscribe. Drives the entry count in the settings panel |
| `logSettingChange(label, value, { settle }?)` / `logSettingMessage(key, message, { settle }?)` | A setting change as a line: a boolean "turned on/off", anything else "set to"; `settle` waits for a typed value to stop changing |
| `registerSettingsSnapshot(section, read)` | Adds a section to the file's settings block; `read` returns `[label, value]` pairs (or a promise, or null to leave the section out). Returns an unregister |
| `redactSecrets(text)` | Exported for the tests; called internally on every entry |

### Hook sites

Always recorded:

| Where | Category | Records |
|---|---|---|
| `src/main.jsx` | `app` | Boot, build channel, browser language |
| `src/runtime/library.js` | `game`, `api` | Active-game switches (and the header's campaign block), game creation, deletion, and **every** failed `/api/library`, `/api/games`, `/api/scenarios` call — the path and the server's message, never the request body |
| `src/runtime/assets.js` | `save` | **Failed** `writeJson` — world, game, actions, events and chats all persist through there, so a failure is the campaign not reaching disk. It previously threw into callers that only surface it as a toast |
| `src/Game/GameUI/time.jsx` | `turn` | Jump/auto-jump start, finish (with elapsed seconds, event count, source), **fallback with its reason**, cancel, undo; keeps the in-game date and round in the context |
| `src/Game/GameUI/actions.jsx` | `action` | Orders queued (manual and from suggestions) and removed |
| `src/runtime/mapSettings.js` | `setting` | Every map/AI/experimental toggle, by its UI label; the basemap and label font |
| `src/Game/AI/providerConfig.js` | `setting` | Provider switches, every provider field (model, per-task models, key set/cleared, endpoint host, custom-parameter size, structured output, strict tool schema), reasoning toggle, AI profiles; syncs provider + model into the header |
| `src/Game/GameUI/main.jsx`, `settings.jsx` | `setting` | Fullscreen, 3D Globe, 3D Terrain; UI and chat language, telemetry, ratings, LAN sharing |
| `src/Game/AI/gameplay.js` | `ai` | **Every AI task that failed**, with its reason and the error (and whether it was aborted), marked as a problem |
| `src/runtime/ErrorBoundary.jsx` | `crash` | Render crashes with the first frames of the error's stack and of the component stack, then flushes. The crash screen's **Save logging file** button (`useFailureReportButton`, copy when logging is off) attaches both stacks whole (`buildRenderCrashIncident`) |
| `window` / `console` | `crash`, `error`, `warn` | Uncaught errors, unhandled rejections, and everything the game already logged |

Detailed mode only (`{ verbose: true }`):

| Where | Category | Records |
|---|---|---|
| `src/Game/AI/gameplay.js` | `ai` | Every task: start (prompt/user-message sizes, tool name, timeout), **a prompt fingerprint per attempt**, each attempt's answer (size, tool-call or prose, elapsed), **each rejection with its validation error and raw response — including retries that then succeeded**, which attempt won, and salvage |
| `src/runtime/library.js` | `api` | The calls that *worked*: method, path, status. The duration goes in only past 1 s — the game polls every 5 s, and a per-call millisecond figure would make each poll unique and defeat the repeat collapsing |
| `src/runtime/assets.js` | `save` | Every successful save with its byte size. Growth is the point: a `world.json` climbing past a megabyte makes every turn slower and is invisible in any single entry |
| `src/Game/GameUI/time.jsx` | `turn`, `ui` | Per-turn world changes (event titles plus a count for every impact array in `EVENT_IMPACT_KEYS` — region transfers, control ops, claims, group ops, polity changes, political actor ops, institution ops, unit/marker/spy/project ops, chats, reports, resolved orders — and the unit and project totals) — this is what exposes a turn that narrates a conquest while moving no borders. A wartime capture or occupation is a control op, not a transfer, so a correct occupation turn logs `regionControlOps` beside `regionTransfers: 0`. Plus timeline panel navigation |
| `src/Game/GameUI/main.jsx` | `ui` | Which panels are open, as one effect over every panel flag rather than a call per handler — these panels are opened from a dozen places and per-handler calls would miss most of them |
| `console` | `log` | `console.log` / `console.info`, the game's routine chatter — noise in a normal report, running commentary in a detailed one |

**Prompt fingerprint** (`buildPromptFingerprint`, `src/Game/AI/contextDiagnostics.js`). For one structured AI attempt: the size and an 8-hex-digit FNV-1a hash of the whole system prompt, the prompt template, the instruction, the conversation history (with a message count), and every filled-in section by variable name. No text. Rebuild the prompt from the save, fingerprint it, and a mismatch names the section that differed. Only computed while detailed mode is on.

Tests: `src/runtime/debugLog.test.js` (redaction, buffer, coalescing, report, both switches and their persistence, the size budget, the Desktop log merged into the Logging file, and the settings block and settled change lines), `src/runtime/diagnosticsLogGuard.test.js` (the page never writes to the Desktop log; no whole prompts; every Settings switch is in the snapshot), `src/Game/AI/providerConfig.test.js` (provider changes logged, a key never), `src/Game/AI/contextDiagnostics.test.js` (the fingerprint).

---

## Desktop log — `server/logStore.js`

One append-only JSONL file, `<data dir>/logs/app.log` (rotated 5 × 5 MB: `app.log.1` … `app.log.4`), where the desktop app's **Electron process** (`source: "main"`, written directly by `electron/main.cjs` because it runs before the server exists) and the **server** (`source: "server"`, every API failure through `sendError`) write their own entries. It lives under the writable data dir (`server/dataDir.js`), beside the saves: `server/data/logs` for the zip, the Electron userData dir for the installed app, the sandbox path on Android.

It is **not a second log** — its entries appear in the Diagnostics log's Logging file, merged by time (above). The page never writes to it; older builds had the page copy every entry and the AI layer write whole system prompts here, regardless of the player's switches.

| Export / route | Purpose |
|---|---|
| `appendLog(entry)` | `{ level, source, event, message, data? }`. Redacted (`redact` → the shared rules plus this machine's literal home folder), clipped, appended; rotates first. Never throws |
| `readLogSince(since)` | The `main` and `server` entries at or after `since` (ISO), oldest first, reaching into the rotated files when the span goes back that far (a file last written before `since` is skipped). Redacted again on the way out, which covers what older builds and the Electron process wrote. Each entry's `data` is clipped to 20,000 chars and the whole read to ~1 MB, newest kept — the Logging file could not use more |
| `clearLog()` | Deletes `app.log` and every rotated file. Never throws |
| `GET /api/log?since=<ISO>` | `{ entries }` — `readLogSince`. Readable by any device that can reach the server: in practice the host player's own phone, whose report should carry the host's errors |
| `DELETE /api/log` | `clearLog()`, **loopback only** (403 otherwise, not through `sendError`, which would log the refusal into the log). Sent when the player turns Logging off |

The Electron process's writes use the same rules through `require()` of `server/logRedaction.js`; an older Electron whose Node cannot `require()` an ES module falls back to replacing the home folder only, and everything is redacted in full again as it is read back.

Tests: `server/desktopLog.test.js` — the store against a throwaway data folder, and the routes on a real server in a child process (including a LAN caller being refused the clear).

## World lookups (`worldLookups.js`)

A world cannot change during one synchronous read of it, yet building an AI prompt asks it the same whole-world questions thousands of times: `getPoliticalProfile` read every region's owner for each name it could not place, and each government's capsule rebuilt the power reference and normalized every institution. On the modern world that froze the page for half a second on a fast computer.

`readingWorld(world, read)` marks such a read, and inside it `lookedUp(world, question, work, key)` keeps each answer. `buildBoundedPoliticalDecisionContextSet` is one, so turns and the idle pulse share it.

- **Outside a read nothing is kept.** Worlds are edited in place between reads (`gameState.js`), so an answer must never outlive the read that asked. This is why `normalizeWorldState` is not cached by object.
- **`read` must be synchronous and must not change the world.** Never wrap anything that writes to it.
- **Answers are shared objects.** What is kept with `lookedUp` must only be read by its callers.
- **Another world is never answered from this one's:** the world is compared by identity.

To check a change here, compare what the builders say on every real save before and after, byte for byte (`server/data/games/`). The idle pulse also hands `nextTask` to `buildTemplateVariables` as `pause`, so the map draws between its stages; nothing else passes it, and a turn builds as it always did.
