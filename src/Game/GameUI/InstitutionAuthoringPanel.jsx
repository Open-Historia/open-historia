import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  downloadScenarioJsonAsset,
  saveScenario,
  uploadScenarioAsset,
} from "../../runtime/library.js";
import {
  institutionAuthoringDraft,
  institutionAuthoringRows,
  upsertScenarioInstitution,
} from "../../runtime/institutionAuthoring.js";
import { INSTITUTION_KINDS } from "../../runtime/institutions.js";
import {
  BUILTIN_INSTITUTION_LOGOS,
  institutionLogoUrl,
} from "../../runtime/institutionLogos.js";

const actionButtonStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "999px",
  color: "rgba(246,246,248,0.92)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.76rem",
  fontWeight: 700,
  gap: "0.35rem",
  justifyContent: "center",
  minHeight: "2rem",
  padding: "0 0.75rem",
};

const inputStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px",
  color: "#f8fafc",
  fontSize: "0.78rem",
  outline: "none",
  padding: "0.62rem 0.68rem",
  width: "100%",
};

const optionStyle = {
  backgroundColor: "#1a1b1f",
  color: "#f8fafc",
};

const labelStyle = {
  color: "rgba(255,255,255,0.62)",
  display: "block",
  fontSize: "0.65rem",
  fontWeight: 700,
  letterSpacing: "0.05em",
  marginBottom: "0.32rem",
  textTransform: "uppercase",
};

const kindLabel = (value) => String(value || "other")
  .replace(/_/g, " ")
  .replace(/\b\w/g, (char) => char.toUpperCase());

const readSmallRasterAsDataUrl = (file) => new Promise((resolve, reject) => {
  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  if (!allowed.has(file?.type)) {
    reject(new Error("Upload a PNG, JPEG, WebP or GIF. SVG logos should use a normal scenario/public asset path rather than inline SVG."));
    return;
  }
  if (Number(file?.size || 0) > 256 * 1024) {
    reject(new Error("Embedded institution logos are limited to 256 KB. Use a scenario/public asset path or web URL for larger artwork."));
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("Could not read the selected logo file."));
  reader.onload = () => resolve(String(reader.result || ""));
  reader.readAsDataURL(file);
});

