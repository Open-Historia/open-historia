/*! Open Historia — community basemaps client © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Browse + install + publish basemaps shared through the community hub. Mirrors
// the scenario hub (src/Game/GameUI/communityHub.jsx): each community basemap is
// a GitHub issue labeled "basemap" (via the basemap.yml issue form) whose body
// carries the raw basemap image as an attachment — GitHub renders that image as
// the card cover for free, and install reads the same image back. A content hash
// in the body lets a scenario reference an existing community basemap instead of
// re-embedding it. Publishing is the token-less flow scenarios use: the app hands
// the author the real image file and opens a prefilled issue form to drag it into.

import { createBasemap, makeImageThumbnail, makeVectorThumbnail, sha256Hex } from "./basemapLibrary.js";
import { unzipBundle, zipBundle } from "./bundleZip.js";

// UTF-8-safe base64 <-> string (the scenario bundle base64-encodes the
// background.json file bytes; plain atob/btoa mangle non-Latin1 vector data).
const utf8ToBase64 = (str) => btoa(unescape(encodeURIComponent(str)));
const base64ToUtf8 = (b64) => decodeURIComponent(escape(atob(b64)));

const HUB_OWNER = "Open-Historia";
const HUB_REPO = "Open-historia-scenarios";
const HUB_URL = `https://github.com/${HUB_OWNER}/${HUB_REPO}`;
const HUB_API_BASEMAPS = `https://api.github.com/repos/${HUB_OWNER}/${HUB_REPO}/issues?state=open&labels=basemap&per_page=100`;
// Scenario posts are scanned too: one shipped as a .zip carries a custom basemap,
// which we surface in the basemap browser so a basemap shared via a scenario is
// usable on its own without a second upload.
const HUB_API_SCENARIOS = `https://api.github.com/repos/${HUB_OWNER}/${HUB_REPO}/issues?state=open&labels=scenario&per_page=100`;
const SCENARIO_ZIP_PATTERN =
  /https:\/\/github\.com\/(?:[^\s)<>"']+\/releases\/download\/[^\s)<>"']+\.zip|user-attachments\/files\/[^\s)<>"']+\.zip)/i;
const CACHE_TTL_MS = 5 * 60 * 1000;

// A non-image data file linked in an issue body: an old .basemap.json bundle or a
// new vector's .geojson attachment. Inline images (the new image payload/cover)
// are NOT matched here — they live in coverImageUrl instead.
const BUNDLE_LINK_PATTERN =
  /https:\/\/(?:github\.com\/[^\s)<>"']+\/releases\/download\/[^\s)<>"']+\.(?:json|geojson|zip)|github\.com\/[^\s)<>"']+\/files\/[^\s)<>"']+|github\.com\/user-attachments\/files\/[^\s)<>"']+|raw\.githubusercontent\.com\/[^\s)<>"']+\.(?:json|geojson))/i;
const COVER_IMAGE_PATTERN = /!\[[^\]]*\]\((https:\/\/[^\s)]+)\)|<img[^>]+src=["']([^"']+)["']/i;
const HASH_PATTERN = /Basemap-Hash:\s*([a-f0-9]{16,64})/i;
const KIND_PATTERN = /Basemap-Kind:\s*(image|vector)/i;
const OFFICIAL_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

let cache = { at: 0, posts: null };

// ---- data URL <-> bytes ---------------------------------------------------
const MIME_TO_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };
const EXT_TO_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };
const mimeToExt = (mime) => MIME_TO_EXT[String(mime || "").toLowerCase()] || "png";
const extToMime = (ext) => EXT_TO_MIME[String(ext || "").toLowerCase()] || "image/png";
// A URL/name whose extension is an image. Most render inline, but some (notably
// SVG) GitHub attaches as a file with a bundle-style URL — those must still be
// fetched as an image, not parsed as JSON.
const IMAGE_EXT_PATTERN = /\.(?:png|jpe?g|webp|gif|svg)(?:[?#]|$)/i;

const dataUrlParts = (dataUrl) => {
  const [head = "", b64 = ""] = String(dataUrl).split(",");
  return { mime: head.match(/data:([^;]+)/)?.[1] || "image/png", b64 };
};

const base64ToBytes = (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const bytesToBase64 = (bytes) => {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
};

const dataUrlToBytes = (dataUrl) => {
  const { mime, b64 } = dataUrlParts(dataUrl);
  return { bytes: base64ToBytes(b64), mime };
};

const bytesToDataUrl = (bytes, mime) => `data:${mime || "image/png"};base64,${bytesToBase64(bytes)}`;

// ---- hub fetch through the CORS proxy -------------------------------------
// The proxy passes the upstream content type through, so JSON/geojson come back
// as text and images as bytes; callers pick the accessor they need.
const fetchHubResponse = async (url) => {
  const r = await fetch(`/api/hub/file?url=${encodeURIComponent(url)}`);
  if (!r.ok) {
    const p = await r.json().catch(() => ({}));
    throw new Error(p.error || `Download failed (HTTP ${r.status}).`);
  }
  return r;
};

const fetchHubText = async (url) => (await fetchHubResponse(url)).text();
const fetchHubImage = async (url) => {
  const r = await fetchHubResponse(url);
  const buf = await r.arrayBuffer();
  const ctype = (r.headers.get("content-type") || "").split(";")[0].trim();
  const mime = ctype.startsWith("image/") ? ctype : extToMime(url.split(".").pop());
  return bytesToDataUrl(new Uint8Array(buf), mime);
};

const parseBasemapPost = (issue) => {
  const body = String(issue.body ?? "");
  const coverMatch = body.match(COVER_IMAGE_PATTERN);
  return {
    id: issue.number,
    title: String(issue.title ?? "").replace(/^\[Basemap\]\s*/i, "").trim() || `Basemap #${issue.number}`,
    author: issue.user?.login ?? "unknown",
    avatarUrl: issue.user?.avatar_url ?? null,
    url: issue.html_url,
    createdAt: issue.created_at,
    official: OFFICIAL_ASSOCIATIONS.has(issue.author_association),
    upvotes: issue.reactions?.["+1"] ?? 0,
    // A non-image data file (old .basemap.json bundle, or a new vector .geojson).
    bundleUrl: body.match(BUNDLE_LINK_PATTERN)?.[0] ?? null,
    // The attached image: card cover AND, for new image basemaps, the payload.
    coverImageUrl: coverMatch ? coverMatch[1] ?? coverMatch[2] ?? null : null,
    contentHash: body.match(HASH_PATTERN)?.[1]?.toLowerCase() ?? null,
    kind: body.match(KIND_PATTERN)?.[1]?.toLowerCase() ?? "image",
  };
};

