/*! Open Historia — stage the web build into the Android shell © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The Android app IS the web build. It used to be a thin WebView that asked for
// the address of a server the player had to run themselves — Termux on the same
// phone, or a machine on their network — and then navigated to it. Now it ships
// the same bundle openhistoria.com serves, which connects to a community content
// node on its own, so there is nothing to install and nothing to type.
//
// This copies dist-web/ into mobile/www/ (Capacitor's webDir), which is why
// nothing in mobile/www is committed except its .gitignore.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(mobileDir);
const source = path.join(repoRoot, "dist-web");
const target = path.join(mobileDir, "www");

if (!existsSync(path.join(source, "index.html"))) {
  console.error(
    "dist-web/ is missing — build the web app first:\n"
    + "  npm run build:web\n"
    + "(from the repo root; the APK workflow does this for you).",
  );
  process.exit(1);
}

// Keep .gitignore: it is the only committed thing in here, and losing it would
// put a whole build output into the next commit.
for (const entry of existsSync(target) ? readdirSync(target) : []) {
  if (entry === ".gitignore") continue;
  rmSync(path.join(target, entry), { recursive: true, force: true });
}
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });

console.log(`Staged the web build into mobile/www/ (${readdirSync(target).length} entries).`);
