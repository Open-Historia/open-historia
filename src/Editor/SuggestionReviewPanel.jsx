/*!
 * Open Historia Map Editor — the Suggested changes review panel
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Reviewing a suggestion's map changes the way a document's tracked changes
// are reviewed: every change listed beside the map and marked on it — amber
// while it waits, green once accepted, grey once rejected, the suggested new
// borders drawn dashed over the old ones — and accepted (applied to the map at
// once) or rejected one at a time, a whole group at a time, or all at once.
// Accepting puts what the change needs first (a country or group the
// suggestion adds); Undo takes an acceptance back. Nothing reaches the
// scenario until the author saves the map, like any other edit here.
//
// useSuggestionReview holds the review's state for MapEditor; the panel and
// the map's markup layer both read it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import GeoJSON from "ol/format/GeoJSON";
import Style from "ol/style/Style";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import CircleStyle from "ol/style/Circle";
import { fromLonLat } from "ol/proj";
import Panel from "./Panel.jsx";
import { labelDim, pillButton } from "./editorStyles.js";
import {
  REVIEW_SECTIONS,
  acceptMapChanges,
  changeTargets,
  createRegionCache,
  decisionOf,
  decisionsFor,
  mapChangeStatus,
  sectionOfChange,
} from "./suggestionReview.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// ---- the review's state ---------------------------------------------------------

export const useSuggestionReview = ({ review, api, d, setBackground, regionEpoch }) => {
  const changes = useMemo(
    () => (review?.suggestion?.changes ?? []).filter((change) => change.area === "map"),
    [review?.suggestion],
  );
  const [decisions, setDecisions] = useState(() => ({
    accepted: new Set(review?.decisions?.accepted ?? []),
    rejected: new Set(review?.decisions?.rejected ?? []),
  }));
  const [renames, setRenames] = useState({});
  const [focusId, setFocusId] = useState(null);
  const undoers = useRef(new globalThis.Map());
  // useMapDocument hands back a new object every render, but its setters are
  // stable and the document changes only when it changes: key on that.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ctx = useMemo(() => ({ api, doc: d.doc, d, setBackground }), [api, d.doc, setBackground]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const renamesRef = useRef(renames);
  renamesRef.current = renames;

  // Region shapes and who holds which regions, read once per state of the
  // regions: a document edit re-measures nothing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const regionCache = useMemo(() => createRegionCache(), [api, regionEpoch]);

  const statuses = useMemo(() => {
    if (!api || !review) return {};
    return Object.fromEntries(changes.map((change) => [change.id, mapChangeStatus(change, ctx, { renames, cache: regionCache })]));
  }, [api, review, changes, ctx, renames, regionCache]);

  const decide = useCallback((ids, kind) => {
    setDecisions((current) => {
      const accepted = new Set(current.accepted);
      const rejected = new Set(current.rejected);
      for (const id of ids) {
        accepted.delete(id);
        rejected.delete(id);
        if (kind === "accepted") accepted.add(id);
        if (kind === "rejected") rejected.add(id);
      }
      return { accepted, rejected };
    });
  }, []);

  // Accept a list of changes (acceptMapChanges: what they need first, the
  // ownership rows batched by the country they go to).
  const accept = useCallback((list) => {
    if (!api) return;
    const result = acceptMapChanges(list, ctxRef.current, { changes, accepted: decisions.accepted, renames: renamesRef.current });
    if (!result.accepted.length) return;
    for (const [id, undo] of result.undoers) undoers.current.set(id, undo);
    setRenames(result.renames);
    decide(result.accepted, "accepted");
  }, [api, changes, decide, decisions.accepted]);

  const reject = useCallback((list) => decide(list.map((change) => change.id), "rejected"), [decide]);

  // An acceptance can be taken back only in the review that made it: one
  // loaded from an earlier review has no undo, and clearing its decision
  // would leave the change on the map marked undecided.
  const canUndo = useCallback((id) => !decisions.accepted.has(id) || undoers.current.has(id), [decisions.accepted]);

  const undo = useCallback((change) => {
    if (decisions.accepted.has(change.id)) {
      if (!undoers.current.has(change.id)) return;
      undoers.current.get(change.id)();
      undoers.current.delete(change.id);
      if (change.kind === "polity-rename") {
        setRenames((current) => {
          const next = { ...current };
          delete next[change.from];
          return next;
        });
      }
    }
    decide([change.id], null);
  }, [decide, decisions.accepted]);

  // What a save should record (decisionsFor).
  const decisionsForSave = useCallback(() => decisionsFor(changes, decisions, statuses), [changes, decisions, statuses]);

  const pendingCount = changes.filter((change) => !decisionOf(change, decisions, statuses)).length;

  return useMemo(
    () => ({ active: Boolean(review), changes, decisions, statuses, renames, focusId, setFocusId, accept, reject, undo, canUndo, decisionsForSave, pendingCount, ctx, regionCache }),
    [review, changes, decisions, statuses, renames, focusId, accept, reject, undo, canUndo, decisionsForSave, pendingCount, ctx, regionCache],
  );
};

// ---- the markup on the map ------------------------------------------------------

const STATE_COLORS = {
  pending: "#f59e0b",
  conflict: "#f97316",
  accepted: "#22c55e",
  rejected: "rgba(148,163,184,0.75)",
  proposed: "#38bdf8",
};
const styleCache = new globalThis.Map();
const markupStyle = (feature) => {
  const state = feature.get("state");
  const kind = feature.get("kind");
  const focused = feature.get("focused") ? 1 : 0;
  const key = `${kind}|${state}|${focused}`;
  if (styleCache.has(key)) return styleCache.get(key);
  const color = kind === "shape" && state !== "rejected" && state !== "accepted" ? STATE_COLORS.proposed : STATE_COLORS[state] || STATE_COLORS.pending;
  let style;
  if (kind === "point") {
    style = new Style({
      image: new CircleStyle({
        radius: focused ? 9 : 7,
        fill: new Fill({ color: state === "rejected" ? "rgba(148,163,184,0.35)" : `${color}55` }),
        stroke: new Stroke({ color: focused ? "#ffffff" : color, width: focused ? 3 : 2 }),
      }),
      zIndex: focused ? 20 : 10,
    });
  } else {
    const dashed = kind === "shape" || state === "rejected" || state === "pending" || state === "conflict";
    style = new Style({
      stroke: new Stroke({
        // Focused, a region's outline turns white; a proposed shape keeps its
        // blue, so the old border and the new one stay told apart.
        color: focused && kind !== "shape" ? "#ffffff" : color,
        width: focused ? 3.5 : kind === "shape" ? 2.5 : 2,
        lineDash: dashed ? (kind === "shape" ? [8, 5] : state === "rejected" ? [2, 5] : [6, 4]) : undefined,
      }),
      fill: state === "rejected" ? undefined : new Fill({ color: kind === "shape" ? "rgba(56,189,248,0.12)" : state === "accepted" ? "rgba(34,197,94,0.08)" : "rgba(245,158,11,0.10)" }),
      zIndex: focused ? 20 : kind === "shape" ? 12 : 10,
    });
  }
  styleCache.set(key, style);
  return style;
};

const stateOf = (change, review) => decisionOf(change, review.decisions, review.statuses)
  || (review.statuses[change.id] === "conflict" ? "conflict" : "pending");

// One change's markup: its regions' outlines (each region once across the
// changes drawn together), the suggested shapes when `withShapes`, its dots.
const markupFeatures = (api, change, targets, state, focused, withShapes, outlined = new Set()) => {
  const format = new GeoJSON();
  const features = [];
  for (const id of targets.regionIds) {
    if (outlined.has(id)) continue;
    outlined.add(id);
    const region = api.regionSource.getFeatureById(id);
    if (!region) continue;
    features.push(new Feature({ geometry: region.getGeometry().clone(), kind: "region", state, focused, changeId: change.id }));
  }
  if (withShapes) {
    for (const shape of targets.shapes) {
      try {
        const geometry = format.readGeometry(shape.geometry, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
        features.push(new Feature({ geometry, kind: "shape", state, focused, changeId: change.id }));
      } catch {
        // A shape this map cannot read is simply not drawn.
      }
    }
  }
  for (const [lng, lat] of targets.points) {
    features.push(new Feature({ geometry: new Point(fromLonLat([Number(lng), Number(lat)])), kind: "point", state, focused, changeId: change.id }));
  }
  return features;
};

// The markup layer: a region outline per change about a region on this map,
// the suggested shape of every border change, a dot per city, unit or feature.
// The focused change is drawn again, in white, on a layer of its own, so a
// click redraws that one change and nothing else.
export const useSuggestionMarkup = (api, review, regionEpoch) => {
  const sourceRef = useRef(null);
  const focusSourceRef = useRef(null);
  useEffect(() => {
    if (!api?.map || !review.active) return undefined;
    const source = new VectorSource();
    const layer = new VectorLayer({ source, style: markupStyle, zIndex: 57, updateWhileInteracting: false });
    layer.set("name", "suggestion-review");
    const focusSource = new VectorSource();
    const focusLayer = new VectorLayer({ source: focusSource, style: markupStyle, zIndex: 58, updateWhileInteracting: false });
    focusLayer.set("name", "suggestion-review-focus");
    api.map.addLayer(layer);
    api.map.addLayer(focusLayer);
    sourceRef.current = source;
    focusSourceRef.current = focusSource;
    return () => {
      api.map.removeLayer(layer);
      api.map.removeLayer(focusLayer);
      sourceRef.current = null;
      focusSourceRef.current = null;
    };
  }, [api, review.active]);

  // Where each change is: worked out again only when the changes, the renames
  // or the regions change, never on a click or a document edit.
  const { active, changes, renames, regionCache, decisions, statuses, focusId } = review;
  const targets = useMemo(() => {
    const out = new globalThis.Map();
    if (!api || !active) return out;
    for (const change of changes) out.set(change.id, changeTargets(change, { api }, { changes, renames, cache: regionCache }));
    return out;
  }, [api, active, changes, renames, regionCache]);
  const states = useMemo(
    () => new globalThis.Map(changes.map((change) => [change.id, stateOf(change, { decisions, statuses })])),
    [changes, decisions, statuses],
  );

  useEffect(() => {
    const source = sourceRef.current;
    if (!source || !api?.regionSource) return;
    const features = [];
    const outlined = new Set();
    for (const change of changes) {
      const state = states.get(change.id);
      const found = targets.get(change.id);
      if (!found) continue;
      // A border change the author has not accepted yet: show where it would put the borders.
      features.push(...markupFeatures(api, change, found, state, false, state === "pending" || state === "conflict", outlined));
    }
    source.clear(true);
    source.addFeatures(features);
    // regionEpoch: the outlines are copies of the regions' shapes.
  }, [api, active, changes, targets, states, regionEpoch]);

  useEffect(() => {
    const source = focusSourceRef.current;
    if (!source || !api?.regionSource) return;
    source.clear(true);
    const change = changes.find((entry) => entry.id === focusId);
    const found = change ? targets.get(change.id) : null;
    if (found) source.addFeatures(markupFeatures(api, change, found, states.get(change.id), true, true));
  }, [api, active, changes, targets, states, focusId, regionEpoch]);
};

// ---- the panel ----------------------------------------------------------------

const SECTION_TITLES = {
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
  settings: "Map settings",
};
const FIELD_CHIP_LABELS = { name: "Name", aliases: "Other names", code: "Code", note: "Note", status: "Status", color: "Colour", flag: "Flag", tags: "Tags", extra: "Other details" };

const polityName = (doc, key) => clean(doc?.polities?.[key]?.name) || clean(key);

// One line saying what the change does, in the names a person uses.
const changeText = (change, doc) => {
  const name = (key) => polityName(doc, key);
  switch (change.kind) {
    case "polity-add": return `New country: ${clean(change.record?.name) || change.key}`;
    case "polity-remove": return `Remove ${name(change.key)}`;
    case "polity-rename": return `Rename ${name(change.from)} to ${clean(change.record?.name) || change.to}`;
    case "polity-change": return `Edit country ${name(change.key)}`;
    case "region-owner": return change.regionName || change.regionId;
    case "borders": {
      const regions = change.regions ?? [];
      return regions.length === 1 ? `New borders for ${regions[0].name}` : `New borders for ${regions.length} neighbouring regions`;
    }
    case "region-name": return `Rename region ${change.from || change.regionId} to ${change.to}`;
    case "region-type": return `${change.regionName}: ${change.from || "land"} → ${change.to || "land"}`;
    case "region-claims": return change.to?.length ? `${change.regionName}: claimed by ${change.to.map(name).join(", ")}` : `${change.regionName}: no longer disputed`;
    case "region-group": return change.to ? `${change.regionName}: controlled by ${change.to}` : `${change.regionName}: no longer controlled by ${change.from}`;
    case "group-add": return `New group: ${change.key}`;
    case "group-remove": return `Remove group ${change.key}`;
    case "group-change": return `Edit group ${change.key}`;
    case "city-add": return `Add the city ${change.name}`;
    case "city-remove": return `Remove city ${change.name}`;
    case "city-change": return `Edit city ${change.name}`;
    case "cities-replace": return Array.isArray(change.to) ? `Replace the cities with ${change.to.length} new ones` : "Go back to the built-in cities";
    case "unit-add": return `Add the unit ${change.label}`;
    case "unit-remove": return `Remove unit ${change.label}`;
    case "unit-change": return `Edit unit ${change.label}`;
    case "marker-add": return `New map feature: ${change.label}`;
    case "marker-remove": return `Remove map feature ${change.label}`;
    case "marker-change": return `Edit map feature ${change.label}`;
    case "puppet-add": return `${name(change.to?.puppet)} becomes a puppet of ${name(change.to?.overlord)}`;
    case "puppet-remove": return `${name(change.from?.puppet)} is no longer a puppet of ${name(change.from?.overlord)}`;
    case "puppet-change": return `Change how ${name(change.to?.puppet)} answers to ${name(change.to?.overlord)}`;
    case "map-field": return change.field === "author" ? `Map author: ${change.to || "—"}` : `New basemap: ${change.to || "—"}`;
    case "background": return change.to ? "New custom basemap" : "Remove the custom basemap";
    default: return change.id;
  }
};


const StatusNote = ({ status }) => {
  if (status === "conflict") {
    return <span title="You changed this after you posted the scenario. Accepting replaces your version." style={{ color: "#fb923c", fontSize: 10.5, fontWeight: 700 }}>You changed this too</span>;
  }
  if (status === "applied") return <span style={{ color: "#86efac", fontSize: 10.5, fontWeight: 700 }}>Already on your map</span>;
  if (status === "missing") return <span style={{ color: "#cbd5e1", fontSize: 10.5, fontWeight: 700 }}>Not on your map</span>;
  return null;
};

const Decision = ({ change, review }) => {
  const decided = review.decisions.accepted.has(change.id) ? "accepted" : review.decisions.rejected.has(change.id) ? "rejected" : null;
  const status = review.statuses[change.id];
  if (decided) {
    return (
      <span style={{ alignItems: "center", display: "inline-flex", gap: 6 }}>
        <span style={{ color: decided === "accepted" ? "#86efac" : "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 700 }}>
          {decided === "accepted" ? "Accepted" : "Rejected"}
        </span>
        {review.canUndo(change.id)
          ? <button type="button" onClick={(event) => { event.stopPropagation(); review.undo(change); }} style={{ ...pillButton(false), padding: "3px 7px", fontSize: 11 }}>Undo</button>
          : <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 10.5 }}>To undo it, change it back by hand.</span>}
      </span>
    );
  }
  if (status === "applied" || status === "missing") return null;
  return (
    <span style={{ display: "inline-flex", gap: 5 }}>
      <button type="button" onClick={(event) => { event.stopPropagation(); review.accept([change]); }} style={{ ...pillButton(false), background: "rgba(34,197,94,0.16)", borderColor: "rgba(34,197,94,0.45)", padding: "3px 8px", fontSize: 11 }}>Accept</button>
      <button type="button" onClick={(event) => { event.stopPropagation(); review.reject([change]); }} style={{ ...pillButton(false), padding: "3px 8px", fontSize: 11 }}>Reject</button>
    </span>
  );
};

const ChangeRow = ({ change, review, doc, onFocus, indent = false }) => {
  const focused = review.focusId === change.id;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onFocus(change)}
      onKeyDown={(event) => { if (event.key === "Enter") onFocus(change); }}
      style={{
        background: focused ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${focused ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.07)"}`,
        borderRadius: 8,
        cursor: "pointer",
        display: "grid",
        gap: 5,
        marginLeft: indent ? 12 : 0,
        padding: "6px 8px",
      }}
    >
      <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
        <span style={{ flex: 1, fontSize: 12, lineHeight: 1.35 }}>{changeText(change, doc)}</span>
        <Decision change={change} review={review} />
      </div>
      {change.kind === "polity-change" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {Object.keys(change.fields ?? {}).map((field) => (
            <span key={field} style={{ background: "rgba(255,255,255,0.07)", borderRadius: 5, fontSize: 10.5, padding: "1px 6px" }}>{FIELD_CHIP_LABELS[field] || field}</span>
          ))}
        </div>
      )}
      {change.kind === "borders" && (
        <div style={{ color: "rgba(255,255,255,0.62)", display: "grid", fontSize: 11, gap: 2 }}>
          {(change.regions ?? []).slice(0, 8).map((region) => (
            <span key={region.id}>
              {region.op === "add" ? `New region: ${region.name}` : region.op === "remove" ? `Region removed: ${region.name}` : `Region redrawn: ${region.name}`}
            </span>
          ))}
          {(change.regions ?? []).length > 8 && <span>{`and ${(change.regions ?? []).length - 8} more`}</span>}
        </div>
      )}
      {/* Once decided, the decision is what the row says. */}
      {!review.decisions.accepted.has(change.id) && !review.decisions.rejected.has(change.id) && <StatusNote status={review.statuses[change.id]} />}
    </div>
  );
};

