/*! Open Historia — one way to save a file, on every build © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Eight places used to make their own <a download> — three of them revoking the
// object URL in the same task as the click, which Firefox treats as a cancelled
// download — and every one of them was hidden or broken inside the Android app,
// where a WebView has nowhere to download to. This is the one door: a browser
// gets the anchor with the deferred revoke, the app gets the Filesystem + share
// sheet path (runtime/native/fileSave.js).
//
// Resolves to "saved". Throws when the app build has no native bridge to save
// through, so a caller can fall back (saveDebugLog.js copies to the clipboard).
import { nativeReady } from "./native/bridge.js";

const REVOKE_DELAY_MS = 1000;

const saveWithAnchor = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Deferred, not immediate: Firefox cancels a download whose blob URL is
  // revoked in the same task as the click.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  return "saved";
};

export const saveBlobToDisk = async (blob, fileName) => {
  if (nativeReady()) {
    const { saveBlobFile } = await import("./native/fileSave.js");
    return saveBlobFile(blob, fileName);
  }
  if (typeof document === "undefined") throw new Error("There is nowhere to save a file here.");
  return saveWithAnchor(blob, fileName);
};

// Convenience for the callers that hold text rather than a Blob.
export const saveTextToDisk = (content, fileName, mimeType = "application/json") =>
  saveBlobToDisk(new Blob([content], { type: mimeType }), fileName);
