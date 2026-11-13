/*! Open Historia — what each update brings, as the notice behind the vault door tells it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "because the vault door only appears after updates by default now, behind it
// there should be a notice pupup thing announcing the new update and what it
// adds (for minor updates it can be very bland, for major updates it must be
// beautiful, complex and decorated)"; "it should also be custom themed for
// each major update. make it easy to add a custom detailed update thing (and
// animated at times) so its not a hassel to add in the future"; "not every
// update will be in the war theme, there will be a very complex variety. make
// it so it also supports multiple update banners that you can click next
// arrows to see the others if multiple major things are done at once" (the
// owner, 2026-10-15).
//
// EVERY CHANGE PLAYERS WILL NOTICE SHIPS WITH ITS NOTICE HERE, written by
// whoever makes it, unprompted (AGENTS.md; the full guide, with examples:
// docs/update-notices.md).
//
// HOW TO ADD AN UPDATE'S NOTICE
//
//   1. Put an update at the TOP of NEW_UPDATES below (newest first), with an `id`
//      that is new and never reused. A device is shown each update once
//      (updateNotices.js); one that missed several is shown all it missed.
//   2. Give it one BANNER or several: several are paged with arrows (one for
//      each big thing the update does). A banner is the words of one page.
//   3. A MINOR update's banner: a title and a few `items`. It is shown as a
//      plain card (UpdateNotice.jsx MinorBanner); nothing else is needed.
//   4. A MAJOR update's banner: a title, a `lead`, `sections` of items. With no
//      `theme` it is shown in the decorated default (DefaultBanner), coloured
//      by its `palette`. With a `theme`, by that theme's own component: copy
//      themes/ThemeTemplate.jsx to themes/<Name>.jsx, name it in
//      themes/index.js with its chrome (how the arrows, markers, Skip and the
//      button between its pages look), and build it from the kit
//      (updateKit.jsx). A theme may
//      draw several kinds of page, told apart by the banner's `scene`. A theme
//      is loaded only when one of its banners is shown.
//   5. To look at it while making it, open the game with
//      ?updateNotice=<the update's id> (or ?updateNotice=latest): it is shown
//      at once, door or no door, and not remembered as seen.
//
// The words are the player's: plain, and what the update does for them. They
// go into the interface catalog with every other string (public/lang).
//
//   update   { id, kind: "major" | "minor", date: "YYYY-MM-DD", channel?: "alpha" | "beta", banners: [banner] }
//   banner   { title, subtitle?, lead?, theme?, scene?,
//              palette?: { accent, ink, soft, ground, card, buttonInk },
//              items?: [text],                          (a minor update's lines)
//              sections?: [{ heading, icon, items: [text] }],
//              button? }                                (on the last banner: closes)
// `icon` is one of updateKit.jsx ICONS.

import { PAST_UPDATES } from "./notesPast.js";
import { RELEASES } from "./notesReleases.js";

// The updates since the notice existed, newest first (new ones at the top); with the past (notesPast.js) they
// make UPDATES, newest first by date.
const NEW_UPDATES = [
  {
    // A player, 2026-11-13: "why was the retry button not pressed by itself, without waiting for us?" A month's skip
    // on a local model had been held on one unanswered order for as long as nobody was at the screen.
    // AI/gameplay.js simulateTimelineJump, AI/playerTurnFailures.js retriesUnasked.
    id: "2026-11-retry-my-events-unasked",
    kind: "minor",
    date: "2026-11-13",
    banners: [
      {
        title: "A skip can retry your failed events before it asks you",
        items: [
          "Settings → AI has a new switch, \"Retry my failed events once before asking\", off by default. With it and \"Stop when my events fail\" on, a skip that would stop on your failed events first asks once more for them by itself, and shows its notice only if some still failed.",
        ],
      },
    ],
  },
  {
    // A player, 2026-11-13: a month's skip on a local model was held on four failed orders, and each "Retry the failed
    // events" took five minutes and carried out one. The retry was sent the whole-period wording ("between 1 and N
    // events") under its list, and six rounds of lookups first. AI/jumpSegments.js buildSegmentInstruction (amend),
    // AI/playerTurnFailures.js retryMadeProgress, AI/gameplay.js retryHeldPlayerEvents.
    id: "2026-11-held-orders-retry",
    kind: "minor",
    date: "2026-11-13",
    banners: [
      {
        title: "Retrying your failed orders finishes the job",
        items: [
          "\"Retry the failed events\" on a held turn now asks for exactly the orders that were left, and asks again by itself while each answer carries out more of them. A model that answered one order at a time used to send you back to the notice after each one.",
          "That retry no longer looks anything up first: the period is already written, and on a local model the lookups were most of its five minutes.",
        ],
      },
    ],
  },
  {
    // "remove the reccomended thing from command code on the popup when you start a game and dont have a configured key"
    // (the owner, 2026-11-10): GameUI/apiSetupPrompt.jsx ChoiceCard has no recommended badge or highlight.
    id: "2026-11-setup-choices-alike",
    kind: "minor",
    date: "2026-11-10",
    channel: "beta",
    banners: [
      {
        title: "The AI setup shows its three choices alike",
        items: [
          "Command Code is no longer marked as recommended in the AI setup that opens when you start a game without a key.",
        ],
      },
    ],
  },
  {
    // "make it be 7 days" (the owner, 2026-11-10): runtime/fronts/constants.js STAFF_STORY_ORDER_DAYS 45 -> 7; and the air line
    // says when the sky is held by fewer but stronger wings (fronts/brief.js skyStrongerNote, air.js skyHeld counts only wings with strength).
    id: "2026-11-commanders-change-course",
    kind: "minor",
    date: "2026-11-10",
    channel: "beta",
    banners: [
      {
        title: "Commanders change course sooner",
        items: [
          "A country nobody plays keeps an order the story gave its front for a week, then its own commanders may change course.",
          "A side that holds the sky with fewer wings than the other is told as holding it with fewer but stronger ones, and worn-out wings are no longer counted.",
        ],
      },
    ],
  },
  {
    // "why does fighting the war take 60 seconds ... the whole thing about fighting in brest never happened"; "now ive
    // captured berlin and the game is still talking about things that happened historically"; "make it so the war
    // engine makes other countries reinforce more" (a player, 2026-11-10). runtime/fronts/brief.js lineGeography,
    // AI/frontTurn.js frontPlaceTold, frontReportEvents and checkContests, runtime/fronts/engine.js staffCallUp,
    // runtime/fronts/climate.js yearOf, AI/frontPrethink.js prethinkLengths.
    id: "2026-11-fronts-and-story-agree",
    kind: "minor",
    date: "2026-11-10",
    channel: "beta",
    banners: [
      {
        title: "The war and its story agree",
        items: [
          "The story is told where each front runs and who holds whose land, so a war that has turned against history is told where it is really fought.",
          "A captured city appears on the map with the event that reports it. Where no event names it, the war reports it itself.",
          "A region far behind the front line is no longer left contested, and a side can only contest ground it can reach.",
          "Countries nobody plays call up fresh troops when their line is thin or they lose ground, and most of all when their capital is at stake. A country that has lost its capital fights to take it back.",
          "Long skips fight their war faster, and while you read, the next period is worked out for the longer skips too.",
        ],
      },
    ],
  },
  {
    // "readd the idle diplomacy setting so you can disable it (no more limiting it tho, it should be unlimited if its
    // enabled)" (the owner, 2026-11-09): MAP_SETTING_KEYS.idleDiplomacy in Settings → AI → AI requests, and
    // requestBudget.js UNCAPPED_BACKGROUND_TASKS keeps idle diplomacy out of the background daily cap.
    id: "2026-11-idle-diplomacy-switch",
    kind: "minor",
    date: "2026-11-10",
    channel: "beta",
    banners: [
      {
        title: "Turn off countries writing to you",
        items: [
          "Settings → AI → AI requests has a new switch, Countries write to me between time skips. Turn it off and no country writes to you between time skips unless you write first.",
          "While it is on, countries writing to you no longer count toward the 30 background requests a day, and are no longer stopped by them.",
        ],
      },
    ],
  },
  {
    // A world event filed "Not recorded: the game could not tell it was your government's order" (a player, 2026-11):
    // nativeWorldIntegrity.js reads whose choice an event is from its actors, records and operations, never its words.
    // Scripted events: worldDirection.js applyTerritoryTempo, AI/scriptedEventImpacts.js (the fallback's impacts), and
    // a refused dissolution in the receipt (receiptPlayerNotes.js dissolutionRefusedNote).
    id: "2026-11-world-events-and-scripted-beats",
    kind: "minor",
    date: "2026-11-10",
    channel: "beta",
    banners: [
      {
        title: "World events stay, scripted events take effect",
        items: [
          "A world event that mentions your country is no longer thrown out as a decision of your government's. Only an event that has your country act is checked against your orders.",
          "A scripted event's map changes happen in full, even in a scenario that limits how fast the map may change.",
          "When a time skip falls back to stand-in events, a scripted event still makes the changes its author attached.",
          "When a country cannot be dissolved because its land was given to no one, the time skip's notes say so.",
        ],
      },
    ],
  },
  {
    // "why does it write all the events now before giving them to you instead of each event appearing as its written" (the owner,
    // 2026-11-10): AI/geminiAnswer.js asks a Gemini skip's lookups first and its answer as streamed text.
    id: "2026-11-gemini-live-events",
    kind: "minor",
    date: "2026-11-10",
    channel: "beta",
    banners: [
      {
        title: "Events appear as they are written again",
        items: [
          "On Gemini with lookup functions on, a time skip's events appear one by one as the AI writes them again, instead of all at once at the end.",
          "Those skips no longer waste a request on a first attempt Gemini refused.",
        ],
      },
    ],
  },
  {
    // "make it so in the scripted events there is a mini map thing so you can easily select regions for things instead
    // of needing to manually type out each one"; "upgrade the scripted events editor so there is an easy thing to add
    // Impacts yourself"; "make it so events can remove all claims on territory on a country" (the owner, 2026-11-09):
    // ScriptedRegionPicker.jsx, ScriptedImpactsEditor.jsx, server/scriptedImpacts.js, AI/scriptedEventImpacts.js.
    id: "2026-11-scripted-event-impacts",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Scripted events: pick regions and impacts on a map",
        items: [
          "Pick regions on a map of the scenario and their names go into a scripted event's text, spelled exactly as the map spells them.",
          "Add impacts to a scripted event or an outcome: regions changing hands, new countries, annexations, claims, occupations and new leaders. They happen on the map exactly as set when the event fires.",
          "An impact can remove every claim on a country's territory, or only one claimant's.",
        ],
      },
    ],
  },
  {
    // "it seems sometimes events to do with war aren't being represented on the map"; "Script Events ... seem to fail
    // transfer specifically named regions ... a polity isn't annexed or dismantled completely ... claims staying from
    // the dismantled polity" (players, 2026-11); "make it so events can remove all claims on territory on a country"
    // (the owner, 2026-11-09). regionMatch.js foldedRegionIndex, storyMarch.js, gameState.js dissolvedPolityLand,
    // claimsByCountry.js.
    id: "2026-11-map-changes-land",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "The map keeps up with the story",
        items: [
          "Regions named without their accents, like Chisinau for Chişinău, now change hands on the map.",
          "An army that takes one city can march on and take the next in the same turn.",
          "A country that is annexed and dismantled leaves nothing behind: its land, its troops and every claim it made.",
          "Events can clear every claim on a country's land at once, or one country's claims on it.",
        ],
      },
    ],
  },
  {
    // Francesco Inzerillo, PR #988 (ported to beta at the owner's word, 2026-11-09): a scenario's own statistics keep a
    // missing value missing (runtime/statIndexDefinitions.js readCustomStatNumber), never a zero.
    id: "2026-11-stats-missing-values",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [{
      title: "Missing statistics stay unknown",
      items: [
        "Unavailable values on a scenario's national sheet appear as a dash; recorded zeros remain visible.",
        "Historical charts leave gaps where observations are missing, and rankings include only recorded figures.",
        "Blank or invalid custom values no longer replace recorded figures with zero.",
      ],
    }],
  },
  {
    // "right now in modern day countries go by the kingdom of spain or the french republic, rename all these
    // countries by their more common names ... leave the us's name as it is tho"; "many countries are just gray for no
    // reason sometimes" (the owner, 2026-11-09): server/commonNames.js brings an older Modern Day world across once,
    // in both stores; ownerColors.js finds a country's colour under its other names.
    id: "2026-11-common-country-names",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Common country names in older Modern Day games",
        items: [
          "Older copies of Modern Day and the games started on them now call countries by their common names, like Spain and France.",
          "Countries no longer turn grey when the scenario's colour list does not name them.",
        ],
      },
    ],
  },
  {
    // "for themes, it themes the buttons themselfs but not the button tray. or the search button"; "it also doesnt
    // theme this" (the date bar) (the owner, 2026-11-09). The dock's tray, search, the date bar and the map-mode switch
    // read --oh-ui-glass-pill (chat.jsx Toolbar, search.jsx, time.jsx widgetSurface, MapModeSelector.jsx); the
    // Advisor's lines and highlights read --oh-ui-line/-hover/-active (advisorDossier.css).
    id: "2026-11-themes-reach-the-tray",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Themes reach the dock and the date",
        items: [
          "Your theme now colours the tray round the Chat, Actions and Rostra buttons, the search button, the date bar and the map-mode switch, not only the buttons on them.",
          "The Advisor's borders and highlighted rows follow your theme too.",
        ],
      },
    ],
  },
  {
    // "make it so you can minimize the standing goal and it is auto minimized when suggested actions are opened or
    // submitted actions are opened ... also make the actions tab resizable vertically" (the owner, 2026-11-09):
    // actions.jsx StandingGoal and PanelResizeHandle, actionsPanelLayout.js.
    id: "2026-11-actions-panel-room",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "More room in the Actions panel",
        items: [
          "The standing goal folds down to one line, and folds itself away when you open your suggested or submitted actions.",
          "Drag the top edge of the Actions panel to make it taller or shorter; double-click the edge for the usual height.",
          "The panel remembers both the next time you open it.",
        ],
      },
    ],
  },
  {
    // "make it so air transports work like train and boat except they can go over anywhere, but they can carry less
    // troops and there is a chance they can be intercepted (when over enemy territory but they can be deployed into
    // enemy territory) also make different transport types disableable in features and if a country has their
    // airforce or navy disabled by being set to zero they cant use those transports" (the owner, 2026-11-09).
    id: "2026-11-air-transport",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Troops by air",
        items: [
          "The War Room's Transport flies troops straight over land and sea to any place, into enemy land too, where they land and fight.",
          "An airlift carries fewer troops than rail or sea: 3 formations from 1936 and 6 from 1960, up to twice that with a strong air force.",
          "Over enemy ground the enemy's aircraft can intercept it, and part or all of the troops aboard are lost.",
          "Rail, sea and air transport each have their own switch under Wars in Features.",
          "A country whose navy is set to 0 cannot send troops by sea, and one whose air force is 0 cannot fly them.",
        ],
      },
    ],
  },
  {
    // "make the ai on medium mode be realistic about technological developments because a user was able to make mind
    // control nanobots in 2 months which makes no sense" (the owner, 2026-11-09): runtime/difficulty.js
    // DIFFICULTY_PRIORITY_COMMON, at every level.
    id: "2026-11-technology-at-its-real-pace",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Technology at its real pace",
        items: [
          "Inventions now take the science, industry, money and years of research they really would.",
          "An order to build something beyond your era's science gets early research, a long programme or a failure, not a working device within months.",
          "This holds at every difficulty: the level still decides how well a sound programme goes.",
        ],
      },
    ],
  },
  {
    // "only if the war is against the group. otherwise the group keeps its occupation", and "if someone is at war with
    // a group on territory they do not own, it should create another group there that takes the area from the group
    // without actually annexing the territory" (the owner, 2026-11-09): runtime/fronts/day.js settleRegions forceFor,
    // battle.js groupSideOf, runtime/groups.js `owner`. And a stray groupOps take naming a country no longer makes it a
    // group to the engine (AI/frontTurn.js runTurnFronts foundedGroups).
    id: "2026-11-group-occupation",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Wars across a group's ground",
        items: [
          "Ground inside a group's area is taken from the group only by a side at war with it: in any other war the group keeps its area there.",
          "A country at war with a group on another country's land takes that ground as a force of its own, a new group, and annexes nothing: the land stays that country's.",
          "That force's ground counts for its country in every war the country fights, so the battlefield against the group goes on across it.",
          "A time skip that named a country as if it were a group no longer turns that country's conquests into a group's area.",
        ],
      },
    ],
  },
  {
    // "make it so if there are multiple minor update annoucements, it merges them all into one changelog" (the owner,
    // 2026-11-09): several minor updates owed at one opening are one card (updateNotices.js noticePages).
    id: "2026-11-minor-changelog",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "One changelog for small updates",
        items: [
          "When you missed several small updates, they are now listed together on one card, newest first, instead of one card each.",
          "Major updates still open on their own pages first.",
        ],
      },
    ],
  },
  {
    // "why are all the agents that run after a time skip running now ... remove the stuff relating to those things
    // entirely" and "get rid of the background agent" (the owner, 2026-11-07). The Background AI switch went, with the
    // three requests after a skip: the Stats refresh of tracked countries, the event consolidator and the turn review.
    // What ran in the background stays, under a fixed cap ("dont remove idle diplomacy", "same with background spy
    // stuff", "also do the intelligence ratings, and stats and military figures written ahead of time").
    id: "2026-11-no-background-ai",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Nothing asked after a time skip",
        items: [
          "A time skip no longer makes requests after it: the automatic Stats refresh, the separate history summary and the after-skip checks are gone.",
          "Your campaign's history is still folded into its history document, inside the time skip itself.",
          "The Background AI switch is gone. What the game does while you are not pressing anything (countries writing to you, your agents' reports, first readings of a country) always runs, and stops at 30 requests a day, or sooner when less than a tenth of your day's requests is left.",
          "Historical tracking is gone from Stats: refresh a country's sheet from its own ↻ menu.",
        ],
      },
    ],
  },
  {
    // "in multiplayer you cant do diplomacy if you arent the host": a thread a player began from a country's panel,
    // the map, the advisor or the War Room was made up and saved on the player's own screen, where a shared game
    // saves nothing, and the host refused its first line ("You are not in that conversation"). The host had threads
    // of its own to fall back on; a guest had none. Such a thread now waits on the screen until its first line opens
    // it on the host (multiplayer/client/sharedThreads.js), and opens there once the host's view brings it back.
    id: "2026-11-shared-game-diplomacy",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Diplomacy for every player in shared games",
        items: [
          "In a shared game, a conversation you start from a country’s panel, the map, your advisor or the War Room now reaches the host, and the AI’s governments answer you in it. Players who were not hosting were told they were not in that conversation.",
          "Your first message opens the conversation, and it stays open on your screen for the answer.",
        ],
      },
    ],
  },
  {
    // The owner, 2026-11-09: "3d terrain and warfronts do not seem to work together, the war terrain is not 3d". A
    // battlefield's ground and the bare map put back under it are layers that draw themselves, which MapLibre does not
    // lay on the terrain as it does its fills: they were drawn at the sea's level, apart from the country round them.
    // The ground now draws into the terrain's own tiles (renderToTerrainTile, Map/frontGroundLayer.js); the bare map,
    // drawn where the ground cannot be, is lifted by the terrain's heights (Map/terrainDrape.js).
    id: "2026-11-battlefields-on-3d-terrain",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Battlefields on the 3D terrain",
        items: [
          "With 3D terrain on, a battlefield’s ground and its moving front now lie on the hills like the rest of the map, instead of sitting flat apart from it when you tilt the map.",
        ],
      },
    ],
  },
  {
    // "it looks like there are alot of issues involving wars with groups including issues with the dynamic borders and
    // duel occupied territory" (the owner), and a player at war with Türkiye who could deploy only in the west while
    // holding Syria (runtime/fronts/engine.js examineWar, landChanged, pairSideOf; runtime/fronts/warRoomOps.js
    // deployBattlefieldOf; AI/frontTurn.js planFrontMoments).
    id: "2026-11-fronts-on-every-border",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "A front on every border",
        items: [
          "A war fought along two borders far apart has a battlefield on each, including one the world had no room for until another war ended.",
          "Land handed over during a time skip opens its front in that same skip.",
          "A deployment line drawn over your war's other battlefield goes to that battlefield, and the War Room turns to it.",
          "A group's gains and losses move its front the day they happen, and a group that rises in a time skip takes ground as a group, never as a new country.",
          "A group in nobody's war no longer stops a war across the border it holds.",
        ],
      },
    ],
  },
  {
    // A player's report (2026-11-09): a war with the Netherlands went on six months after its peace, a bomber
    // squadron turned up on the equator, and a refitted carrier escort kept its old ships. The enemy may now take a
    // player's order of peace in the same skip, and a peace ends the war's twins (AI/warAndPeace.js); a lost place is
    // no lng 0, lat 0 (runtime/gameState.js finiteOrNull, runtime/unitMotion.js stepToward, AI/frontTurn.js
    // applyFrontUnitChanges); a strength op carries a refit's new composition (runtime/gameState.js normalizeUnitOp).
    id: "2026-11-peace-holds-fleets-refit",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Peace that holds, fleets that refit",
        items: [
          "When the enemy accepts your offer of peace in the same time skip that you made it, the war ends there and then, along with any second record of the same war.",
          "Aircraft and other forces whose destination was lost stay where they are instead of heading for the equator in the middle of the ocean, and no longer vanish from the map.",
          "A fleet refitted with new ships now lists its new ships when you click on it.",
        ],
      },
    ],
  },
  {
    // A player's 1973 save (2026-11-08): the fall of Saigon carried the Vietnam War's end and was refused as fighting
    // in a war already ended (AI/nativeWarLedger.js); the US player's own offer of peace was answered twice with the
    // war's end and both were refused (AI/playersWarsHold.js); the US withdrawal and the Khmer Rouge sieges were told as
    // history with no records (the war ledger's rules, AI/gameplay.js). And the owner's fallback log (2026-11-04): a
    // refused skip asked again was refused for want of a request (AI/requestBudget.js keepForRefusedSkip).
    id: "2026-11-wars-follow-the-story",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Wars end on the map when the story ends them",
        items: [
          "A war whose last battle ends it, such as a capital falling, now ends in the game too, instead of going on with its front still open.",
          "When you have offered peace and the other side ends the war in a time skip, your offer is accepted on its own terms instead of being thrown away.",
          "A country the story pulls out of a war now leaves it, so its troops stop fighting on the map, and events follow the game's own wars where they have parted from real history.",
          "A time skip the AI service refuses is asked again even when few requests are left for it, instead of ending in the stand-in events.",
        ],
      },
    ],
  },
  {
    // The owner, 2026-11-09: "the dont play music wind up when entering a game that is open is broken because if you
    // have an open game but then switch games it still doesnt do the wind up" (runtime/ambientMusic.js
    // reopensDrawnGame: only the game drawn last, and only when it is the one being opened; GameUI/main.jsx asks with
    // the game the library announced, gameLoadingScreen.jsx `opening`). A player, the same day: "in the Beta version,
    // every time I open a game, 'Translating to Arabic...' appears and never disappears" (runtime/translationModel.js:
    // every request to the worker ends, a dead worker is replaced, three minutes of silence give up; the worker answers
    // every load; translator.js: the pill only while the queue runs). Dated with the 2.5 release it is told in.
    id: "2026-11-music-and-translation-fixes",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Opening music and translation fixes",
        items: [
          "Opening another game than the one you had open plays the opening music’s build-up again: only going back into the game you left skips it.",
          "The “Translating to…” notice no longer stays on the screen for good when the translation model cannot start or stops answering: it goes once the translation is done or has given up, and says so when the model could not be loaded.",
        ],
      },
    ],
  },
  {
    // "lets find a way so people cant manually download scenarios from the workshop in github to inflate import counts"
    // (the owner, 2026-11-09). A post's first import on an install is reported to the import counter
    // (runtime/hubImportCount.js, tools/import-counter/worker.js): once per install, once a day per address, from the
    // game's own pages only. Downloads count nothing; what each post had is frozen as its starting number.
    id: "2026-11-imports-counted-in-game",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Import counts you can trust",
        items: [
          "A Community scenario's number of imports now counts the players who imported it in the game. Downloading its file from GitHub no longer adds to it.",
          "Every scenario keeps the number it had and counts on from there.",
          "The first time you import a scenario, the game tells our counter which one it was, and nothing that says who you are.",
        ],
      },
    ],
  },
  {
    // "bombing should be able to adjust the strike radius: smaller radii result in greater lethality, while larger
    // radii reduce the overall threat level" (the owner, 2026-11-09). runtime/fronts/airStrike.js strikeRadiusOf:
    // the bombs fall on a circle of the era's blast times the radius, each thing under them hit 1 / radius² as hard.
    // Then "make the bombing radius be a slider not buttons, and dont have it actually say how big it is, just the
    // visual circle" (the owner, 2026-11-09): a slider with no figure, the circle on the map the only measure of it.
    id: "2026-11-strike-radius",
    kind: "minor",
    date: "2026-11-09",
    channel: "beta",
    banners: [
      {
        title: "Set a bombing’s strike radius",
        items: [
          "Deploy Aircraft now has a slider for how wide a strike’s bombs fall.",
          "A tighter circle hits what is inside it much harder; a wider one reaches more, each a little less.",
          "No figure is given: the circle on the map grows and shrinks as you slide, and shows where the strike will fall and where it fell.",
        ],
      },
    ],
  },
  {
    // "make a major update annoucement for the whole ai optimization before I release it" (the owner, 2026-11-07).
    // It folds in the day's five minor notices, which had reached only the beta: time skips cost less (the prompt
    // budget, docs/prompt-budget.md: the cached opening, nothing sent twice, one-line digests, what the turn is about in
    // full, the history in tiers and its canon), related past events and older conversations kept on file
    // (AI/relatedEvents.js, AI/chatArchive.js), the AI setup's three choices (GameUI/apiSetupPrompt.jsx), My key has
    // no request limit (AI/requestBudget.js) and the limit on edited prompts (AI/promptGuidance.js). The savings: the
    // part of a skip a provider bills in full fell 39 to 54% on seven real saves, the whole request a median of 4%
    // (the free Gemini tier's request barely changed); the owner's words for it are "about half as much on providers
    // other than Gemini". The languages section recalls the 2026-11-06 work (Translate with my AI, scenario
    // languages, the 1,111-string sweep).
    id: "2026-11-ai-overhaul",
    kind: "major",
    date: "2026-11-07",
    channel: "beta",
    banners: [
      {
        theme: "aiOverhaul",
        scene: "skips",
        title: "Leaner Time Skips",
        subtitle: "Less to send, nothing forgotten",
        lead: "Time skips cost about half as much on providers other than Gemini (Claude, OpenAI, DeepSeek, Command Code and others), and long campaigns keep their history for good.",
        sections: [
          {
            heading: "Cheaper skips",
            icon: "gear",
            items: [
              "What never changes from skip to skip now opens the request, so after the first skip the AI service keeps it and charges much less for it.",
              "Nothing is sent twice, and older events go to the AI as one line each.",
              "On Gemini's free tier a request is about as large as before: the savings are on the other providers.",
            ],
          },
          {
            heading: "What the turn is about",
            icon: "eye",
            items: [
              "Each skip gives the AI in full your country, your neighbours, the countries most in the news or in dealings with you, every war and everything your orders name.",
              "The rest of the world goes in a line each, with its leader, its wars, its alliances and who holds its land.",
            ],
          },
          {
            heading: "A history that lasts",
            icon: "book",
            items: [
              "Your campaign's history is kept in tiers: the latest years in detail, older eras told more briefly.",
              "Treaties, deaths, changes of government and borders go into a record of facts that is never forgotten, however long the campaign runs.",
            ],
          },
        ],
      },
      {
        theme: "aiOverhaul",
        scene: "memory",
        title: "A Longer Memory",
        subtitle: "Old threads picked up again",
        lead: "The game now finds the past that matters to each turn, on your own device and with no extra AI requests.",
        sections: [
          {
            heading: "Related past events",
            icon: "star",
            items: [
              "A small model that ships with the game finds the old events closest to each skip's orders, wars and storylines, and shows the AI up to six of them.",
              "It is built in and always on, with nothing to download, and your events never leave your device for it.",
            ],
          },
          {
            heading: "Old diplomacy kept",
            icon: "people",
            items: [
              "A conversation untouched for over a game year and four time skips is kept on your device, and brought back when it matters to a skip, a leader's reply or the Advisor.",
              "What was agreed, promised or threatened in it always stays in view, so promises and grudges are never lost.",
            ],
          },
        ],
      },
      {
        theme: "aiOverhaul",
        scene: "setup",
        title: "Your AI, Your Way",
        subtitle: "Three choices and one switch",
        lead: "Setting up the AI is now three clear choices, and one switch tunes the game to a key without a request limit.",
        sections: [
          {
            heading: "Three ways to set up",
            icon: "gear",
            items: [
              "Gemini, the best free option.",
              "Command Code, recommended for the best quality: paste a key from its $10 GOAT plan and GLM 5.3 Flash is set up for you.",
              "Custom, for any provider and any model, or a model on your own computer.",
            ],
          },
          {
            heading: "My key has no request limit",
            icon: "plane",
            items: [
              "One switch at the top of Settings → AI → AI requests, for a paid key or a local model: My key has no request limit.",
              "Until you set it, My key has no request limit is on when your main AI provider is anything other than Gemini, and off for Gemini.",
              "With it on, the AI looks things up as it needs them: a time skip can use up to 8 requests, each sending less, and Background AI has no daily cap.",
              "It replaces Save AI requests and Unlimited requests. If you had Save AI requests off or Unlimited requests on, it is on. AI lookup functions are under Advanced.",
              "Setting up Command Code, or a model on your own computer, turns it on for you.",
            ],
          },
          {
            heading: "Edited prompts",
            icon: "note",
            items: [
              "An edited prompt passage can now be up to 20% longer than the built-in one. The Prompts tab counts each passage as you type, and Save waits until a passage that is too long is shortened or reset.",
              "A passage that was already longer, in a save, a scenario or an imported prompt pack, is never cut: the AI uses the built-in passage in its place until you shorten it, and the game tells you once.",
              "A scenario can switch on Bypass prompt length limit in its Prompts tab to keep longer passages. A new game started from it says first that it will use a lot more tokens than other scenarios.",
            ],
          },
          {
            heading: "In your language",
            icon: "book",
            items: [
              "The interface is in 36 languages, and 1,111 more of its lines are now translated.",
              "Translate with my AI, in Settings → General → Language, lets your own AI translate what the model on your device would.",
              "Scenarios can ship their own translations, made with your AI in the Workshop's Languages tab.",
            ],
          },
        ],
        button: "To the main menu",
      },
    ],
  },
  {
    // The owner, 2026-11-06: "when entering a game thats already opened ... dont do the whole music ramp up
    // thing. make it just go to the ingame music once your in" (runtime/ambientMusic.js reopensDrawnGame,
    // GameUI/main.jsx reopening).
    id: "2026-11-straight-back-into-the-music",
    kind: "minor",
    date: "2026-11-06",
    channel: "beta",
    banners: [
      {
        title: "Straight back into the game’s music",
        items: [
          "Going back into a game you already opened this session skips the opening music’s build-up: the game’s own music starts as soon as you are in.",
        ],
      },
    ],
  },
  {
    // MapLibre 6.16 with the game's own changes (Open-Historia/maplibre-gl-js, OPEN-HISTORIA.md): placement paced, sources
    // sharing their tile walks, clipping masks kept, tiles stored compactly. Measured on the production builds with the CPU
    // slowed 6x: panning 24 to 46 fps with terrain, 29 to 49 without; memory 3.1 GB to 1.9 GB. The land mask waits until the
    // map has stayed put (FrontLayers.jsx). On phones the browser's backdrop blur held the map to half its frame rate whatever
    // its strength, so the map paints the glass itself (Map/frostedPanels.js): 52 to 88 fps on the owner's phone.
    id: "2026-11-smoother-lighter-map",
    kind: "minor",
    date: "2026-11-06",
    channel: "beta",
    banners: [
      {
        title: "A smoother, lighter map",
        items: [
          "On modest computers the map now moves about twice as smoothly as you drag it around, with 3D terrain on or off, and battles replay more smoothly too.",
          "On phones the map now moves much more smoothly as you drag and pinch it, with the same frosted panels over it.",
          "On phones, country names on the far side of the globe no longer show through it.",
          "On a computer the game now uses over a third less memory with a big map open, and on a phone a little less.",
          "The map no longer catches for a moment when you let go of it near a war, and small, slow moves run without stutter.",
          "The map looks the same, though a few labels may sit a little differently, and while you move one can take a moment to appear.",
        ],
      },
    ],
  },
  {
    // A sweep for the text players read that no language pack held (2026-11-06): the update notices' lines, the
    // refusals and messages modules return (War Room, fleets, Workshop imports, shared games, a stopped skip), the
    // browser's own confirm() and alert() boxes (runtime/nativeDialogs.js) and the desktop app's menus and dialogs
    // (electron/uiWords.cjs). scripts/i18n/extractStrings.mjs now reads them, so the catalog test guards them.
    id: "2026-11-more-translated",
    kind: "minor",
    date: "2026-11-06",
    channel: "beta",
    banners: [
      {
        title: "More of the game in your language",
        items: [
          "Much more of the game is now translated: the update notices and their history, what the War Room and your fleets answer, the Workshop's imports and border check, joining a shared game, and why a time skip stopped.",
          "The boxes that ask you to confirm something, or tell you something went wrong, are in your language too.",
          "On the desktop app, the right-click menu and the box shown when the game's page stops are translated as well.",
        ],
      },
    ],
  },
  {
    // "add a feature to ship high quality api generated language packs with scenarios" (the owner, 2026-11-06):
    // scenario.languages (server/scenarioLanguages.js), the Workshop's Languages tab (ScenarioLanguagesPanel.jsx),
    // read first in a game (translator.js setScenarioLanguagePack).
    id: "2026-11-scenario-languages",
    kind: "minor",
    date: "2026-11-06",
    channel: "beta",
    banners: [
      {
        title: "Scenarios in your language",
        items: [
          "A scenario can now ship its own text translated: its name and description, its countries, regions and cities, its events and its politics.",
          "Scenario makers: open a scenario's Languages tab, pick the languages and press Generate. Your AI translates it all in a few large requests, and next time only what is new or changed.",
          "When a scenario has a translation for your language, you read it first, with no request of yours and no translation model.",
        ],
      },
    ],
  },
  {
    // "add an toggle to do translation with your api (still must require downloading the translation model, this
    // option exists if they are unhappy with the models quality)" (the owner, 2026-11-06): runtime/aiTranslation.js,
    // Settings → General → Language.
    id: "2026-11-translate-with-my-ai",
    kind: "minor",
    date: "2026-11-06",
    channel: "beta",
    banners: [
      {
        title: "Translate with your own AI",
        items: [
          "Languages with a translation model have a new switch in Settings → General → Language: Translate with my AI. Turned on, your AI provider translates what the model on this device would, in a few large requests that count against your AI requests. The model is still downloaded, and takes over whenever your AI does not answer.",
        ],
      },
    ],
  },
  {
    // A player's report (2026-11-06, 1836 France): every time skip fell back to the stand-in events, "Storyline
    // storyline-fr-franchise-1836 lowers pressure by 47 point(s), but its linked event(s) contain escalation/failure
    // cues": reforms that passed over a bloc that "rejects" them. The check read the events for words; "dont do
    // keywording its super unreliable" (the owner, 2026-11-06), so it is gone (AI/nativeWorldDirector.js).
    id: "2026-11-storyline-pressure-held",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Easing storylines no longer cost a time skip",
        items: [
          "A time skip that eases a storyline's pressure is no longer thrown away for the stand-in events because of the words in its events: the pressure the skip gives it stands.",
        ],
      },
    ],
  },
  {
    // "the hello welcome introduction switches languages about 2 times too fast. also it should fade out the last
    // language and fade in the new one" (the owner, 2026-11-06, of the native app), then: "make the greeting thing on
    // the electron apps be the same as on native": a greeting every 4.4 s, 0.6 s in and 0.6 s out (FirstSetup.jsx).
    id: "2026-11-slower-welcome",
    kind: "minor",
    date: "2026-11-06",
    channel: "beta",
    banners: [
      {
        title: "A slower welcome",
        items: [
          "The first-time setup's greeting now stays on each language for about four seconds, and fades one out before the next fades in.",
        ],
      },
    ],
  },
  {
    // The owner's file, 2026-11-06: "add this as an ingame song", then "for this one dont actually flatten the
    // loudness, let it be" (runtime/ambientMusic.js aKindOfHope, no `loud` table; public/audio/CREDITS.txt).
    id: "2026-11-a-kind-of-hope",
    kind: "minor",
    date: "2026-11-06",
    channel: "beta",
    banners: [
      {
        title: "A new song in a game",
        items: [
          "“A Kind Of Hope” by Scott Buckley now plays in a game, in turn with the others, as it was recorded.",
        ],
      },
    ],
  },
  {
    // A player's log, 2026-11-06 (round 637, desktop beta): time skips refused by Gemini as sent, 400 "Request contains an
    // invalid argument", each to the stand-in events (AI/main.jsx geminiFunctionCallRefusals); every restore point refused
    // by the server as too large (runtime/restorePointBudget.js); the world city list served as the app's page on the
    // desktop (server.js MAP_ASSETS_DIR); a landless State of Israel raised at its own name every skip (gameplay.js
    // raiseMissingCombatants); the Advisor's actions lost to a list closed over an open object
    // (GameUI/advisorBlocks.js closeObjectsBeforeList); and a third of the log one font warning per letter.
    id: "2026-11-long-campaign-fixes",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Fixes for long campaigns",
        items: [
          "A time skip Gemini refuses in the form it was asked is asked again at once in the other form, instead of ending in the stand-in events.",
          "Long campaigns keep their restore points: the oldest are let go once the archive grows too large to save, so undo keeps working.",
          "On the desktop app, the time skip can find towns from the world's city list again when it places forces.",
          "A country at war with no land left is no longer sent an army it has nowhere to stand.",
          "The Advisor's suggested actions are no longer lost when its list of them is closed one bracket short.",
        ],
      },
    ],
  },
  {
    // "I ordered my spy to assassinate head of state it succeed but nothing happened he still alive" (a player's
    // report, 2026-11-06): the skip was told only that the operation succeeded, wrote the death, and left the record's
    // leader in office. AI/covertOperationsDirective.js now says the target is dead and that the same event carries
    // the change of leader.
    id: "2026-11-assassinations-take-effect",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Assassinations take effect",
        items: [
          "A leader your agents assassinate is now gone for good: a successor takes their office in the same event.",
        ],
      },
    ],
  },
  {
    // Opus-MT en-bat (Latvian, Lithuanian), en-sk, en-et, en-el, en-he, en-ga, en-mt and en-gmq (Swedish), converted
    // for the game from Helsinki-NLP's models (none had a Transformers.js copy) and tried on the game's own kind of
    // text, 2026-11-06. Nobody publishes them on Hugging Face: they are read from the scenario repository's
    // translation-models branch (runtime/translationModels.js MIRROR, modelSources).
    id: "2026-11-nine-languages",
    kind: "minor",
    date: "2026-11-06",
    channel: "beta",
    banners: [
      {
        title: "Translation in nine more languages",
        items: [
          "You can now play in Latvian, Lithuanian, Slovak, Estonian, Greek, Hebrew, Irish and Maltese: a translation model, downloaded once, translates the game on your device.",
          "In Swedish, a translation model on your device now also translates the names and descriptions of scenarios and maps.",
        ],
      },
    ],
  },
  {
    // "get rid of this and instead have the country send you a message requesting assistance and the buttons appear
    // there. it should not explain what happens if you choose each option as that breaks immersion" (the owner,
    // 2026-11-06): the card over the map is gone; the ally that was attacked asks in a message (AI/gameplay.js) and
    // is answered under it (GameUI/warAndPeace.jsx CallToArmsCard).
    id: "2026-11-calls-to-arms-by-message",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Calls to arms come by message",
        items: [
          "An ally that is attacked now writes to you itself, and you answer it in the chat.",
        ],
      },
    ],
  },
  {
    // "it doesnt look like missile strikes actually ever happen despite the feature technically existing" / "make story
    // events be able to do strikes" (the owner, 2026-11-05): a strike was a battlefield line only (frontOrders), read
    // with Fronts on and a war under way. Events now carry their own (impacts.strikes), placed by frontTurn.js
    // placeStrikes and kept for the map whatever the battlefields do.
    id: "2026-11-strikes-on-the-map",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Missile strikes on the map",
        items: [
          "Missile launches and bombing runs the story tells of are now drawn on the map in every game, not only on a battlefield.",
        ],
      },
    ],
  },  {
    // "while scrolling, sometimes some ui elements trail behind for some reason creating a really wierd effect" (the
    // owner, 2026-11-05): a wheel scroll moved lists under a still cursor, and every row and button that passed under
    // it lit up and eased back out (styles.css control transitions). runtime/scrollHoverFreeze.js holds hover still
    // while a list scrolls; the menu cards' badges lost a blur that lagged their card.
    id: "2026-11-smoother-scrolling",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Smoother scrolling",
        items: [
          "Rows and buttons in the menu, Settings and other lists no longer light up and trail behind as they scroll past the cursor.",
        ],
      },
    ],
  },
  {
    // The HUD's glass and its buttons take the theme (runtime/uiTheme.js --oh-hud-bg…, --oh-ui-glass-*; the owner's
    // screenshots of the dock, date widget, map-mode switch and top bar, 2026-11-06). The translation model never
    // downloaded on Android: the app's http origin has no Cache Storage, so it is kept in IndexedDB
    // there (runtime/modelStore.js; a player's report, Arabic, Android stable #26).
    id: "2026-11-hud-themes",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Themed map controls",
        items: [
          "Your theme now colours the controls over the map too: the menu button, the top bar and Exit Game, the date, the dock, search, the Advisor button and the Political and Diplomatic switch.",
          "On Android, the translation model for your language downloads again. It failed every time before.",
        ],
      },
    ],
  },
  {
    // Opus-MT en-cs and en-fi (runtime/translationModels.js): tried on the game's own kind of text, 2026-11-05.
    // Latvian and Slovene had no model that read right (en-mul) or that the browser can fetch (en-bat, en-sla).
    id: "2026-11-czech-finnish",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Czech and Finnish",
        items: [
          "You can now play in Czech and Finnish: a translation model, downloaded once, translates the game on your device.",
        ],
      },
    ],
  },
  {
    // The interface themes (runtime/uiTheme.js, kernely's PR #955) reach the main menu (libraryBar.jsx), the popups
    // and the translation prompt; the first-time setup (GameUI/FirstSetup.jsx) asks for a language and a theme before
    // the vault door; the language changes where the player is (runtime/translator.js switchLanguage), a language
    // with a model only after its download, and no translation is an AI request; the Advisor's box lost its
    // placeholder and holds the microphone (AdvisorMic.jsx). The owner, 2026-11-05.
    id: "2026-11-themes",
    kind: "major",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        theme: "themes",
        scene: "palettes",
        title: "Themes",
        subtitle: "The game in your colours",
        lead: "Choose one of five palettes or mix your own, and the whole interface follows: the main menu, Settings, the panels and the popups.",
        sections: [
          {
            heading: "Five palettes",
            icon: "palette",
            items: [
              "Midnight Navy, Graphite, Forest, Oxblood and Sepia, or the original look.",
              "Or mix your own from a background, a surface and an accent colour.",
            ],
          },
          {
            heading: "Everywhere you look",
            icon: "star",
            items: [
              "The main menu, Settings, the Advisor, Diplomacy, Events and the popups all take your theme.",
              "Map, country and party colours never change, so they still mean what they did.",
            ],
          },
          {
            heading: "Where to find it",
            icon: "gear",
            items: [
              "Settings → General → Interface appearance, and in the first-time setup.",
            ],
          },
        ],
      },
      {
        theme: "themes",
        scene: "welcome",
        title: "Hello, in your language",
        subtitle: "A first-time setup",
        lead: "The first time the game opens it greets you in many languages, then asks for your language and your theme before the vault door.",
        sections: [
          {
            heading: "Your language",
            icon: "people",
            items: [
              "Changing the language in Settings now happens where you are, without going back to the main menu.",
              "Where a language needs its translation model, the game asks to download it once. Say no and the game stays in English.",
              "Translation never uses AI requests any more.",
            ],
          },
          {
            heading: "A cleaner Advisor",
            icon: "note",
            items: [
              "The message box no longer has words in it, and the microphone sits inside it.",
              "Start typing and the microphone steps aside.",
            ],
          },
        ],
        button: "Make it yours",
      },
    ],
  },
  {
    // MapLibre never kept a tile's painted terrain between frames once there were two stacks of layers: it does now,
    // ended by what changes it (Map/terrainCaches.js). Clipping masks are kept while the tiles are the same
    // (Map/clippingMasks.js), sources share what they work out (Map/sourceCaches.js), and the idle pulse asks the
    // world each whole-map question once and lets the map draw between its stages (runtime/worldLookups.js).
    // Every pixel and every prompt checked identical; on the owner's phone the pulse's freeze fell from 1.6 s to 0.45 s.
    // (Those three files have since become the game's own MapLibre: 2026-11-smoother-lighter-map.)
    id: "2026-11-less-for-the-gpu",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Less work for your graphics card",
        items: [
          "With 3D terrain on, the map now takes about a quarter of the graphics work it did while you look around it, so it runs smoother and cooler, above all on computers with modest graphics.",
          "Pinching to zoom on a phone stutters less.",
          "The freeze you could feel when a country was deciding whether to write to you is about a quarter as long, and the map keeps moving through most of it.",
          "The map looks just as it did: only the work behind it has changed.",
        ],
      },
    ],
  },
  {
    // The translator's on-device model (runtime/translationModels.js, translationWorker.js): Opus-MT for ar de es fr
    // id it nl pt ru zh (and da hu ro, which have no pack), downloaded once after the player says yes; the AI keeps
    // every other language and whatever the model's answer was refused for. The owner, 2026-11-05.
    id: "2026-11-translation-model",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Translation without AI requests",
        items: [
          "In German, French, Spanish, Italian, Portuguese, Dutch, Russian, Chinese, Arabic and Indonesian, names and descriptions a scenario adds can now be translated on your device by a model downloaded once, instead of by your AI model. The game asks before it downloads.",
        ],
      },
    ],
  },
  {
    // "A file downloaded by everyone who downloads the main app, a different file for the beta app ... only downloaded
    // once when the app is installed or when people update to this update and never again" (the owner, 2026-11-04).
    // The app shells do it (electron/appFile.cjs, mobile/android .../AppFile.java); the page and the website never do.
    id: "2026-11-install-count",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Counting installs",
        items: [
          "The app now downloads one small file from GitHub once, after it is installed or updated, so we can count how many people install it. Nothing about you is sent with it.",
        ],
      },
    ],
  },
  {
    // Two chats the owner sent, 2026-11-04: a "Meccan Alliance" condemnation of Iran shown twice, as Iran's own words,
    // and a "GSSTO" ultimatum to Tokyo and Toronto shown as Japan's. A chat's first line is said by whom the skip named
    // (AI/chatSpeaker.js), and a line the same sender just said is not added again (AI/chatFold.js).
    id: "2026-11-chat-opener-speaker",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Who wrote to you",
        items: [
          "A letter an alliance or organisation sends you is shown under its own name, no longer as the words of a country it is writing to.",
          "A country that writes first in a chat is added to that chat if it was not in it.",
          "The same letter no longer appears twice in a row in a chat.",
        ],
      },
    ],
  },
  {
    // The Advisor's microphone (GameUI/AdvisorMic.jsx, runtime/speechInput.js): the browser's or the phone's own
    // recogniser where there is one; in the desktop app Windows' or macOS's own (electron/speechSystem.cjs), and
    // Whisper base (80 MB) on the device where that cannot listen and on Linux. No AI request.
    id: "2026-11-advisor-microphone",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Speak to your advisor",
        items: [
          "The Advisor's input bar has a microphone beside Send. Press it and speak: what you say appears in the box, and it sends itself once you have been quiet for 3 seconds. Press it again to stop without sending.",
          "It costs no AI requests. In the desktop app, Windows or macOS recognises the speech itself; where it cannot, and on Linux, a speech model downloaded once does it on your computer.",
        ],
      },
    ],
  },
  {
    // Military power counts the men in full, each soldier's worth raised to the scenario's importance of technology
    // (runtime/militaryPower.js, warSettings.technologyWeight; the Wars feature's field); the owner's ask, 2026-11-04.
    id: "2026-11-importance-of-technology",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Importance of technology",
        items: [
          "A country's military power now counts all the men it can put under arms, times what each of them is worth by its arms, training and funding.",
          "Scenario authors set how much better arms outweigh more men in the scenario editor, under Wars in the Features tab. Left empty it is configured for the modern world; lower it for a world where numbers decided wars.",
        ],
      },
    ],
  },
  {
    // A post imported before (kept by post number in ui-settings `hubImported`, server/hubImported.js), or one the
    // library holds, is downloaded from its uncounted update copy (runtime/hubPosts.js downloadHubScenario); a post
    // with no update copy yet still counts. The owner's ask, 2026-11-04.
    id: "2026-11-reimports-not-imports",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Importing again is not an import",
        items: [
          "Importing a Community scenario you have imported before, even one you have since deleted, no longer adds to its number of imports.",
        ],
      },
    ],
  },
  {
    // The Wars feature's Pace of an advance setting removed: every game advances at the built-in pace (AI/frontsGate.js
    // frontsPace); the owner's ask, 2026-11-04.
    id: "2026-11-one-advance-pace",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Advances at one pace",
        items: [
          "The Wars feature no longer has a Pace of an advance setting. Troops in every game advance at the built-in pace, including games and scenarios that had changed it.",
        ],
      },
    ],
  },
  {
    // "When map looping is disabled in a scenario, you shouldn't be able to continue infinitely anyway", and the Third
    // Great Ninja War's picture (freeform, ±72°) showed empty ground past its top and bottom. The camera's bounds had
    // infinite longitudes, which switched off MapLibre's one-world hold, and the square's ±85° for every picture
    // (Map/cameraBounds.js). The owner, 2026-11-05: all custom basemaps, not just freeform ones.
    id: "2026-11-map-edges",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "The map stops at its edges",
        items: [
          "A scenario drawn on its own picture now stops at the picture's edges: you can no longer pan or zoom out past its top and bottom.",
          "With map looping turned off, the map now stops at its left and right edges instead of going on for ever.",
        ],
      },
    ],
  },
  {
    // An annexed Tunisia stayed in its own colour and name on the map though a click said its land was Italy's: the
    // player's forces at home (a battlefield standing in peace) kept listing its regions as "taken in name only", which
    // nothing standing ever finishes (runtime/fronts/battle.js readRegions; Map/frontOwnership.js drawnOwnersOf).
    // A player's report, 2026-11-05.
    id: "2026-11-annexed-land-on-the-map",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Annexed land on the map",
        items: [
          "A country you annex while your forces are built up at home now takes your colour and name on the map at once, instead of keeping its own. A game where this happened is drawn right as soon as it is opened.",
        ],
      },
    ],
  },
  {
    // The skip's build-up line was written `home: X~X~...`; Poland's ordered build-up came back with no line at all
    // and nobody was called up. The line now names the player (AI/frontPrompt.js playerRule). A player's report, 2026-11-05.
    id: "2026-11-build-up-line-named",
    kind: "minor",
    date: "2026-11-05",
    channel: "beta",
    banners: [
      {
        title: "Build-ups you order",
        items: [
          "A time skip is now told your own country's name in the line that calls up your forces at home, so a build-up you order is called up more reliably.",
        ],
      },
    ],
  },
  {
    // A Mac report, 2026-11-04: the app "opens then immediately closes". The packed Mac build starts as far as its
    // window in a simulated run; what is left to it is said and logged now (electron/main.cjs app.alreadyRunning,
    // window.shown, the system and folder in app.files, updater.relaunch; a launch update from a translocated copy waits for the next start; server.js EADDRINUSE through __ohFatal) and an Intel Mac's banner
    // download is its own zip (server/desktopDownload.js).
    id: "2026-11-mac-opening",
    kind: "minor",
    date: "2026-11-04",
    channel: "beta",
    banners: [
      {
        title: "Opening the game on a Mac",
        items: [
          "If you open the game from where you downloaded it rather than from Applications, an update it finds as it opens is installed the next time you open it, and the game opens straight away instead of restarting.",
          "Clicking the game in the Dock while it is running brings its window forward.",
          "On an Intel Mac, the download the update banner offers is the one built for Intel Macs.",
          "If the game cannot start because the connection it uses on your computer is taken, it says so instead of closing without a word.",
        ],
      },
    ],
  },
  {
    id: "2026-11-picture-edges-and-strike-targets",
    kind: "minor",
    date: "2026-11-04",
    channel: "beta",
    banners: [
      {
        title: "Map pictures keep their edges",
        items: [
          "A picture you add to a scenario's maps in the Workshop now keeps the edges its setup gave it, Q-BAM's exact ones included, so it stays lined up with the coastlines in the Workshop and in the game.",
        ],
      },
      {
        title: "Strike targets by name",
        items: [
          "In the War Room, an air strike sent at troops names the town nearest them plainly, without \"city:\" in front of it.",
        ],
      },
    ],
  },
  {
    // The province outline reads no feature-state on a map without region types, so a tile that loads applies the
    // regions' state to its fill alone (Map/provinceOutlineStyle.js); a playing paints and writes only what a frame
    // changes (Map/frontPaint.js unlessUnchanged, writeFrontField); MapLibre's worker drops its spare copies of the
    // regions file (Map/regionsSourceMemory.js) and the border worker keeps its segments as typed-array rows
    // (vnext/politicalBoundaryTopology.js SegmentTable): 2.35 GB to 1.97 GB on the modern world (2026-11-04).
    id: "2026-11-smoother-zooming",
    kind: "minor",
    date: "2026-11-04",
    channel: "beta",
    banners: [
      {
        title: "Smoother zooming and battles",
        items: [
          "Zooming in and out brings in new map detail with shorter pauses on most maps, above all on slower computers and phones.",
          "When a turn lands, its battles play out on the map about twice as smoothly, above all on slower computers and phones.",
          "A game on a large map, like the modern world, needs about a sixth less memory, so it is less likely to run short on computers and phones with little to spare.",
          "The map looks just as it did: only the work behind it has changed.",
        ],
      },
    ],
  },
  {
    // Troops taken off a battlefield far from the sea were refused a ship ("no sea is near where it would set out")
    // whenever they stood more than a day's march inland: now they go overland to a port of their country's on
    // their way (runtime/fronts/engine.js departTransport, transports.js departuresFor). A player's report, 2026-11-04.
    id: "2026-11-ships-from-ports",
    kind: "minor",
    date: "2026-11-04",
    channel: "beta",
    banners: [
      {
        title: "Troops sail from a port",
        items: [
          "Troops you send by sea from the War Room no longer have to stand by the coast: they go overland to one of your ports on their way, and sail from there.",
          "A transport that cannot set out because your country has no navy or no air arm now says so.",
        ],
      },
    ],
  },
  {
    // The War Room's Aircraft key counted only air units on the map, never a front's air arm (GameUI/warRoom.jsx
    // airUnitsOf given the whole world); the owner's report, 2026-11-04.
    id: "2026-11-aircraft-key",
    kind: "minor",
    date: "2026-11-04",
    channel: "beta",
    banners: [
      {
        title: "The Aircraft key works",
        items: [
          "In the War Room, the Aircraft key is no longer greyed out for a country whose only aircraft are the ones flying over its fronts: those can be sent to strike now.",
        ],
      },
    ],
  },
  {
    // The 3D terrain's exaggeration halved, 15 to 7.5 (Map/World.jsx); the owner's ask, 2026-11-03.
    id: "2026-11-gentler-terrain",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Gentler 3D terrain",
        items: [
          "Mountains and valleys on the 3D terrain now rise half as high as before.",
        ],
      },
    ],
  },
  {
    // The display mode setting and tidier game cards (a contributor's PR #935, with its review fixes).
    id: "2026-11-display-mode",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Windowed, maximized or fullscreen",
        items: [
          "In the desktop app, Settings → Display now chooses how the game's window is shown: in a window, maximized, or fullscreen, and remembers it for next time.",
          "Game cards show their date in your language, and long save names fit on the card.",
          "A game's Archive button has moved into its card's menu.",
        ],
      },
    ],
  },
  {
    // A contributor's PR #942, trimmed to the map card's button (GameUI/rostraOpen.js, opening Search), the dock's
    // phone and flags for full official names (resolvePolityFlag); the owner's choice, 2026-11-03.
    id: "2026-11-rostra-check-in",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Check in Rostra from the map",
        items: [
          "A region's card has Check in Rostra, which opens Rostra's Search on that country. Its posts load when you press Refresh there.",
          "Rostra's button is now a phone.",
          "Posts by countries known by their full names, such as the French Republic, show their national flags.",
        ],
      },
    ],
  },
  {
    // Rostra's Search tab (Listen in, back inside Rostra: GameUI/rostraSearch.jsx, runtime/placeFeed.js, the placeFeed
    // task), the leader's polls (runtime/socialFeed.js, the skip's pollResults) and the box behind the pen; the
    // owner's ask, 2026-11-03.
    id: "2026-11-rostra-search-polls",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Rostra: Search and polls",
        items: [
          "Rostra's Search tab finds any country or region and shows what ordinary people there are posting today. Each new place is one AI request.",
          "Search opens on your own country, where the Your country tab was.",
          "Ask a poll as your country's leader: the public votes during the next time skip, and the poll then shows the results and the public's verdict.",
          "The box to write a post now opens from the pen at the top of Rostra.",
          "A feed with nothing on it says so and offers Refresh, which asks for the first posts by the people who make the news. It is one AI request.",
        ],
      },
    ],
  },
  {
    // thekernely's #936-#939 (Advisor contacts: runtime/advisorThreads.js; party authoring: countryEditorPolitical.js;
    // metadata-only diplomacy replies) with the review's fixes (2026-11-03).
    id: "2026-11-advisor-contacts",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Advisor contacts and party details",
        items: [
          "The Advisor panel can hold more people to write to: add an official with a position and a personality, or your country's head of state or head of government, and each keeps a conversation of its own.",
          "Only your chief advisor puts Actions and Projects into effect; the others advise.",
          "The Workshop and the Country Editor now edit each party's native name, ideology, seats, founding year and colour, and the legislature's size and next election, and check that seats and support add up.",
          "A leader's reply with no words is shown as the error it is, and one that only answers your peace offer still makes the peace.",
        ],
      },
    ],
  },
  {
    // An Update downloads the post's update copy, which the hub does not count (runtime/hubFiles.js updateCopyOf;
    // the hub's index `updates`); the owner's ask, 2026-11-03.
    id: "2026-11-updates-not-imports",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Updates are not imports",
        items: [
          "Updating a scenario you got from the Community tab, or suggesting changes to it, no longer adds to its number of imports: only importing it does.",
        ],
      },
    ],
  },
  {
    // Terrain matrices sent as 32-bit floats, battlefield pictures no longer handed to hidden layers, the land mask
    // read only where it is on the screen, and names not compared again on every idle (2026-11-03).
    id: "2026-11-lighter-map",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "A lighter map",
        items: [
          "Moving and zooming the map takes less work, so it runs smoother, above all on slower computers with 3D terrain on.",
          "Letting go of the map near a war brings a shorter hitch.",
          "The globe turning on its own uses far less of your computer, so laptops and phones stay cooler while you read.",
          "The map looks just as it did: only the work behind it has changed.",
        ],
      },
    ],
  },
  {
    // Gemini wrote every event's places as objects of their parts; the check failed the answer, its retry and the
    // skip (AI/eventPlaces.js placesAsWritten; a player's Android report, 2026-11-03).
    id: "2026-11-places-as-written",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Long time skips on Gemini",
        items: [
          "A time skip no longer fails and asks again when Gemini writes the places of its events in its own format, so a year-long skip takes one request and keeps every event it wrote.",
        ],
      },
    ],
  },
  {
    // The Workshop's GPU region layer drew a converted map's regions where they had been (Editor/regionDisplay.js
    // regionFrame), and the game's camera stopped at 80°S on a scenario's own map (Map/World.jsx maxBounds); both
    // on Avatar: Resurrection (the owner's report, 2026-11-03).
    id: "2026-11-converted-maps-line-up",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Converted maps line up",
        items: [
          "Converting a map to another projection in the Workshop now shows its regions where they went, on the redrawn picture, instead of where they were.",
          "On a scenario's own map the camera now reaches the southern edge; the last rows below 80°S were out of reach.",
        ],
      },
    ],
  },
  {
    // A branched scripted event set to "Let the AI write it" was taken for missing when the AI told it in words of its
    // own, and the engine wrote the author's instruction as the event (AI/worldDirection.js sharesParentContextAnchor,
    // withoutAsides; a player's report, 2026-11-03).
    id: "2026-11-scripted-events-in-ai-words",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Scripted events in the AI's words",
        items: [
          "A scripted event set to Let the AI write it is told in the AI's words again, instead of appearing as the instruction you wrote.",
          "When a time skip does leave one out, the copy written in its place leaves out your [bracketed] notes to the AI.",
        ],
      },
    ],
  },
  {
    // A model's war, client state, relation or agreement written inside an event is carried out; a skip's events are
    // sent with impacts required, so Gemini no longer leaves them off (AI/jumpAnswerShelves.js,
    // gameplaySchemas.js withEventImpacts; the owner's reports, 2026-11-03).
    id: "2026-11-changes-where-they-belong",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Wars and client states take effect",
        items: [
          "A war, a client state, a relation or an agreement that an AI model writes inside an event now takes effect, scripted events included, and a time skip on Gemini no longer leaves out the changes its events tell.",
        ],
      },
    ],
  },
  {
    // Peace on any terms (runtime/peaceTerms.js: annexed, cessions, puppet, conditions), forces built up through
    // actions and projects only, and the fixes after 0.0.112 (the owner, 2026-11-03).
    id: "2026-11-peace-on-any-terms",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Peace on any terms",
        items: [
          "A peace can annex the other country whole, hand over regions by name, or make one side the other's puppet state, protectorate or client state.",
          "Add any other condition to your terms in your own words, and the next time skip carries it out.",
          "Leaders and time skips offer and accept peace on these terms too.",
        ],
      },
      {
        title: "Forces and fixes",
        items: [
          "Forces are built up through your actions and projects: order a mobilisation and the time skip calls them up round your cities. The Build up forces button is gone.",
          "Forces built up in peace show on the map again.",
          "Military power counts how well a country's forces are armed, led and funded far more than how many they are, and a country waits for its rating instead of being ranked by its population.",
          "The country panel has one Politics tab again.",
          "The update banner no longer offers the build you have just installed.",
          "Major update notices come before minor ones.",
          "A time skip in a game that tracks political parties is one AI request again, and a skip that has to check its turn separately always keeps a request for it.",
        ],
      },
      {
        title: "Politics, advisors and the air",
        items: [
          "Politics is one record: each country's Political World now carries what the Politics card had, native party names, ideologies, roles, seats, the legislature and the next election, and turns keep it up.",
          "A country's leader is one person everywhere: Rostra and the AI name whoever holds the office now, as the country panel does, and a save's latest Politics reading brings its government with it.",
          "Your advisor knows your wars as your general staff would: every front's line, strength and latest fighting, your standing orders, how weary each side is and what is on the table for peace.",
          "Deploy Aircraft works with the air arm that flies over your fronts when you have no air unit of your own on the map.",
        ],
      },
    ],
  },
  {
    // "Scripted events don't work at all or have any effect, Geopolitical events don't happen anymore" (a player's
    // report, 2026-11-03): changes written on an event are put where they belong (AI/jumpAnswerShelves.js).
    id: "2026-11-events-take-effect",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Events change the world again",
        items: [
          "Territory changes, client states and treaties that a time skip writes into its events now take effect, scripted events included, where some AI models had them thrown away.",
        ],
      },
    ],
  },
  {
    // "antartica has this strange bug where there are triangles cut out of the climate zones" (the owner,
    // 2026-11-03): the season's tint is map tiles now (Map/seasonTintTiles.js).
    id: "2026-11-season-tint-tiles",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Seasons drawn whole",
        items: [
          "The colours of the seasons no longer have triangles cut out of them near Antarctica when 3D terrain is on.",
          "The country ranking shows every country's flag, including countries known by their official names.",
        ],
      },
    ],
  },
  {
    // Forces built up at home round the cities and moved in the War Room; troops march to the front from inside their
    // country; call-ups sized by the country (the owner, 2026-11-02: runtime/fronts/home.js, march.js).
    id: "2026-11-forces-at-home",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Forces at home",
        items: [
          "Build up forces from your own country's page: they gather round your cities, as many as your men, supplies, war weariness and mustering allow, and more come in over the weeks after.",
          "The War Room opens for them in peace: draw routes to move them through your own land, to a border or anywhere at home.",
          "Send them into another country's land and the war with it begins; those near its front fight there.",
          "Other countries build up their forces and station them on their borders too.",
        ],
      },
      {
        title: "Armies march to the front",
        items: [
          "New troops are called up inside their country, the deeper the thinner its people are spread, and march to the front.",
          "Armies move half again as fast through their own side's territory as through the enemy's.",
          "Deploying troops no longer asks how many: your country calls up as many as it can.",
        ],
      },
    ],
  },
  {
    // "fully conquouring an enemy should end the war" (the owner, 2026-11-03), after a player's war on the
    // protectorate they had made went on for two years (warAndPeace.js endConqueredWars, endWarsOnPuppets;
    // playersWarsHold.js).
    id: "2026-11-wars-end-when-won",
    kind: "minor",
    date: "2026-11-03",
    channel: "beta",
    banners: [
      {
        title: "Wars end when they are won",
        items: [
          "A war ends when one side is fully conquered, or becomes the other side's puppet.",
          "Ordering a war of yours to end now offers your enemy peace, each side keeping what it holds; their government answers in the next time skip.",
        ],
      },
    ],
  },
  {
    // "replace the listen in feature with a new button where the projects button was where it opens a social media
    // application ... things that happen on the social media should be in the time skip ai's (simulation agent)
    // context", "on beta add the projects menu as a tab in the actions menu", "make sure the social media feature is
    // disableable in the scenario editor" (the owner, 2026-11-02).
    id: "2026-11-rostra",
    kind: "major",
    date: "2026-11-02",
    channel: "beta",
    banners: [
      {
        theme: "rostra",
        scene: "feed",
        title: "Rostra",
        subtitle: "The world, in its own words",
        lead: "A social network for the world you play in. Read what leaders, generals, journalists and celebrities post as time passes, post as your country's leader, and quote anyone.",
        sections: [
          {
            heading: "The people who make the news",
            icon: "people",
            items: [
              "Heads of state, ministers, generals, journalists, analysts and business leaders post about what happens in each time skip.",
              "Now and then a celebrity or an ordinary person posts about something that has nothing to do with world affairs.",
            ],
          },
          {
            heading: "Your own voice",
            icon: "flag",
            items: [
              "Post as your country's leader from the box at the top of the feed. Posting costs no AI request.",
              "Quote any post: the post you quote is shown inside yours.",
            ],
          },
          {
            heading: "Words have consequences",
            icon: "eye",
            items: [
              "The next time skip reads your posts as your leader's public words: allies, rivals, markets and crowds answer them.",
              "Leaders and journalists quote you back, and the Mentions tab gathers every post that answers or names you.",
            ],
          },
          {
            heading: "Find your way",
            icon: "map",
            items: [
              "Rostra opens from the third button of the dock. Tabs show everything, your country, your mentions and your own posts.",
              "A scenario can switch social media off in its Features tab.",
            ],
          },
        ],
      },
      {
        theme: "rostra",
        scene: "desk",
        title: "Projects moves into Actions",
        subtitle: "And Listen in steps aside",
        lead: "Projects & Operations is now the second tab of the Actions panel, so its old button could make room for Rostra.",
        sections: [
          {
            heading: "Projects & Operations",
            icon: "book",
            items: [
              "Open Actions and choose the Projects tab: the board works just as it did.",
              "Your advisor's button to open the board now opens that tab.",
            ],
          },
          {
            heading: "Listen in",
            icon: "phone",
            items: [
              "The Listen in button on a region's card and a country's panel has been removed.",
              "Rostra takes its place and asks for no AI request of its own: its posts come with each time skip.",
            ],
          },
        ],
      },
    ],
  },
  {
    // "have it already contain that" (the owner, 2026-11-02): the skip writes the figures a war needs itself (warFiguresPrompt.js).
    id: "2026-11-war-figures-in-skip",
    kind: "minor",
    date: "2026-11-02",
    channel: "beta",
    banners: [
      {
        title: "A war costs no extra requests",
        items: [
          "A time skip that starts a war now works out the strength, people and economy of the countries in it in its own answer, instead of asking the AI for them after the turn.",
          "So a skip is one request on the turns a war begins too, which matters most on a free key, where requests are what runs out.",
        ],
      },
    ],
  },
  {
    // The Game Master reads a request for what it means; wars open in any language; typed text is not translated (2026-11-02).
    id: "2026-11-game-master-wars",
    kind: "minor",
    date: "2026-11-02",
    channel: "beta",
    banners: [
      {
        title: "The Game Master does what you ask",
        items: [
          "The Game Master no longer turns down a declaration of war over its wording: a war you ask for is made, in any language.",
          "What a request leaves unsaid, such as who fights in a battle or which war an event belongs to, the game now works out itself instead of asking the AI again.",
          "When part of a request cannot be made, such as a war with a country that does not exist, the preview says so plainly and shows the rest.",
          "Wars that break out in a time skip are no longer lost when its events are written in a language other than English.",
          "Your orders and the Game Master's preview are no longer changed by the translation of the game's interface.",
        ],
      },
    ],
  },
  {
    // "add camera controls (press shift to tilt or turn) to beta" (the owner, 2026-11-02): as the native app has them.
    id: "2026-11-shift-to-turn",
    kind: "minor",
    date: "2026-11-02",
    channel: "beta",
    banners: [
      {
        title: "Hold Shift to turn and tilt",
        items: [
          "On a trackpad, dragging with two fingers now zooms the map, as pinching does.",
          "Hold Shift while you drag with two fingers to turn and tilt the map: sideways turns it, up and down tilts it.",
          "A right-button drag still turns and tilts the map, Shift with the arrow keys still does too, and Shift with a mouse wheel zooms in finer steps.",
        ],
      },
      {
        // "remove the context window ai setting from the settings" (the owner, 2026-11-02).
        title: "One AI setting fewer",
        items: [
          "Settings → AI no longer has a Context window field for each model.",
          "The game still learns how much a model can take from the model's own refusals, and tries it again by itself after a while.",
        ],
      },
    ],
  },
  {
    // The website's entry screen ("Enter Open Historia") removed: the demo notice comes up over the game (2026-11-02).
    id: "2026-11-straight-into-the-demo",
    kind: "minor",
    date: "2026-11-02",
    channel: "beta",
    banners: [
      {
        title: "Straight into the demo",
        items: [
          "On the website, Play the demo now opens the game itself: the entry page that stood in front of it is gone.",
          "The note that the browser version is a demo comes up over the game instead, once a visit.",
        ],
      },
    ],
  },
  {
    // A turn no longer reads the whole map for patrols it does not have, the land war reads it off the page, and the
    // map's names and catalog are not worked out twice as a game opens (2026-11-02).
    id: "2026-11-faster-turns",
    kind: "minor",
    date: "2026-11-02",
    channel: "beta",
    banners: [
      {
        title: "Faster games and turns",
        items: [
          "Games open sooner: the borders and country names come up earlier, above all on large maps.",
          "Turns end sooner, and the pauses as each one finishes are about half as long.",
          "A turn that draws a new battlefield no longer holds up the screen while it reads the map.",
          "Nothing about how the game plays has changed: only the work behind it.",
        ],
      },
    ],
  },
  {
    // Terrain and front work kept instead of redone each frame, and borders worked out off the page (2026-11-02).
    id: "2026-11-smoother-map",
    kind: "minor",
    date: "2026-11-02",
    channel: "beta",
    banners: [
      {
        title: "A smoother map",
        items: [
          "Moving, zooming and turning the map is far smoother, above all with 3D terrain on and wars on the map.",
          "Slower computers gain the most.",
          "The freeze of a few seconds that could strike mid-game, as a country got ready to write to you, is now a brief hitch at most.",
          "The map looks just as it did: only the work behind it has changed.",
        ],
      },
    ],
  },
  {
    // "in features rename the fronts section to wars and make it so you can toggle fronts, air troops, and navies for a
    // scenario", "make it so in the war room you can Deploy Aircraft", "make it so they can be intercepted and if they
    // are, the "fighters" in the air unit have a simulated battle" (the owner, 2026-11-01).
    id: "2026-11-deploy-aircraft",
    kind: "major",
    date: "2026-11-01",
    channel: "beta",
    banners: [
      {
        theme: "airRaid",
        title: "Deploy Aircraft",
        subtitle: "Wars, part by part",
        lead: "Send your air units to bomb the enemy's troops, the things they have built, or their cities, and watch for the fighters that rise to meet them. And a scenario now chooses which parts of war it has.",
        sections: [
          {
            heading: "Deploy Aircraft",
            icon: "plane",
            items: [
              "In the War Room, the Aircraft key beside Deploy: pick one of your air units, choose troops, a structure or a city, and click it on the map.",
              "The strike flies when time next passes. The ring on the map shows where its bombs will fall.",
            ],
          },
          {
            heading: "Intercepted",
            icon: "swords",
            items: [
              "The enemy's air units within reach may find the raid and rise against it. Then the fighters of both sides fight it out.",
              "What is left decides it: the bombers get through, get through in part, or turn back. Both sides lose aircraft.",
            ],
          },
          {
            heading: "What the bombs do",
            icon: "flag",
            items: [
              "Troops under the bombs lose strength, dug-in troops less. Your own troops under them are hit too.",
              "A structure is damaged or destroyed. A city loses people and economy, and its country grows wearier of the war.",
            ],
          },
          {
            heading: "Told and counted",
            icon: "book",
            items: [
              "The story is told each strike as it happened, the War Room shows what came of it, and the map plays the raid.",
              "Countries know the air war in their war stats, and their diplomacy weighs it.",
            ],
          },
          {
            heading: "Wars, part by part",
            icon: "gear",
            items: [
              "In a scenario's Features, Fronts is now Wars, with a switch each for Fronts, Air units and Navies.",
              "Switched off, that part of war is gone from the game: nothing of it is raised, sent or fought. Existing scenarios keep everything on.",
              "The scenario editor's War tab is now under Wars in the Features tab.",
            ],
          },
        ],
        button: "To the airfield",
      },
    ],
  },
  {
    // "battlefield ground drawn the way the ownership hand-over animation is, plus a moving front border"
    // (the owner, 2026-11-01): the battlefield draws its sides' regions itself, with the border where the
    // holders meet (Map/frontGroundLayer.js).
    id: "2026-11-moving-fronts",
    kind: "minor",
    date: "2026-11-01",
    channel: "beta",
    banners: [
      {
        title: "Fronts that move",
        items: [
          "Ground taken on a battlefield now looks just like the land of the country that holds it, on every basemap.",
          "The border moves with the fighting: it is drawn where the ground changes hands, not along the old border.",
          "Battlefields are quicker to draw, so the map stays smooth while a turn plays.",
        ],
      },
    ],
  },
  {
    // Distances follow the map's projection; the Workshop's scale line; the Flat Earth projection (2026-11-01).
    id: "2026-11-map-distances",
    kind: "minor",
    date: "2026-11-01",
    channel: "beta",
    banners: [
      {
        title: "Distances that follow the map",
        items: [
          "Troops, fleets, transports and aircraft measure their distances by the map's projection, so every map is as far across as the world it shows.",
          "On a freeform map every distance is a straight line, at the same scale everywhere.",
          "In the Workshop's Projection panel, draw a scale line and say how long it is: the whole map and its scenario are measured by it.",
          "A new Flat Earth projection shows the world as a round map with the North Pole at its centre.",
        ],
      },
    ],
  },
  {
    // A suggestion's border changes are groups of neighbouring regions; now it says how many regions (2026-11-01).
    id: "2026-11-suggestion-regions",
    kind: "minor",
    date: "2026-11-01",
    channel: "beta",
    banners: [
      {
        title: "Suggestions count their regions",
        items: [
          "When you suggest changes to a community scenario, the Borders line now says how many regions you merged into others, reshaped or added.",
          "Each border change is a group of neighbouring regions that is accepted or rejected together, so many merges can be a few changes.",
        ],
      },
    ],
  },
  {
    // The desktop app packs only what it runs (2026-11-01).
    id: "2026-11-lighter-desktop",
    kind: "minor",
    date: "2026-11-01",
    channel: "beta",
    banners: [
      {
        title: "A lighter desktop app",
        items: [
          "The desktop app is a smaller download: about 40 MB less on Windows.",
          "It takes up about 100 MB less space once installed.",
          "Updates have far fewer files to put in place, so they finish sooner.",
        ],
      },
    ],
  },
  {
    // PR #916 (DupliM2001), rebuilt on beta: the Politics tab, goal progress, picture basemaps, deals and annexations kept (2026-10-31).
    id: "2026-10-politics-and-goals",
    kind: "minor",
    date: "2026-10-31",
    channel: "beta",
    banners: [
      {
        title: "Parties, goals and promises kept",
        items: [
          "A Politics tab beside Diplomacy and Economy shows a country's government and its main parties, with their ideologies, leaders, seats and support. Ask for it once; the story moves it from then on.",
          "Under your standing goal, Assess progress says how far it has come: what is done, what stands in the way and what to do next.",
          "A deal agreed in a diplomatic chat is now kept as an agreement, and its terms are carried out when they fall due.",
          "An annexation an event tells of now happens on the map, and a country joining a war takes the side against the countries it names.",
          "In the map editor, a picture of a map asks how it is drawn and where it lies, stays sharp when you zoom in, and the mouse wheel zooms a whole level a notch.",
        ],
      },
    ],
  },
  {
    // Group diplomacy: countries added to a conversation, conversations renamed, members tagged (PR #917, 2026-10-31).
    id: "2026-10-group-diplomacy",
    kind: "minor",
    date: "2026-10-31",
    channel: "beta",
    banners: [
      {
        title: "Group diplomacy",
        items: [
          "Add countries to a diplomatic conversation with Add Country in its header.",
          "Rename a conversation with the pencil beside its title.",
          "In a group conversation, tag countries with the @ chips above the message box: only the countries you tag answer.",
        ],
      },
    ],
  },
  {
    // The phone layout: the main menu, the library's cards and the in-game buttons (PR #918, 2026-10-31).
    id: "2026-10-phone-layout",
    kind: "minor",
    date: "2026-10-31",
    channel: "beta",
    banners: [
      {
        title: "A tidier phone layout",
        items: [
          "On a phone, the main menu's tabs and buttons line up evenly, and searching and sorting the library take a row each.",
          "Game cards in the library are more compact on small screens.",
          "In a game on a phone, the menu, date and search buttons match in size, the advisor's button sits clear of the map switch, and the War Room button is smaller.",
        ],
      },
    ],
  },
  {
    // Peace offered through the diplomatic chats, when the AI decides it, with each country's war in its diplomacy (2026-10-30).
    id: "2026-10-peace-in-the-chats",
    kind: "minor",
    date: "2026-10-30",
    channel: "beta",
    banners: [
      {
        title: "Peace at the table",
        items: [
          "An enemy offers peace in its diplomatic chat with you, in its leader's own words, with the terms to accept or decline right there.",
          "Peace is offered only when a country decides to, not at a fixed weariness: a weary country may still fight on, a strong one may still want peace.",
          "Put your own terms with Peace in the chat with an enemy, and its leader answers them in the reply: accepts, declines or offers other terms.",
          "Countries at war know their own war in diplomacy: weariness, supplies, ground, battlefields and allies. One running short may ask you for help.",
        ],
      },
    ],
  },
  {
    id: "2026-10-ai-in-your-language",
    kind: "minor",
    date: "2026-10-29",
    banners: [
      {
        title: "Suggestions in your language",
        items: [
          "The suggested actions in the Actions panel are written in the language you play in again, not in English.",
          "Interactive events, intelligence briefings, country statistics and scripted events follow your language the same way.",
          "When you play in English, a scenario set to another language is still written in that language.",
        ],
      },
    ],
  },
  {
    id: "2026-10-community-dates",
    kind: "minor",
    date: "2026-10-29",
    banners: [
      {
        title: "Find scenarios by date",
        items: [
          "The Community tab's start and end date filters now find scenarios by the date they begin. Before, any date range showed nothing.",
          "Set only a start or only an end to see everything after or before it; scenarios set before the common era count too.",
        ],
      },
    ],
  },
  {
    id: "2026-10-renamed-regions",
    kind: "minor",
    date: "2026-10-28",
    channel: "beta",
    banners: [
      {
        title: "Renamed regions and a tidier top bar",
        items: [
          "A region renamed by an event shows its new name on its place card and in each country's list of territory.",
          "On a computer, the menu button at the top left is now the same height as the game's name and the Exit Game button beside it.",
        ],
      },
    ],
  },
  {
    id: "2026-10-fixes-from-reports",
    kind: "minor",
    date: "2026-10-28",
    banners: [
      {
        title: "Fixes from your reports",
        items: [
          "When an event says an army took a region, the region changes hands on that date if enough of that army's troops are nearby (more for a larger region): its nearest troops move in, and the other side's troops there fall back.",
          "Countries no longer run out of men after a front or two: drafts, reinforcements and the troops a deployment calls up come in again.",
          "When an event or your action makes a country another's puppet, vassal or protectorate, it now becomes one, and freeing, annexing or a revolt is recorded too.",
          "A time skip no longer makes a second copy of a unit already on the map; copies already in a save are removed, and deleting one removes only that one.",
          "On a map you drew yourself, real-world countries no longer creep into the country list. On phones, the Diplomacy panel's institutions fit the screen and the War Room button no longer covers the Actions panel.",
          "Scripted events are written in your language, and Antarctica's snow is no longer cut into by triangles when zoomed out.",
          "A time skip on a map with many countries finishes sooner: working out each country's statistics no longer rereads the whole map for every name.",
        ],
      },
    ],
  },
  {
    // What a real-key test of the game found (2026-10-28).
    id: "2026-10-ai-mended",
    kind: "minor",
    date: "2026-10-28",
    channel: "beta",
    banners: [
      {
        title: "The AI, mended",
        items: [
          "The Game Master can start wars again: a unit's orders put in other words, or an answer sent back in an odd format, no longer spoil the preview.",
          "A battlefield the AI named with a code is called by its sides instead, such as \"France - Italy front\", in new games and saved ones.",
          "A war's name no longer carries part of its cause after it.",
          "The AI console now shows how many tokens each of your advisor's answers used.",
          "Your advisor no longer measures a country's military strength by how many regions it holds.",
        ],
      },
    ],
  },
  {
    id: "2026-10-spies-with-reason",
    kind: "minor",
    date: "2026-10-28",
    banners: [
      {
        title: "Spies with a reason",
        items: [
          "Foreign agents in your country now come from those with a reason to send them: your enemies and rivals, and powers with a real stake in your affairs.",
          "A country with no interest in you, or no spy service to speak of, no longer plants agents in your country.",
        ],
      },
    ],
  },
  {
    // The time skip was never shown the regions nobody rules, so an order to take the wild land next door could not
    // be carried out; and a week's reason for a change to a country replaced that country's whole description
    // (Discord spike, 2026-10-28). Then (2026-10-29): wild land one sea away counts as within reach by ship, and a
    // patrol keeps to its own ground (a fleet was drifting onto the coast).
    id: "2026-10-unruled-land",
    kind: "minor",
    date: "2026-10-29",
    banners: [
      {
        title: "Wild land and a confidant",
        items: [
          "On maps with land no country rules, the story now knows which of it lies beside each country, or across a strait or a bay from its coast, so an order to settle or take it can be carried out.",
          "A country's description from the scenario now stays as written when the story changes something about it, instead of being replaced by a one-line note.",
          "Fleets on patrol now stay at sea, and armies on patrol stay on land, instead of drifting onto the coast or into the water.",
        ],
      },
    ],
  },
  {
    id: "2026-10-zoom-keys",
    kind: "minor",
    date: "2026-10-27",
    banners: [
      {
        title: "Zoom in and out",
        items: [
          "On a computer, Ctrl and = (or +) now makes everything larger again, as Ctrl and - makes it smaller.",
          "Ctrl and 0 puts the size back to normal. On a Mac, use Cmd.",
        ],
      },
    ],
  },
  {
    // "make it so you can do all the map controls with 2 fingers on a trackpad, and make it so mouse you can just
    // right click to do them"; "make it so on track pad, a one finger click and drag pans but 2 finger drag turns
    // tilts and rotates" (the owner, 2026-10-27).
    id: "2026-10-turn-and-tilt",
    kind: "minor",
    date: "2026-10-27",
    channel: "beta",
    banners: [
      {
        title: "Turn and tilt the map",
        items: [
          "Drag with the right mouse button to turn and tilt the map: sideways turns it, up and down tilts it.",
          "On a trackpad, a two-finger drag now turns and tilts the map, both at once, instead of zooming. Pinch to zoom.",
          "A one-finger click and drag still moves the map, and a mouse wheel still zooms.",
          "It works the same in the War Room, and Shift with the arrow keys still turns and tilts the map too.",
        ],
      },
    ],
  },
  {
    id: "2026-10-globe-and-renames",
    kind: "minor",
    date: "2026-10-27",
    banners: [
      {
        title: "A smoother globe",
        items: [
          "Globe rotation and celestial star rendering run smoother with fewer frame drops.",
          "A city renamed in your game shows its new name in its place popup as well as on the map.",
          "A city renamed by an event is renamed on the map more reliably.",
        ],
      },
    ],
  },
  {
    // A capital a country named was never starred on the map (Discord spike, 2026-10-27).
    id: "2026-10-founded-countries",
    kind: "minor",
    date: "2026-10-27",
    banners: [
      {
        title: "Your country, your mail",
        items: [
          "The new country's leader, government and goals are written from your story, as for any country the world founds.",
          "A city a country makes its capital now gets the capital's gold star on the map.",
        ],
      },
    ],
  },
  {
    // A few panels showed a game date as stored (0354-02-19), and the time skip's troop orders with a mistyped year
    // (2354 for 0354) were moved to the week's first day (Discord spike, 2026-10-27).
    id: "2026-10-dates-and-orders",
    kind: "minor",
    date: "2026-10-27",
    banners: [
      {
        title: "Dates as you read them",
        items: [
          "Dates in the institutions, projects, unit, place and country panels now read as 19 February 354, as the rest of the game writes them.",
          "A troop order given for a day of the week is now carried out on that day, even when its year came out wrong in the order.",
        ],
      },
    ],
  },
  {
    // The Workshop's selection gained a Fit to background slider: the selected regions' coasts are pulled onto
    // the shore the background picture, reference image or basemap shows (2026-10-27).
    id: "2026-10-fit-to-background",
    kind: "minor",
    date: "2026-10-27",
    banners: [
      {
        title: "Coasts that follow the map",
        items: [
          "In the map editor, select regions and slide Fit to background: their coasts move onto the shoreline your background picture shows.",
          "It works on your own map picture and the reference image you trace, and on the built-in basemaps where your regions already cover the land.",
          "The further you slide, the further a coast may move to find the shore. Slide back to Off to put it back, or undo it like any edit.",
          "Only coasts move: a border between two land regions keeps its line, and only its end slides onto the shore, so neighbours still meet.",
        ],
      },
    ],
  },
  {
    id: "2026-10-peace-and-weariness",
    kind: "minor",
    date: "2026-10-26",
    banners: [
      {
        title: "Peace, weariness and the phone",
        items: [
          "Once a war ends in peace, the War Room button for it goes away straight away.",
          "Calls to arms in a war that has ended lapse, so leaving one unanswered no longer costs you reputation.",
          "Peace terms show your own country's war weariness beside your enemy's, with a word for how weary each is.",
          "Listening in on a region now opens on its country's feed first.",
        ],
      },
    ],
  },
  {
    // Claude Opus 5.5 and Sonnet 5.5 refused forced tool choice and temperature (test sessions, 2026-10-26).
    id: "2026-10-newer-claude",
    kind: "minor",
    date: "2026-10-26",
    banners: [
      {
        title: "Newer Claude models",
        items: [
          "Claude Opus 5.5 and Sonnet 5.5 now answer every task: time skips and country sheets no longer fail when they turn down settings older models took.",
        ],
      },
    ],
  },
  {
    // A scenario whose oceans are regions of their own put a new fleet past the map's bottom edge: the placer took
    // the sea for "where no region is" (Discord spike, fantasy scenario, 2026-10-26).
    id: "2026-10-fleets-at-sea",
    kind: "minor",
    date: "2026-10-26",
    banners: [
      {
        title: "Fleets set sail on the right water",
        items: [
          "On maps where the seas are drawn as regions of their own, a new or moved fleet could be put past the edge of the map, where no one could see it.",
          "Fleets now go to the water off their coast, inside the map, and sea regions count as sea when the game places ships and armies.",
        ],
      },
    ],
  },
  {
    // A player at war with Ireland had no War Room: the war was kept as Britain and Ireland against "1" and "2"
    // (battle-of-europe-session-2, 2026-10-25).
    id: "2026-10-war-sides",
    kind: "minor",
    date: "2026-10-25",
    banners: [
      {
        title: "Wars have the right sides",
        items: [
          "A war you declared could be recorded with you and your enemy on the same side, so no front opened and the War Room button never appeared.",
          "Such a war is now read the right way round when your game opens: its front opens on the next time skip, and with it the War Room.",
          "New wars can no longer be recorded that way.",
        ],
      },
    ],
  },
  {
    // "get rid of the idle troop animation that makes it look like they are at war or battling" (the owner, 2026-10-25).
    id: "2026-10-still-fronts",
    kind: "minor",
    date: "2026-10-25",
    banners: [
      {
        title: "Quiet fronts stay quiet",
        items: [
          "Between time skips, troops on a front no longer push forward and fall back, and the ground along it no longer flickers between the two sides' colours.",
          "A front now stands still until the next time skip, when what really happened is played out on the map as before.",
          "Nothing about the fighting itself has changed.",
        ],
      },
    ],
  },
  {
    // "the ai is mistaking itself as being the player country talking to the united states (its talking to washington
    // but it is playing the united states)" (the owner, 2026-10-25).
    id: "2026-10-own-voice",
    kind: "minor",
    date: "2026-10-25",
    banners: [
      {
        title: "Countries speak for themselves",
        items: [
          "Countries that write to you, or answer you in a conversation, are now told plainly which country they are and that you are the one they are writing to.",
          "A message shown as another country's should no longer read as your side of the exchange, such as the United States telling Washington to back off.",
          "This covers replies in your conversations, notes sent after events, and notes sent between turns.",
        ],
      },
    ],
  },
  {
    id: "2026-10-interactive-offers",
    kind: "minor",
    date: "2026-10-25",
    banners: [
      {
        title: "Interactive events, less often",
        items: [
          "A time skip now offers an interactive event about one skip in five: one in four when it has an event worth playing out, and never on the skip right after the last offer.",
          "A scene you play out no longer shortens the wait for the next offer.",
          "Campaigns that start on the same date no longer get their offers on the same skips.",
        ],
      },
    ],
  },
  {
    id: "2026-10-faster-updates",
    kind: "minor",
    date: "2026-10-25",
    banners: [
      {
        title: "Faster updates",
        items: [
          "An update found as the game opens no longer spends minutes going through every file you already have: it checks them against the list the last update left, in a second or two.",
          "Only what changed is downloaded, as before, and the game restarts on the new version.",
          "The first update after installing the game from its installer still goes through every file once.",
        ],
      },
    ],
  },
  {
    id: "2026-10-espionage-part-2",
    kind: "major",
    date: "2026-10-24",
    banners: [
      {
        theme: "espionage2",
        scene: "orders",
        title: "Espionage, Part 2",
        subtitle: "Orders in the dark",
        lead: "Your agents now take orders. Send them after a country's army or its science, or have them sabotage, recruit and assassinate: the world feels what they do, and unless one is caught and made to talk, never learns it was you.",
        sections: [
          {
            heading: "Orders",
            icon: "chess",
            items: [
              "Tell each network what to collect on: diplomacy, the military, research and technology, economic policy or internal politics.",
              "Order an operation: sabotage, recruit a source, assassinate, or anything else you can put in words.",
              "Each order shows its odds of success and its risk of capture before you give it.",
            ],
          },
          {
            heading: "In the world",
            icon: "eye",
            items: [
              "An operation is carried out during the next time skip, and the world reacts to what it did.",
              "An operation that is never traced is never tied to you: the world only sees what happened.",
              "A recruited source makes its network harder to catch, and its reports draw on what the source knows.",
              "How much of an intercept you can read now rests on your own service: a world-class one reads nearly every word, a weak one only scraps.",
            ],
          },
        ],
      },
      {
        theme: "espionage2",
        scene: "custody",
        title: "Not Every Agent Talks",
        subtitle: "Caught is not the same as identified",
        lead: "A captured agent is not always made to say who sent them. One who never talks dies under interrogation, and the trail ends there.",
        sections: [
          {
            heading: "Your agents",
            icon: "people",
            items: [
              "An agent of yours who is caught may die in custody without giving you away, and the country that caught them never learns who sent them.",
              "The Operations log in the Intelligence tab keeps what every operation came to.",
            ],
          },
          {
            heading: "Theirs",
            icon: "wall",
            items: [
              "A foreign agent your service catches is not always identified either: when they die under interrogation, there is no one to expel or turn.",
              "When your service does learn who sent them, you decide as before: expel them, or turn them.",
            ],
          },
        ],
        button: "To the field",
      },
    ],
  },
  {
    // "the deployment tool in the war room doesnt seem to work. it does draw the line, but the troops are never actually
    // deployed" (the owner, 2026-10-24).
    id: "2026-10-deploy-calls-up",
    kind: "minor",
    date: "2026-10-24",
    banners: [
      {
        title: "The Deploy tool deploys troops",
        items: [
          "In the War Room, drawing a deployment line or placing a swarm now calls up fresh troops there. They come in when time next passes.",
          "Choose how many formations to call up as you draw it. Leave it empty for as many as a usual draft, or put 0 to only move where new troops arrive.",
          "It works where your army is already large: only the men your country has left and the room along the front limit it.",
          "The deployment's card says how many are coming, how many came, or why none could be called up, such as no men left to serve.",
          "Levies, drafts and reinforcements still come in on the line or at the swarm's place afterwards.",
        ],
      },
    ],
  },
  {
    // "there is a report that on the android version during a time skip it just completely freezes permenantly and
    // you cant click any buttons or do anything" (the owner, 2026-10-23).
    id: "2026-10-skip-freeze",
    kind: "minor",
    date: "2026-10-24",
    banners: [
      {
        title: "Time skips no longer freeze",
        items: [
          "A time skip no longer freezes the game on phones in scenarios with many countries, vassals and treaties, such as 1836: The Victorian Era.",
          "Time skips are faster everywhere: the game works out who is who in the world's treaties and vassals once per check, and copies each country's politics far less often.",
          "Nothing in your games changes: the same countries, treaties and vassals, worked out faster.",
          "On a computer, an update found as the game opens no longer leaves its screen not responding.",
        ],
      },
    ],
  },
  {
    id: "2026-10-games-and-groups",
    kind: "minor",
    date: "2026-10-17",
    banners: [
      {
        title: "Games, groups and the map editor",
        items: [
          "Archiving or deleting the game you have open takes you back to the menu, an archived game can be deleted from its card, emptying Recently deleted works everywhere, and a diplomacy message's copy button stays while you reach for it. In the Actions tab, the suggested actions and your own open one at a time. Your own Agent can be OpenCode as well.",
          "Create a faction is now part of Play as a group, and choosing a group's area shows the country picker's map.",
          "The map follows the story: a country that replaces another takes its land, an annexation you order reaches the map when the turn tells it, a war under an armistice can still be settled, and a war fought overseas opens a battlefield where your troops stand on the enemy's land.",
          "The map editor is laid out anew in the menus' style, with its sidebar on the right or the left, quicker tools, smooth zooming even on very detailed maps, pasted regions kept to the map's own detail, a Simplify button, and fewer notes in the way. A new map starts on the world map, the hand-drawn one with the most regions, or on the legacy world map, Modern Day's own.",
          "The Community tab can show only the scenarios that begin between two dates, and publishing says when a scenario's file is too large for GitHub.",
          "Modern Day is played on the real world's provinces again, and campaigns begun on the hand-drawn map keep it as Modern Day (classic map); the Northern Forests climate zone is redrawn.",
        ],
      },
    ],
  },
  {
    id: "2026-10-country-picker-cards",
    kind: "minor",
    date: "2026-10-17",
    banners: [
      {
        title: "A bigger country picker",
        items: [
          "Choosing a country opens a larger picker: the map beside a list of the countries you can play.",
          "Each country in the list shows its flag where one is known, and its colour on the map.",
          "The map and the list use the scenario's own country colours.",
          "Scenario cards show their cover whole, with the name and description below it.",
          "Community cards line up, with their counts and buttons on one line at the bottom.",
        ],
      },
    ],
  },
  {
    // "make it so you can also deploy "armies" which are just groups of troops not arranged in a front", "a group
    // should also be run by a single general. using the deploy tool should give the option to do a front or swarm",
    // "troops should move independantly like they do in fronts", "JUST MAKE IT DEPLOY IN A GROUPED FORMATION TO
    // START. what happens after they are deployed is UP TO THE ENGINE AND THE PLAYERS ORDERS" (the owner, 2026-10-16).
    id: "2026-10-swarms",
    kind: "major",
    date: "2026-10-16",
    banners: [
      {
        theme: "swarms",
        title: "Swarms",
        subtitle: "Armies before there were fronts",
        lead: "Fronts have not always existed. Troops can now be deployed as a swarm: grouped together at one place under a general of their own, instead of strung along the border.",
        sections: [
          {
            heading: "A front or a swarm",
            icon: "flag",
            items: [
              "In the War Room the Deploy tool asks which: draw a line for a front, or click a place for a swarm.",
              "Your levies, drafts and reinforcements come in there grouped together, and join the swarm while it is near; once it has marched on, the next ones come in as a new swarm.",
            ],
          },
          {
            heading: "One general",
            icon: "people",
            items: [
              "Every swarm comes under a general of its own, who commands it as any general does: talk to him, light up his troops or pick them out.",
            ],
          },
          {
            heading: "Fought like any troops",
            icon: "swords",
            items: [
              "Once deployed, a swarm's troops are troops like any other: they move and fight one by one, as your orders and the battle decide.",
            ],
          },
          {
            heading: "Through the ages",
            icon: "book",
            items: [
              "In games set before 1900 a war's troops come as swarms; from 1900 on, along fronts.",
              "Scenario designers choose how their scenario's wars are fought, and how each side of a front it begins with is deployed.",
            ],
          },
          {
            heading: "The vault door",
            icon: "gear",
            items: [
              "The vault door now always opens the first game after an update. Its one setting, Every time the game opens, shows it at every start.",
              "The Economy tab opens again for every country: it no longer stops on a stat sheet error.",
            ],
          },
          {
            heading: "Military power",
            icon: "chess",
            items: [
              "Your military figures now change with what you do: training, new weapons, a bigger defence budget and a larger army raise them over the years, and losses and cuts lower them.",
            ],
          },
        ],
        button: "To the field",
      },
    ],
  },
  {
    // Beta's PR #884 (Briekdr), and alpha's last two, brought into the lab on 2026-10-15. A minor update
    // ("diplomatic map should be marked a minor update", the owner).
    id: "2026-10-diplomatic-map",
    kind: "minor",
    date: "2026-10-16",
    banners: [
      {
        title: "The Diplomatic Map",
        items: [
          "Switch the map between Political and Diplomatic at the bottom right, under the advisor's button, or in Settings, Map: every country, and the ground taken on a battlefield, takes the colour of where it stands with you.",
          "A legend beside the switch says what each colour means.",
          "Each time the game opens, the map starts on Political.",
          "Settings has a Sound page for the music, its volume and the sound effects.",
          "Dragging the map glides more smoothly, and the map no longer stays stuck on loading when a tile server stalls.",
          "Your AI key can be shown or hidden as you type it.",
        ],
      },
    ],
  },
  {
    id: "2026-10-wars-and-fronts-2",
    kind: "major",
    date: "2026-10-16",
    banners: [
      {
        theme: "warsAndFronts2",
        scene: "front",
        title: "Wars and Fronts",
        subtitle: "Part Two",
        lead: "Wars are fought by troops who tire, dig in and run short, under skies that turn, against a commander who thinks days ahead.",
        sections: [
          {
            heading: "Troops of flesh and steel",
            icon: "swords",
            items: [
              "Troops tire as they march and fight, and recover at rest.",
              "Armies muster over weeks, along a curve the scenario sets.",
              "Each country fights with its own quality, technology, arms and mix of units.",
              "Every country is rated against every other: how well it fights, its army, navy and air force, what its forces have to spend, and its people. Its strength comes from these, never from how much land it holds.",
              "Scenario designers rate every country at once, twenty to a request, and the ratings ship with the scenario. A country left out is rated when the game first needs it.",
              "Ground on a battlefield changes hands only where troops take it.",
            ],
          },
          {
            heading: "Walls and supplies",
            icon: "wall",
            items: [
              "Fortified lines must be broken through, and take time to build.",
              "War resources pay for fortifications, and your economy refills them.",
              "Harsh winters wear down every army caught out in them.",
            ],
          },
          {
            heading: "In the air and at sea",
            icon: "plane",
            items: [
              "Every country at war flies its air arm over its battlefields, to support its troops, strike the enemy's, or stay grounded.",
              "You can see each side's aircraft circling over the battlefields.",
              "Command your fleets: patrol, blockade, escort or seek battle.",
            ],
          },
          {
            heading: "The War Room",
            icon: "flag",
            items: [
              "Fortify: draw a line to be built and choose how strong.",
              "Deploy: draw where your reinforcements come in.",
              "Fleets: give your ships their stations and orders.",
              "Supply: see which of your ground is stretched or cut off, and which of theirs is cut off.",
              "Rehearse the next week: see where the front would be with your orders as they stand.",
              "Weather ahead: the next two weeks of weather, to time an offensive by.",
            ],
          },
        ],
      },
      {
        theme: "warsAndFronts2",
        scene: "commander",
        title: "A Commander Worth Fearing",
        subtitle: "It thinks days ahead",
        lead: "The countries you fight no longer follow a script. They plan.",
        sections: [
          {
            heading: "It looks ahead",
            icon: "chess",
            items: [
              "Like a chess engine, it rehearses a dozen plans days ahead on a copy of the battle and chooses the best.",
              "It weighs ground, towns, capitals, its strength, its supply, and troops nearly cut off.",
            ],
          },
          {
            heading: "Trained to win",
            icon: "star",
            items: [
              "Trained in thousands of fair duels on random battlefields, it beats every simple habit, from always attacking to always digging in.",
              "A deep thrust into its land is answered with a counter-offensive.",
              "It thinks away from the page, so the map stays smooth while it does, and on a computer it thinks the next turn through while you read.",
              "On a computer with several cores it weighs its plans on all of them at once, so war turns go faster.",
            ],
          },
          {
            heading: "Scripted wars",
            icon: "flag",
            items: [
              "Scenario designers can script a war to be lost: that side is led by a plainer commander, and good play can still turn it.",
              "The difficulty sets who you face: a plainer commander on the easy levels, one that weighs how you are likely to answer on the hard ones.",
            ],
          },
          {
            heading: "Know your enemy",
            icon: "eye",
            items: [
              "An agent in one of their countries finds out what their staff plans, and your aircraft see where it sends its troops.",
              "When a war ends, an after-action report tells its turning points, and stays to be read again.",
            ],
          },
        ],
        button: "To the front",
      },
    ],
  },
  {
    // An update of its own, with its own look: "have the weather update have its own custom major update post rather
    // than being on the main wars and fronts post" (the owner, 2026-10-16).
    id: "2026-10-seasons-and-weather",
    kind: "major",
    date: "2026-10-16",
    banners: [
      {
        theme: "seasonsAndWeather",
        title: "Seasons and Weather",
        subtitle: "The ground fights back",
        lead: "The world has climates now. Every front lives through its seasons, and the weather decides as much as the generals do.",
        sections: [
          {
            heading: "Climate zones",
            icon: "map",
            items: [
              "Seasons and weather follow climate zones drawn across the world: the real world's on the built-in maps, or a scenario's own.",
              "Clear skies are the commonest weather of all.",
            ],
          },
          {
            heading: "Weather that fights",
            icon: "rain",
            items: [
              "Rain, storms, mud, snow, blizzards, frost, heat and fog slow armies, blunt attacks and wear troops down.",
              "The weather is drawn on the map in each zone's own shape, at every zoom; Settings has a switch for it.",
              "Your advisor knows the season and the weather.",
            ],
          },
          {
            heading: "Ice and ground",
            icon: "snow",
            items: [
              "Lakes and seas can freeze hard enough to cross, and thaw under those still on them.",
              "Rough ground slows an advance.",
            ],
          },
        ],
        button: "Into the weather",
      },
    ],
  },
  {
    // Released before there was a notice to tell of it: "even though its already been released, make a banner for
    // the music update with large floating musical notes that are interactive and music themed" (the owner).
    id: "2026-10-music",
    kind: "major",
    date: "2026-10-13",
    banners: [
      {
        theme: "music",
        title: "The Music",
        subtitle: "A score for every campaign",
        lead: "Open Historia has a soundtrack now, music by Scott Buckley that follows you from the menu to the battlefield.",
        sections: [
          {
            heading: "From the menu to the front",
            icon: "note",
            items: [
              "The menu plays Passage Of Time and Clear Skies, taking turns each visit.",
              "Opening a game swells into the piece's own dramatic build, timed to land as the map appears.",
              "The War Room and the battlefields play Legionnaire and Vanguard.",
            ],
          },
          {
            heading: "Music for scenarios",
            icon: "book",
            items: [
              "Scenario designers choose tracks for loading, for play, for war and for battle from the community hub's music.",
              "A track you already have is never downloaded twice.",
            ],
          },
          {
            heading: "Yours to control",
            icon: "gear",
            items: [
              "Settings show what is playing and who made it.",
              "Sound effects, the vault door's among them, can be turned off.",
            ],
          },
        ],
        button: "Play on",
      },
    ],
  },
];

// Newest first (an update of the same day keeps its place).
const newestFirst = (list) => Object.freeze(list
  .map((update, index) => ({ update, index }))
  .sort((a, b) => (a.update.date < b.update.date ? 1 : a.update.date > b.update.date ? -1 : a.index - b.index))
  .map(({ update }) => update));
// Every update, for the history.
export const UPDATES = newestFirst([...RELEASES, ...NEW_UPDATES, ...PAST_UPDATES]);
// The updates a device may be shown behind the door: those written as notices, never the history from before
// notices existed (notesPast.js). "make sure people ONLY see the update popup things for the updates that are
// actually being added (plus the music one), not for every update in the history" (the owner, 2026-10-16).
export const NOTICE_UPDATES = newestFirst([...RELEASES, ...NEW_UPDATES]);