// Ownership rows grouped by where the regions go: "Mexico → Cartel del Norte, 12 regions".
const OwnershipGroups = ({ changes, review, doc, onFocus }) => {
  const [open, setOpen] = useState({});
  const groups = useMemo(() => {
    const byPair = new globalThis.Map();
    for (const change of changes) {
      const key = `${change.from ?? ""}→${change.to ?? ""}`;
      if (!byPair.has(key)) byPair.set(key, { key, from: change.from, to: change.to, items: [] });
      byPair.get(key).items.push(change);
    }
    return [...byPair.values()].sort((a, b) => b.items.length - a.items.length);
  }, [changes]);
  return groups.map((group) => {
    const pending = group.items.filter((change) => !decisionOf(change, review.decisions, review.statuses));
    const fromLabel = group.from ? polityName(doc, group.from) : "Unowned";
    const toLabel = group.to ? polityName(doc, group.to) : "Unowned";
    return (
      <div key={group.key} style={{ display: "grid", gap: 5 }}>
        <div style={{ alignItems: "center", display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => setOpen((current) => ({ ...current, [group.key]: !current[group.key] }))}
            style={{ background: "transparent", border: "none", color: "white", cursor: "pointer", flex: 1, fontSize: 12, fontWeight: 700, padding: 0, textAlign: "left" }}
          >
            {`${open[group.key] ? "▾" : "▸"} ${fromLabel} → ${toLabel}`}
            <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 400, marginLeft: 6 }}>
              {group.items.length === 1 ? "1 region" : `${group.items.length} regions`}
            </span>
          </button>
          {pending.length > 0 && (
            <>
              <button type="button" onClick={() => review.accept(pending)} style={{ ...pillButton(false), background: "rgba(34,197,94,0.16)", borderColor: "rgba(34,197,94,0.45)", padding: "3px 8px", fontSize: 11 }}>Accept</button>
              <button type="button" onClick={() => review.reject(pending)} style={{ ...pillButton(false), padding: "3px 8px", fontSize: 11 }}>Reject</button>
            </>
          )}
          {!pending.length && <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>Decided</span>}
        </div>
        {open[group.key] && group.items.map((change) => <ChangeRow key={change.id} change={change} review={review} doc={doc} onFocus={onFocus} indent />)}
      </div>
    );
  });
};

