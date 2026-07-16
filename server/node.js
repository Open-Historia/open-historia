/*! Open Historia — content node © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// A stateless, content-addressed node that anyone can run to expand the network.
// It serves ONLY hash-verified, read-only bytes — never player games, never AI
// keys, never the client code. Files in the content directory are named by their
// SHA-256; the browser client fetches by hash and re-verifies every byte, so a
// malicious node can at worst force a retry (see src/runtime/contentTrust.js).
//
// Run: OH_NODE_PORT=4400 OH_NODE_CONTENT_DIR=./node-content node server/node.js
// Populate the content dir with: node scripts/populate-node.mjs

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseByteRange } from "./security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.OH_NODE_PORT) || 4400;
const HOST = process.env.OH_NODE_HOST || undefined; // omit → all interfaces (behind a tunnel/proxy)
const NODE_ID = process.env.OH_NODE_ID || "node-local";
const CONTENT_DIR = path.resolve(process.env.OH_NODE_CONTENT_DIR || path.join(__dirname, "..", "node-content"));
const NODE_VERSION = 1;

const HASH_RE = /^[a-f0-9]{64}$/;

const RATE_LIMIT = Number(process.env.OH_NODE_RATE_LIMIT) || 600; // requests/min/IP

const app = express();
app.disable("x-powered-by");

// Lightweight per-IP fixed-window rate limit (no dependency). Behind a tunnel/
// proxy the real client IP arrives in CF-Connecting-IP / X-Forwarded-For.
const hits = new Map();
const rateTimer = setInterval(() => hits.clear(), 60000);
if (typeof rateTimer.unref === "function") rateTimer.unref();
app.use((req, res, next) => {
  const ip = req.headers["cf-connecting-ip"]
    || String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || req.socket.remoteAddress
    || "unknown";
  const count = (hits.get(ip) || 0) + 1;
  hits.set(ip, count);
  if (count > RATE_LIMIT) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Rate limit exceeded." });
    return;
  }
  next();
});

// Read-only public content: permissive CORS is safe (everything is public bytes,
// verified client-side). Only GET/HEAD/OPTIONS are allowed.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (!["GET", "HEAD"].includes(req.method)) {
    res.status(405).json({ error: "Only GET/HEAD are allowed." });
    return;
  }
  next();
});

const listContentHashes = () => {
  try {
    return fs.readdirSync(CONTENT_DIR).filter((name) => HASH_RE.test(name));
  } catch {
    return [];
  }
};

app.get("/oh/v1/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, id: NODE_ID, version: NODE_VERSION });
});

app.get("/oh/v1/manifest", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ id: NODE_ID, version: NODE_VERSION, caps: ["content"], hashes: listContentHashes() });
});

// Content-addressed fetch. The path param IS the SHA-256, so the URL is immutable
// and safely long-cacheable; the client re-hashes the body regardless.
app.get("/oh/v1/content/:hash", (req, res) => {
  const hash = String(req.params.hash || "").toLowerCase();
  if (!HASH_RE.test(hash)) {
    res.status(400).json({ error: "Invalid content hash." });
    return;
  }

  const filePath = path.join(CONTENT_DIR, hash);
  // Defense in depth: the hash regex already blocks traversal, but confirm the
  // resolved path stays inside the content dir.
  if (path.dirname(path.resolve(filePath)) !== CONTENT_DIR || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Content not found." });
    return;
  }

  const { size } = fs.statSync(filePath);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", "application/octet-stream");
  // Content is addressed by hash → the bytes for a given URL never change.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

  const rangeHeader = req.headers.range;
  if (!rangeHeader) {
    res.setHeader("Content-Length", String(size));
    if (req.method === "HEAD") {
      res.status(200).end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const range = parseByteRange(rangeHeader, size);
  if (range.status === 416) {
    res.status(416).setHeader("Content-Range", `bytes */${size}`);
    res.end();
    return;
  }
  res.status(206);
  res.setHeader("Content-Length", String(range.end - range.start + 1));
  res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
});

app.use((req, res) => res.status(404).json({ error: "Not found." }));

const listenArgs = HOST ? [PORT, HOST] : [PORT];
app.listen(...listenArgs, () => {
  const hashes = listContentHashes().length;
  console.log(`Open Historia content node "${NODE_ID}" on http://${HOST || "0.0.0.0"}:${PORT}`);
  console.log(`Serving ${hashes} content object(s) from ${CONTENT_DIR}`);
});
