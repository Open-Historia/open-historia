/*! Open Historia — the host's words about a line, under it in its conversation © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// In a shared game, what the host says about a line the player wrote (nobody
// answers it this round, the player it is to is away, the host's AI could not
// answer it) is shown under that line for as long as it is the newest there
// (multiplayer/client/threadNotes.js). Before, it was a word on the round bar
// for 8 seconds, away from where the player wrote. A failure offers Retry,
// which asks the host to have the governments answer the line again.

import React, { useSyncExternalStore } from "react";
import { sharedNotices, subscribeSharedGameRole } from "../../multiplayer/client/sharedGameBridge.js";
import { threadNotesFor } from "../../multiplayer/client/threadNotes.js";

export default function SharedThreadNotes({ thread, lastLine, onRetry = null, busy = false }) {
  const notices = useSyncExternalStore(subscribeSharedGameRole, sharedNotices, sharedNotices);
  const notes = threadNotesFor(notices, { thread, lastLine });
  if (!notes.length) return null;
  return (
    <div data-shared-thread-notes="true" style={{ display: "flex", flexDirection: "column", gap: ".3rem", margin: ".35rem auto .2rem", maxWidth: "min(88%, 40rem)" }}>
      {notes.map((note) => (
        <div
          key={note.text}
          role={note.level === "warn" ? "alert" : "status"}
          style={{
            alignItems: "center", background: note.level === "warn" ? "rgba(239,68,68,.08)" : "rgba(255,255,255,.04)",
            border: `1px solid ${note.level === "warn" ? "rgba(239,68,68,.25)" : "rgba(255,255,255,.1)"}`, borderRadius: 10,
            color: note.level === "warn" ? "#fca5a5" : "rgba(255,255,255,.62)", display: "flex", flexWrap: "wrap", fontSize: ".62rem",
            gap: ".45rem", justifyContent: "center", lineHeight: 1.45, padding: ".38rem .6rem", textAlign: "center", unicodeBidi: "isolate",
          }}
        >
          <span>{note.text}</span>
          {note.level === "warn" && onRetry ? (
            <button
              type="button"
              className="oh-tap-row"
              disabled={busy}
              onClick={onRetry}
              style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 8, color: "rgba(246,246,248,.9)", cursor: busy ? "wait" : "pointer", fontSize: ".58rem", fontWeight: 760, padding: ".22rem .5rem" }}
            >
              Retry
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
