/*! Open Historia — the community hub's issue lists © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The Scenario Hub is a GitHub repo whose issues are the community's posts,
// told apart by label: "scenario" (the Community tab, and the basemaps and
// flag packs carried inside scenarios), "basemap" and "flag". The game does
// not ask GitHub for them. The hub's own workflow publishes the list (the
// posts whose file it has checked and released, and no others) in its index,
// and every screen that shows posts reads them from that one file, kept five
// minutes and shared by callers asking at the same time (hubFiles.js). It
// costs none of the 60 API requests an hour a player has; those are left for
// the one thing still read through GitHub's API, a post's comments
// (hubPosts.js fetchPostComments).
//
// hubPosts.js imports communityBasemaps.js, so what both need lives here
// rather than in either.

import { HUB_OWNER, HUB_REPO } from "../../server/hubProvenance.js";
import { fetchHubIndex, hubIndexProblem } from "./hubFiles.js";

// The one and only hub (server/hubProvenance.js, where the stores read it too).
export { HUB_OWNER, HUB_REPO };
export const HUB_URL = `https://github.com/${HUB_OWNER}/${HUB_REPO}`;
export const HUB_API = `https://api.github.com/repos/${HUB_OWNER}/${HUB_REPO}`;

// The hub's posts carrying `label`, as the issue objects the parsers read
// (hubPosts.js parsePost, communityFlags.js, communityBasemaps.js): the
// index's own list, which holds a post once its file has been checked and
// released, whether its issue is open or closed. The index is kept five
// minutes; `force` (a Refresh button) reads it again. When the hub has no list
// to give (it could not be reached, or its index is from before it kept one)
// this fails with a sentence a player can read. GitHub's API is never asked
// instead: what the hub has not released is not listed.
export const fetchHubIssues = async (label, { force = false } = {}) => {
  const index = await fetchHubIndex({ force });
  const problem = hubIndexProblem(index);
  if (problem) throw new Error(problem);
  return index.posts.filter((post) => post.labels.includes(label));
};

// The scenario posts: the Community tab's list, and where basemaps and flag
// packs shared inside scenarios are found.
export const fetchHubScenarioIssues = (options) => fetchHubIssues("scenario", options);

// ---- images on the cards ----------------------------------------------------

// An image a post attached, by its address: only GitHub's own hosts over
// https (github.com/user-attachments, *.githubusercontent.com, camo
// included). No card loads it from there: the address is what the image's
// checked copy is looked up by (hubFiles.js releaseCopyOf), and the copy is
// what a card shows.
export const hubImageUrl = (value) => {
  const url = String(value ?? "").trim();
  return /^https:\/\/(?:github\.com\/|(?:[a-z0-9-]+\.)*githubusercontent\.com\/)/i.test(url) ? url : null;
};

// The first image in an issue body that GitHub hosts: markdown ![alt](url) or
// GitHub's own <img src="..."> attachment markup (issue bodies mix both,
// depending on how the image was pasted), or null.
const IMAGE_PATTERN = /!\[[^\]]*\]\((https:\/\/[^\s)]+)\)|<img[^>]+src=["']([^"']+)["']/gi;
export const firstHubImage = (body) => {
  for (const match of String(body ?? "").matchAll(IMAGE_PATTERN)) {
    const url = hubImageUrl(match[1] ?? match[2]);
    if (url) return url;
  }
  return null;
};
