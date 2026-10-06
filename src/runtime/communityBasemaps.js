/*! Open Historia — community basemaps client © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Browse + install + publish basemaps shared through the community hub. Mirrors
// the scenario hub (src/Game/GameUI/communityHub.jsx): each community basemap is
// a GitHub issue labeled "basemap" (via the basemap.yml issue form) whose body
// carries the raw basemap image as an attachment — GitHub renders that image as
// the card cover for free, and install reads the same image back. A content hash
// in the body lets a scenario reference an existing community basemap instead of
// re-embedding it. Publishing is the token-less flow scenarios use: the app hands
// the author the real image file and opens a prefilled issue form to drag it into.

import { createBasemap, listBasemaps, makeImageThumbnail, makeVectorThumbnail, sha256Hex } from "./basemapLibrary.js";
import { looksLikeZip, unzipBundle, zipBundle } from "./bundleZip.js";
import { bytesToBase64 } from "./bundleFiles.js";
import { fetchHubFile } from "./hubFiles.js";
import { HUB_URL, fetchHubIssues, fetchHubScenarioIssues, firstHubImage } from "./hubIssues.js";
import { saveBlobToDisk } from "./saveFile.js";

// UTF-8-safe base64 <-> string (the scenario bundle base64-encodes the
// background.json file bytes; plain atob/btoa mangle non-Latin1 vector data).
const utf8ToBase64 = (str) => btoa(unescape(encodeURIComponent(str)));
const base64ToUtf8 = (b64) => decodeURIComponent(escape(atob(b64)));

// Basemap posts are the hub's issues labelled "basemap". Scenario posts are
// scanned too: one shipped as a .zip carries a custom basemap, which we surface
// in the basemap browser so a basemap shared via a scenario is usable on its
// own without a second upload. Both lists are hubIssues.js's, cached and shared
// with the other hub screens.
const SCENARIO_ZIP_PATTERN =
  /https:\/\/github\.com\/(?:[^\s)<>"']+\/releases\/download\/[^\s)<>"']+\.zip|user-attachments\/files\/[^\s)<>"']+\.zip)/i;
// A non-image data file linked in an issue body: an old .basemap.json bundle or a
// new vector's .geojson attachment. Inline images (the new image payload/cover)
// are NOT matched here — they live in coverImageUrl instead.
const BUNDLE_LINK_PATTERN =
  /https:\/\/(?:github\.com\/[^\s)<>"']+\/releases\/download\/[^\s)<>"']+\.(?:json|geojson|zip)|github\.com\/[^\s)<>"']+\/files\/[^\s)<>"']+|github\.com\/user-attachments\/files\/[^\s)<>"']+|raw\.githubusercontent\.com\/[^\s)<>"']+\.(?:json|geojson))/i;
const HASH_PATTERN = /Basemap-Hash:\s*([a-f0-9]{16,64})/i;
const KIND_PATTERN = /Basemap-Kind:\s*(image|vector)/i;
const OFFICIAL_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

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

const dataUrlToBytes = (dataUrl) => {
  const { mime, b64 } = dataUrlParts(dataUrl);
  return { bytes: base64ToBytes(b64), mime };
};

const bytesToDataUrl = (bytes, mime) => `data:${mime || "image/png"};base64,${bytesToBase64(bytes)}`;

// ---- hub fetch through the CORS proxy -------------------------------------
// The proxy passes the upstream content type through, so JSON/geojson come back
// as text and images as bytes; callers pick the accessor they need. A post's
// file comes from its copy in the hub's releases when there is one (hubFiles.js).
const fetchHubResponse = async (url) => {
  const r = await fetchHubFile(url);
  if (!r.ok) {
    const p = await r.json().catch(() => ({}));
    throw new Error(p.error || `Download failed (HTTP ${r.status}).`);
  }
  return r;
};

const fetchHubImage = async (url) => {
  const r = await fetchHubResponse(url);
  const buf = await r.arrayBuffer();
  const ctype = (r.headers.get("content-type") || "").split(";")[0].trim();
  const mime = ctype.startsWith("image/") ? ctype : extToMime(url.split(".").pop());
  return bytesToDataUrl(new Uint8Array(buf), mime);
};

const parseBasemapPost = (issue) => {
  const body = String(issue.body ?? "");
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
    // Only an image GitHub hosts (hubIssues.js firstHubImage).
    coverImageUrl: firstHubImage(body),
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
  // Dedicated basemap posts, plus scenario posts (scanned so their basemaps show up
  // here too). The scenarios call is best-effort — a failure just hides those.
  const [bmIssues, scIssues] = await Promise.all([
    fetchHubIssues("basemap", { force }).catch((error) => {
      if (error?.status === undefined) throw error;
      throw new Error(
        error.status === 403
          ? "GitHub rate limit reached — try again in a few minutes."
          : `Could not reach the basemap hub (HTTP ${error.status}).`,
      );
    }),
    fetchHubScenarioIssues({ force }).catch(() => []),
  ]);
  const dedicated = bmIssues.map(parseBasemapPost);
  const fromScenarios = scIssues.map(parseScenarioAsBasemap).filter(Boolean);
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

// A post's data file, read back into { meta, kind, payload }. Shared by install
// and by a scenario's communityRef (resolveScenarioBundleBackground), which
// point at the same file. Told apart by its bytes, not its name:
//   - a .zip: a vector basemap published zipped, because GitHub's issue
//     attachments reject .geojson outright ("File type .geojson not
//     supported") — the same trick scenario bundles already rely on;
//   - an old .basemap.json bundle, or a vector .geojson file (posts made before
//     GitHub started rejecting the extension, or linked from a release).
const readBasemapDataFile = async (url) => {
  const bytes = new Uint8Array(await (await fetchHubResponse(url)).arrayBuffer());
  if (looksLikeZip(bytes)) {
    const zip = await unzipBundle(bytes);
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
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
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
  if (post.bundleUrl && !imageFileUrl) return readBasemapDataFile(post.bundleUrl);
  // New image basemap: the attached cover image (or an image file link) is the payload.
  const imageUrl = post.coverImageUrl || imageFileUrl;
  if (post.kind !== "vector" && imageUrl) {
    const dataUrl = await fetchHubImage(imageUrl);
    return { meta: {}, kind: "image", payload: { dataUrl } };
  }
  throw new Error("This basemap post has no file attached.");
};

// Install a community basemap into the local "Your basemaps" library.
// Which file of a hub post actually carries the basemap, and how it must be read
// back. A data file (an old .basemap.json bundle, or a vector's .geojson) is
// parsed as JSON; anything else — an inline image, or an .svg GitHub attached as
// a file — is fetched as a raw image. Shared by install and by publish-time
// dedupe so a reference written from a local record and one written from a live
// hub search are byte-identical.
const payloadRefVia = (post) =>
  post?.bundleUrl && !IMAGE_EXT_PATTERN.test(post.bundleUrl) ? "dataFile" : "image";
const payloadRefUrl = (post) =>
  (payloadRefVia(post) === "dataFile" ? post?.bundleUrl : post?.coverImageUrl || post?.bundleUrl) || null;

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
    // `url` is the issue permalink (for "view the post"); `payloadUrl` is the file
    // a later publish can point a communityRef at, resolved the same way a hub
    // search hit is. Keeping both means dedupeScenarioBundleBackground never has
    // to guess which one it is holding — an html_url there would resolve to a web
    // page and the scenario would import with no basemap at all.
    source: {
      community: true,
      hash: meta.contentHash || post.contentHash || null,
      url: post.url,
      payloadUrl: payloadRefUrl(post),
      payloadVia: payloadRefVia(post),
    },
    payload,
  });
};

// runtime/saveFile.js: a download in a browser, Downloads/Open Historia in the app.
const downloadFile = (blob, fileName) => saveBlobToDisk(blob, fileName);

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

  // Ask the LOCAL library first. A basemap installed from the Community tab was
  // saved with source.community + the post's url (installCommunityBasemap), so we
  // already know it is on the hub without asking GitHub — which matters because
  // the hub search is the flaky part: offline, rate-limited (403) or simply slow,
  // it returns nothing and the author would re-upload a basemap that is already
  // shared. Falls through to the hub search for a basemap that came from anywhere
  // else (an older install, a scenario import) but happens to match a post.
  // Requires source.payloadUrl, which only installs from this version on record —
  // an older install has just the issue permalink, which is not fetchable as a
  // payload, so it correctly falls through to the hub search below.
  const local = await listBasemaps().catch(() => []);
  const installed = local.find(
    (bm) => bm?.contentHash && bm.contentHash === bg.hash && bm?.source?.community && bm?.source?.payloadUrl,
  );
  if (installed) {
    bundle.assets.backgroundData = {
      mode: "communityRef",
      hash: bg.hash,
      via: installed.source.payloadVia === "dataFile" ? "dataFile" : "image",
      url: installed.source.payloadUrl,
      fileName: "background.json",
    };
    return { referenced: true, needsPublish: false };
  }

  const match = await findCommunityBasemapByHash(bg.hash);
  if (match) {
    const viaDataFile = payloadRefVia(match) === "dataFile";
    const url = payloadRefUrl(match);
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
//
// A reference that cannot be fetched (offline, a 403 or 502, a moved file) is
// KEPT, with the reason beside it, rather than deleted: the import still goes
// ahead, the stores write no background for it, an Update keeps the basemap
// the scenario already had, and the caller can tell the player why
// (unresolvedBundleBackground).
export const resolveScenarioBundleBackground = async (bundle) => {
  const asset = bundle?.assets?.backgroundData;
  if (!asset || asset.mode !== "communityRef" || !asset.url) return bundle;
  try {
    const payload = await fetchReferencedBasemap(asset);
    bundle.assets.backgroundData = {
      mode: "embedded",
      data: utf8ToBase64(JSON.stringify(payload)),
      fileName: "background.json",
      contentType: "application/json",
    };
  } catch (error) {
    // Import without the background rather than failing the whole scenario.
    bundle.assets.backgroundData = { ...asset, missingReason: basemapFailureReason(error) };
  }
  return bundle;
};

// The basemap a community reference points at, as background.json holds it
// ({ dataUrl } for an image, { geojson } for a vector map). Throws, with a
// reason the player can read, when it cannot be had. Import resolves a
// bundle's reference with it, and opening a scenario whose basemap could not
// be downloaded then tries it again (missingBasemap.js).
export const fetchReferencedBasemap = async (asset) => {
  let payload = null;
  // Drive the fetch by how it was referenced, not by kind: an old .basemap.json
  // bundle has kind "image" yet must be parsed as JSON, not fetched as an image.
  const viaImage = asset?.via ? asset.via === "image" : asset?.kind === "image";
  if (viaImage) {
    payload = { dataUrl: await fetchHubImage(asset.url) };
  } else {
    // A referenced data file: old .basemap.json bundle, a raw .geojson, or a
    // vector published as a .zip — read exactly the way install reads it.
    ({ payload } = await readBasemapDataFile(asset.url));
  }
  if (payload && (payload.dataUrl || payload.geojson)) return payload;
  throw new Error("The shared basemap has no image or map in it.");
};

// A failure as a whole sentence, full stop and all, so the messages that
// quote it read it as a sentence of its own and a language pack that has the
// sentence translates it.
export const basemapFailureReason = (error) => {
  const reason = String(error?.message || "").trim() || "The download failed.";
  return /[.!?]$/.test(reason) ? reason : `${reason}.`;
};

// Why a bundle's community basemap is still only a reference after
// resolveScenarioBundleBackground, or null when there is nothing missing: one
// whole sentence, with its full stop.
export const unresolvedBundleBackground = (bundle) => {
  const asset = bundle?.assets?.backgroundData;
  if (asset?.mode !== "communityRef") return null;
  return basemapFailureReason({ message: asset.missingReason || "The shared basemap could not be found." });
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
