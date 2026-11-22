/*!
 * Scenario starting bilateral score editor. Treaty/puppet authoring is separate.
 * Only deliberate Save/Clear actions reach the caller; draft typing is local.
 */
import { useState } from "react";
import { inputStyle, pillButton } from "./editorStyles.js";
import { relationBandForScore } from "../runtime/diplomaticStance.js";

export default function StartingRelationsFields({
  owner = "", choices = [], rows = [], onSave, onClear, disabled = false,
}) {
  const [other, setOther] = useState("");
  const [score, setScore] = useState("");
  const [error, setError] = useState("");
  const validChoices = (Array.isArray(choices) ? choices : []).filter(
    (choice) => choice.key && choice.key !== owner,
  );
  const names = new Map(validChoices.map((choice) => [choice.key, choice.name || choice.key]));
  const current = Array.isArray(rows) ? rows : [];
  const choose = (counterpart, value) => {
    setOther(counterpart);
    setScore(String(value));
    setError("");
  };
  const save = () => {
    if (!other || !names.has(other)) {
      setError("Choose an existing counterpart polity.");
      return;
    }
    if (!/^-?(?:0|[1-9]\d{0,2})$/.test(score) || !Number.isInteger(Number(score)) || Number(score) < -100 || Number(score) > 100) {
      setError("Enter a whole score from -100 to +100, including 0 for explicit neutrality.");
      return;
    }
    const result = onSave?.(other, score);
    if (result?.ok === false) {
      setError(result.reason);
      return;
    }
    setOther("");
    setScore("");
    setError("");
  };
  const clear = (counterpart) => {
    const result = onClear?.(counterpart);
    if (result?.ok === false) setError(result.reason);
    else if (other === counterpart) { setOther(""); setScore(""); setError(""); }
  };
  return (
    <div style={{ display: "grid", gap: 10 }} aria-label="Starting diplomatic relations">
      <div style={{ fontSize: 12.5, fontWeight: 800 }}>Starting diplomatic relations</div>
      <div style={{ fontSize: 11, color: "var(--oh-ui-muted, #b6b6c0)", lineHeight: 1.45 }}>
        One bilateral score per pair (-100 to +100). This is separate from overlord status. Unset means
        no authored relationship; 0 is an explicitly neutral relationship. Treaties and agreements belong
        in the Scenario Editor.
      </div>
      {current.length > 0 ? (
        <div style={{ display: "grid", gap: 5 }}>
          {current.map((row) => (
            <div key={row.other} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "5px 7px", border: "1px solid var(--oh-ui-line, rgba(255,255,255,.12))", borderRadius: 8 }}>
              <span style={{ flex: 1, minWidth: 110, fontSize: 12 }}>{names.get(row.other) || row.other}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--oh-ui-text, #fff)" }}>{Number(row.score) > 0 ? "+" : ""}{row.score}</span>
              <span style={{ fontSize: 10.5, color: "var(--oh-ui-muted, #b6b6c0)" }}>{relationBandForScore(row.score)}</span>
              <button type="button" style={pillButton(false)} disabled={disabled || !names.has(row.other)} onClick={() => choose(row.other, row.score)}>Edit</button>
              <button type="button" style={pillButton(false)} disabled={disabled || !names.has(row.other)} onClick={() => clear(row.other)} title="Remove the authored score, not set it to zero">Unset</button>
            </div>
          ))}
        </div>
      ) : <span style={{ fontSize: 11.5, color: "var(--oh-ui-muted, #b6b6c0)" }}>No starting diplomatic scores authored for this polity.</span>}
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        Counterpart polity
        <select aria-label="Diplomatic counterpart" value={other} disabled={disabled || !validChoices.length} onChange={(event) => { setOther(event.target.value); setError(""); }} style={inputStyle}>
          <option value="">Choose polity</option>
          {validChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.name || choice.key}</option>)}
        </select>
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        Relationship score (-100 to +100)
        <input type="number" min="-100" max="100" step="1" inputMode="numeric" aria-label="Starting diplomatic score" disabled={disabled}
          value={score} placeholder="Unset (enter 0 for neutral)"
          onChange={(event) => { setScore(event.target.value); setError(""); }} style={inputStyle} />
      </label>
      <button type="button" style={pillButton(true)} disabled={disabled || !other || !score.trim()} onClick={save}>
        {current.some((row) => row.other === other) ? "Update starting score" : "Add starting score"}
      </button>
      {error && <div role="alert" style={{ fontSize: 11.5, color: "#fca5a5" }}>{error}</div>}
    </div>
  );
}
