<!-- Open Historia — deploying the public multiplayer server © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->
# Deploying the public multiplayer server

One VM runs everything public multiplayer needs, as three containers ([docker-compose.yml](docker-compose.yml)):

| Container | Does | Listens on |
|---|---|---|
| `caddy` | TLS (Let's Encrypt, renewed by itself). Passes `/ws` and `/api/*` to server-mp; everything else is a 404. | 80/tcp (certificates, redirect), 443/tcp |
| `server-mp` | Signaling, the public listing and TURN credentials ([../server-mp](../server-mp/README.md)). Reachable only through Caddy, with no way out to the internet. | 8787, inside the compose network only |
| `coturn` | The TURN relay every game connection goes through, so players never see each other's addresses. On the host's network. | 3478/udp+tcp, 5349/tcp (TLS), 49152-65535/udp (relay ports) |

The settings, and the one secret, are in `ops/.env` ([.env.example](.env.example)).

These steps assume an Oracle Cloud Always Free VM running Ubuntu, but nothing below depends on Oracle except the firewall and networking notes.

## 1. The account: upgrade to Pay As You Go

Oracle reclaims Always Free VMs that look idle. The rule is about a week of low CPU, network and (on Ampere) memory use, and a signaling server with no games running looks exactly like that. Resources in a **Pay As You Go** account are not reclaimed this way, and Always Free resources stay free in it. So upgrade the account (Billing, then Upgrade and Manage Payment), and set a **budget with an alert** at a small amount, so any paid usage by mistake shows at once. Everything here fits in the Always Free allowance.

## 2. The VM

- Shape: an Ampere A1 (`VM.Standard.A1.Flex`) with 1 OCPU and 6 GB is plenty. All three images are built for arm64. The AMD micro shape works for a small load.
- Image: Ubuntu 24.04. Add your SSH key.
- A public IPv4 address. A **reserved** public IP keeps the same address if the VM is ever re-created, so the DNS record and `TURN_EXTERNAL_IP` stay right.
- Note both addresses: the public one (console, or `curl -4 https://ifconfig.me` on the VM) and the private one (`hostname -I`).

## 3. Open the ports

Two firewalls stand in the way, and both need the ports.

**The cloud's.** In the VCN's security list (or a network security group on the VM's VNIC), add stateful ingress rules from `0.0.0.0/0`:

| Protocol | Port | For |
|---|---|---|
| TCP | 80 | Let's Encrypt, and the redirect to HTTPS |
| TCP | 443 | HTTPS and the WebSocket |
| UDP | 3478 | TURN |
| TCP | 3478 | TURN over TCP, for networks that block UDP |
| TCP | 5349 | TURN over TLS |
| UDP | 49152-65535 | TURN relay ports (`min-port`/`max-port` in [coturn/turnserver.conf](coturn/turnserver.conf)) |

**The VM's own.** Oracle's Ubuntu images ship iptables rules that reject everything but SSH. Insert rules before the final `REJECT` (rule 6 on a fresh image; `sudo iptables -L INPUT --line-numbers` shows where), and save them. Do this **before** installing Docker, so the saved rules are only yours:

```sh
sudo iptables -I INPUT 6 -p tcp -m state --state NEW -m multiport --dports 80,443,3478,5349 -j ACCEPT
sudo iptables -I INPUT 6 -p udp -m multiport --dports 3478,49152:65535 -j ACCEPT
sudo netfilter-persistent save
```

Caddy's ports are published by Docker, which adds its own rules. coturn uses the host's network, so it depends on the lines above.

## 4. Docker

Install Docker Engine and the compose plugin from Docker's apt repository (docs.docker.com, "Install Docker Engine on Ubuntu"). Then add yourself to the `docker` group and log in again. Turn on unattended upgrades for the OS while you are there, and use SSH keys only.

## 5. DNS

Point an **A** record for the server's name (say `mp.example.org`) at the VM's public address, and an AAAA record if you gave it IPv6. Caddy can't get a certificate until the name resolves to the VM and ports 80 and 443 are open.

## 6. The files and the settings

Clone the repository on the VM, or copy just the two folders, which are self-contained:

```sh
scp -r server-mp ops ubuntu@<vm>:~/open-historia/
```

Then, on the VM:

```sh
cd ~/open-historia/ops
cp .env.example .env
chmod 600 .env
openssl rand -hex 32          # the TURN secret: paste it after TURN_SECRET=
nano .env
```

In `.env`:

- `MP_DOMAIN`: the name from step 5.
- `TURN_SECRET`: the `openssl rand -hex 32` output. coturn's `static-auth-secret` and server-mp's `TURN_SECRET` must be the same string, and both containers read it from this one line, so they are. Never commit it (`ops/.gitignore` keeps `.env` out); never paste it into a chat or an issue.
- `TURN_URLS`: the same name, three times. Leave the `turns:` URL out until coturn has its certificate (step 8).
- `TURN_EXTERNAL_IP` (required): `<public>/<private>`, e.g. `203.0.113.10/10.0.0.12`. The VM only knows its private address, and without this coturn would hand clients an address they cannot reach. The public address is also the only one the relay may send to: TURN-only players meet at it, so coturn refuses every other destination (the internet, the VM's own services, the cloud's metadata service), and it won't start without it.
- `TURN_TTL_SECONDS`: how long a credential lasts, 900 seconds unless set (at most 3600). A game connection that must outlive its credential asks server-mp for a new one and restarts ICE with it; see [../server-mp/README.md](../server-mp/README.md#turn).
- `ALLOWED_ORIGINS`: the pages that may connect. The example lists the web game, the Android app (`http://app.paxhistoria`) and the desktop app (`http://localhost:*`, `http://127.0.0.1:*`).

server-mp checks every value and refuses to start on one it cannot use, naming it (`docker compose logs server-mp`). coturn refuses to start without a secret of at least 32 characters.

## 7. Start

```sh
docker compose up -d --build
docker compose ps                    # all three running, server-mp "healthy"
docker compose logs -f server-mp     # server.start port=8787 turn=on origins=4 trustProxy=true …
```

Caddy gets its certificate within a minute of the first start. Keep the `caddy_data` volume: it holds the certificates and the ACME account, and losing it asks Let's Encrypt again and runs into its rate limits.

## 8. TURN over TLS

coturn serves `turns:` on 5349 with the same certificate Caddy obtained. Copy it out of Caddy's storage, readable by coturn's user (uid 65534, `nobody`) alone:

```sh
cd ~/open-historia/ops
MP_DOMAIN=mp.example.org
dir=$(docker compose exec -T caddy sh -c "dirname \"\$(find /data/caddy/certificates -name '$MP_DOMAIN.crt' | head -n 1)\"")
docker compose cp "caddy:$dir/$MP_DOMAIN.crt" coturn/certs/fullchain.pem
docker compose cp "caddy:$dir/$MP_DOMAIN.key" coturn/certs/privkey.pem
sudo chown 65534:65534 coturn/certs/*.pem
sudo chmod 600 coturn/certs/*.pem
docker compose restart coturn
```

Then add the `turns:` URL to `TURN_URLS` and run `docker compose up -d`. Caddy renews the certificate well before it expires, but coturn keeps the copy it loaded, so repeat these lines regularly; a monthly cron entry is enough for today's 90-day certificates.

### Why 5349 and not 443

Some networks (offices, schools, hotels) let through only 443, and on those a player needs TURN over TLS on 443. But 443 on this VM's address belongs to Caddy, and two programs can't listen on one address and port. There are two ways to have both, and neither is set up here:

- **SNI routing.** A layer-4 proxy takes 443 and reads the server name in each TLS hello, before any decryption. It passes a second name (say `turn.example.org`) to coturn and everything else to Caddy. Caddy with the layer4 plugin can do it, as can HAProxy (`req.ssl_sni`) or nginx (`stream` with `ssl_preread`). The cost: coturn then sees the proxy as every client's address, which blunts its per-client limits and its logs.
- **A second public IP.** Oracle lets a VNIC carry a secondary private IP with its own reserved public IP. coturn binds 443 on that address (`listening-ip`, `tls-listening-port=443`), Caddy keeps 443 on the first, and each gets its own DNS name. No proxy is involved.

By default TURN over TLS uses 5349, its standard port, which most networks allow. The WebSocket already runs on 443, so a player behind such a network can still browse the listing. Only the game connection needs TURN.

## 9. Test it

From your own machine, not the VM:

```sh
curl -s https://mp.example.org/api/rooms
# {"t":"rooms","rooms":[],"total":0,"page":0}

npx wscat -c wss://mp.example.org/ws -H "Origin: https://openhistoria.com"
# > {"t":"ping","n":1}
# < {"t":"pong","n":1}
```

Without an allowed `Origin`, the socket must be refused (403).

**TURN, with `turnutils_uclient`** (it ships in coturn's image). First make a credential the way server-mp does:

```sh
secret='<TURN_SECRET from ops/.env>'
user="$(( $(date +%s) + 3600 )):uclient-test"
pass=$(printf '%s' "$user" | openssl dgst -binary -sha1 -hmac "$secret" | openssl base64)
uclient() { docker run --rm --network host coturn/coturn:4.6-alpine turnutils_uclient -u "$user" -w "$pass" "$@"; }
```

Then run the checks:

| Run | What it checks | Expect |
|---|---|---|
| `uclient -y -n 10 mp.example.org` | two clients relaying to each other through two allocations, which is exactly what two TURN-only players do | 10 messages sent, 10 received, none lost |
| `uclient -y -n 10 -t mp.example.org` | the same, over TCP | the same |
| `uclient -y -n 10 -t -S -p 5349 mp.example.org` | the same, over TLS | the same |
| `uclient -n 1 -e 169.254.169.254 -r 80 mp.example.org` | the cloud metadata service is out of reach | refused: 403 Forbidden IP |
| `uclient -n 1 -e 10.0.0.1 -r 80 mp.example.org` | the VM's private network is out of reach | refused: 403 Forbidden IP |
| `uclient -n 1 -e 1.1.1.1 -r 53 mp.example.org` | nothing else on the internet is in reach either: the relay is not a proxy | refused: 403 Forbidden IP |
| `uclient -n 1 -T mp.example.org` | no TCP relaying | refused |

If `-y` fails over UDP while the others work, check two things: that the relay port range is open in both firewalls, and that `TURN_EXTERNAL_IP` is right. Relaying between two allocations means sending to the VM's own public address (the one destination coturn allows), and the cloud has to route that back to the VM; without that, no two TURN-only players can connect at all.

`turnutils_uclient -h` lists every option.

## 10. Pointing the game at it

Build the game with `VITE_OH_MP_SERVER=https://mp.example.org` (`.env.web`, `.env.android`, and the desktop build's environment). Until a build has it, its public-server browser shows "Coming soon". See [../server-mp/README.md](../server-mp/README.md#pointing-the-game-at-it).

## Running it

- **Update.** Pull or copy the folders again, then `docker compose up -d --build`. Every month or so, `docker compose pull` and `docker compose build --pull` to take up fixes in Caddy, coturn and Node.
- **Restarts.** Rooms live in memory: a restart empties the listing, and hosts register again when they reconnect. There is nothing to back up except `ops/.env`, and the `caddy_data` volume if you want to keep the certificates.
- **Changing the TURN secret.** Edit `.env`, then `docker compose up -d`: both containers restart with the new secret. Credentials handed out under the old one stop working, and clients ask for new ones.
- **Logs.** Use `docker compose logs <service>`. Docker keeps at most 30 MB per service (three 10 MB files).
  - server-mp logs events with keyed hashes instead of addresses, and nothing a player wrote.
  - Caddy logs requests only if told to.
  - coturn names client addresses in its log. To keep none, set `log-file=/dev/null` in `coturn/turnserver.conf`, at the price of its error messages.
- **Limits and capacity.** The defaults suit an Always Free micro VM (1 GB):
  - The containers' memory limits add up to 448 MB. server-mp takes no new sockets above `MAX_MEMORY_MB` (150, set in `docker-compose.yml`), so it stops accepting before its container is killed.
  - A credential covers one connection (`user-quota=6`: a browser makes one allocation per TURN URL, up to three, and six leaves room for an ICE restart). A host asks for one per player it answers.
  - Each player's connection holds up to six relay ports, three at each end, so the 16,384 ports in the range are some 2,700 player connections.
  - The practical limit is bandwidth: `bps-capacity` caps the whole relay at about 24 Mbit/s each way, about 7.8 TB a month out at most, under Oracle's free 10 TB.
  - Raise `MAX_ROOMS`, `MAX_CONNECTIONS`, the memory limits and `bps-capacity` together with the machine.
