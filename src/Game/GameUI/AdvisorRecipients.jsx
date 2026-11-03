import React, { useState } from "react";
import { ADVISOR_PERSONALITY_MAX_CHARS, CHIEF_ADVISOR_THREAD } from "../../runtime/advisorThreads.js";

const field = {
  background: "rgba(0,0,0,0.22)", border: "1px solid rgba(255,255,255,0.17)",
  borderRadius: 7, boxSizing: "border-box", color: "#f8fafc",
  fontFamily: "inherit", fontSize: "0.76rem", padding: "0.42rem", width: "100%",
};
const subtle = { color: "rgba(255,255,255,0.5)", fontSize: "0.68rem" };
const button = {
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.17)",
  borderRadius: 7, color: "#e2e8f0", cursor: "pointer",
  fontFamily: "inherit", fontSize: "0.72rem", padding: "0.4rem 0.55rem",
};
const blank = () => ({ name: "", title: "", personality: "", binding: null, officeKey: "" });

export default function AdvisorRecipients({
  contacts, activeId, offices, statusOf, busy = false, onSelect, onCreate, onRevise, onArchive,
}) {
  const [expanded, setExpanded] = useState(false);
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(blank);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = contacts.find((item) => item.id === activeId);
  const visible = contacts.filter((item) => !item.archived || showArchived || item.id === activeId);
  const openEditor = (contact = null) => {
    if (busy || saving) return;
    setEditor(contact?.id || "new");
    setDraft(contact ? { name: contact.name, title: contact.title, personality: contact.personality || "", binding: contact.binding || null, officeKey: "" } : blank());
    setConfirmArchive("");
    setError("");
    setExpanded(true);
  };
  const chooseOffice = (key) => {
    const chosen = offices.find((item) => item.binding.office === key);
    if (!chosen) {
      setDraft((prev) => ({ ...prev, binding: null, officeKey: "" }));
    } else {
      setDraft((prev) => ({ ...prev, name: chosen.name, title: chosen.title, binding: chosen.binding, officeKey: key }));
    }
  };
  const submit = async () => {
    if (busy || saving) return;
    setSaving(true);
    setError("");
    try {
      if (editor === "new") await onCreate(draft);
      else await onRevise(editor, draft);
      setEditor(null);
    } catch (caught) {
      setError(String(caught?.message || caught));
    } finally {
      setSaving(false);
    }
  };
  const retire = async (contact, archived) => {
    if (busy || saving) return;
    if (archived && confirmArchive !== contact.id) {
      setConfirmArchive(contact.id);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onArchive(contact.id, archived);
      setConfirmArchive("");
      if (editor === contact.id) setEditor(null);
    } catch (caught) {
      setError(String(caught?.message || caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", flexShrink: 0, padding: "0.4rem 0.65rem" }} aria-label="Advisor conversations">
      <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
        <button type="button" onClick={() => setExpanded((old) => !old)} style={{ ...button, flex: 1, textAlign: "left" }}>
          {selected ? selected.name : "Chief advisor"} {selected?.archived ? "(retired)" : ""} {expanded ? "▴" : "▾"}
        </button>
        <button type="button" disabled={busy || saving} onClick={() => openEditor()} title="Add an official or advisor" style={{ ...button, opacity: busy ? 0.5 : 1 }} aria-label="Add advisor recipient">+ Contact</button>
      </div>
      {selected && <div style={{ ...subtle, marginTop: 3 }}>{selected.title}{selected.binding ? " · Political World" : ""}</div>}
      {expanded && (
        <div style={{ maxHeight: "min(58vh, 410px)", overflowY: "auto", paddingTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
          <button type="button" disabled={busy || saving} onClick={() => { onSelect(CHIEF_ADVISOR_THREAD); setEditor(null); }} style={{ ...button, textAlign: "left", background: activeId === CHIEF_ADVISOR_THREAD ? "rgba(59,130,246,0.24)" : button.background }}>
            Chief advisor <span style={subtle}>· Original conversation</span>
          </button>
          {visible.map((contact) => {
            const officeStatus = statusOf(contact);
            return (
              <div key={contact.id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <button type="button" disabled={busy || saving} onClick={() => { onSelect(contact.id); setEditor(null); }} style={{ ...button, flex: 1, minWidth: 0, textAlign: "left", background: activeId === contact.id ? "rgba(59,130,246,0.24)" : button.background }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{contact.name} {contact.archived ? "· Retired" : ""}</div>
                  <div style={subtle}>{contact.title}{["changed", "vacant"].includes(officeStatus) ? " · No longer in office" : ""}</div>
                </button>
                <button type="button" disabled={busy || saving} title={"Edit " + contact.name} onClick={() => openEditor(contact)} style={button}>Edit</button>
                <button type="button" disabled={busy || saving} title={contact.archived ? "Restore contact" : "Retire contact"} onClick={() => retire(contact, !contact.archived)} style={button}>
                  {contact.archived ? "Restore" : confirmArchive === contact.id ? "Confirm" : "Retire"}
                </button>
              </div>
            );
          })}
          {contacts.some((contact) => contact.archived) && (
            <button type="button" onClick={() => setShowArchived((old) => !old)} style={{ ...button, alignSelf: "flex-start" }}>
              {showArchived ? "Hide retired contacts" : "Show retired contacts"}
            </button>
          )}
          {editor && (
            <div style={{ border: "1px solid rgba(96,165,250,0.4)", borderRadius: 9, display: "flex", flexDirection: "column", gap: 7, padding: 9 }}>
              <strong style={{ fontSize: "0.75rem" }}>{editor === "new" ? "Add recipient" : "Edit recipient"}</strong>
              {editor === "new" && (
                <label style={subtle}>Link to Political World (optional)
                  <select style={field} value={draft.officeKey || ""} disabled={busy || saving} onChange={(event) => chooseOffice(event.target.value)}>
                    <option value="">Independent / custom official</option>
                    {offices.map((office) => <option key={office.binding.office} value={office.binding.office}>{office.title}: {office.name}</option>)}
                  </select>
                </label>
              )}
              <label style={subtle}>Name
                <input style={field} maxLength={100} readOnly={Boolean(draft.binding)} title={draft.binding ? "Linked officeholder identity is fixed" : undefined} value={draft.name} onChange={(event) => setDraft((old) => ({ ...old, name: event.target.value }))} />
              </label>
              <label style={subtle}>Government position
                <input style={field} maxLength={120} value={draft.title} onChange={(event) => setDraft((old) => ({ ...old, title: event.target.value }))} />
              </label>
              <label style={subtle}>Personality and principles
                <textarea style={{ ...field, minHeight: 64, resize: "vertical" }} maxLength={ADVISOR_PERSONALITY_MAX_CHARS} value={draft.personality} onChange={(event) => setDraft((old) => ({ ...old, personality: event.target.value }))} placeholder="e.g. meticulous, cautious with public spending, willing to disagree" />
                <div data-no-translate style={{ color: draft.personality.length >= ADVISOR_PERSONALITY_MAX_CHARS ? "#f87171" : "rgba(255,255,255,0.5)", fontSize: "0.7rem", marginTop: "0.25rem", textAlign: "right" }}>
                  {draft.personality.length}/{ADVISOR_PERSONALITY_MAX_CHARS}
                </div>
              </label>
              {draft.binding && <div style={subtle}>Linked to {draft.binding.office === "headOfGovernment" ? "head of government" : "head of state"}: {draft.binding.name}. A replacement will not inherit this conversation.</div>}
              {error && <div role="alert" style={{ color: "#fca5a5", fontSize: "0.72rem" }}>{error}</div>}
              <div style={{ display: "flex", gap: 7 }}>
                <button type="button" disabled={busy || saving || !draft.name.trim() || !draft.title.trim()} onClick={submit} style={button}>{saving ? "Saving…" : "Save recipient"}</button>
                <button type="button" disabled={saving} onClick={() => { setEditor(null); setError(""); }} style={button}>Cancel</button>
              </div>
            </div>
          )}
          {!editor && error && <div role="alert" style={{ color: "#fca5a5", fontSize: "0.72rem" }}>{error}</div>}
        </div>
      )}
    </section>
  );
}
