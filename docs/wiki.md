# The Player Wiki

The wiki at [openhistoria.com/wiki/](https://openhistoria.com/wiki/) is 30 player-facing pages
covering installation, the core loop, every game system, the tools, hosting and troubleshooting.
It replaced the five orphaned guide pages that the landing page linked zero times.

This page is for maintaining it. For what it *says*, read the wiki.

---

## 1. Where everything lives

| Path | What |
|---|---|
| `wiki/*.md`, `wiki/*/*.md` | The source. Hand-edited markdown, one file per page. |
| `wiki/nav.json` | Page order, sidebar grouping, titles, slugs, beta flags. The source of truth. |
| `wiki/img/*.jpg` | Screenshots, 1280px JPEG. |
| `wiki/provenance.json` | What the wiki was last verified against, and which source files each page cites. |
| `public/wiki/**` | **Generated.** Committed as well as generated — see below. |
| `public/wiki.css` | The stylesheet. `public/guides.css` is a one-line `@import` shim for old links. |
| `scripts/build-wiki.mjs` | The generator. |
| `scripts/check-wiki-freshness.mjs` | Tells you what needs updating. |
| `scripts/build-wiki-preview.mjs` | Builds a relocatable copy for sharing without touching the live site. |

It lives in `public/` rather than `site/` for the same reason the old guides did (see the comment
at the top of `assemble-site.mjs`): a local desktop install serves `public/` at *its* root, so the
wiki works offline inside the app, and `assemble-site.mjs` lifts it to `/` for the website. One
source, two surfaces.

**The generated HTML is committed.** `assemble-site.mjs` hard-fails when a `ROOT_PAGES` entry is
missing from `dist-web/`, and neither `npm run build` (desktop) nor `build:web` invokes the
generator — committing the output is what keeps all three build paths honest without threading the
generator through every one of them. So: **always commit `public/wiki/` alongside your `wiki/`
edits.**

---

## 2. Everyday commands

```
npm run build:wiki      # regenerate public/wiki/ from wiki/
npm run wiki:check      # what has changed upstream that the wiki cites?
npm run build:site      # full site build (runs build:wiki first)
npm run preview:site    # serve dist-site/ at localhost:4173
npm run wiki:preview    # relocatable copy in dist-wiki-preview/, for sharing
```

The generator fails the build rather than shipping something broken. It refuses to run if an
internal `/wiki/…` link points at a page that does not exist, if `nav.json` names a missing file,
or if a `.md` under `wiki/` is not referenced by `nav.json`. It also regenerates
`public/sitemap.xml` from `nav.json`, so the sitemap cannot drift.

---

## 3. Showing it to people without touching the live site

`openhistoria.com` deploys from `main` through a Cloudflare Pages project that not everyone has
access to. To circulate the wiki for review without going near it:

```
npm run wiki:preview
```

That writes `dist-wiki-preview/` — the same pages with every internal link rewritten **relative**,
so the folder works from a domain root, a GitHub Pages subpath, a shared drive, or opened straight
off disk. Links that belong to the game rather than the wiki (Play, Download, the landing page)
point at the live site, since they are not in the bundle.

It matters because the real wiki addresses everything absolutely — `/wiki.css`, `/wiki/img/…`,
about 1,500 references — which is correct when served from the site root and breaks completely on
a subpath. This is the fix.

Where to put it:

| | |
|---|---|
| **Netlify Drop** | Drag the folder onto [app.netlify.com/drop](https://app.netlify.com/drop). Instant URL, no account needed for a quick share. |
| **GitHub Pages on your own fork** | Push `dist-wiki-preview/` to a `gh-pages` branch of your fork and enable Pages. Serves at a subpath, which the relative rewrite handles. Entirely separate from upstream. |
| **Your own Cloudflare Pages project** | `wrangler pages deploy dist-wiki-preview --project-name <something-else>`. Same platform, different project — it cannot affect `open-historia`. |
| **A zip** | It is ~3 MB and self-contained, with a README.txt inside explaining what it is. |

Do **not** deploy it to the `open-historia` Cloudflare project or push to `upstream/main` to
preview — both publish to the live site.

---

## 4. Answering "does the wiki need updating?"

```
npm run wiki:check --fetch
```

`wiki/provenance.json` records the two commits the wiki was last verified against and, per page,
the source paths whose behaviour that page describes. The check diffs those commits against the
current tips of `upstream/main` and `upstream/beta`, maps the changed files onto the pages that
cite them, and prints a worklist plus the commit subjects behind it.

It exits non-zero when pages need review, so CI could gate on it, but the useful output is the
list.

**When you finish a pass, move `verifiedAgainst` forward to the commits you actually checked
against.** A stale record is worse than no record, because the next person will trust it.

The `pages` mapping is deliberately coarse: a page lists the files whose behaviour it describes,
not everything it transitively touches. A false positive costs a re-read; a false negative ships a
wrong page.

---

## 5. Editing rules

**Two builds, kept distinct.** `main` and `beta` differ substantially — `gameplay.js` is 2,800
lines on main and 12,000 on beta. Anything that exists only on beta must be marked, either with a
page-level `"beta": true` in `nav.json` (which renders a banner and a sidebar chip) or with an
inline `<p class="beta-note">` for a section. Never state a beta feature as though everyone has it.

**Verify against source, not against `docs/`.** These developer docs have drifted in places. Where
they disagree with the code, the code wins, and the wiki should follow the code.

**Do not invent numbers.** Every constant in the wiki should be traceable to a line of source. An
earlier draft claimed an exposed spy ring costs 20 relation points; no such constant exists.

**No ASCII mock-ups.** Do not draw UI layouts with box-drawing characters. Take a screenshot, or
describe it in prose. Code blocks are for commands and formulas.

**Captions go under images.** Markdown renders `![alt](src)` plus an italic line as one paragraph;
`wiki.css` forces both to blocks so a narrow crop does not put the caption beside the image.

---

## 6. Screenshots

Captured by driving the real app with Electron, which is already a dependency.

**Never against the real data directory.** Copy `server/data/` somewhere scratch and launch with
`OH_DATA_DIR` pointed at the copy. A capture run against a live library can destroy save data.
Clear `ELECTRON_RUN_AS_NODE` first or the app exits instantly.

The shape that works:

1. `node server/server.js` with `OH_DATA_DIR` set, on a spare port.
2. An Electron `BrowserWindow` with **GPU enabled and `show: true`** — MapLibre renders blank
   offscreen with acceleration disabled.
3. Inject provider config into `localStorage` rather than typing it into the UI, so no key ever
   appears in a frame.
4. Drive by clicking buttons matched on their **exact label**, preferring `button` elements. A
   looser match once hit a card's "Current Game" eyebrow text instead of its "Current" button and
   photographed the main menu for an entire pass.
5. Crop to the panel by walking up from a text anchor inside it. The app styles almost everything
   inline, so there are no classes to select on.
6. Downscale to 1280px JPEG. Raw captures are ~2.4 MB each; `public/` ships inside the desktop
   installer, so weight here is weight in every download.

**Wait on the right signal.** Do not wait on text that is already on screen. `Exit Game` appears
long before the map is drawn, and beta's loading-screen caption is not in `innerText` at all. Beta
broadcasts `oh:map-idle` from `mapReadiness.js` — use that. Every page evaluation should have a
timeout; a hung call once left an orphaned Electron window fighting the next run for the same
server.

**Beta's loading screen** covers the map until vNext finishes dissolving polity surfaces, which
can outlast any reasonable wait. Temporarily setting `<Presence open={false}>` in
`src/Game/GameUI/main.jsx` in a throwaway worktree gets past it — **revert it afterwards and
verify with `git status`**, and be aware that with it removed you can photograph a half-drawn map,
which is precisely what that screen exists to prevent. Use it for panel crops, not map shots.

**Map screenshots should use the legacy renderer** (`localStorage` key `map_legacy_renderer`)
unless the subject *is* vNext, which is a work in progress and would date the wiki.

**Staging is fine, and should be recorded.** Some states are impractical to reach honestly —
espionage detection is a per-jump roll of a few percent, and a populated Projects board needs a
dozen turns of events. Writing those records into the scratch save is legitimate: the shapes are
the engine's and the UI is real. Mark them `"staged": true` in `provenance.json` so a future
maintainer knows to replace them from a real campaign.

---

## 7. Adding a page

1. Write `wiki/<section>/<slug>.md`. Start at `##` — the `#` title comes from `nav.json`.
2. Add an entry to `wiki/nav.json` in reading order, with `slug`, `file`, `nav`, `title` and
   `description`. Add `"beta": true` if the whole page is a beta feature.
3. Add the page to `wiki/provenance.json` under `pages`, listing the source files it describes.
4. `npm run build:wiki`, then `npm run build:site` to confirm the assembler is happy.
5. Commit both `wiki/` and `public/wiki/`.

Slugs are permanent — they are the public URL. Changing one breaks inbound links.

---

## 8. URL history

The wiki absorbed the old guides. `/get-started/`, `/how-to-play/`, `/ai-setup/`, `/self-hosting/`
and `/guides/` now 301 to their `/wiki/…` homes via `site/_redirects`, **and** keep stub pages
under `public/` — `_redirects` is Cloudflare-only, and the desktop app serves `public/` at its own
root where those rules do not exist.

`/pax-historia-alternative/` deliberately keeps its own URL: it is a keyword-targeted landing page
rather than wiki content.

One rule from `site/_redirects` worth not relearning: a rule whose target matches its own pattern
makes Cloudflare discard **the entire file**. Keep paths exact.

---

## 9. Known gaps

Kept current in `wiki/provenance.json` and printed by `npm run wiki:check`. At the time of
writing: no Map vNext screenshot for a side-by-side against the legacy renderer; no screenshot of
a held time-skip segment or a held Projects board (both are in-memory pending state that cannot be
authored into a save); and beta was verified from source and by driving its menus rather than by
playing a campaign through turns.
