# Update notices and the update history

When the game opens after an update, the vault door opens onto a **notice**: one or more banners announcing what the update brings. Each update is shown once per device. The main menu's **Open Historia logo** (top left) opens the **update history**, a timeline of every update with its banners.

Both read one list: `src/Game/GameUI/updates/notes.js`. **Writing that list is part of shipping a change players will notice.** Coding agents do it unprompted, in the same pull request as the change (see [AGENTS.md](../AGENTS.md)).

## Where it lives

| File | What it is |
|---|---|
| `src/Game/GameUI/updates/notes.js` | `NEW_UPDATES`, where new updates go, newest first. `UPDATES` is every update, merged with the past and ordered by date. **The only file most updates touch.** |
| `src/Game/GameUI/updates/notesPast.js` | `PAST_UPDATES`: the two months of updates from before notices existed (2026-08-15 to 2026-10-14), written from what reached players. Never add to it. |
| `src/Game/GameUI/updates/updateNotices.js` | Which updates a device is shown (`pendingUpdates`), what it has seen (`rememberUpdate`, localStorage `oh-update-note-seen`), and the `?updateNotice=` preview. |
| `src/Game/GameUI/updates/UpdateNotice.jsx` | The notice. It pages through banners (‹ › arrows, markers, Skip, Next and the last banner's button), and draws a minor banner (`MinorBanner`), several minor updates as one changelog (`ChangelogBanner`), a major banner without a theme (`DefaultBanner`), or a theme's own page. |
| `src/Game/GameUI/updates/UpdateHistory.jsx` | The timeline opened from the menu's logo (`libraryBar.jsx` `MenuRail`). |
| `src/Game/GameUI/updates/updateKit.jsx` | The parts a theme is built from (see [The kit](#the-kit)). |
| `src/Game/GameUI/updates/notesReleases.js`, `ReleaseNotice.jsx`, `releaseNotice.css` | Releases: a version jump told as a page that scrolls (see [Releases](#releases-a-version-jump-told-in-full)). |
| `src/Game/GameUI/updates/themes/` | One theme per major update that has its own look: `<Name>.jsx` (its pages), `<name>Chrome.js` (its arrows, markers, Skip and button), `index.js` (the registry), and `ThemeTemplate.jsx` to copy. |
| `src/App.jsx` | Shows the notice as the door's leaves part, or at once when the door is off. |

## When to write one

Write an entry **whenever a change reaches players and a player would notice it**: a new feature, screen, tool or setting, a rule of play that changed, a platform, or a fix of something players hit. You need not be asked: an update with no notice is unfinished.

Do **not** write one for refactors, tests, CI, documentation, build or training tools, or anything a player cannot see or feel.

- **Major or minor.**
  - A **major** update has a headline a player would talk about: a new system, a new screen, a new platform, a big rework. It gets decorated, themed banners.
  - A **minor** update is fixes and small improvements. It is a plain card with 3 to 6 lines.
  - When unsure, it is minor.
- **One entry per batch.** Each batch of player-facing work that ships together is one entry. A follow-up to the newest entry that has not reached players yet (same branch, a day or two later, no release in between) goes into that entry.
- **Ids are permanent.** Devices remember which ids they have shown. Never reuse or rename an id that has shipped, and only fix typos in shipped text. A new batch gets a new id.
- **The entry follows its feature.** It goes on the branch where the change lands. When a feature is promoted to another branch (alpha, then beta, then main), its entry goes with it. Promote only the lines for what was promoted.
- **The date** is the day the change reaches players on that branch (`YYYY-MM-DD`).

## Coordinating one Beta release across multiple PRs

When two or more PRs are deliberately shipped in **one Beta build**, prepare **one player-facing update entry for the combined release**, rather than making one announcement per PR. Place that entry in the integration/last-to-merge PR, after reviewing the actual scope of *every* contributing PR. Do not claim that a feature is in the release merely because a PR exists or the local preview works; verify that the published build includes all corresponding commits. Do not publish an incomplete combined notice if only one PR reaches players.

**Git branch caution:** If PR A is already open from a branch and PR B's changes are still uncommitted on that **same branch**, pushing B there silently expands PR A; it does **not** create a second independent PR. Preserve the dirty worktree and its checkpoint, merge A first, and prepare B on a separate branch based on the post-merge Beta source (or use an explicitly reviewed stacked-PR sequence). Both can still reach the same release build. Never reset, stash, rebase, cherry-pick, commit or push a user's branch as an automatic workaround.

- **Choose the kind by player impact, not PR count.** Several bug fixes and smaller settings can share one `minor` entry. A genuine new headline system or substantial experience rework warrants `major` and its own themed banner(s).
- **Set a release-specific id and date.** Reserve a fresh permanent id; set `date` to the intended Beta delivery day before building. If the release slips, adjust the date before publication. Never rename, remove, re-date or repurpose an entry that devices may already have seen.
- **Write what's shipped, not what's proposed.** Keep 3–6 concise player-facing lines for a minor batch. Mention actions players can take and visible fixes, not PR numbers, internal ownership, build commands or unverified consequences. Preserve earlier shipped entries instead of rewriting history when a later feature supersedes one.
- **Run the notice gate with the same code as the release.** Test `?updateNotice=<id>`, the logo-opened Update History timeline, narrow-screen layout and Reduce motion; verify the English catalog and notice tests, then run the complete repository tests and production build.
- **Verify publication separately.** Confirm both PRs merged, compare the Beta branch SHA against the GitHub Actions workflow `headSha`, and verify the actual desktop-beta installer/update feeds and all target platform jobs. A merged PR, green test job or local localhost preview alone is **not** a published release.
- **Coordinate outward messaging.** Once the player-distributed build is verified, the in-game notice is the enduring changelog; Discord's `#updates` message summarizes the same user-facing changes and links the verified build. A version-jump **stable** release instead gets its separate `notesReleases.js` chapter-based announcement, referencing the included update ids.

The notice entry belongs on the feature branch and ships with source. It is not a separate website announcement deployed afterward. The website browser demo suppresses automatic notices, but explicit preview URLs still work; desktop/Android clients show them once per device when owed. Check `updateNotices.js` before changing any of this delivery behavior.

## How to write one

### 1. Add the entry at the top of `NEW_UPDATES` in `notes.js`

A **minor** update:

```js
{
  id: "2026-11-map-fixes",            // YYYY-MM-<slug>, new, never reused
  kind: "minor",
  date: "2026-11-02",
  banners: [
    {
      title: "Smoother maps",
      items: [
        "Borders no longer flicker when you zoom out quickly.",
        "Labels of very small countries no longer overlap their neighbours'.",
        "The map remembers where you left it when you reopen a game.",
      ],
    },
  ],
},
```

A **major** update. It has one banner per headline: several banners are paged with arrows.

```js
{
  id: "2026-11-diplomacy",
  kind: "major",
  date: "2026-11-20",
  banners: [
    {
      theme: "diplomacy",             // its own look (step 3); leave out for the decorated default
      scene: "summit",                // optional: which page of the theme (a theme may draw several)
      title: "Diplomacy Reborn",
      subtitle: "Every treaty has a price",
      lead: "One or two sentences that sell the update to a player.",
      sections: [
        { heading: "Treaties", icon: "book", items: ["…", "…"] },
        { heading: "Summits", icon: "people", items: ["…", "…"] },
      ],
      palette: { accent: "#3fb98a", ground: "#10181a" },   // only for the default look
      button: "To the table",         // the last banner's button; "Continue" when left out
    },
  ],
},
```

An update that reached players first on a test channel says so with `channel: "beta"` or `channel: "alpha"`; the history marks it.

`icon` is one of the kit's `ICONS`: `chess`, `swords`, `snow`, `sun`, `rain`, `leaf`, `wall`, `plane`, `ship`, `flag`, `eye`, `map`, `gear`, `star`, `book`, `people`, `phone`, `palette` or `note`. Add one to `ICONS` if none fits.

### 2. Write for a player

- Say what the update lets them do or see, in plain words. Never use internal names, file or function names, ids, PR numbers or commit hashes.
- Country and feature names are exactly as the game shows them.
- Items are one sentence each, at most about 25 words. A major banner has 2 to 4 sections, each with 2 to 4 items. Titles are short and evocative.
- Never claim what the change does not do.

### 3. Give a major update its look

The owner's rule: **every major update is themed for itself**. It must be beautiful, complex and decorated, and animated where it suits. Everything about it is themed, its buttons and markers too: nothing is the game's default blue. Not every update is a war update: the look is the update's own, for example a concert hall for music or a summit for diplomacy.

1. Copy `themes/ThemeTemplate.jsx` to `themes/<Name>.jsx`. Its default export is given `{ banner, update }` and draws the page inside a `Plate`. The words come from the banner. The theme draws only the page; the notice draws the arrows and buttons around it.
2. Make its chrome, `themes/<name>Chrome.js`: `{ button, arrow, dot: { on, off, radius }, skip }`. Each is a style laid over the plain one, in the theme's colours and lettering. `warsAndFronts2Chrome.js` and `musicChrome.js` are examples.
3. Name it in `themes/index.js`:
   `name: { Page: lazy(() => import("./<Name>.jsx")), chrome: NAME_CHROME },`
4. Set `theme: "name"` on the update's banners. Use `scene` to tell a theme's pages apart.
5. Give it a picture of its own: an `<svg>` of flat shapes that moves (a line drawing itself, things drifting, falling or floating, something that answers a touch). `WarsAndFronts2.jsx`, with three animated scenes, and `Music.jsx`, with playable floating notes, are full examples.

The **chronicle** (`themes/Chronicle.jsx`) dressed the past updates. Each banner gets its own palette (`accent`, `ground`, and `font`: `serif`, `mono`, `stencil`, `rounded` or `sans`) and one of seventeen moving scenes: `fleet`, `lens`, `vault`, `press`, `projection`, `chunks`, `network`, `phone`, `scroll`, `chamber`, `gears`, `scripts`, `desk`, `workbench`, `timeline`, `dossier` and `devices`. Its chrome is a function of the banner (`chronicleChrome.js`): a theme's `chrome` may be a style object or `(banner) => styles`.

A new major update still gets its own theme. Use the chronicle only for a small major update whose scene already fits it, with a palette of its own.

A major update with no `theme` is shown in the decorated default, coloured by its `palette`. That is only a fallback for a theme still to be made.

### 4. Keep to the house rules

- **No gradients and no purple.** Use flat colours, lines, and made pictures such as `roughMetal.js`. `src/noGradients.test.js` fails on any CSS or SVG gradient.
- **Motion** goes through the kit:
  - `motion(still, name, ms, delay)` for something that happens once;
  - `forever(still, name, ms, delay)` for something that keeps going;
  - `const still = useStill()` respects the game's Reduce motion and the system's setting: when still, everything is drawn where it ends.
- Each animation's timing string carries a `cubic-bezier(…)` or `linear`. A string that reads like a sentence is taken for interface text.
- **Phones:** check the page at 375 px wide. `useNarrow()` tells the theme to shrink its header and take away what would overlap.
- **Sound** plays only when `soundEffectsEnabled()` is true (`runtime/vaultSounds.js`).
- **Anything that can be touched** is a `<button>` with an `aria-label`.
- **Files are CRLF**, like the rest of the tree.

### 5. Add the words to the language catalog

New interface strings go into `public/lang/catalog-en.json`, kept sorted, by union. Either run the i18n guard (step 7), which lists what is missing, and add it; or run `node scripts/i18n/build-catalog.mjs` and then `node scripts/generate-lang-packs.mjs` (see [Languages & Translation](i18n.md)).

### 6. Look at it

Build or run the game and open it with `?updateNotice=<the id>` in the address, or `?updateNotice=latest`. The notice shows at once, door or no door, and nothing is remembered.

Check:
- every banner and the arrows between them;
- a phone-sized window;
- Reduce motion;
- the update's card in the history (click the logo in the main menu).

### 7. Run the tests

```bash
node --test src/Game/GameUI/updates/updateNotices.test.js src/noGradients.test.js src/runtime/i18nCatalog.test.js src/Game/GameUI/VaultDoor.test.js
```

`updateNotices.test.js` checks that:
- ids are unique and dates are well formed;
- each banner has what its kind needs;
- every theme a banner names is registered with its chrome;
- every icon exists.

Then run the full suite, `npm test`.

## Releases: a version jump told in full

A **release** is a version jump on the stable channel (2.5.0 was the first). It is not a banner but a page of its own that scrolls (`ReleaseNotice.jsx`, `releaseNotice.css`): a panorama the page opens on, the contents, then each chapter's picture held in place while its words pass over it and the picture plays out with the scroll, every line of every update in the chapter, and a way out at the end. The pictures run through the whole page, never only at the top.

- Write it in `src/Game/GameUI/updates/notesReleases.js` (`RELEASES`), not in `notes.js`: `{ id, kind: "release", version, date, title, subtitle, lead, button, chapters, omit, leftOut }`.
- A **chapter** is `{ key, scene, title, subtitle, lead, highlights: [{ heading, text }], updates: [ref] }`. `scene` is one of `RELEASE_SCENES` (`front`, `skies`, `table`, `world`, `map`, `yours`, `engine`); a new scene is a component in `ReleaseNotice.jsx` and its rules in `releaseNotice.css`, moved by `--p` (how far the page has scrolled through the chapter, 0 to 1) and `data-step` (which passage is in view).
- `updates` names the updates the chapter tells: an id for the whole update, `<id>#<n>` for one banner. The page lists every line of them in their own words, which are already in the language packs, less the lines in `omit` (what a later update in the same release undid). Every notice since the release before must be named by exactly one chapter, or be in `leftOut` with why: `releaseNotice.test.js` checks.
- A device owed a release is shown it alone (`pendingUpdates`): it tells everything under it. The history lists it as Version x.y.z, and View opens the page.
- The release's own words (titles, leads, highlights) go into `catalog-en.json` and the 22 packs like any notice's.
- Look at it with `?updateNotice=<its id>`.

## How a device is shown updates

`pendingUpdates()` decides which updates a device sees:

- A device that has seen the newest update is shown nothing.
- One that missed several updates is shown all it missed, newest first, at most `UPDATES_SHOWN_MOST`. The major ones come first, each on its own pages. Several minor ones are one card after them, a changelog headed "What's new" listing each with its date, titles and lines, newest first (`noticePages`, `ChangelogBanner`): "make it so if there are multiple minor update annoucements, it merges them all into one changelog" (the owner, 2026-11-09). A single minor update is its own card, as before.
- A device that has never been shown a notice is shown the newest update and the major ones released within `FIRST_LOOK_DAYS` of it.
- Only entries of `NEW_UPDATES` are ever shown behind the door (`NOTICE_UPDATES`); the history from before notices (`notesPast.js`) is never shown as a notice, only in the history.
- A build with no new entry (a hotfix, or a notice someone forgot) shows nothing: only a new entry is an update here.
- The newest update shown is remembered the moment it is shown, so closing the game on it does not bring it back.
- Where the browser refuses storage, nothing is shown, since it could not be remembered and would come back at every opening.
- The website's browser version shows none (`buildShowsUpdateNotices(import.meta.env)` in `App.jsx`: a web build, `VITE_OH_WEB`, that is not the Android app, `VITE_OH_NATIVE`): "make update announcements not appear on the website beta" (the owner, 2026-11-09). The Android app and the desktop app show them; `?updateNotice=` previews still work there.

The history shows every entry, whatever the device has seen.

## The kit

`updateKit.jsx`:

| Part | What it does |
|---|---|
| `Plate` | The page a banner is drawn on. `surface` is its own background, border and radius. |
| `Reveal` | A part that rises in after `delay` ms. |
| `Brackets` | Four corner brackets. |
| `Rule` | A double hairline with a mark, or anything else, in the middle. |
| `Emblem` | A compass star in a ring that turns in as it is shown. |
| `FeatureCards` | A banner's sections as cards, one after another. `card`, `font` and `caps` dress them. |
| `NoticeButton` | A button in a theme's colours. |
| `ICONS` | The section icons. |
| `useStill`, `motion`, `forever` | Motion that respects Reduce motion. |
| `useNarrow` | Whether the window is phone-sized. |
| `noticeDate` | "15 October 2026". |
| Keyframes | `ohUpdRise`, `ohUpdFade`, `ohUpdTurn`, `ohUpdDraw` (a line drawing itself: set `strokeDasharray` and `--oh-upd-length`), `ohUpdPulse`, `ohUpdDrift` (`--oh-upd-from`, `--oh-upd-to`), `ohUpdTwinkle`, `ohUpdStamp`, `ohUpdFall` (`--oh-upd-fall`), `ohUpdSway`, `ohUpdBob` (`--oh-upd-tilt`), `ohUpdRing` and `ohUpdStrike`. |

Inside a theme's SVG, add `className="oh-upd-svg"` so each part turns and scales about its own middle.
