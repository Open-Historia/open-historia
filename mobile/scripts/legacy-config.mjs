/*! Open Historia — the handover build's WebView address © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The handover build (mobile/android/app/build.gradle, OH_ANDROID_LEGACY_APP_ID)
// is the app's code under the id it had until November 2026, and its page has
// to open at the address it had then too: the WebView keeps a page's saves by
// its address, so the games the handover is there to move are only readable
// from the old one.
//
// `npx cap sync android` copies capacitor.config.json into the Android project
// (android/app/src/main/assets/capacitor.config.json, which git ignores). Run
// after it, this rewrites that copy's appId and server.hostname from
// OH_ANDROID_LEGACY_APP_ID and OH_ANDROID_LEGACY_HOST; CI reads both from
// repository variables, so neither is in the repository. With neither set it
// writes the app's own config back, for the build that follows.
//
//   OH_ANDROID_LEGACY_APP_ID=… OH_ANDROID_LEGACY_HOST=… node scripts/legacy-config.mjs
//   node scripts/legacy-config.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(MOBILE, "capacitor.config.json");
const TARGET = path.join(MOBILE, "android", "app", "src", "main", "assets", "capacitor.config.json");

const APP_ID = /^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// The config the handover build opens with, or the app's own when both are empty.
export const legacyConfig = (config, { appId = "", host = "" } = {}) => {
  const id = String(appId ?? "").trim();
  const name = String(host ?? "").trim().toLowerCase();
  if (!id && !name) return config;
  if (!id || !name) throw new Error("OH_ANDROID_LEGACY_APP_ID and OH_ANDROID_LEGACY_HOST go together.");
  if (!APP_ID.test(id)) throw new Error(`OH_ANDROID_LEGACY_APP_ID is not an application id: ${id}`);
  if (!HOST.test(name)) throw new Error(`OH_ANDROID_LEGACY_HOST is not a host name: ${name}`);
  if (id === config.appId || name === config.server?.hostname) throw new Error("The handover build needs the earlier id and address, not the app's own.");
  return { ...config, appId: id, server: { ...config.server, hostname: name } };
};

const main = () => {
  if (!fs.existsSync(path.dirname(TARGET))) {
    throw new Error(`${path.relative(MOBILE, TARGET)} has no folder: run npx cap sync android first.`);
  }
  const config = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const out = legacyConfig(config, { appId: process.env.OH_ANDROID_LEGACY_APP_ID, host: process.env.OH_ANDROID_LEGACY_HOST });
  fs.writeFileSync(TARGET, `${JSON.stringify(out, null, "\t")}\n`);
  console.log(out === config ? "The app's own WebView address is back in the Android project." : "The Android project opens the handover build's WebView address.");
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
