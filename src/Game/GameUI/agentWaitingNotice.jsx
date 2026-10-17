/*! Open Historia — the notice that a chat waits on the player's own Agent © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the player started that now waits on their own Agent
// (docs/adr/0008-subscription-agents-answer-through-the-game.md): an advisor
// message, a diplomatic reply, a Game Master command, an interactive event.
// Nothing happens until they type /answer in their Agent, so the notice stays
// until it is answered, and offers the way out: the Agent folder, the next
// entry of the Fallback list (Use API key), or Cancel. A time skip says the
// same in its own progress row (time.jsx).

import React, { useSyncExternalStore } from "react";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { agentClient, openAgentFolder } from "../AI/agentConnection.js";
import { AGENT_KINDS, agentHasEntryBelow } from "../AI/providerConfig.js";
import { REQUEST_AGENT, requestActivity } from "../AI/requestActivity.js";

// One short line each, at the top of the screen where the game's other notices
// are (fallbackSwitchNotice.jsx), so it never covers the map.
const WAITING_TEXTS = {
  advisor: "Your advisor's reply is waiting for your Agent: type /answer",
  diplomacy: "A diplomatic reply is waiting for your Agent: type /answer",
  gameMaster: "Your Game Master command is waiting for your Agent: type /answer",
  interactive: "Your interactive event is waiting for your Agent: type /answer",
  skip: "Your time skip's last step is waiting for your Agent: type /answer",
};

const noticeStyle = {
  position: "fixed",
  top: "4.25rem",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "0.5rem 0.7rem",
  maxWidth: "min(42rem, calc(100vw - 2rem))",
  padding: "0.6rem 0.85rem",
  borderRadius: "12px",
  // The colours of the game's other notices (fallbackSwitchNotice.jsx).
  border: "1px solid rgba(96,165,250,0.32)",
  backgroundColor: "rgba(16,21,24,0.96)",
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  color: "#dbeafe",
  fontFamily: "sans-serif",
  fontSize: "0.8rem",
  lineHeight: 1.45,
  pointerEvents: "auto",
};

// As the game's other top notices sit on a phone: below the game-menu button.
const phoneNoticeStyle = { top: "4.75rem", width: "max-content" };

export const AGENT_BUTTON_STYLE = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: "8px",
  color: "white",
  cursor: "pointer",
  fontSize: "0.74rem",
  padding: "0.28rem 0.7rem",
  whiteSpace: "nowrap",
};

// Read as one string so the store's snapshot stays the same while nothing changes.
const readWaits = () => JSON.stringify(agentClient.waits());

export const AgentWaitingNotice = () => {
  const isMobile = useIsMobile();
  const waits = JSON.parse(useSyncExternalStore((listener) => agentClient.subscribeWaits(listener), readWaits, readWaits));
  // A skip waiting on the Agent says so in its own progress row; its follow-up
  // after the row has gone (the first stat-sheet reading) says so here.
  const skipShownInRow = requestActivity.current()?.state === REQUEST_AGENT;
  const kinds = AGENT_KINDS.filter((kind) => waits[kind] > 0 && !(kind === "skip" && skipShownInRow));
  if (!kinds.length) return null;
  const canPassOn = agentHasEntryBelow();
  return (
    <div role="status" aria-live="polite" style={{ ...noticeStyle, ...(isMobile ? phoneNoticeStyle : null) }}>
      <span aria-hidden="true" style={{ color: "#93c5fd", fontWeight: 800 }}>⏳</span>
      <span style={{ display: "flex", flexDirection: "column", flex: "1 1 14rem", minWidth: 0 }}>
        {kinds.map((kind) => <span key={kind}>{WAITING_TEXTS[kind]}</span>)}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
        <button type="button" className="oh-tap-row" style={AGENT_BUTTON_STYLE} onClick={() => { void openAgentFolder(); }}>Open the Agent folder</button>
        {canPassOn && (
          <button type="button" className="oh-tap-row" style={AGENT_BUTTON_STYLE} onClick={() => agentClient.passOn(kinds)}>Use API key</button>
        )}
        <button type="button" className="oh-tap-row" style={AGENT_BUTTON_STYLE} onClick={() => agentClient.cancel(kinds)}>Cancel</button>
      </div>
    </div>
  );
};
