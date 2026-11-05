/*! Open Historia — when the vault door is shown: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/vaultDoorDue.test.js
//
// "vault door by default only after a new update, setting to make it always
// when opening game" (the owner, 2026-10-14). The switches' place in Settings
// and App.jsx's use of this are pinned in GameUI/VaultDoor.test.js.

import test from "node:test";
import assert from "node:assert/strict";

import {
  UNKNOWN_BUILD,
  VAULT_DOOR_BUILD_KEY,
  decideVaultDoor,
  readVaultDoorBuild,
  rememberVaultDoorBuild,
  vaultDoorDue,
} from "./vaultDoorDue.js";

const memoryStorage = (initial = {}) => {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    items,
  };
};

const brokenStorage = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
};

test("the door shows once per build: the first opening after an update, not the ones after it", () => {
  const due = (build, lastBuild) => vaultDoorDue({ always: false, build, lastBuild });
  // The same build it last opened for: not again.
  assert.equal(due("desktop-2", "desktop-2"), false);
  // Another build: an update (or a different app's id), so it shows.
  assert.equal(due("desktop-3", "desktop-2"), true);
  assert.equal(due("web-1760000000001", "web-1760000000000"), true);
  // Never shown on this device: a new install, or the first run of this
  // version for everybody, which counts as new.
  assert.equal(due("desktop-2", null), true);
  assert.equal(due("desktop-2", ""), true);
  // A build that cannot be learnt shows it on a first opening only.
  assert.equal(due("", null), true);
  assert.equal(due("", UNKNOWN_BUILD), false);
  assert.equal(due("", "desktop-2"), false);
  // And once a build can be learnt again, it is new beside "unknown".
  assert.equal(due("desktop-2", UNKNOWN_BUILD), true);
});

test("Every time the game opens shows it at every opening", () => {
  for (const build of ["desktop-2", ""]) {
    for (const lastBuild of ["desktop-2", "desktop-1", null]) {
      assert.equal(vaultDoorDue({ always: true, build, lastBuild }), true, `${build} after ${lastBuild}`);
    }
  }
  // The shipped default: not every time.
  assert.equal(vaultDoorDue({ build: "desktop-2", lastBuild: "desktop-2" }), false);
  assert.equal(vaultDoorDue({ build: "desktop-3", lastBuild: "desktop-2" }), true);
});

test("the build the door opened for is kept, and storage that refuses is no opening at all", () => {
  const storage = memoryStorage();
  assert.equal(readVaultDoorBuild(storage), null);
  rememberVaultDoorBuild("android-stable-412", storage);
  assert.equal(storage.items.get(VAULT_DOOR_BUILD_KEY), "android-stable-412");
  assert.equal(readVaultDoorBuild(storage), "android-stable-412");
  // A build that could not be learnt is kept as such, so the next opening is no first one.
  rememberVaultDoorBuild("", storage);
  assert.equal(readVaultDoorBuild(storage), UNKNOWN_BUILD);
  // Storage that throws (a private window, blocked site data): nothing kept,
  // nothing thrown, and the door shows as on a first opening.
  assert.doesNotThrow(() => rememberVaultDoorBuild("desktop-2", brokenStorage));
  assert.equal(readVaultDoorBuild(brokenStorage), null);
  assert.equal(readVaultDoorBuild(null), null);
  // node has no localStorage: the defaults read nothing and keep nothing.
  assert.equal(readVaultDoorBuild(), null);
  assert.doesNotThrow(() => rememberVaultDoorBuild("desktop-2"));
});

test("deciding an opening: the running build against the kept one", async () => {
  const storage = memoryStorage({ [VAULT_DOOR_BUILD_KEY]: "desktop-2" });
  const asked = [];
  const resolveBuild = (build) => async () => {
    asked.push(build);
    return build;
  };
  assert.deepEqual(await decideVaultDoor({ resolveBuild: resolveBuild("desktop-2"), storage }), { show: false, build: "desktop-2" });
  assert.deepEqual(await decideVaultDoor({ resolveBuild: resolveBuild("desktop-3"), storage }), { show: true, build: "desktop-3" });
  // Every time: shown, and still with its build, to keep when it opens.
  assert.deepEqual(await decideVaultDoor({ always: true, resolveBuild: resolveBuild("desktop-2"), storage }), { show: true, build: "desktop-2" });
  // A first opening.
  assert.deepEqual(await decideVaultDoor({ resolveBuild: resolveBuild("desktop-2"), storage: memoryStorage() }), { show: true, build: "desktop-2" });
  assert.deepEqual(asked, ["desktop-2", "desktop-3", "desktop-2", "desktop-2"]);
  // A build that cannot be learnt, even by a lookup that throws: decided all the same.
  const failing = async () => { throw new Error("offline"); };
  assert.deepEqual(await decideVaultDoor({ resolveBuild: failing, storage }), { show: false, build: "" });
  assert.deepEqual(await decideVaultDoor({ resolveBuild: failing, storage: memoryStorage() }), { show: true, build: "" });
});

test("a door that opens is not shown again for the same build, and is for the next one", async () => {
  const storage = memoryStorage();
  const open = async (build, always = false) => {
    const { show, build: shownFor } = await decideVaultDoor({ always, resolveBuild: async () => build, storage });
    // App.jsx keeps the build when the door has opened (doorOpened).
    if (show) rememberVaultDoorBuild(shownFor, storage);
    return show;
  };
  assert.deepEqual([await open("web-1"), await open("web-1"), await open("web-1")], [true, false, false]);
  assert.deepEqual([await open("web-2"), await open("web-2")], [true, false]);
  assert.equal(await open("web-2", true), true);
  // A page closed before the door opened kept nothing: the next opening shows it again.
  const before = readVaultDoorBuild(storage);
  await decideVaultDoor({ resolveBuild: async () => "web-3", storage });
  assert.equal(readVaultDoorBuild(storage), before);
  assert.equal(await open("web-3"), true);
});
