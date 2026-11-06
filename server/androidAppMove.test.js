/*! Open Historia — the Android app's move to its new id: consistency tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/androidAppMove.test.js
//
// The app's id and WebView address changed in November 2026. The phones that
// have the app under its earlier id get one last build of it, the handover,
// which installs the app beside itself and hands it every game and setting
// (docs/mobile.md, "Moving to the new app id"). The pieces live in places that
// nothing at runtime checks against each other:
//
//   mobile/android/app/build.gradle         the handover's id comes from the
//                                           environment, its target is the app
//   mobile/scripts/legacy-config.mjs        its WebView address, from the same
//   mobile/android/app/src/main/AndroidManifest.xml   the receiving activity
//   SaveMovePlugin.java / SaveMoveActivity.java       the hand-over and its check
//   .github/workflows/android-apk*.yml      what each release publishes, and the
//                                           feed each app reads
//   src/runtime/web/router.js               which feed is read
//   src/runtime/web/index.js                the merge comes before the library
//
// The earlier id and address are in none of these: CI has them as repository
// variables. Only the app's own id is named.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { legacyConfig } from "../mobile/scripts/legacy-config.mjs";

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const JAVA = "mobile/android/app/src/main/java/io/github/arkniem/openhistoria";

const config = JSON.parse(read("mobile/capacitor.config.json"));
const gradle = read("mobile/android/app/build.gradle");
const manifest = read("mobile/android/app/src/main/AndroidManifest.xml");
const plugin = read(`${JAVA}/SaveMovePlugin.java`);
const receiver = read(`${JAVA}/SaveMoveActivity.java`);
const activity = read(`${JAVA}/MainActivity.java`);
const stable = read(".github/workflows/android-apk.yml");
const beta = read(".github/workflows/android-apk-beta.yml");
const router = read("src/runtime/web/router.js");
const boot = read("src/runtime/web/index.js");
const appMove = read("src/runtime/native/appMove.js");
const REPO = "https://github.com/Open-Historia/open-historia";

test("the app's id and address are its own, and stay on plain http", () => {
  assert.equal(config.appId, "io.github.arkniem.openhistoria");
  assert.equal(config.server.hostname, "app.openhistoria");
  // A secure scheme would change what the page can do (crypto.subtle, Cache
  // Storage): sha256.js, aesGcm.js and modelStore.js are written for http.
  assert.equal(config.server.androidScheme, "http");
  const strings = read("mobile/android/app/src/main/res/values/strings.xml");
  assert.ok(strings.includes(`<string name="package_name">${config.appId}</string>`));
  assert.ok(strings.includes(`<string name="custom_url_scheme">${config.appId}</string>`));
});

test("the handover build takes its id from the environment and moves to the app", () => {
  assert.match(gradle, /def ohLegacyAppId = \(System\.getenv\("OH_ANDROID_LEGACY_APP_ID"\) \?: ""\)\.trim\(\)/);
  assert.match(gradle, /def ohMoveTo = ohLegacyAppId \? ohAppId \+ ohSuffix : ""/);
  assert.match(gradle, /buildConfigField "String", "OH_MOVE_TO", "\\"" \+ ohMoveTo \+ "\\""/);
  assert.match(gradle, /buildConfig true/);
  assert.match(gradle, /ohMoveTo: ohMoveTo \?: ohAppId \+ ohSuffix/);
  assert.match(gradle, /throw new GradleException\("OH_ANDROID_LEGACY_APP_ID is the app's own id"\)/);
  // The handover build is the app's code: one namespace, one receiver class.
  assert.match(gradle, /namespace "io\.github\.arkniem\.openhistoria"/);
  assert.match(plugin, /RECEIVER = "io\.github\.arkniem\.openhistoria\.SaveMoveActivity"/);
});

test("the handover build's address is written into the Android project, never into the repository", () => {
  const app = { appId: "io.github.arkniem.openhistoria", server: { androidScheme: "http", hostname: "app.openhistoria", cleartext: true }, plugins: { x: 1 } };
  assert.equal(legacyConfig(app, {}), app, "without the variables: the app's own config");
  const legacy = legacyConfig(app, { appId: "org.example.earlier", host: "app.earlier" });
  assert.deepEqual(legacy, { appId: "org.example.earlier", server: { androidScheme: "http", hostname: "app.earlier", cleartext: true }, plugins: { x: 1 } });
  assert.throws(() => legacyConfig(app, { appId: "org.example.earlier" }), /go together/);
  assert.throws(() => legacyConfig(app, { appId: "not an id", host: "app.earlier" }), /not an application id/);
  assert.throws(() => legacyConfig(app, { appId: "org.example.earlier", host: "https://x" }), /not a host name/);
  assert.throws(() => legacyConfig(app, { appId: app.appId, host: "app.earlier" }), /earlier id/);
  assert.match(read("mobile/android/.gitignore"), /^app\/src\/main\/assets\/capacitor\.config\.json$/m);
});

test("the app takes the games only from an app signed with its own key", () => {
  assert.match(manifest, /android:name="\.SaveMoveActivity"\s+android:exported="true"/);
  assert.match(manifest, /<queries>\s*<package android:name="\$\{ohMoveTo\}" \/>\s*<\/queries>/);
  assert.match(receiver, /getCallingPackage\(\)/);
  assert.match(receiver, /checkSignatures\(caller, getPackageName\(\)\) != PackageManager\.SIGNATURE_MATCH/);
  assert.match(receiver, /resolveContentProvider\(uri\.getAuthority\(\), 0\)/);
  assert.match(receiver, /caller\.equals\(provider\.packageName\)/);
  assert.match(receiver, /return "this is the handover build"/);
  // And the handover build hands them only to an app signed with its key.
  assert.match(plugin, /checkSignatures\(getContext\(\)\.getPackageName\(\), target\) == PackageManager\.SIGNATURE_MATCH/);
  assert.match(plugin, /FLAG_GRANT_READ_URI_PERMISSION/);
  assert.match(plugin, /startActivityForResult\(call, intent, "sent"\)/);
  // The file is written as it is packed and read where it lies: the page never
  // holds the whole library (appMove.js).
  assert.match(plugin, /String head = call\.getString\("head", ""\)/);
  assert.match(plugin, /public void read\(PluginCall call\)/);
  assert.match(plugin, /new RandomAccessFile\(incoming, "r"\)/);
  assert.match(appMove, /nativeFileSource\(bridge, about\.incoming\)/);
  assert.match(activity, /registerPlugin\(SaveMovePlugin\.class\)/);
  assert.match(activity, /oh:saves-arrived/);
  assert.match(appMove, /addEventListener\("oh:saves-arrived"/);
});

test("the games are merged before the library is seeded or read", () => {
  assert.ok(boot.indexOf("takeMovedSaves({ db: idb, info: moveInfo })") > 0);
  assert.ok(boot.indexOf("takeMovedSaves({ db: idb, info: moveInfo })") < boot.indexOf("await ensureSeeded()"));
  assert.ok(boot.indexOf("takeMovedSaves(") < boot.indexOf("installWebApiRouter()"));
  // appMove.js asks the store layout pass to run again (libraryStore.js).
  assert.match(read("src/runtime/web/libraryStore.js"), /const STORE_LAYOUT_KEY = "store-layout";/);
  assert.match(appMove, /kvPut\("store-layout", 0\)/);
});

test("the app reads update.json; latest.json, the earlier id's feed, offers the handover build", () => {
  assert.ok(router.includes(`stable: "${REPO}/releases/download/android/update.json"`));
  assert.ok(router.includes(`beta: "${REPO}/releases/download/android-beta/update.json"`));
  assert.ok(router.includes(`stable: "${REPO}/releases/download/android/latest.json"`));
  assert.ok(router.includes(`beta: "${REPO}/releases/download/android-beta/latest.json"`));
  assert.match(router, /url\.searchParams\.get\("of"\) !== "app" && await isHandoverBuild\(\)/);
  for (const [workflow, release, apk, handover] of [
    [stable, "android", "open-historia.apk", "open-historia-handover.apk"],
    [beta, "android-beta", "open-historia-beta.apk", "open-historia-beta-handover.apk"],
  ]) {
    assert.match(workflow, /LEGACY_APP_ID: \$\{\{ vars\.ANDROID_LEGACY_APP_ID \}\}/);
    assert.match(workflow, /LEGACY_HOST: \$\{\{ vars\.ANDROID_LEGACY_HOST \}\}/);
    assert.match(workflow, /OH_ANDROID_LEGACY_APP_ID="\$LEGACY_APP_ID" OH_ANDROID_LEGACY_HOST="\$LEGACY_HOST" node \.\.\/scripts\/legacy-config\.mjs/);
    assert.match(workflow, /OH_ANDROID_LEGACY_APP_ID="\$LEGACY_APP_ID" \.\/gradlew "\$TASK" --no-daemon/);
    assert.ok(workflow.includes(`cp "$BUILT" ../../${handover}`));
    // The app's feed names the app; the earlier id's feed, only the handover.
    const update = workflow.slice(workflow.indexOf("cat > update.json"), workflow.indexOf("ASSETS="));
    assert.ok(update.includes(`/releases/download/${release}/${apk}"`), `${release} update.json`);
    const latest = workflow.slice(workflow.indexOf("cat > latest.json"));
    assert.ok(latest.includes(`/releases/download/${release}/${handover}"`), `${release} latest.json`);
    assert.ok(workflow.indexOf(`if [ -f ${handover} ]; then`) < workflow.indexOf("cat > latest.json"), "latest.json only with a handover build");
    // Without the variables, a run may not leave latest.json offering the app
    // to the earlier id's phones as an update.
    assert.ok(workflow.includes(`gh release download ${release} --repo "\${{ github.repository }}" -p latest.json`));
    assert.ok(workflow.includes(`grep -q '/${apk}"' feed-now.json`));
  }
});
