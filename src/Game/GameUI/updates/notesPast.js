/*! Open Historia — the updates before there were notices, as the notice tells them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The two months of updates before the notice behind the vault door existed
// (2026-08-15 to 2026-10-14), written from what reached players (merged pull
// requests and the release lines), so the history (UpdateHistory.jsx) shows
// every update. "look through every commit to the repo in the past 2 months
// to fill the time line and make the update banners for every update (not
// super small changes but do include minor updates)" (the owner, 2026-10-15).
//
// Their major banners are dressed by the chronicle (themes/Chronicle.jsx), each
// in its own palette, lettering and moving picture (`scene`); the battlefields
// of Wars and Fronts Part One by its own Part Two's theme. `channel` says where
// an update first reached players when it was not the stable release.
//
// NEW UPDATES DO NOT GO HERE: they go at the top of notes.js.

export const PAST_UPDATES = Object.freeze([
  {
    "id": "2026-10-war-and-peace",
    "kind": "major",
    "date": "2026-10-14",
    "channel": "beta",
    "banners": [
      {
        "theme": "chronicle",
        "scene": "fleet",
        "palette": {
          "accent": "#c9b458",
          "ground": "#111316",
          "font": "serif"
        },
        "title": "War and Peace",
        "subtitle": "Wars end, at sea and at the table",
        "lead": "Wars now wear countries down until someone asks for terms, fleets fight their own battles, and alliances pull their members in.",
        "sections": [
          {
            "heading": "War at sea",
            "icon": "ship",
            "items": [
              "Hostile fleets within reach of each other fight battles the game decides day by day, and a marker shows where.",
              "A beaten fleet breaks off or is sunk; a fleet told to withdraw sails for its own coast.",
              "A country at war with a coast and no navy raises a Home Fleet.",
              "Fleets on blockade cut into a country's economy and starve its war on land."
            ]
          },
          {
            "heading": "Weariness and peace",
            "icon": "people",
            "items": [
              "Countries at war grow weary with their losses, call-ups, lost ground and blockades, and recover in peace.",
              "A country losing its war, or tired of it, may offer you peace: accept it or decline.",
              "Terms settle the ground, as held or restored, and reparations paid over the years.",
              "Propose peace yourself, but an enemy that is not yet weary refuses even a white peace."
            ]
          },
          {
            "heading": "Alliances that bind",
            "icon": "flag",
            "items": [
              "Alliances, defence pacts and guarantees call their members in when one of them is attacked.",
              "You are asked to honour the alliance; leaving the call unanswered for two turns breaks the treaty and costs reputation."
            ]
          },
          {
            "heading": "The standings",
            "icon": "star",
            "items": [
              "A new Ranking tab in Stats sets the countries side by side.",
              "Battle reports now say the right way round who surrounded whom."
            ]
          }
        ]
      },
      {
        "theme": "chronicle",
        "scene": "lens",
        "palette": {
          "accent": "#7fb069",
          "ground": "#0f140e",
          "font": "serif"
        },
        "title": "Detailed Maps",
        "subtitle": "Worlds that stay sharp up close",
        "lead": "A new kind of scenario map: large terrain maps that keep their detail however far you zoom in, starting with a Game of Thrones world.",
        "sections": [
          {
            "heading": "Sharp at every zoom",
            "icon": "map",
            "items": [
              "On the desktop app, a detailed map is drawn over a scenario's own map and stays sharp up close.",
              "Each one downloads once, is checked, and is shared by every scenario that uses it.",
              "On the website, on Android, or without the download, you see the drawn map underneath."
            ]
          },
          {
            "heading": "For scenario designers",
            "icon": "book",
            "items": [
              "Share a detailed map on the community hub, which checks every file before listing it.",
              "A scenario keeps one list of its maps: a starting map and every map players may switch to.",
              "Picking a built-in map in the Map Editor adds it to that list instead of replacing the scenario's own."
            ]
          },
          {
            "heading": "In your game",
            "icon": "gear",
            "items": [
              "Settings → Map lists the scenario's maps by name, and your pick is kept for that game on this device.",
              "Under Detailed maps, a line says which are missing or out of date, with a list to download them."
            ]
          }
        ]
      },
      {
        "theme": "chronicle",
        "scene": "vault",
        "palette": {
          "accent": "#b8c2cc",
          "ground": "#101214",
          "font": "stencil"
        },
        "title": "Through the Vault Door",
        "subtitle": "A new way into the game",
        "lead": "The game now opens on a steel vault door. Turn its wheel and the main menu is waiting behind it.",
        "sections": [
          {
            "heading": "The door",
            "icon": "wall",
            "items": [
              "After the loading screen, a vault door with the Open Historia mark as its wheel stands before the menu.",
              "Click it: the wheel turns, the bolts draw back, and the door opens in three heavy leaves.",
              "A switch in Settings turns the door off, and with Reduce motion it simply fades away."
            ]
          },
          {
            "heading": "The main menu",
            "icon": "book",
            "items": [
              "No game loads at start-up any more: your game opens when you press Play.",
              "On a wide screen the menu's pages sit on a rail down the left, each with its own header and buttons.",
              "Every dropdown list is dark with light text, and scrollbars are thin and dark."
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "2026-10-privacy-first",
    "kind": "minor",
    "date": "2026-10-14",
    "banners": [
      {
        "title": "Privacy First",
        "items": [
          "The website and the game count nothing until you say yes, and you can take that yes back at any time.",
          "A privacy policy is linked from every page of the site, the game's entry screen and Settings.",
          "Scenarios you post or share are released under CC BY 4.0, and the game says so where you publish.",
          "The Actions panel gives your submitted actions more room, with Brainstorm and AI Suggestions side by side.",
          "If the map loses WebGL, the game keeps trying for half a minute and offers a Reload button.",
          "The website offers the beta download beside every stable one."
        ]
      }
    ]
  },
  {
    "id": "2026-10-battlefields",
    "kind": "major",
    "date": "2026-10-11",
    "channel": "beta",
    "banners": [
      {
        "theme": "warsAndFronts2",
        "scene": "front",
        "title": "Wars and Fronts",
        "subtitle": "Part One: the battlefields",
        "lead": "The game now fights its land wars itself: hundreds of troops a side, moving over real ground, deciding who holds what before the story is told.",
        "sections": [
          {
            "heading": "Battlefields",
            "icon": "swords",
            "items": [
              "Where two sides at war hold touching land, a battlefield opens and each side is given troops by its size.",
              "Troops paint the ground they cross; pockets, sieges and supply decide who holds it.",
              "A region changes hands in name once most of it is held, and on the map once all of it is.",
              "Each period is fought before its story is written, so the story tells the war as it went, at no extra request."
            ]
          },
          {
            "heading": "The War Room",
            "icon": "chess",
            "items": [
              "A red War Room button appears while your troops are on a battlefield.",
              "Talk to your generals, or pick troops and send them along a route you draw, to advance, dig in, hold or withdraw.",
              "Troops can be carried by ship, rail or air, and missile and bombing strikes fly across the map.",
              "Orders you type as actions reach your troops in the same time skip."
            ]
          },
          {
            "heading": "Enemies with a plan",
            "icon": "flag",
            "items": [
              "A side nobody plays decides for itself to attack, probe, hold or dig in, by its strength and by who began the war.",
              "Battlefields start with half as many troops; draft more or send reinforcements to a front through your actions.",
              "Scenario designers can start a scenario with fronts of its own, each keeping the stance its author gave it."
            ]
          },
          {
            "heading": "Men, money and odds",
            "icon": "people",
            "items": [
              "Raising troops draws on a country's people, and the men lost in war come off its population.",
              "A country's economy and budget weigh in its military strength.",
              "Statistics are kept for every country you come into conflict with, and tracking runs every six months by default.",
              "Difficulty now decides how things go for you, from Very Easy, where almost everything goes well, to Impossible."
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "2026-10-story-moves-the-map",
    "kind": "major",
    "date": "2026-10-10",
    "banners": [
      {
        "theme": "chronicle",
        "scene": "press",
        "palette": {
          "accent": "#e2734a",
          "ground": "#160f0c",
          "font": "serif"
        },
        "title": "The Story Moves the Map",
        "subtitle": "One request, every consequence",
        "lead": "A time skip is now a single AI request. Its events arrive one by one, and each carries its own consequences onto the map.",
        "sections": [
          {
            "heading": "One request a skip",
            "icon": "star",
            "items": [
              "Every time skip is one request, and its events appear one at a time as they are written.",
              "Each event brings its own consequences: units, structures, land, the Projects board and your spies' reports."
            ]
          },
          {
            "heading": "Places the story names",
            "icon": "map",
            "items": [
              "The game tells a region from a country of the same name, like Georgia, when an event names it.",
              "Armies move at a realistic pace, and a unit an event moved keeps moving for the rest of the skip.",
              "Captures an event tells of reach the map, and territories like Puerto Rico and Greenland are named in their own right.",
              "Wars of real history already under way, like those in Syria and Iraq, are kept when the story first reports their fighting."
            ]
          },
          {
            "heading": "Groups",
            "icon": "people",
            "items": [
              "Groups such as a cartel, a militia or an outbreak control areas they do not own, outlined and tinted on the map.",
              "The AI creates, moves and ends groups as the story goes, and a region's card shows who controls it.",
              "Scenario designers draw groups in the Workshop's Groups panel."
            ]
          }
        ]
      },
      {
        "theme": "chronicle",
        "scene": "projection",
        "palette": {
          "accent": "#8fd14f",
          "ground": "#111509",
          "font": "sans"
        },
        "title": "Maps of Every Shape",
        "subtitle": "Galaxies, fantasy worlds and flat sheets",
        "lead": "A scenario's map can now use the projection it was drawn in, so flat maps and invented worlds arrive undistorted.",
        "sections": [
          {
            "heading": "Projections",
            "icon": "map",
            "items": [
              "Choose from ten projections, from Mercator and Robinson to Mollweide, or a Freeform flat sheet of any shape.",
              "The Workshop converts a map between projections, and a basemap picture can be any shape.",
              "A suggested change of projection arrives as one change, not one for every region."
            ]
          },
          {
            "heading": "Your scenario's own map",
            "icon": "book",
            "items": [
              "A scenario drawn over a picture of its own keeps it, whatever basemap you pick in Settings.",
              "The AI can place things a stated distance and direction from a place it knows."
            ]
          },
          {
            "heading": "Generate a world",
            "icon": "star",
            "items": [
              "The map editor's Generate drawer now builds fantasy maps in the desktop app.",
              "The generator ships inside the installer and reaches no outside site."
            ]
          }
        ]
      },
      {
        "theme": "chronicle",
        "scene": "chunks",
        "palette": {
          "accent": "#e3c565",
          "ground": "#13120c",
          "font": "rounded"
        },
        "title": "Updates in Moments",
        "subtitle": "Smaller downloads, checked files",
        "lead": "Keeping Open Historia up to date is quicker, and every file from the community hub is checked before you get it.",
        "sections": [
          {
            "heading": "Desktop updates",
            "icon": "gear",
            "items": [
              "Opening the desktop game installs a waiting update first, or lets you play at once while it downloads.",
              "Updates fetch only the pieces of the app that changed, instead of the whole installer.",
              "The stable app offers the beta after an install and after each update."
            ]
          },
          {
            "heading": "A safer community hub",
            "icon": "book",
            "items": [
              "The Community tab lists scenarios in one quick request and downloads only copies the hub has checked.",
              "A scenario downloaded before its files were checked asks to be updated."
            ]
          },
          {
            "heading": "Look and feel",
            "icon": "star",
            "items": [
              "The interface is flat: every surface is one colour, and only a scenario's Accent glows on its card.",
              "Games saved under the website's old http address move across to https by themselves.",
              "A model on a local AI server is no longer refused after you reload it with a bigger context window."
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "2026-10-play-together",
    "kind": "major",
    "date": "2026-10-06",
    "channel": "beta",
    "banners": [
      {
        "theme": "chronicle",
        "scene": "phone",
        "palette": {
          "accent": "#ff8a5c",
          "ground": "#170f0b",
          "font": "rounded"
        },
        "title": "Listen In",
        "subtitle": "Hear the street",
        "lead": "Open a phone and read what ordinary people in a place are posting about the day's news, and about nothing at all.",
        "sections": [
          {
            "heading": "The phone",
            "icon": "people",
            "items": [
              "A Listen in button on a region's card and in a country's panel opens a phone of posts by people who live there.",
              "Most posts are the day's events as they reach a kitchen table; about a quarter are about nothing in particular.",
              "A region's phone has a second tab for the country that holds it, and earlier feeds stay below by day."
            ]
          },
          {
            "heading": "What it costs",
            "icon": "gear",
            "items": [
              "Each new feed is one AI request, asked only when a place has nothing kept for that day or you ask for more.",
              "Turn it off in the Features tab of a scenario or a game."
            ]
          },
          {
            "heading": "Play as a group",
            "icon": "flag",
            "items": [
              "The new-game picker's third tab, Play as a group, starts a game leading one of the scenario's groups or a new one.",
              "The AI then treats you as the group's leader, not a state's, and knows where your group holds."
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "2026-10-held-turns",
    "kind": "minor",
    "date": "2026-10-03",
    "channel": "beta",
    "banners": [
      {
        "title": "Turns You Can Trust",
        "items": [
          "What you decide in an interactive event now reaches the map: units, land and structures.",
          "When the checks after a time skip fail, the turn waits for you to retry them, continue without them or discard it.",
          "Rollback now shows on every turn.",
          "A country at war with no troops gets a unit near the fighting, and fleets stay at sea.",
          "The main menu's Settings hold what applies to every game; each game's own options stay in its ☰ menu.",
          "Scenario designers can keep a scenario's pre-history, so a new game starts without asking the AI for one."
        ]
      }
    ]
  },
  {
    "id": "2026-09-suggest-changes",
    "kind": "major",
    "date": "2026-09-28",
    "banners": [
      {
        "theme": "chronicle",
        "scene": "scroll",
        "palette": {
          "accent": "#3fb98a",
          "ground": "#0f1a17",
          "font": "serif"
        },
        "title": "Suggest a Change",
        "subtitle": "Improve the scenarios you play",
        "lead": "Edited a community scenario? Send your changes to its author, who can accept or reject each one, like tracked changes.",
        "sections": [
          {
            "heading": "Suggested changes",
            "icon": "book",
            "items": [
              "Suggest changes lists what you changed against the original post and saves just those changes in a small file.",
              "You post it as a comment on the scenario's community page.",
              "The author's game notices it, and they accept or reject each change one by one."
            ]
          },
          {
            "heading": "Elsewhere",
            "icon": "people",
            "items": [
              "Discord shows Playing Open Historia, with your country, scenario, in-game date and time played.",
              "It works from the desktop app and the downloadable server; outside a game it reads In the main menu.",
              "When Android stops the app's page to free memory, the app rebuilds it instead of closing."
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "2026-09-political-world",
    "kind": "major",
    "date": "2026-09-26",
    "channel": "beta",
    "banners": [
      {
        "theme": "chronicle",
        "scene": "chamber",
        "palette": {
          "accent": "#c8a85a",
          "ground": "#15130f",
          "font": "serif"
        },
        "title": "The Political World",
        "subtitle": "Governments with a will of their own",
        "lead": "Countries now have political forces, a rank among the powers and institutions that meet, debate and vote, and some answer to an overlord.",
        "sections": [
          {
            "heading": "Politics behind every flag",
            "icon": "people",
            "items": [
              "A scenario can generate its Political World: each country's government, leaders and political forces.",
              "Generation shows each country's progress, keeps what is done, and offers Continue Generation for any that need another try.",
              "The Country panel shows whether a country is a Major, Regional or Minor power."
            ]
          },
          {
            "heading": "Institutions",
            "icon": "book",
            "items": [
              "Institutions have Councils where members propose, debate and vote, and AI members cast their own ballots.",
              "Governments apply or are invited to join, as observers, candidates or full members.",
              "Your advisor knows your institutions and can draft your business there."
            ]
          },
          {
            "heading": "Puppet states",
            "icon": "flag",
            "items": [
              "A country can direct another as a protectorate, puppet state or client state, without the puppet leaving the map.",
              "Only the overlord sees a puppet's loyalty; collapsed loyalty can end in revolt, and annexing a puppet costs reputation.",
              "A covert puppet stays secret unless an agent inside learns of it.",
              "Demands between you and your overlord or puppet arrive as a card: Accept, Refuse or offer your own terms."
            ]
          },
          {
            "heading": "Also on the beta",
            "icon": "gear",
            "items": [
              "The library is simpler: Continue Playing and All Games, Recently Used and the Scenario Library, Featured and Browse Community.",
              "Cancel all AI requests stops everything at once, and Check for updates looks for a new version."
            ]
          }
        ]
      },
      {
        "theme": "chronicle",
        "scene": "gears",
        "palette": {
          "accent": "#d0654f",
          "ground": "#170e0c",
          "font": "serif"
        },
        "title": "History on Cue",
        "subtitle": "Scripted events with conditions",
        "lead": "Scenario designers can script events that fire only when the world meets their conditions, with the chance they choose.",
        "sections": [
          {
            "heading": "Conditions and chance",
            "icon": "book",
            "items": [
              "An event can wait for all, any, or at least some of its conditions, with its own chance of happening.",
              "Conditions read the world: whether a country exists, sits in an institution or answers to an overlord.",
              "Each outcome is settled once and survives saving and reloading, with no rerolls."
            ]
          },
          {
            "heading": "A workspace for authors",
            "icon": "map",
            "items": [
              "A Scripted Events Manager lists events with search, filters, date order and short trigger summaries.",
              "Duplicate or remove events, and set their chance with a draggable percentage."
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "2026-09-every-language",
    "kind": "major",
    "date": "2026-09-26",
    "banners": [
      {
        "theme": "chronicle",
        "scene": "scripts",
        "palette": {
          "accent": "#7ccfb8",
          "ground": "#0d1715",
          "font": "serif"
        },
        "title": "A World in Every Language",
        "subtitle": "Twenty-two languages, built in",
        "lead": "The whole game now ships translated into 22 languages, so in your language the interface costs no AI request.",
        "sections": [
          {
            "heading": "Your language",
            "icon": "book",
            "items": [
              "Every screen, menu and message ships translated into 22 languages, from Arabic to Vietnamese.",
              "The guidance behind the AI's instructions ships translated as well.",
              "Only a scenario's own words, like its names and descriptions, are translated by your AI, once.",
              "Country labels on the map can be written in any script."
            ]
          },
          {
            "heading": "Learn the game",
            "icon": "star",
            "items": [
              "A player wiki at openhistoria.com/wiki explains every part of the game.",
              "Settings marks the languages that come built in."
            ]
          }
        ]
      },
      {
        "theme": "chronicle",
        "scene": "press",
        "palette": {
          "accent": "#d98c4a",
          "ground": "#17110c",
          "font": "serif"
        },
        "title": "History Takes Its Course",
        "subtitle": "Time skips that read like the record",
        "lead": "Time skips now follow real history wherever your campaign has not changed it, and tell each event like a news story.",
        "sections": [
          {
            "heading": "Real history",
            "icon": "book",
            "items": [
              "Every country, person and process you have not changed does what it really did.",
              "Skips write more events: three to six for a week, ten to fifteen for a month, about three dozen for a year.",
              "Rivals can move against you first, and when a fight starts, both sides fight."
            ]
          },
          {
            "heading": "Events worth reading",
            "icon": "star",
            "items": [
              "An event's title is its headline and its description the article beneath, in paragraphs the timeline shows.",
              "A game opens under its scenario's cover art."
            ]
          },
          {
            "heading": "Steadier play",
            "icon": "gear",
            "items": [
              "Gemini players now start on Flash-Lite, which is busy less often, with a backup behind it.",
              "New games on Gemini no longer fail while writing the pre-game history.",
              "Saving a scenario in the Workshop no longer crashes to a grey screen or takes forty minutes."
            ]
          }
        ]
      },
      {
        "theme": "chronicle",
        "scene": "phone",
        "palette": {
          "accent": "#9ad16b",
          "ground": "#10160d",
          "font": "rounded"
        },
        "title": "In Your Pocket",
        "subtitle": "The full Android app",
        "lead": "Android now carries the whole game on the phone, map included, with a beta app beside the stable one.",
        "sections": [
          {
            "heading": "The Android app",
            "icon": "map",
            "items": [
              "The world map is inside the app, so a game plays without finding a server, even in airplane mode.",
              "Exports and the log file save to your phone, and AI models on your own network can be reached.",
              "A second app, Open Historia Beta, installs beside the stable one.",
              "In the background the app rests, so it no longer drains the battery."
            ]
          },
          {
            "heading": "Made for phones",
            "icon": "people",
            "items": [
              "On a phone the advisor opens full-screen and closes again, and Back closes whatever is open.",
              "Buttons, panels and grids fit a phone's screen, and the country picker holds still when the keyboard comes up.",
              "The browser demo no longer crashes on iPhone as its loading screen ends."
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "2026-09-living-world",
    "kind": "major",
    "date": "2026-09-20",
    "banners": [
      {
        "theme": "chronicle",
        "scene": "desk",
        "palette": {
          "accent": "#e0a43a",
          "ground": "#14110c",
          "font": "stencil"
        },
        "title": "Run the Country",
        "subtitle": "Board, armies, advisor",
        "lead": "Your government's long projects, its armies and its advisor now work together, and every turn moves all three.",
        "sections": [
          {
            "heading": "Projects & Operations",
            "icon": "chess",
            "items": [
              "A Projects & Operations board tracks programmes, construction, military and covert operations, with milestones and progress.",
              "Events and your advisor move the board; you can sort, prioritise or abandon your own entries."
            ]
          },
          {
            "heading": "Units that follow the story",
            "icon": "swords",
            "items": [
              "Every unit has a strength, a make-up such as two frigates, and a posture like patrol, blockade or assaulting.",
              "Moves take realistic travel time; the rest of the way becomes a standing order carried on each turn."
            ]
          },
          {
            "heading": "Advisor and statistics",
            "icon": "people",
            "items": [
              "Your advisor can queue, edit and remove your actions, and recommend where to deploy units.",
              "Letters the advisor drafts get a Send button that delivers them to that country.",
              "The Stats panel shows population and GDP by territory, the economy, history and current conflicts."
            ]
          },
          {
            "heading": "AI that keeps going",
            "icon": "gear",
            "items": [
              "A Fallback list of backup models, from any provider, takes over when one runs out or is busy.",
              "Long time skips are written in parts, and a part that fails is held for a retry instead of lost.",
              "Set up your AI in one prompt, with a tutorial video, and pick a model for each task.",
              "Export a game to a file and import it on another computer."
            ]
          }
        ]
      },
      {
        "theme": "chronicle",
        "scene": "workbench",
        "palette": {
          "accent": "#5fbf8f",
          "ground": "#0f1713",
          "font": "sans"
        },
        "title": "The Game Master's Workshop",
        "subtitle": "Tools to shape any world",
        "lead": "New tools let you correct the world in play and build scenarios faster, with every change shown before it is made.",
        "sections": [
          {
            "heading": "Game Master",
            "icon": "star",
            "items": [
              "The Game Master tools preview every change the AI plans for your command, and Apply makes exactly that change.",
              "An Event Editor, Country Editor, Region Inspector and Map Feature Editor sit beside them."
            ]
          },
          {
            "heading": "Scenario Workshop",
            "icon": "map",
            "items": [
              "A Countries tab lists every country; a rename keeps everything under it, and a country can exist without land.",
              "Copy regions from one map and paste them into another, with their countries, colours and flags.",
              "Import provinces from a colour-coded picture, and city markers from a GeoJSON file.",
              "Every save cleans up the borders first, and starting units can be placed on the map."
            ]
          },
          {
            "heading": "Also new",
            "icon": "gear",
            "items": [
              "A Features tab switches espionage and idle diplomacy on or off for a scenario or a single game.",
              "The ☰ button opens a quick menu that grows into a full-screen settings workspace.",
              "The last coloured tints are gone: the interface is dark grey throughout, and a selected control reads darker.",
              "Modern Day calls countries by their everyday names, like Spain, France and Russia."
            ]
          }
        ]
      },
      {
        "theme": "chronicle",
        "scene": "timeline",
        "palette": {
          "accent": "#f2c94c",
          "ground": "#15130b",
          "font": "serif"
        },
        "title": "Moments That Matter",
        "subtitle": "Step into the story",
        "lead": "Time skips now offer moments to play out and let you stop the clock where you want to act, and diplomacy happens around a real table.",
        "sections": [
          {
            "heading": "Interactive events",
            "icon": "star",
            "items": [
              "Now and then a skip offers one of its events about you as a scene: Play it out, or Let it pass.",
              "Intervene here stops a skip after the event you want to act on; what came after it never happened.",
              "Events stream into the Events panel as the skip writes them."
            ]
          },
          {
            "heading": "Around the table",
            "icon": "people",
            "items": [
              "In a group chat each leader speaks in turn, and you can cut in before the rest have spoken.",
              "Leaders can call binding votes, and you can cast your own.",
              "Leaders you return to are told what changed in the world since you last spoke."
            ]
          },
          {
            "heading": "Papers and goals",
            "icon": "book",
            "items": [
              "Secret letters, protocols and assessments reach you through diplomacy, your spies or the event that produced them.",
              "Set a standing goal in the Actions panel, and your advisor and officials work toward it."
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "2026-09-clearer-maps",
    "kind": "minor",
    "date": "2026-09-12",
    "banners": [
      {
        "title": "Clearer Maps, Truer Dates",
        "items": [
          "On a hand-drawn world each country gets one label, and disputed stripes sit under the labels.",
          "Timeline buttons show the date a skip will really land on.",
          "Opening Stats while a new game's backstory is written now waits for it instead of asking the AI twice.",
          "The country picker opens faster, and community hub downloads retry when a step fails.",
          "A local AI server that serves several models finds the one you saved.",
          "The website's guides describe the game as it really is, and its download button matches your system."
        ]
      }
    ]
  },
  {
    "id": "2026-09-spycraft",
    "kind": "major",
    "date": "2026-09-05",
    "banners": [
      {
        "theme": "chronicle",
        "scene": "dossier",
        "palette": {
          "accent": "#d4af37",
          "ground": "#0f1215",
          "font": "mono"
        },
        "title": "Spycraft",
        "subtitle": "Espionage, both ways",
        "lead": "Plant spies in other governments, catch theirs in yours, and decide what a captured agent tells its masters.",
        "sections": [
          {
            "heading": "Your agents",
            "icon": "chess",
            "items": [
              "Deploy up to three spies; each brings back its target's private talks with other countries.",
              "Agents report on their own after every time skip, and now and then while you play.",
              "What you read is as clear as your Intelligence service is good, and that rating now moves as you invest in it."
            ]
          },
          {
            "heading": "Foreign agents",
            "icon": "people",
            "items": [
              "Rival services plant agents in your government to read your private diplomacy and plans.",
              "Catch one and choose in the Spy tab: Expel it, or Turn it and feed its masters a cover story.",
              "Your own agent can be turned without your knowing, though a good service may flag it as possibly compromised."
            ]
          },
          {
            "heading": "Secrets kept",
            "icon": "book",
            "items": [
              "Leaders now see only the conversations they are part of, unless their spies have earned more.",
              "Discoveries and expulsions become events, and relations sour.",
              "Chats and the Spy tab show a scenario's own flags."
            ]
          }
        ]
      },
      {
        "theme": "chronicle",
        "scene": "devices",
        "palette": {
          "accent": "#5ec4b6",
          "ground": "#0d1514",
          "font": "sans"
        },
        "title": "Play Anywhere",
        "subtitle": "Android, Linux and the web",
        "lead": "The Android app no longer needs a server of your own, Linux gets a proper installer, and the website keeps your games safe.",
        "sections": [
          {
            "heading": "Platforms",
            "icon": "gear",
            "items": [
              "The Android app carries the game itself and connects to a community server, with nothing to install or type.",
              "Linux players can install a .deb with a menu entry and a working sandbox.",
              "The desktop update banner now follows its download to the end."
            ]
          },
          {
            "heading": "Your games",
            "icon": "book",
            "items": [
              "Archive a finished or abandoned game to hide it from the library without deleting it.",
              "On the website the date now moves on properly at the end of every turn.",
              "The browser is asked to keep your saved games and the map instead of clearing them.",
              "A turn still being written can no longer land in a different campaign you opened."
            ]
          },
          {
            "heading": "On the map",
            "icon": "map",
            "items": [
              "Each country gets one label, whatever the AI has called it.",
              "Community scenarios can be searched by title, description and author.",
              "3D terrain starts off on phones, where it can lag."
            ]
          },
          {
            "heading": "Small comforts",
            "icon": "star",
            "items": [
              "Improve turns into Stop while it works, so a mistaken press can be taken back.",
              "Ctrl+Z, or a click on the last point, takes a point back while drawing a region.",
              "City populations can be typed in the editor, and world events can change them.",
              "Panels are dark grey everywhere, and menus ease in and out."
            ]
          }
        ]
      }
    ]
  },
  {
    "id": "2026-08-self-updating",
    "kind": "minor",
    "date": "2026-08-29",
    "banners": [
      {
        "title": "Updates That Install Themselves",
        "items": [
          "The desktop app downloads and installs its own updates, then restarts into the new version.",
          "A captured region shows its new owner's flag, name and statistics, and its chat opens with the new owner.",
          "One unrecognised place name in a turn can no longer hand a whole country to someone else.",
          "Every Discord link now leads to the new Open Historia server.",
          "The browser demo says it is a demo before you start, with a link to the desktop app."
        ]
      }
    ]
  }
]);
