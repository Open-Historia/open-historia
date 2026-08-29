/*! Open Historia — Linux AppImage sandbox detection tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Issue #658: the AppImage aborted on launch on an Ubuntu-based KDE distro with
// "The SUID sandbox helper binary was found, but is not configured correctly".
// These pin the decision that fixes it, and — more importantly — pin the cases
// where the sandbox must be LEFT ALONE, since the failure mode of getting this
// wrong is silently unsandboxing people who did not need it.

import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const { needsNoSandbox } = createRequire(import.meta.url)("./linuxSandbox.cjs");

// A fake /proc. Anything not named here reads as absent, which is what most
// kernels actually do.
const proc = (files = {}) => (file) => (file in files ? files[file] : null);

const APPIMAGE = { APPIMAGE: "/home/player/Open-Historia-x86_64.AppImage" };
const HEALTHY = proc({ "/proc/sys/user/max_user_namespaces": "15000" });

test("the reported case: an AppImage where AppArmor restricts user namespaces", () => {
  // Ubuntu 24.04 and its derivatives. Namespaces exist, AppArmor refuses them, and
  // an AppImage cannot fall back to the setuid helper — so there is no sandbox.
  const read = proc({ "/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "1" });
  assert.equal(needsNoSandbox({ platform: "linux", env: APPIMAGE, read }), true);
});

test("an AppImage with user namespaces disabled outright", () => {
  for (const [file, value] of [
    ["/proc/sys/kernel/unprivileged_userns_clone", "0"],
    ["/proc/sys/user/max_user_namespaces", "0"],
  ]) {
    assert.equal(
      needsNoSandbox({ platform: "linux", env: APPIMAGE, read: proc({ [file]: value }) }),
      true,
      `${file}=${value} must count as no sandbox available`,
    );
  }
});

test("an AppImage on a kernel that allows user namespaces keeps its sandbox", () => {
  assert.equal(needsNoSandbox({ platform: "linux", env: APPIMAGE, read: HEALTHY }), false);
  // AppArmor present but NOT restricting is the majority of Ubuntu installs.
  const permissive = proc({ "/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "0" });
  assert.equal(needsNoSandbox({ platform: "linux", env: APPIMAGE, read: permissive }), false);
});

test("silence is not evidence: absent sysctls keep the sandbox", () => {
  // Most distributions have none of these files. Reading that as "broken" would
  // unsandbox nearly every Linux player to fix one configuration.
  assert.equal(needsNoSandbox({ platform: "linux", env: APPIMAGE, read: proc({}) }), false);
});

test("only an AppImage is affected", () => {
  // A .deb or a dev run has a real chrome-sandbox owned by root, so the same
  // hostile kernel settings are not a problem there.
  const blocked = proc({ "/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "1" });
  assert.equal(needsNoSandbox({ platform: "linux", env: {}, read: blocked }), false);
});

test("never on Windows or macOS", () => {
  const blocked = proc({ "/proc/sys/kernel/apparmor_restrict_unprivileged_userns": "1" });
  for (const platform of ["win32", "darwin"]) {
    assert.equal(needsNoSandbox({ platform, env: APPIMAGE, read: blocked }), false);
  }
});

test("reads the real /proc without throwing on any platform", () => {
  // The default reader is the one that actually ships; a throw here would take the
  // app down before its window exists, which is the very failure being fixed.
  assert.doesNotThrow(() => needsNoSandbox());
  assert.equal(typeof needsNoSandbox(), "boolean");
});
