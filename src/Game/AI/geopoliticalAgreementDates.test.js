/*! Open Historia — generated agreement date tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/geopoliticalAgreementDates.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { checkGeneratedAgreementDates } from "./geopoliticalAgreementDates.js";

test("a BC scenario keeps a treaty signed before it, in canonical form", () => {
  assert.deepEqual(
    checkGeneratedAgreementDates({ startedDate: "-0241-03-10", scenarioDate: "-0218-03-01" }),
    { startedDate: "-0241-03-10", endedDate: "" },
  );
  assert.deepEqual(
    checkGeneratedAgreementDates({ startedDate: "241-03-10 BC", endedDate: "-0201-01-01", scenarioDate: "-0218-03-01" }),
    { startedDate: "-0241-03-10", endedDate: "-0201-01-01" },
    "an era word or unpadded year is read and stored canonically",
  );
});

test("a BC scenario drops treaties that start after it or ended by it", () => {
  assert.equal(checkGeneratedAgreementDates({ startedDate: "0241-03-10", scenarioDate: "-0218-03-01" }).problem, "not-yet", "an unsigned year is AD");
  assert.equal(checkGeneratedAgreementDates({ startedDate: "-0217-01-01", scenarioDate: "-0218-03-01" }).problem, "not-yet");
  assert.equal(checkGeneratedAgreementDates({ startedDate: "-0300-01-01", endedDate: "-0219-06-01", scenarioDate: "-0218-03-01" }).problem, "ended");
  assert.equal(checkGeneratedAgreementDates({ startedDate: "-0300-01-01", endedDate: "-0218-03-01", scenarioDate: "-0218-03-01" }).problem, "ended", "ending on the day counts as ended");
});

test("dates that are not exact game dates are refused", () => {
  assert.equal(checkGeneratedAgreementDates({ startedDate: "", scenarioDate: "1914-06-28" }).problem, "start");
  assert.equal(checkGeneratedAgreementDates({ startedDate: "1904-04", scenarioDate: "1914-06-28" }).problem, "start");
  assert.equal(checkGeneratedAgreementDates({ startedDate: "1904-04-08", endedDate: "someday", scenarioDate: "1914-06-28" }).problem, "end");
  assert.deepEqual(
    checkGeneratedAgreementDates({ startedDate: "1904-04-08", scenarioDate: "" }),
    { startedDate: "1904-04-08", endedDate: "" },
    "no scenario date, no scenario checks",
  );
});
