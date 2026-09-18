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
    setDirty(false);
    setMessage("");
  };

  const createNew = () => {
    if (dirty && !window.confirm("Discard unsaved institution edits?")) return;
    setSelectedId("");
    setDraft(institutionAuthoringDraft(null));
    setPendingLogoDataUrl("");
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

  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.9rem", padding: "0.9rem" }}>
      <div style={{ alignItems: "flex-start", display: "flex", gap: "0.7rem", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: "rgba(255,255,255,0.94)", fontSize: "0.9rem", fontWeight: 800 }}>Premade institutions & logos</div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.7rem", lineHeight: 1.5, marginTop: "0.2rem" }}>
            Create or edit canonical organizations before play. Presentation stays institution-owned; Political World may later enrich memberships and governance without replacing your identity or logo choice.
          </div>
        </div>
        <button onClick={createNew} style={{ ...actionButtonStyle, background: "rgba(124,58,237,0.22)", borderColor: "rgba(139,92,246,0.38)", flex: "0 0 auto" }} type="button">
          + Institution
        </button>
      </div>

      <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "minmax(9.5rem, 0.9fr) minmax(0, 2fr)", marginTop: "0.8rem" }}>
        <div style={{ display: "grid", gap: "0.35rem", maxHeight: "28rem", overflow: "auto", paddingRight: "0.2rem" }}>
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
          {!rows.length && <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.7rem", lineHeight: 1.45 }}>No canonical institutions yet. Create one here or let Political World discover them.</div>}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ alignItems: "center", display: "flex", gap: "0.7rem", marginBottom: "0.75rem" }}>
            <InstitutionLogoPreview draft={draft} previewUrl={previewUrl} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.78rem", fontWeight: 800 }}>{draft.name || "New institution"}</div>
              <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.64rem", marginTop: "0.15rem" }}>{draft.id ? `Canonical id: ${draft.id}` : "Id will be derived from the name when saved."}</div>
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
              <label style={labelStyle}>Kind</label>
              <select onChange={(event) => edit("kind", event.target.value)} style={{ ...inputStyle, colorScheme: "dark" }} value={draft.kind}>
                {INSTITUTION_KINDS.map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Founded</label>
              <input onChange={(event) => edit("foundedDate", event.target.value)} placeholder="YYYY-MM-DD" style={inputStyle} value={draft.foundedDate} />
            </div>
            <div>
              <label style={labelStyle}>Dissolved</label>
              <input onChange={(event) => edit("dissolvedDate", event.target.value)} placeholder="blank if active" style={inputStyle} value={draft.dissolvedDate} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Aliases</label>
              <input onChange={(event) => edit("aliasesText", event.target.value)} placeholder="Comma-separated names" style={inputStyle} value={draft.aliasesText} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Members</label>
              <textarea onChange={(event) => edit("membersText", event.target.value)} placeholder="One polity name per line" style={{ ...inputStyle, minHeight: "5.4rem", resize: "vertical" }} value={draft.membersText} />
              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.61rem", lineHeight: 1.45, marginTop: "0.25rem" }}>Existing member roles/statuses are preserved when the same polity remains listed. New entries start as ordinary members.</div>
            </div>
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", marginTop: "0.75rem", paddingTop: "0.7rem" }}>
            <label style={labelStyle}>Built-in historical emblem</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {Object.keys(BUILTIN_INSTITUTION_LOGOS).map((badgeKey) => (
                <button
                  key={badgeKey}
                  onClick={() => {
                    setPendingLogoDataUrl("");
                    setDirty(true);
                    setDraft((current) => ({ ...current, badgeKey, logoUrl: "", logoAsset: false }));
                  }}
                  style={{ ...actionButtonStyle, background: draft.badgeKey === badgeKey && !draft.logoUrl ? "rgba(124,58,237,0.28)" : "rgba(255,255,255,0.04)", minHeight: "1.8rem" }}
                  type="button"
                >
                  {badgeKey.toUpperCase()}
                </button>
              ))}
              <button onClick={() => { setPendingLogoDataUrl(""); setDirty(true); setDraft((current) => ({ ...current, badgeKey: "", logoAsset: false })); }} style={{ ...actionButtonStyle, minHeight: "1.8rem" }} type="button">None</button>
            </div>
          </div>

          <div style={{ display: "grid", gap: "0.45rem", marginTop: "0.65rem" }}>
            <div>
              <label style={labelStyle}>Custom logo URL / asset path</label>
              <input onChange={(event) => { setPendingLogoDataUrl(""); setDirty(true); setMessage(""); setDraft((current) => ({ ...current, logoUrl: event.target.value, logoAsset: false })); }} placeholder="logos/my-alliance.svg or https://..." style={inputStyle} value={draft.logoUrl} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              <button onClick={() => fileRef.current?.click()} style={actionButtonStyle} type="button">Embed small raster logo</button>
              <button onClick={() => { setPendingLogoDataUrl(""); setDirty(true); setDraft((current) => ({ ...current, logoUrl: "", logoAsset: false })); }} style={actionButtonStyle} type="button">Clear custom logo</button>
              <input accept=".gif,.jpeg,.jpg,.png,.webp" onChange={uploadLogo} ref={fileRef} style={{ display: "none" }} type="file" />
            </div>
            <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.61rem", lineHeight: 1.45 }}>
              Small raster uploads are stored in the scenario's dedicated institution-logo asset (256 KB max), so world.json stays light. SVG and larger artwork should use a normal public/scenario asset path or URL.
            </div>
          </div>

          <div style={{ marginTop: "0.65rem" }}>
            <label style={labelStyle}>Author note</label>
            <textarea onChange={(event) => edit("note", event.target.value)} style={{ ...inputStyle, minHeight: "4.2rem", resize: "vertical" }} value={draft.note} />
          </div>

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
