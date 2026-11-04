import React, { useState } from "react";
import { ADVISOR_PERSONALITY_MAX_CHARS, ADVISOR_RECIPIENT_TYPES, ADVISOR_RECIPIENT_TYPE_LABELS, CHIEF_ADVISOR_THREAD, advisorRecipientType } from "../../runtime/advisorThreads.js";

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
const blank = () => ({ name: "", title: "", personality: "", recipientType: ADVISOR_RECIPIENT_TYPES.MINISTER, binding: null, officeKey: "" });

export default function AdvisorRecipients({
  contacts, activeId, chiefProfile, offices, statusOf, busy = false, onSelect, onCreate, onRevise, onArchive, onSaveChief, onResetChief,
}) {
  const [expanded, setExpanded] = useState(false);
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(blank);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = contacts.find((item) => item.id === activeId);
  const chiefName = chiefProfile?.name || "Chief advisor";
  const chiefTitle = chiefProfile?.title || "Chief advisor";
  const visible = contacts.filter((item) => !item.archived || showArchived || item.id === activeId);
  const openEditor = (contact = null) => {
    if (busy || saving) return;
    setEditor(contact?.id || "new");
    setDraft(contact ? { name: contact.name, title: contact.title, personality: contact.personality || "", recipientType: advisorRecipientType(contact) || "", binding: contact.binding || null, officeKey: "" } : blank());
    setConfirmArchive("");
    setError("");
    setExpanded(true);
  };
  const openChiefEditor = () => {
    if (busy || saving) return;
    setEditor("chief");
    setDraft({
      name: chiefName, title: chiefTitle, personality: chiefProfile?.personality || "",
      binding: null, officeKey: "",
    });
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
      else if (editor === "chief") await onSaveChief(draft);
      else await onRevise(editor, draft);
      setEditor(null);
    } catch (caught) {
      setError(String(caught?.message || caught));
    } finally {
      setSaving(false);
    }
  };
  const retire = async (contact, archived) => {
    if (busy || saving || (archived && confirmArchive !== contact.id)) return;
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
  const resetChief = async () => {
    if (busy || saving) return;
    setSaving(true);
    setError("");
    try {
      await onResetChief();
      setEditor(null);
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
          {selected ? selected.name : chiefName} {selected?.archived ? "(retired)" : ""} {expanded ? "▴" : "▾"}
        </button>
        <button type="button" disabled={busy || saving} onClick={() => openEditor()} title="Add an official or advisor" style={{ ...button, opacity: busy ? 0.5 : 1 }} aria-label="Add advisor recipient">+ Contact</button>
      </div>
      {(selected || chiefProfile) && <div style={{ ...subtle, marginTop: 3 }}>{selected ? selected.title : chiefTitle}{selected?.binding ? " · Political World" : ""}</div>}
      {selected && advisorRecipientType(selected) !== ADVISOR_RECIPIENT_TYPES.MINISTER && (
        <div role="status" style={{ ...subtle, marginTop: 5 }}>
          This character uses only the public scenario timeline and their own conversation history. Private government records and diplomacy are not shared.
        </div>
      )}
      {expanded && (
        <div style={{ maxHeight: "min(58vh, 410px)", overflowY: "auto", paddingTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <button type="button" disabled={busy || saving} onClick={() => { onSelect(CHIEF_ADVISOR_THREAD); setEditor(null); setConfirmArchive(""); }} style={{ ...button, flex: 1, minWidth: 0, textAlign: "left", background: activeId === CHIEF_ADVISOR_THREAD ? "rgba(59,130,246,0.24)" : button.background }}>
              {chiefName} <span style={subtle}>· Original conversation</span>
              {chiefProfile && <div style={subtle}>{chiefTitle}</div>}
            </button>
            <button type="button" disabled={busy || saving} title="Edit chief advisor" onClick={openChiefEditor} style={button}>Edit</button>
          </div>
          {visible.map((contact) => {
            const officeStatus = statusOf(contact);
            return (
              <div key={contact.id} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <button type="button" disabled={busy || saving} onClick={() => { onSelect(contact.id); setEditor(null); setConfirmArchive(""); }} style={{ ...button, flex: 1, minWidth: 0, textAlign: "left", background: activeId === contact.id ? "rgba(59,130,246,0.24)" : button.background }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{contact.name} {contact.archived ? "· Retired" : ""}</div>
                    <div style={subtle}>{contact.title} · {ADVISOR_RECIPIENT_TYPE_LABELS[advisorRecipientType(contact)] || "Unsupported recipient type"}{["changed", "vacant"].includes(officeStatus) ? " · No longer in office" : ""}</div>
                  </button>
                  <button type="button" disabled={busy || saving} title={"Edit " + contact.name} onClick={() => openEditor(contact)} style={button}>Edit</button>
                  <button type="button" disabled={busy || saving} title={contact.archived ? "Restore contact" : "Retire contact"} onClick={() => contact.archived ? retire(contact, false) : (setConfirmArchive(contact.id), setError(""))} style={button}>
                    {contact.archived ? "Restore" : "Retire"}
                  </button>
                </div>
                {confirmArchive === contact.id && !contact.archived && (
                  <div role="alertdialog" aria-label={`Retire ${contact.name}?`} style={{ border: "1px solid rgba(248,113,113,0.5)", borderRadius: 8, padding: 10, background: "rgba(127,29,29,0.14)", display: "flex", flexDirection: "column", gap: 7 }}>
                    <strong style={{ fontSize: "0.76rem" }}>Retire {contact.name}?</strong>
                    <div style={subtle}>The conversation and personality will be preserved. You can restore this contact later.</div>
                    <div style={{ display: "flex", gap: 7 }}>
                      <button type="button" disabled={busy || saving} onClick={() => { setConfirmArchive(""); setError(""); }} style={button}>Cancel</button>
                      <button type="button" disabled={busy || saving} onClick={() => retire(contact, true)} style={{ ...button, borderColor: "rgba(248,113,113,0.6)", color: "#fca5a5" }}>Retire contact</button>
                    </div>
                  </div>
                )}
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
              <strong style={{ fontSize: "0.75rem" }}>{editor === "new" ? "Add recipient" : editor === "chief" ? "Edit chief advisor" : "Edit recipient"}</strong>
              {editor !== "chief" && (
                <label style={subtle}>Recipient type
                  <select style={field} value={draft.recipientType} disabled={busy || saving || Boolean(draft.binding)} onChange={(event) => setDraft((old) => ({
                    ...old, recipientType: event.target.value, binding: null, officeKey: "",
                  }))}>
                    {!ADVISOR_RECIPIENT_TYPE_LABELS[draft.recipientType] && <option value="">Unsupported recipient type</option>}
                    {Object.entries(ADVISOR_RECIPIENT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              )}
              {editor !== "chief" && editor !== "new" && (
                <div style={subtle}>Recipient type can only change before conversation history exists.</div>
              )}
              {editor === "new" && draft.recipientType === ADVISOR_RECIPIENT_TYPES.MINISTER && (
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
              <label style={subtle}>{editor === "chief" ? "Position / title" : draft.recipientType === ADVISOR_RECIPIENT_TYPES.MINISTER ? "Government position" : "Position / role"}
                <input style={field} maxLength={120} value={draft.title} onChange={(event) => setDraft((old) => ({ ...old, title: event.target.value }))} />
              </label>
              <label style={subtle}>Personality and principles
                <textarea style={{ ...field, minHeight: 64, resize: "vertical" }} maxLength={ADVISOR_PERSONALITY_MAX_CHARS} value={draft.personality} onChange={(event) => setDraft((old) => ({ ...old, personality: event.target.value }))} placeholder="e.g. meticulous, cautious with public spending, willing to disagree" />
                <div data-no-translate style={{ color: draft.personality.length >= ADVISOR_PERSONALITY_MAX_CHARS ? "#f87171" : "rgba(255,255,255,0.5)", fontSize: "0.7rem", marginTop: "0.25rem", textAlign: "right" }}>
                  {draft.personality.length}/{ADVISOR_PERSONALITY_MAX_CHARS}
                </div>
              </label>
              {draft.binding && <div style={subtle}>Linked to {draft.binding.office === "headOfGovernment" ? "head of government" : "head of state"}: {draft.binding.name}. A replacement will not inherit this conversation.</div>}
              {editor !== "chief" && draft.recipientType !== ADVISOR_RECIPIENT_TYPES.MINISTER && (
                <div style={subtle}>You can speak with this character without a Political World office. Only public scenario information is available to them.</div>
              )}
              {error && <div role="alert" style={{ color: "#fca5a5", fontSize: "0.72rem" }}>{error}</div>}
              <div style={{ display: "flex", gap: 7 }}>
                <button type="button" disabled={busy || saving || !draft.name.trim() || !draft.title.trim()} onClick={submit} style={button}>{saving ? "Saving…" : editor === "chief" ? "Save chief advisor" : "Save recipient"}</button>
                <button type="button" disabled={saving} onClick={() => { setEditor(null); setError(""); }} style={button}>Cancel</button>
                {editor === "chief" && chiefProfile && (
                  <button type="button" disabled={busy || saving} onClick={resetChief} style={button}>Restore scenario defaults</button>
                )}
              </div>
            </div>
          )}
          {!editor && error && <div role="alert" style={{ color: "#fca5a5", fontSize: "0.72rem" }}>{error}</div>}
        </div>
      )}
    </section>
  );
}
