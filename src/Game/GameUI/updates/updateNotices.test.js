/*! Open Historia — the notice behind the vault door: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/updates/updateNotices.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { NOTICE_UPDATES, UPDATES } from "./notes.js";
import { PAST_UPDATES } from "./notesPast.js";
import { RELEASES } from "./notesReleases.js";
import { CHANGELOG_BANNER, UPDATES_SHOWN_MOST, UPDATE_NOTE_KEY, buildShowsUpdateNotices, canRememberUpdates, noticePages, pendingUpdates, previewedUpdates, releaseChapterEntries, rememberUpdate, seenUpdate } from "./updateNotices.js";

const memory = () => {
  const kept = new Map();
  return { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, String(value)), removeItem: (key) => kept.delete(key) };
};
const list = [
  { id: "c", kind: "major", date: "2026-10-15", banners: [{ title: "C1" }, { title: "C2" }] },
  { id: "b", kind: "minor", date: "2026-08-01", banners: [{ title: "B", items: ["one"] }] },
  { id: "a", kind: "major", date: "2026-07-01", banners: [{ title: "A" }] },
];

test("only an update with a notice is shown, once, and nothing where it could not be kept", () => {
  // A build with no new entry (a hotfix, a notice forgotten): the newest entry was seen, so nothing.
  assert.deepEqual(pendingUpdates({ updates: list, seen: "c", keeps: true }), []);
  // Storage refused: shown nowhere, rather than at every opening.
  assert.deepEqual(pendingUpdates({ updates: list, seen: null, keeps: false }), []);
  const refusing = { getItem: () => null, setItem: () => { throw new Error("refused"); }, removeItem: () => {} };
  assert.equal(canRememberUpdates(refusing), false);
  assert.equal(canRememberUpdates(memory()), true);
  assert.equal(canRememberUpdates(null), false);
  // Kept the moment it is shown, not on closing.
  const app = readFileSync(new URL("../../../App.jsx", import.meta.url), "utf8");
  assert.match(app, /if \(noticeShown && !notice\.preview\) rememberUpdate\(notice\.updates\[0\]\.id\);/);
  assert.doesNotMatch(app, /closeNotice = useCallback\([^\n]*rememberUpdate/);
});

test("one Beta release entry covers the combined Advisor, country tools and currency batch", () => {
  const id = "2026-11-advisor-country-tools";
  const updates = UPDATES.filter((update) => update.id === id);
  assert.equal(updates.length, 1);
  const update = updates[0];
  assert.equal(update.kind, "minor");
  assert.equal(update.channel, "beta");
  assert.equal(update.date, "2026-11-12");
  assert.equal(update.banners.length, 1);
  assert.equal(update.banners[0].items.length, 6);
  assert.equal(NOTICE_UPDATES.filter((item) => item.id === id).length, 1);
  assert.equal(previewedUpdates("?updateNotice=" + id)[0]?.id, id);
  assert.deepEqual(noticePages([update]).map((page) => page.key), [id + "#0"]);
});

test("Political World and pre-game history improvements have a Beta update notice", () => {
  const id = "2026-11-political-world-prehistory";
  const updates = UPDATES.filter((update) => update.id === id);
  assert.equal(updates.length, 1, "the update is listed once in history");
  const update = updates[0];
  assert.equal(update.kind, "minor");
  assert.equal(update.channel, "beta");
  assert.equal(update.date, "2026-11-13");
  assert.equal(update.banners.length, 1);
  assert.equal(update.banners[0].items.length, 6);
  assert.ok(update.banners[0].items.some((text) => /Existing treaties generated with Political World/.test(text)));
  assert.equal(NOTICE_UPDATES.filter((entry) => entry.id === id).length, 1);
  assert.equal(previewedUpdates("?updateNotice=" + id)[0]?.id, id);
  assert.deepEqual(noticePages([update]).map((page) => page.key), [id + "#0"]);
});

test("the website's browser version shows no update notices; the apps do", () => {
  // "make update announcements not appear on the website beta" (the owner, 2026-11-09).
  assert.equal(buildShowsUpdateNotices({ VITE_OH_WEB: true, VITE_OH_NATIVE: false }), false, "the website");
  assert.equal(buildShowsUpdateNotices({ VITE_OH_WEB: true, VITE_OH_NATIVE: true }), true, "the Android app, a web build too");
  assert.equal(buildShowsUpdateNotices({ VITE_OH_WEB: false, VITE_OH_NATIVE: false }), true, "the desktop app");
  assert.equal(buildShowsUpdateNotices({ DEV: true }), true, "a dev server");
  assert.equal(buildShowsUpdateNotices(), true);
  const app = readFileSync(new URL("../../../App.jsx", import.meta.url), "utf8");
  assert.match(app, /updates: buildShowsUpdateNotices\(import\.meta\.env\) \? pendingUpdates\(\) : \[\]/);
  // Nothing else asks for the pending notices.
  assert.equal(app.match(/pendingUpdates\(/g)?.length, 1);
});

test("each update is shown once a device; one that missed several is shown all of them, newest first", () => {
  assert.deepEqual(pendingUpdates({ updates: list, seen: null, keeps: true }).map((update) => update.id), ["c"], "a first opening: the newest");
  // ... and the major ones of the month before it (the music, released before there was a notice); a minor one waits in the history.
  const recent = [list[0], { ...list[1], date: "2026-10-13" }, { ...list[2], date: "2026-10-12" }];
  assert.deepEqual(pendingUpdates({ updates: recent, seen: null, keeps: true }).map((update) => update.id), ["c", "a"]);
  const firstLook = pendingUpdates({ seen: null, keeps: true }).map((update) => update.id);
  assert.equal(firstLook[0], NOTICE_UPDATES.find((update) => update.kind === "release").id, "the newest release, owed to everyone");
  assert.ok(firstLook.length <= UPDATES_SHOWN_MOST);
  // Only the updates written as notices, never the history before them: "make sure people ONLY see the update popup
  // things for the updates that are actually being added (plus the music one), not for every update in the history"
  // (the owner, 2026-10-16).
  // A release tells everything under it, so a device owed one is shown it alone.
  assert.deepEqual(firstLook, ["2026-11-version-2-5"]);
  assert.deepEqual(pendingUpdates({ seen: "2026-11-themes", keeps: true }).map((update) => update.id), ["2026-11-version-2-5"]);
  // The updates since the release, once it is kept.
  const sinceRelease = NOTICE_UPDATES.slice(0, NOTICE_UPDATES.findIndex((update) => update.id === "2026-11-version-2-5"));
  assert.ok(sinceRelease.some((update) => update.id === "2026-11-nine-languages"));
  assert.deepEqual(
    pendingUpdates({ seen: "2026-11-version-2-5", keeps: true }).map((update) => update.id),
    sinceRelease.slice(0, UPDATES_SHOWN_MOST).map((update) => update.id),
  );
  assert.deepEqual(pendingUpdates({ seen: NOTICE_UPDATES[0].id, keeps: true }), []);
  // A release newer than the one kept, under updates newer still, is still shown alone.
  const after = [{ id: "n", kind: "minor", banners: [{ title: "x" }] }, { id: "r", kind: "release" }, { id: "o", kind: "minor", banners: [{ title: "y" }] }];
  assert.deepEqual(pendingUpdates({ updates: after, seen: "o", keeps: true }).map((update) => update.id), ["r"]);
  assert.deepEqual(pendingUpdates({ updates: after, seen: null, keeps: true }).map((update) => update.id), ["r"]);
  assert.deepEqual(pendingUpdates({ updates: after, seen: "r", keeps: true }).map((update) => update.id), ["n"]);
  const past = new Set(PAST_UPDATES.map((update) => update.id));
  for (const seen of [null, "gone", ...past]) {
    assert.deepEqual(pendingUpdates({ seen, keeps: true }).filter((update) => past.has(update.id)), [], `seen ${seen}: no history entry`);
  }
  assert.ok(UPDATES.length > NOTICE_UPDATES.length, "the history keeps every entry");
  assert.deepEqual(pendingUpdates({ updates: list, seen: "c", keeps: true }), [], "seen: nothing");
  assert.deepEqual(pendingUpdates({ updates: list, seen: "a", keeps: true }).map((update) => update.id), ["c", "b"]);
  assert.deepEqual(pendingUpdates({ updates: list, seen: "gone", keeps: true }).map((update) => update.id), ["c"], "a kept id no longer listed: the newest (and its month's)");
  const many = Array.from({ length: 9 }, (_, at) => ({ id: `u${at}`, kind: "minor", banners: [{ title: "x" }] }));
  assert.equal(pendingUpdates({ updates: many, seen: "u8", keeps: true }).length, UPDATES_SHOWN_MOST);
  // Kept by the newest shown.
  const storage = memory();
  rememberUpdate("c", storage);
  assert.equal(storage.getItem(UPDATE_NOTE_KEY), "c");
  assert.equal(seenUpdate(storage), "c");
});

test("every banner of the updates shown is a page, and a preview shows one update whatever was seen", () => {
  assert.deepEqual(noticePages(list.slice(0, 2)).map((page) => page.banner.title), ["C1", "C2", "B"]);
  // Every major update's pages before any minor one's, newest first within each.
  assert.deepEqual(noticePages(list).map((page) => page.key), ["c#0", "c#1", "a#0", "b#0"]);
  assert.deepEqual(noticePages([list[1], list[0]]).map((page) => page.key), ["c#0", "c#1", "b#0"]);
  assert.equal(previewedUpdates("", list), null);
  assert.deepEqual(previewedUpdates("?updateNotice=latest", list).map((update) => update.id), ["c"]);
  assert.deepEqual(previewedUpdates("?updateNotice=b&x=1", list).map((update) => update.id), ["b"]);
  assert.equal(previewedUpdates("?updateNotice=nope", list), null);
});

test("several minor updates are one changelog page; one minor, the majors and a release are shown as before", () => {
  // "make it so if there are multiple minor update annoucements, it merges them all into one changelog" (the owner, 2026-11-09).
  const owed = [
    { id: "m3", kind: "minor", date: "2026-11-05", banners: [{ title: "Three", items: ["c"] }, { title: "Three more", items: ["d"] }] },
    { id: "big", kind: "major", date: "2026-11-04", banners: [{ title: "Big 1" }, { title: "Big 2" }] },
    { id: "m2", kind: "minor", date: "2026-11-03", banners: [{ title: "Two", items: ["b"] }] },
    { id: "m1", kind: "minor", date: "2026-11-02", banners: [{ title: "One", items: ["a"] }] },
  ];
  const pages = noticePages(owed);
  // The major's own pages first (each in its theme), then ONE changelog of every minor update, newest first.
  assert.deepEqual(pages.map((page) => page.key), ["big#0", "big#1", "changelog#m3"]);
  const changelog = pages[2];
  assert.equal(changelog.banner, CHANGELOG_BANNER);
  assert.equal(changelog.banner.title, "What's new");
  assert.deepEqual(changelog.changelog.map((update) => update.id), ["m3", "m2", "m1"]);
  assert.equal(changelog.update.id, "m3", "dressed as the newest minor update");
  assert.equal(changelog.update.kind, "minor");
  assert.ok(changelog.changelog.every((update) => update.kind === "minor"), "no major inside it");
  // Only minors: one page, the changelog.
  assert.deepEqual(noticePages(owed.filter((update) => update.kind === "minor")).map((page) => page.key), ["changelog#m3"]);
  // A single minor update looks as it did: its own banners, a page each.
  assert.deepEqual(noticePages([owed[1], owed[0]]).map((page) => page.key), ["big#0", "big#1", "m3#0", "m3#1"]);
  assert.deepEqual(noticePages([owed[2]]).map((page) => page.key), ["m2#0"]);
  assert.equal(noticePages([owed[2]])[0].changelog, undefined);
  // Majors only: untouched.
  assert.deepEqual(noticePages([owed[1], list[2]]).map((page) => page.key), ["big#0", "big#1", "a#0"]);
  // A release is still shown alone, minors under it and all.
  const withRelease = [owed[0], { id: "r", kind: "release" }, owed[2], owed[3]];
  assert.deepEqual(pendingUpdates({ updates: [owed[0], { id: "r", kind: "release" }, owed[2]], seen: "m1", keeps: true }).map((update) => update.id), ["r"]);
  assert.deepEqual(pendingUpdates({ updates: withRelease, seen: "m1", keeps: true }).map((update) => update.id), ["r"]);
  // Seen bookkeeping is the list's, not the pages': the newest update owed is what is remembered (App.jsx keeps
  // notice.updates[0]), whichever page shows it.
  const shown = pendingUpdates({ updates: owed, seen: "m1", keeps: true });
  assert.deepEqual(shown.map((update) => update.id), ["m3", "big", "m2"]);
  assert.deepEqual(noticePages(shown).map((page) => page.key), ["big#0", "big#1", "changelog#m3"]);
  const storage = memory();
  rememberUpdate(shown[0].id, storage);
  assert.equal(seenUpdate(storage), "m3");
  assert.deepEqual(pendingUpdates({ updates: owed, seen: seenUpdate(storage), keeps: true }), [], "nothing comes back");
  // The notice draws the changelog page as one card.
  const notice = readFileSync(new URL("./UpdateNotice.jsx", import.meta.url), "utf8");
  assert.match(notice, /if \(page\.changelog\) return <ChangelogBanner banner=\{banner\} updates=\{page\.changelog\} \/>;/);
});

test("the notes are well made: new ids, dates, banners with what their kind needs, and themes that exist", () => {
  const ids = UPDATES.map((update) => update.id);
  assert.equal(new Set(ids).size, ids.length, "an id is never reused");
  const themes = readFileSync(new URL("./themes/index.js", import.meta.url), "utf8");
  const iconsSource = readFileSync(new URL("./updateKit.jsx", import.meta.url), "utf8");
  for (const update of UPDATES) {
    assert.match(update.date, /^\d{4}-\d{2}-\d{2}$/);
    if (update.kind === "release") continue;
    assert.ok(["major", "minor"].includes(update.kind));
    assert.ok(update.banners.length > 0);
    for (const banner of update.banners) {
      assert.ok(banner.title, `${update.id}: a banner has a title`);
      if (update.kind === "minor") assert.ok((banner.items ?? []).length > 0, `${update.id}: a minor banner has lines`);
      else assert.ok((banner.sections ?? []).length > 0, `${update.id}: a major banner has sections`);
      if (banner.theme) assert.match(themes, new RegExp(`\\b${banner.theme}: \\{ Page: lazy\\(.*?\\), chrome: \\w+ \\}`), `${update.id}: the theme ${banner.theme} is named in themes/index.js, with its chrome`);
      for (const section of banner.sections ?? []) assert.match(iconsSource, new RegExp(`\\b${section.icon}: \\(size\\)`), `${update.id}: the icon ${section.icon} is in the kit`);
    }
  }
  // Every theme file but the template is named, and the template is named nowhere.
  const files = readdirSync(new URL("./themes/", import.meta.url)).filter((name) => name.endsWith(".jsx"));
  for (const name of files) {
    const named = themes.includes(`./${name}`);
    assert.equal(named, name !== "ThemeTemplate.jsx", name);
  }
});

test("every coding agent is told to write the notice unprompted, and where the guide is", () => {
  const read = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
  const agents = read("AGENTS.md");
  assert.match(agents, /Standing order: every update players will notice ships with its update notice/);
  assert.match(agents, /src\/Game\/GameUI\/updates\/notes\.js/);
  assert.match(agents, /docs\/update-notices\.md/);
  assert.match(read("CLAUDE.md"), /^@AGENTS\.md$/m, "Claude Code reads AGENTS.md through CLAUDE.md");
  const guide = read("docs/update-notices.md");
  for (const part of ["notes.js", "ThemeTemplate.jsx", "themes/index.js", "?updateNotice=", "useStill", "useNarrow", "noGradients.test.js", "catalog-en.json"]) assert.ok(guide.includes(part), part);
  assert.match(read("docs/README.md"), /\(update-notices\.md\)/);
  assert.match(read("CONTRIBUTING.md"), /docs\/update-notices\.md/);
});

test("the door opens onto the notice, which is over the menu and under the door", () => {
  const app = readFileSync(new URL("../../../App.jsx", import.meta.url), "utf8");
  assert.match(app, /const noticeShown = menuReady && notice\.updates\.length > 0 && \(door === "open" \|\| parting\);/);
  const kit = readFileSync(new URL("./updateKit.jsx", import.meta.url), "utf8");
  const door = readFileSync(new URL("../VaultDoor.jsx", import.meta.url), "utf8");
  const notice = Number(kit.match(/NOTICE_Z = (\d+)/)[1]);
  const doorZ = Number(door.match(/zIndex: (\d{9,})/)[1]);
  assert.ok(notice < doorZ && notice > 100000, `${notice} under the door's ${doorZ}`);
});