// A scenario post that shipped as a .zip carries a custom image basemap. Surface it
// as a basemap entry so basemaps shared via scenarios show up in the basemap browser
// too — installed by pulling basemap.<ext> out of the scenario zip.
const parseScenarioAsBasemap = (issue) => {
  const body = String(issue.body ?? "");
  const zipUrl = body.match(SCENARIO_ZIP_PATTERN)?.[0] ?? null;
  if (!zipUrl) return null;
  const rawTitle = String(issue.title ?? "").replace(/^\[Scenario\]\s*/i, "").trim();
  return {
    id: `scenario-${issue.number}`,
    title: `${rawTitle || `Scenario #${issue.number}`} (basemap)`,
    author: issue.user?.login ?? "unknown",
    avatarUrl: issue.user?.avatar_url ?? null,
    url: issue.html_url,
    createdAt: issue.created_at,
    official: OFFICIAL_ASSOCIATIONS.has(issue.author_association),
    upvotes: issue.reactions?.["+1"] ?? 0,
    fromScenario: true,
    scenarioZipUrl: zipUrl,
    // Present only if the scenario body carries the basemap hash (lets it dedupe
    // against a dedicated basemap post); harmless when absent.
    contentHash: body.match(HASH_PATTERN)?.[1]?.toLowerCase() ?? null,
    kind: "image",
    coverImageUrl: null,
    bundleUrl: null,
  };
};

// A post is installable if we can find a payload: a scenario zip, a data file, or
// (image kind) the attached image itself. Old JSON-bundle, new image/vector, and
// scenario-carried basemaps all pass.
export const basemapPostInstallable = (post) =>
  Boolean(post?.fromScenario || post?.bundleUrl || (post?.kind === "image" && post?.coverImageUrl));

