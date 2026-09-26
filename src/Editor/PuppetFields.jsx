/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// The Countries panel's puppet-state fields for one polity: whose puppet it is
// (and how), or which puppets it holds. The rules and the row shape are
// scenarioPuppets.js's; the game reads the rows as world.puppets.

import { useState } from "react";
import { inputStyle } from "./editorStyles.js";
import {
  PUPPET_COUP_LOYALTY,
  PUPPET_KIND_OPTIONS,
  PUPPET_SECRECY_OPTIONS,
  overlordChoicesFor,
  overlordRowOf,
  patchPuppetRow,
  puppetRowsOf,
  setOverlord,
} from "./scenarioPuppets.js";

const label = { fontSize: 10.5, color: "rgba(255,255,255,0.48)", marginBottom: 4 };
const hint = { fontSize: 10.5, color: "rgba(255,255,255,0.45)", lineHeight: 1.4 };

const PuppetFields = ({ polity, regionCount = 0, choices = [], puppets = [], setPuppets }) => {
  const [error, setError] = useState("");
  const nameOf = (key) => choices.find((row) => row.key === key)?.name || key;
  const own = overlordRowOf(puppets, polity);
  const held = puppetRowsOf(puppets, polity);
  const options = overlordChoicesFor(puppets, polity, choices.map((row) => row.key));
  const kindLabel = (kind) => PUPPET_KIND_OPTIONS.find((option) => option.id === kind)?.label.toLowerCase() || "puppet state";

  const chooseOverlord = (overlord) => {
    const { puppets: next, error: refusal } = setOverlord(puppets, polity, overlord);
    setError(refusal);
    if (!refusal) setPuppets?.(next);
  };
  const patch = (fields) => setPuppets?.(patchPuppetRow(puppets, polity, fields));

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div>
        <div style={label}>Puppet of</div>
        <select
          value={own?.overlord || ""}
          onChange={(e) => chooseOverlord(e.target.value)}
          disabled={!own && !options.length}
          style={inputStyle}
        >
          <option value="">— independent —</option>
          {[...new Set([...(own?.overlord ? [own.overlord] : []), ...options])].map((key) => (
            <option key={key} value={key}>{nameOf(key)}</option>
          ))}
        </select>
      </div>
      {held.length > 0 && !own && (
        <div style={hint}>It holds puppets of its own, so it cannot be one.</div>
      )}
      {own && (
        <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 1fr" }}>
          <select value={own.kind || "satellite"} onChange={(e) => patch({ kind: e.target.value })} style={inputStyle} aria-label="Kind of subordination">
            {PUPPET_KIND_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <select value={own.secrecy === "covert" ? "covert" : "open"} onChange={(e) => patch({ secrecy: e.target.value })} style={inputStyle} aria-label="Openly known or covert">
            {PUPPET_SECRECY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <label style={{ ...hint, display: "flex", alignItems: "center", gap: 6, gridColumn: "1 / -1" }}>
            <span style={{ flexShrink: 0 }}>Loyalty</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Number.isFinite(Number(own.loyalty)) ? Number(own.loyalty) : 50}
              onChange={(e) => patch({ loyalty: Number(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ width: 26, textAlign: "right" }}>{Number.isFinite(Number(own.loyalty)) ? Number(own.loyalty) : 50}</span>
          </label>
          {Number(own.loyalty) < PUPPET_COUP_LOYALTY && (
            <div style={{ ...hint, gridColumn: "1 / -1", color: "#fbbf24" }}>
              This low, the puppet starts the game plotting against its overlord.
            </div>
          )}
          {own.secrecy === "covert" && (
            <div style={{ ...hint, gridColumn: "1 / -1" }}>Covert: only the two of them know, until someone's spies find out.</div>
          )}
          {regionCount === 0 && (
            <div style={{ ...hint, gridColumn: "1 / -1" }}>It holds no land yet: paint it some territory.</div>
          )}
        </div>
      )}
      {held.length > 0 && (
        <div style={hint}>
          Its puppets: {held.map((row) => `${nameOf(row.puppet)} (${kindLabel(row.kind)})`).join(", ")}
        </div>
      )}
      {error && <div style={{ ...hint, color: "#fca5a5" }}>{error}</div>}
    </div>
  );
};

export default PuppetFields;
