/*! Open Historia — token buckets for the public multiplayer server © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Every rate limit on the server is one of these: a bucket holds up to `burst`
// tokens and refills at `rate` a second, and each thing that is limited takes
// one. A burst is allowed (a page that opens and lists, hosts and asks for TURN
// all at once); a stream is not.
//
// Time comes from the caller, so tests can hold the clock still. A clock that
// steps backwards (an NTP correction) refills nothing rather than draining the
// bucket.

export const createBucket = ({ rate, burst, at }) => {
  let tokens = burst;
  let last = at;
  const refill = (now) => Math.min(burst, tokens + (Math.max(0, now - last) / 1000) * rate);
  return {
    take(now) {
      tokens = refill(now);
      last = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
    // Whether take would succeed, without taking: a request limited by
    // several buckets checks them all first, so one that is refused by one
    // bucket spends nothing from the others.
    ready(now) {
      return refill(now) >= 1;
    },
    // Back to full by `now`, so it holds nothing worth remembering.
    full(now) {
      return refill(now) >= burst;
    },
    // New limits for a bucket sized by something that changed (a room's
    // seats). What was already spent stays spent: shrinking and growing it back
    // does not refill it.
    resize(now, next) {
      tokens = refill(now);
      last = now;
      rate = next.rate;
      burst = next.burst;
      tokens = Math.min(tokens, burst);
    },
  };
};

// Buckets by key (an address, say), each made on first use and forgotten
// once it is full again (prune, from the server's heartbeat). A flood from
// more keys than `max` between two prunes starts the table afresh rather than
// letting it grow without end.
export const createBucketTable = ({ rate, burst, max = 50_000 }) => {
  const buckets = new Map();
  return {
    get(key, at) {
      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= max) buckets.clear();
        bucket = createBucket({ rate, burst, at });
        buckets.set(key, bucket);
      }
      return bucket;
    },
    prune(at) {
      for (const [key, bucket] of buckets) if (bucket.full(at)) buckets.delete(key);
    },
    get size() {
      return buckets.size;
    },
  };
};
