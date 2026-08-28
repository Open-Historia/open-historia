/*! Open Historia — portions (projects & operations board panel) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The Projects & Operations board: every long-running effort the player has going
// — research and industrial programmes, construction projects, military and
// covert operations — plus whatever their services have learned of other powers'.
//
// The player cannot create or edit an entry here, deliberately. Two things write
// to the board: events, through impacts.projectOps on any jump/GM/catalyst turn,
// and the advisor, through the ```projects block in a chat reply. A board the
// player could hand-edit would be a wishlist; this one is a readout of what the
// simulation actually believes is happening.
//
// Everything date-derived (overdue, due soon, a slipped milestone, a programme
// nobody has mentioned in three rounds) is computed here from the game clock by
// runtime/projects.js, NOT read off what the model last wrote. That is what keeps
// the board honest between AI turns.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { JSON_URLS, readJson } from "../../runtime/assets.js";
import { PROJECT_BOARD_LIMIT, readEventsState, readWorldState } from "../../runtime/gameState.js";
import { toCountryName } from "../../runtime/ownerNames.js";
import {
  PROJECT_SORTS,
  collectProjectTags,
  isProjectClosed,
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

// ---- one card --------------------------------------------------------------

const ProjectCard = memo(({ project, gameDate, round, eventTitles, expanded, onToggleExpand, onAskAdvisor, onShowOnMap }) => {
  // Derived here rather than passed in: a flags object built by the parent would
  // be a new reference every render and the memo above would never hold.
  const flags = deriveProjectFlags(project, gameDate, round);
  const tone = statusTone(project.status);
  const timeline = describeTimeline(project, gameDate);
  const secrecy = SECRECY_GLYPH[project.secrecy];
  const owner = String(project.ownerCode || "").trim();

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
        </div>
        <div style={{ alignItems: "center", display: "flex", gap: "0.25rem" }}>
          {flags.ongoing && (
            <Pill color="rgba(255,255,255,0.55)" bg="rgba(255,255,255,0.08)" title="A standing effort with no planned end">
              Ongoing
            </Pill>
          )}
          <Pill color={tone.color} bg={tone.bg}>{tone.label}</Pill>
        </div>
      </div>

      {owner && (
        <div data-no-translate style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.68rem", marginTop: "0.15rem" }}>
          {owner}
        </div>
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
          {flags.stale && (
            <Pill color="rgba(255,255,255,0.55)" bg="rgba(255,255,255,0.07)" title="No progress reported for several rounds">
              No recent progress
            </Pill>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.6rem" }}>
        <button
          type="button"
          style={ghostButtonStyle}
          onClick={() => onAskAdvisor(buildBriefPrompt(project))}
          onMouseEnter={(event) => { event.currentTarget.style.background = "rgba(139,92,246,0.25)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
        >
          🧭 Ask advisor
        </button>
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

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("updated");
  const [owner, setOwner] = useState("all");
  const [activeTags, setActiveTags] = useState([]);
  const [showClosed, setShowClosed] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const isMobile = useIsMobile();
  // The signature the 5s poll compares against, so a poll that changed nothing
  // does not re-render the list under the player's cursor.
  const signatureRef = useRef("");

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
        setPlayerCountry(toCountryName(String(game?.country ?? "")));
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
  // finished work is not what anyone opening it expects.
  useEffect(() => {
    if (isOpen) return;
    setExpandedId(null);
    setShowClosed(false);
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
            <Chip active={owner === "all"} onClick={() => setOwner("all")}>All</Chip>
            <Chip active={owner === "mine"} onClick={() => setOwner("mine")}>Mine</Chip>
            <Chip active={owner === "foreign"} onClick={() => setOwner("foreign")}>Foreign</Chip>
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

      <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem", flex: 1, overflowY: "auto", padding: "0.75rem 1rem 1rem" }}>
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
            onAskAdvisor={askAdvisor}
            onShowOnMap={showOnMap}
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
            ? "linear-gradient(145deg, rgba(109,40,217,0.4), rgba(76,29,149,0.4))"
            : hovered
              ? "linear-gradient(145deg, rgba(40,55,80,0.95), rgba(20,30,50,0.95))"
              : "linear-gradient(145deg, rgba(30,42,65,0.95), rgba(15,22,40,0.95))",
          border: hovered
            ? "1px solid rgba(255,255,255,0.2)"
            : isOpen
              ? "1px solid rgba(139,92,246,0.5)"
              : "1px solid rgba(255,255,255,0.1)",
          borderRadius: "10px",
          boxShadow: hovered
            ? "inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.4)"
            : "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.3), 0 2px 6px rgba(0,0,0,0.35)",
          color: "white",
          cursor: "pointer",
          display: "flex",
          fontFamily: "sans-serif",
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
        🎯
      </button>
    </>
  );
};

export { Projects, ProjectsPanel };
