/*! Open Historia — community flags client © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Flags shared by other people, read straight from the hub repo's issues.
//
// Mirrors communityBasemaps.js deliberately, including the parts that look odd:
// there is no index file and no CI. The GitHub Issues API query IS the index, so a
// post is live for everyone the moment its author hits Submit (bounded only by the
// cache below). Listing goes direct to api.github.com because it sends CORS;
// file downloads must go through /api/hub/file because GitHub attachments do not.
//
// Kept free of React/OpenLayers deps so the editor and the game can both use it.

import { unzipBundle, looksLikeZip } from "./bundleZip.js";

const HUB_OWNER = "Open-Historia";
const HUB_REPO = "Open-historia-scenarios";
const HUB_URL = `https://github.com/${HUB_OWNER}/${HUB_REPO}`;
// `labels=flag` is a contract with .github/ISSUE_TEMPLATE/flag.yml. The label must
// EXIST in the repo — GitHub silently drops a label an issue form tries to apply if
// it hasn't been created, and the post then never appears here.
const HUB_API_FLAGS = `https://api.github.com/repos/${HUB_OWNER}/${HUB_REPO}/issues?state=open&labels=flag&per_page=100`;
// Scenario posts are scanned too: one whose publish stamped a Flags-Count tag
// carries custom flags in its bundle, and surfaces here as an installable flag
// pack — the same trick communityBasemaps.js uses for scenario-carried basemaps.
const HUB_API_SCENARIOS = `https://api.github.com/repos/${HUB_OWNER}/${HUB_REPO}/issues?state=open&labels=scenario&per_page=100`;

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, posts: null };

const OFFICIAL_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

// GitHub renders a dragged-in png/jpg inline as markdown, but attaches an .svg as a
// file link — so a flag can arrive either way.
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i;
const COVER_IMAGE_PATTERN = /!\[[^\]]*\]\((https:\/\/[^\s)]+)\)|<img[^>]+src=["']([^"']+)["']/i;
const FILE_LINK_PATTERN =
  /https:\/\/(?:github\.com\/[^\s)<>"']+\/files\/[^\s)<>"']+|github\.com\/user-attachments\/files\/[^\s)<>"']+|raw\.githubusercontent\.com\/[^\s)<>"']+)/i;
// Optional, and only a hint: which country the author drew this for.
const CODE_PATTERN = /Flag-Code:\s*([A-Za-z0-9_-]{2,12})/i;
// Stamped into a scenario post by the publish flow when its bundle carries
// custom flags. The tag is the browse-time signal — without it, knowing whether
// a scenario has flags would mean downloading every bundle.
const FLAGS_COUNT_PATTERN = /Flags-Count:\s*(\d{1,4})/i;
const ALL_FILE_LINKS_PATTERN = new RegExp(FILE_LINK_PATTERN.source, "gi");

const firstMatch = (body, pattern) => {
  const m = pattern.exec(body || "");
  if (!m) return null;
  return m[1] || m[2] || m[0] || null;
};

const parseFlagPost = (issue) => {
  const body = issue.body || "";
  const cover = firstMatch(body, COVER_IMAGE_PATTERN);
  const fileLink = firstMatch(body, FILE_LINK_PATTERN);
  // An .svg (or any image GitHub attached rather than rendered) is the flag itself,
  // not a side file.
  const imageUrl = cover || (fileLink && IMAGE_EXT_PATTERN.test(fileLink) ? fileLink : null);
  return {
    id: issue.number,
    title: String(issue.title || "").replace(/^\[Flag\]\s*/i, "").trim() || "Untitled flag",
    author: issue.user?.login || "",
    avatarUrl: issue.user?.avatar_url || "",
    url: issue.html_url,
    createdAt: issue.created_at,
    official: OFFICIAL_ASSOCIATIONS.has(issue.author_association),
    upvotes: issue.reactions?.["+1"] ?? 0,
    code: (firstMatch(body, CODE_PATTERN) || "").toUpperCase() || null,
    imageUrl,
  };
};

