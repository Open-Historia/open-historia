# Deploying the playable game website (web mode)

This is the browser-playable Open Historia — the "play on a website" build. It's a
static app (served from a trusted origin) that keeps games client-side, sends AI keys
straight to the player's provider, and loads map data from the content-node network.

**Chosen setup:** app on **Cloudflare Pages**; map data from **content nodes only**
(no origin fallback — the map loads once at least one node in the signed directory is
serving it).

Prerequisites: a free Cloudflare account, Node 18+, and the offline root signing key
(`trust/oh-root.key.pem`, from `scripts/gen-signing-key.mjs`).

---

## 1. Deploy the registry Worker (control plane)

From the **open-historia-admin** repo:

```bash
cd registry
npx wrangler d1 create oh-accounts         # paste the returned id into wrangler.toml
npx wrangler d1 execute oh-accounts --remote --file schema.sql   # nodes, accounts, presence
npx wrangler kv namespace create NODES     # still used for small hot keys; paste the id in
npx wrangler secret put ADMIN_TOKEN        # a long random token
npx wrangler deploy                        # note the URL, e.g.
                                           #   https://open-historia-registry.<you>.workers.dev
```

> The node registry lives in **D1** (`nodes` table), not KV — KV's 1,000 writes/day free
> tier could not absorb node heartbeats. `schema.sql` also creates the accounts and
> presence tables.

## 2. Build the game for the web, pointed at the live directory

From **this** repo, set the directory URL to the Worker's `/node-directory.json`:

```bash
# macOS/Linux
VITE_OH_DIRECTORY_URL="https://open-historia-registry.<you>.workers.dev/node-directory.json" npm run build:web

# Windows PowerShell
$env:VITE_OH_DIRECTORY_URL="https://open-historia-registry.<you>.workers.dev/node-directory.json"; npm run build:web
```

This produces `dist-web/`. (Base path is `/`, correct for Cloudflare Pages.)

## 3. Deploy `dist-web/` to Cloudflare Pages

```bash
npx wrangler pages deploy dist-web --project-name open-historia
```

First run creates the project; it prints your URL (e.g. `https://open-historia.pages.dev`).
Add a custom domain in the Cloudflare Pages dashboard if you want.

## 4. Run at least one content node (so maps load)

On an always-on machine, follow the **open-historia-node** README:

```bash
# in the node repo, after install:
#   OH_NODE_REGISTRY_URL   = the Worker URL
#   OH_NODE_DIRECTORY_URL  = <Worker URL>/node-directory.json
#   OH_NODE_PUBLIC_URL     = your node's public https URL (e.g. a Cloudflare Tunnel)
npm run populate    # download + verify the map data
# start it, expose it over HTTPS
```

A node registers itself and is listed as **active** straight away. To publish it to
players, run the **admin panel** (open-historia-admin/panel, with `oh-root.key.pem`
present) and re-sign the directory — the game starts loading map data from it with no
rebuild, since the Worker serves the directory live. The panel is also where you pause or
ban a node, and where **Update all nodes** rolls out a new node release.

## 5. Play

Open your Pages URL. Players pick their AI provider and paste their own key in Settings
(it goes **straight to the provider** — nothing to configure server-side). Games are saved
in the browser (Export/Import for backups).

---

## Notes

- **No node yet = blank map.** With "content nodes only" there is no origin fallback for
  the pmtiles, so the world map is empty until at least one node in the signed directory
  serves it. The
  rest of the site (menus, scenarios) loads fine. (To add an always-on fallback later, host
  the 3 pmtiles on a CORS-enabled bucket like Cloudflare R2 and wire it as the origin.)
- **The signing key stays offline** — only the machine running the admin panel touches it.
- **Updating the game:** rebuild with the same `VITE_OH_DIRECTORY_URL` and re-run
  `wrangler pages deploy`. Everyone gets the update on their next load — no per-player step.
- **Local single-player is unaffected** by all of this — the downloadable app still runs
  its own server and never uses any of the web-mode / node code.
