/*! Open Historia - N030 historical browsing and reveal. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { olderLedgerEvents, filterOlderEvents, olderEventPage, uniqueLedgerEvent, projectTimelineHistory, OLDER_EVENT_PAGE_SIZE } from "./olderEventHistory.js";
import { liveEventCard, revealedEventCards } from "./turnReveal.js";

const outcome = { id: "outcome", title: "The audience concludes", date: "1912-01-08", kind: "interactive", tags: ["Diplomacy"], interactiveTranscript: { version: 1 } };
const earlier = { id: "source", title: "Invitation to the palace", date: "1912-01-01", tags: ["Politics"] };
const later = { id: "latest", title: "Later event", date: "1914-01-01" };

test("older canonical cards survive the recent-turn window and retain their attachments", () => {
  const events = [earlier, outcome, later, { id: "unseen", date: "1914-01-02" }];
  assert.deepEqual(olderLedgerEvents(events, [{ eventIds: ["latest"] }], new Set(["unseen"])), [outcome, earlier]);
  assert.equal(olderLedgerEvents(events, [{ eventIds: ["latest"] }])[1], outcome);
  assert.equal(olderLedgerEvents(events, [{ eventIds: ["outcome", "latest"] }], new Set(["unseen"])).length, 1);
  assert.equal(events[1], outcome, "reading does not rewrite any record");
});

test("older browsing is chronological, searchable, bounded per page but not by campaign length", () => {
  const events = Array.from({ length: 400 }, (_, i) => ({ id: "e" + i, title: "Event " + i, date: "1912-01-01", tags: i % 2 ? ["Politics"] : [] }));
  events.push(earlier, outcome, later);
  const archive = olderLedgerEvents(events, [{ eventIds: ["latest"] }]);
  assert.equal(archive.length, 402);
  assert.equal(archive[0], outcome);
  assert.equal(archive[1], earlier);
  assert.equal(archive[2].id, "e399");
  assert.equal(olderEventPage(archive, 0).length, OLDER_EVENT_PAGE_SIZE);
  assert.equal(olderEventPage(archive, 10000).at(-1).id, "e0");
  assert.deepEqual(filterOlderEvents(archive, "AUDIENCE", "Diplomacy"), [outcome]);
  assert.deepEqual(filterOlderEvents(archive, "1912-01-08"), [outcome]);
  assert.deepEqual(filterOlderEvents(archive, "audience", "Politics"), []);
});

test("source links never guess an ambiguous old event ID", () => {
  assert.equal(uniqueLedgerEvent([earlier, outcome], "source"), earlier);
  assert.equal(uniqueLedgerEvent([earlier, { ...earlier, title: "Duplicate" }], "source"), null);
  assert.equal(uniqueLedgerEvent([earlier], "missing"), null);
});

test("the reveal prefix comes before the category filter, and streamed cards cannot contain archives", () => {
  assert.deepEqual(revealedEventCards([earlier, outcome], 1, "Diplomacy"), []);
  assert.deepEqual(revealedEventCards([earlier, outcome], 2, "Diplomacy"), [outcome]);
  assert.equal("interactiveTranscript" in liveEventCard(outcome), false);
  assert.equal("interactiveTranscript" in outcome, true);
});

test("the live scene stays in its own dialog and archived text has no game mutation handler", () => {
  const main = readFileSync(new URL("./main.jsx", import.meta.url), "utf8");
  const time = readFileSync(new URL("./time.jsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("./interactive.jsx", import.meta.url), "utf8");
  assert.match(main, /<LazyInteractivePanel\s+open={isInteractiveOpen}/);
  assert.doesNotMatch(time, /<InteractivePanel\b|<LazyInteractivePanel\b/);
  assert.match(ui, /role="dialog" aria-modal="true" aria-label="Interactive event"/);
  assert.match(time, /event.kind === "interactive" && <React.Suspense/);
  assert.match(time, /<LazyInteractiveTranscript event={event}/);
  assert.match(ui, /showEventOnTimeline\(finished.eventId\)/);
  assert.match(ui, /Explore interactive event/);
  assert.match(ui, /<dialog ref={dialogRef} aria-label="Interactive event transcript"/);
  assert.match(ui, /dialog.showModal\(\)/);
  assert.match(time, /!archiveMode && totalVisibleEvents/);
  const archive = ui.slice(ui.indexOf("export const InteractiveTranscript"), ui.indexOf("export const InteractivePanel"));
  assert.doesNotMatch(archive, /advanceActiveInteractive|createInteractive|endActiveInteractive|rewindActiveInteractive|setAsideActiveInteractive/);
});

test("N030: completion appends to the preceding Events page, without changing any canonical commit", () => {
  const jump = { mode: "jump", round: 2, fromDate: "1912-01-01", toDate: "1912-01-31", eventIds: ["e1", "e2"] };
  const scene = { mode: "interactive", round: 3, fromDate: "1912-01-31", toDate: "1912-01-31", eventIds: ["outcome"] };
  const second = { ...scene, round: 4, eventIds: ["another"] };
  const raw = [second, scene, jump];
  const before = JSON.stringify(raw);
  const grouped = projectTimelineHistory(raw);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].eventIds, ["e1", "e2", "outcome", "another"]);
  assert.equal(grouped[0].round, 2);
  assert.equal(grouped[0].latestCommitRound, 4);
  assert.equal(grouped[0].sceneAppendCount, 2);
  assert.equal(grouped[0].fromDate, jump.fromDate);
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(projectTimelineHistory([jump]), [jump]);
  assert.deepEqual(projectTimelineHistory([scene, jump])[0].eventIds, ["e1", "e2", "outcome"]);
  assert.deepEqual(olderLedgerEvents([ { id: "e1" }, { id: "e2" }, { id: "outcome" }, { id: "another" } ], grouped), []);
});

test("N030: never collapse real same-day skips or invent a missing parent page", () => {
  const jump = { mode: "jump", round: 2, fromDate: "1912-01-01", toDate: "1912-01-31", eventIds: ["e1"] };
  const sameDay = { mode: "auto", round: 3, fromDate: "1912-01-31", toDate: "1912-01-31", eventIds: ["e2"] };
  const scene = { mode: "interactive", round: 4, fromDate: "1912-01-31", toDate: "1912-01-31", eventIds: ["outcome"] };
  assert.equal(projectTimelineHistory([sameDay, jump]).length, 2);
  assert.deepEqual(projectTimelineHistory([scene, sameDay, jump]).map(e => e.eventIds), [["e2", "outcome"], ["e1"]]);
  assert.deepEqual(projectTimelineHistory([scene]), [scene]);
  assert.equal(projectTimelineHistory([scene, jump]).length, 2, "missing commit");
  assert.equal(projectTimelineHistory([{ ...scene, round: 3, fromDate: "1912-01-30" }, jump]).length, 2, "not same day");
  assert.equal(projectTimelineHistory([scene, { ...sameDay, mode: "gm" }, jump]).length, 3);
});

test("N030: grouped completed pages do not re-stage or intervene across independent commits", () => {
  const source = readFileSync(new URL("./time.jsx", import.meta.url), "utf8");
  assert.match(source, /findTurnIndexOfEvent\(timelineHistory, eventId\)/);
  assert.match(source, /const displayedVisibleCount = !liveTurnRecord && \(olderTurnRecord \|\| displayRecord\?\.sceneAppendCount\) \? totalVisibleEvents : visibleEventCount/);
  assert.match(source, /const needsStaging = !latestTurnRecord\?\.sceneAppendCount && revealNeedsStaging/);
  assert.match(source, /canIntervene={!latestTurnRecord\?\.sceneAppendCount && canInterveneTurn/);
});
