/*!
 * Open Historia Continuum — Scenario Workshop topology tools
 * Continuum-only Phase 12.5C.
 */

import { useEffect, useMemo, useState } from "react";
import Panel from "./Panel.jsx";
import { inputStyle, pillButton } from "./editorStyles.js";

const formatArea = (m2) => {
  const n = Number(m2) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)} km²`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(2)} ha`;
  return `${Math.round(n).toLocaleString()} m²`;
};

const LARGE_AREA_THRESHOLD = 400;
const LARGE_AREA_CAP = 1500;

const TopologyPanel = ({ api, selection = [], regionEpoch = 0, onClose }) => {
  const [maxWidth, setMaxWidth] = useState(500);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);

  // A geometry mutation invalidates the old preview. Clear it rather than
  // pretending the highlighted candidates still describe the current map.
  useEffect(() => {
    setReport(null);
    api?.clearTopologyDiagnostics?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionEpoch, selection.join(",")]);

  useEffect(() => () => api?.clearTopologyDiagnostics?.(), [api]);

  const canAnalyze = selection.length >= 2 && selection.length <= LARGE_AREA_CAP;
  const isLargeArea = selection.length > LARGE_AREA_THRESHOLD;
  const totalCandidates = (report?.gaps?.length || 0) + (report?.overlaps?.length || 0);
  const totalArea = useMemo(
    () => [...(report?.gaps || []), ...(report?.overlaps || [])].reduce((sum, row) => sum + (Number(row.area) || 0), 0),
    [report],
  );

  const analyze = async () => {
    if (!api || !canAnalyze || busy) return;
    setBusy(true);
    try {
      const next = api.analyzeTopology?.(selection, { maxWidth: Math.max(1, Number(maxWidth) || 500) });
      setReport(next || null);
    } finally {
      setBusy(false);
    }
  };

  const repair = async () => {
    if (!api || !report || !totalCandidates || busy) return;
    const ok = window.confirm(
      `Repair ${totalCandidates} previewed topology issue${totalCandidates === 1 ? "" : "s"}?\n\n` +
      "This is selection-scoped and becomes ONE undoable editor operation. Enclosed gaps are filled; narrow overlaps are trimmed deterministically. Open coastlines are never auto-filled.",
    );
    if (!ok) return;
    setBusy(true);
    try {
      const result = api.repairTopology?.(selection, { maxWidth: Math.max(1, Number(maxWidth) || 500) });
      setReport(null);
      if (!result?.changed) window.alert("Nothing eligible was repaired. Re-analyze the selection or adjust the tolerance.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Topology" icon="layers" onClose={onClose} width={420}>
      <div style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(255,255,255,0.68)" }}>
        Repair the <b>relationship between selected regions</b>, not one polygon at a time. The automatic pass is deliberately conservative: it only considers fully enclosed narrow gaps and narrow pairwise overlaps inside the selection.
      </div>

      <div style={{ padding: "9px 10px", borderRadius: 9, border: "1px solid rgba(96,165,250,0.25)", background: "rgba(59,130,246,0.08)", fontSize: 11.5, lineHeight: 1.45 }}>
        <b>{selection.length} regions selected.</b>{" "}
        {selection.length <= LARGE_AREA_THRESHOLD
          ? "Local mode. Province clusters, border sections and whole polities are fine."
          : selection.length <= LARGE_AREA_CAP
            ? "Large-area mode. The same conservative repair rules are used, but overlap discovery now uses the map spatial index instead of all-pairs scanning."
            : `Too large for one pass. R2.4 caps a single conservative repair at ${LARGE_AREA_CAP.toLocaleString()} regions; split the scenario into country / empire / continental chunks.`}
      </div>

      <div>
        <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>Maximum defect width (approx. metres in map projection)</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="number"
            min="1"
            step="25"
            value={maxWidth}
            onChange={(e) => setMaxWidth(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          {[100, 500, 1500].map((value) => (
            <button key={value} type="button" style={pillButton(Number(maxWidth) === value)} onClick={() => setMaxWidth(value)}>
              {value >= 1000 ? `${value / 1000} km` : `${value} m`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <button type="button" style={pillButton(false)} disabled={!canAnalyze || busy} onClick={analyze}>
          {busy ? "Working…" : isLargeArea ? "Analyze large selection" : "Analyze selection"}
        </button>
        <button type="button" style={{ ...pillButton(false), background: totalCandidates ? "rgba(34,197,94,0.2)" : undefined }} disabled={!totalCandidates || busy} onClick={repair}>
          Repair previewed issues
        </button>
        <button
          type="button"
          style={pillButton(false)}
          disabled={!report}
          onClick={() => { api?.clearTopologyDiagnostics?.(); setReport(null); }}
        >
          Clear preview
        </button>
      </div>

      {report && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            <div style={{ padding: 9, borderRadius: 9, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)" }}>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{report.gaps?.length || 0}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>enclosed gaps</div>
            </div>
            <div style={{ padding: 9, borderRadius: 9, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{report.overlaps?.length || 0}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>narrow overlaps</div>
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.62)" }}>
            Preview area: {formatArea(totalArea)}. Yellow = gaps; red = overlaps. Nothing has changed yet.
            {Number.isFinite(report.spatialPairs) ? (
              <> Spatial-index overlap checks: <b>{report.spatialPairs.toLocaleString()}</b>.</>
            ) : null}
          </div>

          {!totalCandidates && (
            <div style={{ fontSize: 11.5, color: "rgba(134,239,172,0.9)" }}>
              No conservative topology defects were found at this tolerance. That does not prove the geometry is perfect; it means this pass found nothing safe enough to propose automatically.
            </div>
          )}

          {!!totalCandidates && (
            <div style={{ maxHeight: 190, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
              {[...(report.gaps || []), ...(report.overlaps || [])].slice(0, 80).map((row) => (
                <div key={row.id} style={{ padding: "7px 8px", borderRadius: 8, background: "rgba(255,255,255,0.04)", fontSize: 11.5 }}>
                  <b>{row.kind === "gap" ? "Gap" : "Overlap"}</b> · width ~{Math.round(row.width).toLocaleString()} m · {formatArea(row.area)}
                  {row.kind === "gap" && row.targetName ? <div style={{ color: "rgba(255,255,255,0.5)", marginTop: 2 }}>fill into: {row.targetName}</div> : null}
                  {row.kind === "overlap" ? <div style={{ color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{row.aName} ↔ {row.bName}</div> : null}
                </div>
              ))}
              {totalCandidates > 80 && <div style={{ fontSize: 11, opacity: 0.55 }}>…and {totalCandidates - 80} more.</div>}
            </div>
          )}
        </div>
      )}

      {isLargeArea && selection.length <= LARGE_AREA_CAP ? (
        <div style={{ padding: "8px 9px", borderRadius: 8, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", fontSize: 11.5, lineHeight: 1.45, color: "rgba(254,215,170,0.9)" }}>
          <b>Large-area pass:</b> this is still the proven conservative topology tool, not a new aggressive rebuild. It may take several seconds on very complex selections. Preview first; repair remains one Undo/Redo transaction. For a whole polity, use <b>Polities -&gt; Select territory</b>, then come back here.
        </div>
      ) : null}

      <div style={{ paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)", fontSize: 11.5, lineHeight: 1.5, color: "rgba(255,255,255,0.58)" }}>
        <b>Manual override:</b> use <b>Edit vertices</b> or <b>Shared border precision</b> after selecting the region(s) you actually want to touch. The topology pass handles mechanical cracks/slivers; the manual tools remain the deliberate human-authority path for historical border shape.
      </div>
    </Panel>
  );
};

export default TopologyPanel;
