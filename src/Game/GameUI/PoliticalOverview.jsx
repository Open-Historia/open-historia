/*! Open Historia — Country political overview / party landscape */
// The Political World of a country (runtime/politicalActors.js), as the Stats
// pane's Politics view shows it. Its parties and government carry what the
// Politics tab once kept apart: native names, the ten ideologies, roles, seats,
// the legislature and the next election ("add the new politics thing into the
// political world and just make it an enhancement of that", the owner,
// 2026-11-03). A country whose parties lack them can have them filled in on
// the player's asking (onCompile: Game/AI/gameplay.js assessPoliticalLandscape).
import React, { useEffect, useMemo, useState } from "react";
import { buildGovernmentPartyPresentation, buildPoliticalLandscapeViews } from "../../runtime/politicalPresentation.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { PARTY_ROLE_LABELS, findIdeology, isListedSubideology } from "../../runtime/politics.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value.map(clean).filter(Boolean) : (clean(value) ? [clean(value)] : []));

const sectionLabel = {
  color: "#aac8dc",
  fontSize: "0.65rem",
  fontWeight: 850,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
};

const card = {
  background: "rgba(255,255,255,0.042)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "12px",
};

const officeholderName = (value) => {
  if (typeof value === "string") return clean(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return clean(value.name || value.id);
};

const stableHue = (value) => {
  let hash = 2166136261;
  for (const char of clean(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 360;
};

const partyColor = (party) => {
  const authored = clean(party?.color);
  if (/^#[0-9a-f]{3,8}$/i.test(authored) || /^rgb(a)?\(/i.test(authored) || /^hsl(a)?\(/i.test(authored)) return authored;
  if (party?.isOther) return "rgba(148,163,184,0.72)";
  return `hsl(${stableHue(party?.id || party?.name)} 68% 58%)`;
};

const polar = (cx, cy, radius, angle) => {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
};

const donutPath = (startAngle, endAngle, outerRadius = 78, innerRadius = 50) => {
  const cx = 90;
  const cy = 90;
  const startOuter = polar(cx, cy, outerRadius, endAngle);
  const endOuter = polar(cx, cy, outerRadius, startAngle);
  const startInner = polar(cx, cy, innerRadius, startAngle);
  const endInner = polar(cx, cy, innerRadius, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${endInner.x} ${endInner.y}`,
    "Z",
  ].join(" ");
};

const formatSupport = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return Number.isInteger(number) ? `${number}%` : `${number.toFixed(1)}%`;
};

const PartyDonut = ({ slices, selectedId, hoveredId, onSelect, onHover, centerLabel = "Political", centerSubLabel = "landscape", ariaLabel = "Political landscape" }) => {
  const segments = useMemo(() => {
    const result = [];
    let cursor = 0;
    for (const party of slices) {
      const span = Math.max(0, Number(party.chartPercent) || 0) * 3.6;
      const gap = span >= 7 ? 1.2 : 0.25;
      const start = cursor + gap / 2;
      const end = cursor + span - gap / 2;
      cursor += span;
      result.push({ party, start, end: Math.max(start + 0.1, end) });
    }
    return result;
  }, [slices]);

  const active = slices.find((party) => party.id === hoveredId)
    || slices.find((party) => party.id === selectedId)
    || null;
  const centerName = active ? (active.shortName || active.name) : centerLabel;
  const centerSub = active ? (active.displayValue || formatSupport(active.support)) : centerSubLabel;

  return (
    <div style={{ alignItems: "center", display: "flex", justifyContent: "center", minHeight: "172px", minWidth: 0 }}>
      <svg aria-label={ariaLabel} role="img" viewBox="0 0 180 180" style={{ display: "block", height: "auto", maxWidth: "185px", overflow: "visible", width: "100%" }}>
        <circle cx="90" cy="90" r="78" fill="rgba(255,255,255,0.025)" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        {segments.map(({ party, start, end }) => {
          const selected = party.id === selectedId;
          const hovered = party.id === hoveredId;
          return (
            <path
              key={party.id}
              d={donutPath(start, end)}
              fill={partyColor(party)}
              opacity={selected || hovered ? 1 : selectedId ? 0.58 : 0.9}
              stroke={selected ? "rgba(255,255,255,0.9)" : "rgba(11,15,23,0.88)"}
              strokeWidth={selected ? 2.4 : 1.5}
              role="button"
              tabIndex={0}
              aria-label={`${party.name}, ${party.displayValue || formatSupport(party.support)}`}
              onMouseEnter={() => onHover(party.id)}
              onMouseLeave={() => onHover("")}
              onClick={() => onSelect(party.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(party.id);
                }
              }}
              style={{ cursor: "pointer", filter: hovered ? "brightness(1.12)" : "none", outline: "none", transition: "opacity 120ms ease, filter 120ms ease, stroke-width 120ms ease" }}
            />
          );
        })}
        <circle cx="90" cy="90" r="47" fill="rgba(18,20,27,0.98)" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
        <text x="90" y="85" textAnchor="middle" fill="rgba(255,255,255,0.94)" fontSize="11" fontWeight="800">
          {centerName.length > 18 ? `${centerName.slice(0, 16)}…` : centerName}
        </text>
        <text x="90" y="101" textAnchor="middle" fill={active ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.36)"} fontSize="9" fontWeight="700">
          {centerSub}
        </text>
      </svg>
    </div>
  );
};

const Badge = ({ children, tone = "rgba(255,255,255,0.06)", border = "var(--oh-grey-border)", color = "var(--oh-grey-text)" }) => (
  <span style={{ background: tone, border: `1px solid ${border}`, borderRadius: "999px", color, fontSize: "0.58rem", fontWeight: 750, padding: "0.12rem 0.38rem" }}>
    {children}
  </span>
);

const DetailList = ({ title, values }) => {
  const items = list(values);
  if (!items.length) return null;
  return (
    <div style={{ marginTop: "0.65rem" }}>
      <div style={{ ...sectionLabel, fontSize: "0.56rem" }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.28rem", marginTop: "0.32rem" }}>
        {items.map((item) => (
          <div key={item} style={{ color: "rgba(255,255,255,0.68)", fontSize: "0.68rem", lineHeight: 1.4 }}>• {item}</div>
        ))}
      </div>
    </div>
  );
};

// A party's role's colour, as the Politics card gave it: who governs warm, the outlawed red.
const ROLE_TONES = {
  governing: "#fbbf24",
  coalition: "#fcd34d",
  opposition: "#93c5fd",
  extraParliamentary: "#94a3b8",
  underground: "#9aa1ab",
  exile: "#9aa1ab",
  banned: "#f87171",
};
// Its role: the government's own parties by the government, any other by what the record says (opposition if nothing).
const roleOf = (party) => (party?.ruling ? "governing" : party?.coalition ? "coalition" : PARTY_ROLE_LABELS[party?.role] ? party.role : "opposition");

// What a party row opens onto: what the row does not already say (its description, the words of its outlook, its
// priorities and foreign policy), from the Political World.
const PartyMore = ({ party }) => {
  if (party.isOther) {
    return (
      <div style={{ padding: "0 0.65rem 0.6rem" }}>
        {party.members?.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.38rem" }}>
            {party.members.map((member) => (
              <div key={member.id} style={{ alignItems: "center", display: "flex", gap: "0.45rem", justifyContent: "space-between" }}>
                <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.68rem" }}>{member.name}</span>
                <span style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.65rem", fontWeight: 800 }}>{formatSupport(member.support)}</span>
              </div>
            ))}
          </div>
        )}
        {party.unlistedSupport > 0.05 && (
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.62rem", lineHeight: 1.42, marginTop: "0.58rem" }}>
            {formatSupport(party.unlistedSupport)} is not individually represented in the current public political profile.
          </div>
        )}
      </div>
    );
  }
  const family = findIdeology(party.ideologyFamily);
  // (The ten ideologies' own name and the subideology stand for the free text where it only repeats them.)
  const ideology = list(party.ideology).filter((item) => item.toLowerCase() !== String(family?.name ?? "").toLowerCase() && item.toLowerCase() !== String(party.subideology ?? "").toLowerCase());
  const hasDetail = ideology.length || party.publicDescription || party.goals?.length || party.publicPriorities?.length || party.publicForeignPolicy?.length;
  return (
    <div style={{ padding: "0 0.65rem 0.62rem" }}>
      {party.publicDescription && <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.67rem", lineHeight: 1.46 }}>{party.publicDescription}</div>}
      {ideology.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.28rem", marginTop: "0.45rem" }}>
          {ideology.map((item) => <Badge key={item}>{item}</Badge>)}
        </div>
      )}
      <DetailList title="Public priorities" values={party.publicPriorities?.length ? party.publicPriorities : party.goals} />
      <DetailList title="Foreign-policy outlook" values={party.publicForeignPolicy} />
      {!hasDetail && (
        <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.64rem", lineHeight: 1.42 }}>
          No additional public party information is currently available.
        </div>
      )}
    </div>
  );
};

// One party in the list: at a glance what the Politics card showed (its names, its role, its ideology, leader,
// seats, support and founding), and on a click what the Political World knows besides (PartyMore). The share of
// political support no party of the record's own explains is a row of its own.
const PartyRow = ({ party, open, onToggle, legislatureSeats = 0, onHover = () => {} }) => {
  const family = findIdeology(party.ideologyFamily);
  const listed = isListedSubideology(party.ideologyFamily, party.subideology);
  const abbreviations = [...new Set([party.shortNameNative, party.shortName].map(clean).filter(Boolean))].join(" · ");
  const role = roleOf(party);
  const seats = Number.isFinite(party.seats) ? party.seats : null;
  return (
    <div style={{ borderLeft: `3px solid ${partyColor(party)}`, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        onMouseEnter={() => onHover(party.id)}
        onMouseLeave={() => onHover("")}
        style={{ background: open ? "rgba(255,255,255,0.04)" : "transparent", border: 0, color: "inherit", cursor: "pointer", display: "block", padding: "0.55rem 0.65rem", textAlign: "left", width: "100%" }}
      >
        <div style={{ alignItems: "flex-start", display: "flex", gap: "0.6rem", justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.74rem", fontWeight: 800 }}>
              {party.isOther
                ? <span>Other political support</span>
                : <span data-no-translate>{party.name}{abbreviations && <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 700 }}> ({abbreviations})</span>}</span>}
            </div>
            {!party.isOther && clean(party.nameNative) && clean(party.nameNative) !== clean(party.name) && (
              <div data-no-translate style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.65rem", fontStyle: "italic", marginTop: "0.1rem" }}>{party.nameNative}</div>
            )}
          </div>
          {party.isOther
            ? <span style={{ color: "rgba(255,255,255,0.48)", flexShrink: 0, fontSize: "0.65rem", fontWeight: 800 }}>{formatSupport(party.support)}</span>
            : <span style={{ border: `1px solid ${ROLE_TONES[role]}55`, borderRadius: "999px", color: ROLE_TONES[role], flexShrink: 0, fontSize: "0.56rem", fontWeight: 800, padding: "0.1rem 0.38rem" }}>{PARTY_ROLE_LABELS[role]}</span>}
        </div>
        {!party.isOther && (family || clean(party.subideology)) && (
          <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.64rem", marginTop: "0.25rem" }}>
            {family && <span style={{ color: family.colour || "#94a3b8", fontWeight: 800 }}>{family.name}</span>}
            {clean(party.subideology) && (family
              ? (
                <span
                  title={listed ? undefined : "Not one of this ideology's listed subideologies"}
                  style={{ color: listed ? "rgba(255,255,255,0.62)" : "rgba(255,255,255,0.35)" }}
                > · {party.subideology}{listed ? "" : " (unlisted)"}</span>
              )
              : <span data-no-translate>{party.subideology}</span>)}
          </div>
        )}
        {!party.isOther && (
          <div style={{ color: "rgba(255,255,255,0.5)", display: "flex", flexWrap: "wrap", fontSize: "0.62rem", gap: "0.15rem 0.7rem", marginTop: "0.2rem" }}>
            {party.leader && <span>Leader: <span style={{ color: "rgba(255,255,255,0.8)" }}>{party.leader}</span></span>}
            {seats !== null && <span data-no-translate>{seats}{legislatureSeats ? `/${legislatureSeats}` : ""} seats</span>}
            {Number.isFinite(party.support) && <span data-no-translate>{formatSupport(party.support)} support</span>}
            {party.supportApproximate && <span style={{ color: "rgba(253,230,138,0.62)", fontSize: "0.54rem", textTransform: "uppercase" }}>Approximate</span>}
            {clean(party.founded) && <span>Founded {party.founded}</span>}
          </div>
        )}
      </button>
      {open && <PartyMore party={party} />}
    </div>
  );
};

const PowerBlocDetail = ({ bloc, onClose }) => {
  if (!bloc) return null;
  const ideology = list(bloc.ideology);
  const hasDetail = bloc.leader || bloc.kind || bloc.status || ideology.length || bloc.publicDescription || bloc.goals?.length || bloc.publicPriorities?.length || bloc.publicForeignPolicy?.length;
  return (
    <div style={{ ...card, marginTop: "0.7rem", padding: "0.76rem 0.8rem" }}>
      <div style={{ alignItems: "flex-start", display: "flex", gap: "0.55rem", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
            <span style={{ color: "rgba(255,255,255,0.95)", fontSize: "0.8rem", fontWeight: 850 }}>{bloc.name}</span>
            {bloc.kind && <Badge>{bloc.kind}</Badge>}
            {bloc.status && <Badge tone="rgba(245,158,11,0.12)" border="rgba(245,158,11,0.25)" color="#fde68a">{bloc.status}</Badge>}
          </div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.66rem", fontWeight: 800, marginTop: "0.15rem" }}>
            {bloc.displayValue || "Influence not quantified"}{bloc.displayValue ? " influence" : ""}
            {bloc.influenceApproximate && <span style={{ color: "rgba(253,230,138,0.62)", fontSize: "0.56rem", marginLeft: "0.35rem", textTransform: "uppercase" }}>Approximate</span>}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close power bloc details" style={{ background: "none", border: 0, color: "rgba(255,255,255,0.42)", cursor: "pointer", fontSize: "0.9rem", padding: 0 }}>×</button>
      </div>

      {bloc.publicDescription && <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.67rem", lineHeight: 1.46, marginTop: "0.55rem" }}>{bloc.publicDescription}</div>}
      {bloc.leader && (
        <div style={{ display: "grid", gap: "0.2rem", gridTemplateColumns: "5.6rem minmax(0,1fr)", marginTop: "0.58rem" }}>
          <span style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.62rem", fontWeight: 750 }}>Leading figure</span>
          <span style={{ color: "rgba(255,255,255,0.76)", fontSize: "0.66rem", fontWeight: 700 }}>{bloc.leader}</span>
        </div>
      )}
      {ideology.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.28rem", marginTop: "0.58rem" }}>
          {ideology.map((item) => <Badge key={item}>{item}</Badge>)}
        </div>
      )}
      <DetailList title="Public priorities" values={bloc.publicPriorities?.length ? bloc.publicPriorities : bloc.goals} />
      <DetailList title="Foreign-policy outlook" values={bloc.publicForeignPolicy} />
      {!hasDetail && (
        <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.64rem", lineHeight: 1.42, marginTop: "0.58rem" }}>
          No additional public information about this power bloc is currently available.
        </div>
      )}
    </div>
  );
};

const PowerBlocLedger = ({ entries, selectedId, onSelect, onHover }) => (
  <div className="oh-country-bloc-ledger" role="list" aria-label="Recorded political influence">
    {entries.map((bloc) => {
      const quantified = Number.isFinite(bloc.influence);
      return (
        <div key={bloc.id} className="oh-country-bloc-entry" role="listitem" data-expanded={selectedId === bloc.id ? "true" : undefined}>
          <button
            type="button"
            className="oh-country-bloc-button"
            aria-expanded={selectedId === bloc.id}
            onClick={() => onSelect(bloc.id)}
            onMouseEnter={() => onHover(bloc.id)}
            onMouseLeave={() => onHover("")}
          >
            <div className="oh-country-bloc-heading">
              <span data-no-translate className="oh-country-bloc-name">{bloc.name}</span>
              <span data-no-translate className="oh-country-bloc-value">{bloc.displayValue || "Not quantified"}</span>
            </div>
            {quantified ? (
              <div className="oh-country-bloc-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bloc.influence} aria-label={`${bloc.name}: ${bloc.displayValue} influence`}>
                <div className="oh-country-bloc-fill" style={{ backgroundColor: partyColor(bloc), width: `${bloc.influence}%` }} />
              </div>
            ) : (
              <div className="oh-country-bloc-qualitative">
                {bloc.influenceLabel ? "Qualitative influence assessment" : "No numeric influence recorded"}
              </div>
            )}
            {(bloc.kind || bloc.leader || bloc.status) && (
              <div className="oh-country-bloc-meta">
                {bloc.kind && <span data-no-translate>{bloc.kind.replaceAll("_", " ")}</span>}
                {bloc.leader && <span data-no-translate>{bloc.leader}</span>}
                {bloc.status && <span data-no-translate>{bloc.status}</span>}
              </div>
            )}
            {bloc.influenceApproximate && <div className="oh-country-bloc-approximate">Approximate</div>}
          </button>
          {selectedId === bloc.id && <PowerBlocDetail bloc={bloc} onClose={() => onSelect(bloc.id)} />}
        </div>
      );
    })}
  </div>
);

const GovernmentOverview = ({ profile, fallbackGovernment, fallbackLeader }) => {
  const government = profile?.government || {};
  const form = clean(government.form || fallbackGovernment);
  const headOfState = officeholderName(government.headOfState || fallbackLeader || profile?.leader);
  const headOfGovernment = officeholderName(government.headOfGovernment);
  const governmentParties = buildGovernmentPartyPresentation(profile);
  const legislature = clean(government.legislature);
  const legislatureSeats = Number(government.legislatureSeats) > 0 ? Number(government.legislatureSeats) : 0;
  const nextElection = clean(government.nextElection);
  const seated = (Array.isArray(profile?.parties) ? profile.parties : []).filter((party) => Number(party?.seats) > 0);

  if (!form && !headOfState && !headOfGovernment && !governmentParties.names.length && !legislature && !nextElection && !legislatureSeats) return null;
  return (
    <section className="oh-country-government" style={{ ...card, padding: "0.94rem 0.92rem" }}>
      <div style={sectionLabel}>Government</div>
      {form && <div style={{ color: "rgba(255,255,255,0.78)", fontSize: "0.73rem", fontWeight: 760, lineHeight: 1.35, marginTop: "0.34rem" }}>{form}</div>}
      <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: headOfGovernment && headOfGovernment !== headOfState ? "1fr 1fr" : "1fr", marginTop: form ? "0.68rem" : "0.35rem" }}>
        {headOfState && (
          <div>
            <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>Head of state</div>
            <div style={{ color: "#fbbf24", fontSize: "0.72rem", fontWeight: 780, lineHeight: 1.35, marginTop: "0.18rem" }}>{headOfState}</div>
          </div>
        )}
        {headOfGovernment && headOfGovernment !== headOfState && (
          <div>
            <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>Head of government</div>
            <div style={{ color: "rgba(255,255,255,0.78)", fontSize: "0.72rem", fontWeight: 760, lineHeight: 1.35, marginTop: "0.18rem" }}>{headOfGovernment}</div>
          </div>
        )}
      </div>
      {governmentParties.names.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.48)", fontSize: "0.63rem", lineHeight: 1.45, marginTop: "0.65rem", paddingTop: "0.55rem" }}>
          <span style={{ color: "rgba(255,255,255,0.34)" }}>
            {governmentParties.names.length > 1 ? "Governing coalition:" : "Government:"}
          </span>{" "}
          {governmentParties.names.join(" | ")}
        </div>
      )}
      {(legislature || legislatureSeats > 0 || nextElection) && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.48)", display: "flex", flexDirection: "column", fontSize: "0.63rem", gap: "0.2rem", lineHeight: 1.45, marginTop: "0.55rem", paddingTop: "0.5rem" }}>
          {(legislature || legislatureSeats > 0) && (
            <div><span style={{ color: "rgba(255,255,255,0.34)" }}>Legislature</span> <span style={{ color: "rgba(255,255,255,0.72)" }}>{legislature}{legislatureSeats ? ` (${legislatureSeats} seats)` : ""}</span></div>
          )}
          {nextElection && <div><span style={{ color: "rgba(255,255,255,0.34)" }}>Next election</span> <span style={{ color: "rgba(255,255,255,0.72)" }}>{nextElection}</span></div>}
        </div>
      )}
      {seated.length > 0 && (
        <div style={{ borderRadius: "999px", display: "flex", height: "10px", marginTop: "0.5rem", overflow: "hidden" }}>
          {seated.map((party) => (
            <div
              key={party.id || party.name}
              title={`${party.shortName || party.name}: ${Number(party.seats) || 0} seats`}
              style={{ backgroundColor: partyColor(party), width: `${(Number(party.seats) / Math.max(legislatureSeats, seated.reduce((sum, entry) => sum + Number(entry.seats), 0))) * 100}%` }}
            />
          ))}
        </div>
      )}
    </section>
  );
};

// Fill in a country's parties (their seats, roles and ideologies, the legislature and the next election), or read
// them afresh: one AI request, on the player's asking (onCompile).
const PartiesCompile = ({ profile, onCompile, compiling = false, error = "" }) => {
  if (typeof onCompile !== "function") return null;
  const detailed = (Array.isArray(profile?.parties) ? profile.parties : []).some((party) => party?.ideologyFamily || Number.isFinite(party?.seats) || party?.role);
  return (
    <div className="oh-country-politics-secondary" style={{ ...card, marginTop: "0.65rem", padding: "0.6rem 0.78rem" }}>
      {compiling && <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.68rem" }}>Compiling the government and parties…</div>}
      {!compiling && !detailed && (
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.68rem", lineHeight: 1.4 }}>
          Its parties' seats, roles and ideologies have not been filled in yet. Filling them in asks the AI once.
        </div>
      )}
      {!compiling && (
        <button
          type="button"
          className="oh-tap-row"
          onClick={onCompile}
          style={{ background: "none", border: "none", color: "#93c5fd", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700, marginTop: detailed ? 0 : "0.4rem", padding: 0 }}
        >{detailed ? "Compile the government and parties again" : "Compile parties"}</button>
      )}
      {error && !compiling && <div role="alert" style={{ color: "#fca5a5", fontSize: "0.68rem", marginTop: "0.35rem" }}>{error}</div>}
    </div>
  );
};

// A long list shows its first rows and a toggle for the rest, so a badge
// counting fourteen never sits over ten rows with no way to the others.
const moreToggleStyle = {
  alignSelf: "flex-start",
  background: "transparent",
  border: 0,
  color: "rgba(255,255,255,0.55)",
  cursor: "pointer",
  fontSize: "0.6rem",
  fontWeight: 760,
  marginTop: "0.1rem",
  padding: "0.15rem 0",
};

const INSTITUTIONS_SHOWN = 10;
const FINDINGS_SHOWN = 4;

const InstitutionPortfolio = ({ rows = [] }) => {
  const [showAll, setShowAll] = useState(false);
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) return null;
  const lifecycleLabel = (entry) => {
    const current = entry?.member;
    if (current) return `${current.status || "member"}${current.role && current.role !== "member" ? ` / ${current.role}` : ""}`;
    const last = [...(entry?.history || [])].reverse().find(Boolean);
    if (!last) return "historical";
    if (["left", "withdrawn", "expelled"].includes(last.action)) return `former member · ${last.action}`;
    return last.action || "historical";
  };
  return (
    <section className="oh-country-institution-ledger">
      <div className="oh-country-institution-heading">
        <div style={{ minWidth: 0 }}>
          <div style={sectionLabel}>Institutions</div>
          <div style={{ color: "rgba(255,255,255,0.39)", fontSize: "0.61rem", marginTop: "0.2rem" }}>Canonical memberships and institutional history</div>
        </div>
        <span data-no-translate className="oh-country-institution-count">{items.length}</span>
      </div>
      <div className="oh-country-institution-list">
        {(showAll ? items : items.slice(0, INSTITUTIONS_SHOWN)).map((entry) => {
          const institution = entry?.institution || {};
          const pending = (entry?.cases || []).filter((item) => ["pending", "negotiating", "pending-approval"].includes(String(item?.status || "").toLowerCase()));
          const recent = [...(entry?.history || [])].reverse()[0];
          return (
            <div key={institution.id || institution.name} className="oh-country-institution-row" data-active={entry?.member ? "true" : "false"}>
              <span className="oh-country-institution-dot" aria-hidden="true" />
              <div className="oh-country-institution-main">
                <div className="oh-country-institution-name">{institution.name || institution.id}</div>
                <div className="oh-country-institution-meta">
                  {[entry?.member?.sinceDate ? `since ${(formatGameDateReadable(entry.member.sinceDate) || entry.member.sinceDate)}` : "", pending.length ? `${pending.length} pending lifecycle matter${pending.length === 1 ? "" : "s"}` : "", recent?.date && !entry?.member ? `last change ${(formatGameDateReadable(recent.date) || recent.date)}` : ""].filter(Boolean).join(" · ") || (institution.kind || "institution")}
                </div>
                {pending.slice(0, 2).map((item) => (
                  <div key={item.id} className="oh-country-institution-pending">• {item.kind} · {item.status}{item.requestedStatus ? ` · ${item.requestedStatus}` : ""}</div>
                ))}
              </div>
              <span className="oh-country-institution-status">{lifecycleLabel(entry)}</span>
            </div>
          );
        })}
      </div>
      {items.length > INSTITUTIONS_SHOWN && (
        <button onClick={() => setShowAll((open) => !open)} className="oh-country-institution-more" type="button">
          {showAll ? "Show fewer" : `Show all (${items.length})`}
        </button>
      )}
    </section>
  );
};

const IntelligenceAssessment = ({ intelligence }) => {
  const [showAllFindings, setShowAllFindings] = useState(false);
  if (!intelligence) return null;
  const allFindings = Array.isArray(intelligence.findings) ? intelligence.findings : [];
  const findings = showAllFindings ? allFindings : allFindings.slice(0, FINDINGS_SHOWN);
  return (
    <div className="oh-country-politics-secondary" style={{ ...card, background: "rgba(255,255,255,0.025)", borderColor: "var(--oh-grey-border)", marginTop: "0.85rem", padding: "0.72rem 0.78rem" }}>
      <div style={{ alignItems: "center", display: "flex", gap: "0.35rem", justifyContent: "space-between" }}>
        <div style={{ ...sectionLabel, color: "var(--oh-grey-text)" }}>🕵 Intelligence assessment</div>
        {intelligence.confidence && <Badge>{intelligence.confidence} confidence</Badge>}
      </div>
      {intelligence.summary && <div style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.69rem", lineHeight: 1.48, marginTop: "0.48rem" }}>{intelligence.summary}</div>}
      {findings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.46rem", marginTop: "0.58rem" }}>
          {findings.map((finding, index) => (
            <div key={`${finding.topic || "finding"}-${index}`} style={{ borderLeft: "2px solid rgba(255,255,255,0.22)", paddingLeft: "0.55rem" }}>
              {finding.topic && <div style={{ color: "var(--oh-grey-muted)", fontSize: "0.58rem", fontWeight: 800 }}>{finding.topic}</div>}
              <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.65rem", lineHeight: 1.43, marginTop: finding.topic ? "0.12rem" : 0 }}>{finding.text}</div>
            </div>
          ))}
          {allFindings.length > FINDINGS_SHOWN && (
            <button onClick={() => setShowAllFindings((open) => !open)} style={moreToggleStyle} type="button">
              {showAllFindings ? "Show fewer" : `Show all findings (${allFindings.length})`}
            </button>
          )}
        </div>
      )}
      {(intelligence.source || intelligence.gatheredAt || intelligence.stale) && (
        <div style={{ color: intelligence.stale ? "#fbbf24" : "rgba(255,255,255,0.34)", fontSize: "0.57rem", lineHeight: 1.38, marginTop: "0.58rem" }}>
          {[intelligence.source, intelligence.gatheredAt ? `Report ${intelligence.gatheredAt}` : "", intelligence.stale ? "Stale" : ""].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
};

export default function PoliticalOverview({ profile, fallbackGovernment = "", fallbackLeader = "", intelligence = null, institutions = [], onCompile = null, compiling = false, compileError = "" }) {
  const views = useMemo(() => buildPoliticalLandscapeViews(profile), [profile]);
  const polityKey = clean(profile?.polityKey || profile?.name);
  const [viewChoice, setViewChoice] = useState({ polityKey: "", value: "" });
  const activeView = views.canSwitch && viewChoice.polityKey === polityKey && views[viewChoice.value]
    ? viewChoice.value : views.defaultView;
  const landscape = views[activeView] || null;
  const [selectedId, setSelectedId] = useState("");
  const [hoveredId, setHoveredId] = useState("");
  const chooseView = (value) => {
    if (value === activeView || !views[value]) return;
    setViewChoice({ polityKey, value });
    setSelectedId("");
    setHoveredId("");
  };

  useEffect(() => {
    setSelectedId("");
    setHoveredId("");
  }, [profile?.polityKey]);

  const goals = list(profile?.goals).slice(0, 5);

  return (
    <div className="oh-country-politics-page" style={{ marginTop: "0.85rem" }}>
      <GovernmentOverview profile={profile} fallbackGovernment={fallbackGovernment} fallbackLeader={fallbackLeader} />
      <PartiesCompile profile={profile} onCompile={onCompile} compiling={compiling} error={compileError} />

      {landscape?.entries.length > 0 && (
        <section className="oh-country-landscape" style={{ ...card, marginTop: "1.05rem", padding: "0.72rem 0.78rem" }}>
          <div style={{ alignItems: "center", display: "flex", gap: "0.45rem", justifyContent: "space-between" }}>
            <div>
              <div style={sectionLabel}>{landscape.title}</div>
              <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.59rem", marginTop: "0.15rem" }}>{landscape.subtitle}</div>
            </div>
            <div style={{ color: "rgba(255,255,255,0.36)", fontSize: "0.59rem", fontWeight: 750, textAlign: "right" }}>
              <div>{activeView === "blocs"
                ? `${landscape.entries.length} recorded · ${landscape.entries.filter((entry) => Number.isFinite(entry.influence)).length} quantified`
                : landscape.hasQuantitativeValues ? `${landscape.totalKnownPercent}% ${landscape.mappedLabel}` : "Qualitative"}</div>
              {landscape.hasQuantitativeValues && landscape.isApproximate && (
                <div style={{ color: "rgba(253,230,138,0.68)", fontSize: "0.54rem", fontWeight: 800, letterSpacing: "0.04em", marginTop: "0.12rem", textTransform: "uppercase" }}>
                  Approximate
                </div>
              )}
            </div>
          </div>

          {activeView === "parties" && landscape.slices.length > 0 && (
            <div className="oh-country-landscape-overview">
              <PartyDonut
                slices={landscape.slices}
                selectedId={selectedId}
                hoveredId={hoveredId}
                onHover={setHoveredId}
                onSelect={(id) => setSelectedId((current) => current === id ? "" : id)}
                centerLabel={landscape.centerLabel}
                centerSubLabel={landscape.centerSubLabel}
                ariaLabel={landscape.mode === "party" ? "Political party support" : "Political power structure"}
              />
              <div className="oh-country-landscape-legend">
                {landscape.entries.slice(0, 4).map((entry) => (
                  <div key={entry.id} style={{ display: "flex", alignItems: "center", gap: "0.43rem", minWidth: 0 }}>
                    <span aria-hidden="true" style={{ backgroundColor: partyColor(entry), borderRadius: "999px", flexShrink: 0, height: "0.5rem", width: "0.5rem" }} />
                    <span data-no-translate title={entry.name} style={{ color: "rgba(229,240,247,0.83)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.shortName || entry.name}</span>
                    <span data-no-translate style={{ color: "#b6d1e0", flexShrink: 0, fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{entry.displayValue || formatSupport(entry.support)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeView === "blocs" && <PowerBlocLedger
            entries={landscape.entries}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId((current) => current === id ? "" : id)}
            onHover={setHoveredId}
          />}

          {views.canSwitch && (
            <div className="oh-country-landscape-switch" role="group" aria-label="Political structure view">
              <button type="button" aria-pressed={activeView === "parties"} onClick={() => chooseView("parties")}>Political parties</button>
              <button type="button" aria-pressed={activeView === "blocs"} onClick={() => chooseView("blocs")}>Power blocs</button>
            </div>
          )}

          {activeView === "parties" && (
            <div className="oh-country-landscape-party-list" style={{ border: 0, borderRadius: 0, marginTop: "0.4rem", overflow: "hidden" }}>
              {landscape.entries.map((party) => (
                <PartyRow
                  key={party.id}
                  party={party}
                  open={party.id === selectedId}
                  onToggle={() => setSelectedId((current) => current === party.id ? "" : party.id)}
                  onHover={setHoveredId}
                  legislatureSeats={Number(profile?.government?.legislatureSeats) || 0}
                />
              ))}
            </div>
          )}

        </section>
      )}

      {goals.length > 0 && (
        <div className="oh-country-politics-secondary" style={{ ...card, marginTop: "0.85rem", padding: "0.72rem 0.78rem" }}>
          <div style={sectionLabel}>National priorities</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.34rem", marginTop: "0.48rem" }}>
            {goals.map((goal) => (
              <div key={goal} style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.67rem", lineHeight: 1.4 }}>• {goal}</div>
            ))}
          </div>
        </div>
      )}

      <InstitutionPortfolio rows={institutions} />
      <IntelligenceAssessment intelligence={intelligence} />
    </div>
  );
}
