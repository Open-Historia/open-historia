/*! Open Historia — country panel report requests, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Selection/reportRequests.test.js
//
// France's Advisor Report landed in Germany's panel when the player opened
// Germany before it came back, and reopening France started a second request
// while the first was still running.

import assert from "node:assert/strict";
import test from "node:test";

import { createReportRequests } from "./reportRequests.js";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test("reopening a country joins its running report instead of asking again", async () => {
  const reports = createReportRequests();
  const answer = deferred();
  let requests = 0;
  const first = reports.request("game|FRA", () => { requests += 1; return answer.promise; });
  assert.equal(reports.pending("game|FRA"), first);
  const again = reports.request("game|FRA", () => { requests += 1; return "second"; });
  assert.equal(again, first);
  answer.resolve("France's briefing");
  assert.equal(await again, "France's briefing");
  assert.equal(requests, 1, "one AI request, not two");
});

test("each country has its own request, and a finished one can be asked again", async () => {
  const reports = createReportRequests();
  const france = reports.request("game|FRA", async () => "France");
  const germany = reports.request("game|DEU", async () => "Germany");
  assert.notEqual(france, germany);
  assert.equal(await france, "France");
  assert.equal(await germany, "Germany");
  assert.equal(reports.pending("game|FRA"), null, "settled requests are dropped");
  assert.equal(await reports.request("game|FRA", async () => "France again"), "France again");
});

test("a failed report is dropped from the running set, so the player can retry", async () => {
  const reports = createReportRequests();
  await assert.rejects(reports.request("game|FRA", async () => { throw new Error("no key"); }), /no key/);
  assert.equal(reports.pending("game|FRA"), null);
});

test("a report that came back while another country was shown is handed over once", () => {
  const reports = createReportRequests();
  assert.equal(reports.take("game|FRA"), null);
  reports.keep("game|FRA", { text: "France's briefing" });
  assert.deepEqual(reports.take("game|FRA"), { text: "France's briefing" });
  assert.equal(reports.take("game|FRA"), null);
  assert.equal(reports.take("game|DEU"), null, "never another country's");
});

test("asking again replaces a report still waiting to be handed over", async () => {
  const reports = createReportRequests();
  reports.keep("game|FRA", { text: "old" });
  await reports.request("game|FRA", async () => "new");
  assert.equal(reports.take("game|FRA"), null);
});
