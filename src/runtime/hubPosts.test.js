/*! Open Historia — reading the community hub: post tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubPosts.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHubIndex } from "./hubFiles.js";
import { hubCopiesByPostId, hubCopyStatus, hubOriginalGone, hubUpdateAvailable, hubUpdateReason, parsePost } from "./hubPosts.js";

const FILE = "https://github.com/user-attachments/files/1/old-world-scenario.zip";
const post = (body) => parsePost({ number: 12, title: "[Scenario] Old World", user: { login: "ann" }, body });

test("the detail view gets the author's whole description, line breaks and all", () => {
  const setup = "Start as Rome.  Hold Sicily\tby 260 BC.";
  const body = [
    "### Description",
    "",
    "A world before the Punic Wars.",
    "",
    "",
    "",
    "How to play:",
    `- ${setup}`,
    "- Watch Carthage's fleet.",
    `[old-world-scenario.zip](${FILE})`,
    "",
    "### Made by",
    "",
    "ann",
  ].join("\r\n");
  const parsed = post(body);
  assert.equal(
    parsed.fullDescription,
    "A world before the Punic Wars.\n\nHow to play:\n- Start as Rome. Hold Sicily by 260 BC.\n- Watch Carthage's fleet.",
    "paragraphs and list lines kept; runs of spaces, tabs and blank lines squeezed; the file link and other sections gone",
  );
  assert.equal(parsed.description, "A world before the Punic Wars. How to play: - Start as Rome. Hold Sicily by 260 BC. - Watch Carthage's fleet.");
});

test("cards and search still get one line of at most 200 characters", () => {
  const long = Array.from({ length: 30 }, (_, index) => `Line ${index} of the notes.`).join("\n");
  const parsed = post(`### Description\n\n${long}\n\n### Basemap info\n\nBasemap-Hash: ${"a".repeat(64)}`);
  assert.equal(parsed.description.length, 200);
  assert.ok(parsed.description.endsWith("..."));
  assert.doesNotMatch(parsed.description, /\n/);
  assert.equal(parsed.fullDescription, long, "the whole text survives for the detail view");
  assert.doesNotMatch(parsed.fullDescription, /Basemap-Hash/);
});

test("a heading with nothing after it no longer swallows the line below it", () => {
  assert.equal(post("An old post with no form.\n##\nSecond line.").fullDescription, "An old post with no form.\n\nSecond line.");
  assert.equal(post("### Description\n\n_No response_\n\n### Made by\n\nann").description, "");
});

const OLD = "https://github.com/user-attachments/files/1/v1.zip";
const NEW = "https://github.com/user-attachments/files/2/v2.zip";
const RELEASES = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download/scenarios-1";
const OLD_COPY = `${RELEASES}/p12-1-v1-11111111.zip`;
const NEW_COPY = `${RELEASES}/p12-2-v2-22222222.zip`;
const EDITED_AT = "2026-09-02T00:00:00.000Z";
const copy = (id, hubOrigin, updatedAt = "2026-09-01T00:00:00.000Z") => ({ id, name: id, updatedAt, hubOrigin });
// A link as a download stamps it now: the post's file, and the checked copy
// of it that was downloaded.
const link = (bundleUrl, extra = {}) => ({ postId: 12, bundleUrl, release: bundleUrl === NEW ? NEW_COPY : OLD_COPY, ...extra });
// An old link: made when the game downloaded the post's own attachment.
const oldLink = (bundleUrl, extra = {}) => ({ postId: 12, bundleUrl, ...extra });
// The post as fetchHubPosts lists it: on the hub, with a checked copy to download.
const hubPost = { id: 12, bundleUrl: NEW, releaseUrl: NEW_COPY };

test("an unedited copy of an older file can update; an edited one, another post's or a current one cannot", () => {
  assert.equal(hubUpdateReason(copy("a", link(OLD)), hubPost), "newer");
  assert.equal(hubUpdateAvailable(copy("a", link(OLD)), hubPost), true);
  assert.equal(hubUpdateAvailable(copy("b", link(NEW)), hubPost), false);
  assert.equal(hubUpdateAvailable(copy("c", link(OLD, { editedAt: EDITED_AT })), hubPost), false);
  assert.equal(hubUpdateAvailable(copy("d", link(OLD, { postId: 13 })), hubPost), false);
  assert.equal(hubUpdateAvailable(copy("e", null), hubPost), false);
  assert.equal(hubUpdateAvailable(copy("f", link(OLD)), null), false, "a post off the list offers nothing");
  // The same file released again under another address is not a newer file:
  // the post's identity is its attachment.
  const reissued = copy("h", link(NEW, { release: `${RELEASES}/p12-2-v2-99999999.zip` }));
  assert.equal(hubUpdateAvailable(reissued, hubPost), false);
});

test("a current copy whose community basemap could not be downloaded offers Update until it has it", () => {
  const missingBasemap = { reference: { mode: "communityRef", url: "https://github.com/user-attachments/assets/basemap.png" } };
  const current = { ...copy("g", link(NEW)), missingBasemap };
  assert.equal(hubUpdateReason(current, hubPost), "basemap");
  assert.deepEqual(hubCopyStatus([current], hubPost), { status: "update", copy: current });
  assert.equal(hubUpdateAvailable({ ...current, hubOrigin: link(NEW, { editedAt: EDITED_AT }) }, hubPost), false, "never over the player's edits");
});

test("a copy downloaded the old way is asked to update while its post is on the hub, edited or not", () => {
  // No release on the link: the copy came from the post's own attachment,
  // before the hub checked what it gave out.
  assert.equal(hubUpdateReason(copy("old", oldLink(NEW)), hubPost), "unchecked", "even of the file the post still has");
  assert.equal(hubUpdateReason(copy("older", oldLink(OLD)), hubPost), "unchecked");
  const missingBasemap = { reference: { mode: "communityRef", url: "https://github.com/user-attachments/assets/basemap.png" } };
  assert.equal(hubUpdateReason({ ...copy("bare", oldLink(NEW)), missingBasemap }, hubPost), "unchecked", "the reason said is that one");

  // An edited copy is never offered a newer file, but it is told about this.
  const edited = copy("edited", oldLink(NEW, { editedAt: EDITED_AT }));
  assert.equal(hubUpdateReason(edited, hubPost), "unchecked");
  assert.equal(hubUpdateAvailable(edited, hubPost), true);

  // A post that is no longer on the hub, or has no checked copy to offer:
  // nothing can be downloaded, so nothing is asked.
  assert.equal(hubUpdateReason(copy("old", oldLink(NEW)), null), null);
  assert.equal(hubUpdateReason(copy("old", oldLink(NEW)), { id: 12, bundleUrl: NEW, releaseUrl: null }), null);
  assert.equal(hubUpdateReason(copy("old", oldLink(NEW)), { ...hubPost, id: 13 }), null, "another post's file is not this copy's");
  assert.equal(hubUpdateReason(copy("mine", null), hubPost), null);
});

test("the library's copies are grouped by post, and a card says what the library holds", () => {
  const mine = copy("mine", null);
  const edited = copy("edited", link(OLD, { editedAt: "2026-09-03T00:00:00.000Z" }), "2026-09-05T00:00:00.000Z");
  const stale = copy("stale", link(OLD), "2026-09-02T00:00:00.000Z");
  const fresh = copy("fresh", link(NEW), "2026-09-01T00:00:00.000Z");
  const other = copy("other", link(OLD, { postId: 40 }));
  const byPost = hubCopiesByPostId([mine, edited, stale, fresh, other]);
  assert.deepEqual([...byPost.keys()].sort((a, b) => a - b), [12, 40]);
  assert.deepEqual(byPost.get(12).map((entry) => entry.id), ["edited", "stale", "fresh"]);

  assert.deepEqual(hubCopyStatus(byPost.get(12), hubPost), { status: "current", copy: fresh }, "a current copy wins");
  assert.deepEqual(hubCopyStatus([edited, stale], hubPost), { status: "update", copy: stale }, "an unedited copy wins over a newer edited one");
  assert.deepEqual(hubCopyStatus([edited], hubPost), { status: "edited", copy: edited });
  assert.deepEqual(hubCopyStatus(undefined, hubPost), { status: null, copy: null });

  const later = copy("later", link(NEW), "2026-09-09T00:00:00.000Z");
  assert.equal(hubCopyStatus([fresh, later], hubPost).copy, later, "of several, the one touched last");
});

test("a card's badge says an old link wants an update, as the Scenarios tab does", () => {
  const unchecked = copy("unchecked", oldLink(NEW), "2026-09-02T00:00:00.000Z");
  const editedUnchecked = copy("edited-unchecked", oldLink(NEW, { editedAt: EDITED_AT }), "2026-09-06T00:00:00.000Z");
  const fresh = copy("fresh", link(NEW), "2026-09-01T00:00:00.000Z");
  const edited = copy("edited", link(OLD, { editedAt: EDITED_AT }), "2026-09-04T00:00:00.000Z");

  assert.deepEqual(hubCopyStatus([unchecked], hubPost), { status: "unchecked", copy: unchecked });
  assert.deepEqual(hubCopyStatus([editedUnchecked], hubPost), { status: "unchecked", copy: editedUnchecked }, "an edited one too: its card asks, and its Update asks first");
  assert.deepEqual(hubCopyStatus([editedUnchecked, unchecked], hubPost), { status: "unchecked", copy: unchecked }, "an unedited copy is still the one to play");
  assert.deepEqual(hubCopyStatus([unchecked, editedUnchecked, fresh], hubPost), { status: "current", copy: fresh }, "a checked, current copy wins over both");
  assert.deepEqual(hubCopyStatus([edited, editedUnchecked], hubPost), { status: "unchecked", copy: editedUnchecked }, "of edited copies, the one touched last decides");
  // Off the hub, the old link is left as it is: an unedited copy with nothing to take.
  assert.deepEqual(hubCopyStatus([unchecked], null), { status: "current", copy: unchecked });
});

test("the file a copy came from is gone when its link is an old one, or its post has moved on", () => {
  const index = normalizeHubIndex({ version: 2, files: { [NEW]: NEW_COPY }, imports: {}, posts: [], suggestions: {} });
  assert.equal(hubOriginalGone(link(NEW), index), false, "the checked copy of the post's file is still there to compare with");
  assert.equal(hubOriginalGone(link(NEW, { editedAt: EDITED_AT }), index), false);
  assert.equal(hubOriginalGone(link(OLD), index), true, "the post has a newer file, and the hub no longer holds the older one");
  assert.equal(hubOriginalGone(oldLink(NEW), index), true, "an old link came from the unchecked attachment: the hub's file is not that file");
  assert.equal(hubOriginalGone(null, index), true);
  // The same attachment released again: its present copy is what there is to compare with.
  assert.equal(hubOriginalGone(link(NEW, { release: `${RELEASES}/p12-2-v2-99999999.zip` }), index), false);
});
