/*! Open Historia — self-signed HTTPS dev certificate generator © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// PWA installability (and service workers in general) require a "secure
// context" — HTTPS, or the localhost exception. A plain LAN address like
// http://192.168.1.20:3000 does not qualify, so other devices on the same
// network can load the game but can never install it or get a service
// worker. This script makes a self-signed cert covering localhost and this
// machine's current LAN IPs so server.js can serve over HTTPS instead.
// Usage: node scripts/generate-dev-cert.mjs
//
// The cert is self-signed, so every OTHER device that connects to it must
// be told to trust it once — Chrome will otherwise refuse the connection
// outright (not just show a warning) once a service worker is involved.
// Copy certs/dev-cert.pem to the other device and install it as a trusted
// certificate (Android: Settings > Security > Install from storage > CA
// certificate; iOS: AirDrop/email the file, open it, then enable full trust
// under Settings > General > About > Certificate Trust Settings; Windows:
// double-click > Install Certificate > Local Machine > Trusted Root
// Certification Authorities).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const CERT_DIR = path.join(ROOT, "certs");
const KEY_PATH = path.join(CERT_DIR, "dev-key.pem");
const CERT_PATH = path.join(CERT_DIR, "dev-cert.pem");

function lanIPv4Addresses() {
  const found = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) found.push(addr.address);
    }
  }
  return found;
}

try {
  execFileSync("openssl", ["version"], { stdio: "ignore" });
} catch {
  console.error("openssl was not found on PATH. Install it (e.g. https://slproweb.com/products/Win32OpenSSL.html on Windows) and try again.");
  process.exit(1);
}

if (!existsSync(CERT_DIR)) mkdirSync(CERT_DIR);

const lanIPs = lanIPv4Addresses();
const sanEntries = ["DNS:localhost", "IP:127.0.0.1", ...lanIPs.map((ip) => `IP:${ip}`)];
const subjectAltName = `subjectAltName=${sanEntries.join(",")}`;

execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "825", "-nodes",
  "-keyout", KEY_PATH,
  "-out", CERT_PATH,
  "-subj", "/CN=Open Historia Dev",
  "-addext", subjectAltName,
], { stdio: "inherit" });

console.log(`\nWrote certs/dev-cert.pem and certs/dev-key.pem, valid for: ${sanEntries.join(", ")}`);
console.log("Restart the server (node server/server.js) — it will pick these up automatically and switch to HTTPS.");
if (lanIPs.length === 0) {
  console.log("No LAN IP was detected on this machine — only localhost/127.0.0.1 are covered. Re-run this script if you connect to a network later.");
}
