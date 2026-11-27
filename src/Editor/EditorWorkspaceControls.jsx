/*!
 * Open Historia - shared management-workspace controls.
 * The panels use the existing theme, not a hardcoded workshop color scheme.
 */
import { inputStyle, pillButton, labelDim } from "./editorStyles.js";

export const workspaceCard = {
  background: "var(--oh-ui-raised, rgba(255,255,255,0.04))",
  border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.12))",
  borderRadius: 10, padding: 10,
};
export const workspaceMuted = { fontSize: 11, color: "var(--oh-ui-muted, #b4c4d0)", lineHeight: 1.45 };
export const workspaceRow = (active = false) => ({
  ...workspaceCard, padding: "8px 10px", minWidth: 0,
  borderColor: active ? "var(--oh-ui-focus, rgba(255,255,255,.36))" : "var(--oh-ui-line, rgba(255,255,255,.12))",
  background: active ? "var(--oh-ui-active, rgba(255,255,255,.1))" : "var(--oh-ui-raised, rgba(255,255,255,.04))",
});

export function WorkspaceHeading({ title, detail, children }) {
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
    <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
      <strong style={{ fontSize: 13 }}>{title}</strong>
      {detail && <span style={workspaceMuted}>{detail}</span>}
    </div>
    {children}
  </div>;
}
export function WorkspaceStats({ items }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, items.length)}, minmax(0, 1fr))`, gap: 6 }}>
    {items.map(({ label, value }) => <div key={label} style={workspaceCard}>
      <div style={{ fontSize: 16, fontWeight: 750, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={workspaceMuted}>{label}</div>
    </div>)}
  </div>;
}
export function WorkspaceSelect({ label, value, onChange, options, disabled = false }) {
  return <label style={{ display: "grid", gap: 4, minWidth: 0, flex: "1 1 135px" }}>
    <span style={labelDim}>{label}</span>
    <select aria-label={label} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, minWidth: 0, padding: "7px 8px", opacity: disabled ? 0.55 : 1 }}>
      {options.map(({ value: v, label: text }) => <option key={v} value={v}>{text}</option>)}
    </select>
  </label>;
}
export function WorkspaceSearch({ value, onChange, placeholder }) {
  return <input aria-label="Search workspace" value={value} onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder} style={{ ...inputStyle, padding: "9px 10px" }}/>;
}
export function WorkspaceTabs({ label = "Details", tabs, active, onChange }) {
  return <div role="tablist" aria-label={label} style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
    {tabs.map((tab) => <button type="button" role="tab" key={tab.id} aria-selected={active === tab.id}
      onClick={() => onChange(tab.id)} style={{ ...pillButton(active === tab.id), fontSize: 11, padding: "7px 9px" }}>
      {tab.label}
    </button>)}
  </div>;
}
export function WorkspaceActions({ children }) {
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>{children}</div>;
}
export function WorkspaceEmpty({ title, description, children }) {
  return <div style={{ ...workspaceCard, display: "grid", gap: 8, padding: 16, textAlign: "center" }}>
    <strong style={{ fontSize: 13 }}>{title}</strong>
    <span style={workspaceMuted}>{description}</span>
    {children}
  </div>;
}
export function WorkspaceMore({ shown, total, onMore }) {
  if (shown >= total) return null;
  return <button type="button" onClick={onMore} style={{ ...pillButton(false), padding: 9 }}>
    Show more ({(total - shown).toLocaleString()} remaining)
  </button>;
}
