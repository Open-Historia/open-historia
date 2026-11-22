/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */
import { pillButton } from "./editorStyles.js";
import { COUNTRY_DETAIL_TABS } from "./countryDetailTabs.js";
import CountryOverview from "./CountryOverview.jsx";

export default function CountryDetailsNavigation({ current, tab, onTabChange, color, flags, tags, polities, puppets }) {
  const name = current.name;
  const regionCount = current.regionCount || 0;
  return (
    <>
      <div style={{
        display: "flex", alignItems: "center", gap: 11, padding: "12px",
        background: "var(--oh-ui-raised, #171a22)",
        border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.12))",
        borderRadius: 12,
      }}>
        <span aria-hidden="true" style={{
          display: "block", width: 30, height: 30, borderRadius: 9, flexShrink: 0,
          background: Array.isArray(color) ? `rgb(${color.join(",")})` : "rgba(255,255,255,.15)",
          border: "1px solid rgba(255,255,255,.24)",
        }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: "block", fontSize: 15.5, overflowWrap: "anywhere", lineHeight: 1.25 }}>{name}</strong>
          <span style={{ fontSize: 11, color: "var(--oh-ui-muted, #b4c4d0)" }}>
            {regionCount ? `${regionCount} owned regions` : "Landless country"}
            {current.claimantCount ? ` · ${current.claimantCount} claims` : ""}
          </span>
        </span>
      </div>
      <div role="tablist" aria-label="Country details" style={{
        display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap",
        padding: "2px 0", marginTop: 4,
      }}>
        {COUNTRY_DETAIL_TABS.map(({ id, label, description }) => (
          <button
            type="button"
            role="tab"
            key={id}
            title={description}
            aria-selected={tab === id}
            onClick={() => onTabChange(id)}
            style={{
              ...pillButton(tab === id),
              fontSize: 11.5, padding: "8px 10px",
              borderColor: tab === id ? "var(--oh-ui-accent, rgba(255,255,255,.3))" : undefined,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <CountryOverview current={current} flags={flags} tags={tags} polities={polities} puppets={puppets} onTabChange={onTabChange} />
      )}
    </>
  );
}