export const fetchCommunityBasemaps = async ({ force = false } = {}) => {
  if (!force && cache.posts && Date.now() - cache.at < CACHE_TTL_MS) return cache.posts;
  const headers = { Accept: "application/vnd.github+json" };
  // Dedicated basemap posts, plus scenario posts (scanned so their basemaps show up
  // here too). The scenarios call is best-effort — a failure just hides those.
  const [bmRes, scRes] = await Promise.all([
    fetch(HUB_API_BASEMAPS, { headers }),
    fetch(HUB_API_SCENARIOS, { headers }).catch(() => null),
  ]);
  if (!bmRes.ok) {
    throw new Error(
      bmRes.status === 403
        ? "GitHub rate limit reached — try again in a few minutes."
        : `Could not reach the basemap hub (HTTP ${bmRes.status}).`,
    );
  }
  const bmIssues = await bmRes.json();
  const dedicated = (Array.isArray(bmIssues) ? bmIssues : []).filter((i) => !i.pull_request).map(parseBasemapPost);
  let fromScenarios = [];
  if (scRes && scRes.ok) {
    const scIssues = await scRes.json().catch(() => []);
    fromScenarios = (Array.isArray(scIssues) ? scIssues : [])
      .filter((i) => !i.pull_request)
      .map(parseScenarioAsBasemap)
      .filter(Boolean);
  }
  // A basemap that also exists as a dedicated post is shown once (prefer the
  // dedicated post — real cover image, cheaper install). Scenario-carried basemaps
  // without a hash can't be deduped, so they always appear.
  const seen = new Set(dedicated.map((p) => p.contentHash).filter(Boolean));
  const posts = [...dedicated];
  for (const s of fromScenarios) {
    if (s.contentHash && seen.has(s.contentHash)) continue;
    if (s.contentHash) seen.add(s.contentHash);
    posts.push(s);
  }
  cache = { at: Date.now(), posts };
  return posts;
};

// Dedup lookup — reads the issue list only (no downloads), matching the content
// hash embedded in each post body. Returns the post so callers can reference the
// right payload URL (image vs data file).
export const findCommunityBasemapByHash = async (hash) => {
  if (!hash) return null;
  try {
    const posts = await fetchCommunityBasemaps();
    // Only dedicated posts are cheaply referenceable (a stable image/data URL). A
    // scenario-carried basemap lives inside a zip, so don't reference those.
    return posts.find((p) => p.contentHash === String(hash).toLowerCase() && !p.fromScenario && basemapPostInstallable(p)) ?? null;
  } catch {
    return null;
  }
};

