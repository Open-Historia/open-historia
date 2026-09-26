/*! Open Historia — Android beta packaging consistency tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/androidBetaPackaging.test.js
//
// The Android beta is a second app, "Open Historia Beta", beside the stable one,
// and it is described in places that have to agree and that nothing at runtime
// checks:
//
//   mobile/android/app/build.gradle        the channel: application id, name, icon
//   mobile/android/app/src/main/AndroidManifest.xml   uses what the channel picks
//   mobile/android/app/src/main/res/mipmap-*          the BETA icons it names
//   .github/workflows/android-apk-beta.yml where the beta is published, and with
//                                          which channel and update track
//   .github/workflows/android-apk.yml      the stable app, which none of this may touch
//   src/runtime/web/router.js              where each track's update banner looks
//
// Every way they can disagree fails on a player's phone, silently: a beta built
// with the stable id installs OVER the stable app and takes its saves; a beta
// that reads the stable feed offers its testers the stable build; a release
// that uploads to `android` replaces the stable APK with the beta.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const exists = (relative) => fs.existsSync(new URL(`../${relative}`, import.meta.url));

const gradle = read("mobile/android/app/build.gradle");
const manifest = read("mobile/android/app/src/main/AndroidManifest.xml");
const betaWorkflow = read(".github/workflows/android-apk-beta.yml");
const stableWorkflow = read(".github/workflows/android-apk.yml");
const router = read("src/runtime/web/router.js");

const STABLE_ID = "io.github.arkniem.paxhistoria";
const BETA_ID = "io.github.arkniem.paxhistoria.beta";
const REPO = "https://github.com/Open-Historia/open-historia";

// `gh release <verb> <tag>` lines in a workflow, as [verb, tag].
const releaseCommands = (workflow) => [...workflow.matchAll(/gh release (create|edit|upload) ([\w.-]+)/g)].map((m) => [m[1], m[2]]);

test("the channel gives the beta its own id, name and icon, and the stable app keeps its own", () => {
  assert.match(gradle, /def ohChannel = System\.getenv\("OH_ANDROID_CHANNEL"\) \?: "stable"/);
  assert.ok(gradle.includes(`applicationId ohBeta ? "${BETA_ID}" : "${STABLE_ID}"`), "applicationId by channel");
  assert.match(gradle, /appLabel: ohBeta \? "Open Historia Beta" : "Open Historia"/);
  assert.match(gradle, /appIcon: ohBeta \? "@mipmap\/ic_launcher_beta" : "@mipmap\/ic_launcher"/);
  assert.match(gradle, /appIconRound: ohBeta \? "@mipmap\/ic_launcher_beta_round" : "@mipmap\/ic_launcher_round"/);
  // An unknown channel stops the build rather than making a stable app by accident.
  assert.match(gradle, /throw new GradleException\("OH_ANDROID_CHANNEL is stable or beta/);
});

test("the manifest takes its name and icons from the channel", () => {
  assert.match(manifest, /android:icon="\$\{appIcon\}"/);
  assert.match(manifest, /android:roundIcon="\$\{appIconRound\}"/);
  const labels = [...manifest.matchAll(/android:label="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(labels.length >= 2, "the application and its activity both carry a label");
  for (const label of labels) assert.equal(label, "${appLabel}", "a fixed label would name both apps alike");
  // Two apps cannot share a provider authority: the second would not install.
  assert.match(manifest, /android:authorities="\$\{applicationId\}\.fileprovider"/);
});

test("every density that has the stable icons has the beta's too", () => {
  const res = "mobile/android/app/src/main/res";
  const densities = fs.readdirSync(new URL(`../${res}`, import.meta.url)).filter((dir) => /^mipmap-(l|m|h|xh|xxh|xxxh)dpi$/.test(dir));
  assert.ok(densities.length >= 5, "the mipmap densities are there");
  for (const dir of densities) {
    for (const [stable, beta] of [["ic_launcher", "ic_launcher_beta"], ["ic_launcher_round", "ic_launcher_beta_round"], ["ic_launcher_foreground", "ic_launcher_beta_foreground"]]) {
      if (!exists(`${res}/${dir}/${stable}.png`)) continue;
      assert.ok(exists(`${res}/${dir}/${beta}.png`), `${dir}/${beta}.png (scripts/make-android-beta-icons.ps1)`);
    }
  }
  for (const name of ["ic_launcher_beta", "ic_launcher_beta_round"]) {
    const adaptive = read(`${res}/mipmap-anydpi-v26/${name}.xml`);
    assert.match(adaptive, /@mipmap\/ic_launcher_beta_foreground/, `${name}.xml draws the beta's layer`);
  }
});

test("the beta workflow builds the beta channel from beta, and publishes only to android-beta", () => {
  assert.match(betaWorkflow, /OH_ANDROID_CHANNEL: beta/);
  assert.match(betaWorkflow, /VITE_APP_TRACK: beta/);
  assert.match(betaWorkflow, /github\.ref_name != 'beta'/, "a dispatch from main would publish the released code as the beta");
  assert.match(betaWorkflow, /tags: \["android-beta-v\*"\]/);
  const commands = releaseCommands(betaWorkflow);
  assert.ok(commands.length >= 3, "create, edit and upload");
  for (const [verb, tag] of commands) assert.equal(tag, "android-beta", `gh release ${verb} ${tag}`);
  assert.match(betaWorkflow, /gh release create android-beta [^\n]*--prerelease/);
  assert.match(betaWorkflow, /gh release upload android-beta open-historia-beta\.apk latest\.json --clobber/);
  assert.ok(betaWorkflow.includes(`"apk": "https://github.com/\${{ github.repository }}/releases/download/android-beta/open-historia-beta.apk"`));
  assert.match(betaWorkflow, /cp app\/build\/outputs\/apk\/release\/app-release\.apk \.\.\/\.\.\/open-historia-beta\.apk/);
});

test("the stable workflow stays the stable app, from main, on the android release", () => {
  assert.match(stableWorkflow, /VITE_APP_TRACK: stable/);
  assert.doesNotMatch(stableWorkflow, /OH_ANDROID_CHANNEL: beta/);
  assert.match(stableWorkflow, /github\.ref_name != 'main'/, "a dispatch from beta would publish the beta's code as the stable app");
  for (const [verb, tag] of releaseCommands(stableWorkflow)) assert.equal(tag, "android", `gh release ${verb} ${tag}`);
  assert.ok(stableWorkflow.includes(`"apk": "https://github.com/\${{ github.repository }}/releases/download/android/open-historia.apk"`));
  // Tag triggers must not overlap: a beta tag starting the stable workflow would
  // publish the beta over the stable app.
  const stableTag = /tags: \["(android-v\*)"\]/.exec(stableWorkflow)?.[1];
  assert.equal(stableTag, "android-v*");
  const glob = (pattern) => new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
  assert.equal(glob(stableTag).test("android-beta-v1"), false);
  assert.equal(glob("android-beta-v*").test("android-v1"), false);
  assert.equal(glob(stableTag).test("android-beta"), false, "the beta's release tag starts no stable run");
});

test("each track's update banner reads its own release", () => {
  assert.ok(router.includes(`stable: "${REPO}/releases/download/android/latest.json"`));
  assert.ok(router.includes(`beta: "${REPO}/releases/download/android-beta/latest.json"`));
});
