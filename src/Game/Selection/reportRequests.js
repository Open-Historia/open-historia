/*! Open Historia — country panel report requests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The country panel stays mounted and is pointed at one country after another.
// Its Advisor Report is an AI request that can take a while, and it used to land
// on whichever country the panel showed when it came back: ask for France, open
// Germany, and France's briefing appeared as Germany's. Reopening France instead
// cleared the loading state, so the button started a second request while the
// first was still running.
//
// Requests are kept here by country, outside the panel: one runs per country at
// a time and reopening that country joins it. A report that comes back while
// the panel shows another country is held until its own country is shown again,
// so the request it cost is not thrown away.

export const createReportRequests = () => {
  const inFlight = new Map();
  const unclaimed = new Map();
  return {
    // The request running for this country, or null.
    pending: (key) => inFlight.get(key) ?? null,
    // Joins the request running for this country, or starts one with `run`.
    request(key, run) {
      const running = inFlight.get(key);
      if (running) return running;
      unclaimed.delete(key);
      const started = Promise.resolve().then(run);
      inFlight.set(key, started);
      const settle = () => {
        if (inFlight.get(key) === started) inFlight.delete(key);
      };
      started.then(settle, settle);
      return started;
    },
    // A finished report nobody was looking at, kept for its country.
    keep: (key, outcome) => {
      unclaimed.set(key, outcome);
    },
    // The report kept for this country, handed over once.
    take(key) {
      if (!unclaimed.has(key)) return null;
      const outcome = unclaimed.get(key);
      unclaimed.delete(key);
      return outcome;
    },
  };
};