// Resolve a post to its payload: { kind, dataUrl } | { kind:"vector", geojson }.
// New image basemaps carry the image inline; new vectors carry a .geojson file;
// old posts carry a { basemap, payload } .basemap.json bundle.
const loadBasemapPayload = async (post) => {
  // A basemap carried inside a scenario .zip: download the zip, pull basemap.<ext>.
  if (post.fromScenario && post.scenarioZipUrl) {
    const r = await fetchHubResponse(post.scenarioZipUrl);
    const zip = await unzipBundle(await r.arrayBuffer());
    const imageName = zip.names().find((n) => /(^|\/)basemap\.(?:png|jpe?g|webp|gif|svg)$/i.test(n));
    if (imageName) {
      const dataUrl = bytesToDataUrl(await zip.bytes(imageName), extToMime(imageName.split(".").pop()));
      return { meta: {}, kind: "image", payload: { dataUrl } };
    }
    const vectorName = zip.names().find((n) => /(^|\/)basemap\.geojson$/i.test(n));
    if (vectorName) {
      const geojson = JSON.parse(new TextDecoder().decode(await zip.bytes(vectorName)));
      return { meta: {}, kind: "vector", payload: { geojson } };
    }
    throw new Error("That scenario has no basemap inside it.");
  }
  // An image the post links as a file (e.g. an .svg GitHub attaches rather than
  // rendering inline) is the image payload, not a data file.
  const imageFileUrl = post.bundleUrl && IMAGE_EXT_PATTERN.test(post.bundleUrl) ? post.bundleUrl : null;
  // A vector basemap published as a .zip. GitHub's issue attachments reject
  // .geojson outright ("File type .geojson not supported"), so a vector is shared
  // zipped — the same trick scenario bundles already rely on.
  if (post.bundleUrl && !imageFileUrl && /\.zip(\?|#|$)/i.test(post.bundleUrl)) {
    const r = await fetchHubResponse(post.bundleUrl);
    const zip = await unzipBundle(await r.arrayBuffer());
    const vectorName = zip.names().find((n) => /(^|\/)basemap\.geojson$/i.test(n))
      ?? zip.names().find((n) => /\.geojson$/i.test(n));
    if (vectorName) {
      const geojson = JSON.parse(new TextDecoder().decode(await zip.bytes(vectorName)));
      return { meta: {}, kind: "vector", payload: { geojson } };
    }
    const imageName = zip.names().find((n) => /\.(?:png|jpe?g|webp|gif|svg)$/i.test(n));
    if (imageName) {
      const dataUrl = bytesToDataUrl(await zip.bytes(imageName), extToMime(imageName.split(".").pop()));
      return { meta: {}, kind: "image", payload: { dataUrl } };
    }
    throw new Error("That .zip has no basemap inside it.");
  }
  // Old .basemap.json bundle, or a vector .geojson file (posts made before GitHub
  // started rejecting the extension, or linked from a release rather than attached).
  if (post.bundleUrl && !imageFileUrl) {
    const text = await fetchHubText(post.bundleUrl);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("That basemap file isn't valid JSON.");
    }
    if (parsed && parsed.payload) {
      // Old bundle: { basemap:{…}, payload:{ dataUrl | geojson } }.
      const kind = parsed.basemap?.kind === "vector" ? "vector" : "image";
      return { meta: parsed.basemap ?? {}, kind, payload: parsed.payload ?? {} };
    }
    if (parsed && (parsed.type === "FeatureCollection" || Array.isArray(parsed.features))) {
      return { meta: {}, kind: "vector", payload: { geojson: parsed } };
    }
    throw new Error("That basemap file is missing its data.");
  }
  // New image basemap: the attached cover image (or an image file link) is the payload.
  const imageUrl = post.coverImageUrl || imageFileUrl;
  if (post.kind !== "vector" && imageUrl) {
    const dataUrl = await fetchHubImage(imageUrl);
    return { meta: {}, kind: "image", payload: { dataUrl } };
  }
  throw new Error("This basemap post has no file attached.");
};

// Install a community basemap into the local "Your basemaps" library.
export const installCommunityBasemap = async (post) => {
  const { meta, kind, payload } = await loadBasemapPayload(post);
  if ((kind === "image" && !payload.dataUrl) || (kind === "vector" && !payload.geojson)) {
    throw new Error("That basemap is missing its payload.");
  }
  const thumbnail =
    kind === "image" ? await makeImageThumbnail(payload.dataUrl).catch(() => null) : null;
  return createBasemap({
    name: meta.name || post.title,
    kind,
    aspect: meta.aspect || null,
    thumbnail: thumbnail || meta.thumbnail || null,
    contentHash: meta.contentHash || post.contentHash || null,
    author: meta.author || post.author,
    source: { community: true, hash: meta.contentHash || post.contentHash || null, url: post.url },
    payload,
  });
};

const downloadFile = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const safeName = (name) =>
  (name || "basemap").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "basemap";

