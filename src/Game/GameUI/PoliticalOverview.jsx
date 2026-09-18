/*! Open Historia — Country political overview / party landscape */
import React, { useEffect, useMemo, useState } from "react";
import { buildGovernmentPartyPresentation, buildPoliticalLandscape } from "../../runtime/politicalPresentation.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value.map(clean).filter(Boolean) : (clean(value) ? [clean(value)] : []));

const sectionLabel = {
  color: "rgba(255,255,255,0.42)",
  fontSize: "0.63rem",
  fontWeight: 800,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
};

const card = {
  background: "linear-gradient(180deg, rgba(255,255,255,0.052), rgba(255,255,255,0.032))",
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
    let cursor = 0;
    return slices.map((party) => {
      const span = Math.max(0, Number(party.chartPercent) || 0) * 3.6;
      const gap = span >= 7 ? 1.2 : 0.25;
      const start = cursor + gap / 2;
      const end = cursor + span - gap / 2;
      cursor += span;
      return { party, start, end: Math.max(start + 0.1, end) };
    });
  }, [slices]);

  const active = slices.find((party) => party.id === hoveredId)
    || slices.find((party) => party.id === selectedId)
    || null;
  const centerName = active ? (active.shortName || active.name) : centerLabel;
  const centerSub = active ? (active.displayValue || formatSupport(active.support)) : centerSubLabel;

  return (
    <div style={{ alignItems: "center", display: "flex", justifyContent: "center", minHeight: "178px" }}>
      <svg aria-label={ariaLabel} role="img" viewBox="0 0 180 180" style={{ display: "block", height: "178px", overflow: "visible", width: "178px" }}>
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

const Badge = ({ children, tone = "rgba(167,139,250,0.18)", border = "rgba(167,139,250,0.32)", color = "#ddd6fe" }) => (
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

const PartyDetail = ({ party, onClose }) => {
  if (!party) return null;
  if (party.isOther) {
    return (
      <div style={{ ...card, marginTop: "0.7rem", padding: "0.72rem 0.78rem" }}>
        <div style={{ alignItems: "flex-start", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
          <div>
            <div style={{ color: "rgba(255,255,255,0.92)", fontSize: "0.78rem", fontWeight: 850 }}>Other political support</div>
            <div style={{ color: "rgba(255,255,255,0.44)", fontSize: "0.63rem", marginTop: "0.12rem" }}>{formatSupport(party.support)} combined</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close party details" style={{ background: "none", border: 0, color: "rgba(255,255,255,0.42)", cursor: "pointer", fontSize: "0.9rem", padding: 0 }}>×</button>
        </div>
        {party.members?.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.38rem", marginTop: "0.65rem" }}>
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

  const ideology = list(party.ideology);
  const hasDetail = party.leader || ideology.length || party.publicDescription || party.goals?.length || party.publicPriorities?.length || party.publicForeignPolicy?.length;
  return (
    <div style={{ ...card, marginTop: "0.7rem", padding: "0.76rem 0.8rem" }}>
      <div style={{ alignItems: "flex-start", display: "flex", gap: "0.55rem", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
            <span style={{ color: "rgba(255,255,255,0.95)", fontSize: "0.8rem", fontWeight: 850 }}>{party.name}</span>
            {party.ruling && <Badge tone="rgba(245,158,11,0.14)" border="rgba(245,158,11,0.32)" color="#fde68a">Government</Badge>}
            {!party.ruling && party.coalition && <Badge>Coalition</Badge>}
          </div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.66rem", fontWeight: 800, marginTop: "0.15rem" }}>
            {formatSupport(party.support)} support
            {party.supportApproximate && <span style={{ color: "rgba(253,230,138,0.62)", fontSize: "0.56rem", marginLeft: "0.35rem", textTransform: "uppercase" }}>Approximate</span>}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close party details" style={{ background: "none", border: 0, color: "rgba(255,255,255,0.42)", cursor: "pointer", fontSize: "0.9rem", padding: 0 }}>×</button>
      </div>

      {party.publicDescription && <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.67rem", lineHeight: 1.46, marginTop: "0.55rem" }}>{party.publicDescription}</div>}
      {party.leader && (
        <div style={{ display: "grid", gap: "0.2rem", gridTemplateColumns: "5.6rem minmax(0,1fr)", marginTop: "0.58rem" }}>
          <span style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.62rem", fontWeight: 750 }}>Party leader</span>
          <span style={{ color: "rgba(255,255,255,0.76)", fontSize: "0.66rem", fontWeight: 700 }}>{party.leader}</span>
        </div>
      )}
      {ideology.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.28rem", marginTop: "0.58rem" }}>
          {ideology.map((item) => <Badge key={item}>{item}</Badge>)}
        </div>
      )}
      <DetailList title="Public priorities" values={party.publicPriorities?.length ? party.publicPriorities : party.goals} />
      <DetailList title="Foreign-policy outlook" values={party.publicForeignPolicy} />
      {!hasDetail && (
        <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.64rem", lineHeight: 1.42, marginTop: "0.58rem" }}>
          No additional public party information is currently available.
        </div>
      )}
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

const GovernmentOverview = ({ profile, fallbackGovernment, fallbackLeader }) => {
  const government = profile?.government || {};
  const form = clean(government.form || fallbackGovernment);
  const headOfState = officeholderName(government.headOfState || fallbackLeader || profile?.leader);
  const headOfGovernment = officeholderName(government.headOfGovernment);
  const governmentParties = buildGovernmentPartyPresentation(profile);

  if (!form && !headOfState && !headOfGovernment && !governmentParties.names.length) return null;
  return (
    <div style={{ ...card, padding: "0.72rem 0.78rem" }}>
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
    </div>
  );
};

const IntelligenceAssessment = ({ intelligence }) => {
  if (!intelligence) return null;
  const findings = Array.isArray(intelligence.findings) ? intelligence.findings.slice(0, 4) : [];
  return (
    <div style={{ ...card, background: "linear-gradient(180deg, rgba(124,58,237,0.095), rgba(124,58,237,0.045))", borderColor: "rgba(167,139,250,0.2)", marginTop: "0.7rem", padding: "0.72rem 0.78rem" }}>
      <div style={{ alignItems: "center", display: "flex", gap: "0.35rem", justifyContent: "space-between" }}>
        <div style={{ ...sectionLabel, color: "#c4b5fd" }}>🕵 Intelligence assessment</div>
        {intelligence.confidence && <Badge>{intelligence.confidence} confidence</Badge>}
      </div>
      {intelligence.summary && <div style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.69rem", lineHeight: 1.48, marginTop: "0.48rem" }}>{intelligence.summary}</div>}
      {findings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.46rem", marginTop: "0.58rem" }}>
          {findings.map((finding, index) => (
            <div key={`${finding.topic || "finding"}-${index}`} style={{ borderLeft: "2px solid rgba(167,139,250,0.34)", paddingLeft: "0.55rem" }}>
              {finding.topic && <div style={{ color: "rgba(221,214,254,0.72)", fontSize: "0.58rem", fontWeight: 800 }}>{finding.topic}</div>}
              <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.65rem", lineHeight: 1.43, marginTop: finding.topic ? "0.12rem" : 0 }}>{finding.text}</div>
            </div>
          ))}
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

export default function PoliticalOverview({ profile, fallbackGovernment = "", fallbackLeader = "", intelligence = null }) {
  const landscape = useMemo(() => buildPoliticalLandscape(profile), [profile]);
  const [selectedId, setSelectedId] = useState("");
  const [hoveredId, setHoveredId] = useState("");

  useEffect(() => {
    setSelectedId("");
    setHoveredId("");
  }, [profile?.polityKey]);

  const selected = landscape.entries.find((entry) => entry.id === selectedId) || null;
  const goals = list(profile?.goals).slice(0, 5);
  const governmentParties = buildGovernmentPartyPresentation(profile);

  return (
    <div style={{ marginTop: "0.82rem" }}>
      <GovernmentOverview profile={profile} fallbackGovernment={fallbackGovernment} fallbackLeader={fallbackLeader} />

      {landscape.entries.length > 0 && (
        <div style={{ ...card, marginTop: "0.7rem", padding: "0.72rem 0.78rem" }}>
          <div style={{ alignItems: "center", display: "flex", gap: "0.45rem", justifyContent: "space-between" }}>
            <div>
              <div style={sectionLabel}>{landscape.title}</div>
              <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.59rem", marginTop: "0.15rem" }}>{landscape.subtitle}</div>
            </div>
            <div style={{ color: "rgba(255,255,255,0.36)", fontSize: "0.59rem", fontWeight: 750, textAlign: "right" }}>
              <div>{landscape.hasQuantitativeValues ? `${landscape.totalKnownPercent}% ${landscape.mappedLabel}` : "Qualitative"}</div>
              {landscape.hasQuantitativeValues && landscape.isApproximate && (
                <div style={{ color: "rgba(253,230,138,0.68)", fontSize: "0.54rem", fontWeight: 800, letterSpacing: "0.04em", marginTop: "0.12rem", textTransform: "uppercase" }}>
                  Approximate
                </div>
              )}
            </div>
          </div>

          {landscape.slices.length > 0 && (
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
          )}

          <div style={{ display: "grid", gap: "0.32rem 0.45rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {landscape.entries.map((party) => {
              const selectedParty = party.id === selectedId;
              return (
                <button
                  key={party.id}
                  type="button"
                  onClick={() => setSelectedId((current) => current === party.id ? "" : party.id)}
                  onMouseEnter={() => setHoveredId(party.id)}
                  onMouseLeave={() => setHoveredId("")}
                  style={{ alignItems: "center", background: selectedParty ? "rgba(255,255,255,0.07)" : "transparent", border: selectedParty ? "1px solid rgba(255,255,255,0.1)" : "1px solid transparent", borderRadius: "7px", color: "inherit", cursor: "pointer", display: "flex", gap: "0.36rem", minWidth: 0, padding: "0.3rem 0.35rem", textAlign: "left" }}
                >
                  <span style={{ background: partyColor(party), borderRadius: "999px", flex: "0 0 auto", height: "0.48rem", width: "0.48rem" }} />
                  <span style={{ color: "rgba(255,255,255,0.66)", flex: 1, fontSize: "0.62rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{party.shortName || party.name}</span>
                  <span style={{ color: "rgba(255,255,255,0.43)", flex: "0 0 auto", fontSize: "0.6rem", fontWeight: 800 }}>{party.displayValue || formatSupport(party.support)}</span>
                </button>
              );
            })}
          </div>

          {governmentParties.names.length > 0 && (
            <div
              style={{
                background: "rgba(245,158,11,0.07)",
                border: "1px solid rgba(245,158,11,0.16)",
                borderRadius: "9px",
                marginTop: "0.62rem",
                padding: "0.5rem 0.58rem",
              }}
            >
              <div style={{ color: "rgba(253,230,138,0.62)", fontSize: "0.56rem", fontWeight: 850, letterSpacing: "0.07em", textTransform: "uppercase" }}>
                {governmentParties.label}
              </div>
              <div style={{ color: "#fde68a", fontSize: "0.64rem", fontWeight: 800, lineHeight: 1.45, marginTop: "0.24rem" }}>
                {governmentParties.names.join(" | ")}
              </div>
            </div>
          )}

          {landscape.mode === "party"
            ? <PartyDetail party={selected} onClose={() => setSelectedId("")} />
            : <PowerBlocDetail bloc={selected} onClose={() => setSelectedId("")} />}
        </div>
      )}

      {goals.length > 0 && (
        <div style={{ ...card, marginTop: "0.7rem", padding: "0.72rem 0.78rem" }}>
          <div style={sectionLabel}>National priorities</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.34rem", marginTop: "0.48rem" }}>
            {goals.map((goal) => (
              <div key={goal} style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.67rem", lineHeight: 1.4 }}>• {goal}</div>
            ))}
          </div>
        </div>
      )}

      <IntelligenceAssessment intelligence={intelligence} />
    </div>
  );
}
