/*! Open Historia — suggesting changes to a community scenario, and reviewing them © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Everything a player sees of suggestions outside the map editor:
//  - ScenarioCommunityCard, at the top of a scenario's editor: where it came
//    from on the community hub (with Suggest changes and Unlink), and the post
//    its player made of it (with the suggestions left there, and Unlink). The
//    game makes those links itself, on a download and on Publish; the card can
//    only remove one, for good.
//  - SuggestChangesDialog: the changes a player made to a downloaded scenario,
//    saved as a small file and posted as a comment on the original post.
//  - SuggestionReviewDialog: the author's changelog of a suggestion's changes
//    outside the map, each accepted (applied at once) or rejected, like tracked
//    changes in a document; the map's changes open in the Workshop.
//  - SuggestionsBanner / SuggestionCountBadge: the library telling an author
//    that somebody suggested changes to their scenario.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { APP_HEIGHT, SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP, useTouchPrimary } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useBackToClose } from "../../runtime/backToClose.js";
import {
  clearScenarioAsset,
  exportScenarioBundle,
  loadScenarioDetails,
  saveScenario,
  uploadScenarioAsset,
  withSingleLibraryRefresh,
} from "../../runtime/library.js";
import { saveBlobToDisk } from "../../runtime/saveFile.js";
import { copyToClipboard } from "../../runtime/clipboard.js";
import { acceptFor } from "../../runtime/fileAccept.js";
import { fetchHubIndex, hubIndexProblem } from "../../runtime/hubFiles.js";
import { downloadHubBundle, downloadHubFile, fetchHubPosts, hubOriginalGone, hubPostUrl } from "../../runtime/hubPosts.js";
import { buildScenarioSnapshot, changedPathsOf, countChanges, diffScenarioBundles } from "../../runtime/scenarioChanges.js";
import {
  buildSuggestion,
  buildSuggestionComment,
  buildSuggestionZip,
  readSuggestionFile,
  suggestionFileName,
} from "../../runtime/scenarioSuggestion.js";
import { applyToSnapshot, buildDetailSave, detailChangeStatus, detailStatuses, detailValueIn, diffWords, inverseOf } from "../../runtime/suggestionApply.js";
import { openHubSuggestions } from "../../../server/hubProvenance.js";
import { FEATURE_DEFINITIONS } from "../../../server/gameFeatures.js";
import { PROMPT_EDITOR_SECTIONS } from "../AI/gameplayPrompts.js";
import { guidanceSegmentsFor } from "../AI/promptGuidance.js";
import { REVIEW_SECTIONS, sectionOfChange } from "../../runtime/suggestionSections.js";

// ---- looks (the library's own) -------------------------------------------------

const cardStyle = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  marginBottom: "0.95rem",
  padding: "0.9rem",
};
const buttonStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "999px",
  color: "rgba(246,246,248,0.92)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.8rem",
  fontWeight: 600,
  gap: "0.4rem",
  justifyContent: "center",
  minHeight: "2.1rem",
  padding: "0 0.9rem",
};
const primaryButtonStyle = { ...buttonStyle, background: "rgba(43,193,243,0.22)", borderColor: "rgba(43,193,243,0.5)", color: "#fff" };
const quietTextStyle = { color: "rgba(255,255,255,0.58)", fontSize: "0.78rem", lineHeight: 1.5 };
const labelStyle = {
  color: "rgba(255,255,255,0.72)",
  display: "block",
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.05em",
  marginBottom: "0.4rem",
  textTransform: "uppercase",
};
const inputStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  boxSizing: "border-box",
  color: "#f8fafc",
  fontFamily: "inherit",
  fontSize: "0.88rem",
  outline: "none",
  padding: "0.7rem 0.8rem",
  width: "100%",
};
const tapFit = (style, touch) => (touch ? { ...style, minHeight: undefined } : style);

const STATUS_COLORS = {
  conflict: { background: "rgba(245,158,11,0.14)", border: "rgba(245,158,11,0.45)", color: "#fbbf24" },
  applied: { background: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.4)", color: "#86efac" },
  missing: { background: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.4)", color: "#cbd5e1" },
};
const Badge = ({ kind, children, title }) => {
  const colors = STATUS_COLORS[kind] ?? STATUS_COLORS.missing;
  return (
    <span
      title={title}
      style={{ background: colors.background, border: `1px solid ${colors.border}`, borderRadius: 999, color: colors.color, fontSize: "0.68rem", fontWeight: 700, padding: "0.15rem 0.5rem", whiteSpace: "nowrap" }}
    >
      {children}
    </span>
  );
};

// ---- the changes, in words ------------------------------------------------------

const DETAIL_FIELD_LABELS = {
  "meta.name": "Name",
  "meta.eyebrow": "Eyebrow",
  "meta.accentColor": "Accent",
  "meta.subtitle": "Subtitle",
  "meta.description": "Description",
  "meta.heroTitle": "Hero Title",
  "meta.heroSubtitle": "Hero Subtitle",
  "game.country": "Player Country",
  "game.startDate": "Start Date",
  "game.gameDate": "Game Date",
  "game.difficulty": "Difficulty",
  "game.language": "Language",
  "world.allowedUnitTypes": "Deployable Troop Types",
  "world.labelFont": "Country Label Font",
  "world.labelTextColor": "Label Letter Color",
  "world.labelHaloColor": "Label Border Color",
  "world.simulationRules": "Simulation Rules",
  "world.startingTimelineText": "World Before Round One",
};
const POLITICS_FIELD_LABELS = {
  politicalActors: "Political actors",
  institutions: "Institutions",
  powerStatus: "Power status",
  agreements: "Agreements",
  canonContext: "Canon context",
};

const promptLabelOf = (path) => {
  const [first, second, third] = path;
  const sectionKey = first === "tasks" ? second : first;
  const segmentId = first === "tasks" ? third : second;
  const section = PROMPT_EDITOR_SECTIONS.find((entry) => entry.key === sectionKey);
  const segment = guidanceSegmentsFor(sectionKey).find((entry) => entry.id === segmentId);
  return { section: section?.label || sectionKey, segment: segment?.label || segmentId };
};

// Where in the editor a details change lives, and what it is called there.
const describeDetailChange = (change) => {
  if (change.kind === "field") {
    const [area, ...rest] = change.path;
    if (area === "features") {
      const definition = FEATURE_DEFINITIONS.find((entry) => entry.key === rest[0]);
      const setting = definition?.settings.find((entry) => entry.key === rest[1]);
      return { tab: "Features", title: definition?.label || rest[0], detail: rest[1] === "enabled" ? "On or off" : setting?.label || rest[1] };
    }
    if (area === "prompts") {
      const { section, segment } = promptLabelOf(rest);
      return { tab: "Prompts", title: section, detail: segment };
    }
    const key = `${area}.${rest[0]}`;
    return { tab: area === "meta" ? "Overview" : "World", title: DETAIL_FIELD_LABELS[key] || rest[0], detail: "" };
  }
  if (change.kind === "politics") return { tab: "Politics", title: POLITICS_FIELD_LABELS[change.field] || change.field, detail: change.label || "" };
  if (change.kind === "history") {
    return change.part === "setup"
      ? { tab: "Pre-history", title: "Summary and Day-one facts", detail: "" }
      : { tab: "Pre-history", title: "Pre-history event", detail: change.label || "" };
  }
  if (change.kind === "stats") return { tab: "Stats", title: "National Stats sheet", detail: "" };
  if (change.kind === "institutionLogos") return { tab: "Politics", title: "Institution logos", detail: "" };
  if (change.kind === "cover") return { tab: "Assets", title: "Cover Image", detail: "" };
  return { tab: "", title: change.kind, detail: "" };
};

const TrackedText = ({ before, after }) => {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  return (
    <div data-no-translate style={{ background: "rgba(0,0,0,0.22)", borderRadius: 10, fontSize: "0.8rem", lineHeight: 1.55, maxHeight: "12rem", overflow: "auto", padding: "0.55rem 0.65rem", whiteSpace: "pre-wrap" }}>
      {parts.map((part, index) => (
        <span
          key={index}
          style={part.type === "add"
            ? { background: "rgba(34,197,94,0.18)", color: "#bbf7d0", textDecoration: "underline" }
            : part.type === "del"
              ? { background: "rgba(248,113,113,0.16)", color: "#fecaca", textDecoration: "line-through" }
              : { color: "rgba(255,255,255,0.78)" }}
        >
          {part.text}
        </span>
      ))}
    </div>
  );
};

const valueText = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "object") return `${Object.keys(value).length}`;
  return String(value);
};

// A value inside a Politics entry, short: the entry's own data, never
// translated. Records and lists of records as compact JSON, cut.
const POLITICS_VALUE_CHARS = 90;
const politicsValueText = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  const text = Array.isArray(value) && value.every((item) => item === null || typeof item !== "object")
    ? value.join(", ")
    : typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > POLITICS_VALUE_CHARS ? `${text.slice(0, POLITICS_VALUE_CHARS).trimEnd()}…` : text || "—";
};
const POLITICS_PATHS_SHOWN = 5;

const statsSummary = (sheet) => {
  const sections = Array.isArray(sheet?.sections) ? sheet.sections : [];
  const stats = sections.reduce((total, section) => total + (Array.isArray(section?.stats) ? section.stats.length : 0), 0);
  return sheet ? `${sections.length} sections, ${stats} stats` : "The standard sheet";
};

const DetailValue = ({ change, coverBefore }) => {
  if (change.kind === "field" && (change.text || typeof change.to === "string" && String(change.to).length > 60)) {
    return <TrackedText before={change.from ?? ""} after={change.to ?? ""} />;
  }
  if (change.kind === "cover") {
    const src = change.to?.base64 ? `data:${change.to.contentType || "image/jpeg"};base64,${change.to.base64}` : null;
    return (
      <div style={{ alignItems: "center", display: "flex", gap: "0.6rem" }}>
        {coverBefore ? <img alt="" src={coverBefore} style={{ borderRadius: 8, height: "3.4rem", objectFit: "cover", opacity: 0.6, width: "6rem" }} /> : <span style={quietTextStyle}>No cover</span>}
        <span style={quietTextStyle}>→</span>
        {src ? <img alt="" src={src} style={{ borderRadius: 8, height: "3.4rem", objectFit: "cover", width: "6rem" }} /> : <span style={quietTextStyle}>No cover</span>}
      </div>
    );
  }
  if (change.kind === "stats") {
    return <div style={quietTextStyle}>{statsSummary(change.from)} → {statsSummary(change.to)}</div>;
  }
  if (change.kind === "politics" || change.kind === "history") {
    const text = change.op === "add" ? "Added" : change.op === "remove" ? "Removed" : "Changed";
    // Which fields of the entry changed, the way tracked changes show a word;
    // for a value changed whole (the canon context), its fields, a new one's
    // measured from nothing.
    const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
    const whole = !change.op && (record(change.from) || record(change.to));
    const paths = change.op === "change" || whole
      ? changedPathsOf(whole ? change.from ?? {} : change.from, whole ? change.to ?? {} : change.to, { max: POLITICS_PATHS_SHOWN })
      : [];
    return (
      <div style={{ display: "grid", gap: "0.2rem" }}>
        <div style={quietTextStyle}>{text}</div>
        {paths.slice(0, POLITICS_PATHS_SHOWN).map((entry) => (
          <div data-no-translate key={entry.path} style={{ fontSize: "0.76rem", lineHeight: 1.45, overflowWrap: "anywhere" }}>
            <span style={{ color: "rgba(255,255,255,0.55)" }}>{entry.path}: </span>
            <span style={{ color: "#fecaca", textDecoration: "line-through" }}>{politicsValueText(entry.from)}</span>
            <span style={{ color: "rgba(255,255,255,0.5)" }}> → </span>
            <span style={{ color: "#bbf7d0" }}>{politicsValueText(entry.to)}</span>
          </div>
        ))}
        {paths.length > POLITICS_PATHS_SHOWN ? <div data-no-translate style={quietTextStyle}>…</div> : null}
      </div>
    );
  }
  if (change.kind === "institutionLogos") return <div style={quietTextStyle}>Changed</div>;
  const color = /^#[0-9a-f]{6}$/i;
  return (
    <div data-no-translate style={{ alignItems: "center", display: "flex", flexWrap: "wrap", fontSize: "0.8rem", gap: "0.45rem" }}>
      {color.test(String(change.from ?? "")) && <span style={{ background: change.from, borderRadius: 4, display: "inline-block", height: 14, width: 14 }} />}
      <span style={{ color: "#fecaca", textDecoration: "line-through" }}>{valueText(change.from)}</span>
      <span style={{ color: "rgba(255,255,255,0.5)" }}>→</span>
      {color.test(String(change.to ?? "")) && <span style={{ background: change.to, borderRadius: 4, display: "inline-block", height: 14, width: 14 }} />}
      <span style={{ color: "#bbf7d0" }}>{valueText(change.to)}</span>
    </div>
  );
};

const DetailChangeRow = ({ change, status, decision, canUndo = true, busy, readOnly, onAccept, onReject, onUndo, coverBefore, touch }) => {
  const label = describeDetailChange(change);
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, display: "grid", gap: "0.45rem", padding: "0.65rem 0.75rem" }}>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
        <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label.tab}</span>
        <span style={{ fontSize: "0.86rem", fontWeight: 700 }}>{label.title}</span>
        {label.detail ? <span style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem" }}>{label.detail}</span> : null}
        <span style={{ flex: 1 }} />
        {!readOnly && status === "conflict" && !decision && (
          <Badge kind="conflict" title="You changed this after you posted the scenario. Accepting replaces your version.">You changed this too</Badge>
        )}
        {!readOnly && status === "applied" && !decision && <Badge kind="applied">Already in your scenario</Badge>}
      </div>
      <DetailValue change={change} coverBefore={coverBefore} />
      {!readOnly && (
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
          {decision ? (
            <>
              <span style={{ color: decision === "accepted" ? "#86efac" : "rgba(255,255,255,0.55)", fontSize: "0.78rem", fontWeight: 700 }}>
                {decision === "accepted" ? "Accepted" : "Rejected"}
              </span>
              {canUndo
                ? <button type="button" className="oh-tap-row" disabled={busy} onClick={onUndo} style={tapFit(buttonStyle, touch)}>Undo</button>
                : <span style={quietTextStyle}>It can no longer be undone here: the game was closed after it was accepted. Change it back in the editor.</span>}
            </>
          ) : (
            <>
              <button type="button" className="oh-tap-row" disabled={busy || status === "applied"} onClick={onAccept} style={tapFit(primaryButtonStyle, touch)}>Accept</button>
              <button type="button" className="oh-tap-row" disabled={busy} onClick={onReject} style={tapFit(buttonStyle, touch)}>Reject</button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// The map's changes counted the way the Workshop's review panel lists them.
const MAP_SECTION_LABELS = {
  countries: "Countries",
  ownership: "Who owns which region",
  borders: "Borders",
  regions: "Region names and types",
  claims: "Claims",
  groups: "Groups",
  cities: "Cities",
  units: "Units",
  features: "Map features",
  puppets: "Puppet states",
  basemaps: "Basemaps",
  detailedMap: "Detailed map",
  settings: "Map settings",
};
const MapChangeSummary = ({ changes, decided = null }) => {
  const counts = new Map();
  for (const change of changes) {
    const section = sectionOfChange(change);
    const entry = counts.get(section) ?? { total: 0, decided: 0 };
    entry.total += 1;
    if (decided?.has(change.id)) entry.decided += 1;
    counts.set(section, entry);
  }
  return (
    <div style={{ display: "grid", gap: "0.3rem" }}>
      {REVIEW_SECTIONS.filter((section) => counts.has(section.id)).map((section) => {
        const entry = counts.get(section.id);
        return (
          <div key={section.id} style={{ display: "flex", fontSize: "0.82rem", gap: "0.5rem", justifyContent: "space-between" }}>
            <span>{MAP_SECTION_LABELS[section.id]}</span>
            <span style={{ color: "rgba(255,255,255,0.6)" }}>
              {decided ? `${entry.decided} of ${entry.total} decided` : entry.total === 1 ? "1 change" : `${entry.total} changes`}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ---- the frame both dialogs sit in ---------------------------------------------

const DialogFrame = ({ title, subtitle, onClose, children, footer }) => {
  const isMobile = useIsMobile();
  useBackToClose(true, onClose);
  return (
    <div
      onClick={onClose}
      style={{ alignItems: isMobile ? "flex-start" : "center", background: "rgba(0,0,0,0.55)", display: "flex", inset: 0, justifyContent: "center", padding: `${SAFE_TOP} ${SAFE_RIGHT} ${SAFE_BOTTOM} ${SAFE_LEFT}`, position: "fixed", zIndex: 10070 }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          background: "#1b1b1e",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: isMobile ? 0 : 22,
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          maxHeight: isMobile ? APP_HEIGHT : `calc(${APP_HEIGHT} - 3rem)`,
          width: isMobile ? "100%" : "min(46rem, calc(100vw - 2rem))",
        }}
      >
        <div style={{ alignItems: "flex-start", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: "0.8rem", padding: "1rem 1.1rem 0.85rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 800, letterSpacing: "-0.02em" }}>{title}</div>
            {subtitle ? <div style={{ ...quietTextStyle, marginTop: "0.2rem" }}>{subtitle}</div> : null}
          </div>
          <button type="button" aria-label="Close" className="oh-tap" onClick={onClose} style={{ ...buttonStyle, minWidth: "2.2rem", padding: 0 }}>✕</button>
        </div>
        <div style={{ display: "grid", gap: "0.8rem", overflowY: "auto", padding: "1rem 1.1rem" }}>{children}</div>
        {footer ? <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: "0.8rem 1.1rem" }}>{footer}</div> : null}
      </div>
    </div>
  );
};

const postTitleOf = (origin) => origin?.title || `#${origin?.postId}`;

// ---- Suggest changes (the player who downloaded the scenario) -------------------

// A suggestion is the copy measured against the file it came from, so that
// file has to be had again: its checked copy in the hub's releases. When the
// hub no longer offers it (the copy has an old link, or the post has moved on
// to a newer file) there is nothing to measure against, and the dialog says
// so in words rather than with a failed download: the copy has to take the
// post's file first. `onUpdate(post)` does that, for the post found on the hub.
export const SuggestChangesDialog = ({ scenario, onClose, onUpdate = null }) => {
  const touch = useTouchPrimary();
  const origin = scenario?.hubOrigin;
  const [phase, setPhase] = useState("loading"); // loading | ready | empty | outdated | error | sent
  const [error, setError] = useState("");
  const [changes, setChanges] = useState([]);
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(null); // { fileName, comment, copied }
  // The copy's post as the hub lists it now, when the file the copy came from
  // is gone (phase "outdated"); null when the hub no longer offers the post.
  const [hubPost, setHubPost] = useState(null);
  const { bundleUrl, postId, release } = origin ?? {};

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const hubIndex = await fetchHubIndex();
        const problem = hubIndexProblem(hubIndex);
        if (problem) throw new Error(problem);
        if (hubOriginalGone({ bundleUrl, release }, hubIndex)) {
          const posts = await fetchHubPosts();
          if (!alive) return;
          setHubPost(posts.find((post) => Number(post.id) === Number(postId)) ?? null);
          setPhase("outdated");
          return;
        }
        const [base, current] = await Promise.all([downloadHubBundle(bundleUrl), exportScenarioBundle(scenario.id)]);
        const found = diffScenarioBundles(base, current);
        if (!alive) return;
        setChanges(found);
        setPhase(found.length ? "ready" : "empty");
      } catch (nextError) {
        if (!alive) return;
        setError(nextError?.message || String(nextError));
        setPhase("error");
      }
    })();
    return () => { alive = false; };
  }, [bundleUrl, postId, release, scenario?.id]);

  const counts = useMemo(() => countChanges(changes), [changes]);
  const detailChanges = changes.filter((change) => change.area === "details");
  const mapChanges = changes.filter((change) => change.area === "map");
  const postUrl = hubPostUrl(origin?.postId);
  // The file the copy came from is gone, and its post is still on the hub.
  const canUpdate = phase === "outdated" && Boolean(hubPost && onUpdate);

  const send = async ({ openPost }) => {
    try {
      const suggestion = buildSuggestion({ changes, scenario, origin, by, note });
      const fileName = suggestionFileName(scenario.name);
      const comment = buildSuggestionComment(suggestion, { fileName });
      // The page first, while the click still counts as the player's: a browser
      // only lets a click open a window for a moment.
      if (openPost) window.open(`${postUrl}#new_comment_field`, "_blank", "noopener");
      const copied = await copyToClipboard(comment);
      await saveBlobToDisk(await buildSuggestionZip(suggestion), fileName);
      setSent({ fileName, comment, copied, openedPost: openPost });
      setPhase("sent");
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
      setPhase("error");
    }
  };

  const footer = phase === "ready" ? (
    <>
      <button type="button" className="oh-tap-row" onClick={() => send({ openPost: true })} style={tapFit(primaryButtonStyle, touch)}>Save the file and open the post</button>
      <button type="button" className="oh-tap-row" onClick={() => send({ openPost: false })} style={tapFit(buttonStyle, touch)}>Only save the file</button>
      <span style={{ flex: 1 }} />
      <button type="button" className="oh-tap-row" onClick={onClose} style={tapFit(buttonStyle, touch)}>Cancel</button>
    </>
  ) : (
    <>
      {/* The post's checked file can still be had: the Update the dialog asks
          for, here. One of a copy the player has edited asks first, since it
          replaces their changes (libraryBar.jsx handleScenarioUpdate). */}
      {canUpdate && (
        <button type="button" className="oh-tap-row" onClick={() => onUpdate(hubPost)} style={tapFit(primaryButtonStyle, touch)}>Update</button>
      )}
      <button type="button" className="oh-tap-row" onClick={onClose} style={tapFit(buttonStyle, touch)}>{phase === "sent" ? "Done" : "Close"}</button>
    </>
  );

  return (
    <DialogFrame
      title="Suggest changes"
      subtitle={origin ? `To “${postTitleOf(origin)}”${origin.author ? ` by ${origin.author}` : ""}, on the community hub` : ""}
      onClose={onClose}
      footer={footer}
    >
      {phase === "loading" && <div style={quietTextStyle}>Comparing your copy with the original on the hub…</div>}
      {phase === "error" && (
        <div style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.34)", borderRadius: 14, color: "#fecaca", padding: "0.7rem 0.8rem" }}>
          {error}
        </div>
      )}
      {phase === "empty" && (
        <div style={quietTextStyle}>Your copy is the same as the post. Change something first — in this editor or on the map — and save it, then suggest it.</div>
      )}
      {phase === "outdated" && (
        <div style={{ ...quietTextStyle, color: "#fde68a" }}>
          {canUpdate
            ? "The file this copy came from is not one the community hub offers any more, so your changes cannot be compared with it. Update the scenario first, then make your changes and suggest them."
            : "The community hub no longer offers this scenario, so changes to it cannot be suggested."}
        </div>
      )}
      {phase === "ready" && (
        <>
          <div style={quietTextStyle}>
            This saves a small file with only your changes, not the whole scenario, and opens the scenario's post on GitHub. Comment there with the file attached: the author's game shows them your suggestion, and they accept or reject each change.
          </div>
          <div style={{ fontSize: "0.86rem", fontWeight: 700 }}>
            {counts.details + counts.map === 1 ? "1 change" : `${counts.details + counts.map} changes`}
          </div>
          {detailChanges.length > 0 && (
            <div style={{ display: "grid", gap: "0.45rem" }}>
              <span style={labelStyle}>Outside the map</span>
              {detailChanges.map((change) => <DetailChangeRow key={change.id} change={change} readOnly touch={touch} />)}
            </div>
          )}
          {mapChanges.length > 0 && (
            <div style={{ ...cardStyle, marginBottom: 0 }}>
              <span style={labelStyle}>On the map</span>
              <MapChangeSummary changes={mapChanges} />
            </div>
          )}
          <div>
            <label style={labelStyle}>Your name (optional)</label>
            <input style={inputStyle} value={by} onChange={(event) => setBy(event.target.value)} maxLength={80} />
          </div>
          <div>
            <label style={labelStyle}>A note for the author (optional)</label>
            <textarea
              style={{ ...inputStyle, minHeight: "5rem", resize: "vertical" }}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1500}
              placeholder="What did you change, and why?"
            />
          </div>
        </>
      )}
      {phase === "sent" && sent && (
        <>
          <ol style={{ ...quietTextStyle, color: "rgba(255,255,255,0.82)", display: "grid", gap: "0.35rem", margin: 0, paddingLeft: "1.2rem" }}>
            <li>{`The file ${sent.fileName} was saved.`}</li>
            <li>
              {sent.openedPost
                ? "On the post that opened, click in the comment box at the bottom."
                : "Open the scenario's post and click in the comment box at the bottom."}
            </li>
            <li>{sent.copied ? "Paste the comment below: it is already copied." : "Copy the comment below and paste it there."}</li>
            <li>{`Drag ${sent.fileName} into the comment, then click Comment.`}</li>
          </ol>
          <textarea readOnly data-no-translate style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.76rem", minHeight: "9rem" }} value={sent.comment} onFocus={(event) => event.target.select()} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            <button type="button" className="oh-tap-row" onClick={async () => setSent({ ...sent, copied: await copyToClipboard(sent.comment) })} style={tapFit(buttonStyle, touch)}>Copy the comment</button>
            <a href={`${postUrl}#new_comment_field`} target="_blank" rel="noopener noreferrer" className="oh-tap-row" style={{ ...tapFit(buttonStyle, touch), textDecoration: "none" }}>Open the post ↗</a>
          </div>
        </>
      )}
    </DialogFrame>
  );
};

