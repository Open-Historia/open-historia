// Run: node --test src/Game/GameUI/updates/releaseNotice.test.js
//
// A release (notesReleases.js) tells every change since the last one, chapter by chapter, in a page that scrolls
// with its pictures through it (ReleaseNotice.jsx). The owner, 2026-11-05: "lists all the changes that have been
// made ... artwork and animation shouldnt be put into one header like major updates, it should be integrated into
// the whole update annoucement".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NOTICE_UPDATES, UPDATES } from "./notes.js";
import { RELEASES } from "./notesReleases.js";
import { releaseChapterEntries } from "./updateNotices.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const page = read("./ReleaseNotice.jsx");
const css = read("./releaseNotice.css");
const allLines = new Set(UPDATES.flatMap((update) => (update.banners ?? []).flatMap((banner) => [...(banner.items ?? []), ...(banner.sections ?? []).flatMap((section) => section.items ?? [])])));

test("a release names every update since the one before it, once, or says why it left it out", () => {
  for (const release of RELEASES) {
    assert.equal(release.kind, "release");
    assert.match(release.id, /^\d{4}-\d{2}-[a-z0-9-]+$/);
    assert.match(release.version, /^\d+\.\d+\.\d+$/);
    assert.ok(release.title && release.subtitle && release.lead, release.id);
    const older = RELEASES.filter((other) => other.date < release.date).map((other) => other.date).sort().at(-1) ?? "";
    const covered = NOTICE_UPDATES.filter((update) => update.kind !== "release" && update.date > older && update.date <= release.date);
    const named = release.chapters.flatMap((chapter) => chapter.updates.map((ref) => ref.split("#")[0]));
    for (const update of covered) {
      const times = named.filter((id) => id === update.id).length;
      const left = Object.hasOwn(release.leftOut ?? {}, update.id);
      assert.ok(left ? times === 0 : times >= 1, `${release.id}: ${update.id} is ${left ? "left out but named" : "named by no chapter"}`);
    }
    for (const ref of release.chapters.flatMap((chapter) => chapter.updates)) {
      const [id, at] = ref.split("#");
      const update = UPDATES.find((entry) => entry.id === id);
      assert.ok(update, `${release.id}: ${ref} is an update`);
      if (at !== undefined) assert.ok(update.banners?.[Number(at)], `${release.id}: ${ref} is one of its banners`);
    }
    const refs = release.chapters.flatMap((chapter) => chapter.updates);
    assert.equal(new Set(refs).size, refs.length, `${release.id}: no update or banner named twice`);
    for (const line of release.omit ?? []) assert.ok(allLines.has(line), `${release.id}: the omitted line is one an update says: ${line}`);
  }
});

test("each chapter has its scene, its words and every line of its updates", () => {
  const [release] = RELEASES;
  for (const chapter of release.chapters) {
    assert.match(page, new RegExp(`"${chapter.scene}"`), `${chapter.key}: ${chapter.scene} is a scene`);
    assert.ok(chapter.title && chapter.subtitle && chapter.lead, chapter.key);
    assert.ok(chapter.highlights.length >= 2 && chapter.highlights.length <= 4, chapter.key);
    for (const highlight of chapter.highlights) assert.ok(highlight.heading && highlight.text, chapter.key);
    const entries = releaseChapterEntries(release, chapter);
    assert.ok(entries.length > 0, chapter.key);
    for (const entry of entries) {
      assert.ok(entry.title && entry.lines.length > 0, entry.key);
      for (const line of entry.lines) assert.ok(!release.omit.includes(line));
    }
  }
  const banner = releaseChapterEntries(release, { updates: ["2026-10-war-and-peace#1"] });
  assert.deepEqual(banner.map((entry) => entry.title), ["Detailed Maps"], "a banner reference lists that banner only");
});

test("the pictures run through the whole page, driven by the scroll, and stand still with Reduce motion", () => {
  assert.match(page, /part\.style\.setProperty\("--p", progress\.toFixed\(4\)\)/, "every tracked part gets its scroll");
  assert.match(page, /className="ohr-stage"/);
  assert.match(css, /\.ohr-stage \{[^}]*position: sticky;/, "each picture is held while its words pass");
  for (const scene of ["front", "skies", "table", "world", "map", "yours", "engine"]) {
    assert.match(page, new RegExp(`${scene}: \\w+Scene`), scene);
  }
  assert.match(css, /\.ohr-front-enemy \{ transform: translateX\(calc\(var\(--p\) \* 300px\)\); \}/);
  assert.match(css, /\.ohr-bombers \{ transform: translate\(calc\(var\(--p\)/);
  assert.match(css, /\.ohr-season-sky \{ fill: color-mix\(in srgb, #1c2b38 calc\(var\(--p\) \* 100%\), #2d5470\); \}/);
  assert.match(css, /\.ohr-root\[data-still\], \.ohr-root\[data-still\] \* \{ animation: none !important; transition: none !important; \}/);
  assert.match(page, /const progress = still \? \(part\.dataset\.ohrHero !== undefined \? 0 : 1\) : raw;/);
  assert.doesNotMatch(css, /gradient\(/i);
  assert.doesNotMatch(css + page, /#(?:8a2be2|9370db|800080|7b68ee|6a5acd|3c3a52)\b/i, "nothing purple");
});

test("a release is shown as its own page, from the door and from the history", () => {
  const notice = read("./UpdateNotice.jsx");
  assert.match(notice, /export const UpdateNotice = \(\{ updates = \[\], onClose \}\) => \(updates\[0\]\?\.kind === "release"/);
  assert.match(notice, /const ReleaseNotice = lazy\(\(\) => import\("\.\/ReleaseNotice\.jsx"\)\);/);
  const history = read("./UpdateHistory.jsx");
  assert.match(history, /const release = update\.kind === "release";/);
  assert.match(read("./notes.js"), /export const NOTICE_UPDATES = newestFirst\(\[\.\.\.RELEASES, \.\.\.NEW_UPDATES\]\);/);
});
