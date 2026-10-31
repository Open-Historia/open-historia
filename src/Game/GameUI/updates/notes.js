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

// The updates since the notice existed, newest first (new ones at the top); with the past (notesPast.js) they
// make UPDATES, newest first by date.
const NEW_UPDATES = [
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
    id: "2026-10-discord-invites",
    kind: "minor",
    date: "2026-10-29",
    banners: [
      {
        title: "Invite friends from Discord",
        items: [
          "In a shared game, your Discord status shows the game as joinable: invite a friend from Discord and they get a popup in their game asking them to join.",
          "When someone asks to join your shared game from your Discord profile, you get a popup to accept or decline.",
          "In the desktop app, with Show what I am playing on Discord switched on.",
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
          "A region renamed by an event shows its new name on its place card and in each country's list of territory, for every player in a shared game.",
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
    // (Discord spike, 2026-10-28). Then (2026-10-29): wild land one sea away counts as within reach by ship, a
    // patrol keeps to its own ground (a fleet was drifting onto the coast), and in a shared game a player's letter
    // carries the game date, a letter to an AI government waits while a week is played, and each player has an
    // advisor of their own government who brings them its secrets.
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
          "In shared games, each player has an advisor from their own government, who brings them in Diplomacy what it learns in secret.",
          "In shared games, letters between players now show the game date.",
          "In shared games, letters to countries the AI plays, and new goals, can't be sent while a week is being played: send them once its news is in. Letters between players still go through.",
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
    // A shared game's players whose groups founded countries stayed seated on the groups, so the AI played the new
    // countries' armies and wars and their secrets reached no one; every AI letter went to the host's seat; and a
    // capital a country named was never starred on the map; and the time skip's prompt named every player's
    // polity together as if one ("Northreach and Eastwatch is played by a human") (Discord spike, 2026-10-27).
    id: "2026-10-founded-countries",
    kind: "minor",
    date: "2026-10-27",
    banners: [
      {
        title: "Your country, your mail",
        items: [
          "In a shared game, when your people found a country of their own and hand it their land, you now play that new country from then on.",
          "Its armies, its wars and what only its government knows are yours, along with your queued orders and conversations. Before, the AI took the new country over.",
          "The new country's leader, government and goals are written from your story, as for any country the world founds.",
          "In a shared game, each letter a government writes now reaches the player it was written to. Before, every letter went to the host.",
          "A city a country makes its capital now gets the capital's gold star on the map.",
          "In a shared game, the AI now treats each player's country as a country of its own, with its own aims, even when two players are at war. Before, it could read them as one.",
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
    // Every time skip event was shown to every player of a shared game, so a covert order's outcome reached its
    // targets and rivals (Discord spike, 2026-10-26).
    id: "2026-10-shared-secrets",
    kind: "minor",
    date: "2026-10-26",
    banners: [
      {
        title: "Secrets stay secret in shared games",
        items: [
          "When several people play, what your government does in secret is now told to you alone: the other players no longer read the outcome of your covert orders.",
          "Anyone in on the secret, or who uncovers it, is told too.",
          "What others could see happen, such as ships sailing or a minister dismissed, can still reach them as news of its own.",
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
          "In a shared game, a guest's institution business no longer takes the host's own threads with it.",
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
export const UPDATES = newestFirst([...NEW_UPDATES, ...PAST_UPDATES]);
// The updates a device may be shown behind the door: those written as notices, never the history from before
// notices existed (notesPast.js). "make sure people ONLY see the update popup things for the updates that are
// actually being added (plus the music one), not for every update in the history" (the owner, 2026-10-16).
export const NOTICE_UPDATES = newestFirst(NEW_UPDATES);