// ---- the author's review --------------------------------------------------------

// The review record's key: the comment for a suggestion found on the hub, the
// file's own id for one opened from a file.
const suggestionReviewKey = (source) => source?.ref?.id || source?.suggestion?.id || "";

const decisionsOf = (review) => ({
  accepted: new Set(review?.accepted ?? []),
  rejected: new Set(review?.rejected ?? []),
});

// What Undo puts back, per review: change id -> inverse change. Kept outside
// the dialog, so closing it, or going to the Workshop and back, keeps it;
// kept until the game closes, after which an accepted change has no Undo.
const undoStore = new Map();
const undoesOf = (scenarioId, key) => {
  const id = `${scenarioId}\n${key}`;
  if (!undoStore.has(id)) undoStore.set(id, new Map());
  return undoStore.get(id);
};

export const SuggestionReviewDialog = ({ scenario, source, onClose, onReviewMap, onChanged, onLoaded, onRejectContributor }) => {
  const touch = useTouchPrimary();
  const key = suggestionReviewKey(source);
  const [phase, setPhase] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");
  const [suggestion, setSuggestion] = useState(source?.suggestion ?? null);
  const [statuses, setStatuses] = useState({});
  const [decisions, setDecisions] = useState(() => decisionsOf(scenario?.hubReviews?.[key]));
  const [status, setStatus] = useState(scenario?.hubReviews?.[key]?.status || "reviewing");
  const [busy, setBusy] = useState(false);
  const snapshotRef = useRef(null);
  const coverRef = useRef(null); // the author's cover before any accept: { base64, contentType } | null
  const undoes = useMemo(() => undoesOf(scenario?.id, key), [scenario?.id, key]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const next = source?.suggestion ?? await readSuggestionFile(await downloadHubFile(source.ref.zipUrl, { copy: false }));
        // Kept by the caller, so coming back from the Workshop does not
        // download the file again.
        if (!source?.suggestion) onLoaded?.(next);
        const current = await exportScenarioBundle(scenario.id);
        const snapshot = buildScenarioSnapshot(current);
        if (!alive) return;
        snapshotRef.current = snapshot;
        coverRef.current = snapshot.cover ? { base64: snapshot.cover.base64, contentType: snapshot.cover.contentType, hash: snapshot.cover.hash } : null;
        setSuggestion(next);
        setStatuses(detailStatuses(next.changes, snapshot));
        setPhase("ready");
      } catch (nextError) {
        if (!alive) return;
        setError(nextError?.message || String(nextError));
        setPhase("error");
      }
    })();
    return () => { alive = false; };
    // Loaded once per suggestion: the source and onLoaded change identity on
    // every parent render, and a new download each time would cost a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario?.id, key]);

  const changes = suggestion?.changes ?? [];
  const detailChanges = changes.filter((change) => change.area === "details");
  const mapChanges = changes.filter((change) => change.area === "map");
  const decided = new Set([...decisions.accepted, ...decisions.rejected]);
  const settledCount = changes.filter((change) => decided.has(change.id)).length;

  const persist = async (nextDecisions, nextStatus = status) => {
    const reviews = { ...(scenario?.hubReviews ?? {}) };
    reviews[key] = {
      status: nextStatus,
      accepted: [...nextDecisions.accepted],
      rejected: [...nextDecisions.rejected],
      updatedAt: new Date().toISOString(),
    };
    const saved = await saveScenario(scenario.id, { hubReviews: reviews });
    onChanged?.(saved?.scenario ?? null);
  };
  // A decision shows once it is saved: a save that fails leaves the rows
  // as they were, and the error says why.
  const decide = async (nextDecisions, nextStatus) => {
    await persist(nextDecisions, nextStatus ?? status);
    setDecisions(nextDecisions);
    if (nextStatus) setStatus(nextStatus);
  };
  const errorText = (nextError) => nextError?.message || String(nextError);
  // Reject, Mark as reviewed and Dismiss only record decisions.
  const record = async (nextDecisions, nextStatus) => {
    setBusy(true);
    setError("");
    try {
      await decide(nextDecisions, nextStatus);
      return true;
    } catch (nextError) {
      setError(errorText(nextError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Accepting applies the change at once, like accepting a tracked change;
  // Undo puts back what was there.
  const applyChanges = async (list) => {
    if (!list.length) return;
    const details = await loadScenarioDetails(scenario.id);
    const { patch, uploads, clears } = buildDetailSave(list, details);
    // One catalog refresh for the whole batch, not one per write.
    await withSingleLibraryRefresh(async () => {
      if (Object.keys(patch).length) await saveScenario(scenario.id, patch, { refresh: false });
      for (const upload of uploads) {
        const blob = upload.json !== undefined
          ? new Blob([JSON.stringify(upload.json)], { type: "application/json" })
          : new Blob([Uint8Array.from(globalThis.atob(upload.base64), (char) => char.charCodeAt(0))], { type: upload.contentType });
        await uploadScenarioAsset(scenario.id, upload.key, blob, { refresh: false });
      }
      for (const assetKey of clears) await clearScenarioAsset(scenario.id, assetKey, { refresh: false });
    });
  };

  const accept = async (list) => {
    const pending = list.filter((change) => !decided.has(change.id) && statuses[change.id] !== "applied");
    if (!pending.length) return;
    setBusy(true);
    setError("");
    try {
      for (const change of pending) {
        const before = change.kind === "cover" ? coverRef.current : detailValueIn(snapshotRef.current, change);
        undoes.set(change.id, change.kind === "cover"
          ? inverseOf(change, before ? { hash: before.hash, contentType: before.contentType, base64: before.base64 } : null)
          : inverseOf(change, before));
      }
      await applyChanges(pending);
      for (const change of pending) applyToSnapshot(snapshotRef.current, change);
      setStatuses((current) => ({ ...current, ...Object.fromEntries(pending.map((change) => [change.id, "applied"])) }));
      // Applied already: a review that fails to save cannot take it back.
      await decide({ accepted: new Set([...decisions.accepted, ...pending.map((change) => change.id)]), rejected: decisions.rejected })
        .catch((nextError) => { throw new Error(`Your scenario was changed, but the decision could not be saved: ${errorText(nextError)}`); });
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      setBusy(false);
    }
  };
  const reject = async (list) => {
    const pending = list.filter((change) => !decided.has(change.id));
    if (!pending.length) return;
    await record({ accepted: decisions.accepted, rejected: new Set([...decisions.rejected, ...pending.map((change) => change.id)]) });
  };
  // Only an acceptance whose replaced value is still kept (undoesOf, until the
  // game closes) can be taken back. Clearing the decision of an earlier one
  // would leave the change in, marked undecided.
  const canUndo = (change) => !decisions.accepted.has(change.id) || undoes.has(change.id);
  const undo = async (change) => {
    if (!canUndo(change)) return;
    setBusy(true);
    setError("");
    try {
      // An accepted change is undone only by putting back what was there; one
      // accepted before the game was last closed has nothing to put back,
      // and its row offers no Undo.
      const inverse = decisions.accepted.has(change.id) ? undoes.get(change.id) : null;
      if (decisions.accepted.has(change.id) && !inverse) return;
      if (inverse) {
        await applyChanges([inverse]);
        applyToSnapshot(snapshotRef.current, inverse);
      }
      const accepted = new Set(decisions.accepted);
      const rejected = new Set(decisions.rejected);
      accepted.delete(change.id);
      rejected.delete(change.id);
      setStatuses((current) => ({ ...current, [change.id]: detailChangeStatus(change, snapshotRef.current) }));
      await decide({ accepted, rejected }, "reviewing")
        .catch((nextError) => { throw new Error(inverse ? `Your scenario was changed back, but the decision could not be saved: ${errorText(nextError)}` : errorText(nextError)); });
      undoes.delete(change.id);
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      setBusy(false);
    }
  };

  const author = source?.ref?.author ? `@${source.ref.author}` : suggestion?.by || "";
  const when = source?.ref?.createdAt || suggestion?.createdAt || "";
  const note = suggestion?.note || source?.ref?.note || "";
  const coverBefore = coverRef.current ? `data:${coverRef.current.contentType || "image/jpeg"};base64,${coverRef.current.base64}` : null;
  const pendingDetails = detailChanges.filter((change) => !decided.has(change.id) && statuses[change.id] !== "applied");

  const footer = (
    <>
      <span style={{ ...quietTextStyle, alignSelf: "center" }}>
        {changes.length ? `${settledCount} of ${changes.length} changes decided` : ""}
      </span>
      <span style={{ flex: 1 }} />
      {phase === "ready" && status !== "done" && (
        <button type="button" className="oh-tap-row" disabled={busy} onClick={() => record(decisions, "done")} style={tapFit(buttonStyle, touch)}>Mark as reviewed</button>
      )}
      {/* Someone flooding the post with bad edits: everything they suggested
          goes, on every post of this player's, and what they suggest later is hidden. */}
      {source?.ref?.author && onRejectContributor && (
        <button type="button" className="oh-tap-row" disabled={busy} onClick={() => onRejectContributor(source.ref.author)} style={tapFit(buttonStyle, touch)}>
          {`Reject all from @${source.ref.author}`}
        </button>
      )}
      {/* A suggestion that cannot be read can still be put away. */}
      {phase !== "loading" && status !== "dismissed" && (
        <button type="button" className="oh-tap-row" disabled={busy} onClick={async () => { if (await record(decisions, "dismissed")) onClose(); }} style={tapFit(buttonStyle, touch)}>Dismiss</button>
      )}
      <button type="button" className="oh-tap-row" onClick={onClose} style={tapFit(primaryButtonStyle, touch)}>Done</button>
    </>
  );

  return (
    <DialogFrame
      title="Suggested changes"
      subtitle={[author && `Suggested by ${author}`, when && new Date(when).toLocaleDateString()].filter(Boolean).join(" · ")}
      onClose={onClose}
      footer={footer}
    >
      {phase === "loading" && <div style={quietTextStyle}>Opening the suggestion…</div>}
      {error && (
        <div style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.34)", borderRadius: 14, color: "#fecaca", padding: "0.7rem 0.8rem" }}>
          {error}
        </div>
      )}
      {phase === "ready" && (
        <>
          {source?.ref?.url && (
            <a href={source.ref.url} target="_blank" rel="noopener noreferrer" style={{ color: "#7dd3fc", fontSize: "0.8rem" }}>View the comment on GitHub ↗</a>
          )}
          {note && (
            <div data-no-translate style={{ borderLeft: "3px solid rgba(255,255,255,0.25)", color: "rgba(255,255,255,0.82)", fontSize: "0.84rem", lineHeight: 1.5, padding: "0.1rem 0 0.1rem 0.7rem", whiteSpace: "pre-wrap" }}>
              {note}
            </div>
          )}
          {!changes.length && <div style={quietTextStyle}>This suggestion holds no changes this version of the game can read.</div>}
          {detailChanges.length > 0 && (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
                <span style={{ ...labelStyle, marginBottom: 0 }}>Changes outside the map</span>
                <span style={{ flex: 1 }} />
                {pendingDetails.length > 1 && (
                  <>
                    <button type="button" className="oh-tap-row" disabled={busy} onClick={() => accept(pendingDetails)} style={tapFit(buttonStyle, touch)}>Accept all</button>
                    <button type="button" className="oh-tap-row" disabled={busy} onClick={() => reject(pendingDetails)} style={tapFit(buttonStyle, touch)}>Reject all</button>
                  </>
                )}
              </div>
              {detailChanges.map((change) => (
                <DetailChangeRow
                  key={change.id}
                  change={change}
                  status={statuses[change.id]}
                  decision={decisions.accepted.has(change.id) ? "accepted" : decisions.rejected.has(change.id) ? "rejected" : null}
                  busy={busy}
                  coverBefore={coverBefore}
                  touch={touch}
                  onAccept={() => accept([change])}
                  onReject={() => reject([change])}
                  onUndo={() => undo(change)}
                  canUndo={canUndo(change)}
                />
              ))}
            </div>
          )}
          {mapChanges.length > 0 && (
            <div style={{ ...cardStyle, display: "grid", gap: "0.6rem", marginBottom: 0 }}>
              <span style={{ ...labelStyle, marginBottom: 0 }}>Changes on the map</span>
              <MapChangeSummary changes={mapChanges} decided={decided} />
              <div style={quietTextStyle}>They open in the map editor, listed beside the map and marked on it, to accept or reject one by one. Save the map there to keep what you accepted.</div>
              <div>
                <button type="button" className="oh-tap-row" disabled={busy} onClick={() => onReviewMap?.(suggestion, decisions, key)} style={tapFit(primaryButtonStyle, touch)}>
                  🗺️ Review the map changes
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </DialogFrame>
  );
};

// ---- the scenario editor's Community card ---------------------------------------

export const openSuggestionsOf = (scenario) => openHubSuggestions(scenario?.hubPublished, scenario?.hubReviews);

// One contributor's open suggestions, under their name, with the button that
// puts every one of them away (and hides what they suggest later) — for a
// contributor who floods a post with bad edits.
const ContributorSuggestions = ({ login, refs, reviews, busy, touch, onReview, onRejectContributor }) => (
  <div style={{ display: "grid", gap: "0.4rem" }}>
    {login && refs.length > 1 && (
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
        <span style={{ flex: 1, fontSize: "0.8rem", fontWeight: 700 }}>{`@${login}: ${refs.length} suggestions`}</span>
        <button type="button" className="oh-tap-row" disabled={busy} onClick={() => onRejectContributor?.(login)} style={tapFit(buttonStyle, touch)}>
          {`Reject all from @${login}`}
        </button>
      </div>
    )}
    {refs.map((ref) => (
      <div key={ref.id} style={{ alignItems: "center", background: "rgba(43,193,243,0.08)", border: "1px solid rgba(43,193,243,0.25)", borderRadius: 12, display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: "0.5rem 0.65rem" }}>
        <div style={{ flex: 1, minWidth: "10rem" }}>
          <div style={{ fontSize: "0.84rem", fontWeight: 700 }}>
            {ref.author ? `Suggested changes from @${ref.author}` : "Suggested changes"}
          </div>
          <div style={quietTextStyle}>
            {[ref.createdAt ? new Date(ref.createdAt).toLocaleDateString() : "", reviews[ref.id] ? "Review started" : "New"].filter(Boolean).join(" · ")}
          </div>
          {ref.note ? <div data-no-translate style={{ ...quietTextStyle, display: "-webkit-box", overflow: "hidden", WebkitBoxOrient: "vertical", WebkitLineClamp: 2 }}>{ref.note}</div> : null}
        </div>
        <button type="button" className="oh-tap-row" disabled={busy} onClick={() => onReview?.({ ref })} style={tapFit(primaryButtonStyle, touch)}>Review</button>
        {login && refs.length === 1 && (
          <button type="button" className="oh-tap-row" disabled={busy} onClick={() => onRejectContributor?.(login)} style={tapFit(buttonStyle, touch)}>
            {`Reject all from @${login}`}
          </button>
        )}
      </div>
    ))}
  </div>
);

export const ScenarioCommunityCard = ({ scenario, busy, onSuggest, onUnlink, onReview, onOpenFile, onRefresh, onForgetPost, onRejectContributor, onUnblockContributor, refreshNote }) => {
  const touch = useTouchPrimary();
  const [showReviewed, setShowReviewed] = useState(false);
  const fileRef = useRef(null);
  if (!scenario) return null;
  const origin = scenario.hubOrigin;
  const published = scenario.hubPublished;
  const reviews = scenario.hubReviews ?? {};
  const open = openSuggestionsOf(scenario);
  const openIds = new Set(open.map((ref) => ref.id));
  const reviewed = (published?.suggestions ?? []).filter((ref) => !openIds.has(ref.id));
  // Open suggestions under the contributor who made them, most first.
  const byContributor = [...open.reduce((groups, ref) => {
    const login = ref.author || "";
    groups.set(login, [...(groups.get(login) ?? []), ref]);
    return groups;
  }, new Map())].sort((a, b) => b[1].length - a[1].length);
  const blocked = published?.blocked ?? [];
  return (
    <div style={{ ...cardStyle, display: "grid", gap: "0.8rem" }}>
      {origin && (
        <div style={{ display: "grid", gap: "0.45rem" }}>
          <span style={labelStyle}>From the community</span>
          <div style={{ fontSize: "0.88rem" }}>
            {origin.author ? `“${postTitleOf(origin)}”, posted by ${origin.author}` : `“${postTitleOf(origin)}”`}
          </div>
          <div style={quietTextStyle}>
            {origin.editedAt
              ? "You have changed your copy. Suggest your changes to the author, and they can accept or reject each one."
              : "Your copy is the same as the post. Change it, and you can suggest your changes to the author."}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
            <button type="button" className="oh-tap-row" disabled={busy} onClick={onSuggest} style={tapFit(origin.editedAt ? primaryButtonStyle : buttonStyle, touch)}>Suggest changes</button>
            <a href={hubPostUrl(origin.postId)} target="_blank" rel="noopener noreferrer" className="oh-tap-row" style={{ ...tapFit(buttonStyle, touch), textDecoration: "none" }}>View the post ↗</a>
            <button
              type="button"
              className="oh-tap-row"
              disabled={busy}
              onClick={onUnlink}
              title="Make this your own scenario, for good: it stops following the post, you can no longer suggest changes to it, and it cannot be linked to a post again."
              style={tapFit(buttonStyle, touch)}
            >
              Unlink from the community post
            </button>
          </div>
        </div>
      )}
      {published && (
        <div style={{ display: "grid", gap: "0.45rem" }}>
          <span style={labelStyle}>Your post on the hub</span>
          {published.postIds.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
              {published.postIds.map((postId) => (
                <a key={postId} href={hubPostUrl(postId)} target="_blank" rel="noopener noreferrer" style={{ color: "#7dd3fc", fontSize: "0.84rem" }}>{`Post #${postId} ↗`}</a>
              ))}
            </div>
          ) : (
            <div style={quietTextStyle}>Waiting to find your post on the hub. Once you have posted it, it shows here, with any changes people suggest.</div>
          )}
          {open.length > 0 ? (
            <div style={{ display: "grid", gap: "0.6rem" }}>
              {byContributor.map(([login, refs]) => (
                <ContributorSuggestions
                  key={login || "unknown"}
                  login={login}
                  refs={refs}
                  reviews={reviews}
                  busy={busy}
                  touch={touch}
                  onReview={onReview}
                  onRejectContributor={onRejectContributor}
                />
              ))}
            </div>
          ) : published.postIds.length ? (
            <div style={quietTextStyle}>No suggested changes waiting.</div>
          ) : null}
          {reviewed.length > 0 && (
            <div>
              <button type="button" className="oh-tap-row" onClick={() => setShowReviewed((value) => !value)} style={tapFit(buttonStyle, touch)}>
                {showReviewed ? "Hide reviewed suggestions" : `Reviewed suggestions (${reviewed.length})`}
              </button>
              {showReviewed && (
                <div style={{ display: "grid", gap: "0.35rem", marginTop: "0.45rem" }}>
                  {reviewed.map((ref) => (
                    <div key={ref.id} style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.8rem" }}>{ref.author ? `@${ref.author}` : ref.id}</span>
                      <span style={quietTextStyle}>{reviews[ref.id]?.status === "dismissed" ? "Dismissed" : "Reviewed"}</span>
                      <button type="button" className="oh-tap-row" disabled={busy} onClick={() => onReview?.({ ref })} style={tapFit(buttonStyle, touch)}>Open</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {blocked.length > 0 && (
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
              <span style={quietTextStyle}>Blocked contributors:</span>
              {blocked.map((login) => (
                <span key={login} style={{ alignItems: "center", display: "inline-flex", gap: "0.3rem" }}>
                  <span data-no-translate style={{ fontSize: "0.8rem" }}>{`@${login}`}</span>
                  <button type="button" className="oh-tap-row" disabled={busy} onClick={() => onUnblockContributor?.(login)} style={tapFit({ ...buttonStyle, minHeight: "1.8rem", padding: "0 0.65rem" }, touch)}>Unblock</button>
                </span>
              ))}
            </div>
          )}
          {refreshNote ? <div style={quietTextStyle}>{refreshNote}</div> : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
            <button type="button" className="oh-tap-row" disabled={busy} onClick={onRefresh} style={tapFit(buttonStyle, touch)}>Check for suggestions</button>
            <button type="button" className="oh-tap-row" disabled={busy} onClick={() => fileRef.current?.click()} style={tapFit(buttonStyle, touch)}>Open a suggestion file</button>
            <button
              type="button"
              className="oh-tap-row"
              disabled={busy}
              onClick={onForgetPost}
              title="Stop looking for suggestions on this post, for good. The post itself stays on the hub, and it cannot be linked to this scenario again."
              style={tapFit(buttonStyle, touch)}
            >
              Unlink the post
            </button>
          </div>
        </div>
      )}
      {/* No post of the player's own: one comes only from Publish, which the
          game then finds by itself. There is nothing here to link one with. */}
      {!published && (
        <div style={{ display: "grid", gap: "0.45rem" }}>
          {!origin && <span style={labelStyle}>Community</span>}
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
            <span style={quietTextStyle}>If you publish this scenario to the hub from the Community tab, the changes people suggest on your post show here.</span>
            <button type="button" className="oh-tap-row" disabled={busy} onClick={() => fileRef.current?.click()} style={tapFit(buttonStyle, touch)}>Open a suggestion file</button>
          </div>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={acceptFor(".zip,.json,application/zip,application/json")}
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onOpenFile?.(file);
        }}
      />
    </div>
  );
};

// ---- the library telling an author about new suggestions ------------------------

export const SuggestionCountBadge = ({ count, onClick }) => {
  if (!count) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      title="People have suggested changes to this scenario"
      style={{ alignItems: "center", background: "rgba(43,193,243,0.22)", border: "1px solid rgba(43,193,243,0.55)", borderRadius: 999, color: "#fff", cursor: "pointer", display: "inline-flex", fontSize: "0.7rem", fontWeight: 700, gap: "0.3rem", padding: "0.3rem 0.6rem", position: "relative", zIndex: 3 }}
    >
      {count === 1 ? "💬 1 suggestion" : `💬 ${count} suggestions`}
    </button>
  );
};

export const SuggestionsBanner = ({ scenarios, onOpen }) => {
  const touch = useTouchPrimary();
  const rows = (Array.isArray(scenarios) ? scenarios : [])
    .map((scenario) => ({ scenario, count: openSuggestionsOf(scenario).length }))
    .filter((row) => row.count > 0);
  if (!rows.length) return null;
  return (
    <div style={{ alignItems: "center", background: "rgba(43,193,243,0.1)", border: "1px solid rgba(43,193,243,0.3)", borderRadius: 16, display: "flex", flexWrap: "wrap", gap: "0.6rem", marginBottom: "1rem", padding: "0.7rem 0.9rem" }}>
      <span style={{ fontSize: "0.86rem", fontWeight: 700 }}>💬 People have suggested changes to your scenarios</span>
      <span style={{ flex: 1 }} />
      {rows.map(({ scenario, count }) => (
        <button key={scenario.id} type="button" className="oh-tap-row" onClick={() => onOpen?.(scenario)} style={tapFit(buttonStyle, touch)}>
          {count === 1 ? `${scenario.name}: 1 suggestion` : `${scenario.name}: ${count} suggestions`}
        </button>
      ))}
    </div>
  );
};

