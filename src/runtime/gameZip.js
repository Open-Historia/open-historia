/*! Open Historia — export and import a Game as one zip © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One Game as a single .zip: what goes in it, and how to read one back.
//
// Assembled in the CLIENT, not on the server, so the web build — which has no
// server at all, only a fetch interceptor over IndexedDB — produces the same
// file from the same code, and a game exported in a browser opens on a desktop
// install. Used by the Games tab (Export / Import game) and by Settings →
// Diagnostics (Attach game).
//
import { exportGameBundle, exportScenarioBundle, readGameSnapshotsText } from "./library.js";
import { buildSettingsReport } from "./debugLog.js";
import { zipBundle, unzipBundle } from "./bundleZip.js";
import { restoreBundleFiles, splitBundleFiles } from "./bundleFiles.js";
import { saveBlobToDisk } from "./saveFile.js";
import {
  splitScenarioBundleImage,
  embedScenarioBundleImage,
  embedScenarioBundleVector,
} from "./communityBasemaps.js";

export const GAME_ZIP_BUNDLE = "game.json";
const GAME_ZIP_SNAPSHOTS = "snapshots.json";
const GAME_ZIP_SETTINGS = "settings.txt";
const GAME_ZIP_SCENARIO = "scenario.json";

// Every file the game saves goes through runtime/saveFile.js: the anchor with the
// deferred revoke in a browser (Firefox cancels a download whose object URL is
// revoked in the same task as the click), the Filesystem + share sheet in the
// Android app. Kept as a named export because the game-bundle parity test holds
// every zip save to this one door.
export const saveGameZipToDisk = (blob, fileName) => saveBlobToDisk(blob, fileName);

export const formatZipSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// How big a scenario may be and still ride inside a game. The zip is built in the
// page: the bundle is fetched, parsed into objects, stringified again and then
// DEFLATEd, so peak memory is several times its size. Measured on real maps — an
// editor-made map bundles to 8.75 MB and zips without trouble; a hub map carrying
// its own tiles bundles to 297 MB, because a bundle embeds every asset as base64,
// and building that in a tab kills it outright. So there IS a ceiling, whatever we
// would prefer: above this the map does not travel and the player is told to send
// the scenario separately rather than handed a browser crash.
const MAX_EMBEDDED_SCENARIO_BYTES = 32 * 1024 * 1024;

// An exported Game carries its map only when we do NOT know where that map can
// be fetched from. A built-in scenario is on every install; a hub scenario whose
// origin survived (hubOrigin is dropped the moment the player edits it) can be
// downloaded again; `missing` means this install has no copy to embed, which is
// the ordinary state of a game imported without its map. Anything else — made in
// the editor, or a hub map since edited — has no other home, so it travels, if it
// is small enough to travel at all.
const gameZipNeedsScenario = (scenarioRef) =>
  Boolean(scenarioRef) && !scenarioRef.builtIn && !scenarioRef.hubOrigin && !scenarioRef.missing;

const scenarioFitsInZip = (scenarioRef) =>
  !(Number(scenarioRef?.scenarioBytes) > MAX_EMBEDDED_SCENARIO_BYTES);

// `confirmCarryingScenario` is asked BEFORE the scenario is fetched, because the
// fetch, the parse and the DEFLATE are the whole cost — a player who says no to a
// big file should not have paid for it first. It is handed the map's name and what
// it weighs as a bundle, both of which the game bundle already knows. Returning
// false aborts and this resolves to null.
export const buildGameZipBlob = async (gameId, { confirmCarryingScenario } = {}) => {
  const bundle = await exportGameBundle(gameId);
  const scenarioRef = bundle.scenarioRef ?? {};
  const files = {};

  // Restore points are their own entry and move as TEXT. A full snapshots file
  // is ~21 MB and JSON.parse on it costs ~80 MB of heap; nothing on this side
  // ever looks inside it, and the browser is where that would hurt.
  const snapshotsText = await readGameSnapshotsText(gameId).catch(() => "");
  const settingsText = await buildSettingsReport().catch(() => "");

  let carriesScenario = false;
  let oversizeScenario = null;
  if (gameZipNeedsScenario(scenarioRef) && !scenarioFitsInZip(scenarioRef)) {
    // Deliberately before the fetch: downloading a 297 MB bundle to discover it is
    // too big is the crash we are avoiding.
    oversizeScenario = {
      bytes: Number(scenarioRef.scenarioBytes) || 0,
      name: scenarioRef.scenarioName || scenarioRef.scenarioId,
    };
  } else if (gameZipNeedsScenario(scenarioRef)) {
    if (confirmCarryingScenario) {
      const carryOn = await confirmCarryingScenario({
        bytes: Number(scenarioRef.scenarioBytes) || 0,
        name: scenarioRef.scenarioName || scenarioRef.scenarioId,
      });
      if (!carryOn) return null;
    }
    const scenarioBundle = await exportScenarioBundle(scenarioRef.scenarioId);
    // The same split the scenario export does: a custom basemap rides as real
    // bytes rather than a base64 data URL ~33% larger.
    const split = await splitScenarioBundleImage(scenarioBundle).catch(() => null);
    if (split) {
      delete scenarioBundle.assets.backgroundData;
      files[split.imageName] = split.imageBytes;
      if (split.previewBytes) files[split.previewName] = split.previewBytes;
    }
    // And the same lift: the map's geometry and any tile archive become real
    // entries, so what rides inside the game is a compressed map rather than one
    // enormous JSON string (bundleFiles.js).
    const lifted = splitBundleFiles(scenarioBundle);
    Object.assign(files, lifted.files);
    files[GAME_ZIP_SCENARIO] = JSON.stringify(lifted.bundle);
    carriesScenario = true;
  }

  bundle.scenarioRef = { ...scenarioRef, embedded: carriesScenario };
  files[GAME_ZIP_BUNDLE] = JSON.stringify(bundle);
  if (snapshotsText && snapshotsText.trim() && snapshotsText.trim() !== "[]") {
    files[GAME_ZIP_SNAPSHOTS] = snapshotsText;
  }
  if (settingsText) files[GAME_ZIP_SETTINGS] = settingsText;

  return { blob: await zipBundle(files), carriesScenario, oversizeScenario };
};

// Resolves to the imported game's details, or throws with something a player can
// act on. The scenario, when one rode along, is imported FIRST: the game's
// scenarioId has to resolve to something the moment the card appears.
export const readGameZip = async (buffer) => {
  const zip = await unzipBundle(buffer);
  const bundleText = await zip.text(GAME_ZIP_BUNDLE);
  if (!bundleText) throw new Error("That .zip is missing game.json — is it a scenario export?");

  const scenarioText = await zip.text(GAME_ZIP_SCENARIO);
  let scenarioBundle = null;
  if (scenarioText) {
    scenarioBundle = await restoreBundleFiles(JSON.parse(scenarioText), zip);
    const imageName = zip.names().find((n) => /(^|\/)basemap\.(png|jpe?g|webp|gif|svg)$/i.test(n));
    if (imageName) {
      embedScenarioBundleImage(scenarioBundle, await zip.bytes(imageName), imageName);
    } else {
      const vectorName = zip.names().find((n) => /(^|\/)basemap\.geojson$/i.test(n));
      if (vectorName) embedScenarioBundleVector(scenarioBundle, await zip.bytes(vectorName));
    }
  }

  return {
    bundle: JSON.parse(bundleText),
    scenarioBundle,
    // Text, not parsed: handed straight back to the store the same way it came.
    snapshotsText: await zip.text(GAME_ZIP_SNAPSHOTS),
  };
};