// Publish: hand the author the real basemap file and open the prefilled issue form
// to drag it into. The image doubles as the card cover, so there's no separate
// preview file and no base64 bloat.
//
// A VECTOR is handed over ZIPPED, not as a bare .geojson. GitHub's issue attachments
// only accept a fixed set of extensions, and .geojson is not one of them — dragging
// it in fails with "File type .geojson not supported", so the publish flow could
// never actually complete for a vector basemap. .zip IS accepted, which is why
// sharing a vector inside a scenario bundle always worked. Async now, because
// zipping is.
export const publishBasemap = async (meta, payload) => {
  const kind = meta.kind === "vector" ? "vector" : "image";
  const safe = safeName(meta.name);
  let dropWhat;
  if (kind === "image") {
    if (!payload?.dataUrl) throw new Error("This basemap has no image to publish.");
    const { bytes, mime } = dataUrlToBytes(payload.dataUrl);
    dropWhat = `${safe}.${mimeToExt(mime)}`;
    downloadFile(new Blob([bytes], { type: mime }), dropWhat);
  } else {
    if (!payload?.geojson) throw new Error("This vector basemap has no geometry to publish.");
    // basemap.geojson inside: the same name loadBasemapPayload looks for in a
    // scenario zip, so both paths read identically.
    const zip = await zipBundle({ "basemap.geojson": JSON.stringify(payload.geojson) });
    dropWhat = `${safe}.zip`;
    downloadFile(zip, dropWhat);
  }
  const technical = `Basemap-Hash: ${meta.contentHash || ""}\nBasemap-Kind: ${kind}`;
  const query = [
    "template=basemap.yml",
    `title=${encodeURIComponent(`[Basemap] ${meta.name || "Untitled basemap"}`)}`,
    `name=${encodeURIComponent(meta.name || "")}`,
    `author=${encodeURIComponent(meta.author || "")}`,
    `technical=${encodeURIComponent(technical)}`,
  ].join("&");
  window.open(`${HUB_URL}/issues/new?${query}`, "_blank", "noopener");
  return { fileName: dropWhat };
};

// ---- Scenario-bundle background dedup ------------------------------------
// A scenario's custom background embeds the full image/vector in its bundle. If
// that same basemap is already a community basemap, the bundle can reference it
// (by hash) instead of re-embedding it, saving space — resolved back on import.

// Decode the bundle's embedded backgroundData into { kind, payload, hash }.
const readBundleBackground = async (bundle) => {
  const asset = bundle?.assets?.backgroundData;
  if (!asset || asset.mode !== "embedded" || !asset.data) return null;
  let payload;
  try {
    payload = JSON.parse(base64ToUtf8(asset.data));
  } catch {
    return null;
  }
  const kind = bundle?.data?.world?.background?.kind === "vector" ? "vector" : "image";
  const canonical = kind === "vector" ? (payload.geojson ? JSON.stringify(payload.geojson) : null) : payload.dataUrl;
  if (!canonical) return null;
  return { kind, payload, hash: await sha256Hex(canonical) };
};

// If the scenario's background is already a community basemap, swap the embedded
// copy for a reference. Returns { referenced, needsPublish } (needsPublish = the
// background is custom but not yet shared, so it can't be deduped).
export const dedupeScenarioBundleBackground = async (bundle) => {
  let bg = null;
  try {
    bg = await readBundleBackground(bundle);
  } catch {
    bg = null;
  }
  if (!bg) return { referenced: false, needsPublish: false };
  const match = await findCommunityBasemapByHash(bg.hash);
  if (match) {
    // A data file (old .basemap.json bundle, or a vector .geojson) is fetched and
    // parsed as JSON on import; an image link (incl. an .svg attached as a file) or
    // an inline image is fetched as the raw image.
    const viaDataFile = Boolean(match.bundleUrl) && !IMAGE_EXT_PATTERN.test(match.bundleUrl);
    const url = viaDataFile ? match.bundleUrl : match.coverImageUrl || match.bundleUrl;
    if (url) {
      bundle.assets.backgroundData = {
        mode: "communityRef",
        hash: bg.hash,
        via: viaDataFile ? "dataFile" : "image",
        url,
        fileName: "background.json",
      };
      return { referenced: true, needsPublish: false };
    }
  }
  return { referenced: false, needsPublish: true };
};

