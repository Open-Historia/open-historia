import React, { useState } from "react";
import { ADVISOR_PERSONALITY_MAX_CHARS, ADVISOR_RECIPIENT_TYPES, ADVISOR_RECIPIENT_TYPE_LABELS, CHIEF_ADVISOR_THREAD, advisorRecipientType } from "../../runtime/advisorThreads.js";

const field = {
  background: "#112131", border: "1px solid rgba(133, 191, 219, .28)",
  borderRadius: 5, boxSizing: "border-box", color: "#f0f6fa",
  fontFamily: "inherit", fontSize: "0.76rem", padding: "0.45rem", width: "100%",
};
const subtle = { color: "#97acbd", fontSize: "0.68rem" };
const button = {
  background: "#203648", border: "1px solid rgba(133, 191, 219, .2)",
  borderRadius: 5, color: "#d8e5ee", cursor: "pointer",
  fontFamily: "inherit", fontSize: "0.72rem", padding: "0.4rem 0.55rem",
};
const blank = () => ({ name: "", title: "", personality: "", recipientType: ADVISOR_RECIPIENT_TYPES.MINISTER, binding: null, officeKey: "" });

export default function AdvisorRecipients({
  contacts, groups = [], activeId, chiefProfile, offices, statusOf, busy = false, onSelect, onCreate, onRevise, onArchive, onReorder, onCreateGroup, onReviseGroup, onArchiveGroup, onSaveChief, onResetChief,
}) {
  const [expanded, setExpanded] = useState(false);
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(blank);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [draggedId, setDraggedId] = useState("");
  const [hoverId, setHoverId] = useState("");
  const [groupEditor, setGroupEditor] = useState(null);
  const [groupDraft, setGroupDraft] = useState({ name: "", memberIds: [] });
  const selected = contacts.find((item) => item.id === activeId);
  const selectedGroup = groups.find((item) => item.id === activeId);
  const groupChoices = [{ id: CHIEF_ADVISOR_THREAD, name: chiefProfile?.name || "Chief advisor", title: chiefProfile?.title || "Chief advisor" }, ...contacts.filter((item) => !item.archived && advisorRecipientType(item) === ADVISOR_RECIPIENT_TYPES.MINISTER)];
  const chiefName = chiefProfile?.name || "Chief advisor";
  const chiefTitle = chiefProfile?.title || "Chief advisor";
  const baseVisible = contacts.filter((item) => !item.archived || showArchived || item.id === activeId);
  const visible = baseVisible.slice();
  if (draggedId && hoverId && draggedId !== hoverId) {
    const from = visible.findIndex((item) => item.id === draggedId);
    const to = visible.findIndex((item) => item.id === hoverId);
    if (from >= 0 && to >= 0) visible.splice(to, 0, ...visible.splice(from, 1));
  }
  const reorder = async (sourceId, targetId) => {
    if (busy || saving || !onReorder || !sourceId || !targetId || sourceId === targetId) return;
    setSaving(true);
    setError("");
    try {
      await onReorder(sourceId, targetId);
    } catch (caught) {
      setError(String(caught?.message || caught));
    } finally {
      setSaving(false);
      setDraggedId("");
      setHoverId("");
    }
  };
  const openGroupEditor = (group = null) => {
    if (busy || saving) return;
    setGroupEditor(group?.id || "new");
    setGroupDraft(group ? { name: group.name, memberIds: [...group.memberIds] } : { name: "", memberIds: [CHIEF_ADVISOR_THREAD] });
    setEditor(null);
    setConfirmArchive("");
    setError("");
    setExpanded(true);
  };
  const submitGroup = async () => {
    if (busy || saving || !groupDraft.name.trim() || groupDraft.memberIds.length < 2) return;
    setSaving(true);
    setError("");
    try {
      if (groupEditor === "new") await onCreateGroup(groupDraft);
      else await onReviseGroup(groupEditor, groupDraft);
      setGroupEditor(null);
    } catch (caught) {
      setError(String(caught?.message || caught));
    } finally {
      setSaving(false);
    }
  };
  const retireGroup = async (group, archived) => {
    if (busy || saving || (archived && confirmArchive !== group.id)) return;
    setSaving(true);
    setError("");
    try {
      await onArchiveGroup(group.id, archived);
      setConfirmArchive("");
      if (groupEditor === group.id) setGroupEditor(null);
    } catch (caught) {
      setError(String(caught?.message || caught));
    } finally {
      setSaving(false);
    }
  };
  const openEditor = (contact = null) => {
    setGroupEditor(null);
    if (busy || saving) return;
    setEditor(contact?.id || "new");
    setDraft(contact ? { name: contact.name, title: contact.title, personality: contact.personality || "", recipientType: advisorRecipientType(contact) || "", binding: contact.binding || null, officeKey: "" } : blank());
    setConfirmArchive("");
    setError("");
    setExpanded(true);
  };
  const openChiefEditor = () => {
    if (busy || saving) return;
    setGroupEditor(null);
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
    <section className="oh-advisor-recipients" aria-label="Advisor conversations">
      <div className="oh-advisor-recipient-top">
        <button type="button" className="oh-advisor-recipient-trigger" aria-expanded={expanded} onClick={() => setExpanded((old) => !old)}>
          <span className="oh-advisor-recipient-trigger-name">{selectedGroup?.name || (selected ? selected.name : chiefName)}</span>
          {(selected?.archived || selectedGroup?.archived) && <span style={subtle}>(retired)</span>}
          <span className="oh-advisor-recipient-chevron" aria-hidden="true">{expanded ? "▴" : "▾"}</span>
        </button>
        <button type="button" className="oh-advisor-add-contact" disabled={busy || saving} onClick={() => openGroupEditor()} title="Convene multiple advisors with independent voices" aria-label="Create advisor group">+ Group</button>
        <button type="button" className="oh-advisor-add-contact" disabled={busy || saving} onClick={() => openEditor()} title="Add an official or advisor" aria-label="Add advisor recipient">+ Contact</button>
      </div>
      {(selectedGroup || selected || chiefProfile) && <div className="oh-advisor-recipient-title">{selectedGroup ? `${selectedGroup.memberIds.length} group members · individual personalities` : selected ? selected.title : chiefTitle}{selected?.binding ? " · Political World" : ""}</div>}
      {selected && advisorRecipientType(selected) !== ADVISOR_RECIPIENT_TYPES.MINISTER && (
        <div role="status" style={{ ...subtle, marginTop: 5 }}>
          This character uses only the public scenario timeline and their own conversation history. Private government records and diplomacy are not shared.
        </div>
      )}
      {expanded && (
        <div className="oh-advisor-contact-list">
          <div className="oh-advisor-contact-row">
            <button type="button" className="oh-advisor-contact-select" aria-current={activeId === CHIEF_ADVISOR_THREAD ? "true" : undefined} disabled={busy || saving} onClick={() => { onSelect(CHIEF_ADVISOR_THREAD); setEditor(null); setConfirmArchive(""); setExpanded(false); }}>
              <span className="oh-advisor-contact-name">{chiefName} <span style={subtle}>· Original conversation</span></span>
              {chiefProfile && <span className="oh-advisor-contact-detail">{chiefTitle}</span>}
            </button>
            <button type="button" className="oh-advisor-contact-action" disabled={busy || saving} title="Edit chief advisor" onClick={openChiefEditor}>Edit</button>
          </div>
          {groups.filter((group) => !group.archived || showArchived || group.id === activeId).map((group) => (
            <div key={group.id}>
              <div className="oh-advisor-contact-row">
                <button type="button" className="oh-advisor-contact-select" aria-current={activeId === group.id ? "true" : undefined} disabled={busy || saving} onClick={() => { onSelect(group.id); setGroupEditor(null); setEditor(null); setConfirmArchive(""); setExpanded(false); }}>
                  <span className="oh-advisor-contact-name">◈ {group.name}{group.archived ? " · Retired" : ""}</span>
                  <span className="oh-advisor-contact-detail">Group chat · {group.memberIds.length} independently speaking advisors</span>
                </button>
                <button type="button" className="oh-advisor-contact-action" disabled={busy || saving} title={`Edit ${group.name}`} onClick={() => openGroupEditor(group)}>Edit</button>
                <button type="button" className="oh-advisor-contact-action" disabled={busy || saving} onClick={() => group.archived ? retireGroup(group, false) : (setConfirmArchive(group.id), setError(""))}>
                  {group.archived ? "Restore" : "Retire"}
                </button>
              </div>
              {confirmArchive === group.id && !group.archived && (
                <div role="alertdialog" aria-label={`Retire ${group.name}?`} style={{ border: "1px solid rgba(248,113,113,0.5)", borderRadius: 8, padding: 10 }}>
                  <strong style={{ fontSize: "0.76rem" }}>Retire this group chat?</strong>
                  <div style={subtle}>Its transcript and each participant's existing conversation are preserved.</div>
                  <div style={{ display: "flex", gap: 7, marginTop: 6 }}>
                    <button type="button" style={button} onClick={() => setConfirmArchive("")}>Cancel</button>
                    <button type="button" style={button} onClick={() => retireGroup(group, true)}>Retire group</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {groupEditor && (
            <div className="oh-advisor-contact-editor">
              <strong style={{ fontSize: "0.75rem" }}>{groupEditor === "new" ? "Create group chat" : "Edit group chat"}</strong>
              <label style={subtle}>Group name
                <input style={field} maxLength={100} value={groupDraft.name} onChange={(event) => setGroupDraft((old) => ({ ...old, name: event.target.value }))} placeholder="e.g. Economic Policy Group" />
              </label>
              <div style={subtle}>Choose 2 to 10 advisors. Every member has a chance to speak, disagree, or stay silent. Individual requests preserve independent voices; shared requests can generate several speakers together. Government advisors may propose Actions for review and manage authorized Projects.</div>
              {groupChoices.map((choice) => (
                <label key={choice.id} style={{ ...subtle, display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={groupDraft.memberIds.includes(choice.id)} disabled={busy || saving || (!groupDraft.memberIds.includes(choice.id) && groupDraft.memberIds.length >= 10)}
                    onChange={(event) => setGroupDraft((old) => ({ ...old,
                      memberIds: event.target.checked ? [...old.memberIds, choice.id] : old.memberIds.filter((id) => id !== choice.id),
                    }))} />
                  <span>{choice.name} <span style={{ opacity: 0.72 }}>· {choice.title}</span></span>
                </label>
              ))}
              {groupEditor !== "new" && <div style={subtle}>Membership becomes fixed after the first group message; create a new group chat to use a different roster.</div>}
              {error && <div role="alert" style={{ color: "#fca5a5", fontSize: "0.72rem" }}>{error}</div>}
              <div style={{ display: "flex", gap: 7 }}>
                <button type="button" disabled={busy || saving || !groupDraft.name.trim() || groupDraft.memberIds.length < 2} style={button} onClick={submitGroup}>{saving ? "Saving…" : "Save group"}</button>
                <button type="button" disabled={saving} style={button} onClick={() => { setGroupEditor(null); setError(""); }}>Cancel</button>
              </div>
            </div>
          )}
          {visible.map((contact) => {
            const officeStatus = statusOf(contact);
            return (
              <div key={contact.id}>
                <div className="oh-advisor-contact-row" draggable={!busy && !saving}
                  data-dragging={draggedId === contact.id ? "true" : undefined}
                  data-drop-target={draggedId && hoverId === contact.id && draggedId !== contact.id ? "true" : undefined}
                  onDragStart={(event) => {
                    if (busy || saving) { event.preventDefault(); return; }
                    setDraggedId(contact.id);
                    setHoverId("");
                    event.dataTransfer.setData("text/plain", contact.id);
                    event.dataTransfer.effectAllowed = "move";
                    // Native drag ghost depicts the ENTIRE row, not the handle.
                    event.dataTransfer.setDragImage(event.currentTarget, 20, 20);
                  }}
                  onDragOver={(event) => {
                    if (draggedId && !busy && !saving) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      if (draggedId !== contact.id && hoverId !== contact.id) setHoverId(contact.id);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceId = event.dataTransfer.getData("text/plain");
                    const targetId = hoverId || contact.id;
                    if (sourceId === draggedId && sourceId !== targetId) void reorder(sourceId, targetId);
                    else { setDraggedId(""); setHoverId(""); }
                  }}
                  onDragEnd={() => { setDraggedId(""); setHoverId(""); }}>
                  <span role="button" tabIndex={busy || saving ? -1 : 0}
                    aria-label={`Reorder ${contact.name}: drag the row or use arrow keys`}
                    title="Drag the row to reorder; Arrow Up or Down moves this contact"
                    onKeyDown={(event) => {
                      const index = baseVisible.findIndex((item) => item.id === contact.id);
                      const next = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : -1;
                      if (next >= 0 && next < baseVisible.length) {
                        event.preventDefault();
                        void reorder(contact.id, baseVisible[next].id);
                      }
                    }}
                    style={{ cursor: "grab", color: "var(--oh-advisor-muted)", padding: "0.4rem 0.15rem", alignSelf: "center", userSelect: "none" }}>⠿</span>
                  <button type="button" className="oh-advisor-contact-select" aria-current={activeId === contact.id ? "true" : undefined} disabled={busy || saving} onClick={() => { onSelect(contact.id); setEditor(null); setConfirmArchive(""); setExpanded(false); }}>
                    <span className="oh-advisor-contact-name">{contact.name} {contact.archived ? "· Retired" : ""}</span>
                    <span className="oh-advisor-contact-detail">{contact.title} · {ADVISOR_RECIPIENT_TYPE_LABELS[advisorRecipientType(contact)] || "Unsupported recipient type"}{["changed", "vacant"].includes(officeStatus) ? " · No longer in office" : ""}</span>
                  </button>
                  <button type="button" className="oh-advisor-contact-action" disabled={busy || saving} title={"Edit " + contact.name} onClick={() => openEditor(contact)}>Edit</button>
                  <button type="button" className="oh-advisor-contact-action" disabled={busy || saving} title={contact.archived ? "Restore contact" : "Retire contact"} onClick={() => contact.archived ? retire(contact, false) : (setConfirmArchive(contact.id), setError(""))}>
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
          {(contacts.some((contact) => contact.archived) || groups.some((group) => group.archived)) && (
            <button type="button" onClick={() => setShowArchived((old) => !old)} style={{ ...button, alignSelf: "flex-start" }}>
              {showArchived ? "Hide retired contacts and groups" : "Show retired contacts and groups"}
            </button>
          )}
          {editor && (
            <div className="oh-advisor-contact-editor">
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
