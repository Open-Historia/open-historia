/*! Open Historia — the host's choices of who pays, and of the Game Master, in Host a lobby © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Beside the other settings of ui/LobbiesTab.jsx's Host a lobby, in its grid:
//   - who pays for each round's request (host/settings.js `payment`): the host,
//     or each player's device in turn, with what the paying device sees, said
//     plainly (the owner's words, decision 14);
//   - with each player's own AI answering, how many answers of the host's AI
//     each player has a round from a government whose answer can act
//     (`hostAnswers`), none unless the host says;
//   - whether the host may use the Game Master (`cheats`), which every player's
//     lobby says (decision 8).
// Then the lines every player will read under "Who pays" (multiplayer/costRules.js).

import React from "react";
import { HOST_ANSWER_CHOICES, costRulesOf } from "../costRules.js";

const label = { color: "rgba(255,255,255,0.72)", display: "block", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.04em", marginBottom: "0.4rem", textTransform: "uppercase" };
const input = { background: "var(--oh-ui-overlay-card, rgba(255,255,255,0.04))", border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.1))", borderRadius: "9px", color: "#f8fafc", fontSize: "0.9rem", outline: "none", padding: "0.7rem 0.85rem", width: "100%", boxSizing: "border-box" };
const note = { color: "rgba(255,255,255,0.55)", fontSize: "0.78rem", lineHeight: 1.5, margin: "0.35rem 0 0" };

const Field = ({ title, hint, children }) => (
  <label style={{ display: "block" }}>
    <span style={label}>{title}</span>
    {children}
    {hint ? <span style={{ ...note, display: "block" }}>{hint}</span> : null}
  </label>
);

export const HostCostFields = ({ settings, setSettings }) => {
  const set = (key, value) => setSettings((previous) => ({ ...previous, [key]: value }));
  return (
    <>
      <Field
        title="Each round's AI request is paid by"
        hint={settings.payment === "cycle" ? "The paying player's device sees that round's whole request, every player's orders and secrets included, and could change what happens in that round. A player whose device has no AI that can make the request is passed over, and your AI pays when nobody else can." : undefined}
      >
        <select style={input} value={settings.payment} onChange={(event) => set("payment", event.target.value)}>
          <option value="host">Your AI key</option>
          <option value="cycle">Each player&apos;s own AI key, in turn</option>
        </select>
      </Field>
      {settings.replies === "own" ? (
        <Field title="Your AI answers each player, a round" hint="For a government whose answer can act: one at war with them, their overlord or puppet, an institution. Past this, the round reads what they write.">
          <select style={input} value={String(settings.hostAnswers ?? 0)} onChange={(event) => set("hostAnswers", Number(event.target.value))}>
            {HOST_ANSWER_CHOICES.map((count) => <option key={count} value={String(count)}>{count === 0 ? "None" : count === 1 ? "1 message" : `${count} messages`}</option>)}
          </select>
        </Field>
      ) : null}
      <Field title="Game Master" hint={settings.cheats === "host" ? "Every change it makes is told to every player and listed in the lobby." : undefined}>
        <select style={input} value={settings.cheats === "host" ? "host" : "off"} onChange={(event) => set("cheats", event.target.value)}>
          <option value="off">Off</option>
          <option value="host">You may use it</option>
        </select>
      </Field>
    </>
  );
};

// What every player will read under "Who pays", below the form.
export const HostCostSummary = ({ settings }) => (
  <div style={{ marginTop: "0.8rem" }}>
    <span style={label}>Who pays, as every player is told</span>
    {costRulesOf(settings).map((line) => <p key={line} style={note}>{line}</p>)}
  </div>
);
