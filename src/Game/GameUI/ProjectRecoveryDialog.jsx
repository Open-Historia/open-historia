/*! Open Historia — explicit legacy Projects recovery panel; AGPL-3.0-or-later (see LICENSE). */
// Explicit save-owner recovery for old campaigns with over-cap Projects.
// Only the LIBRARY offers this tool: a live player's Projects view must not
// reveal hidden foreign operations just because the save itself contains them.
import React, { useEffect, useMemo, useState } from "react";
import { useBackToClose } from "../../runtime/backToClose.js";
import {
  exportGameBundle,
  importGameBundle,
  readGameSnapshotsText,
  writeGameSnapshotsText,
} from "../../runtime/library.js";
import { canCopyProjectRecoverySnapshots, inspectProjectRecovery, prepareProjectRecoveryBundle } from "../../runtime/projectRecovery.js";

const surface = { background: "#15171c", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14 };
const button = { ...surface, color: "inherit", cursor: "pointer", fontSize: "0.78rem", padding: "0.55rem 0.85rem" };
const small = { color: "rgba(255,255,255,0.65)", fontSize: "0.76rem", lineHeight: 1.5 };
const banner = { background: "rgba(245,158,11,0.11)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 9, padding: "0.7rem", ...small };
const openStatus = (row) => row.open;

export default function ProjectRecoveryDialog({ game, onClose }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [mode, setMode] = useState("shelve");
  const [selectedShelve, setSelectedShelve] = useState([]);
  const [selectedRestore, setSelectedRestore] = useState([]);
  const [search, setSearch] = useState("");

  useBackToClose(!working, onClose);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    exportGameBundle(game.id)
      .then((value) => { if (!cancelled) setBundle(value); })
      .catch((reason) => { if (!cancelled) setError(String(reason?.message || reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [game.id]);

  const inspection = useMemo(() => {
    if (!bundle) return null;
    try { return inspectProjectRecovery(bundle.data?.world); }
    catch (reason) { return { failure: String(reason?.message || reason) }; }
  }, [bundle]);
  const rows = inspection?.boards?.flatMap((board) =>
    board.rows.map((row) => ({ ...row, boardKey: board.key, boardTitle: board.title }))) ?? [];
  const selectedRows = rows.filter((row) => selectedShelve.includes(row.token));
  const activeSelected = selectedRows.filter(openStatus).length;
  const shown = mode === "shelve"
    ? rows.filter((row) => `${row.name} ${row.ownerCode} ${row.id} ${row.boardTitle}`.toLowerCase().includes(search.toLowerCase()))
    : (inspection?.archive ?? []).filter((item) =>
        `${item.project.name} ${item.id} ${item.board}`.toLowerCase().includes(search.toLowerCase()));
  const selected = mode === "shelve" ? selectedShelve : selectedRestore;
  const selectionCount = selectedShelve.length + selectedRestore.length;
  const canCopySnapshots = Boolean(bundle && canCopyProjectRecoverySnapshots(bundle.data?.world));
  const toggle = (id) => {
    const setter = mode === "shelve" ? setSelectedShelve : setSelectedRestore;
    setter((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  const doRecovery = async () => {
    if (!inspection || inspection.failure || working || !selectionCount) return;
    const activeWarning = activeSelected > 0
      ? `This will temporarily shelve ${activeSelected} ACTIVE project(s). They will NOT advance while shelved. `
      : "";
    const historyWarning = !canCopySnapshots
      ? "This older campaign requires a country-ownership migration. Its old restore points cannot safely be copied into the recovered game, and will remain in the ORIGINAL campaign only. "
      : "";
    if ((activeWarning || historyWarning) && !window.confirm(
      `${activeWarning}${historyWarning}The full project records will be preserved. The original campaign remains untouched. Create a recovered COPY?`,
    )) return;
    setWorking(true);
    setError("");
    try {
      const repaired = prepareProjectRecoveryBundle(bundle, {
        shelve: selectedShelve,
        restore: selectedRestore,
      });
      // The native owner migration discards old owner-code restore points on
      // first activation. Copy only when the world already has the current
      // owner schema; the incompatible source history stays with the original.
      const snapshots = canCopySnapshots ? await readGameSnapshotsText(game.id) : null;
      const imported = await importGameBundle(repaired);
      const newGameId = imported?.game?.id;
      if (!newGameId) throw new Error("Import did not return a recovered campaign ID.");
      setCreated({ id: newGameId, name: imported.game.name });
      try {
        // Full source history stays intact. Undoing to an old over-cap restore
        // point will require this same recovery flow again; never rewrite it.
        if (snapshots !== null) await writeGameSnapshotsText(newGameId, snapshots);
      } catch (reason) {
        setError(`Recovered copy created, but its restore points could not be copied: ${String(reason?.message || reason)}. The original campaign and restore points remain untouched.`);
        return;
      }
      setSelectedShelve([]);
      setSelectedRestore([]);
    } catch (reason) {
      setError(String(reason?.message || reason));
    } finally {
      setWorking(false);
    }
  };

  const boardCounts = inspection?.boards ?? [];
  const needs = inspection?.required ?? 0;
  const hasArchive = (inspection?.archive?.length ?? 0) > 0;

  return (
    <div role="presentation" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div role="dialog" aria-modal="true" aria-label="Recover Projects in a copied campaign" style={{ ...surface, color: "#eff1f6", width: "min(49rem, 100%)", maxHeight: "min(90vh, 850px)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.65)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>Recover Projects — {game.name}</div>
            <div style={small}>Save-owner maintenance · Creates a new game · Original remains untouched</div>
          </div>
          <button type="button" disabled={working} onClick={onClose} style={button} aria-label="Close Projects recovery">Close</button>
        </div>
        <div style={{ padding: "1rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          {loading && <div style={small}>Reading the complete campaign record…</div>}
          {inspection?.failure && <div style={banner}>Recovery cannot continue: {inspection.failure}. The source was not modified.</div>}
          {inspection && !inspection.failure && (
            <>
              <div style={banner}>
                {!canCopySnapshots && (
                  <div style={{ marginBottom: "0.5rem" }}>
                    Older owner-format campaign: restore points cannot safely be carried into the repaired copy. They stay in your original campaign.
                  </div>
                )}
                {needs > 0
                  ? `${needs} project(s) exceed the 120-entry live-board limit. Choose at least that many to shelve, in their respective boards. No project is chosen automatically.`
                  : "No board is over the live limit. You may restore previously shelved projects if enough slots are available, or shelve projects to free slots."}
                {" "}An active project stops progressing while shelved; restoring it does not retroactively simulate skipped days.
              </div>
              {boardCounts.map((board) => (
                <div key={board.key} style={small}>
                  <strong style={{ color: "#eff1f6" }}>{board.title}</strong> — {board.rows.length} live records, {board.excess} over limit
                  {mode === "shelve" && board.rows.some((row) => !row.open) && (
                    <button type="button" disabled={working} onClick={() => {
                      const closed = board.rows.filter((row) => !row.open).map((row) => row.token);
                      setSelectedShelve((current) => [...new Set([...current, ...closed])]);
                    }} style={{ ...button, marginLeft: "0.6rem", padding: "0.2rem 0.45rem" }}>Select closed</button>
                  )}
                </div>
              ))}
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" style={{ ...button, borderColor: mode === "shelve" ? "#6b90ba" : undefined }} onClick={() => { setMode("shelve"); setSearch(""); }}>Shelve from live boards</button>
                <button type="button" disabled={!hasArchive} style={{ ...button, borderColor: mode === "restore" ? "#6b90ba" : undefined }} onClick={() => { setMode("restore"); setSearch(""); }}>Restore shelved ({inspection.archive.length})</button>
              </div>
              <input aria-label="Filter projects" placeholder="Find by title, country or ID…" value={search} onChange={(event) => setSearch(event.target.value)} style={{ ...button, width: "100%", boxSizing: "border-box", cursor: "text" }}/>
              <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, maxHeight: "18rem", overflowY: "auto" }}>
                {shown.slice(0, 250).map((item) => {
                  const token = mode === "shelve" ? item.token : item.id;
                  const name = mode === "shelve" ? item.name : item.project?.name;
                  const status = mode === "shelve" ? item.status : item.priorStatus;
                  return (
                    <label key={token} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", padding: "0.55rem 0.75rem", borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: "pointer", fontSize: "0.8rem" }}>
                      <input type="checkbox" disabled={working} checked={selected.includes(token)} onChange={() => toggle(token)} />
                      <span style={{ flex: 1 }}><strong>{name || "Untitled project"}</strong>
                        <div style={small}>{mode === "shelve" ? item.boardTitle : item.board} · {item.ownerCode || item.project?.ownerCode || "Unspecified owner"} · {status || "unknown"} · {item.id}</div>
                      </span>
                    </label>
                  );
                })}
                {shown.length === 0 && <div style={{ ...small, padding: "0.8rem" }}>No matching projects.</div>}
                {shown.length > 250 && <div style={{ ...small, padding: "0.5rem" }}>Showing 250 matches. Filter to find additional projects.</div>}
              </div>
              <div style={small}>
                {selectedShelve.length} selected for shelving ({activeSelected} active); {selectedRestore.length} selected for restoration. On a full board, choose a live record to shelve and an archived record to restore in the same recovered copy.
                {" "}The original game and its history remain available. Old restore points may themselves contain oversized boards.
              </div>
            </>
          )}
          {created && <div style={{ ...banner, borderColor: "#3e936d", background: "rgba(55,155,101,0.12)" }}>Recovered game created: <strong>{created.name}</strong> ({created.id}). Find it in your Games library. The original game is unchanged.</div>}
          {error && <div role="alert" style={{ ...banner, borderColor: "#de7878", color: "#fbb" }}>{error}</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", borderTop: "1px solid rgba(255,255,255,0.12)", padding: "0.8rem 1rem" }}>
          <button type="button" disabled={working} onClick={onClose} style={button}>Close</button>
          <button type="button" disabled={loading || working || !inspection || inspection.failure || !selectionCount || Boolean(created)} onClick={doRecovery} style={{ ...button, background: "rgba(50,113,166,0.35)", borderColor: "rgba(86,158,223,0.6)" }}>
            {working ? "Creating recovered copy…" : "Create recovered copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