const SuggestionReviewPanel = ({ review, doc, api, suggestion, onClose }) => {
  const [hideDecided, setHideDecided] = useState(false);
  const decided = (change) => Boolean(decisionOf(change, review.decisions, review.statuses));
  const visible = hideDecided ? review.changes.filter((change) => !decided(change)) : review.changes;
  const total = review.changes.length;
  const settled = review.changes.filter(decided).length;
  const pending = review.changes.filter((change) => !decided(change));

  const focus = (change) => {
    review.setFocusId(change.id);
    const targets = changeTargets(change, review.ctx, { changes: review.changes, renames: review.renames, cache: review.regionCache });
    if (targets.regionIds.length) {
      api?.zoomToSelection?.(targets.regionIds);
    } else if (targets.shapes.length) {
      const bbox = change.bbox;
      if (bbox && api?.map) {
        const [minX, minY] = fromLonLat([bbox[0], bbox[1]]);
        const [maxX, maxY] = fromLonLat([bbox[2], bbox[3]]);
        api.map.getView().fit([minX, minY, maxX, maxY], { padding: [80, 80, 80, 80], duration: 350, maxZoom: 8 });
      }
    } else if (targets.points.length) {
      api?.locateFeature?.(targets.points[0]);
    }
  };

  return (
    <Panel
      title="Suggested changes"
      icon="list"
      width={400}
      onClose={onClose}
      footer={(
        <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 11.5, lineHeight: 1.45 }}>
          Accepted changes are on the map now. Save the map to keep them in the scenario.
        </div>
      )}
    >
      {(suggestion?.by || suggestion?.note) && (
        <div style={{ display: "grid", gap: 4 }}>
          {suggestion.by ? <span style={{ fontSize: 12, fontWeight: 700 }} data-no-translate>{suggestion.by}</span> : null}
          {suggestion.note ? <span data-no-translate style={{ color: "rgba(255,255,255,0.72)", fontSize: 11.5, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{suggestion.note}</span> : null}
        </div>
      )}
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 6 }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700 }}>{`${settled} of ${total} decided`}</span>
        {pending.length > 0 && (
          <>
            <button type="button" onClick={() => review.accept(pending)} style={{ ...pillButton(false), background: "rgba(34,197,94,0.16)", borderColor: "rgba(34,197,94,0.45)" }}>Accept all</button>
            <button type="button" onClick={() => review.reject(pending)} style={pillButton(false)}>Reject all</button>
          </>
        )}
      </div>
      <label style={{ alignItems: "center", display: "flex", fontSize: 11.5, gap: 6 }}>
        <input type="checkbox" checked={hideDecided} onChange={(event) => setHideDecided(event.target.checked)} />
        Hide the changes already decided
      </label>
      {!visible.length && <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>Nothing left to decide.</div>}
      {REVIEW_SECTIONS.map((section) => {
        const items = visible.filter((change) => sectionOfChange(change) === section.id);
        if (!items.length) return null;
        return (
          <div key={section.id} style={{ display: "grid", gap: 6 }}>
            <span style={labelDim}>{SECTION_TITLES[section.id]}</span>
            {section.id === "ownership"
              ? <OwnershipGroups changes={items} review={review} doc={doc} onFocus={focus} />
              : items.map((change) => <ChangeRow key={change.id} change={change} review={review} doc={doc} onFocus={focus} />)}
          </div>
        );
      })}
    </Panel>
  );
};

export default SuggestionReviewPanel;
