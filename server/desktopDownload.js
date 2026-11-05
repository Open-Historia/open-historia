/*! Open Historia — which installer the update banner offers this computer © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The release workflows write one download per system into latest.json, and for
// macOS that is the Apple Silicon zip. An Intel Mac given it cannot open the app
// at all ("not supported on this type of Mac"), so an Intel Mac is offered the
// zip built for it, which every release publishes beside the other under the
// same name with -x64 in place of -arm64.

const SYSTEM_KEYS = { win32: "windows", darwin: "mac", linux: "linux" };

export const desktopDownloadFor = (manifest, { platform = process.platform, arch = process.arch } = {}) => {
  const value = manifest ? manifest[SYSTEM_KEYS[platform]] : "";
  const url = typeof value === "string" ? value : "";
  if (platform === "darwin" && arch === "x64") return url.replace(/-arm64\.zip$/, "-x64.zip");
  return url;
};
