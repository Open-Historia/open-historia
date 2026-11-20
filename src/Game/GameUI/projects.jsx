/*! Open Historia — portions (projects & operations board panel) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Projects & Operations board, the Actions panel's second tab (actions.jsx).
//
// Since 2026-11-15 the projects engine runs every project (runtime/
// projectEngine.js): its owner's budget pays for it each day, its work moves at
// the pace its plan, its funding and the country's economy allow, and what it
// does to the world lands once, when it is done. This panel is where the player
// steers their own:
//
//   New project   a name and a goal, "Plan it" (ONE AI request, the projectPlan
//                 task), then the plan to Start or Discard;
//   each project  its progress and expected finish, its cost a month and its
//                 funding (none, low, normal, high: the cost and the speed), the
//                 effects it will have, its status with the reason, and its
//                 checkpoints with the days they were reached; Abandon;
//   abroad        the projects of other countries the player's services know of
//                 (projects.js isKnownToPlayer), to watch and act against.
//
// Every write goes through applyProjectOpsToWorld with actor "player", the door
// that lets a government touch its own programmes only.
import React, { memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { APP_HEIGHT, useCanHover, useTouchPrimary } from "../../runtime/mobileUi.js";

import { getNationFlags } from "../../runtime/assets.js";
import { economicDisplayUnitLabel, formatEconomicDisplayValue, getActiveEconomicDisplayCurrency, setActiveEconomicDisplayCurrency, subscribeEconomicDisplayCurrency } from "../../runtime/economicDisplayCurrency.js";
import { useBackToClose } from "../../runtime/backToClose.js";
import { bundledFlagUrl, flagImageUrlFromGid } from "../../runtime/countryFlags.js";
import {
  PROJECT_BOARD_LIMIT,
  applyProjectOpsToWorld,
  isPolityLandless,
  mutateWorldState,
  readEventsState,
  readWorldState,
} from "../../runtime/gameState.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import { archiveClosedProjectsInWorld, restoreArchivedProjectInWorld } from "../../runtime/projectRecovery.js";
import { refreshRuntimeState } from "../../runtime/runtimeStore.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import {
  PROJECT_SORTS,
  collectProjectTags,
  deriveProjectFlags,
  filterProjects,
  isKnownToPlayer,
  isPlayerProject,
  isProjectClosed,
  isProjectOpen,
  sortProjects,
} from "../../runtime/projects.js";
import { DAYS_PER_MONTH, dailyCostOf, estimateProjectFinish, ownerMeans, statMeasure } from "../../runtime/projectEngine.js";
import { DEFAULT_STAT_INDEX_ROWS } from "../../runtime/statIndexDefinitions.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { uiString } from "../../runtime/translator.js";
import { TAG_SEARCH_FROM, searchTags, stepTagFocus, tickedFirst } from "./projectTagMenu.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { nameInitials } from "../../../server/nameKey.js";
import { planProject } from "../AI/gameplayLazy.js";
import { inSharedGame, requestFromHost } from "../../multiplayer/client/sharedGameBridge.js";

// The card seeds are whole sentences, one per variant, handed over in the
// interface's language (uiString): a kind or an owner glued in as a word would
// stay English inside a translated sentence.
const buildBriefPrompt = (project) => (project.kind === "operation"
  ? uiString("Brief me in full on the operation \"{{name}}\". Where does it actually stand right now, what has moved since the last round, what does the next milestone need from me, and what is most likely to go wrong? Be specific and tell me if the board is out of date.", { name: project.name })
  : uiString("Brief me in full on the project \"{{name}}\". Where does it actually stand right now, what has moved since the last round, what does the next milestone need from me, and what is most likely to go wrong? Be specific and tell me if the board is out of date.", { name: project.name }));

// The same button on a foreign card, asking what is answerable about somebody
// else's programme.
const buildForeignBriefPrompt = (project, owner) => {
  const params = { name: project.name, owner };
  if (project.kind === "operation") {
    return owner
      ? uiString("Brief me on {{owner}}'s operation \"{{name}}\". What do we actually know, how good is the sourcing, what has changed since we last looked, and what does it mean for us if it succeeds? Be honest about how much of this is inference rather than intelligence.", params)
      : uiString("Brief me on the foreign operation \"{{name}}\". What do we actually know, how good is the sourcing, what has changed since we last looked, and what does it mean for us if it succeeds? Be honest about how much of this is inference rather than intelligence.", params);
  }
  return owner
    ? uiString("Brief me on {{owner}}'s programme \"{{name}}\". What do we actually know, how good is the sourcing, what has changed since we last looked, and what does it mean for us if it succeeds? Be honest about how much of this is inference rather than intelligence.", params)
    : uiString("Brief me on the foreign programme \"{{name}}\". What do we actually know, how good is the sourcing, what has changed since we last looked, and what does it mean for us if it succeeds? Be honest about how much of this is inference rather than intelligence.", params);
};

// The seed behind a foreign card's second button: what the player can do about
// a rival's programme is a project of their own.
const buildCounterPrompt = (project, owner) => (owner
  ? uiString("What can we actually do about {{owner}}'s \"{{name}}\"? Lay out the realistic options — diplomatic, economic, covert, or simply outpacing them — with what each would cost us and how it could go wrong. If we settle on one, open it as our own effort.", { name: project.name, owner })
  : uiString("What can we actually do about this \"{{name}}\"? Lay out the realistic options — diplomatic, economic, covert, or simply outpacing them — with what each would cost us and how it could go wrong. If we settle on one, open it as our own effort.", { name: project.name }));

// ---- styling ---------------------------------------------------------------
// The grey HUD with the one accent, #2bc1f3, and flat colours only.

const ACCENT = "#2bc1f3";
const ACCENT_SOFT = "rgba(43,193,243,0.14)";
const ACCENT_EDGE = "rgba(43,193,243,0.45)";

// Same sizing rule as the Actions panel (actionsPanelLayout.js PANEL_HEIGHT_VAR).
const PANEL_HEIGHT = `var(--oh-actions-panel-height, min(calc(${APP_HEIGHT} - 9rem), max(calc(${APP_HEIGHT} - 16rem), 30rem)))`;

const STATUS_TONES = {
  planning: { label: "Planning", color: "rgba(255,255,255,0.75)", bg: "rgba(255,255,255,0.1)" },
  active: { label: "Active", color: ACCENT, bg: ACCENT_SOFT },
  running: { label: "Running", color: ACCENT, bg: ACCENT_SOFT },
  stalled: { label: "Stalled", color: "#fbbf24", bg: "rgba(245,158,11,0.16)" },
  paused: { label: "Paused", color: "rgba(255,255,255,0.6)", bg: "rgba(255,255,255,0.08)" },
  complete: { label: "Complete", color: "#86efac", bg: "rgba(34,197,94,0.14)" },
  failed: { label: "Failed", color: "#f87171", bg: "rgba(239,68,68,0.16)" },
  cancelled: { label: "Cancelled", color: "rgba(255,255,255,0.45)", bg: "rgba(255,255,255,0.06)" },
};

// Why a stalled project stands still, in words.
const STALL_REASON_LABELS = {
  funds: "Stalled: no funds",
  site: "Stalled: site lost",
  blocked: "Stalled: blocked",
};

const progressColor = (project) => {
  if (project.status === "complete") return "#86efac";
  if (project.status === "failed" || project.status === "cancelled") return "rgba(255,255,255,0.25)";
  if (project.status === "stalled") return "#f59e0b";
  if (project.status === "paused" || project.status === "planning") return "rgba(255,255,255,0.35)";
  return ACCENT;
};

const SECRECY_GLYPH = { restricted: "🔒", covert: "🕵" };

// How far an entry can be trusted, when it came from a spy at all. Never says
// WHY — the player is not told their agent was turned.
const VERIFICATION_BADGE = {
  doubted: { label: "Doubtful", color: "#fbbf24", background: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.4)", title: "Our analysts do not trust how we came by this. Put someone else in place to settle it." },
  confirmed: { label: "Confirmed", color: "#86efac", background: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.4)", title: "A second source stands this up." },
  refuted: { label: "Fabricated", color: "#fca5a5", background: "rgba(248,113,113,0.14)", border: "rgba(248,113,113,0.4)", title: "A second source showed there was never anything here." },
};

const cardStyle = {
  backgroundColor: "var(--oh-ui-surface, rgba(255,255,255,0.05))",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "12px",
  padding: "0.7rem 0.8rem",
};

const chipBase = {
  borderRadius: "999px",
  cursor: "pointer",
  fontSize: "0.66rem",
  fontWeight: 600,
  letterSpacing: "0.02em",
  padding: "0.2rem 0.55rem",
  transition: "all 0.12s ease",
  whiteSpace: "nowrap",
};

const selectStyle = {
  backgroundColor: "var(--oh-ui-surface, rgba(255,255,255,0.06))",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "8px",
  color: "white",
  fontFamily: "sans-serif",
  fontSize: "0.72rem",
  outline: "none",
  padding: "0.3rem 0.4rem",
};

const ghostButtonStyle = {
  background: "var(--oh-ui-raised, rgba(255,255,255,0.06))",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "8px",
  color: "rgba(255,255,255,0.85)",
  cursor: "pointer",
  fontFamily: "sans-serif",
  fontSize: "0.7rem",
  fontWeight: 600,
  padding: "0.3rem 0.6rem",
  transition: "all 0.12s ease",
};

const accentButtonStyle = {
  ...ghostButtonStyle,
  background: ACCENT_SOFT,
  border: `1px solid ${ACCENT_EDGE}`,
  color: ACCENT,
};

const inputStyle = {
  backgroundColor: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "9px",
  boxSizing: "border-box",
  color: "white",
  fontFamily: "sans-serif",
  fontSize: "0.75rem",
  outline: "none",
  padding: "0.45rem 0.55rem",
  width: "100%",
};

const smallLabel = { color: "rgba(255,255,255,0.45)", fontSize: "0.64rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" };

const Bar = ({ value, color }) => (
  <div style={{ backgroundColor: "rgba(255,255,255,0.1)", borderRadius: "999px", height: "6px", overflow: "hidden" }}>
    <div style={{
      backgroundColor: color,
      borderRadius: "999px",
      height: "100%",
      transition: "width 0.4s",
      width: `${Math.max(0, Math.min(100, Number(value) || 0))}%`,
    }}
    />
  </div>
);

const Pill = ({ children, color, bg, title }) => (
  <span
    title={title}
    style={{
      backgroundColor: bg,
      borderRadius: "999px",
      color,
      fontSize: "0.62rem",
      fontWeight: 700,
      letterSpacing: "0.05em",
      padding: "0.15rem 0.45rem",
      textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
);

const Chip = ({ active, children, onClick, title }) => (
  <button
    type="button"
    className="oh-tap-row"
    title={title}
    onClick={onClick}
    style={{
      ...chipBase,
      background: active ? "rgba(0,0,0,0.39)" : "rgba(255,255,255,0.05)",
      border: `1px solid ${active ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.1)"}`,
      color: active ? "#f4f4f5" : "rgba(255,255,255,0.6)",
    }}
  >
    {children}
  </button>
);

const SearchIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);

// ---- figures and words --------------------------------------------------------

// Project costs and allowances are canonical 2026 USD, rendered in the same
// player-selected display currency as National GDP. Never convert saved costs.
const formatMoney = (value, displayCurrency) =>
  formatEconomicDisplayValue(value, displayCurrency, { compact: true });

const readableDate = (date) => formatGameDateReadable(date) || date || "";

// What a stat path is called on the sheet.
const STAT_LABELS = {
  stability: "Stability",
  "military.quality": "Military quality",
  "military.technology": "Military technology",
  "military.land": "Land forces",
  "military.sea": "Naval forces",
  "military.air": "Air forces",
  "military.spending": "Military spending",
  "economy.gdp": "GDP",
  "economy.gdpGrowth": "GDP growth",
  "economy.inflation": "Inflation",
  "economy.unemployment": "Unemployment",
  "economy.budgetBalance": "Budget balance",
  "economy.publicDebt": "Public debt",
  "population.total": "Population",
};
const statLabel = (path) => {
  if (STAT_LABELS[path]) return uiString(STAT_LABELS[path]);
  const [head, key] = String(path ?? "").split(".");
  if (head === "indices") return uiString(DEFAULT_STAT_INDEX_ROWS.find((row) => row.key === key)?.label || key);
  return key || path;
};
const signed = (value) => `${value > 0 ? "+" : ""}${value}`;
const changeText = (effect) => {
  const measure = statMeasure(effect.stat);
  if (measure === "percentGdp" || measure === "percentPopulation") return `${signed(effect.change)}%`;
  if (measure === "rate" || measure === "debt") return uiString("{{change}} pts", { change: signed(effect.change) });
  return signed(effect.change);
};

// One effect as the card says it.
const describeEffectForPlayer = (effect, owner) => {
  if (!effect) return "";
  if (effect.type === "stat") {
    return effect.country && effect.country !== owner
      ? uiString("{{country}}: {{stat}} {{change}}", { country: effect.country, stat: statLabel(effect.stat), change: changeText(effect) })
      : `${statLabel(effect.stat)} ${changeText(effect)}`;
  }
  if (effect.type === "relation") return uiString("Relations with {{country}} {{change}}", { country: effect.country, change: signed(effect.change) });
  if (effect.type === "structure") return uiString("Builds {{name}}", { name: effect.name });
  if (effect.type === "unitType") return uiString("New unit type: {{name}}", { name: effect.name });
  if (effect.type === "territory") {
    return effect.claim
      ? uiString("{{country}} claims {{region}}", { country: effect.country, region: effect.region })
      : uiString("{{region}} passes to {{country}}", { country: effect.country, region: effect.region });
  }
  return "";
};

// ---- the owner's flag -------------------------------------------------------------

const resolveOwnerFlagUrl = (owner, customFlags, polities) => {
  if (!owner) return "";
  return customFlags?.[owner] || polities?.[owner]?.flag || flagImageUrlFromGid(owner) || "";
};

const OwnerBadge = ({ flagUrl, mine, name }) => {
  const [flagFailed, setFlagFailed] = useState(false);
  useEffect(() => { setFlagFailed(false); }, [flagUrl]);

  return (
    <div style={{ alignItems: "center", display: "flex", gap: "0.35rem", marginTop: "0.25rem", minWidth: 0 }}>
      <span style={{
        alignItems: "center",
        backgroundColor: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "3px",
        color: "rgba(255,255,255,0.7)",
        display: "flex",
        flexShrink: 0,
        fontSize: "0.5rem",
        fontWeight: 800,
        height: "0.85rem",
        justifyContent: "center",
        overflow: "hidden",
        width: "1.3rem",
      }}
      >
        {flagUrl && !flagFailed ? (
          <img
            alt=""
            src={bundledFlagUrl(flagUrl)}
            onError={() => setFlagFailed(true)}
            style={{ height: "100%", objectFit: "cover", width: "100%" }}
          />
        ) : nameInitials(name)}
      </span>
      <span
        data-no-translate
        title={name}
        style={{
          color: mine ? "rgba(255,255,255,0.55)" : "rgba(253,186,116,0.85)",
          fontSize: "0.68rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
    </div>
  );
};

// ---- funding ----------------------------------------------------------------------

const FUNDING_OPTIONS = [
  { key: "none", label: "Off", title: "No money and no work: the project waits" },
  { key: "low", label: "Low", title: "Half the cost, half the speed" },
  { key: "normal", label: "Normal", title: "The plan's cost and speed" },
  { key: "high", label: "High", title: "One and a half times the cost and the speed" },
];

const FundingSwitch = ({ busy, onSelect, value }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.15rem" }} role="group" aria-label="Funding">
    {FUNDING_OPTIONS.map((option) => {
      const active = value === option.key;
      return (
        <button
          key={option.key}
          type="button"
          className="oh-tap"
          disabled={busy}
          title={option.title}
          aria-label={option.title}
          aria-pressed={active}
          onClick={() => onSelect(option.key)}
          style={{
            ...ghostButtonStyle,
            background: active ? ACCENT_SOFT : "rgba(255,255,255,0.06)",
            border: `1px solid ${active ? ACCENT_EDGE : "rgba(255,255,255,0.12)"}`,
            color: active ? ACCENT : "rgba(255,255,255,0.55)",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.5 : 1,
            padding: "0.28rem 0.5rem",
          }}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

// ---- what a plan holds: its cost, its time, its checkpoints, its effects ----------

// costShown: the card says the cost already (at the project's own funding), so
// the plan's is left out.
const PlanFacts = ({ plan, owner, costShown = false, displayCurrency }) => {
  if (!plan) return null;
  const effects = (plan.effects ?? []).map((effect) => describeEffectForPlayer(effect, owner)).filter(Boolean);
  const yields = (plan.yields ?? []).map((effect) => describeEffectForPlayer(effect, owner)).filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.5rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", fontSize: "0.72rem", color: "rgba(255,255,255,0.8)" }}>
        <span>{uiString("{{days}} days of work", { days: plan.durationDays })}</span>
        {!costShown && <span>{uiString("{{amount}} a month", { amount: formatMoney(plan.monthlyCost, displayCurrency) })}</span>}
        {plan.ongoing && <span>{uiString("Runs on once set up")}</span>}
      </div>
      {effects.length > 0 && (
        <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.72)" }}>
          <span style={smallLabel}>{uiString("When done")}</span>
          <div data-no-translate style={{ marginTop: "0.15rem" }}>{effects.join(" · ")}</div>
        </div>
      )}
      {yields.length > 0 && (
        <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.72)" }}>
          <span style={smallLabel}>{uiString("Every month")}</span>
          <div data-no-translate style={{ marginTop: "0.15rem" }}>{yields.join(" · ")}</div>
        </div>
      )}
    </div>
  );
};

const Milestones = ({ plan }) => {
  const list = plan?.milestones ?? [];
  if (!list.length) return null;
  return (
    <div style={{ marginTop: "0.5rem" }}>
      <span style={smallLabel}>{uiString("Checkpoints")}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", marginTop: "0.2rem" }}>
        {list.map((milestone) => (
          <div key={milestone.id || milestone.title} style={{ display: "flex", fontSize: "0.7rem", gap: "0.4rem" }}>
            <span aria-hidden="true" style={{ color: milestone.reached ? ACCENT : milestone.missed ? "#f87171" : "rgba(255,255,255,0.35)" }}>
              {milestone.reached ? "✓" : milestone.missed ? "✕" : "○"}
            </span>
            <span data-no-translate style={{ color: milestone.reached ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.55)", flex: 1, minWidth: 0 }}>{milestone.title}</span>
            <span style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }}>
              {milestone.reached
                ? (milestone.reachedAt ? readableDate(milestone.reachedAt) : uiString("Reached"))
                : milestone.missed ? uiString("Missed") : `${milestone.atProgress}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---- one card --------------------------------------------------------------

const ProjectCard = memo(({ project, fundingMode, displayCurrency, eventTitles, expanded, busy, error = "", playerCountry, playerLandless, ownerFlags, ownerNames, finish, planning, onToggleExpand, onAskAdvisor, onShowOnMap, onSetFunding, onSetSecrecy, onAbandon, onPlan }) => {
  const flags = deriveProjectFlags(project);
  const open = isProjectOpen(project);
  const mine = isPlayerProject(project, playerCountry);
  const toneKey = flags.running ? "running" : project.status;
  const tone = STATUS_TONES[toneKey] || STATUS_TONES.active;
  const toneLabel = project.status === "stalled" ? (STALL_REASON_LABELS[project.stallReason] || tone.label) : tone.label;
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  useEffect(() => {
    if (!open) setConfirmingAbandon(false);
  }, [open]);
  // The blur that disarms it with a mouse never comes on a phone, so there the
  // question lapses after four seconds.
  const isTouch = useTouchPrimary();
  useEffect(() => {
    if (!confirmingAbandon || !isTouch) return undefined;
    const timer = setTimeout(() => setConfirmingAbandon(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmingAbandon, isTouch]);
  const secrecy = SECRECY_GLYPH[project.secrecy];
  const ownerKey = String(project.ownerCode || "").trim() || String(playerCountry || "").trim();
  const ownerLabel = ownerNames?.[ownerKey] || ownerKey;
  const hasFocus = Boolean(project.focus) || project.linkedMarkerIds.length > 0 || project.linkedUnitIds.length > 0;
  const activity = expanded
    ? project.eventIds.map((id) => ({ id, entry: eventTitles.get(id) })).filter((row) => row.entry)
    : [];
  const progress = Math.floor(Number(project.progress) || 0);
  const finishLine = (() => {
    if (project.status === "complete") return project.completedAt ? uiString("Completed {{date}}", { date: readableDate(project.completedAt) }) : uiString("Completed");
    if (!open) return "";
    if (flags.planning) return uiString("Waiting for its plan");
    if (flags.running) return uiString("Running");
    if (project.status === "paused") return uiString("Paused");
    if (finish) return uiString("Done by about {{date}}", { date: readableDate(finish) });
    return uiString("No finish in sight");
  })();

  return (
    <div style={cardStyle}>
      <div style={{ alignItems: "baseline", display: "flex", gap: "0.4rem", justifyContent: "space-between" }}>
        <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: "0.35rem", minWidth: 0 }}>
          <span aria-hidden="true">{project.kind === "operation" ? "⚔" : "🔬"}</span>
          <span data-no-translate style={{ fontSize: "0.86rem", fontWeight: 700, wordBreak: "break-word" }}>
            {project.name}
          </span>
          {secrecy && <span title={project.secrecy}>{secrecy}</span>}
          {VERIFICATION_BADGE[project.verification] && (
            <span
              title={VERIFICATION_BADGE[project.verification].title}
              style={{
                background: VERIFICATION_BADGE[project.verification].background,
                border: `1px solid ${VERIFICATION_BADGE[project.verification].border}`,
                borderRadius: "999px",
                color: VERIFICATION_BADGE[project.verification].color,
                fontSize: "0.62rem",
                fontWeight: 700,
                letterSpacing: "0.04em",
                padding: "0.1rem 0.4rem",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {VERIFICATION_BADGE[project.verification].label}
            </span>
          )}
        </div>
        <Pill color={tone.color} bg={tone.bg}>{toneLabel}</Pill>
      </div>

      {ownerKey && (
        <OwnerBadge
          mine={mine}
          name={ownerLabel}
          flagUrl={mine && playerLandless
            ? (ownerFlags?.custom?.[ownerKey] || ownerFlags?.polities?.[ownerKey]?.flag || "")
            : resolveOwnerFlagUrl(ownerKey, ownerFlags?.custom, ownerFlags?.polities)}
        />
      )}

      {project.summary && (
        <p style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.75rem", lineHeight: 1.45, margin: "0.4rem 0 0" }}>
          {project.summary}
        </p>
      )}

      {project.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.45rem" }}>
          {project.tags.map((tag) => (
            <span
              key={tag}
              data-no-translate
              style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: "999px", color: "rgba(255,255,255,0.5)", fontSize: "0.62rem", padding: "0.1rem 0.4rem" }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {!flags.planning && (
        <div style={{ marginTop: "0.55rem" }}>
          <div style={{ color: "rgba(255,255,255,0.5)", display: "flex", fontSize: "0.66rem", gap: "0.5rem", justifyContent: "space-between", marginBottom: "0.25rem" }}>
            <span>{finishLine}</span>
            <span data-no-translate>{progress}%</span>
          </div>
          <Bar value={project.progress} color={progressColor(project)} />
        </div>
      )}

      {project.plan && fundingMode === "nonmonetary" && (
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.7rem", marginTop: "0.45rem" }}>
          {uiString("Time and effort only; no financial payments recorded")}
        </div>
      )}
      {project.plan && fundingMode !== "nonmonetary" && (open || Number(project.spent) > 0) && (
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.45rem", fontSize: "0.7rem", color: "rgba(255,255,255,0.65)" }}>
          {open && <span>{uiString("Planned cost: {{amount}} per month", { amount: formatMoney(dailyCostOf(project) * DAYS_PER_MONTH, displayCurrency) })}</span>}
          {Number(project.spent) > 0 && <span>{uiString("Actually paid to date: {{amount}}", { amount: formatMoney(project.spent, displayCurrency) })}</span>}
          {flags.underfunded && (
            <Pill color="#fbbf24" bg="rgba(245,158,11,0.14)" title={uiString("Received {{share}}% of planned funding last period", { share: Math.round(Number(project.paidShare) * 100) })}>
              {uiString("Underfunded")}
            </Pill>
          )}
        </div>
      )}

      {project.plan && <PlanFacts costShown displayCurrency={displayCurrency} owner={ownerKey} plan={project.plan} />}
      {project.plan && <Milestones plan={project.plan} />}

      {project.lastUpdate && (
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.7rem", fontStyle: "italic", marginTop: "0.4rem" }}>
          {project.lastUpdate}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.6rem" }}>
        <button
          type="button"
          className="oh-tap-row"
          style={ghostButtonStyle}
          onClick={() => onAskAdvisor(mine ? buildBriefPrompt(project) : buildForeignBriefPrompt(project, ownerLabel))}
        >
          🧭 {mine ? "Ask advisor" : "What do we know?"}
        </button>
        {!mine && open && (
          <button type="button" className="oh-tap-row" style={ghostButtonStyle} onClick={() => onAskAdvisor(buildCounterPrompt(project, ownerLabel))}>
            ⚖ Our options
          </button>
        )}
        {hasFocus && (
          <button type="button" className="oh-tap-row" style={ghostButtonStyle} onClick={() => onShowOnMap(project)}>
            📍 Show on map
          </button>
        )}
        {project.eventIds.length > 0 && (
          <button type="button" className="oh-tap-row" style={ghostButtonStyle} onClick={() => onToggleExpand(project.id)}>
            {expanded ? "▾" : "▸"} Activity ({project.eventIds.length})
          </button>
        )}
      </div>

      {open && mine && (
        <div style={{
          alignItems: "center",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
          justifyContent: "space-between",
          marginTop: "0.6rem",
          paddingTop: "0.55rem",
        }}
        >
          {flags.planning ? (
            <button type="button" className="oh-tap-row" disabled={busy || planning} style={{ ...accentButtonStyle, opacity: busy || planning ? 0.5 : 1 }} onClick={() => onPlan(project)}>
              {planning ? uiString("Planning…") : uiString("Plan it")}
            </button>
          ) : (
            <FundingSwitch busy={busy} value={project.funding} onSelect={(funding) => onSetFunding(project, funding)} />
          )}
          <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.68rem", color: "rgba(255,255,255,0.7)" }}>
            {uiString("Visibility")}
            <select
              className="oh-tap-row"
              aria-label={uiString("Project visibility")}
              value={project.secrecy || "public"}
              disabled={busy}
              onChange={(event) => onSetSecrecy(project, event.target.value)}
              style={{ ...inputStyle, padding: "0.25rem 0.35rem", fontSize: "0.68rem" }}
            >
              <option value="public">{uiString("Public")}</option>
              <option value="restricted">{uiString("Restricted")}</option>
              <option value="covert">{uiString("Covert")}</option>
            </select>
          </label>
          <button
            type="button"
            className="oh-tap-row"
            disabled={busy}
            onClick={() => {
              if (!confirmingAbandon) { setConfirmingAbandon(true); return; }
              setConfirmingAbandon(false);
              onAbandon(project);
            }}
            onBlur={() => setConfirmingAbandon(false)}
            style={{
              ...ghostButtonStyle,
              background: confirmingAbandon ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${confirmingAbandon ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.12)"}`,
              color: confirmingAbandon ? "#fca5a5" : "rgba(255,255,255,0.55)",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            {confirmingAbandon ? "Confirm abandon?" : "Abandon"}
          </button>
          {/* Why a change of funding, or an abandon, did not happen: the host's
              reason in a shared game, a failed save alone. */}
          {error && <div role="alert" style={{ color: "#fca5a5", flexBasis: "100%", fontSize: "0.68rem" }}>{error}</div>}
        </div>
      )}

      {expanded && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", marginTop: "0.6rem", paddingTop: "0.5rem" }}>
          {activity.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.68rem", fontStyle: "italic" }}>
              The events behind this are no longer in the log.
            </div>
          ) : activity.map(({ id, entry }) => (
            <div key={id} style={{ display: "flex", fontSize: "0.68rem", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <span data-no-translate style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>{entry.date || "—"}</span>
              <span style={{ color: "rgba(255,255,255,0.65)" }}>{entry.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ---- a new project: a name, a goal, one request for its plan ------------------------

const PlanCard = ({ draft, owner, fundingMode, displayCurrency, busy, onStart, onDiscard }) => (
  <div style={{ ...cardStyle, border: `1px solid ${ACCENT_EDGE}`, marginTop: "0.55rem" }}>
    <div style={{ alignItems: "baseline", display: "flex", gap: "0.4rem" }}>
      <span aria-hidden="true">{draft.kind === "operation" ? "⚔" : "🔬"}</span>
      <span data-no-translate style={{ fontSize: "0.86rem", fontWeight: 700, wordBreak: "break-word" }}>{draft.name}</span>
    </div>
    {draft.summary && (
      <p style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.75rem", lineHeight: 1.45, margin: "0.35rem 0 0" }}>{draft.summary}</p>
    )}
    <PlanFacts plan={draft.plan} owner={owner} displayCurrency={displayCurrency} costShown={fundingMode === "nonmonetary"} />
    <Milestones plan={draft.plan} />
    <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.65rem" }}>
      <button type="button" className="oh-tap-row" disabled={busy} style={{ ...accentButtonStyle, opacity: busy ? 0.5 : 1 }} onClick={onStart}>
        {uiString("Start")}
      </button>
      <button type="button" className="oh-tap-row" disabled={busy} style={{ ...ghostButtonStyle, opacity: busy ? 0.5 : 1 }} onClick={onDiscard}>
        {uiString("Discard")}
      </button>
    </div>
  </div>
);

const NewProject = ({ owner, fundingMode, displayCurrency, onStarted, writeOps }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  // By default retain the planner's proposed classification; the owner can
  // explicitly override it before the project is written to canonical state.
  const [secrecyChoice, setSecrecyChoice] = useState("auto");

  const reset = () => {
    setName("");
    setGoal("");
    setDraft(null);
    setError("");
    setSecrecyChoice("auto");
  };

  const plan = async () => {
    if (!name.trim() || planning) return;
    setPlanning(true);
    setError("");
    try {
      setDraft(await planProject({ name: name.trim(), goal: goal.trim() }));
    } catch (failure) {
      setError(String(failure?.message || failure || "").trim() || uiString("The plan could not be made."));
    } finally {
      setPlanning(false);
    }
  };

  const start = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await writeOps([{
        op: "create",
        name: draft.name,
        summary: draft.summary,
        kind: draft.kind,
        secrecy: secrecyChoice === "auto" ? draft.secrecy : secrecyChoice,
        tags: draft.tags,
        ...(draft.focus ? { focus: draft.focus } : {}),
        plan: draft.plan,
      }]);
      reset();
      setOpen(false);
      onStarted?.();
    } catch (failure) {
      setError(String(failure?.message || failure || "").trim());
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="oh-tap-row" style={{ ...accentButtonStyle, alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        ＋ {uiString("New project")}
      </button>
    );
  }

  return (
    <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {!draft && (
        <>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={uiString("Name")}
            aria-label={uiString("Name")}
            maxLength={120}
            disabled={planning}
            style={inputStyle}
          />
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder={uiString("What is it for?")}
            aria-label={uiString("What is it for?")}
            rows={3}
            maxLength={600}
            disabled={planning}
            style={{ ...inputStyle, resize: "vertical" }}
          />
          <div style={{ alignItems: "center", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            <button type="button" className="oh-tap-row" disabled={!name.trim() || planning} style={{ ...accentButtonStyle, opacity: !name.trim() || planning ? 0.5 : 1 }} onClick={plan}>
              {planning ? uiString("Planning…") : uiString("Plan it")}
            </button>
            <button type="button" className="oh-tap-row" disabled={planning} style={ghostButtonStyle} onClick={() => { reset(); setOpen(false); }}>
              {uiString("Cancel")}
            </button>
            {planning && <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.66rem" }}>{uiString("One AI request")}</span>}
          </div>
        </>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.72rem", color: "rgba(255,255,255,0.7)" }}>
        {uiString("Project visibility")}
        <select
          value={secrecyChoice}
          onChange={(event) => setSecrecyChoice(event.target.value)}
          disabled={planning || saving}
          style={{ ...inputStyle, padding: "0.3rem 0.4rem", flex: 1 }}
          aria-label={uiString("New project visibility")}
        >
          <option value="auto">{draft ? `As planned (${draft.secrecy || "public"})` : uiString("Use planner's classification")}</option>
          <option value="public">{uiString("Public")}</option>
          <option value="restricted">{uiString("Restricted")}</option>
          <option value="covert">{uiString("Covert")}</option>
        </select>
      </label>
      {draft && <PlanCard draft={draft} owner={owner} fundingMode={fundingMode} displayCurrency={displayCurrency} busy={saving} onStart={start} onDiscard={() => { setDraft(null); }} />}
      {error && <div style={{ color: "#fca5a5", fontSize: "0.7rem" }}>{error}</div>}
    </div>
  );
};

// ---- the Tags menu ---------------------------------------------------------
//
// Every tag on the board, behind one control. They used to be a chip each, in
// a row of their own under the filters, which suited the handful a new
// campaign has and not a vocabulary that is open and only ever grows
// (runtime/countryTags.js): a long game reached about sixty, the chips filled
// the panel, and the projects they were there to filter were pushed off the
// bottom of it. A menu is the same toggles in a box that scrolls inside
// itself, so the board keeps its room however many there are.
//
// The mechanics are the game card's menu (libraryBar.jsx GameCard): a button
// that says it has a menu, a listener on the document for a press anywhere
// else — this panel's backdrop-filter makes it the containing block of
// anything fixed inside it, so a click-away layer would cover the panel and
// nothing beyond — and Back closing it on a phone. Two things that menu never
// needed are added, because this one stays open while tags are ticked: Escape
// closes it, and so does the focus leaving it, or a keyboard would walk on
// into the cards underneath an open menu.

// How tall the open menu may grow. The panel clips whatever leaves it, so the
// menu has to end above the panel's bottom edge: 12rem is what stands over the
// menu when the chips have wrapped onto three lines (the header, the search
// box, the chips), with a little to spare. With fewer lines the menu only ends
// higher. At the panel's usual 30rem and up this is the 18rem.
const TAG_MENU_MAX_HEIGHT = `min(18rem, calc(${PANEL_HEIGHT} - 12rem))`;
// On a phone the filters scroll with the cards (scrollAsOne) and the menu with
// them, so nothing is clipped. There it is sized to be seen whole with the
// board scrolled to its top (finger-sized chips stand taller, hence 14rem),
// and never so short that a phone on its side, or the keyboard, leaves no room
// for a row of tags: past that the sheet scrolls to the rest of it.
const TAG_MENU_MAX_HEIGHT_SCROLLING = `min(18rem, max(11rem, calc(${PANEL_HEIGHT} - 14rem)))`;

const TAG_ITEM_SELECTOR = "[role=\"menuitemcheckbox\"]";

const tagMenuBoxStyle = {
  backgroundColor: "var(--oh-ui-surface, #1b1b1e)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: "10px",
  boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
  display: "flex",
  flexDirection: "column",
  // Under the whole row of chips and as wide as it, not hung from the button:
  // the button sits wherever the row wrapped to, and a menu that started at it
  // would run out of the side of the panel.
  left: 0,
  overflow: "hidden",
  position: "absolute",
  right: 0,
  top: "calc(100% + 0.3rem)",
  zIndex: 5,
};

// The count on the button, in the accent: what says a filter is at work while
// the menu is shut.
const tagCountStyle = {
  backgroundColor: "rgba(43,193,243,0.14)",
  border: "1px solid rgba(43,193,243,0.38)",
  borderRadius: "999px",
  color: "#2bc1f3",
  fontSize: "0.6rem",
  fontWeight: 800,
  lineHeight: 1,
  // Pulled in so the button stands no taller than the chips beside it.
  margin: "-0.1rem 0",
  minWidth: "1rem",
  padding: "0.08rem 0.28rem",
  textAlign: "center",
};

const TagMenuChevron = ({ open }) => (
  <svg aria-hidden="true" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.16s ease" }}>
    <path d="M5 9l7 7 7-7" />
  </svg>
);

// The box beside a tag. Drawn rather than a native checkbox: the toggle is the
// whole row, whose role carries the state to a screen reader, and a native box
// inside it would be a second control saying the same thing.
const TagTick = ({ checked }) => (
  <span
    aria-hidden="true"
    style={{
      alignItems: "center",
      backgroundColor: checked ? "#2bc1f3" : "transparent",
      border: `1px solid ${checked ? "#2bc1f3" : "rgba(255,255,255,0.32)"}`,
      borderRadius: "4px",
      color: "#0e0e10",
      display: "flex",
      flexShrink: 0,
      height: "0.95rem",
      justifyContent: "center",
      transition: "background-color 0.12s ease, border-color 0.12s ease",
      width: "0.95rem",
    }}
  >
    {checked && (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    )}
  </span>
);

// Attached only where a pointer can hover (useCanHover): a tap fires mouseenter
// and nothing fires mouseleave after it, so on a phone the last tag tapped
// would stay lit as though it meant something.
const lightTagRow = (event) => { event.currentTarget.style.background = "rgba(255,255,255,0.07)"; };
const dimTagRow = (event) => { event.currentTarget.style.background = "transparent"; };

// What the open menu holds. A component of its own so that it exists only
// while the menu is open: the search box starts empty every time and the list
// is put in order every time, with no reset to remember.
const TagMenuBody = ({ id, maxHeight, onClear, onToggle, selected, tags }) => {
  const [needle, setNeedle] = useState("");
  // What was ticked as the menu opened goes first in the list (tickedFirst),
  // and the order then holds until it closes: held in state, never set, so a
  // tag ticked now stays where the pointer found it.
  const [tickedAtOpen] = useState(selected);
  const isTouch = useTouchPrimary();
  const canHover = useCanHover();
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const searchable = tags.length >= TAG_SEARCH_FROM;
  const listed = tickedFirst(tags, tickedAtOpen);
  const shown = searchable ? searchTags(listed, needle) : listed;
  const ticked = new Set(selected);
  const noneTicked = selected.length === 0;

  const tagItems = () => Array.from(listRef.current?.querySelectorAll(TAG_ITEM_SELECTOR) ?? []);

  // With a keyboard the menu takes the focus as it opens — the search box when
  // there is one, else the first tag — so the next key lands inside it. Not
  // where a finger is the pointer: focus in a text field raises the keyboard
  // over the list the player opened the menu to read.
  useEffect(() => {
    if (isTouch) return;
    (searchRef.current ?? listRef.current?.querySelector(TAG_ITEM_SELECTOR))?.focus();
  }, [isTouch]);

  // The arrow keys a menu is expected to answer. Tab walks the tags as well,
  // each being a button, but sixty of them is a long walk.
  const onListKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const items = tagItems();
    const index = items.indexOf(event.target);
    if (index === -1) return;
    const next = stepTagFocus({
      // The tags level with the first one are a row of the grid.
      columns: items.filter((item) => item.offsetTop === items[0].offsetTop).length,
      count: items.length,
      index,
      key: event.key,
      rtl: getComputedStyle(event.currentTarget).direction === "rtl",
    });
    if (next === null) return;
    event.preventDefault();
    // Up from the top row is back to the search box, the way Down left it.
    if (next === index && event.key === "ArrowUp" && searchRef.current) searchRef.current.focus();
    else items[next].focus();
  };

  return (
    <div id={id} style={{ ...tagMenuBoxStyle, maxHeight }}>
      <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", flexShrink: 0, gap: "0.35rem", padding: "0.35rem" }}>
        {searchable && (
          <input
            ref={searchRef}
            className="oh-tap-row"
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            onKeyDown={(event) => {
              // Not while an input method is composing: Down picks a candidate there.
              if (event.key !== "ArrowDown" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              tagItems()[0]?.focus();
            }}
            onFocus={(event) => { event.currentTarget.style.borderColor = "rgba(43,193,243,0.6)"; }}
            onBlur={(event) => { event.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; }}
            placeholder="Find a tag…"
            aria-label="Find a tag…"
            style={{
              backgroundColor: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "8px",
              color: "white",
              flex: 1,
              fontFamily: "sans-serif",
              fontSize: "0.72rem",
              minWidth: 0,
              outline: "none",
              padding: "0.3rem 0.5rem",
            }}
          />
        )}
        {/* Dimmed when nothing is ticked, never disabled and never taken away.
            Taken away, it would bring its row back with the first tick and move
            every tag down under the pointer. Disabled, a button that had the
            focus as it went dead takes the keyboard with it in some browsers:
            no key reaches the page at all, Escape included. */}
        <button
          type="button"
          className="oh-tap-row"
          aria-disabled={noneTicked}
          onClick={() => { if (!noneTicked) onClear(); }}
          style={{
            ...ghostButtonStyle,
            cursor: noneTicked ? "default" : "pointer",
            flexShrink: 0,
            marginInlineStart: "auto",
            opacity: noneTicked ? 0.45 : 1,
            whiteSpace: "nowrap",
          }}
        >
          Clear selection
        </button>
      </div>

      {shown.length > 0 ? (
        <div
          ref={listRef}
          role="menu"
          aria-label="Tags"
          onKeyDown={onListKeyDown}
          style={{
            // As many columns as fit: two in the panel and on a phone, one on
            // a narrow phone. Tags are a word or two, and half the scrolling
            // is worth more than a line each.
            display: "grid",
            gap: "0.1rem 0.2rem",
            gridTemplateColumns: "repeat(auto-fill, minmax(8.75rem, 1fr))",
            minHeight: 0,
            overflowY: "auto",
            // The end of the list is not a reason to start scrolling the board.
            overscrollBehavior: "contain",
            padding: "0.3rem",
            scrollbarColor: "rgba(255,255,255,0.22) transparent",
            scrollbarWidth: "thin",
          }}
        >
          {shown.map((tag) => {
            const checked = ticked.has(tag);
            return (
              <button
                key={tag}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                className="oh-tap-row"
                onClick={() => onToggle(tag)}
                onMouseEnter={canHover ? lightTagRow : undefined}
                onMouseLeave={canHover ? dimTagRow : undefined}
                style={{
                  alignItems: "center",
                  background: "transparent",
                  border: "none",
                  borderRadius: "7px",
                  color: checked ? "#f4f4f5" : "rgba(255,255,255,0.68)",
                  cursor: "pointer",
                  display: "flex",
                  fontFamily: "sans-serif",
                  fontSize: "0.72rem",
                  gap: "0.45rem",
                  padding: "0.3rem 0.45rem",
                  textAlign: "start",
                }}
              >
                <TagTick checked={checked} />
                {/* Written by the model or the player, like the tags on a card:
                    the translator leaves it as it is. A long one wraps rather
                    than being cut, since a phone has no tooltip to finish it. */}
                <span data-no-translate style={{ minWidth: 0, overflowWrap: "anywhere" }}>{tag}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.72rem", fontStyle: "italic", padding: "0.75rem 0.6rem", textAlign: "center" }}>
          Nothing matched the search.
        </div>
      )}
    </div>
  );
};

const TagMenu = ({ maxHeight, onClear, onOpenChange, onToggle, open, selected, tags }) => {
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();
  // Lit while it is open and while it is filtering. With the count, that is
  // what stops a ticked tag hiding half the board from behind a shut menu.
  const lit = open || selected.length > 0;

  // Both listeners exist only while the menu is open.
  useEffect(() => {
    if (!open) return undefined;
    // A press anywhere but on the menu or its button shuts it. The focus is
    // left to whatever was pressed.
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) onOpenChange(false);
    };
    // Heard on the document, wherever the focus is: a press on the menu's own
    // blank space leaves the focus on nothing, and a key handler on the menu
    // would never hear Escape again. Stopped here so that one press closes one
    // thing, the menu, and not whatever else is listening for it behind. The
    // focus goes back to the button that opened it. An Escape that is only
    // cancelling an input method's composition is left alone.
    const onKeyDown = (event) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.stopPropagation();
      onOpenChange(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onOpenChange]);
  // On a phone, Back shuts the menu, and the Back after it the panel
  // (runtime/backToClose.js: the newest step closes first).
  useBackToClose(open, () => onOpenChange(false));

  // The focus going somewhere else closes the menu: Tab past the last tag
  // lands on a card, which is under it. Only a focus that has gone TO something
  // counts. A press on the menu's own blank space, or a tap in a browser that
  // does not focus what is tapped, takes the focus away to nothing, and that is
  // not leaving; a press outside the menu is the listener's above.
  const closeWhenFocusLeaves = (event) => {
    const next = event.relatedTarget;
    if (open && next && !event.currentTarget.contains(next)) onOpenChange(false);
  };

  return (
    <div ref={rootRef} onBlur={closeWhenFocusLeaves} style={{ display: "flex" }}>
      <button
        ref={buttonRef}
        type="button"
        className="oh-tap-row"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={selected.length > 0 ? `Tags, ${selected.length} selected` : undefined}
        title="Show only the entries that carry any of the tags you tick"
        onClick={() => onOpenChange(!open)}
        style={{
          ...chipBase,
          alignItems: "center",
          background: lit ? "rgba(0,0,0,0.39)" : "rgba(255,255,255,0.05)",
          border: `1px solid ${lit ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.1)"}`,
          color: lit ? "#f4f4f5" : "rgba(255,255,255,0.6)",
          display: "inline-flex",
          gap: "0.3rem",
        }}
      >
        {/* Each in an element of its own, so the translator and the string
            catalog see the word "Tags" alone and not a sentence built around
            the count. */}
        <span>Tags</span>
        {selected.length > 0 && <span data-no-translate style={tagCountStyle}>{selected.length}</span>}
        <TagMenuChevron open={open} />
      </button>
      {open && (
        <TagMenuBody
          id={menuId}
          maxHeight={maxHeight}
          onClear={onClear}
          onToggle={onToggle}
          selected={selected}
          tags={tags}
        />
      )}
    </div>
  );
};

// ---- the panel -------------------------------------------------------------

// Store slices, so a world write that touched neither the board nor the polity
// registry never reaches this panel.
const selectProjects = (world) => (Array.isArray(world?.projects) ? world.projects : []);
const selectArchivedProjects = (world) => (Array.isArray(world?.projectRecoveryArchive) ? world.projectRecoveryArchive : []);
const selectPolities = (world) => world?.polityOverrides ?? {};
const selectCountryStats = (world) => world?.countryStats ?? {};
const selectProjectFundingMode = (world) => world?.projectFundingMode === "nonmonetary" ? "nonmonetary" : "gdp-proxy";
const selectGameStamp = (game) => ({
  country: game?.country || "",
  gameDate: String(game?.gameDate ?? ""),
  round: Number(game?.round) || 0,
  economicDisplayCurrency: game?.economicDisplayCurrency,
});

const SectionTitle = ({ children, count }) => (
  <div style={{ ...smallLabel, display: "flex", gap: "0.35rem", marginTop: "0.2rem" }}>
    <span>{children}</span>
    {count > 0 && <span data-no-translate style={{ color: "rgba(255,255,255,0.3)" }}>{count}</span>}
  </div>
);

// `isOpen`: the Actions panel is open on this tab. Closing either is closing the board.
const ProjectsBoard = ({ isOpen, onOpenAdvisor, mapRef }) => {
  const projects = useRuntimeState("world", selectProjects);
  // Save-owner archive; never exposed by multiplayer guest-world projections.
  const projectArchive = useRuntimeState("world", selectArchivedProjects);
  const polityOverrides = useRuntimeState("world", selectPolities);
  const countryStats = useRuntimeState("world", selectCountryStats);
  const projectFundingMode = useRuntimeState("world", selectProjectFundingMode);
  const { country, gameDate, round, economicDisplayCurrency } = useRuntimeState("game", selectGameStamp);
  const displayCurrency = useSyncExternalStore(subscribeEconomicDisplayCurrency, getActiveEconomicDisplayCurrency);
  // The saved game (or shared seat override) is authoritative when entering a campaign.
  useEffect(() => {
    if (country) setActiveEconomicDisplayCurrency(economicDisplayCurrency);
  }, [country, economicDisplayCurrency]);
  const [eventTitles, setEventTitles] = useState(() => new Map());
  const [hasLoaded, setHasLoaded] = useState(false);
  const [customFlags, setCustomFlags] = useState(() => ({}));
  const ownerFlags = useMemo(
    () => ({ custom: customFlags, polities: polityOverrides }),
    [customFlags, polityOverrides],
  );
  const ownerNames = useMemo(() => Object.fromEntries(
    Object.entries(polityOverrides)
      .map(([code, polity]) => [code, String(polity?.name || "").trim()])
      .filter(([, name]) => name),
  ), [polityOverrides]);
  // game.country is the picker's `code` ("GBR" on a stock scenario); every
  // project's ownerCode has been through toCountryName ("United Kingdom").
  const playerCountry = useMemo(() => toCountryName(String(country ?? "")), [country]);
  // A landless player's own cards show neutral initials rather than borrow the
  // flag of the country their name resolves to (isPolityLandless).
  const playerLandless = useRuntimeState(
    "world",
    (world) => isPolityLandless(world, playerCountry),
    playerCountry,
  );

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("updated");
  const [activeTags, setActiveTags] = useState([]);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [pendingId, setPendingId] = useState("");
  const [planningId, setPlanningId] = useState("");
  const [planError, setPlanError] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveSelection, setArchiveSelection] = useState("");
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState({ text: "", error: false });
  // A change of funding or an abandon that did not happen, on its own card:
  // { id, text }. It was swallowed, and the card simply stayed as it was, the
  // host's reason unsaid (the review of 2026-11-18, door 7).
  const [cardError, setCardError] = useState({ id: "", text: "" });
  const failedOn = useCallback((project, failure) => {
    setCardError({ id: project.id, text: String(failure?.message || failure || "").trim() || uiString("The host did not take that.") });
  }, []);

  const isMobile = useIsMobile();
  const isTouch = useTouchPrimary();
  const scrollAsOne = isMobile || isTouch;

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    getNationFlags()
      .then((flags) => {
        if (!cancelled) setCustomFlags(flags || {});
      })
      .catch(() => { /* the badges fall back to the ISO flag, then to initials */ });
    return () => { cancelled = true; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    refreshRuntimeState(["world", "game"]).finally(() => {
      if (!cancelled) setHasLoaded(true);
    });
    return () => { cancelled = true; };
  }, [isOpen]);

  // Event titles for the activity feed, fetched only once a card is expanded.
  const expandedProject = useMemo(
    () => (expandedId ? projects.find((project) => project.id === expandedId) : null),
    [expandedId, projects],
  );
  const needsEventTitles = Boolean(expandedProject?.eventIds.some((id) => !eventTitles.has(id)));
  useEffect(() => {
    if (!needsEventTitles) return undefined;
    let cancelled = false;
    readEventsState({ force: true })
      .then((events) => {
        if (cancelled) return;
        setEventTitles((current) => {
          const next = new Map(current);
          for (const event of events) next.set(event.id, { date: event.date, title: event.title });
          return next;
        });
      })
      .catch(() => { /* the feed just stays empty */ });
    return () => { cancelled = true; };
  }, [needsEventTitles, expandedId]);

  // Closing the panel resets the transient view state.
  useEffect(() => {
    if (isOpen) return;
    setExpandedId(null);
    setShowClosed(false);
    setArchiveOpen(false);
    setTagMenuOpen(false);
  }, [isOpen]);

  // Only the projects the player knows of: their own, and those abroad their
  // services have learned of (isKnownToPlayer). The rest run unseen.
  const known = useMemo(() => projects.filter((project) => isKnownToPlayer(project, playerCountry)), [projects, playerCountry]);
  const availableTags = useMemo(() => collectProjectTags(known), [known]);
  useEffect(() => {
    setActiveTags((current) => {
      const next = current.filter((tag) => availableTags.includes(tag));
      return next.length === current.length ? current : next;
    });
  }, [availableTags]);

  const visible = useMemo(() => {
    const filtered = filterProjects(known, { owner: "all", playerCountry, query, tags: activeTags });
    const scoped = filtered.filter((project) => (showClosed ? isProjectClosed(project) : !isProjectClosed(project)));
    return sortProjects(scoped, sortKey);
  }, [known, playerCountry, query, activeTags, showClosed, sortKey]);
  const mine = useMemo(() => visible.filter((project) => isPlayerProject(project, playerCountry)), [visible, playerCountry]);
  const abroad = useMemo(() => visible.filter((project) => !isPlayerProject(project, playerCountry)), [visible, playerCountry]);

  const closedCount = useMemo(() => known.filter(isProjectClosed).length, [known]);
  // Only what the player knows of: the button never betrays a foreign power's closed covert work.
  const hasClosedBoardRecords = useMemo(() => known.some(isProjectClosed), [known]);
  const visibleArchive = useMemo(() => projectArchive.filter((entry) =>
    entry?.board === "world" && entry?.project && isKnownToPlayer(entry.project, playerCountry)),
  [projectArchive, playerCountry]);
  const openCount = known.length - closedCount;
  useEffect(() => {
    if (closedCount === 0) setShowClosed(false);
  }, [closedCount]);
  useEffect(() => {
    if (availableTags.length === 0) setTagMenuOpen(false);
  }, [availableTags]);

  // The player's budget and when each project should be done at the pace it is
  // going (projectEngine.js), worked out here from the world as it stands.
  const engineWorld = useMemo(() => ({ countryStats, projects, projectFundingMode }), [countryStats, projects, projectFundingMode]);
  const means = useMemo(() => ownerMeans(engineWorld, playerCountry, projects, playerCountry), [engineWorld, playerCountry, projects]);
  const finishes = useMemo(() => new Map(visible.map((project) => [
    project.id,
    project.targetDate || estimateProjectFinish(project, { world: engineWorld, projects, host: playerCountry, date: gameDate }),
  ])), [visible, engineWorld, projects, playerCountry, gameDate]);

  const toggleTag = useCallback((tag) => {
    setActiveTags((current) => (current.includes(tag) ? current.filter((entry) => entry !== tag) : [...current, tag]));
  }, []);
  const clearTags = useCallback(() => setActiveTags([]), []);
  const toggleExpand = useCallback((id) => setExpandedId((current) => (current === id ? null : id)), []);
  const askAdvisor = useCallback((prompt) => { onOpenAdvisor?.(prompt); }, [onOpenAdvisor]);

  // The board's player-authored writes, through the door that lets a government
  // touch its own programmes only (actor "player").
  // In a shared game the host applies them to this player's own board, by the
  // same door (multiplayer/game/messages.js "projectOps"); a refusal is thrown
  // like any failed write.
  const writeOps = useCallback(async (ops) => {
    if (inSharedGame()) {
      const answer = await requestFromHost("projectOps", { ops, by: "panel" });
      if (!answer?.ok) throw new Error(answer?.error || uiString("The host did not take that."));
      return;
    }
    // Shared canonical queue: read the latest world *inside* the mutation.
    // This serializes Projects edits with other page writers and the Stats
    // worker handoff, and rejects a queued edit after a campaign switch.
    await mutateWorldState((world) => {
      const { refusedProjectIds, world: nextWorld } = applyProjectOpsToWorld({
        actor: "player",
        date: gameDate,
        ops,
        playerCountry,
        round,
        world,
      });
      if (refusedProjectIds.length > 0) throw new Error(uiString("Project change refused: not authorized or the board is full."));
      return nextWorld;
    });
  }, [gameDate, playerCountry, round]);

  const setFunding = useCallback(async (project, funding) => {
    if (project.funding === funding) return;
    setPendingId(project.id);
    setCardError({ id: "", text: "" });
    try {
      await writeOps([{ op: "update", projectId: project.id, name: project.name, funding }]);
    } catch (failure) {
      // A failed write leaves the board as it was; the poll re-reads it. Why is said on the card.
      failedOn(project, failure);
    } finally {
      setPendingId("");
    }
  }, [writeOps, failedOn]);

  const setSecrecy = useCallback(async (project, secrecy) => {
    if (project.secrecy === secrecy) return;
    setPendingId(project.id);
    setCardError({ id: "", text: "" });
    try {
      await writeOps([{ op: "update", projectId: project.id, name: project.name, secrecy }]);
    } catch (failure) {
      // As above.
      failedOn(project, failure);
    } finally {
      setPendingId("");
    }
  }, [writeOps, failedOn]);

  // op cancel, never remove: the entry stays under Closed with the progress it reached.
  const abandonProject = useCallback(async (project) => {
    setPendingId(project.id);
    setCardError({ id: "", text: "" });
    try {
      await writeOps([{ op: "cancel", projectId: project.id, name: project.name, note: uiString("Abandoned by the player.") }]);
    } catch (failure) {
      // As above.
      failedOn(project, failure);
    } finally {
      setPendingId("");
    }
  }, [writeOps, failedOn]);

  // Explicit save maintenance, never a project operation or an AI decision.
  // Keep the complete closed records in the existing bounded archive. The
  // canonical queue reads the CURRENT world so a time skip or another writer
  // cannot be overwritten with a stale snapshot. Shared games use the owner
  // recovery tool instead: this panel has no authority over guest seat boards.
  const archiveClosed = useCallback(async () => {
    if (inSharedGame() || archiveBusy) return;
    if (!window.confirm(uiString("Archive all closed projects to free board slots? Their history will be preserved, and no running project will be affected."))) return;
    setArchiveBusy(true);
    setArchiveMessage({ text: "", error: false });
    try {
      let moved = 0;
      await mutateWorldState((world) => {
        const next = archiveClosedProjectsInWorld(world, { date: gameDate });
        // Counted as the player knows the board: a foreign power's covert work is archived too, never told.
        const kept = new Set(next.projects.map((project) => project?.id));
        moved = (world.projects ?? []).filter((project) => !kept.has(project?.id) && isKnownToPlayer(project, playerCountry)).length;
        return next;
      });
      await refreshRuntimeState(["world"]);
      setArchiveMessage({ text: uiString("Archived {{count}} closed project records.", { count: moved }), error: false });
    } catch (failure) {
      setArchiveMessage({ text: String(failure?.message || failure), error: true });
    } finally {
      setArchiveBusy(false);
    }
  }, [archiveBusy, gameDate, playerCountry]);

  const restoreArchived = useCallback(async () => {
    if (inSharedGame() || archiveBusy || !archiveSelection) return;
    setArchiveBusy(true);
    setArchiveMessage({ text: "", error: false });
    try {
      await mutateWorldState((world) => restoreArchivedProjectInWorld(world, {
        projectId: archiveSelection, date: gameDate,
      }));
      await refreshRuntimeState(["world"]);
      setArchiveSelection("");
      setArchiveMessage({ text: uiString("Archived project restored to the live board."), error: false });
    } catch (failure) {
      setArchiveMessage({ text: String(failure?.message || failure), error: true });
    } finally {
      setArchiveBusy(false);
    }
  }, [archiveBusy, archiveSelection, gameDate]);

  // A project the advisor opened without a plan: one request plans it, and it starts.
  const planEntry = useCallback(async (project) => {
    setPlanningId(project.id);
    setPlanError("");
    try {
      const draft = await planProject({ name: project.name, goal: project.summary });
      await writeOps([{ op: "update", projectId: project.id, name: project.name, plan: draft.plan }]);
    } catch (failure) {
      setPlanError(String(failure?.message || failure || "").trim() || uiString("The plan could not be made."));
    } finally {
      setPlanningId("");
    }
  }, [writeOps]);

  const showOnMap = useCallback(async (project) => {
    const map = mapRef?.current;
    if (!map?.flyTo) return;
    let target = project.focus;
    if (!target) {
      try {
        const world = await readWorldState();
        const markers = Array.isArray(world?.markers) ? world.markers : [];
        const units = Array.isArray(world?.units) ? world.units : [];
        const hit = markers.find((entry) => project.linkedMarkerIds.includes(entry.id)) || units.find((entry) => project.linkedUnitIds.includes(entry.id));
        if (hit) target = { lng: hit.lng, lat: hit.lat };
      } catch {
        // No world read, no camera move.
      }
    }
    if (!target || !Number.isFinite(target.lng) || !Number.isFinite(target.lat)) return;
    map.flyTo({ center: [target.lng, target.lat], zoom: 5 });
  }, [mapRef]);

  const nearLimit = projects.length >= PROJECT_BOARD_LIMIT - 10;
  const card = (project) => (
    <ProjectCard
      key={project.id}
      project={project}
      fundingMode={means.mode}
      displayCurrency={displayCurrency}
      eventTitles={eventTitles}
      expanded={expandedId === project.id}
      onToggleExpand={toggleExpand}
      busy={pendingId === project.id}
      error={cardError.id === project.id ? cardError.text : ""}
      planning={planningId === project.id}
      playerCountry={playerCountry}
      playerLandless={playerLandless}
      ownerFlags={ownerFlags}
      ownerNames={ownerNames}
      finish={finishes.get(project.id) || ""}
      onAskAdvisor={askAdvisor}
      onShowOnMap={showOnMap}
      onSetFunding={setFunding}
      onSetSecrecy={setSecrecy}
      onAbandon={abandonProject}
      onPlan={planEntry}
    />
  );

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0 }}>
      <div style={scrollAsOne
        ? { display: "flex", flex: 1, flexDirection: "column", minHeight: 0, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.22) transparent" }
        : { display: "contents" }}
      >
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: "0.5rem", padding: "0.6rem 1rem 0.7rem" }}>
        <NewProject owner={playerCountry} fundingMode={means.mode} displayCurrency={displayCurrency} writeOps={writeOps} onStarted={() => setShowClosed(false)} />
        <div
          style={{ color: "rgba(255,255,255,0.5)", display: "flex", flexWrap: "wrap", fontSize: "0.68rem", gap: "0.6rem" }}
          title={means.mode === "nonmonetary"
            ? uiString("Projects consume time and capacity, without claiming money or a national treasury.")
            : `${uiString("The project allowance is an estimate from GDP, budget balance and public debt. Spending is not reconciled to a national treasury.")} ${economicDisplayUnitLabel(displayCurrency)}.`}
        >
          {means.mode === "nonmonetary" ? (
            <span>{uiString("Non-monetary project funding: time and capacity only; no GDP or cash payments required")}</span>
          ) : means.budget === null ? (
            <span style={{ color: "#fbbf24" }}>{uiString("No native GDP baseline: paid projects cannot receive funding until assessed")}</span>
          ) : (
            <>
              <span>{uiString("Estimated project allowance: {{amount}} per month", { amount: formatMoney(means.budget, displayCurrency) })}</span>
              <span>{uiString("Planned monthly commitments: {{amount}}", { amount: formatMoney(means.committed, displayCurrency) })}</span>
              {means.covered < 1 && <span style={{ color: "#fbbf24" }}>{uiString("Underfunded: planned costs exceed allowance")}</span>}
            </>
          )}
        </div>
        {known.length > 0 && (
          <>
            <div style={{ position: "relative" }}>
              <span style={{ color: "rgba(255,255,255,0.35)", display: "flex", left: "0.55rem", position: "absolute", top: "50%", transform: "translateY(-50%)" }}>
                <SearchIcon />
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects…"
                data-no-translate
                style={{ ...inputStyle, padding: "0.4rem 0.5rem 0.4rem 1.7rem" }}
              />
            </div>
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", position: "relative" }}>
              <select className="oh-tap-row" value={sortKey} onChange={(event) => setSortKey(event.target.value)} style={selectStyle} data-no-translate>
                {PROJECT_SORTS.map((sort) => (
                  <option key={sort.key} value={sort.key} style={{ backgroundColor: "#18181b" }}>{sort.label}</option>
                ))}
              </select>
              {closedCount > 0 && (
                <Chip active={showClosed} onClick={() => setShowClosed((value) => !value)}>
                  {showClosed ? `← Running (${openCount})` : `Closed (${closedCount})`}
                </Chip>
              )}
              {availableTags.length > 0 && (
                <TagMenu
                  open={tagMenuOpen}
                  onOpenChange={setTagMenuOpen}
                  tags={availableTags}
                  selected={activeTags}
                  onToggle={toggleTag}
                  onClear={clearTags}
                  maxHeight={scrollAsOne ? TAG_MENU_MAX_HEIGHT_SCROLLING : TAG_MENU_MAX_HEIGHT}
                />
              )}
            </div>
          </>
        )}
      </div>

      {!inSharedGame() && (hasClosedBoardRecords || visibleArchive.length > 0) && (
        <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", flexWrap: "wrap", gap: "0.45rem", padding: "0.45rem 1rem" }}>
          {hasClosedBoardRecords && (
            <button type="button" disabled={archiveBusy} onClick={archiveClosed} style={{ ...selectStyle, cursor: archiveBusy ? "wait" : "pointer" }}>
              {uiString("Archive closed projects")}
            </button>
          )}
          {visibleArchive.length > 0 && (
            <button type="button" disabled={archiveBusy} onClick={() => setArchiveOpen((value) => !value)} style={{ ...selectStyle, cursor: "pointer" }}>
              {uiString("Archived projects ({{count}})", { count: visibleArchive.length })}
            </button>
          )}
        </div>
      )}
      {!inSharedGame() && archiveOpen && visibleArchive.length > 0 && (
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.45rem", padding: "0.5rem 1rem" }}>
          <select aria-label={uiString("Archived project to restore")} value={archiveSelection} onChange={(event) => setArchiveSelection(event.target.value)} style={{ ...selectStyle, flex: 1, minWidth: "10rem" }}>
            <option value="">{uiString("Select archived project...")}</option>
            {visibleArchive.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.project.name} ({entry.priorStatus || entry.project.status})</option>
            ))}
          </select>
          <button type="button" disabled={archiveBusy || !archiveSelection || projects.length >= PROJECT_BOARD_LIMIT} onClick={restoreArchived} style={{ ...selectStyle, cursor: "pointer" }}>
            {uiString("Restore selected")}
          </button>
          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.65rem" }}>
            {uiString("Restoration requires a free slot and does not replay missed progress.")}
          </span>
        </div>
      )}
      {archiveMessage.text && (
        <div role={archiveMessage.error ? "alert" : "status"} style={{ color: archiveMessage.error ? "#fca5a5" : "#a7f3d0", fontSize: "0.7rem", padding: "0.4rem 1rem" }}>
          {archiveMessage.text}
        </div>
      )}

      {nearLimit && (
        <div style={{
          backgroundColor: "rgba(245,158,11,0.12)",
          borderBottom: "1px solid rgba(245,158,11,0.3)",
          color: "rgba(253,230,138,0.95)",
          fontSize: "0.7rem",
          lineHeight: 1.45,
          padding: "0.5rem 1rem",
        }}
        >
          {projects.length >= PROJECT_BOARD_LIMIT
            ? `The board is full (${PROJECT_BOARD_LIMIT}). New projects are refused; existing entries are preserved.`
            : `${PROJECT_BOARD_LIMIT - projects.length} slots left before new projects are refused.`}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem", ...(scrollAsOne ? { flexShrink: 0 } : { flex: 1, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.22) transparent" }), padding: "0.75rem 1rem 1rem" }}>
        {!hasLoaded && (
          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.75rem", padding: "1rem 0", textAlign: "center" }}>
            Loading…
          </div>
        )}
        {planError && <div style={{ color: "#fca5a5", fontSize: "0.7rem" }}>{planError}</div>}
        {hasLoaded && known.length > 0 && visible.length === 0 && (
          <div style={{ border: "1px dashed rgba(255,255,255,0.14)", borderRadius: "10px", color: "rgba(255,255,255,0.4)", fontSize: "0.73rem", fontStyle: "italic", padding: "0.9rem", textAlign: "center" }}>
            {showClosed ? "No closed entries match those filters." : "Nothing matches those filters."}
          </div>
        )}
        {mine.length > 0 && <SectionTitle count={mine.length}>{uiString("Your projects")}</SectionTitle>}
        {mine.map(card)}
        {abroad.length > 0 && <SectionTitle count={abroad.length}>{uiString("Known projects abroad")}</SectionTitle>}
        {abroad.map(card)}
      </div>
      </div>{/* the phone scroller */}
    </div>
  );
};

// The board glyph, for its tab in the Actions panel.
const ProjectsTabIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8" />
    <path d="M8 12h8" />
    <path d="M8 16h5" />
  </svg>
);

export { ProjectsBoard, ProjectsTabIcon };
