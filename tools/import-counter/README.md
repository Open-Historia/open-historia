# Scenario import counter

A tiny Cloudflare Worker that counts how many people import each community
scenario. The game server pings it once per install on a successful import (see
`server/server.js` → `/api/hub/import-log`), so you get real import numbers even
for scenarios GitHub can't count (issue attachments), deduped so one person
re-importing doesn't inflate the total.

Dedup is server-side, per scenario:
- **Website** (import forwarded by the registry Worker): once per **account _and_
  IP** — a signed-in import marks both, and a later hit is skipped if either the
  account or the IP was already seen for that scenario.
- **App / anonymous web**: once per **IP** (there is no account).

Raw IPs are never stored — they're hashed with `HASH_SALT`. The real browser IP
and account token are trusted only when the caller proves it's the registry
Worker via `FORWARD_SECRET`; direct callers can only spend their own IP.

It runs on Cloudflare's free tier (Workers + KV) — no card required for the free
plan, no server to keep alive.

## Deploy (one time)

1. **Install Wrangler** (Cloudflare's CLI) and log in:
   ```
   npm install -g wrangler
   wrangler login
   ```

2. **Create the KV namespace** and copy the printed id:
   ```
   cd tools/import-counter
   wrangler kv namespace create IMPORTS
   ```
   Paste the `id` it prints into `wrangler.toml` (replace `PASTE_KV_NAMESPACE_ID`).

3. **Deploy:**
   ```
   wrangler deploy
   ```
   Wrangler prints the Worker URL, e.g. `https://oh-import-counter.<your-subdomain>.workers.dev`.

4. **Point the app at it.** Set the URL as the game server's `OH_IMPORT_COUNTER_URL`
   environment variable, **or** send it to me and I'll bake it in as the default
   so every player's app reports to it. Until this is set, the import ping is a
   silent no-op (nothing breaks).

## Viewing the numbers

- All scenarios:  `https://<your-worker-url>/counts`
- One scenario:   `https://<your-worker-url>/count/<hub-issue-number>`

`id` is the scenario's hub issue number, so `/count/42` is the imports of the
scenario posted as issue #42.

## Notes

- Counts live in each KV key's metadata, so `/counts` is a single list call and
  stays inside the free-tier subrequest limit.
- This is an anonymous counter: like any client-side metric it *can* be inflated
  by someone calling `/hit` directly. The per-install dedupe on the game server
  handles ordinary repeat-imports; treat the numbers as "roughly how many people
  imported," not audited figures. If you later want stronger guarantees, the
  Worker is the place to add a shared secret or rate limiting.
