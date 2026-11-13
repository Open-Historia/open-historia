/*! Open Historia - human-friendly editor for existing and manually added Day-one facts. */
import React from "react";
import { DAY_ONE_AGREEMENT_TYPES } from "../../runtime/scenarioPrehistoryDayOne.js";

const fieldLabel = { color: "rgba(255,255,255,0.62)", display: "block", fontSize: "0.65rem", fontWeight: 750, marginBottom: "0.25rem" };
const fieldInput = { background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 9, color: "#f8fafc", fontFamily: "inherit", fontSize: "0.75rem", minWidth: 0, padding: "0.47rem 0.55rem", width: "100%" };
const compactButton = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#f8fafc", cursor: "pointer", fontSize: "0.7rem", fontWeight: 750, padding: "0.35rem 0.65rem" };
const clean = (value) => String(value ?? "").trim();
const numberOrBlank = (value) => {
  if (String(value).trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
};
const words = (value) => clean(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function DayOneFactEditor({ row, fact, problems = [], onChange, onChangeType, onReciprocalChange, onRemove, disabled = false }) {
  const canonicalAgreement = row.family === "worldAgreements";
  const kind = row.family === "canonicalUpdates" ? fact?.kind
    : ({ relationUpdates: "relation", agreementUpdates: "agreement", storylineUpdates: "storyline", worldAgreements: "agreement" }[row.family]);
  const legacy = row.family !== "canonicalUpdates" && !canonicalAgreement;
  const reciprocal = canonicalAgreement ? fact?.reciprocalAccess === true : fact?.reciprocal === true;
  const legacyUndirectedAccess = canonicalAgreement && fact?.type === "military_access" &&
    !reciprocal && !fact?.grantor && !fact?.grantee;
  const canonicalMetadata = canonicalAgreement
    ? "Existing scenario agreement - ID: " + fact.id + " - Status: " + words(fact.status || "active") + ". Editing its starting record does not modify existing campaigns."
    : "";
  const change = (field, value) => onChange({ [field]: value });
  const input = (label, key, { type = "text", hint = "", listCountries = false } = {}) => (
    <label style={{ minWidth: 0 }}>
      <span style={fieldLabel}>{label}</span>
      <input disabled={disabled} list={listCountries ? "oh-prehistory-polities" : undefined}
        onChange={(event) => change(key, type === "number" ? numberOrBlank(event.target.value) : event.target.value)}
        style={fieldInput} step={type === "number" ? "any" : undefined} type={type} value={fact?.[key] ?? ""} />
      {hint ? <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.62rem" }}>{hint}</span> : null}
    </label>
  );
  const multiline = (label, key) => (
    <label style={{ minWidth: 0 }}>
      <span style={fieldLabel}>{label}</span>
      <textarea disabled={disabled} onChange={(event) => change(key, event.target.value)}
        rows={3} style={{ ...fieldInput, lineHeight: 1.4, resize: "vertical" }}
        value={fact?.[key] ?? ""} />
    </label>
  );
  const countryRows = (label, key) => {
    const countries = Array.isArray(fact?.[key]) ? fact[key] : [];
    return (
      <div style={{ display: "grid", gap: "0.4rem", minWidth: 0 }}>
        <span style={fieldLabel}>{label}</span>
        {countries.map((country, index) => (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <input aria-label={label + " " + (index + 1)} disabled={disabled} list="oh-prehistory-polities"
              onChange={(event) => change(key, countries.map((value, at) => at === index ? event.target.value : value))}
              style={{ ...fieldInput, flex: "1 1 auto" }} value={country} />
            <button className="oh-tap" disabled={disabled}
              onClick={() => change(key, countries.filter((_, at) => at !== index))}
              style={compactButton} type="button">Remove country</button>
          </div>
        ))}
        <div><button className="oh-tap" disabled={disabled || countries.length >= 12}
          onClick={() => change(key, [...countries, ""])} style={compactButton} type="button">+ Add country</button></div>
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.62rem" }}>Use the canonical scenario country name.</span>
      </div>
    );
  };
  const select = (label, key, choices, onSelect = (value) => change(key, value)) => (
    <label style={{ minWidth: 0 }}>
      <span style={fieldLabel}>{label}</span>
      <select disabled={disabled} onChange={(event) => onSelect(event.target.value)} style={fieldInput} value={fact?.[key] ?? ""}>
        {!choices.includes(fact?.[key]) ? <option style={{ background: "#1a1b1f" }} value={fact?.[key] ?? ""}>{words(fact?.[key]) || "?"}</option> : null}
        {choices.map((value) => <option key={value} style={{ background: "#1a1b1f", color: "#f8fafc" }} value={value}>{words(value)}</option>)}
      </select>
    </label>
  );
  const twoColumns = (children) => <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))" }}>{children}</div>;
  const description = kind === "relation" ? "Relationship"
    : kind === "agreement" ? "Agreement" : "Ongoing storyline";
  const title = kind === "relation"
    ? [fact?.a, fact?.b].map(clean).filter(Boolean).join(" / ") || "New relationship"
    : clean(fact?.title) || ("New " + description.toLowerCase());
  return (
    <details style={{ border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: "0.5rem 0.65rem" }}>
      <summary className="oh-tap-row" style={{ color: "#f4f4f5", cursor: "pointer", fontSize: "0.73rem", fontWeight: 750, overflowWrap: "anywhere" }}>
        {description + ": " + title}
      </summary>
      <div style={{ display: "grid", gap: "0.65rem", marginTop: "0.65rem" }}>
        {legacy ? <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.68rem" }}>Older generated record. Its internal ID and existing event links are preserved when you edit it.</div> : null}
        {canonicalAgreement ? <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.68rem" }}>{canonicalMetadata}</div> : null}
        {kind === "relation" ? (
          <>
            {twoColumns(<>{input("First country", "a", { listCountries: true })}{input("Second country", "b", { listCountries: true })}</>)}
            {input("Relationship score (-100 to 100)", "score", { type: "number" })}
            {multiline("Relationship summary", "summary")}
          </>
        ) : null}
        {kind === "agreement" ? (
          <>
            {input("Agreement title", "title")}
            {select("Agreement type", "type", DAY_ONE_AGREEMENT_TYPES, legacy ? (value) => change("type", value) : onChangeType)}
            {!legacy && fact?.type === "guarantee" ? (
              twoColumns(<>{input("Guarantor (protecting country)", "guarantor", { listCountries: true })}{input("Beneficiary (protected country)", "beneficiary", { listCountries: true })}</>)
            ) : !legacy && fact?.type === "military_access" && !reciprocal && !legacyUndirectedAccess ? (
              <>
                <label style={{ color: "#f4f4f5", display: "flex", gap: "0.45rem", fontSize: "0.72rem" }}>
                  <input checked={false} disabled={disabled} onChange={(event) => onReciprocalChange(event.target.checked)} type="checkbox" />
                  Reciprocal access (both countries grant access)
                </label>
                {twoColumns(<>{input("Access grantor", "grantor", { listCountries: true })}{input("Access grantee", "grantee", { listCountries: true })}</>)}
              </>
            ) : (
              <>
                {!legacy && fact?.type === "military_access" ? (
                  <>
                    <label style={{ color: "#f4f4f5", display: "flex", gap: "0.45rem", fontSize: "0.72rem" }}>
                      <input checked={reciprocal} disabled={disabled} onChange={(event) => onReciprocalChange(event.target.checked)} type="checkbox" />
                      Reciprocal access (both countries grant access)
                    </label>
                    {legacyUndirectedAccess ? <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.68rem" }}>The original access direction was not recorded; editing this treaty does not invent one.</div> : null}
                  </>
                ) : null}
                {countryRows("Signatory countries", "parties")}
              </>
            )}
            {multiline("Terms / obligations", "terms")}
            {!legacy ? input("Signed / effective date (optional)", "startedDate", { hint: canonicalAgreement ? "YYYY-MM-DD, no later than the scenario start." : "YYYY-MM-DD, before the game begins." }) : null}
            {canonicalAgreement && ["ended", "expired"].includes(fact?.status) ?
              input("Agreement ended date (optional)", "endedDate", { hint: "YYYY-MM-DD, no later than the scenario start." }) : null}
          </>
        ) : null}
        {kind === "storyline" ? (
          <>
            {input("Storyline title", "title")}
            {twoColumns(<>
              {input("Process kind (e.g. diplomacy or crisis)", legacy ? "kind" : "processKind")}
              {select("Status", "status", ["active", "dormant"])}
            </>)}
            {countryRows("Participating countries", "participants")}
            {twoColumns(<>
              {input("Pressure (0-100)", "pressure", { type: "number" })}
              {input("Momentum (0-100)", "momentum", { type: "number" })}
            </>)}
            {multiline("What is happening now", "state")}
            {input("Started date (optional)", "startedDate", { hint: "YYYY-MM-DD, before the game begins." })}
          </>
        ) : null}
        {problems.map((problem, index) => (
          <div key={index} style={{ color: "#fca5a5", fontSize: "0.67rem" }}>{problem}</div>
        ))}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="oh-tap" disabled={disabled} onClick={onRemove} style={compactButton} type="button">Remove fact</button>
        </div>
      </div>
    </details>
  );
}
