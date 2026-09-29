/*! Open Historia — the community hub's issue lists © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The Scenario Hub is a GitHub repo whose open issues are the community's
// posts, told apart by label: "scenario" (the Community tab, and the basemaps
// and flag packs carried inside scenarios), "basemap" and "flag". Everything
// reads them unauthenticated, 60 requests an hour per player, so a list is
// fetched once and kept five minutes for every screen that shows it, and
// callers asking at the same time share the one request.
//
// A leaf module: hubPosts.js imports communityBasemaps.js, so what both need
// lives here rather than in either.

// The one and only hub. Not configurable by design.
export const HUB_OWNER = "Open-Historia";
export const HUB_REPO = "Open-historia-scenarios";
export const HUB_URL = `https://github.com/${HUB_OWNER}/${HUB_REPO}`;
export const HUB_API = `https://api.github.com/repos/${HUB_OWNER}/${HUB_REPO}`;

const CACHE_TTL_MS = 5 * 60 * 1000;
// GitHub serves 100 entries a page; a list stops after this many pages.
export const MAX_HUB_PAGES = 10;
const HEADERS = { Accept: "application/vnd.github+json" };

// A failed read, with the HTTP status for the caller's own message.
export class HubHttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

// The next page's URL from GitHub's Link header, or null. Only GitHub's API
// is followed.
export const nextPageUrl = (link) => {
  for (const part of String(link ?? "").split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part);
    if (match) return /^https:\/\/api\.github\.com\//i.test(match[1]) ? match[1] : null;
  }
  return null;
};

// Every page of a GitHub list, following rel="next" up to `maxPages`. A first
// page that fails throws; a later one throws too, unless `partial`, which ends
// the list there instead.
export const fetchHubPages = async (url, { maxPages = MAX_HUB_PAGES, partial = false } = {}) => {
  const items = [];
  let next = url;
  for (let page = 0; next && page < maxPages; page += 1) {
    let response;
    try {
      response = await fetch(next, { headers: HEADERS });
      if (!response.ok) throw new HubHttpError(response.status);
    } catch (error) {
      if (page > 0 && partial) break;
      throw error;
    }
    const body = await response.json();
    if (Array.isArray(body)) items.push(...body);
    next = nextPageUrl(response.headers?.get?.("link"));
  }
  return items;
};

const issueCache = new Map(); // label -> { at, issues, pending }

// The hub's open issues carrying `label`, pull requests left out.
export const fetchHubIssues = async (label, { force = false } = {}) => {
  const cached = issueCache.get(label);
  if (!force && cached?.issues && Date.now() - cached.at < CACHE_TTL_MS) return cached.issues;
  if (!force && cached?.pending) return cached.pending;
  const pending = fetchHubPages(`${HUB_API}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`, { partial: true })
    .then((issues) => {
      const list = issues.filter((issue) => issue && !issue.pull_request);
      issueCache.set(label, { at: Date.now(), issues: list });
      return list;
    })
    .catch((error) => {
      issueCache.set(label, { at: cached?.at ?? 0, issues: cached?.issues ?? null });
      throw error;
    });
  issueCache.set(label, { at: cached?.at ?? 0, issues: cached?.issues ?? null, pending });
  return pending;
};

// The scenario posts: the Community tab's list, and where basemaps and flag
// packs shared inside scenarios are found.
export const fetchHubScenarioIssues = (options) => fetchHubIssues("scenario", options);

// ---- images on the cards ----------------------------------------------------

// An image a card loads straight from its URL, with no click: only GitHub's
// own hosts over https (github.com/user-attachments, *.githubusercontent.com,
// camo included). Anywhere else, whoever wrote the post would learn the
// address of every player who opens the tab.
export const hubImageUrl = (value) => {
  const url = String(value ?? "").trim();
  return /^https:\/\/(?:github\.com\/|(?:[a-z0-9-]+\.)*githubusercontent\.com\/)/i.test(url) ? url : null;
};

// The first image in an issue body a card may show: markdown ![alt](url) or
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