// A scenario post carrying custom flags (Flags-Count tag) becomes ONE pack
// card: installing it saves every custom flag into "My flags" in a single
// click. The bundle attachment is the payload; the scenario's cover image (if
// the author dragged one in) doubles as the card art.
const parseScenarioAsFlagPack = (issue) => {
  const body = String(issue.body ?? "");
  const flagCount = Number(body.match(FLAGS_COUNT_PATTERN)?.[1] ?? 0);
  if (!Number.isFinite(flagCount) || flagCount <= 0) return null;
  const links = body.match(ALL_FILE_LINKS_PATTERN) ?? [];
  const packUrl =
    links.find((link) => /\.zip(\?|#|$)/i.test(link)) ??
    links.find((link) => /\.json(\?|#|$)/i.test(link)) ??
    links[0] ??
    null;
  if (!packUrl) return null;
  return {
    id: `scenario-${issue.number}`,
    title: String(issue.title ?? "").replace(/^\[Scenario\]\s*/i, "").trim() || `Scenario #${issue.number}`,
    author: issue.user?.login || "",
    avatarUrl: issue.user?.avatar_url || "",
    url: issue.html_url,
    createdAt: issue.created_at,
    official: OFFICIAL_ASSOCIATIONS.has(issue.author_association),
    upvotes: issue.reactions?.["+1"] ?? 0,
    code: null,
    imageUrl: firstMatch(body, COVER_IMAGE_PATTERN),
    fromScenario: true,
    flagCount,
    packUrl,
  };
};

// A post is only usable if we can actually get a payload out of it: an image
// for a dedicated flag post, the bundle attachment for a scenario pack.
export const flagPostInstallable = (post) =>
  Boolean(post?.fromScenario ? post?.packUrl : post?.imageUrl);

export const fetchCommunityFlags = async ({ force = false } = {}) => {
  if (!force && cache.posts && Date.now() - cache.at < CACHE_TTL_MS) return cache.posts;

  // Dedicated flag posts, plus scenario posts (scanned so flags shared inside
  // scenarios show up here too). The scenarios call is best-effort — a failure
  // just hides the packs, exactly like the basemap browser.
  const headers = { Accept: "application/vnd.github+json" };
  const [res, scRes] = await Promise.all([
    fetch(HUB_API_FLAGS, { headers }),
    fetch(HUB_API_SCENARIOS, { headers }).catch(() => null),
  ]);
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? "GitHub rate limit reached — try again in a few minutes."
        : `Could not reach the flag hub (HTTP ${res.status}).`,
    );
  }
  const issues = await res.json();
  const dedicated = (Array.isArray(issues) ? issues : [])
    .filter((i) => !i.pull_request) // the issues endpoint returns PRs too
    .map(parseFlagPost)
    .filter(flagPostInstallable);
  let packs = [];
  if (scRes && scRes.ok) {
    const scIssues = await scRes.json().catch(() => []);
    packs = (Array.isArray(scIssues) ? scIssues : [])
      .filter((i) => !i.pull_request)
      .map(parseScenarioAsFlagPack)
      .filter(Boolean);
  }
  const posts = [...dedicated, ...packs];

  cache = { at: Date.now(), posts };
  return posts;
};

// GitHub attachments send no CORS headers, so the bytes have to come through the
// hub proxy (Express locally, the node/Worker on the website — see router.js).
export const loadCommunityFlagDataUrl = async (post) => {
  if (!post?.imageUrl) throw new Error("That post has no flag image.");
  const r = await fetch(`/api/hub/file?url=${encodeURIComponent(post.imageUrl)}`);
  if (!r.ok) {
    const p = await r.json().catch(() => ({}));
    throw new Error(p.error || `Download failed (HTTP ${r.status}).`);
  }
  const buf = await r.arrayBuffer();
  const ctype = (r.headers.get("content-type") || "").split(";")[0].trim();
  const mime = ctype.startsWith("image/") ? ctype : "image/png";
  let binary = "";
  const view = new Uint8Array(buf);
  const chunk = 0x8000; // chunked: String.fromCharCode(...huge) overflows the stack
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
};

// Resolve a scenario flag pack to its flags: download the bundle through the
// hub proxy, find scenario.json (bundles ship as a .zip; older posts may be
// bare JSON), and return the CUSTOM flags from assets.flags. flagcdn URLs are
// skipped — those are the built-ins every picker already lists.
export const loadCommunityFlagPack = async (post) => {
  if (!post?.packUrl) throw new Error("That post has no scenario bundle.");
  const r = await fetch(`/api/hub/file?url=${encodeURIComponent(post.packUrl)}`);
  if (!r.ok) {
    const p = await r.json().catch(() => ({}));
    throw new Error(p.error || `Download failed (HTTP ${r.status}).`);
  }
  const buffer = await r.arrayBuffer();
  let bundle;
  if (looksLikeZip(new Uint8Array(buffer))) {
    const zip = await unzipBundle(buffer);
    const text = await zip.text("scenario.json");
    if (!text) throw new Error("That .zip is missing scenario.json.");
    bundle = JSON.parse(text);
  } else {
    bundle = JSON.parse(new TextDecoder().decode(buffer));
  }
  // assets.flags is { data: {owner -> flag string}, mode: "embedded" } from the
  // exporter; tolerate a bare owner->flag object from hand-built bundles.
  const asset = bundle?.assets?.flags;
  const flagsMap =
    asset && typeof asset === "object" && asset.data && typeof asset.data === "object"
      ? asset.data
      : asset && typeof asset === "object" && !("mode" in asset)
        ? asset
        : {};
  const flags = Object.entries(flagsMap)
    .filter(([, value]) => typeof value === "string" && value.startsWith("data:"))
    .map(([code, dataUrl]) => ({ code, dataUrl }));
  if (!flags.length) throw new Error("No custom flags found in that scenario.");
  return flags;
};

export const communityFlagsHubUrl = () =>
  `${HUB_URL}/issues?q=${encodeURIComponent("is:issue is:open label:flag")}`;

// Open the prefilled issue form. Unlike publishBasemap there is nothing to download
// first: the author is sharing a flag they already have as a file, so they drag it
// straight into the form. GitHub issue forms cannot take a file via URL — that is
// why the image box is left for the user rather than prefilled.
export const openFlagPublishForm = ({ name = "", author = "", code = "" } = {}) => {
  const query = [
    "template=flag.yml",
    `title=${encodeURIComponent(`[Flag] ${name || "Untitled flag"}`)}`,
    `name=${encodeURIComponent(name)}`,
    `author=${encodeURIComponent(author)}`,
    `technical=${encodeURIComponent(`Flag-Code: ${String(code || "").toUpperCase()}`)}`,
  ].join("&");
  window.open(`${HUB_URL}/issues/new?${query}`, "_blank", "noopener");
};
