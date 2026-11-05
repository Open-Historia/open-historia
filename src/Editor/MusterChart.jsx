/*!
 * Open Historia Map Editor — a mustering curve, drawn
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Wars and Fronts Pt.2: "Calling the army should take exponentially longer to
// mobilize everyone the more people that are mobilized, and that exponential
// curve should be defined by scenario designers by providing 2 points of how
// long it should take that are used for the whole exponential (0,0 is given)
// make a small graph where people can actually see the exponential chart."
//
// The curve (runtime/mustering.js) runs through (0, 0) and two points, each
// [share of the army, days]. This draws it, the days since the call-up along
// the bottom and the share of the army mustered up the side, with the two
// points as handles to drag and four fields to type them in. Where there is no
// curve of its own, the one it falls back on (a scenario's default, else the
// game's) is drawn muted and its points are muted handles: dragging one, or
// typing a figure, makes a curve of its own from there. The curve is drawn as
// the engine reads it (fronts/muster.js): past the last day of its table
// (MUSTER_TABLE_DAYS_MOST) everybody has come.
//
// One chart serves the Workshop's Countries and Groups panels (a country's own
// curve) and the Scenario Editor's Fronts tab (the scenario's default). Flat
// colours only: nothing in the interface is a gradient (src/noGradients.test.js).

import { useRef, useState } from "react";
import { DEFAULT_MUSTER, MUSTER_TABLE_DAYS_MOST, musterCurvePoints, musterTable } from "../runtime/mustering.js";
import { MUSTER_DAYS_MOST, normalizeMusterPoints } from "../runtime/warSettings.js";

const ACCENT = "#2bc1f3";
const MUTED = "rgba(255,255,255,0.45)";
const GRID = "rgba(255,255,255,0.08)";
const AXIS = "rgba(255,255,255,0.3)";
const TICK_TEXT = "rgba(255,255,255,0.55)";

// The drawing, in the SVG's own units; it is scaled to the width it is given.
const VIEW_W = 300;
const VIEW_H = 140;
const LEFT = 32;
const RIGHT = 10;
const TOP = 8;
const BOTTOM = 18;
const PLOT_W = VIEW_W - LEFT - RIGHT;
const PLOT_H = VIEW_H - TOP - BOTTOM;
// Past this day the engine has everybody in (fronts/muster.js musterShare).
const ALL_IN_BY = MUSTER_TABLE_DAYS_MOST + 1;

const defaultFieldStyle = {
  background: "rgba(0,0,0,0.28)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 7,
  boxSizing: "border-box",
  color: "white",
  fontSize: 12,
  outline: "none",
  padding: "4px 6px",
  textAlign: "right",
  width: "100%",
};

const clamp = (value, least, most) => Math.min(most, Math.max(least, value));
const places = (value, digits) => String(Math.round(Number(value) * 10 ** digits) / 10 ** digits);
const samePoints = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// The smallest of `steps` times a power of ten that is at least `value`: the
// ticks' spacing from the coarse ones, the chart's last day from the fine ones,
// so that a curve all in by day 288 is drawn to 300 rather than to 500.
const TICK_STEPS = [1, 2, 2.5, 5, 10];
const END_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const niceCeil = (value, steps = TICK_STEPS) => {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of steps) if (step * power >= value - 1e-9) return step * power;
  return 10 * power;
};

// The day the whole army is in, as the engine reads the curve.
const allInDay = (points) => {
  const table = musterTable(points);
  return table[table.length - 1] >= 1 ? table.length - 1 : table.length;
};

// What the two points read as in the four fields: shares in percent.
const textOf = (points) => (points
  ? [places(points[0][0] * 100, 1), places(points[0][1], 1), places(points[1][0] * 100, 1), places(points[1][1], 1)]
  : ["", "", "", ""]);

// One handle dragged to (days, share): rounded to whole days (half days on a
// short chart) and whole percent, and kept clear of the other point, so the
// curve stays one that rises.
const placePoint = (points, index, days, share, max) => {
  const step = max > 60 ? 1 : 0.5;
  const day = Math.round(days / step) * step;
  const part = Math.round(share * 100) / 100;
  const [first, second] = points;
  if (index === 0) return [[clamp(part, 0.01, second[0] - 0.01), clamp(day, step, second[1] - step)], second];
  return [first, [clamp(part, first[0] + 0.01, 1), clamp(day, first[1] + step, max)]];
};

// The curve's path from (0, 0) to everybody, cut where the engine's table ends.
const curvePath = (points, max) => {
  const x = (days) => LEFT + (Math.min(days, max) / max) * PLOT_W;
  const y = (share) => TOP + (1 - share) * PLOT_H;
  const drawn = [];
  let previous = null;
  for (const [days, share] of musterCurvePoints(points, 96)) {
    if (days > ALL_IN_BY) {
      const at = previous ? previous[1] + ((share - previous[1]) * (ALL_IN_BY - previous[0])) / (days - previous[0]) : share;
      drawn.push([ALL_IN_BY, at], [ALL_IN_BY, 1]);
      break;
    }
    drawn.push([days, share]);
    previous = [days, share];
  }
  return drawn.map(([days, share], index) => `${index === 0 ? "M" : "L"}${x(days).toFixed(1)} ${y(share).toFixed(1)}`).join(" ");
};

const LegendLine = ({ dashed }) => (
  <svg aria-hidden="true" width="18" height="6" style={{ flexShrink: 0 }}>
    <line x1="0" y1="3" x2="18" y2="3" stroke={dashed ? MUTED : ACCENT} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} />
  </svg>
);

//   points          the curve's own two points, or null for none
//   fallback        the curve that stands where there is none (DEFAULT_MUSTER, or a scenario's)
//   ownLabel        what the curve of its own is called in the legend
//   fallbackLabel   what the fallback is called
//   onChange        (points | null): a curve of its own, or none again
//   fieldStyle      the style of the four fields, to match the panel they are in
const MusterChart = ({
  points = null,
  fallback = DEFAULT_MUSTER,
  ownLabel = "Its own curve",
  fallbackLabel = "The game's default",
  onChange,
  fieldStyle = defaultFieldStyle,
}) => {
  const own = normalizeMusterPoints(points);
  const base = normalizeMusterPoints(fallback) ?? DEFAULT_MUSTER.map((point) => [...point]);
  const svgRef = useRef(null);
  // A handle being dragged: { index, points, max }, the chart's scale held still meanwhile.
  const [drag, setDrag] = useState(null);
  // What the four fields hold while the author types in them, from the first
  // keystroke until they leave them with a curve; null while they show the curve.
  const [typed, setTyped] = useState(null);
  const [problem, setProblem] = useState(false);

  // (The tables are a few hundred steps at most: worked out again on each drawing.)
  const shown = drag?.points ?? own;
  const furthest = Math.max(allInDay(base), base[1][1] * 1.08, own ? Math.max(allInDay(own), own[1][1] * 1.08) : 0);
  const max = Math.min(MUSTER_DAYS_MOST, niceCeil(furthest, END_STEPS));
  const scale = drag?.max ?? max;
  const step = niceCeil(scale / 4);
  const ticks = [];
  for (let day = 0; day <= scale + 1e-9; day += step) ticks.push(Math.round(day * 10) / 10);
  const x = (days) => LEFT + (Math.min(days, scale) / scale) * PLOT_W;
  const y = (share) => TOP + (1 - share) * PLOT_H;
  const handles = shown ?? base;
  const allIn = allInDay(handles);

  // A pointer's place on the chart, in days and share.
  const pointerAt = (event, range) => {
    const svg = svgRef.current;
    if (!svg) return null;
    let px;
    let py;
    const matrix = svg.getScreenCTM?.();
    if (matrix && typeof svg.createSVGPoint === "function") {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const local = point.matrixTransform(matrix.inverse());
      px = local.x;
      py = local.y;
    } else {
      const box = svg.getBoundingClientRect();
      if (!box.width || !box.height) return null;
      px = ((event.clientX - box.left) / box.width) * VIEW_W;
      py = ((event.clientY - box.top) / box.height) * VIEW_H;
    }
    return { days: ((px - LEFT) / PLOT_W) * range, share: 1 - (py - TOP) / PLOT_H };
  };

  const grab = (index) => (event) => {
    if (!onChange || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Without capture the drag still follows the pointer while it is over the chart.
    }
    setDrag({ index, points: handles.map((point) => [...point]), max });
  };
  const move = (event) => {
    if (!drag) return;
    const at = pointerAt(event, drag.max);
    if (!at) return;
    const next = placePoint(drag.points, drag.index, at.days, at.share, drag.max);
    setDrag((current) => (current ? { ...current, points: next } : current));
  };
  const release = () => {
    if (!drag) return;
    const kept = normalizeMusterPoints(drag.points);
    setDrag(null);
    setTyped(null);
    setProblem(false);
    if (kept && !samePoints(kept, own)) onChange?.(kept);
  };

  // The four fields, read together: a field left empty takes the figure the
  // chart shows, so typing one figure over the default makes a curve of its
  // own. Each keystroke that makes a curve is kept at once (a click on the
  // Workshop's map takes no focus from a field, so leaving one cannot be
  // waited for); what makes none is only told when the author leaves the field.
  const commit = (texts, final) => {
    if (texts.every((text) => text.trim() === "")) {
      if (final) {
        setTyped(null);
        setProblem(false);
      }
      return;
    }
    const from = own ?? base;
    const read = (text, otherwise, unit) => {
      const trimmed = text.trim();
      if (!trimmed) return otherwise;
      const number = Number(trimmed.replace(/\s*%$/, "").replace(",", "."));
      return Number.isFinite(number) ? number / unit : NaN;
    };
    const kept = normalizeMusterPoints([
      [read(texts[0], from[0][0], 100), read(texts[1], from[0][1], 1)],
      [read(texts[2], from[1][0], 100), read(texts[3], from[1][1], 1)],
    ]);
    if (!kept) {
      // (What was typed stays in the fields beside the reason, to be put right.)
      if (final) setProblem(true);
      return;
    }
    setProblem(false);
    if (final) setTyped(null);
    if (!samePoints(kept, own)) onChange?.(kept);
  };
  const shownTexts = drag ? textOf(drag.points) : typed ?? textOf(own);
  const placeholders = textOf(own ?? base);
  const field = (index, label) => (
    <input
      aria-label={label}
      inputMode="decimal"
      placeholder={placeholders[index]}
      value={shownTexts[index]}
      disabled={!onChange}
      onChange={(event) => {
        const next = (typed ?? textOf(own)).map((text, at) => (at === index ? event.target.value : text));
        setTyped(next);
        commit(next, false);
      }}
      onBlur={() => { if (typed) commit(typed, true); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      style={fieldStyle}
    />
  );

  const handleColour = own || drag ? ACCENT : MUTED;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 10.5 }}>Army mustered, by days since the call-up</div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label="Mustering curve"
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, display: "block", height: "auto", maxWidth: 420, touchAction: "none", userSelect: "none", width: "100%" }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((share) => (
          <line key={`share-${share}`} x1={LEFT} x2={LEFT + PLOT_W} y1={y(share)} y2={y(share)} stroke={share === 0 ? AXIS : GRID} strokeWidth="1" />
        ))}
        {ticks.map((day) => (
          <line key={`day-${day}`} x1={x(day)} x2={x(day)} y1={TOP} y2={TOP + PLOT_H} stroke={day === 0 ? AXIS : GRID} strokeWidth="1" />
        ))}
        {[0, 0.5, 1].map((share) => (
          <text key={`share-label-${share}`} x={LEFT - 4} y={y(share) + 3} textAnchor="end" fontSize="9" fill={TICK_TEXT}>{`${share * 100}%`}</text>
        ))}
        {ticks.map((day, index) => (
          <text key={`day-label-${day}`} x={x(day)} y={VIEW_H - 5} textAnchor={index === 0 ? "start" : "middle"} fontSize="9" fill={TICK_TEXT}>{day}</text>
        ))}
        <path d={curvePath(base, scale)} fill="none" stroke={MUTED} strokeWidth="1.5" strokeDasharray="4 3" />
        {shown && <path d={curvePath(shown, scale)} fill="none" stroke={ACCENT} strokeWidth="2" />}
        <circle cx={x(0)} cy={y(0)} r="3" fill="rgba(255,255,255,0.8)" />
        {handles.map(([share, days], index) => (
          <g
            key={`handle-${index}`}
            onPointerDown={grab(index)}
            style={{ cursor: onChange ? (drag?.index === index ? "grabbing" : "grab") : "default" }}
          >
            <title>{index === 0 ? "First point: drag it" : "Second point: drag it"}</title>
            <circle cx={x(days)} cy={y(share)} r="12" fill="transparent" />
            <circle cx={x(days)} cy={y(share)} r={drag?.index === index ? 6.5 : 5.5} fill={handleColour} stroke="#0b0b0d" strokeWidth="1.5" />
          </g>
        ))}
      </svg>
      <div style={{ alignItems: "center", color: "rgba(255,255,255,0.6)", display: "flex", flexWrap: "wrap", fontSize: 10.5, gap: "4px 12px" }}>
        {shown && <span style={{ alignItems: "center", display: "inline-flex", gap: 5 }}><LegendLine />{ownLabel}</span>}
        <span style={{ alignItems: "center", display: "inline-flex", gap: 5 }}><LegendLine dashed />{fallbackLabel}</span>
      </div>
      <div style={{ alignItems: "center", display: "grid", fontSize: 11, gap: "4px 6px", gridTemplateColumns: "auto minmax(0, 1fr) minmax(0, 1fr)" }}>
        <span />
        <span style={{ color: "rgba(255,255,255,0.5)", textAlign: "right" }}>Mustered (%)</span>
        <span style={{ color: "rgba(255,255,255,0.5)", textAlign: "right" }}>Days after the call-up</span>
        <span style={{ color: "rgba(255,255,255,0.72)" }}>First point</span>
        {field(0, "First point: the share of the army mustered, in percent")}
        {field(1, "First point: days since the call-up")}
        <span style={{ color: "rgba(255,255,255,0.72)" }}>Second point</span>
        {field(2, "Second point: the share of the army mustered, in percent")}
        {field(3, "Second point: days since the call-up")}
      </div>
      {problem && (
        <div style={{ color: "#fca5a5", fontSize: 10.5, lineHeight: 1.4 }}>
          The second point needs more of the army than the first, and more days (at most {MUSTER_DAYS_MOST}).
        </div>
      )}
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 10.5 }}>{`All of the army is in by day ${allIn}.`}</span>
        {own && onChange && (
          <button
            type="button"
            onClick={() => {
              setTyped(null);
              setProblem(false);
              onChange(null);
            }}
            title="Take this curve away, and the default stands again"
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 7, color: "white", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 8px" }}
          >
            Use the default
          </button>
        )}
      </div>
    </div>
  );
};

export default MusterChart;
