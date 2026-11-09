# Scenario import counter

A scenario's import count is **how many players' games have imported it**, as the game itself
reports it. Downloading a scenario's file from GitHub, by hand or by the game, counts nothing.

From 2026-10-05 until this Worker took it over again, the count was how many times the file had
been downloaded from the community hub's releases, as GitHub counts it, and anyone could raise a
post's count by downloading its file's address over and over. Before that, this Worker kept the
counts in KV, and the free plan's daily KV allowance was spent within hours of every day. It now
keeps them in D1, where a counted import is three rows written and a read of the counts is served
from the edge cache for five minutes.

## What it counts

The game reports a post's first import on an install (`src/runtime/hubImportCount.js`):
`POST /import { post, token }`, where `token` is a SHA-256 of the install's own random key and the
post's number. The import is counted only when:

- the request comes from one of the game's pages (`Origin`: openhistoria.com, its Pages previews,
  the Android app's `http://app.openhistoria`, the desktop app's `http://localhost:<port>`), so no
  other website can make its visitors count for it;
- the post is a scenario the hub has released (its `index.json`);
- that token has not counted that post before (one count per install per post);
- that internet address has not counted that post today (UTC), and has counted fewer than
  20 posts today;
- the rate limiter lets it through (10 reports a minute per address).

Fresh tokens cost nothing to make; the address rules are what bound one person to one count per
post per day. The address is kept only as an HMAC of it and the day under the `COUNT_KEY` secret,
in rows the daily cron deletes after a day; tokens cannot be matched between posts.

`GET /counts` → `{ "<post number>": { "count": n }, ... }` and `GET /count/<post>` →
`{ "id": "...", "count": n }`, where `count` is the post's frozen `legacy` count plus the imports
counted here. `POST /hit`, which the oldest builds still send, is answered and never counted.

## The old numbers

The first time the Worker runs with its database it copies the hub index's `imports` (the
downloads, with the first counter's numbers already added in by the hub) into `counts.legacy`, once
(`meta` row `legacy` says when). Downloads after that are never read again. To correct one post's
starting number:

```
wrangler d1 execute oh-import-counts --remote --command "UPDATE counts SET legacy = 0 WHERE post = 123"
```

## Set up (once) and deploy

```
cd tools/import-counter
wrangler d1 create oh-import-counts      # paste the database_id into wrangler.toml
wrangler secret put COUNT_KEY            # any long random text, e.g. openssl rand -hex 32
wrangler deploy
```

After that it rides the site deploy from `main` (docs/delivery-and-deploy.md §6.1). Without the
database it answers the counts from the hub's index and counts nothing; without `COUNT_KEY` it
counts nothing. The old `IMPORTS` KV namespace is no longer bound and can be deleted.
