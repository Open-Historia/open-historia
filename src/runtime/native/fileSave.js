/*! Open Historia — saving a file from inside the Android app © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A browser saves a Blob with an <a download>; a WebView has no downloads folder
// of its own to put it in, which is why every export used to be hidden in the
// app. This writes the bytes into the app's cache through the Filesystem plugin
// and hands the file to the system share sheet: the player sends it to Discord,
// saves it in Files, or AirDrops it — whatever the phone offers. The manifest
// already declares the FileProvider (res/xml/file_paths.xml) the sheet needs.
//
// Base64 across the bridge is the plugin's own contract, and fine up to the
// 32 MB an embedded scenario is allowed to be (gameZip.js
// MAX_EMBEDDED_SCENARIO_BYTES).
import { nativePlugin } from "./bridge.js";

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

// Resolves to "saved" once the file is written and the share sheet has been
// shown (a sheet the player dismisses is still a saved file, in the cache), or
// throws when the plugins are not there.
export const saveBlobFile = async (blob, fileName) => {
  const Filesystem = nativePlugin("Filesystem");
  const Share = nativePlugin("Share");
  if (!Filesystem) throw new Error("The Filesystem plugin is not available in this build.");
  const name = safeFileName(fileName);
  const { uri } = await Filesystem.writeFile({
    path: `exports/${name}`,
    data: await blobToBase64(blob),
    directory: "CACHE",
    recursive: true,
  });
  if (Share) {
    try {
      await Share.share({ title: name, url: uri, dialogTitle: `Save or send ${name}` });
    } catch (error) {
      // "Share canceled" is the player closing the sheet; the file is written.
      if (!/cancel/i.test(String(error?.message || error))) throw error;
    }
  }
  return "saved";
};
