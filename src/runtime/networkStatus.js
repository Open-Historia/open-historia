/*! Open Historia — whether the device has a network at all © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// navigator.onLine, kept current. It is false only when there is no network at
// all — airplane mode, Wi-Fi and data off — which is the case the Android app
// and the desktop have to play through; a network without internet still reads
// as online, and those requests simply fail as they always did. The map uses it
// to draw its bundled relief instead of asking remote tile servers that cannot
// answer, the startup preload to skip warming them, and the AI setup dialog to
// leave out a video that cannot load.
import { useSyncExternalStore } from "react";

export const isBrowserOnline = () => {
  try {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  } catch {
    return true;
  }
};

export const subscribeToNetworkStatus = (listener) => {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
};

// Server rendering (and anything without a navigator) counts as online, so the
// markup never differs from the first client render on a connected device.
export const useBrowserOnline = () =>
  useSyncExternalStore(subscribeToNetworkStatus, isBrowserOnline, () => true);
