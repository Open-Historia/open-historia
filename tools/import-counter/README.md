# Scenario import counter (retired)

A scenario's import count is now **how many times its file has been downloaded from the
community hub's releases**, as GitHub counts it. A workflow in the hub repository
([Open-Historia/Open-historia-scenarios](https://github.com/Open-Historia/Open-historia-scenarios))
adds the downloads up and writes them to `index.json` on its `hub-index` branch, and the game
reads that file itself (`src/runtime/hubFiles.js`). Nothing is reported by the game any more.

This Worker used to keep the counts in Cloudflare KV. Each import was a write and each read of
`/counts` a KV `list()`, and the free plan's daily KV allowance was spent within hours of every
day; from then until midnight UTC it answered `KV list() limit exceeded for the day` and nobody
saw any counts.

## What it does now

Game builds from before the change still call it, so it still answers them, from the hub's
index, in the shapes they expect, and stores nothing:

- `GET /counts` → `{ "<post number>": { "count": n }, ... }`
- `GET /count/<post number>` → `{ "id": "...", "count": n }`
- `POST /hit` → accepted and ignored (the download the import made is what counted it)

It reads no KV, hashes no address and keeps nothing about who called. The `IMPORTS` binding in
`wrangler.toml` is unused: it and the namespace can be deleted once nobody needs the old
numbers, which are already carried in the hub's counts (`data/legacy-import-counts.json` in the
hub repository holds what each post had reached on 2026-10-05).

## Deploy

It rides the site deploy from `main` (docs/delivery-and-deploy.md §6.1), or by hand:

```
cd tools/import-counter
wrangler deploy
```

Once the builds that call it are no longer in use, the Worker can be deleted altogether.
