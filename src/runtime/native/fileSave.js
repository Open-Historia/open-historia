/*! Open Historia — saving a file from inside the Android app © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A browser saves a Blob with an <a download>; a WebView has no downloads of its
// own, which is why every export used to be hidden in the app. This is the app's
// download: the file goes into the phone's Downloads folder, in an
// "Open Historia" folder of its own, where the Files app and the import picker
// both find it, and a notice says so with a Share button beside it.
//
// It used to go straight to the share sheet instead, and a share sheet is not a
// download: on many phones nothing in it saves to the device at all, so an
// export could only be sent somewhere, never kept. The sheet is now the
// fallback, for an Android that will not let the app write to Downloads
// (Android 10 and older without the storage permission).
//
// Android 11 and newer need no permission to create files in Downloads; the
// Filesystem plugin runs the media scanner after writing, so the file shows up
// at once. Base64 across the bridge is the plugin's own contract, and fine up to
// the 32 MB an embedded scenario is allowed to be (gameZip.js
// MAX_EMBEDDED_SCENARIO_BYTES).
import { nativePlugin } from "./bridge.js";
import { showSavedNotice } from "./savedNotice.js";

export const DOWNLOADS_FOLDER = "Download/Open Historia";

const safeFileName = (name) => String(name || "export").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error || new Error("Could not read the file."));
  reader.onload = () => {
    const url = String(reader.result || "");
    const comma = url.indexOf(",");
    resolve(comma >= 0 ? url.slice(comma + 1) : url);
  };
  reader.readAsDataURL(blob);
});

// A name nothing in the folder has yet, the way a browser names downloads:
// "x.zip", then "x (1).zip", "x (2).zip". Exports are named after the game or
// scenario id, so the second export of the same game would otherwise overwrite
// the first — and a file an earlier install of the app left there cannot be
// overwritten at all (Android gives it to that install).
export const freeFileName = async (name, exists) => {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let copy = 0; copy < 100; copy += 1) {
    const candidate = copy === 0 ? name : `${stem} (${copy})${extension}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${stem} (${Date.now()})${extension}`;
};

const shareFile = async (Share, uri, name) => {
  try {
    await Share.share({ title: name, url: uri, dialogTitle: `Save or send ${name}` });
  } catch (error) {
    // "Share canceled" is the player closing the sheet; the file is written.
    if (!/cancel/i.test(String(error?.message || error))) throw error;
  }
};

const saveToDownloads = async (Filesystem, data, name) => {
  const exists = async (candidate) => {
    try {
      await Filesystem.stat({ path: `${DOWNLOADS_FOLDER}/${candidate}`, directory: "EXTERNAL_STORAGE" });
      return true;
    } catch {
      return false;
    }
  };
  const fileName = await freeFileName(name, exists);
  const { uri } = await Filesystem.writeFile({
    path: `${DOWNLOADS_FOLDER}/${fileName}`,
    data,
    directory: "EXTERNAL_STORAGE",
    recursive: true,
  });
  return { uri, fileName };
};

// Resolves to "saved" once the file is in Downloads (and the notice is up), or,
// failing that, once it is written to the app's cache and the share sheet has
// been shown (a sheet the player dismisses is still a saved file, in the
// cache). Throws when the plugins are not there.
export const saveBlobFile = async (blob, fileName) => {
  const Filesystem = nativePlugin("Filesystem");
  const Share = nativePlugin("Share");
  if (!Filesystem) throw new Error("The Filesystem plugin is not available in this build.");
  const name = safeFileName(fileName);
  const data = await blobToBase64(blob);

  try {
    const saved = await saveToDownloads(Filesystem, data, name);
    showSavedNotice({
      fileName: saved.fileName,
      onShare: Share ? () => shareFile(Share, saved.uri, saved.fileName).catch(() => {}) : null,
    });
    return "saved";
  } catch (error) {
    console.warn(`[save] ${name} could not go to Downloads (${error?.message || error}); offering the share sheet instead.`);
  }

  const { uri } = await Filesystem.writeFile({
    path: `exports/${name}`,
    data,
    directory: "CACHE",
    recursive: true,
  });
  if (Share) await shareFile(Share, uri, name);
  return "saved";
};
