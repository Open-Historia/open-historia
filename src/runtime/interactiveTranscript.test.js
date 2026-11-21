/*! Open Historia - interactive transcript archive regressions. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { archiveInteractiveScene, attachInteractiveTranscript, interactiveTranscriptIsComplete, normalizeInteractiveTranscript, MAX_INTERACTIVE_TRANSCRIPT_BEATS, MAX_INTERACTIVE_TRANSCRIPT_CHARS } from "./interactiveTranscript.js";
import { openInteractive, recordInteractiveBeat, rewindInteractive } from "../Game/AI/interactiveRewind.js";
import { allocateCanonicalTurnEventIds } from "./eventIdentity.js";

const start = () => ({
  ...openInteractive({ title: "The telegram", premise: "A choice", opening: "A minister enters.", choices: ["Read it", "Wait"] }),
  origin: "player", fromEventId: "source", startedOn: "1912-01-01", request: "Demand evidence.",
});
const move = (scene, choice, summary, nextChoices = []) => recordInteractiveBeat(scene, { choice, summary, nextChoices });

test("N030: manual End preserves the accepted branch, its opening, angle, prior screens and options", () => {
  const first = move(start(), "Read it", "He reads a letter.", ["Ask for proof", "Dismiss him"]);
  const discarded = move(first, "Dismiss him", "He leaves.", ["Wait", "Return"]);
  const accepted = move(rewindInteractive(discarded, 1), "My custom choice", "He presents proof.", ["Read it aloud", "Sign"]);
  const transcript = archiveInteractiveScene(accepted);
  assert.equal(transcript.endedBy, "player");
  assert.equal(transcript.sourceEventId, "source");
  assert.equal(transcript.request, "Demand evidence.");
  assert.equal(transcript.firstOpening, "A minister enters.");
  assert.deepEqual(transcript.beats, accepted.history);
  assert.ok(interactiveTranscriptIsComplete(transcript));
  assert.doesNotMatch(JSON.stringify(transcript), /He leaves\./);
  assert.deepEqual(normalizeInteractiveTranscript(JSON.parse(JSON.stringify(transcript))), transcript);
  accepted.history[0].offered.push("New");
  assert.deepEqual(transcript.beats[0].offered, ["Read it", "Wait"]);
});

test("N030: auto End includes the final chosen move and its offered screen", () => {
  const first = move(start(), "Read it", "A letter is produced.", ["Accept", "Reject"]);
  const final = move(first, "Reject", "The minister departs.");
  const transcript = archiveInteractiveScene(final, "scene");
  assert.equal(transcript.endedBy, "scene");
  assert.deepEqual(transcript.beats[1], { choice: "Reject", summary: "The minister departs.", before: "A letter is produced.", offered: ["Accept", "Reject"] });
  assert.ok(interactiveTranscriptIsComplete(transcript));
});

test("N030: legacy scene data remains incomplete; no screen text/restored choices are invented", () => {
  const archive = archiveInteractiveScene({ title: "Old", history: [{ choice: "Wait", summary: "Later." }] });
  assert.deepEqual(archive.beats, [{ choice: "Wait", summary: "Later." }]);
  assert.equal(archive.firstOpening, "");
  assert.equal(interactiveTranscriptIsComplete(archive), false);
  assert.equal(normalizeInteractiveTranscript({ ...archive, beats: [{ choice: {}, summary: "" }] }), null);
  assert.throws(() => archiveInteractiveScene(start()), /could not be recorded/);
});

test("N030: archive limits reject an oversized scene without truncating accepted history", () => {
  const scene = move(start(), "Wait", "Then.");
  const archive = archiveInteractiveScene(scene);
  assert.equal(normalizeInteractiveTranscript({ ...archive, beats: Array(MAX_INTERACTIVE_TRANSCRIPT_BEATS + 1).fill(archive.beats[0]) }), null);
  assert.equal(normalizeInteractiveTranscript({ ...archive, request: "x".repeat(MAX_INTERACTIVE_TRANSCRIPT_CHARS) }), null);
  assert.throws(() => archiveInteractiveScene({ ...scene, history: [{ ...scene.history[0], summary: "x".repeat(MAX_INTERACTIVE_TRANSCRIPT_CHARS) }] }), /size and shape limits/);
});

test("N030: attach only to the allocated outcome, not the later espionage event; no duplicate application", () => {
  const archive = archiveInteractiveScene(move(start(), "Wait", "Then."), "scene");
  const original = { id: "source", kind: "world", title: "A crisis" };
  const { events: allocated, idMap } = allocateCanonicalTurnEventIds({ existingEvents: [original], newEvents: [{ id: "temporary", kind: "interactive", title: "Result", date: "1912-01-01" }], round: 2 });
  const id = idMap.get("temporary");
  const espionage = { id: "espionage", kind: "world", title: "Another event" };
  const events = [original, ...allocated, espionage];
  const attached = attachInteractiveTranscript(events, id, archive);
  assert.deepEqual(attached[1].interactiveTranscript, archive);
  assert.equal(attached[0], original);
  assert.equal(attached[2], espionage);
  assert.equal("interactiveTranscript" in events[1], false);
  assert.throws(() => attachInteractiveTranscript(attached, id, archive), /unique new interactive event/);
  assert.throws(() => attachInteractiveTranscript(events, "missing", archive), /unique new interactive event/);
  assert.throws(() => attachInteractiveTranscript(events, "espionage", archive), /unique new interactive event/);
  assert.throws(() => attachInteractiveTranscript([...events, allocated[0]], id, archive), /unique new interactive event/);
  // Undo restores the exact earlier event array, so there is no orphan sidecar.
  assert.equal([original].some((event) => event.interactiveTranscript), false);
});

test("N030: native completion uses the full recorded final beat and archives at canonical publication", () => {
  const source = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8");
  const resolve = source.slice(source.indexOf("const resolveInteractiveScene ="), source.indexOf("const SCENE_REVIEW_SECTIONS"));
  const advance = source.slice(source.indexOf("export const advanceActiveInteractive ="), source.indexOf("// Generate the jump one segment"));
  assert.match(advance, /interactive: nextInteractive,\s*history: nextInteractive\.history,\s*endedBy: "scene"/);
  assert.match(resolve, /archiveInteractiveScene\(\{ \.\.\.interactive, history \}, endedBy\)/);
  assert.match(resolve, /sceneArchive: \{ outcomeId: sceneOutcome\.id, transcript \}/);
  const publish = source.indexOf("nextEvents = attachInteractiveTranscript(");
  const commit = source.indexOf("await writeCanonicalTurnState({", publish);
  assert.ok(publish > 0 && commit > publish);
  assert.match(source.slice(publish, commit), /dedupeEventLog\(normalizeEvents\(nextEvents\)\)/);
  assert.match(source, /const \{ npcReaction, interactiveTranscript: _interactiveTranscript, \.\.\.generated \} = normalized/);
});
