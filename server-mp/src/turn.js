/*! Open Historia — short-lived TURN credentials for coturn © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every game connection goes through the TURN relay (coturn), so players never
// learn each other's addresses. The relay must not be open to the world, and
// the server must not keep a user list for it, so credentials follow coturn's
// "TURN REST API" scheme (use-auth-secret):
//
//   username    "<expiry, unix seconds>:<random>"
//   credential  base64(HMAC-SHA1(TURN_SECRET, username))
//
// coturn holds the same secret, recomputes the credential from the username,
// and refuses one whose expiry has passed. Nothing is stored on either side,
// and a credential that leaks is good for TURN_TTL_SECONDS at most. The random
// part makes each credential different, so two are never linkable by name.
// SHA-1 is what coturn uses here; as an HMAC it is not weakened by SHA-1's
// collisions.

import { createHmac, randomBytes } from "node:crypto";

export const turnCredentials = ({ secret, urls, ttlSeconds, now }) => {
  const expires = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expires}:${randomBytes(16).toString("hex")}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { t: "turn", iceServers: [{ urls: [...urls], username, credential }], ttl: ttlSeconds };
};
