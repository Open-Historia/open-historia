/*! Open Historia — community flags client © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Flags shared by other people, read from the hub repo's posts.
//
// Mirrors communityBasemaps.js deliberately, including the parts that look odd.
// The list is the hub's own (hubIssues.js): a flag post is on it once the hub
// has checked its image and put a checked copy in its releases, a minute or so
// after its author hits Submit, and not before. That copy is what a card shows
// and what is downloaded, through /api/hub/file because GitHub's files send no
// CORS headers; the post's own attachment is never fetched (hubFiles.js).
//
// Kept free of React/OpenLayers deps so the editor and the game can both use it.

import { unzipBundle, looksLikeZip } from "./bundleZip.js";
import { bytesToBase64, restoreBundleFiles } from "./bundleFiles.js";
import { fetchHubFile, fetchHubIndex, imageTypeOfBytes, releaseCopyOf } from "./hubFiles.js";
import { HUB_URL, fetchHubIssues, fetchHubScenarioIssues, firstHubImage } from "./hubIssues.js";
import { saveBlobToDisk } from "./saveFile.js";

// The "flag" label is a contract with .github/ISSUE_TEMPLATE/flag.yml. The label must
// EXIST in the repo — GitHub silently drops a label an issue form tries to apply if
// it hasn't been created, and the post then never appears here.
// Scenario posts are scanned too: one whose publish stamped a Flags-Count tag
// carries custom flags in its bundle, and surfaces here as an installable flag
// pack — the same trick communityBasemaps.js uses for scenario-carried basemaps.
// Both lists are hubIssues.js's, cached and shared with the other hub screens.

const OFFICIAL_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

// GitHub renders a dragged-in png/jpg inline as markdown, but attaches an .svg as a
// file link — so a flag can arrive either way.
const IMAGE_EXT_PATTERN = /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i;
const FILE_LINK_PATTERN =
  /https:\/\/(?:github\.com\/[^\s)<>"']+\/files\/[^\s)<>"']+|github\.com\/user-attachments\/files\/[^\s)<>"']+|raw\.githubusercontent\.com\/[^\s)<>"']+)/i;
// Optional, and only a hint: which country the author drew this for.
const CODE_PATTERN = /Flag-Code:\s*([A-Za-z0-9_-]{2,12})/i;
const CODE_TOKEN = /^[A-Za-z0-9_-]{2,12}$/;
// The polity's name exactly as the author's map has it ("Holy Roman Empire"),
// which Flag-Code cannot carry: it is upper-cased and cut to one short token.
const POLITY_PATTERN = /^[ \t]*Flag-Polity:[ \t]*(.+?)[ \t]*$/im;
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
  // Only an image GitHub hosts (hubIssues.js firstHubImage).
  const cover = firstHubImage(body);
  const fileLink = firstMatch(body, FILE_LINK_PATTERN);
  // An .svg (or any image GitHub attached rather than rendered) is the flag itself,
  // not a side file. imageUrl is the flag as its post names it: what its checked
  // copy is looked up by, never an address the image is loaded from (the copy of
  // an .svg is a PNG the hub drew of it).
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
    polity: firstMatch(body, POLITY_PATTERN) || null,
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
    imageUrl: firstHubImage(body),
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
  // Dedicated flag posts, plus scenario posts (scanned so flags shared inside
  // scenarios show up here too), and the index both lists are made of: one
  // read for the three, since callers asking together share it.
  const [issues, scIssues, hubIndex] = await Promise.all([
    fetchHubIssues("flag", { force }),
    fetchHubScenarioIssues({ force }),
    fetchHubIndex({ force }),
  ]);
  const dedicated = issues.map(parseFlagPost).filter(flagPostInstallable);
  const packs = scIssues.map(parseScenarioAsFlagPack).filter(Boolean);
  return [...dedicated, ...packs]
    // What the post offers has to be among the hub's checked files, or there
    // is nothing to download: a flag's image, a pack's scenario file.
    .filter((post) => releaseCopyOf(hubIndex, post.fromScenario ? post.packUrl : post.imageUrl))
    // pictureUrl is what a card shows: the checked copy of the post's image,
    // or null (a pack whose scenario has no cover: the card's placeholder).
    .map((post) => ({ ...post, pictureUrl: releaseCopyOf(hubIndex, post.imageUrl) }));
};

// GitHub's files send no CORS headers, so the bytes have to come through the
// hub proxy (Express locally, the node/Worker on the website — see router.js):
// the flag's checked copy, which says what kind of image it is by its bytes.
export const loadCommunityFlagDataUrl = async (post) => {
  if (!post?.imageUrl) throw new Error("That post has no flag image.");
  const r = await fetchHubFile(post.imageUrl);
  if (!r.ok) {
    const p = await r.json().catch(() => ({}));
    throw new Error(p.error || `Download failed (HTTP ${r.status}).`);
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const ctype = (r.headers.get("content-type") || "").split(";")[0].trim();
  const mime = imageTypeOfBytes(bytes) || (ctype.startsWith("image/") ? ctype : "image/png");
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
};

// Resolve a scenario flag pack to its flags: download the bundle through the
// hub proxy, find scenario.json (bundles ship as a .zip; older posts may be
// bare JSON), and return the CUSTOM flags from assets.flags. flagcdn URLs are
// skipped — those are the built-ins every picker already lists.
export const loadCommunityFlagPack = async (post) => {
  if (!post?.packUrl) throw new Error("That post has no scenario bundle.");
  const r = await fetchHubFile(post.packUrl);
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
    // A scenario with many custom flags carries them as a zip entry of their
    // own (bundleFiles.js lifts any asset over 64 KB). Put back only that one:
    // the rest of the bundle — geometry, tile archives — is not needed here.
    const parsed = JSON.parse(text);
    const restored = await restoreBundleFiles({ assets: { flags: parsed?.assets?.flags } }, zip);
    bundle = { ...parsed, assets: { ...(parsed?.assets ?? {}), flags: restored.assets.flags } };
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

// Open and closed alike: the hub closes a post once it has released its file.
export const communityFlagsHubUrl = () =>
  `${HUB_URL}/issues?q=${encodeURIComponent("is:issue label:flag")}`;

// The prefilled issue form's query. `polity` is the name the flag is for: it goes
// in exactly, as Flag-Polity, and as the Flag-Code hint only when it already is a
// short code-like token ("DEU", "Kuizltan") — a longer name used to arrive cut
// down to its first word ("HOLY"). `code` is only for a flag that has no polity
// name, just an old code hint (a My flags entry saved before the library kept
// the name): it goes in as Flag-Code when it is a code-like token, never as
// Flag-Polity.
export const flagPublishQuery = ({ name = "", author = "", polity = "", code = "" } = {}) => {
  const exact = String(polity || "").replace(/[\r\n]+/g, " ").trim();
  const hint = exact || String(code || "").trim();
  const technical = [
    CODE_TOKEN.test(hint) ? `Flag-Code: ${hint.toUpperCase()}` : "",
    exact ? `Flag-Polity: ${exact}` : "",
  ].filter(Boolean).join("\n");
  return [
    "template=flag.yml",
    `title=${encodeURIComponent(`[Flag] ${name || "Untitled flag"}`)}`,
    `name=${encodeURIComponent(name)}`,
    `author=${encodeURIComponent(author)}`,
    `technical=${encodeURIComponent(technical)}`,
  ].join("&");
};

// Open the prefilled issue form, for a flag the author already has as a file:
// they drag it straight into the form. GitHub issue forms cannot take a file via
// URL — that is why the image box is left for the user rather than prefilled.
export const openFlagPublishForm = (fields = {}) => {
  window.open(`${HUB_URL}/issues/new?${flagPublishQuery(fields)}`, "_blank", "noopener");
};

const FLAG_FILE_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };
const dataUrlMime = (dataUrl) => /^data:([^;,]+)/.exec(String(dataUrl || ""))?.[1]?.toLowerCase() || "image/png";

// The file a shared flag is saved as: the flag's name, made file-safe, with the
// extension of its image type.
export const flagFileName = (name, dataUrl) => {
  const safe = String(name || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "flag";
  return `${safe}.${FLAG_FILE_EXT[dataUrlMime(dataUrl)] || "png"}`;
};

// A base64 flag data URL as a file-ready Blob.
export const flagDataUrlToBlob = (dataUrl) => {
  const text = String(dataUrl || "");
  if (!/^data:[^,]*;base64,/.test(text)) throw new Error("This flag has no image to share.");
  const binary = atob(text.slice(text.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: dataUrlMime(text) });
};

// Share a flag that exists only inside the app (a data URL on the map or in My
// flags): save it as a file first, the way publishBasemap does, so the author has
// something to drag into the form, then open the form. Returns the file's name
// for the "drag it in" note.
export const publishFlag = async ({ name = "", author = "", polity = "", code = "", dataUrl } = {}) => {
  const blob = flagDataUrlToBlob(dataUrl);
  const fileName = flagFileName(name || polity, dataUrl);
  await saveBlobToDisk(blob, fileName);
  openFlagPublishForm({ name, author, polity, code });
  return { fileName };
};