const InstitutionLogoPreview = ({ draft, previewUrl = "" }) => {
  const [failed, setFailed] = useState(false);
  const resolved = previewUrl || institutionLogoUrl(draft || {});
  useEffect(() => setFailed(false), [resolved]);
  const initials = String(draft?.shortName || draft?.name || draft?.id || "ORG")
    .trim()
    .split(/\s+/g)
    .slice(0, 3)
    .map((entry) => entry[0])
    .join("")
    .toUpperCase()
    .slice(0, 4) || "ORG";

  return (
    <div style={{ alignItems: "center", background: "rgba(7,10,18,0.72)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "14px", display: "flex", height: "4.2rem", justifyContent: "center", overflow: "hidden", width: "4.2rem" }}>
      {resolved && !failed
        ? <img alt="" aria-hidden="true" onError={() => setFailed(true)} src={resolved} style={{ maxHeight: "3.5rem", maxWidth: "3.5rem", objectFit: "contain" }} />
        : <span style={{ color: "rgba(255,255,255,0.82)", fontSize: "0.78rem", fontWeight: 900, letterSpacing: "0.05em" }}>{initials}</span>}
    </div>
  );
};

const EMPTY_DRAFT = institutionAuthoringDraft(null);

export default function InstitutionAuthoringPanel({ details, onDetailsChange }) {
  const world = details?.data?.world || {};
  const rows = useMemo(() => institutionAuthoringRows(world), [world]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingLogoDataUrl, setPendingLogoDataUrl] = useState("");
  const [memberEntry, setMemberEntry] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    if (dirty) return;
    const selected = rows.find((entry) => entry.id === selectedId) || rows[0] || null;
    setSelectedId(selected?.id || "");
    setDraft(institutionAuthoringDraft(selected));
  }, [rows, selectedId, dirty]);

  const edit = (field, value) => {
    setDirty(true);
    setMessage("");
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const chooseInstitution = (institution) => {
    if (dirty && !window.confirm("Discard unsaved institution edits?")) return;
    setSelectedId(institution?.id || "");
    setDraft(institutionAuthoringDraft(institution));
    setPendingLogoDataUrl("");
    setMemberEntry("");
    setDirty(false);
    setMessage("");
  };

  const createNew = () => {
    if (dirty && !window.confirm("Discard unsaved institution edits?")) return;
    setSelectedId("");
    setDraft(institutionAuthoringDraft(null));
    setPendingLogoDataUrl("");
    setMemberEntry("");
    setDirty(true);
    setMessage("");
  };

  const save = async () => {
    if (!details?.scenario?.id || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = upsertScenarioInstitution(world, draft);
      if (result.error) throw new Error(result.error);

      const institutionId = result.institution.id;
      const storedLogos = await downloadScenarioJsonAsset(details.scenario.id, "institutionLogos") || {};
      const nextStoredLogos = storedLogos && typeof storedLogos === "object" && !Array.isArray(storedLogos)
        ? { ...storedLogos }
        : {};
      if (pendingLogoDataUrl) nextStoredLogos[institutionId] = pendingLogoDataUrl;
      else if (result.institution.logoAsset !== true) delete nextStoredLogos[institutionId];

      if (pendingLogoDataUrl || Object.hasOwn(storedLogos || {}, institutionId)) {
        await uploadScenarioAsset(
          details.scenario.id,
          "institutionLogos",
          new Blob([JSON.stringify(nextStoredLogos)], { type: "application/json" }),
        );
      }

      const nextDetails = await saveScenario(details.scenario.id, {
        worldPatch: { institutions: result.world.institutions },
      });
      onDetailsChange?.(nextDetails);
      setSelectedId(result.institution.id);
      setDraft(institutionAuthoringDraft(result.institution));
      setPendingLogoDataUrl("");
      setDirty(false);
      setMessage("Institution saved to scenario canon.");
    } catch (error) {
      setMessage(error?.message || "Could not save institution.");
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (event) => {
    const [file] = Array.from(event.target.files || []);
    event.target.value = "";
    if (!file) return;
    setMessage("");
    try {
      const dataUrl = await readSmallRasterAsDataUrl(file);
      setPendingLogoDataUrl(dataUrl);
      setDirty(true);
      setDraft((current) => ({ ...current, logoUrl: "", logoAsset: true }));
    } catch (error) {
      setMessage(error?.message || "Could not load logo.");
    }
  };

  const storedLogoPreview = draft.logoAsset === true && draft.id && details?.scenario?.id
    ? `/api/scenarios/${encodeURIComponent(details.scenario.id)}/institution-logo/${encodeURIComponent(draft.id)}`
    : "";
  const previewUrl = pendingLogoDataUrl || storedLogoPreview;

  const memberNames = useMemo(() => {
    const seen = new Set();
    return String(draft.membersText || "")
      .split(/[\n,;]+/g)
      .map((entry) => entry.trim())
      .filter((entry) => {
        const key = entry.toLocaleLowerCase();
        if (!entry || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [draft.membersText]);

  const setMemberNames = (names) => edit("membersText", names.join("\n"));

  const addMember = () => {
    const next = memberEntry.trim();
    if (!next) return;
    const exists = memberNames.some((entry) => entry.toLocaleLowerCase() === next.toLocaleLowerCase());
    if (!exists) setMemberNames([...memberNames, next]);
    setMemberEntry("");
  };

  const removeMember = (name) => {
    setMemberNames(memberNames.filter((entry) => entry.toLocaleLowerCase() !== name.toLocaleLowerCase()));
  };

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.9rem", padding: "0.9rem" }}>
      <div style={{ alignItems: "flex-start", display: "flex", gap: "0.7rem", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.95rem", fontWeight: 800 }}>Institutions</div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.7rem", lineHeight: 1.5, marginTop: "0.2rem" }}>
            Create institutions that already exist when the scenario begins. Political World generation may enrich membership and governance later, but it will preserve the identity and artwork you author here.
          </div>
        </div>
        <button onClick={createNew} style={{ ...actionButtonStyle, background: "rgba(124,58,237,0.22)", borderColor: "rgba(139,92,246,0.38)", flex: "0 0 auto" }} type="button">
          + Create institution
        </button>
      </div>

      {!rows.length && !selectedId && (
        <div style={{ background: "rgba(124,58,237,0.07)", border: "1px solid rgba(167,139,250,0.18)", borderRadius: 12, color: "rgba(237,233,254,0.86)", fontSize: "0.7rem", lineHeight: 1.5, marginTop: "0.75rem", padding: "0.65rem 0.7rem" }}>
          <strong>No institutions created yet.</strong> Add one manually if it must exist at scenario start, or leave this empty and let Political World generation establish relevant institutions later.
        </div>
      )}

      <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "minmax(9.5rem, 0.78fr) minmax(0, 2.22fr)", marginTop: "0.8rem" }}>
        <div style={{ display: "grid", gap: "0.35rem", maxHeight: "31rem", overflow: "auto", paddingRight: "0.2rem" }}>
          {rows.map((institution) => {
            const selected = institution.id === selectedId;
            return (
              <button
                key={institution.id}
                onClick={() => chooseInstitution(institution)}
                style={{
                  background: selected ? "rgba(124,58,237,0.2)" : "rgba(255,255,255,0.025)",
                  border: `1px solid ${selected ? "rgba(139,92,246,0.42)" : "rgba(255,255,255,0.07)"}`,
                  borderRadius: "10px",
                  color: "#fff",
                  cursor: "pointer",
                  padding: "0.55rem 0.6rem",
                  textAlign: "left",
                }}
                type="button"
              >
                <div style={{ fontSize: "0.72rem", fontWeight: 800 }}>{institution.shortName || institution.name}</div>
                <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.62rem", marginTop: "0.15rem" }}>{institution.name}</div>
              </button>
            );
          })}
          {!rows.length && <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.67rem", lineHeight: 1.45, padding: "0.3rem 0.15rem" }}>Your scenario has no authored institutions yet.</div>}
        </div>

        <div style={{ minWidth: 0 }}>
          <section style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "0.72rem" }}>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.06em", marginBottom: "0.6rem", textTransform: "uppercase" }}>Identity</div>
            <div style={{ alignItems: "center", display: "flex", gap: "0.7rem", marginBottom: "0.7rem" }}>
              <InstitutionLogoPreview draft={draft} previewUrl={previewUrl} />
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.82rem", fontWeight: 800 }}>{draft.name || "New institution"}</div>
                <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.64rem", marginTop: "0.15rem" }}>{draft.shortName || "Name the institution to begin."}</div>
              </div>
            </div>
            <div style={{ display: "grid", gap: "0.62rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Name</label>
                <input onChange={(event) => edit("name", event.target.value)} placeholder="e.g. Northern League" style={inputStyle} value={draft.name} />
              </div>
              <div>
                <label style={labelStyle}>Short name</label>
                <input onChange={(event) => edit("shortName", event.target.value)} placeholder="NL" style={inputStyle} value={draft.shortName} />
              </div>
              <div>
                <label style={labelStyle}>Type</label>
                <select onChange={(event) => edit("kind", event.target.value)} style={{ ...inputStyle, colorScheme: "dark" }} value={draft.kind}>
                  {INSTITUTION_KINDS.map((kind) => <option key={kind} style={optionStyle} value={kind}>{kindLabel(kind)}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Founded</label>
                <input onChange={(event) => edit("foundedDate", event.target.value)} placeholder="YYYY-MM-DD" style={inputStyle} value={draft.foundedDate} />
              </div>
              <div>
                <label style={labelStyle}>Dissolved</label>
                <input onChange={(event) => edit("dissolvedDate", event.target.value)} placeholder="Leave blank if active" style={inputStyle} value={draft.dissolvedDate} />
              </div>
            </div>
          </section>

          <section style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, marginTop: "0.65rem", padding: "0.72rem" }}>
            <div style={{ alignItems: "baseline", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>Members</div>
              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.62rem" }}>{memberNames.length} added</div>
            </div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.66rem", lineHeight: 1.45, marginTop: "0.25rem" }}>Add the polities that belong to this institution at scenario start. Existing roles and statuses are preserved when you edit an institution.</div>
            <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.55rem" }}>
              <input
                onChange={(event) => setMemberEntry(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addMember();
                }}
                placeholder="Type a polity name"
                style={{ ...inputStyle, flex: 1 }}
                value={memberEntry}
              />
              <button disabled={!memberEntry.trim()} onClick={addMember} style={{ ...actionButtonStyle, opacity: memberEntry.trim() ? 1 : 0.45 }} type="button">Add</button>
            </div>
            {memberNames.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.55rem" }}>
                {memberNames.map((name) => (
                  <span key={name.toLocaleLowerCase()} style={{ alignItems: "center", background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "999px", display: "inline-flex", fontSize: "0.66rem", gap: "0.35rem", padding: "0.3rem 0.35rem 0.3rem 0.55rem" }}>
                    {name}
                    <button aria-label={`Remove ${name}`} onClick={() => removeMember(name)} style={{ background: "transparent", border: 0, color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: "0.8rem", lineHeight: 1, padding: "0 0.15rem" }} type="button">×</button>
                  </span>
                ))}
              </div>
            ) : (
              <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.65rem", marginTop: "0.5rem" }}>No starting members added.</div>
            )}
            <details style={{ marginTop: "0.55rem" }}>
              <summary style={{ color: "rgba(255,255,255,0.48)", cursor: "pointer", fontSize: "0.64rem" }}>Bulk edit member list</summary>
              <textarea onChange={(event) => edit("membersText", event.target.value)} placeholder="One polity name per line" style={{ ...inputStyle, minHeight: "5rem", marginTop: "0.4rem", resize: "vertical" }} value={draft.membersText} />
            </details>
          </section>

          <section style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, marginTop: "0.65rem", padding: "0.72rem" }}>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>Visual identity</div>
            <div style={{ display: "grid", gap: "0.55rem", marginTop: "0.55rem" }}>
              <div>
                <label style={labelStyle}>Historical emblem</label>
                <select
                  onChange={(event) => {
                    const badgeKey = event.target.value;
                    setPendingLogoDataUrl("");
                    setDirty(true);
                    setDraft((current) => ({ ...current, badgeKey, logoUrl: "", logoAsset: false }));
                  }}
                  style={{ ...inputStyle, colorScheme: "dark" }}
                  value={draft.logoUrl || draft.logoAsset ? "" : draft.badgeKey}
                >
                  <option style={optionStyle} value="">None / custom logo</option>
                  {Object.keys(BUILTIN_INSTITUTION_LOGOS).map((badgeKey) => <option key={badgeKey} style={optionStyle} value={badgeKey}>{badgeKey.toUpperCase()}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Custom logo URL or asset path</label>
                <input onChange={(event) => { setPendingLogoDataUrl(""); setDirty(true); setMessage(""); setDraft((current) => ({ ...current, badgeKey: "", logoUrl: event.target.value, logoAsset: false })); }} placeholder="logos/my-alliance.svg or https://..." style={inputStyle} value={draft.logoUrl} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                <button onClick={() => fileRef.current?.click()} style={actionButtonStyle} type="button">Upload small logo</button>
                <button onClick={() => { setPendingLogoDataUrl(""); setDirty(true); setDraft((current) => ({ ...current, badgeKey: "", logoUrl: "", logoAsset: false })); }} style={actionButtonStyle} type="button">Clear logo</button>
                <input accept=".gif,.jpeg,.jpg,.png,.webp" onChange={uploadLogo} ref={fileRef} style={{ display: "none" }} type="file" />
              </div>
              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.61rem", lineHeight: 1.45 }}>
                PNG, JPEG, WebP and GIF uploads up to 256 KB can travel with the scenario. Use an asset path or URL for SVG or larger artwork.
              </div>
            </div>
          </section>

          <details style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, marginTop: "0.65rem", padding: "0.62rem 0.72rem" }}>
            <summary style={{ color: "rgba(255,255,255,0.62)", cursor: "pointer", fontSize: "0.69rem", fontWeight: 700 }}>Advanced details</summary>
            <div style={{ display: "grid", gap: "0.55rem", marginTop: "0.6rem" }}>
              <div>
                <label style={labelStyle}>Aliases</label>
                <input onChange={(event) => edit("aliasesText", event.target.value)} placeholder="Comma-separated alternate names" style={inputStyle} value={draft.aliasesText} />
              </div>
              <div>
                <label style={labelStyle}>Author note</label>
                <textarea onChange={(event) => edit("note", event.target.value)} placeholder="Optional note for scenario authors" style={{ ...inputStyle, minHeight: "4.2rem", resize: "vertical" }} value={draft.note} />
              </div>
              {draft.id && <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.61rem" }}>Canonical id: {draft.id}</div>}
            </div>
          </details>

          {message && (
            <div style={{ background: /saved/i.test(message) ? "rgba(34,197,94,0.08)" : "rgba(248,113,113,0.08)", border: `1px solid ${/saved/i.test(message) ? "rgba(34,197,94,0.2)" : "rgba(248,113,113,0.22)"}`, borderRadius: "10px", color: /saved/i.test(message) ? "#bbf7d0" : "#fecaca", fontSize: "0.68rem", lineHeight: 1.45, marginTop: "0.65rem", padding: "0.55rem 0.65rem" }}>
              {message}
            </div>
          )}

          <div style={{ display: "flex", gap: "0.45rem", justifyContent: "flex-end", marginTop: "0.75rem" }}>
            <button disabled={!dirty || busy} onClick={save} style={{ ...actionButtonStyle, background: dirty ? "rgba(124,58,237,0.3)" : "rgba(255,255,255,0.035)", borderColor: dirty ? "rgba(139,92,246,0.45)" : "rgba(255,255,255,0.07)", color: dirty ? "#fff" : "rgba(255,255,255,0.35)" }} type="button">
              {busy ? "Saving..." : "Save institution"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
