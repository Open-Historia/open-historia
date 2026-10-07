/*! Open Historia — reading the community hub: post tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubPosts.test.js
//
// What the library asks of a copy downloaded from a hub post: whether it
// should take the post's file again, and why. A copy whose link names no
// release was downloaded the old way, from the post's own attachment, which
// nobody had looked inside; it is asked to update while its post is still on
// the hub, whether its player has edited it or not.
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHubIndex } from "./hubFiles.js";
import { hubOriginalGone, hubUpdateAvailable, hubUpdateReason } from "./hubPosts.js";

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

test("a copy downloaded the old way is asked to update while its post is on the hub, edited or not", () => {
  // No release on the link: the copy came from the post's own attachment,
  // before the hub checked what it gave out.
  assert.equal(hubUpdateReason(copy("old", oldLink(NEW)), hubPost), "unchecked", "even of the file the post still has");
  assert.equal(hubUpdateReason(copy("older", oldLink(OLD)), hubPost), "unchecked", "the reason said is that one, not that the post has a newer file");

  // An edited copy is never offered a newer file, but it is told about this.
  const edited = copy("edited", oldLink(NEW, { editedAt: EDITED_AT }));
  assert.equal(hubUpdateReason(edited, hubPost), "unchecked");
  assert.equal(hubUpdateAvailable(edited, hubPost), true);

  // A post that is no longer on the hub, or has no checked copy to offer:
  // nothing can be downloaded, so nothing is asked.
  assert.equal(hubUpdateReason(copy("old", oldLink(NEW)), null), null);
  assert.equal(hubUpdateReason(copy("old", oldLink(NEW)), undefined), null, "nor before the hub's list has been read");
  assert.equal(hubUpdateReason(copy("old", oldLink(NEW)), { id: 12, bundleUrl: NEW, releaseUrl: null }), null);
  assert.equal(hubUpdateReason(copy("old", oldLink(NEW)), { ...hubPost, id: 13 }), null, "another post's file is not this copy's");
  assert.equal(hubUpdateReason(copy("mine", null), hubPost), null);
  assert.equal(hubUpdateReason(null, hubPost), null);
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
