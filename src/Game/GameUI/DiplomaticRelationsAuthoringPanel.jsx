/*! Open Historia - scenario bilateral relations authoring. AGPL-3.0-or-later. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  authoringCardStyle,
  authoringCardRow,
  authoringCardCopy,
  authoringTitleStyle,
  authoringDescriptionStyle,
  authoringMetaStyle,
  authoringButtonStyle,
  authoringInputStyle,
  authoringOptionStyle,
  authoringLabelStyle,
  authoringShellStyle,
  authoringHeaderStyle,
  authoringCloseStyle,
  authoringEyebrowStyle,
  authoringHeadingStyle,
  authoringSubheadingStyle,
  authoringSelectedStyle,
} from "./scenarioAuthoringStyles.js";
import { loadScenarioDetails, saveScenario } from "../../runtime/library.js";
import { collectActiveScenarioPolityKeys } from "../../runtime/scenarioPolities.js";
import { relationBandForScore } from "../../runtime/diplomaticStance.js";
import { confirmDialog } from "../../runtime/uiDialog.js";
import {
  MAX_STARTING_RELATIONS,
  MAX_STARTING_RELATION_SUMMARY,
  startingRelationOverview,
  planReviewedStartingRelationEdit,
} from "../../Editor/scenarioStartingRelations.js";

const choicesFor = (world) => collectActiveScenarioPolityKeys(world)
  .map((key) => ({
    ...world?.polityOverrides?.[key],
    key,
    name: world?.polityOverrides?.[key]?.name || key,
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

const panelStyle = authoringCardStyle;
const buttonStyle = authoringButtonStyle;
const inputStyle = { ...authoringInputStyle, textTransform: "none", letterSpacing: "normal", fontWeight: 400 };
const mutedStyle = { fontSize: "0.72rem", color: "var(--oh-grey-muted)", lineHeight: 1.5 };
const labelStyle = { ...authoringLabelStyle, display: "grid", gap: 6 };
const optionStyle = authoringOptionStyle;
const emptyDraft = () => ({ a: "", b: "", score: "", summary: "", expected: null });
const formatScore = (score) => (Number(score) > 0 ? `+${score}` : String(score ?? ""));

export default function DiplomaticRelationsAuthoringPanel({ details, onDetailsChange }) {
  const world = useMemo(() => details?.data?.world || {}, [details?.data?.world]);
  const scenarioId = details?.scenario?.id || "";
  const choices = useMemo(() => choicesFor(world), [world]);
  const names = new Map(choices.map((choice) => [choice.key, choice.name]));
  const rows = useMemo(() => startingRelationOverview(world.relations, choices), [world.relations, choices]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [draft, setDraft] = useState(emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const savingRef = useRef(false);
  const confirmingRef = useRef(false);
  const mountedRef = useRef(true);
  const scenarioIdRef = useRef(scenarioId);
  scenarioIdRef.current = scenarioId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset editing state whenever the selected scenario changes without remount.
  useEffect(() => {
    setQuery("");
    setCountry("");
    setDraft(emptyDraft());
    setDirty(false);
    setError("");
    setMessage("");
    if (dialogRef.current?.open) dialogRef.current.close();
    setOpen(false);
  }, [scenarioId]);

  useEffect(() => {
    if (open && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [open]);

  const confirmDiscard = async (expectedScenarioId) => {
    if (!dirty) return true;
    if (confirmingRef.current) return false;
    confirmingRef.current = true;
    try {
      const ok = await confirmDialog("Discard unsaved diplomatic relationship edits?");
      return ok && mountedRef.current && scenarioIdRef.current === expectedScenarioId;
    } finally {
      confirmingRef.current = false;
    }
  };

  const close = async () => {
    const targetScenarioId = scenarioIdRef.current;
    if (savingRef.current || !(await confirmDiscard(targetScenarioId))) return;
    if (!mountedRef.current || scenarioIdRef.current !== targetScenarioId) return;
    dialogRef.current?.close();
    setOpen(false);
    setDirty(false);
    setDraft(emptyDraft());
    setError("");
    setMessage("");
    triggerRef.current?.focus();
  };

  const selectItem = async (item) => {
    const targetScenarioId = scenarioIdRef.current;
    if (savingRef.current || !(await confirmDiscard(targetScenarioId))) return;
    if (!mountedRef.current || scenarioIdRef.current !== targetScenarioId) return;
    setDraft(
      item
        ? { a: item.a, b: item.b, score: String(item.row.score ?? ""), summary: String(item.row.summary ?? ""), expected: item.row }
        : emptyDraft(),
    );
    setDirty(false);
    setError("");
    setMessage("");
  };

  const patchDraft = (field, value) => {
    setDraft((old) => ({ ...old, [field]: value }));
    setDirty(true);
    setError("");
    setMessage("");
  };

  const refresh = async () => {
    if (!scenarioId || savingRef.current || !(await confirmDiscard(scenarioId))) return;
    if (!mountedRef.current || scenarioIdRef.current !== scenarioId) return;
    savingRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const loaded = await loadScenarioDetails(scenarioId);
      if (!mountedRef.current || scenarioIdRef.current !== scenarioId) return;
      onDetailsChange?.(loaded);
      setDraft(emptyDraft());
      setDirty(false);
    } catch (err) {
      if (mountedRef.current && scenarioIdRef.current === scenarioId) {
        setError(err.message || "Could not refresh diplomatic relations.");
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const save = async (remove = false) => {
    if (!scenarioId || savingRef.current || confirmingRef.current || !draft.a || !draft.b) return;
    if (remove && !draft.expected) return;
    if (remove) {
      confirmingRef.current = true;
      let confirmed = false;
      try {
        confirmed = await confirmDialog(
          "Unset this relationship? This removes its authored score and description, not treaties or wars.",
          { danger: true, confirmLabel: "Unset" },
        );
      } finally {
        confirmingRef.current = false;
      }
      if (!confirmed || !mountedRef.current || scenarioIdRef.current !== scenarioId) return;
    }
    savingRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const latest = await loadScenarioDetails(scenarioId);
      if (!mountedRef.current || scenarioIdRef.current !== scenarioId) return;
      const current = latest?.data?.world || {};
      const edit = {
        a: draft.a,
        b: draft.b,
        score: remove ? null : draft.score,
        ...(!remove && draft.summary !== String(draft.expected?.summary ?? "") ? { summary: draft.summary } : {}),
      };
      const plan = planReviewedStartingRelationEdit(current.relations, edit, draft.expected, choicesFor(current));
      if (!plan.ok) throw new Error(plan.reason);
      const updated = await saveScenario(scenarioId, { worldPatch: { relations: plan.relations } });
      if (!mountedRef.current || scenarioIdRef.current !== scenarioId) return;
      onDetailsChange?.(updated);
      setDraft(emptyDraft());
      setDirty(false);
      setMessage(remove ? "Relationship unset." : "Diplomatic relationship saved.");
    } catch (err) {
      if (mountedRef.current && scenarioIdRef.current === scenarioId) {
        setError(err.message || "Could not save diplomatic relationship.");
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const needle = query.trim().toLowerCase();
  const filtered = rows
    .filter((item) => (
      (!country || item.a === country || item.b === country)
      && (!needle || [names.get(item.a), names.get(item.b), item.a, item.b, item.row.summary, relationBandForScore(item.row.score)]
        .join(" ")
        .toLowerCase()
        .includes(needle))
    ))
    .sort((left, right) => (
      (names.get(left.a) || left.a).localeCompare(names.get(right.a) || right.a)
      || (names.get(left.b) || left.b).localeCompare(names.get(right.b) || right.b)
    ));

  const renderPolitySelect = (field, otherField) => (
    <select style={inputStyle} value={draft[field]} disabled={busy || Boolean(draft.expected)} onChange={(event) => patchDraft(field, event.target.value)}>
      <option value="" style={optionStyle}>Choose polity</option>
      {choices.filter((choice) => choice.key !== draft[otherField]).map((choice) => (
        <option key={choice.key} value={choice.key} style={optionStyle}>{choice.name}</option>
      ))}
    </select>
  );

  return (
    <section style={panelStyle}>
      <div style={authoringCardRow}>
        <div style={authoringCardCopy}>
          <div style={authoringTitleStyle}>Starting diplomatic relations</div>
          <div style={authoringDescriptionStyle}>Author the bilateral political climate and its historical context. Scores are shared with the Map Editor.</div>
          <div style={authoringMetaStyle}>{rows.length} / {MAX_STARTING_RELATIONS} authored relationships</div>
        </div>
        <button ref={triggerRef} type="button" style={{ ...buttonStyle, flex: "0 0 auto" }} onClick={() => { setOpen(true); setError(""); setMessage(""); }}>
          Manage Diplomatic Relations
        </button>
      </div>
      {open && createPortal(
        <dialog
          className="oh-scenario-authoring-dialog"
          ref={dialogRef}
          aria-label="Manage Diplomatic Relations"
          onCancel={(event) => {
            event.preventDefault();
            void close();
          }}
          style={{ ...authoringShellStyle, position: "fixed", inset: 0, margin: "auto", padding: 0, maxWidth: "calc(100vw - 1rem)" }}
        >
          <header style={authoringHeaderStyle}>
            <div>
              <div style={authoringEyebrowStyle}>Scenario authoring</div>
              <div style={authoringHeadingStyle}>Diplomatic Relations</div>
              <div style={authoringSubheadingStyle}>Starting bilateral scores and descriptions. Unset is unknown; explicit 0 is neutral. Separate from wars, treaties and subordination.</div>
            </div>
            <button type="button" style={authoringCloseStyle} onClick={() => void close()} disabled={busy} aria-label="Close diplomatic relations manager">×</button>
          </header>
          <div className="oh-scenario-relation-layout">
            <section className="oh-scenario-relation-list">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={buttonStyle} onClick={() => void selectItem(null)} disabled={busy}>+ Add relationship</button>
                <button type="button" style={buttonStyle} onClick={() => void refresh()} disabled={busy}>Refresh relations</button>
              </div>
              <label style={labelStyle}>
                Search relationships
                <input style={inputStyle} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search countries or descriptions" />
              </label>
              <label style={labelStyle}>
                Filter by polity
                <select style={inputStyle} value={country} onChange={(event) => setCountry(event.target.value)}>
                  <option value="" style={optionStyle}>All polities</option>
                  {choices.map((choice) => <option key={choice.key} value={choice.key} style={optionStyle}>{choice.name}</option>)}
                </select>
              </label>
              <div style={mutedStyle}>{filtered.length} of {rows.length} relationships</div>
              <div className="oh-scenario-relation-rows">
                {filtered.map((item) => (
                  <article
                    key={item.index}
                    style={{
                      border: "1px solid var(--oh-grey-border)",
                      background: "var(--oh-grey-surface)",
                      ...(item.row === draft.expected ? authoringSelectedStyle : {}),
                      borderRadius: 10,
                      padding: "0.65rem",
                      minWidth: 0,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 13, overflowWrap: "anywhere" }}>{names.get(item.a) || item.a} ↔ {names.get(item.b) || item.b}</strong>
                      <span style={{ fontSize: 12, fontWeight: 750 }}>{formatScore(item.row.score)} · {relationBandForScore(item.row.score)}</span>
                    </div>
                    {item.row.summary && <p style={{ ...mutedStyle, overflowWrap: "anywhere", margin: "5px 0" }}>{item.row.summary}</p>}
                    {item.editable
                      ? <button type="button" disabled={busy} style={{ ...buttonStyle, marginTop: 6 }} onClick={() => void selectItem(item)}>Edit relationship</button>
                      : <div style={mutedStyle}>Unresolved or conflicting identity - read only.</div>}
                  </article>
                ))}
                {!filtered.length && <div style={mutedStyle}>No matching authored relationships.</div>}
              </div>
            </section>
            <section className="oh-scenario-relation-detail">
              <div style={authoringTitleStyle}>{draft.expected ? "Edit relationship" : "Add relationship"}</div>
              <label style={labelStyle}><span>First polity</span>{renderPolitySelect("a", "b")}</label>
              <label style={labelStyle}><span>Second polity</span>{renderPolitySelect("b", "a")}</label>
              <label style={labelStyle}>
                Relationship score (-100 to +100)
                <input
                  type="number"
                  min="-100"
                  max="100"
                  step="1"
                  style={inputStyle}
                  value={draft.score}
                  disabled={busy}
                  onChange={(event) => patchDraft("score", event.target.value)}
                  placeholder="Enter a whole number"
                />
              </label>
              {draft.score.trim() !== "" && Number.isInteger(Number(draft.score)) && Math.abs(Number(draft.score)) <= 100 && (
                <div style={mutedStyle}>Diplomatic climate: <strong>{relationBandForScore(Number(draft.score))}</strong></div>
              )}
              <label style={labelStyle}>
                Diplomatic description
                <textarea
                  style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                  rows={5}
                  value={draft.summary}
                  disabled={busy}
                  onChange={(event) => patchDraft("summary", event.target.value)}
                  placeholder="Historical context, grievances or reasons for cooperation"
                />
              </label>
              <div style={mutedStyle}>{draft.summary.length} / {MAX_STARTING_RELATION_SUMMARY} characters for new descriptions. The description becomes native diplomatic context for the simulation.</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={buttonStyle} disabled={busy || !draft.a || !draft.b || !draft.score.trim()} onClick={() => void save()}>Save relationship</button>
                {draft.expected && <button type="button" style={buttonStyle} disabled={busy} onClick={() => void save(true)}>Unset relationship</button>}
                <button type="button" style={buttonStyle} disabled={busy} onClick={() => void selectItem(null)}>Cancel edits</button>
              </div>
              {error && <div role="alert" style={{ color: "var(--oh-ui-danger, #dc2626)", fontSize: 12 }}>{error}</div>}
              {message && <div role="status" style={{ fontSize: 12, color: "var(--oh-grey-text)" }}>{message}</div>}
              {busy && <div role="status" style={mutedStyle}>Saving or refreshing relations...</div>}
            </section>
          </div>
        </dialog>,
        document.body,
      )}
    </section>
  );
}
