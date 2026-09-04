/*! Open Historia — portions (projects & operations board panel) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The Projects & Operations board: every long-running effort the player has going
// — research and industrial programmes, construction projects, military and
// covert operations — plus whatever their services have learned of other powers'.
//
// The player cannot author an entry's CONTENT here, deliberately. Two things
// write what a project is: events, through impacts.projectOps on any
// jump/GM/catalyst turn, and the advisor, through the ```projects block in a chat
// reply. A board the player could hand-edit would be a wishlist; this one is a
// readout of what the simulation actually believes is happening.
//
// Two things the player DOES own, and only these two: a project's priority — how
// much attention they want it to get, which the jump and advisor prompts then act
// on — and whether to abandon it outright. Neither invents or rewrites anything;
// they are the difference between a board of thirty programmes being steerable and
// being a wall. Both go through applyProjectOpsToWorld, the same door the advisor
// uses, rather than hand-editing the array: the ops pipeline is what stamps
// updatedAt/updatedRound (so an abandoned project does not immediately reappear
// wearing a "no recent progress" badge) and what closes out dangling milestones.
//
// And both belong to THEIR OWN work only. Roughly half a mature board is other
// powers' programmes, tracked because the player's services have learned of them,
// and a priority dial or an Abandon button on a rival's shipyard says the player
// commands it. So a foreign card carries neither control, the ops door is called
// with actor "player" so a stale render cannot get round that, and the advisor and
// jump prompts are told to refuse the same request in words — with the one opening
// that makes sense, which is opening the player's OWN counter-effort against it.
//
// Because of that split the board opens on Mine. A player who wants the rival
// column asks for it; the default view is the work they can actually steer.
//
// Everything date-derived (overdue, due soon, a slipped milestone, a programme
// nobody has mentioned in three rounds) is computed here from the game clock by
// runtime/projects.js, NOT read off what the model last wrote. That is what keeps
// the board honest between AI turns.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { JSON_URLS, getNationFlags, readJson } from "../../runtime/assets.js";
import { flagImageUrlFromGid } from "../../runtime/countryFlags.js";
import {
  PROJECT_BOARD_LIMIT,
  applyProjectOpsToWorld,
  isPolityLandless,
  readEventsState,
  readWorldState,
  writeWorldState,
} from "../../runtime/gameState.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import {
  PROJECT_SORTS,
  collectProjectTags,
  isProjectClosed,
  isProjectOpen,
  isPlayerProject,
  deriveProjectFlags,
  describeTimeline,
  filterProjects,
  sortProjects,
} from "../../runtime/projects.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";

// The seed the empty state and the per-card button hand to the advisor. Both
// pre-fill the input and never send — the player edits and presses send, which is
// the rule the advisor's requestedPrompt path has always followed.
// Deliberately asks for a BATCH, not for everything.
//
// The first version of this asked for every effort at once. On a campaign forty
// rounds deep that is dozens of entries with full milestone histories, which runs
// past the 8192-token reply cap and arrives as a half-written JSON array — the
// board stays empty and the player gets a wall of text. Ten at a time, one
// sentence each, and only the milestones still ahead keeps a reply inside its
// budget; the retry button asks for the next batch.
export const PROJECTS_BACKFILL_PROMPT =
  "Put my current projects and operations on the board — the sustained efforts, "
  + "mine and any belonging to other powers that we know about. Start with the TEN "
  + "most significant and stop there; I will ask for the next batch after. Keep each "
  + "summary to one sentence, and give each only the milestones still ahead of it "
  + "plus the single most recent one already achieved. Only include efforts that genuinely "
  + "appear in our history — never invent one to round out the list — and say plainly if "
  + "you are unsure about any of them.";

const buildBriefPrompt = (project) => {
  const label = project.kind === "operation" ? "operation" : "project";
  return `Brief me in full on the ${label} "${project.name}". Where does it actually stand `
    + "right now, what has moved since the last round, what does the next milestone need from "
    + "me, and what is most likely to go wrong? Be specific and tell me if the board is "
    + "out of date.";
};

// The same button on a foreign card, asking the questions that are actually
// answerable about somebody else's programme. "What does the next milestone need
// from me" is nonsense here — nothing about a rival's shipyard needs anything from
// the player — and asking it invites the model to answer as though they ran it.
const buildForeignBriefPrompt = (project, owner) => {
  const label = project.kind === "operation" ? "operation" : "programme";
  const whose = owner ? `${owner}'s ` : "the foreign ";
  return `Brief me on ${whose}${label} "${project.name}". What do we actually know, how good `
    + "is the sourcing, what has changed since we last looked, and what does it mean for us if "
    + "it succeeds? Be honest about how much of this is inference rather than intelligence.";
};

// The seed behind a foreign card's second button. Deliberately asks a QUESTION
// rather than issuing an order: the player cannot cancel another government's
// programme, but they can decide to do something about it, and that something is a
// project of their own the advisor may legitimately open.
const buildCounterPrompt = (project, owner) => {
  const whose = owner ? `${owner}'s` : "this";
  return `What can we actually do about ${whose} "${project.name}"? Lay out the realistic `
    + "options — diplomatic, economic, covert, or simply outpacing them — with what each would "
    + "cost us and how it could go wrong. If we settle on one, open it as our own effort.";
};

// ---- styling ---------------------------------------------------------------
// Inline objects and per-file constants, the house convention: there is no shared
// primitives module, so the pattern is copied and the source cited. Surface and
// palette match actions.jsx / time.jsx so the panel reads as part of the same HUD.

const STATUS_TONES = {
  proposed: { label: "Proposed", color: "#93c5fd", bg: "rgba(59,130,246,0.16)" },
  active: { label: "Active", color: "#4ade80", bg: "rgba(34,197,94,0.16)" },
  stalled: { label: "Stalled", color: "#fbbf24", bg: "rgba(245,158,11,0.18)" },
  paused: { label: "Paused", color: "rgba(255,255,255,0.6)", bg: "rgba(255,255,255,0.08)" },
  complete: { label: "Complete", color: "#67e8f9", bg: "rgba(6,182,212,0.16)" },
  failed: { label: "Failed", color: "#f87171", bg: "rgba(239,68,68,0.18)" },
  cancelled: { label: "Cancelled", color: "rgba(255,255,255,0.45)", bg: "rgba(255,255,255,0.06)" },
};

const statusTone = (status) => STATUS_TONES[status] || STATUS_TONES.active;

// Progress reads against the project's health, not a fixed ramp: a stalled
// programme at 80% is not doing well, and colouring it green would say it was.
const progressColor = (project, flags) => {
  if (project.status === "complete") return "#22d3ee";
  if (project.status === "failed" || project.status === "cancelled") return "rgba(255,255,255,0.25)";
  if (flags.overdue) return "#ef4444";
  if (flags.stale || flags.milestoneMissed) return "#f59e0b";
  return "#22c55e";
};

const SECRECY_GLYPH = { restricted: "🔒", covert: "🕵" };

// How far an entry can be trusted, when it came from a spy at all. Never says
// WHY — the player is not told their agent was turned, only that the analysts
// stopped trusting the channel, which is the same thing the Spy tab shows.
const VERIFICATION_BADGE = {
  doubted: { label: "Doubtful", color: "#fbbf24", background: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.4)", title: "Our analysts do not trust how we came by this. Put someone else in place to settle it." },
  confirmed: { label: "Confirmed", color: "#86efac", background: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.4)", title: "A second source stands this up." },
  refuted: { label: "Fabricated", color: "#fca5a5", background: "rgba(248,113,113,0.14)", border: "rgba(248,113,113,0.4)", title: "A second source showed there was never anything here." },
};

const cardStyle = {
  backgroundColor: "rgba(255,255,255,0.045)",
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
  backgroundColor: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "8px",
  color: "white",
  fontFamily: "sans-serif",
  fontSize: "0.72rem",
  outline: "none",
  padding: "0.3rem 0.4rem",
};

const ghostButtonStyle = {
  background: "rgba(255,255,255,0.06)",
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

// Reused from stats.jsx's Bar — a 6px pill track with a coloured fill that
// animates its width.
const Bar = ({ value, color }) => (
  <div style={{ backgroundColor: "rgba(255,255,255,0.1)", borderRadius: "999px", height: "6px", overflow: "hidden" }}>
    <div style={{
      backgroundColor: color,
      borderRadius: "999px",
      height: "100%",
      transition: "width 0.4s",
      width: `${Math.max(0, Math.min(100, Math.round(Number(value) || 0)))}%`,
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
    title={title}
    onClick={onClick}
    style={{
      ...chipBase,
      background: active ? "rgba(139,92,246,0.28)" : "rgba(255,255,255,0.05)",
      border: `1px solid ${active ? "rgba(139,92,246,0.6)" : "rgba(255,255,255,0.1)"}`,
      color: active ? "#ddd6fe" : "rgba(255,255,255,0.6)",
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

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// Whose programme this is, with their flag.
//
// Same precedence every other flag in the game follows — copied and cited rather
// than shared, the house pattern (see resolveEraFlagInfo in Selection/Regions.jsx
// and resolveUnitFlagUrl in Map/unitFlagIcons.js): a flag the map-maker uploaded
// into the scenario's flags.json wins, because it is the only one anyone chose on
// purpose; then a scenario polity's own; then the ISO flag the owner name resolves
// to. A custom era polity with none of the three shows its initials, exactly as
// the country panel does.
const resolveOwnerFlagUrl = (owner, customFlags, polities) => {
  if (!owner) return "";
  return customFlags?.[owner] || polities?.[owner]?.flag || flagImageUrlFromGid(owner) || "";
};

const ownerInitials = (owner) =>
  String(owner).replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "??";

// The board is half other people's work, and until this row existed the only clue
// was a grey line of text that a player's own entries did not have at all — so
// "Long-Range Rocket Programme" read as yours whether it was or not. Every card
// carries it now, the player's included, and the flag is what the eye actually
// picks up when scanning thirty of them.
const OwnerBadge = ({ flagUrl, mine, name }) => {
  const [flagFailed, setFlagFailed] = useState(false);
  useEffect(() => { setFlagFailed(false); }, [flagUrl]);

  return (
    <div style={{ alignItems: "center", display: "flex", gap: "0.35rem", marginTop: "0.25rem", minWidth: 0 }}>
      <span style={{
        alignItems: "center",
        backgroundColor: "rgba(59,130,246,0.16)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "3px",
        color: "#93c5fd",
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
            src={flagUrl}
            onError={() => setFlagFailed(true)}
            style={{ height: "100%", objectFit: "cover", width: "100%" }}
          />
        ) : ownerInitials(name)}
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
      {!mine && (
        <Pill color="rgba(253,186,116,0.9)" bg="rgba(249,115,22,0.16)" title="Another power's effort. You are tracking it, not running it.">
          Foreign
        </Pill>
      )}
    </div>
  );
};

// ---- one card --------------------------------------------------------------

const PRIORITY_OPTIONS = [
  { glyph: "▲", key: "high", label: "High priority — the advisor briefs it first and the simulation is told to keep it moving" },
  { glyph: "●", key: "normal", label: "Normal priority" },
  { glyph: "▼", key: "low", label: "Low priority — allowed to drift while more urgent work moves" },
];

const PRIORITY_PILL = {
  high: { bg: "rgba(245,158,11,0.16)", color: "#fcd34d", label: "High" },
  low: { bg: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)", label: "Low" },
};

// A three-segment control rather than a <select>: there are exactly three values,
// the current one has to be readable at a glance on a card the player is scanning,
// and a dropdown would hide the setting behind a click on every card.
const PrioritySwitch = ({ busy, onSelect, value }) => (
  <div style={{ display: "flex", gap: "0.15rem" }} role="group" aria-label="Priority">
    {PRIORITY_OPTIONS.map((option) => {
      const active = value === option.key;
      return (
        <button
          key={option.key}
          type="button"
          disabled={busy}
          title={option.label}
          aria-pressed={active}
          onClick={() => onSelect(option.key)}
          style={{
            ...ghostButtonStyle,
            background: active ? "rgba(139,92,246,0.28)" : "rgba(255,255,255,0.06)",
            border: `1px solid ${active ? "rgba(139,92,246,0.6)" : "rgba(255,255,255,0.12)"}`,
            color: active ? "#ddd6fe" : "rgba(255,255,255,0.5)",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.5 : 1,
            padding: "0.3rem 0.45rem",
          }}
        >
          {option.glyph}
        </button>
      );
    })}
  </div>
);

const ProjectCard = memo(({ project, gameDate, round, eventTitles, expanded, busy, playerCountry, playerLandless, ownerFlags, ownerNames, onToggleExpand, onAskAdvisor, onShowOnMap, onSetPriority, onAbandon }) => {
  // Derived here rather than passed in: a flags object built by the parent would
  // be a new reference every render and the memo above would never hold.
  const flags = deriveProjectFlags(project, gameDate, round);
  const tone = statusTone(project.status);
  const open = isProjectOpen(project);
  const mine = isPlayerProject(project, playerCountry);
  // Meaningless on somebody else's programme, and a legacy board can carry one:
  // priority was settable on a foreign entry before this, so an old save still has
  // "High" stamped on a rival's shipyard. Hide it rather than migrate the data —
  // the field is harmless where it sits and the prompt suppresses it too.
  const priorityPill = mine ? PRIORITY_PILL[project.priority] : null;
  // Two-step confirm rather than window.confirm, which breaks this panel's visual
  // language and is blocked outright in some embedded contexts. Reset whenever the
  // card stops being abandonable, so a closed project cannot keep a primed button.
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  useEffect(() => {
    if (!open) setConfirmingAbandon(false);
  }, [open]);
  const timeline = describeTimeline(project, gameDate);
  const secrecy = SECRECY_GLYPH[project.secrecy];
  // A blank ownerCode means the player (see isPlayerProject) — so their own cards
  // fall back to their own country rather than showing no owner at all, which is
  // what made a foreign entry indistinguishable from theirs in the first place.
  const ownerKey = String(project.ownerCode || "").trim() || String(playerCountry || "").trim();
  // The era display name, so a renamed polity reads as the story calls it. The KEY
  // stays the identity everything else is filed under (see ownerNames.js).
  const ownerLabel = ownerNames?.[ownerKey] || ownerKey;

  // The camera target, resolved the same way the button does, so the button can
  // be hidden rather than offered and then doing nothing.
  const hasFocus = Boolean(project.focus) || project.linkedMarkerIds.length > 0 || project.linkedUnitIds.length > 0;

  const activity = expanded
    ? project.eventIds.map((id) => ({ id, entry: eventTitles.get(id) })).filter((row) => row.entry)
    : [];

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
        <div style={{ alignItems: "center", display: "flex", gap: "0.25rem" }}>
          {priorityPill && (
            <Pill color={priorityPill.color} bg={priorityPill.bg} title="Priority the player set for this effort">
              {priorityPill.label}
            </Pill>
          )}
          {flags.ongoing && (
            <Pill color="rgba(255,255,255,0.55)" bg="rgba(255,255,255,0.08)" title="A standing effort with no planned end">
              Ongoing
            </Pill>
          )}
          <Pill color={tone.color} bg={tone.bg}>{tone.label}</Pill>
        </div>
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
              style={{
                backgroundColor: "rgba(255,255,255,0.06)",
                borderRadius: "999px",
                color: "rgba(255,255,255,0.5)",
                fontSize: "0.62rem",
                padding: "0.1rem 0.4rem",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div style={{ marginTop: "0.55rem" }}>
        <div style={{
          color: "rgba(255,255,255,0.45)",
          display: "flex",
          fontSize: "0.65rem",
          justifyContent: "space-between",
          marginBottom: "0.25rem",
        }}
        >
          <span data-no-translate>{timeline}</span>
          <span data-no-translate>{project.progress}%</span>
        </div>
        <Bar value={project.progress} color={progressColor(project, flags)} />
      </div>

      {flags.nextMilestone && (
        <div data-no-translate style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.7rem", marginTop: "0.45rem" }}>
          {flags.nextMilestone.repeat ? "↻" : "▸"} Next: {flags.nextMilestone.title}
          {flags.nextMilestone.date ? ` — ${flags.nextMilestone.date}` : ""}
          {flags.nextMilestone.repeat && (
            <span style={{ color: "rgba(255,255,255,0.35)" }}>
              {" "}({flags.nextMilestone.repeat}
              {flags.nextMilestone.completedCount > 0 ? `, done ${flags.nextMilestone.completedCount}×` : ""})
            </span>
          )}
        </div>
      )}

      {project.lastUpdate && (
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.7rem", fontStyle: "italic", marginTop: "0.35rem" }}>
          {project.lastUpdate}
        </div>
      )}

      {/* Derived warnings. None of these come from the model, so they cannot be
          out of date the way a written status can. */}
      {(flags.overdue || flags.dueSoon || flags.milestoneMissed || flags.stale) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.5rem" }}>
          {flags.overdue && (
            <Pill color="#fca5a5" bg="rgba(239,68,68,0.18)" title={`Target date passed ${Math.abs(flags.daysToTarget)} days ago`}>
              ⚠ Overdue
            </Pill>
          )}
          {flags.dueSoon && (
            <Pill color="#fcd34d" bg="rgba(245,158,11,0.16)" title="A milestone falls inside the next month">
              ⏳ Due in {flags.daysToMilestone}d
            </Pill>
          )}
          {flags.milestoneMissed && !flags.overdue && (
            <Pill color="#fcd34d" bg="rgba(245,158,11,0.16)" title="A milestone's date passed while it was still pending">
              Milestone slipped
            </Pill>
          )}
          {/* The same derived flag, said honestly for each side. On the player's own
              work it means the programme has not moved; on a rival's it means
              nothing has REACHED us about it for several rounds, which is a fact
              about our sources and not about their shipyard. */}
          {flags.stale && (
            <Pill
              color="rgba(255,255,255,0.55)"
              bg="rgba(255,255,255,0.07)"
              title={mine
                ? "No progress reported for several rounds"
                : "Nothing has reached us about this for several rounds"}
            >
              {mine ? "No recent progress" : "No fresh intelligence"}
            </Pill>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.6rem" }}>
        <button
          type="button"
          style={ghostButtonStyle}
          onClick={() => onAskAdvisor(mine
            ? buildBriefPrompt(project)
            : buildForeignBriefPrompt(project, ownerLabel))}
          onMouseEnter={(event) => { event.currentTarget.style.background = "rgba(139,92,246,0.25)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
        >
          🧭 {mine ? "Ask advisor" : "What do we know?"}
        </button>
        {/* The one thing the player CAN do about a rival's programme, offered where
            the priority dial would have been: not a lever on their work, a question
            about ours. Whatever comes of it is a project of the player's own, opened
            by the advisor the normal way. */}
        {!mine && open && (
          <button
            type="button"
            style={ghostButtonStyle}
            onClick={() => onAskAdvisor(buildCounterPrompt(project, ownerLabel))}
            onMouseEnter={(event) => { event.currentTarget.style.background = "rgba(249,115,22,0.25)"; }}
            onMouseLeave={(event) => { event.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
          >
            ⚖ Our options
          </button>
        )}
        {hasFocus && (
          <button
            type="button"
            style={ghostButtonStyle}
            onClick={() => onShowOnMap(project)}
            onMouseEnter={(event) => { event.currentTarget.style.background = "rgba(59,130,246,0.25)"; }}
            onMouseLeave={(event) => { event.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
          >
            📍 Show on map
          </button>
        )}
        {project.eventIds.length > 0 && (
          <button
            type="button"
            style={ghostButtonStyle}
            onClick={() => onToggleExpand(project.id)}
            onMouseEnter={(event) => { event.currentTarget.style.background = "rgba(255,255,255,0.12)"; }}
            onMouseLeave={(event) => { event.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
          >
            {expanded ? "▾" : "▸"} Activity ({project.eventIds.length})
          </button>
        )}
      </div>

      {/* Why the controls below are missing, said once on the card rather than left
          as an unexplained gap. Only while the work is running — a finished foreign
          programme has no controls for anyone and needs no note about it. */}
      {!mine && open && (
        <div style={{
          borderTop: "1px solid rgba(255,255,255,0.07)",
          color: "rgba(255,255,255,0.38)",
          fontSize: "0.66rem",
          lineHeight: 1.45,
          marginTop: "0.6rem",
          paddingTop: "0.55rem",
        }}
        >
          {ownerLabel ? `${ownerLabel} runs this` : "Another power runs this"} — you can watch it and act against it,
          but its priority and its cancellation are not yours to set.
        </div>
      )}

      {/* The player's own two levers, kept on their own row and only while the
          work is still running and it is actually theirs: neither means anything on
          a closed entry, and neither means anything at all on somebody else's. */}
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
          <PrioritySwitch
            busy={busy}
            value={project.priority}
            onSelect={(priority) => onSetPriority(project, priority)}
          />
          <button
            type="button"
            disabled={busy}
            title="Close this out. It stays on the board under Closed, keeping the progress it reached."
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

// ---- the panel -------------------------------------------------------------

const ProjectsPanel = ({ isOpen, onClose, onOpenAdvisor, mapRef }) => {
  const [projects, setProjects] = useState([]);
  const [gameDate, setGameDate] = useState("");
  const [round, setRound] = useState(0);
  const [playerCountry, setPlayerCountry] = useState("");
  const [eventTitles, setEventTitles] = useState(() => new Map());
  const [hasLoaded, setHasLoaded] = useState(false);
  // Everything the owner badge needs: the scenario's uploaded flags (a static
  // asset, read once) and the live polity registry, which carries both a custom
  // flag and the era display name. Held together so a card can resolve an owner
  // without three lookups of its own.
  const [ownerFlags, setOwnerFlags] = useState(() => ({ custom: {}, polities: {} }));
  const [ownerNames, setOwnerNames] = useState(() => ({}));
  // Is the PLAYER stateless? A landless player's name may still resolve to a real
  // country, but they are not it — a government-in-exile is not the government —
  // so their own cards must show neutral initials rather than borrow that
  // country's flag. Same rule and same single source of truth as the Stats pane
  // (see isPolityLandless, which exists for exactly these resolvers). Only the
  // player's own entries: a FOREIGN owner that resolves to a country genuinely is
  // that country as far as this board knows.
  const [playerLandless, setPlayerLandless] = useState(false);

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("updated");
  // Opens on the player's own work. A mature board is roughly half other powers'
  // programmes, and showing all of it by default buried the handful of things the
  // player can actually steer among a column of rivals' shipyards they cannot.
  // Foreign is one chip away and says how many are behind it.
  const [owner, setOwner] = useState("mine");
  const [activeTags, setActiveTags] = useState([]);
  const [showClosed, setShowClosed] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  // The project a write is currently in flight for, so its own controls can be
  // disabled without freezing the rest of the board.
  const [pendingId, setPendingId] = useState("");

  const isMobile = useIsMobile();
  // The signature the 5s poll compares against, so a poll that changed nothing
  // does not re-render the list under the player's cursor.
  const signatureRef = useRef("");
  // The same trick for the polity registry, which rides the same read but changes
  // far less often than the board does. Mirrors Units.jsx's polityFlagSignatureRef.
  const polityRef = useRef("");

  // Author-set flags (the scenario's flags.json), fetched once. Not in the poll:
  // it is a static asset, and getNationFlags memoizes it anyway.
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    getNationFlags()
      .then((flags) => {
        if (cancelled) return;
        setOwnerFlags((current) => ({ ...current, custom: flags || {} }));
      })
      .catch(() => { /* the badges fall back to the ISO flag, then to initials */ });
    return () => { cancelled = true; };
  }, [isOpen]);

  // 5-second poll, the cadence every other panel uses (Chat, Actions, Stats,
  // DateWidget each run their own). Only while open: a closed panel has nothing
  // to show and world.json is already being force-read twice over by the map.
  useEffect(() => {
    if (!isOpen) return undefined;

    let cancelled = false;
    const refresh = async () => {
      try {
        const [world, game] = await Promise.all([
          readWorldState({ force: true }),
          readJson(JSON_URLS.game, { defaultValue: {} }),
        ]);
        if (cancelled) return;

        const nextProjects = Array.isArray(world?.projects) ? world.projects : [];
        const signature = JSON.stringify(nextProjects) + `|${game?.gameDate}|${game?.round}`;
        if (signature !== signatureRef.current) {
          signatureRef.current = signature;
          setProjects(nextProjects);
        }
        setGameDate(String(game?.gameDate ?? ""));
        setRound(Number(game?.round) || 0);
        // Canonicalised here, not in projects.js, which is deliberately
        // import-free. game.country is written from the country picker's option
        // `code`, which on a stock scenario is a bare GADM code ("GBR"), while
        // every project's ownerCode has been through toCountryName ("United
        // Kingdom") — so comparing them raw filed the player's own programmes
        // under Foreign.
        const player = toCountryName(String(game?.country ?? ""));
        setPlayerCountry(player);
        setPlayerLandless(isPolityLandless(world, player));
        // Cheap: polityOverrides is a handful of entries and world was read above
        // anyway. Written through a signature so a poll that changed nothing does
        // not hand every card a new object and re-run its <img>.
        const polities = world?.polityOverrides ?? {};
        const polityFlagSignature = Object.entries(polities)
          .map(([code, polity]) => `${code}:${polity?.flag || ""}:${polity?.name || ""}`)
          .sort()
          .join("|");
        if (polityFlagSignature !== polityRef.current) {
          polityRef.current = polityFlagSignature;
          setOwnerFlags((current) => ({ ...current, polities }));
          setOwnerNames(Object.fromEntries(
            Object.entries(polities)
              .map(([code, polity]) => [code, String(polity?.name || "").trim()])
              .filter(([, name]) => name),
          ));
        }
        setHasLoaded(true);
      } catch {
        // A failed read leaves the last good board on screen rather than
        // blanking it — the same choice every other panel's poll makes.
        if (!cancelled) setHasLoaded(true);
      }
    };

    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isOpen]);

  // Event titles for the activity feed, fetched only once a card is actually
  // expanded. events.json is the biggest of the runtime documents and almost
  // every open of this panel never expands anything.
  //
  // Fetched on DEMAND rather than once. The guard used to be `eventTitles.size > 0`,
  // i.e. read the log once and never again — and this panel is never unmounted (the
  // hasOpened latch keeps it alive for the session), so after a few more rounds a
  // card would say "Activity (3)" and then "The events behind this are no longer in
  // the log" about three events that were very much in it.
  const expandedProject = useMemo(
    () => (expandedId ? projects.find((project) => project.id === expandedId) : null),
    [expandedId, projects],
  );
  // Ids the open card needs and the lookup does not carry. Stays true when an event
  // has genuinely aged out of the log, but the effect's deps do not change on a
  // failed lookup, so that costs one read per expand rather than a loop.
  const needsEventTitles = Boolean(
    expandedProject?.eventIds.some((id) => !eventTitles.has(id)),
  );

  useEffect(() => {
    if (!needsEventTitles) return undefined;
    let cancelled = false;
    readEventsState({ force: true })
      .then((events) => {
        if (cancelled) return;
        // Merged, not replaced: an id learned earlier must survive a read taken
        // after the log has been pruned past it.
        setEventTitles((current) => {
          const next = new Map(current);
          for (const event of events) next.set(event.id, { date: event.date, title: event.title });
          return next;
        });
      })
      .catch(() => { /* the feed just stays empty */ });
    return () => { cancelled = true; };
  }, [needsEventTitles, expandedId]);

  // Closing the panel resets the transient view state, so reopening is a clean
  // read rather than whatever was half-filtered last time. Closed is in here
  // because it is a VIEW, not a filter: coming back to the board and being shown
  // finished work is not what anyone opening it expects. Owner is in here for the
  // same reason — the board has a default and reopening should honour it, not
  // strand the player in the rival column they glanced at last time.
  useEffect(() => {
    if (isOpen) return;
    setExpandedId(null);
    setShowClosed(false);
    setOwner("mine");
  }, [isOpen]);

  const availableTags = useMemo(() => collectProjectTags(projects), [projects]);

  // Tag chips that no longer exist on the board would filter everything out with
  // no way to see why, so drop a selection once its tag is gone.
  useEffect(() => {
    setActiveTags((current) => {
      const next = current.filter((tag) => availableTags.includes(tag));
      return next.length === current.length ? current : next;
    });
  }, [availableTags]);

  // Closed is an EXCLUSIVE view, not an "also include" switch: off shows only
  // work still running, on shows only work that has finished, failed or been
  // cancelled. It used to widen the list to everything, which — because the sort
  // always ranks open work above closed — buried the two closed entries under a
  // screen of active ones and made the button look broken.
  const visible = useMemo(() => {
    const filtered = filterProjects(projects, { owner, playerCountry, query, tags: activeTags });
    const scoped = filtered.filter((project) => (showClosed ? isProjectClosed(project) : !isProjectClosed(project)));
    return sortProjects(scoped, sortKey);
  }, [projects, owner, playerCountry, query, activeTags, showClosed, sortKey]);

  const closedCount = useMemo(() => projects.filter(isProjectClosed).length, [projects]);
  const openCount = projects.length - closedCount;
  // Counts for the Mine/Foreign chips, so the default view never silently hides
  // work: a board that is all foreign opens on an empty Mine column, and the
  // number on the chip beside it is the whole explanation.
  const mineCount = useMemo(
    () => projects.filter((project) => isPlayerProject(project, playerCountry)).length,
    [projects, playerCountry],
  );
  const foreignCount = projects.length - mineCount;

  // Same trap as the Closed chip below, and the same fix: the Foreign chip is the
  // only way back out of the Foreign view, and it is only rendered while there is
  // something foreign to show. A board whose last rival programme goes away — it
  // completed, it was removed, the player's polity was renamed and its entries
  // folded back to being theirs — left the player looking at an empty column with
  // the way out gone. Drop the view with its chip.
  useEffect(() => {
    if (foreignCount === 0) setOwner((current) => (current === "foreign" ? "mine" : current));
  }, [foreignCount]);

  // The Closed chip is the only way back out of the Closed view, and it is only
  // rendered while there is something closed to show — so a board whose last
  // closed entry goes away (reopened, removed, or evicted by the board cap) left
  // the player looking at "No closed entries match those filters." with the way
  // back gone and no amount of clicking to fix it. Drop the view with its chip.
  useEffect(() => {
    if (closedCount === 0) setShowClosed(false);
  }, [closedCount]);

  const toggleTag = useCallback((tag) => {
    setActiveTags((current) => (current.includes(tag)
      ? current.filter((entry) => entry !== tag)
      : [...current, tag]));
  }, []);

  const toggleExpand = useCallback((id) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  const askAdvisor = useCallback((prompt) => {
    onOpenAdvisor?.(prompt);
  }, [onOpenAdvisor]);

  // The board's only player-authored writes. See the file header for what they
  // are allowed to touch and why they go through the ops pipeline.
  //
  // actor "player" is the door's own guard: it drops any op aimed at a project the
  // player does not own. The buttons behind these are already hidden on a foreign
  // card, so this is belt and braces — but the card renders off a 5s poll, and a
  // project that changes hands (or a player polity that gets renamed) between the
  // render and the click must not slip an Abandon through on a rival's programme.
  const writeOps = useCallback(async (ops) => {
    const world = await readWorldState({ force: true });
    const { refusedProjectIds, world: nextWorld } = applyProjectOpsToWorld({
      actor: "player",
      date: gameDate,
      ops,
      playerCountry,
      round,
      world,
    });
    // Nothing landed, so nothing is written: a refused write would still bump
    // world.json and set every other panel's poll re-rendering for no change.
    //
    // Asked of the RESULT rather than by counting refusals against ops, because a
    // batch can be part-refused — refusedProjectIds counts projects, not ops — and
    // the applied half of such a batch must still be saved. readWorldState
    // normalizes, and so does the door, so the two sides compare exactly.
    if (refusedProjectIds.length > 0
      && JSON.stringify(nextWorld.projects) === JSON.stringify(world.projects)) {
      signatureRef.current = "";
      return;
    }
    await writeWorldState(nextWorld);
    setProjects(nextWorld.projects);
    // Force the next poll to re-render from disk instead of comparing against
    // this optimistic value: a jump may have committed while the write was in
    // flight, and the poll is what repairs the difference.
    signatureRef.current = "";
  }, [gameDate, playerCountry, round]);

  const setPriority = useCallback(async (project, priority) => {
    if (project.priority === priority) return;
    setPendingId(project.id);
    try {
      await writeOps([{ op: "update", projectId: project.id, name: project.name, priority }]);
    } catch {
      // A failed write leaves the board as it was and the poll re-reads within
      // five seconds — the same silence every other handler in this file keeps.
    } finally {
      setPendingId("");
    }
  }, [writeOps]);

  // op cancel, never remove: the entry stays on the board under Closed with its
  // REAL progress figure preserved, which is the record the player wants — "we
  // got that to 40% and then stopped" — rather than the work vanishing as if it
  // had never been opened.
  const abandonProject = useCallback(async (project) => {
    setPendingId(project.id);
    try {
      await writeOps([{
        op: "cancel",
        projectId: project.id,
        name: project.name,
        note: "Abandoned by the player.",
      }]);
    } catch {
      // As above.
    } finally {
      setPendingId("");
    }
  }, [writeOps]);

  // Resolve a camera target in the order the card's button promises: an explicit
  // focus, then a linked structure, then a linked unit. Reads the live world so
  // a linked unit that has since moved flies to where it actually is.
  const showOnMap = useCallback(async (project) => {
    const map = mapRef?.current;
    if (!map?.flyTo) return;

    let target = project.focus;
    if (!target) {
      try {
        const world = await readWorldState();
        const markers = Array.isArray(world?.markers) ? world.markers : [];
        const units = Array.isArray(world?.units) ? world.units : [];
        const marker = markers.find((entry) => project.linkedMarkerIds.includes(entry.id));
        const unit = units.find((entry) => project.linkedUnitIds.includes(entry.id));
        const hit = marker || unit;
        if (hit) target = { lng: hit.lng, lat: hit.lat };
      } catch {
        // No world read, no camera move. Silent: the button simply does nothing
        // rather than throwing out of a click handler.
      }
    }
    if (!target || !Number.isFinite(target.lng) || !Number.isFinite(target.lat)) return;
    map.flyTo({ center: [target.lng, target.lat], zoom: 5 });
  }, [mapRef]);

  const isEmptyBoard = hasLoaded && projects.length === 0;
  // Warn with a little road left, not at the moment work starts disappearing.
  const nearLimit = projects.length >= PROJECT_BOARD_LIMIT - 10;

  return (
    <div
      style={{
        backdropFilter: "blur(8px)",
        backgroundColor: "rgba(17, 24, 39, 0.95)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "16px",
        bottom: isOpen ? "4.25rem" : "-30rem",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
        color: "white",
        display: "flex",
        flexDirection: "column",
        fontFamily: "sans-serif",
        // Same sizing rule as the Actions panel: use what a tall screen offers,
        // never below a usable 30rem, never into the 9rem the top HUD needs.
        height: "min(calc(100vh - 9rem), max(calc(100vh - 16rem), 30rem))",
        left: "0rem",
        maxWidth: "calc(100vw - 1rem)",
        minHeight: "10rem",
        opacity: isOpen ? 1 : 0,
        overflow: "hidden",
        pointerEvents: isOpen ? "auto" : "none",
        position: "fixed",
        transition: "bottom 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease",
        width: isMobile ? "calc(100vw - 1rem)" : "26.25rem",
        zIndex: 9998,
      }}
    >
      <div style={{
        alignItems: "center",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        display: "flex",
        justifyContent: "space-between",
        padding: "1rem 1.25rem 0.75rem",
      }}
      >
        <span style={{ fontSize: "1rem", fontWeight: 700, letterSpacing: "0.01em" }}>
          Projects &amp; Operations
          {projects.length > 0 && (
            <span data-no-translate style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.72rem", fontWeight: 500, marginLeft: "0.4rem" }}>
              {visible.length === projects.length ? projects.length : `${visible.length} / ${projects.length}`}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.55)",
            cursor: "pointer",
            display: "flex",
            padding: "0.2rem",
          }}
        >
          <CloseIcon />
        </button>
      </div>

      {!isEmptyBoard && (
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "0.6rem 1rem 0.7rem" }}>
          <div style={{ position: "relative" }}>
            <span style={{
              color: "rgba(255,255,255,0.35)",
              display: "flex",
              left: "0.55rem",
              position: "absolute",
              top: "50%",
              transform: "translateY(-50%)",
            }}
            >
              <SearchIcon />
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects…"
              data-no-translate
              style={{
                backgroundColor: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "9px",
                color: "white",
                fontFamily: "sans-serif",
                fontSize: "0.75rem",
                outline: "none",
                padding: "0.4rem 0.5rem 0.4rem 1.7rem",
                width: "100%",
              }}
            />
          </div>

          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value)}
              style={selectStyle}
              data-no-translate
            >
              {PROJECT_SORTS.map((sort) => (
                <option key={sort.key} value={sort.key} style={{ backgroundColor: "#111827" }}>
                  {sort.label}
                </option>
              ))}
            </select>
            <Chip active={owner === "all"} onClick={() => setOwner("all")} title={`Everything on the board (${projects.length})`}>
              All
            </Chip>
            <Chip active={owner === "mine"} onClick={() => setOwner("mine")} title="Your own projects and operations — the ones you can set a priority on or call off">
              Mine{mineCount > 0 ? ` (${mineCount})` : ""}
            </Chip>
            {/* Only when there is something to show. A chip reading "Foreign (0)"
                on a board with no rival programmes on it is a dead control that
                tells the player the filter is broken. */}
            {foreignCount > 0 && (
              <Chip active={owner === "foreign"} onClick={() => setOwner("foreign")} title="Other powers' efforts your services have learned of. You track these; you do not run them.">
                Foreign ({foreignCount})
              </Chip>
            )}
            {closedCount > 0 && (
              <Chip
                active={showClosed}
                onClick={() => setShowClosed((value) => !value)}
                title={showClosed
                  ? `Showing closed entries only — switch back to the ${openCount} still running`
                  : `Show the ${closedCount} completed, failed or cancelled entries instead`}
              >
                {showClosed ? `← Running (${openCount})` : `Closed (${closedCount})`}
              </Chip>
            )}
          </div>

          {availableTags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.4rem" }}>
              {availableTags.map((tag) => (
                <Chip key={tag} active={activeTags.includes(tag)} onClick={() => toggleTag(tag)}>
                  {tag}
                </Chip>
              ))}
            </div>
          )}
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
            ? `The board is full (${PROJECT_BOARD_LIMIT}). Completed and cancelled entries are dropped first to make room — ask your advisor to close anything finished.`
            : `${PROJECT_BOARD_LIMIT - projects.length} slots left before the board starts dropping its oldest closed entries.`}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem", flex: 1, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.22) transparent", padding: "0.75rem 1rem 1rem" }}>
        {!hasLoaded && (
          <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.75rem", padding: "1rem 0", textAlign: "center" }}>
            Loading…
          </div>
        )}

        {/* The empty state is the backfill path, not a dead end: an existing
            campaign has all of this in its history already, and the advisor's
            prompt carries that history, so it can reconstruct the board. */}
        {isEmptyBoard && (
          <div style={{
            border: "1px dashed rgba(255,255,255,0.15)",
            borderRadius: "12px",
            padding: "1.1rem 1rem",
            textAlign: "center",
          }}
          >
            <div style={{ fontSize: "1.5rem", marginBottom: "0.4rem" }}>🗂</div>
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.8rem", fontWeight: 600 }}>
              Nothing on the board yet
            </div>
            <p style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", lineHeight: 1.5, margin: "0.4rem 0 0.85rem" }}>
              Projects and operations are opened by your advisor and by what happens in the world —
              you don&apos;t add them by hand. If you already have efforts under way, ask your advisor
              to put them on the board.
            </p>
            <button
              type="button"
              onClick={() => askAdvisor(PROJECTS_BACKFILL_PROMPT)}
              style={{
                background: "linear-gradient(145deg, rgba(109,40,217,0.55), rgba(76,29,149,0.55))",
                border: "1px solid rgba(139,92,246,0.5)",
                borderRadius: "10px",
                color: "white",
                cursor: "pointer",
                fontFamily: "sans-serif",
                fontSize: "0.75rem",
                fontWeight: 600,
                padding: "0.45rem 0.8rem",
              }}
            >
              🧭 Ask your advisor to populate this
            </button>
          </div>
        )}

        {hasLoaded && projects.length > 0 && visible.length === 0 && (
          <div style={{
            border: "1px dashed rgba(255,255,255,0.14)",
            borderRadius: "10px",
            color: "rgba(255,255,255,0.4)",
            fontSize: "0.73rem",
            fontStyle: "italic",
            padding: "0.9rem",
            textAlign: "center",
          }}
          >
            {showClosed ? "No closed entries match those filters." : "Nothing matches those filters."}
            {/* The one case where the empty board is the DEFAULT's doing rather
                than the player's: they opened the panel, it opened on Mine, and
                every entry they have is somebody else's. Point at the chip. */}
            {!showClosed && owner === "mine" && foreignCount > 0 && (
              <div style={{ fontStyle: "normal", marginTop: "0.4rem" }}>
                {foreignCount === 1 ? "One entry belongs" : `${foreignCount} entries belong`} to another power —
                {" "}
                <button
                  type="button"
                  onClick={() => setOwner("foreign")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#c4b5fd",
                    cursor: "pointer",
                    font: "inherit",
                    padding: 0,
                    textDecoration: "underline",
                  }}
                >
                  show Foreign
                </button>.
              </div>
            )}
          </div>
        )}

        {visible.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            gameDate={gameDate}
            round={round}
            eventTitles={eventTitles}
            expanded={expandedId === project.id}
            onToggleExpand={toggleExpand}
            busy={pendingId === project.id}
            playerCountry={playerCountry}
            playerLandless={playerLandless}
            ownerFlags={ownerFlags}
            ownerNames={ownerNames}
            onAskAdvisor={askAdvisor}
            onShowOnMap={showOnMap}
            onSetPriority={setPriority}
            onAbandon={abandonProject}
          />
        ))}

        {/* Re-sync stays available once the board has content: a campaign that
            ran for a while before this existed will have gaps the advisor can
            fill, and a player who has just been told the board is stale needs a
            way to act on that. */}
        {visible.length > 0 && (
          <button
            type="button"
            onClick={() => askAdvisor(PROJECTS_BACKFILL_PROMPT)}
            style={{ ...ghostButtonStyle, marginTop: "0.2rem", padding: "0.45rem" }}
            onMouseEnter={(event) => { event.currentTarget.style.background = "rgba(139,92,246,0.2)"; }}
            onMouseLeave={(event) => { event.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
          >
            🧭 Ask the advisor to review or extend the board
          </button>
        )}
      </div>
    </div>
  );
};

// The launcher, with the same hasOpened latch the Chat and Actions buttons use so
// the panel body is never mounted until it is first opened.
// The board glyph, in the same stroke family as the other launcher icons.
const ProjectsDockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8" />
    <path d="M8 12h8" />
    <path d="M8 16h5" />
  </svg>
);

const Projects = ({ hovered, isOpen, mapRef, onOpenAdvisor, onToggle, setHovered }) => {
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (isOpen) setHasOpened(true);
  }, [isOpen]);

  return (
    <>
      {hasOpened && (
        <ProjectsPanel
          isOpen={isOpen}
          onClose={onToggle}
          onOpenAdvisor={onOpenAdvisor}
          mapRef={mapRef}
        />
      )}
      <button
        type="button"
        title="Projects & Operations"
        style={{
          alignItems: "center",
          background: isOpen
          ? "rgba(59,130,246,0.16)"
          : hovered
          ? "rgba(255,255,255,0.075)"
          : "rgba(255,255,255,0.035)",
          border: isOpen ? "1px solid rgba(96,165,250,0.34)" : "1px solid rgba(255,255,255,0.1)",
          borderRadius: "10px",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
          color: "white",
          cursor: "pointer",
          display: "flex",
          fontFamily: "inherit",
          fontSize: "1.2rem",
          height: "3.3rem",
          justifyContent: "center",
          outline: "none",
          transform: hovered ? "translateY(-1px)" : "translateY(0)",
          transition: "all 0.12s ease",
          width: "3.3rem",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onToggle}
      >
        <ProjectsDockIcon />
      </button>
    </>
  );
};

export { Projects, ProjectsPanel };
