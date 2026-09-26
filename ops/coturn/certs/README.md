<!-- Open Historia — where coturn's TLS certificate goes © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->
# coturn's certificate

coturn serves TURN over TLS (`turns:`, port 5349) with two files that go here, on the server only:

| File | What |
|---|---|
| `fullchain.pem` | the certificate for `MP_DOMAIN`, with its intermediates |
| `privkey.pem` | its private key |

They are copied from the certificate Caddy obtains for the same name ([../../README.md](../../README.md), "TURN over TLS"), owned by uid 65534 (coturn runs as `nobody`) with mode 600. Git ignores everything in this folder except this file. Never commit a key.
