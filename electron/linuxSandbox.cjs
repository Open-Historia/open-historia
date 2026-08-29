/*! Open Historia — Linux AppImage sandbox detection © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Decides whether Chromium's sandbox can start at all, because on one common Linux
// setup it cannot and the app dies on launch before a window ever appears:
//
//   FATAL:setuid_sandbox_host.cc(163)] The SUID sandbox helper binary was found,
//   but is not configured correctly. Rather than run without sandboxing I'm
//   aborting now. You need to make sure that .../chrome-sandbox is owned by root
//   and has mode 4755.
//
// Chromium sandboxes a renderer one of two ways: unprivileged user namespaces, or
// the setuid helper binary named in that message. INSIDE AN APPIMAGE THE SECOND ONE
// CAN NEVER WORK — the bundle is mounted through FUSE with nosuid, and nothing in it
// is owned by root, so the setuid bit could not take effect even if it were set. An
// AppImage therefore depends entirely on user namespaces.
//
// Ubuntu 24.04 (and derivatives — the report was a KDE one) ships an AppArmor policy
// that restricts unprivileged user namespaces. Chromium loses option one, falls back
// to option two, finds the helper unusable, and aborts. Debian and Arch hardening
// guides disable user namespaces outright, with the same result.
//
// So: when this is an AppImage AND user namespaces are positively known to be
// unavailable, start without the sandbox — a game that runs unsandboxed beats one
// that does not run. Everywhere else, including an AppImage on a kernel where user
// namespaces work, the sandbox is left exactly as it is. The check is deliberately
// "prove it is broken", not "prove it is fine": an unreadable or absent sysctl is the
// ordinary healthy case on most distributions and must not cost anyone their sandbox.

const fs = require("node:fs");

const readSysctl = (file) => {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return null; // not present on this kernel, which is itself the common case
  }
};

// Each entry is a sysctl and the value that means "unprivileged user namespaces are
// not available to us".
const USERNS_BLOCKED = [
  // Debian/Ubuntu's older switch, and what hardening guides set to 0.
  ["/proc/sys/kernel/unprivileged_userns_clone", "0"],
  // Ubuntu 24.04+: namespaces exist but AppArmor refuses them to unconfined binaries.
  ["/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "1"],
  // The generic kernel limit — zero of them allowed is the same thing.
  ["/proc/sys/user/max_user_namespaces", "0"],
];

// platform/env/read are injected so this is testable off a real Linux box.
const needsNoSandbox = ({ platform = process.platform, env = process.env, read = readSysctl } = {}) => {
  if (platform !== "linux") return false;
  // APPIMAGE is set by the AppImage runtime to the bundle's own path. An ordinary
  // install (a .deb, or a dev run) has a working chrome-sandbox and is left alone.
  if (!env.APPIMAGE) return false;
  return USERNS_BLOCKED.some(([file, blockedValue]) => read(file) === blockedValue);
};

module.exports = { needsNoSandbox, readSysctl, USERNS_BLOCKED };
