/*! Open Historia — the diplomatic map's legend and tooltip © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The diplomatic map's legend (MapModeSelector.jsx mounts it over the map
// switch): the four views, what each is about (the focus country, a war, an
// institution, what governments are coloured by), and what is on the map now,
// each entry with how many countries are in it, its swatch the very colour of
// the fill. Clicking an entry picks its countries out and dims the rest
// (Nations.jsx); clicking it again lets go. Only what is on the map is listed.
//
// The view itself is one computation for the whole map (Map/useDiplomaticView.js).
import React, { memo, useSyncExternalStore } from "react";
import { getDiplomaticHover, setDiplomaticMapState, subscribeDiplomaticHover } from "../../runtime/diplomaticMapSettings.js";
import { DIPLO_UNKNOWN, HATCH_COLORS } from "../../runtime/diplomaticPalette.js";
import {
  DIPLOMATIC_VIEWS,
  DIPLOMATIC_VIEW_LABELS,
  GOVERNMENT_AXES,
  GOVERNMENT_AXIS_LABELS,
  PRECEDENCE_TOOLTIP,
  diplomaticTieOf,
} from "../../runtime/diplomaticViews.js";
import { useActiveGameCountry } from "../../runtime/library.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { OPEN_COUNTRY_STATS_EVENT } from "../Selection/CountryPanel.jsx";
import { useDiplomaticMapState, useDiplomaticView } from "../Map/useDiplomaticView.js";
import { HATCH_STYLE } from "../Map/diplomaticHatch.js";

const LEGEND_TEXTS = Object.freeze({
  title: "Diplomacy",
  collapse: "Hide legend",
  focus: "Focus",
  backToMine: "Back to my country",
  dossier: "Dossier",
  noInstitutions: "No institutions in this world",
  pickInstitution: "Pick an institution",
  noWars: "No wars in the world",
  clickToFocus: "Click a country to make it the focus",
  institution: "Institution",
  groups: "Groups",
  groupsHint: "Each group's area is drawn in its standing with the focus.",
});

const VIEW_ICONS = {
  relations: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" /><circle cx="4" cy="6" r="2" /><circle cx="20" cy="6" r="2" /><circle cx="12" cy="21" r="2" />
      <path d="M6 7l4 3.5M18 7l-4 3.5M12 15v4" />
    </svg>
  ),
  wars: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 4l10 10M14 14l-2 4 6-6-4 2M20 4L10 14M10 14l2 4-6-6 4 2" />
    </svg>
  ),
  blocs: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="9" cy="10" r="5.5" /><circle cx="15" cy="14" r="5.5" />
    </svg>
  ),
  government: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M3 21h18M5 21V10M10 21V10M14 21V10M19 21V10M2 10h20L12 3z" />
    </svg>
  ),
};

// A swatch in the colour of the fill, hatched as the map hatches it.
const FORWARD = "M-2 6L6 -2M-2 13L13 -2M5 16L16 5M12 16L16 12";
const BACKWARD = "M-2 8L6 16M-2 1L13 16M5 -2L16 9M12 -2L16 2";
const Swatch = ({ color, hatch }) => {
  const style = hatch ? HATCH_STYLE[hatch] : null;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style={{ flexShrink: 0, borderRadius: 3 }}>
      <rect width="14" height="14" rx="3" fill={color || DIPLO_UNKNOWN} />
      {style && (
        <g stroke={HATCH_COLORS[hatch]} strokeWidth="1.6" opacity="0.9">
          {style !== "back" && <path d={FORWARD} />}
          {style !== "diag" && <path d={BACKWARD} />}
        </g>
      )}
      <rect x="0.5" y="0.5" width="13" height="13" rx="2.5" fill="none" stroke="rgba(255,255,255,0.22)" />
    </svg>
  );
};

const chip = (on) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.25rem",
  // Each as wide as its name: four names fit the legend's width; on a phone the
  // others show their icon alone.
  flex: "1 1 auto",
  minWidth: 0,
  padding: "0.28rem 0.3rem",
  borderRadius: "7px",
  border: "1px solid",
  borderColor: on ? "var(--oh-ui-glass-active-line, rgba(255,255,255,0.28))" : "transparent",
  background: on ? "var(--oh-ui-glass-active, rgba(255,255,255,0.14))" : "transparent",
  color: on ? "#ffffff" : "rgba(255,255,255,0.62)",
  fontSize: "0.66rem",
  fontWeight: on ? 600 : 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
});

const smallButton = {
  border: "1px solid var(--oh-hud-border)",
  background: "transparent",
  color: "rgba(255,255,255,0.82)",
  borderRadius: "6px",
  padding: "0.12rem 0.4rem",
  fontSize: "0.64rem",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const CountryName = ({ name }) => <>{useCountryDisplayName(name) || name}</>;

// A category of the groups' standing with the focus (diplomaticViews.js
// `groupEntries`): an outlined swatch, as a group's area is drawn, the groups in it
// named, and how many.
const GroupEntryRow = ({ entry, names }) => (
  <div
    data-oh-diplomatic-group-entry={entry.id}
    title={names.join(", ")}
    style={{ display: "flex", alignItems: "center", gap: "0.45rem", padding: "0.16rem 0.3rem", fontSize: "0.68rem", color: "rgba(255,255,255,0.9)", minWidth: 0 }}
  >
    <span aria-hidden="true" style={{ width: "0.85rem", height: "0.85rem", flexShrink: 0, borderRadius: "3px", border: `2px solid ${entry.color}`, background: `${entry.color}80`, boxSizing: "border-box" }} />
    <span style={{ flex: "0 0 auto" }}>{entry.label}</span>
    <span data-no-translate style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(255,255,255,0.55)" }}>{names.join(", ")}</span>
    <span data-no-translate style={{ color: "rgba(255,255,255,0.6)", fontVariantNumeric: "tabular-nums" }}>{entry.count}</span>
  </div>
);

const EntryRow = ({ entry, picked, dimmed, onPick }) => (
  <button
    type="button"
    onClick={onPick}
    aria-pressed={picked}
    title={entry.label}
    style={{
      display: "flex",
      alignItems: "center",
      gap: "0.45rem",
      width: "100%",
      padding: "0.16rem 0.3rem",
      border: "1px solid",
      borderColor: picked ? "var(--oh-ui-glass-active-line, rgba(255,255,255,0.3))" : "transparent",
      borderRadius: "6px",
      background: picked ? "var(--oh-ui-glass-active, rgba(255,255,255,0.1))" : "transparent",
      color: "rgba(255,255,255,0.9)",
      opacity: dimmed ? 0.45 : 1,
      cursor: "pointer",
      textAlign: "left",
      fontSize: "0.7rem",
      lineHeight: 1.25,
    }}
  >
    <Swatch color={entry.color} hatch={entry.hatch} />
    <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.label}</span>
    <span style={{ color: "rgba(255,255,255,0.55)", fontVariantNumeric: "tabular-nums" }}>{entry.count}</span>
  </button>
);

// One war: its name (click to pick it out) and its sides, each in its colour.
const WarRow = ({ war, focused, dimmed, onPick }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem", opacity: dimmed ? 0.45 : 1 }}>
    <button
      type="button"
      onClick={onPick}
      aria-pressed={focused}
      style={{
        ...smallButton,
        border: "1px solid",
        borderColor: focused ? "var(--oh-ui-glass-active-line, rgba(255,255,255,0.3))" : "transparent",
        background: focused ? "var(--oh-ui-glass-active, rgba(255,255,255,0.1))" : "transparent",
        textAlign: "left",
        fontSize: "0.68rem",
        fontWeight: 600,
        padding: "0.16rem 0.3rem",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {war.label}
    </button>
    {war.sides.map((side, index) => (
      <div key={index} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0 0.3rem 0 0.9rem", fontSize: "0.66rem", color: "rgba(255,255,255,0.8)" }}>
        <Swatch color={side.color} hatch={war.status === "ceasefire" ? "ceasefire" : null} />
        <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {side.names.slice(0, 2).map((name, at) => (
            <React.Fragment key={name}>{at > 0 ? ", " : ""}<CountryName name={name} /></React.Fragment>
          ))}
          {side.names.length > 2 ? ` +${side.names.length - 2}` : ""}
        </span>
        <span style={{ color: "rgba(255,255,255,0.5)", fontVariantNumeric: "tabular-nums" }}>{side.count}</span>
      </div>
    ))}
  </div>
);

export const DiplomaticLegend = memo(function DiplomaticLegend({ isMobile = false }) {
  const view = useDiplomaticView();
  const settings = useDiplomaticMapState();
  const player = useActiveGameCountry();
  if (!view) return null;
  const highlight = settings.highlight;
  const pick = (entry) => setDiplomaticMapState({ highlight: highlight?.id === entry.id ? null : { id: entry.id, colors: entry.colors } });
  const focusName = view.view === "relations" ? view.focusName : "";
  const focusIsMine = !settings.focus || settings.focus === player;
  return (
    <div
      data-oh-diplomatic-legend=""
      style={{
        background: "var(--oh-ui-glass-pill, var(--oh-hud-bg))",
        backdropFilter: "var(--oh-hud-blur)",
        WebkitBackdropFilter: "var(--oh-hud-blur)",
        border: "1px solid var(--oh-hud-border)",
        borderRadius: "12px",
        boxShadow: "var(--oh-hud-shadow-soft)",
        padding: "0.45rem 0.5rem 0.5rem",
        color: "white",
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
        width: isMobile ? "min(19rem, calc(100vw - 1rem))" : "20rem",
        maxHeight: isMobile ? "min(46vh, 22rem)" : "min(62vh, 30rem)",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "rgba(255,255,255,0.75)" }}>
        <span style={{ flex: "1 1 auto" }}>{LEGEND_TEXTS.title}</span>
        {view.view === "relations" && (
          <span title={PRECEDENCE_TOOLTIP} aria-label={PRECEDENCE_TOOLTIP} role="img" style={{ cursor: "help", fontSize: "0.72rem", textTransform: "none", color: "rgba(255,255,255,0.6)" }}>ⓘ</span>
        )}
        <button
          type="button"
          onClick={() => setDiplomaticMapState({ legendOpen: false })}
          title={LEGEND_TEXTS.collapse}
          aria-label={LEGEND_TEXTS.collapse}
          style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", padding: "0 0.15rem", fontSize: "0.8rem", lineHeight: 1 }}
        >
          ▾
        </button>
      </div>

      <div role="tablist" style={{ display: "flex", gap: "0.15rem", background: "rgba(0,0,0,0.18)", borderRadius: "9px", padding: "0.15rem" }}>
        {DIPLOMATIC_VIEWS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view.view === id}
            title={DIPLOMATIC_VIEW_LABELS[id]}
            onClick={() => setDiplomaticMapState({ view: id })}
            style={chip(view.view === id)}
          >
            {VIEW_ICONS[id]}
            {!isMobile || view.view === id ? <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{DIPLOMATIC_VIEW_LABELS[id]}</span> : null}
          </button>
        ))}
      </div>

      {view.view === "relations" && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.68rem", flexWrap: "wrap" }}>
          <span style={{ color: "rgba(255,255,255,0.55)" }}>{LEGEND_TEXTS.focus}</span>
          <strong title={LEGEND_TEXTS.clickToFocus} style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <CountryName name={focusName} />
          </strong>
          {!focusIsMine && player && (
            <button type="button" style={smallButton} onClick={() => setDiplomaticMapState({ focus: "" })}>{LEGEND_TEXTS.backToMine}</button>
          )}
          {focusName && (
            <button
              type="button"
              style={smallButton}
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_COUNTRY_STATS_EVENT, { detail: { country: focusName } }))}
            >
              {LEGEND_TEXTS.dossier}
            </button>
          )}
        </div>
      )}

      {view.view === "blocs" && (
        view.noInstitutions
          ? <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.7)" }}>{LEGEND_TEXTS.noInstitutions}</div>
          : (
            <select
              aria-label={LEGEND_TEXTS.institution}
              value={view.institutionId}
              onChange={(event) => setDiplomaticMapState({ institution: event.target.value || "" })}
              style={{ background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid var(--oh-hud-border)", borderRadius: "7px", padding: "0.22rem 0.3rem", fontSize: "0.68rem" }}
            >
              {!view.institutionId && <option value="">{LEGEND_TEXTS.pickInstitution}</option>}
              {view.institutions.map((entry) => (
                <option key={entry.id} value={entry.id}>{`${entry.label} (${entry.members})`}</option>
              ))}
            </select>
          )
      )}

      {view.view === "government" && (
        <div role="tablist" style={{ display: "flex", gap: "0.15rem" }}>
          {GOVERNMENT_AXES.map((axis) => (
            <button key={axis} type="button" role="tab" aria-selected={view.axis === axis} onClick={() => setDiplomaticMapState({ axis })} style={chip(view.axis === axis)}>
              {GOVERNMENT_AXIS_LABELS[axis]}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.12rem", overflowY: "auto", minHeight: 0, margin: "0 -0.2rem", padding: "0 0.2rem" }}>
        {view.view === "wars" && !view.legend.wars?.length && (
          <div style={{ fontSize: "0.68rem", color: "rgba(255,255,255,0.7)" }}>{LEGEND_TEXTS.noWars}</div>
        )}
        {view.view === "wars" && view.legend.wars?.map((war) => (
          <WarRow
            key={war.id}
            war={war}
            focused={settings.focusWar === war.id}
            dimmed={Boolean(settings.focusWar) && settings.focusWar !== war.id}
            onPick={() => {
              const on = settings.focusWar !== war.id;
              setDiplomaticMapState({ focusWar: on ? war.id : "", highlight: on ? { id: `war:${war.id}`, colors: war.colors } : null });
            }}
          />
        ))}
        {view.legend.entries.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            picked={highlight?.id === entry.id}
            dimmed={Boolean(highlight) && highlight.id !== entry.id}
            onPick={() => (entry.colors?.length ? pick(entry) : null)}
          />
        ))}
        {view.view === "relations" && view.groupEntries?.length > 0 && (
          <div data-oh-diplomatic-groups="" style={{ display: "flex", flexDirection: "column", gap: "0.05rem", marginTop: "0.25rem", paddingTop: "0.3rem", borderTop: "1px solid var(--oh-ui-line, rgba(255,255,255,0.1))" }}>
            <div title={LEGEND_TEXTS.groupsHint} style={{ fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)", padding: "0 0.3rem" }}>{LEGEND_TEXTS.groups}</div>
            {view.groupEntries.map((entry) => (
              <GroupEntryRow key={entry.id} entry={entry} names={view.groups.filter((group) => group.category === entry.id).map((group) => group.name)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

// The country under the pointer and its tie, one short line (Nations.jsx
// reports where the pointer is).
export const DiplomaticTooltip = memo(function DiplomaticTooltip() {
  const view = useDiplomaticView();
  const hover = useSyncExternalStore(subscribeDiplomaticHover, getDiplomaticHover, getDiplomaticHover);
  if (!view || !hover?.owner) return null;
  const tie = diplomaticTieOf(view, hover.owner);
  const left = Math.min(hover.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 230);
  return (
    <div
      role="tooltip"
      data-oh-diplomatic-tooltip=""
      style={{
        position: "fixed",
        left,
        top: hover.y + 16,
        zIndex: 9996,
        pointerEvents: "none",
        background: "var(--oh-ui-overlay, rgba(24,24,27,0.95))",
        border: "1px solid var(--oh-hud-border)",
        borderRadius: "8px",
        padding: "0.3rem 0.5rem",
        color: "white",
        fontSize: "0.7rem",
        lineHeight: 1.3,
        maxWidth: "15rem",
        boxShadow: "var(--oh-hud-shadow-soft)",
      }}
    >
      <div style={{ fontWeight: 700 }}><CountryName name={hover.owner} /></div>
      {tie && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", color: "rgba(255,255,255,0.82)" }}>
          <Swatch color={view.colorOf(hover.owner)} hatch={view.infoOf(hover.owner).hatch} />
          <span>{tie[0]}</span>
          {tie[1] ? <><span aria-hidden="true">·</span><span>{tie[1]}</span></> : null}
        </div>
      )}
    </div>
  );
});

export default DiplomaticLegend;