// On import: turn a community reference back into an embedded background by
// fetching the referenced basemap, so the server import writes it normally.
export const resolveScenarioBundleBackground = async (bundle) => {
  const asset = bundle?.assets?.backgroundData;
  if (!asset || asset.mode !== "communityRef" || !asset.url) return bundle;
  try {
    let payload = null;
    // Drive the fetch by how it was referenced, not by kind: an old .basemap.json
    // bundle has kind "image" yet must be parsed as JSON, not fetched as an image.
    const viaImage = asset.via ? asset.via === "image" : asset.kind === "image";
    if (viaImage) {
      payload = { dataUrl: await fetchHubImage(asset.url) };
    } else {
      // A referenced data file: old .basemap.json bundle or a raw .geojson.
      const text = await fetchHubText(asset.url);
      const parsed = JSON.parse(text);
      if (parsed?.payload) payload = parsed.payload;
      else if (parsed?.type === "FeatureCollection" || Array.isArray(parsed?.features)) payload = { geojson: parsed };
    }
    if (payload && (payload.dataUrl || payload.geojson)) {
      bundle.assets.backgroundData = {
        mode: "embedded",
        data: utf8ToBase64(JSON.stringify(payload)),
        fileName: "background.json",
        contentType: "application/json",
      };
    } else {
      delete bundle.assets.backgroundData;
    }
  } catch {
    // Couldn't resolve the reference — import without the background rather than
    // failing the whole scenario import.
    delete bundle.assets.backgroundData;
  }
  return bundle;
};

// ---- Scenario zip bundle (image travels as a real file, not base64) -------
// Split a scenario bundle's embedded background out into raw bytes so the scenario
// can ship as a .zip (scenario.json + the basemap file + a preview) instead of one
// base64 blob. Handles both an image basemap (→ basemap.png/jpg…) and a generated
// VECTOR basemap (→ basemap.geojson, with a rendered preview). Returns null when
// there's nothing to split (no background, or an already-referenced one).
export const splitScenarioBundleImage = async (bundle) => {
  const bg = await readBundleBackground(bundle).catch(() => null);
  if (!bg) return null;
  if (bg.kind === "image" && bg.payload?.dataUrl) {
    const { bytes, mime } = dataUrlToBytes(bg.payload.dataUrl);
    const ext = mimeToExt(mime);
    const preview = await makeImageThumbnail(bg.payload.dataUrl, 320).catch(() => null);
    return {
      kind: "image",
      imageBytes: bytes,
      imageName: `basemap.${ext}`,
      imageMime: mime,
      previewBytes: preview ? dataUrlToBytes(preview).bytes : null,
      previewName: "preview.jpg",
      hash: bg.hash,
    };
  }
  if (bg.kind === "vector" && bg.payload?.geojson) {
    const bytes = new TextEncoder().encode(JSON.stringify(bg.payload.geojson));
    const preview = makeVectorThumbnail(bg.payload.geojson, 320);
    return {
      kind: "vector",
      imageBytes: bytes,
      imageName: "basemap.geojson",
      imageMime: "application/geo+json",
      previewBytes: preview ? dataUrlToBytes(preview).bytes : null,
      previewName: "preview.jpg",
      hash: bg.hash,
    };
  }
  return null;
};

// Re-embed a zip's basemap image back into the scenario bundle before import, so
// the server sees a normal embedded-background bundle. `imageName` is the zip
// entry name (e.g. "basemap.png") — its extension gives the mime.
export const embedScenarioBundleImage = (bundle, imageBytes, imageName) => {
  if (!bundle?.assets) return bundle;
  const mime = extToMime(String(imageName || "").split(".").pop());
  const dataUrl = bytesToDataUrl(imageBytes, mime);
  bundle.assets.backgroundData = {
    mode: "embedded",
    data: utf8ToBase64(JSON.stringify({ dataUrl })),
    fileName: "background.json",
    contentType: "application/json",
  };
  return bundle;
};

// Re-embed a zip's basemap GEOJSON back into the scenario bundle before import, so
// the server sees a normal embedded (vector) background bundle. Pairs with a
// scenario whose world.background.kind is already "vector".
export const embedScenarioBundleVector = (bundle, geojsonBytes) => {
  if (!bundle?.assets) return bundle;
  let geojson;
  try {
    geojson = JSON.parse(new TextDecoder().decode(geojsonBytes));
  } catch {
    return bundle;
  }
  bundle.assets.backgroundData = {
    mode: "embedded",
    data: utf8ToBase64(JSON.stringify({ geojson })),
    fileName: "background.json",
    contentType: "application/json",
  };
  return bundle;
};
