/*!
 * Government identity is authored here but stored only in Political World when
 * the scenario is saved. Form fields stage explicit changes; blank is not
 * treated as a generated government. No duplicate polity registry.
 */
import { governmentFieldsForPolity } from "./governmentIdentity.js";
import { inputStyle } from "./editorStyles.js";

export default function GovernmentIdentityFields({
  polity, actors = {}, edits = [], renames = [], onSave,
}) {
  const fields = governmentFieldsForPolity(actors, polity, edits, renames);
  const enabled = typeof onSave === "function";
  const update = (field, expected, entered) => {
    const next = String(entered ?? "").trim();
    if (next === String(expected ?? "").trim()) return;
    try {
      // An explicitly emptied field clears the canonical form on Apply. Never
      // fabricate an unspecified form merely because a field is visible.
      onSave?.(polity, { [field]: next || null });
    } catch (e) {
      window.alert(e?.message || String(e));
    }
  };
  return (
    <section aria-label="Starting government identity" style={{
      display: "grid", gap: 9,
      padding: "11px 12px", borderRadius: 10,
      border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.12))",
      background: "var(--oh-ui-raised, rgba(255,255,255,0.035))",
    }}>
      <strong style={{ fontSize: 12.5 }}>Starting government identity</strong>
      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--oh-ui-muted, rgba(255,255,255,0.67))" }}>
        {fields.hasActor
          ? "Existing Political World government. Changes are staged for Save / Apply."
          : "No existing Political World actor. Enter an explicit government form to establish one when the scenario is saved."}
        {" "}Political World remains the source of truth; no political actor is created until Save / Apply.
      </div>
      {[
        { id: "form", title: "Government form", placeholder: "e.g. Constitutional monarchy" },
        { id: "ideology", title: "Government ideology", placeholder: "Unspecified" },
      ].map(({ id, title, placeholder }) => (
        <label key={id} style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11.5, color: "var(--oh-ui-muted, rgba(255,255,255,0.72))" }}>{title}</span>
          <input
            key={polity + ":" + id + ":" + String(fields[id])}
            defaultValue={fields[id]}
            aria-label={title}
            type="text"
            maxLength={160}
            placeholder={placeholder}
            disabled={!enabled}
            onBlur={(event) => update(id, fields[id], event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            style={inputStyle}
          />
        </label>
      ))}
      {fields.staged && <span style={{ fontSize: 11, color: "var(--oh-ui-muted, rgba(255,255,255,0.62))" }}>
        Government change staged. Save / Apply writes it into the scenario's Political World.
      </span>}
    </section>
  );
}
