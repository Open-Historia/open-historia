/*! Open Historia — the version releases, as their announcement tells them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "make a new entire type of update annoucement for version jumps like this one where it lists all the changes that
// have been made with incredibly detailed styling and artwork that looks like a AAA game and you can scroll through
// the announcement (there should be scrollytelling elements but artwork and animation shouldnt be put into one header
// like major updates, it should be integrated into the whole update annoucement)" (the owner, 2026-11-05).
//
// A RELEASE is a version jump on the stable channel: everything since the last one, told in chapters
// (ReleaseNotice.jsx draws it, a page that scrolls, each chapter's picture moving with it). It is an update like any
// other in notes.js (an id, a date, `kind: "release"`), and when a device is owed one it is shown alone: it tells
// everything the updates under it told (updateNotices.js pendingUpdates).
//
//   release  { id, kind: "release", version, date, title, subtitle, lead, chapters: [chapter], omit?: [text], button? }
//   chapter  { key, scene, title, subtitle, lead, highlights: [{ heading, text }], updates: [ref] }
//   ref      an update's id, the whole update; or "<id>#<n>", its n-th banner only
// `scene` is one of ReleaseNotice.jsx RELEASE_SCENES. Under each chapter the page lists every line of every update
// it names, in their own words (already in the language packs), less the lines in `omit` (what a later update in the
// same release undid). Every notice since the last release is named by exactly one chapter, or listed in
// `leftOut` with why (updateNotices.test.js checks both).

export const RELEASES = [
  {
    id: "2026-11-version-2-5",
    kind: "release",
    version: "2.5.0",
    date: "2026-11-05",
    title: "Open Historia 2.5",
    subtitle: "Total war, a living world, and a game that is yours",
    lead: "Two months of work in one update: wars fought out on the map by armies, aircraft and fleets, a world that answers back, and an interface in your colours and your language.",
    button: "To the main menu",
    leftOut: {
      // Multiplayer is not part of 2.5.
      "2026-10-discord-invites": "multiplayer",
      "2026-10-shared-secrets": "multiplayer",
      // Already on the stable channel before 2.5.
      "2026-11-updates-not-imports": "already released",
      "2026-11-install-count": "already released",
    },
    omit: [
      "Listening in on a region now opens on its country's feed first.",
      "A switch in Settings turns the door off, and with Reduce motion it simply fades away.",
      "Battlefields start with half as many troops; draft more or send reinforcements to a front through your actions.",
      "Choose how many formations to call up as you draw it. Leave it empty for as many as a usual draft, or put 0 to only move where new troops arrive.",
      "Build up forces from your own country's page: they gather round your cities, as many as your men, supplies, war weariness and mustering allow, and more come in over the weeks after.",
    ],
    chapters: [
      {
        key: "front",
        scene: "front",
        title: "The Front",
        subtitle: "Wars fought out on the map",
        lead: "The game now fights its land wars itself. Hundreds of troops a side march over real ground, dig in, run short and break through, and the story tells the war as it went.",
        highlights: [
          { heading: "Battlefields", text: "Where two countries at war touch, a battlefield opens. Troops take ground only where they stand on it, and the border moves with them." },
          { heading: "The War Room", text: "Draw routes, deploy fronts or swarms, build fortified lines and rehearse next week's battle before you commit to it." },
          { heading: "A commander worth fearing", text: "Enemy staffs plan days ahead like a chess engine and answer a deep thrust with a counter-offensive." },
          { heading: "Armies from home", text: "Forces gather round your cities, march to the front and come home again, as many as your men, supplies and weariness allow." },
        ],
        updates: [
          "2026-10-battlefields",
          "2026-10-wars-and-fronts-2",
          "2026-10-swarms",
          "2026-10-deploy-calls-up",
          "2026-11-forces-at-home",
          "2026-11-moving-fronts",
          "2026-10-still-fronts",
          "2026-10-war-sides",
          "2026-11-build-up-line-named",
          "2026-11-one-advance-pace",
          "2026-11-importance-of-technology",
          "2026-11-wars-end-when-won",
          "2026-11-war-figures-in-skip",
          "2026-11-game-master-wars",
          "2026-10-ai-mended",
          "2026-10-fixes-from-reports",
        ],
      },
      {
        key: "skies",
        scene: "skies",
        title: "Air, Sea and Shadow",
        subtitle: "War beyond the front line",
        lead: "Bombers cross the map and fighters rise to meet them, fleets blockade and give battle, and your agents work where nobody sees them.",
        highlights: [
          { heading: "Deploy Aircraft", text: "Send your air units against troops, structures or cities. Interceptors may find the raid, and what is left decides it." },
          { heading: "Command at sea", text: "Patrol, blockade, escort or seek battle. Troops sail from your own ports, and blockades starve a war on land." },
          { heading: "Orders in the dark", text: "Agents collect, sabotage, recruit and assassinate. An operation never traced is never tied to you." },
        ],
        updates: [
          "2026-11-deploy-aircraft",
          "2026-11-strikes-on-the-map",
          "2026-11-aircraft-key",
          "2026-11-picture-edges-and-strike-targets#1",
          "2026-10-fleets-at-sea",
          "2026-11-ships-from-ports",
          "2026-10-espionage-part-2",
          "2026-11-assassinations-take-effect",
          "2026-10-spies-with-reason",
        ],
      },
      {
        key: "table",
        scene: "table",
        title: "War and Peace",
        subtitle: "Wars end at the table",
        lead: "Wars wear countries down until someone asks for terms. Alliances pull their members in, enemies write to you in their own words, and a peace can redraw the map.",
        highlights: [
          { heading: "Peace on any terms", text: "Annex, take regions by name, make a puppet or a protectorate, or write a condition of your own: the next time skip carries it out." },
          { heading: "Alliances that bind", text: "Pacts and guarantees call their members in when one is attacked, and leaving the call unanswered costs your reputation." },
          { heading: "Voices of their own", text: "Leaders, alliances and organisations write under their own names, and your advisor team grows with officials you appoint." },
        ],
        updates: [
          "2026-10-war-and-peace#0",
          "2026-11-calls-to-arms-by-message",
          "2026-10-peace-and-weariness",
          "2026-10-peace-in-the-chats",
          "2026-11-peace-on-any-terms",
          "2026-10-group-diplomacy",
          "2026-10-own-voice",
          "2026-11-chat-opener-speaker",
          "2026-10-politics-and-goals",
          "2026-11-advisor-contacts",
          "2026-11-advisor-microphone",
          "2026-10-founded-countries",
        ],
      },
      {
        key: "world",
        scene: "world",
        title: "A Living World",
        subtitle: "Seasons, weather and a world that talks",
        lead: "Every front lives through its seasons. Rain turns roads to mud, winter freezes the lakes, and on Rostra the world talks about everything you do.",
        highlights: [
          { heading: "Seasons and weather", text: "Climate zones bring rain, storms, snow, frost and heat that slow armies and wear troops down." },
          { heading: "Rostra", text: "A social network for the world you play in: leaders, generals and journalists post as time passes, and your words have consequences." },
          { heading: "A score for every campaign", text: "Music by Scott Buckley follows you from the menu to the battlefield." },
        ],
        updates: [
          "2026-10-seasons-and-weather",
          "2026-11-season-tint-tiles",
          "2026-11-rostra",
          "2026-11-rostra-search-polls",
          "2026-11-rostra-check-in",
          "2026-11-events-take-effect",
          "2026-11-changes-where-they-belong",
          "2026-11-scripted-events-in-ai-words",
          "2026-10-interactive-offers",
          "2026-10-unruled-land",
          "2026-10-renamed-regions",
          "2026-11-annexed-land-on-the-map",
          "2026-10-music",
        ],
      },
      {
        key: "map",
        scene: "map",
        title: "The Map",
        subtitle: "Turn it, tilt it, zoom in close",
        lead: "Turn and tilt the world with a drag, switch to the diplomatic view, and zoom into detailed maps that stay sharp up close, on a map that runs smoother than ever.",
        highlights: [
          { heading: "Turn and tilt", text: "Drag with the right mouse button, or hold Shift on a trackpad, to turn and tilt the map in any direction." },
          { heading: "Detailed maps", text: "Large terrain maps keep their detail however far you zoom in, downloaded once and shared by every scenario that uses them." },
          { heading: "Smoother everywhere", text: "A quarter of the graphics work with 3D terrain on, shorter pauses when zooming, and far less heat on laptops and phones." },
        ],
        updates: [
          "2026-11-right-to-left-map",
          "2026-10-war-and-peace#1",
          "2026-10-diplomatic-map",
          "2026-10-turn-and-tilt",
          "2026-11-shift-to-turn",
          "2026-10-zoom-keys",
          "2026-10-globe-and-renames",
          "2026-11-map-distances",
          "2026-11-map-edges",
          "2026-11-converted-maps-line-up",
          "2026-11-picture-edges-and-strike-targets#0",
          "2026-10-fit-to-background",
          "2026-10-games-and-groups",
          "2026-11-gentler-terrain",
          "2026-11-smoother-map",
          "2026-11-lighter-map",
          "2026-11-smoother-zooming",
          "2026-11-less-for-the-gpu",
        ],
      },
      {
        key: "yours",
        scene: "yours",
        title: "Yours to Shape",
        subtitle: "Your colours, your language",
        lead: "The game opens on a steel vault door, greets you in your own language and dresses itself in the colours you choose.",
        highlights: [
          { heading: "Themes", text: "Five palettes or your own, across the main menu, the panels, the controls over the map and every popup." },
          { heading: "Your language", text: "A first-time setup in 28 languages, and translation on your own device, never with AI requests." },
          { heading: "Through the vault door", text: "A new way into the game: turn the wheel, and the main menu is waiting behind it." },
        ],
        updates: [
          "2026-11-themes",
          "2026-11-hud-themes",
          "2026-11-czech-finnish",
          "2026-10-war-and-peace#2",
          "2026-11-translation-model",
          "2026-10-ai-in-your-language",
          "2026-10-dates-and-orders",
          "2026-11-display-mode",
          "2026-10-phone-layout",
          "2026-10-country-picker-cards",
          "2026-10-community-dates",
          "2026-11-reimports-not-imports",
          "2026-11-suggestion-regions",
        ],
      },
      {
        key: "engine",
        scene: "engine",
        title: "Faster, Lighter, Steadier",
        subtitle: "The work behind the game",
        lead: "Games open sooner, turns end sooner, time skips no longer freeze, and the desktop app is smaller and quicker to update.",
        highlights: [
          { heading: "Faster turns", text: "Pauses as each turn finishes are about half as long, and a war costs no extra AI requests." },
          { heading: "Steadier time skips", text: "No more freezes on phones in crowded scenarios, and long skips on Gemini keep every event they write." },
          { heading: "Lighter app", text: "About 40 MB less to download on Windows, 100 MB less on disk, and updates that finish in seconds." },
        ],
        updates: [
          "2026-11-faster-turns",
          "2026-11-smoother-scrolling",
          "2026-10-skip-freeze",
          "2026-11-places-as-written",
          "2026-10-newer-claude",
          "2026-10-faster-updates",
          "2026-11-lighter-desktop",
          "2026-11-mac-opening",
          "2026-11-straight-into-the-demo",
        ],
      },
    ],
  },
];
