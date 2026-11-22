/*!
 * Open Historia - Country Details: visible alternative-name management.
 * Native polity identity remains owned by useMapDocument / server/polityRename.
 */
import { useState } from "react";
import { EDITOR_CARD, inputStyle } from "./editorStyles.js";
import { planCountryAliasEdit } from "./countryAliasEdits.js";

const shell = {
  border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.14))",
  borderRadius: 12,
  padding: 12,
  background: EDITOR_CARD,
  display: "grid",
  gap: 9,
};
const label = { fontSize: 12.5, fontWeight: 700, color: "var(--oh-ui-text, #fff)" };
const hint = { fontSize: 11.5, lineHeight: 1.5, color: "var(--oh-ui-muted, rgba(255,255,255,0.66))" };
const button = {
  border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.18))",
  borderRadius: 8,
  padding: "7px 10px",
  background: "var(--oh-ui-raised, rgba(255,255,255,0.08))",
  color: "var(--oh-ui-text, #fff)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

const CountryAliases = ({ countryKey, countryName, record, polities, occupiedKeys, onChange }) => {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const aliases = Array.isArray(record?.aliases)
    ? record.aliases.filter((value) => typeof value === "string" && value.trim())
    : [];
  const formerNames = Array.isArray(record?.formerNames)
    ? record.formerNames.filter((value) => typeof value === "string" && value.trim())
    : [];

  const change = (action, value) => {
    const result = planCountryAliasEdit({
      countryKey, polities, occupiedKeys, alias: value, action,
    });
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    onChange?.(result.aliases);
    setError("");
    if (action === "add") setDraft("");
  };

  return (
    <section aria-label="Alternative names" style={shell}>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={label}>Alternative names</div>
        <div style={hint}>
          {`These names also identify ${countryName || countryKey}. They do not change its government, history, or ideology.`}
        </div>
      </div>

      {aliases.length ? (
        <div role="list" style={{ display: "grid", gap: 6 }}>
          {aliases.map((alias, index) => (
            <div key={`${alias}-${index}`} role="listitem" style={{
              display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between",
              border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.1))",
              borderRadius: 8, padding: "6px 7px",
            }}>
              <span style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>{alias}</span>
              <button type="button" onClick={() => change("remove", alias)}
                aria-label={`Remove alternative name ${alias}`}
                style={{ ...button, padding: "4px 7px", flexShrink: 0 }}>
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div style={hint}>No alternative names added.</div>
      )}

      <form onSubmit={(event) => {
        event.preventDefault();
        change("add", draft);
      }} style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
        <input value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }}
          aria-label="New alternative name" placeholder="New alternative name"
          style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
        <button type="submit" style={button}>Add</button>
      </form>

      {error && <div role="alert" style={{ fontSize: 12, color: "#fca5a5" }}>{error}</div>}
      <div style={hint}>
        The current country name works even when it is not listed as an alternative name.
      </div>
      {formerNames.length > 0 && (
        <div style={{ display: "grid", gap: 3 }}>
          <div style={label}>Former names recorded in the scenario</div>
          <div style={hint}>{formerNames.join(", ")}</div>
        </div>
      )}
    </section>
  );
};

export default CountryAliases;
