/*! Open Historia - completed scene transcripts. AGPL-3.0-or-later (see LICENSE). */
// Historical presentation only. The owning event is the outcome, not a second
// simulation record. Nothing in this attachment is an executable impact.
export const MAX_INTERACTIVE_TRANSCRIPT_BEATS = 256;
export const MAX_INTERACTIVE_TRANSCRIPT_CHARS = 512 * 1024;
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string";
const filled = (value) => text(value) && Boolean(value.trim());

// Copy the accepted words, not another model's reconstruction. Missing screen
// text/choices in older live saves remain absent. Never truncate a played beat.
export const normalizeInteractiveTranscript = (value) => {
  if (!record(value) || value.version !== 1 || !["scene", "player"].includes(value.endedBy)) return null;
  const fields = ["sourceEventId", "startedOn", "title", "premise", "firstOpening", "request"];
  if (!fields.every((key) => text(value[key]))) return null;
  if (!Array.isArray(value.beats) || !value.beats.length || value.beats.length > MAX_INTERACTIVE_TRANSCRIPT_BEATS) return null;
  const beats = [];
  for (const beat of value.beats) {
    if (!record(beat) || !text(beat.choice) || !text(beat.summary) || (!filled(beat.choice) && !filled(beat.summary))) return null;
    if (beat.before !== undefined && !text(beat.before)) return null;
    if (beat.offered !== undefined && (!Array.isArray(beat.offered) || beat.offered.length > 5 || !beat.offered.every(text))) return null;
    beats.push({
      choice: beat.choice,
      summary: beat.summary,
      ...(text(beat.before) ? { before: beat.before } : {}),
      ...(Array.isArray(beat.offered) ? { offered: [...beat.offered] } : {}),
    });
  }
  const archive = {
    version: 1,
    ...Object.fromEntries(fields.map((key) => [key, value[key]])),
    endedBy: value.endedBy,
    beats,
  };
  return JSON.stringify(archive).length <= MAX_INTERACTIVE_TRANSCRIPT_CHARS ? archive : null;
};

export const interactiveTranscriptIsComplete = (archive) => Boolean(archive
  && filled(archive.sourceEventId) && filled(archive.startedOn)
  && filled(archive.title) && filled(archive.premise) && filled(archive.firstOpening)
  && archive.beats.every((beat) => filled(beat.choice) && filled(beat.summary)
    && filled(beat.before) && Array.isArray(beat.offered) && beat.offered.length > 0
    && beat.offered.every(filled)));

// The live scene already owns the accepted branch. Calling this before accepting
// another beat also makes the archive limit explicit rather than losing moves
// at the end of a long scene. Older incomplete beats retain their actual fields.
export const archiveInteractiveScene = (scene, endedBy = "player") => {
  const asText = (value) => text(value) ? value : "";
  const archive = normalizeInteractiveTranscript({
    version: 1,
    sourceEventId: asText(scene?.fromEventId),
    startedOn: asText(scene?.startedOn),
    title: asText(scene?.title),
    premise: asText(scene?.premise),
    firstOpening: asText(scene?.firstOpening),
    request: asText(scene?.request),
    endedBy,
    beats: scene?.history,
  });
  if (!archive) throw new Error("The interactive transcript could not be recorded within its size and shape limits. No new move was saved; end the scene at an earlier accepted move or take a move back.");
  return archive;
};

// The ordinary event de-duplicator still decides what is a duplicate. Reject a
// write that would silently discard an accepted archive rather than relax it.
export const assertInteractiveTranscriptsRetained = (before, after) => {
  const archived = (Array.isArray(before) ? before : []).filter(event => event?.interactiveTranscript);
  if (!archived.length) return;
  const byId = new Map(after.filter(event => event?.interactiveTranscript).map(event => [event.id, event.interactiveTranscript]));
  for (const event of archived) {
    if (JSON.stringify(byId.get(event.id)) !== JSON.stringify(normalizeInteractiveTranscript(event.interactiveTranscript))) {
      throw new Error("This change would discard a completed interactive transcript. Keep its outcome distinct, or explicitly delete that event.");
    }
  }
};

// A stable, native outcome id after canonical event-id allocation. Refuse an
// ambiguous/missing owner; never attach to the last event (espionage may follow).
export const attachInteractiveTranscript = (events, eventId, archive) => {
  const normalized = normalizeInteractiveTranscript(archive);
  if (!normalized || !filled(eventId)) throw new Error("The completed scene has no valid transcript or outcome id.");
  const matches = events.filter((event) => event?.id === eventId);
  if (matches.length !== 1 || matches[0].kind !== "interactive" || matches[0].interactiveTranscript !== undefined) {
    throw new Error("The scene's outcome is not a unique new interactive event; nothing was recorded.");
  }
  return events.map((event) => event.id === eventId ? { ...event, interactiveTranscript: normalized } : event);
};
