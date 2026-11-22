/*! Open Historia - Projects financing review and ledger. AGPL-3.0-or-later. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { captureFinanceReview, commitFinanceReview } from "../../runtime/projectFinanceReview.js";
import { financeLenderOptions, financeSourceText } from "../../runtime/projectFinanceWorld.js";
import { projectFinanceSnapshot, projectFinanceDrawAmount } from "../../runtime/projectFinance.js";
import { projectOwnerOf, ownerMeans } from "../../runtime/projectEngine.js";
import { isProjectOpen, isBelief } from "../../runtime/projects.js";
import { formatEconomicDisplayValue } from "../../runtime/economicDisplayCurrency.js";
import { compareGameDates, addGameDays } from "../../runtime/gameDates.js";
import { reviewRecordedLoan } from "../AI/projectFinanceReview.js";
import { uiString } from "../../runtime/translator.js";
import { APP_HEIGHT, SAFE_TOP, SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT } from "../../runtime/mobileUi.js";

const fieldStyle = {
  border: "1px solid var(--oh-ui-line, #394653)",
  background: "var(--oh-ui-overlay-card, #202c38)",
  borderRadius: 8,
  color: "inherit",
  padding: "0.55rem 0.7rem",
  font: "inherit",
  minWidth: 0,
  width: "100%",
  boxSizing: "border-box",
};
const buttonStyle = { ...fieldStyle, width: "auto", cursor: "pointer", fontWeight: 700, minHeight: "2.35rem" };
const mutedStyle = { color: "var(--oh-ui-muted, #a9b6c5)", fontSize: "0.78rem", lineHeight: 1.5 };
const cardStyle = {
  border: "1px solid var(--oh-ui-line, #394653)",
  borderRadius: 10,
  padding: "0.85rem",
  display: "grid",
  gap: "0.65rem",
  background: "var(--oh-ui-overlay-card, #182530)",
};
const flexStyle = { display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" };
const gridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 205px), 1fr))", gap: "0.7rem" };

const BLANK_FORM = {
  sourceId: "",
  lenderKey: "",
  currency: "",
  minorDigits: "2",
  originalLimit: "",
  limit: "",
  basis: "",
  rate: "",
  maturity: "",
  projectIds: [],
  projectId: "",
  originalDraw: "",
  supplier: "",
  payment: "cash",
  debtTreatment: "",
  amount: "",
  bucketId: "",
};

const parseMinorInput = (text, digits = 2, allowZero = false) => {
  if (!Number.isInteger(digits) || digits < 0 || digits > 6 || typeof text !== "string" || text.length > 40 || !/^\d+(?:\.\d+)?$/.test(text.trim())) {
    throw new Error("Enter an exact decimal amount without thousands separators.");
  }
  const [whole, fraction = ""] = text.trim().split(".");
  if (fraction.length > digits) {
    throw new Error("The amount has too many decimal places for the selected denomination.");
  }
  const value = Number(BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0"));
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && !value)) {
    throw new Error("Enter a positive amount within the accounting range.");
  }
  return value;
};

const formatMajorUnits = (minorValue, digits = 2) => {
  const padded = String(minorValue).padStart(digits + 1, "0");
  return digits ? `${padded.slice(0, -digits)}.${padded.slice(-digits)}` : padded;
};

const encodeLenderKey = (kind, id) => `${kind}:${id}`;
const decodeLenderKey = (key) => {
  const separator = String(key ?? "").indexOf(":");
  if (separator <= 0) return { lenderKind: "polity", lenderId: "" };
  return { lenderKind: key.slice(0, separator), lenderId: key.slice(separator + 1) };
};

const FieldLabel = ({ name, children }) => (
  <label style={{ display: "grid", gap: 4, fontSize: "0.79rem", minWidth: 0 }}>
    <span>{uiString(name)}</span>
    {children}
  </label>
);

export const ProjectFinancePanel = ({ displayCurrency, onClose }) => {
  const dialogRef = useRef(null);
  const mountedRef = useRef(false);
  const abortRef = useRef(null);
  const committingRef = useRef(false);

  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState("list");
  const [facilityId, setFacilityId] = useState("");
  const [form, setForm] = useState(BLANK_FORM);
  const [query, setQuery] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [draft, setDraft] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [stale, setStale] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setStatus("");
    setStale(false);
    setConfirmed(false);
    try {
      const data = await captureFinanceReview();
      if (mountedRef.current) setReview(data);
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setReview(null);
        setStatus(error?.message || "Unable to load financing record.");
      }
      return false;
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  useEffect(() => {
    const dialogElement = dialogRef.current;
    mountedRef.current = true;
    dialogElement?.showModal();
    void refresh();
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (dialogElement?.open) dialogElement.close();
    };
  }, []);

  useEffect(() => {
    const invalidate = () => {
      if (!committingRef.current) {
        setStale(true);
        setConfirmed(false);
        abortRef.current?.abort();
      }
    };
    const close = () => onClose();
    const events = ["oh:runtime-json-updated", "oh:rolled-back", "oh:unseen-events-changed"];
    for (const eventName of events) window.addEventListener(eventName, invalidate);
    window.addEventListener("oh:active-game-changed", close);
    return () => {
      for (const eventName of events) window.removeEventListener(eventName, invalidate);
      window.removeEventListener("oh:active-game-changed", close);
    };
  }, [onClose]);

  const facilities = useMemo(
    () => (review ? projectFinanceSnapshot(review.world.projectFinance, review.game.gameDate).filter((entry) => entry.terms.borrower === review.actor) : []),
    [review],
  );

  const projects = useMemo(
    () => (review
      ? (review.world.projects ?? []).filter(
        (project) => projectOwnerOf(project, review.actor) === review.actor && isProjectOpen(project) && !isBelief(project) && project.plan?.monthlyCost > 0,
      )
      : []),
    [review],
  );

  const lenderOptions = useMemo(() => {
    if (!review) return [];
    const { polities, institutions } = financeLenderOptions(review.world, review.actor);
    return [
      ...polities.map((row) => ({ key: encodeLenderKey("polity", row.id), id: row.id, name: row.label, label: row.label })),
      ...institutions.map((row) => ({ key: encodeLenderKey("institution", row.id), id: row.id, name: row.label, label: `${row.label} (Institution)` })),
    ];
  }, [review]);

  const lenderLabelOf = (terms) => {
    if (terms.lenderKind === "institution") {
      const match = lenderOptions.find((entry) => entry.key === encodeLenderKey("institution", terms.lenderId));
      if (match?.label) return match.label;
      const institutionsById = review?.world?.institutions?.byId ?? review?.world?.institutions ?? {};
      const label = String(institutionsById?.[terms.lenderId]?.name ?? "").trim();
      return label ? `${label} (Institution)` : terms.lenderId;
    }
    return review?.world?.polityOverrides?.[terms.lenderId]?.name || terms.lenderId;
  };

  const activeFacility = facilities.find((entry) => entry.terms.facilityId === facilityId);
  const sourceEvent = review?.events.find((event) => event.id === form.sourceId);
  const needsSource = ["authorize", "draw", "return"].includes(mode);

  const sourceRows = useMemo(
    () => (review
      ? [...review.events]
        .filter((event) => !query || `${event.title} ${event.description}`.toLowerCase().includes(query.toLowerCase()))
        .sort((left, right) => compareGameDates(right.date, left.date))
      : []),
    [review, query],
  );

  const updateField = (key, value) => {
    // Do not leave extracted values from a different source in a new review.
    if (key === "sourceId") {
      setDraft(null);
      setForm((old) => ({
        ...old,
        ...(mode === "authorize"
          ? { lenderKey: "", currency: "", minorDigits: "2", originalLimit: "", limit: "", basis: "", rate: "", maturity: "" }
          : mode === "draw"
            ? { originalDraw: "", supplier: "", payment: "cash", debtTreatment: "" }
            : {}),
        sourceId: value,
      }));
    } else {
      setForm((old) => ({ ...old, [key]: value }));
    }
    setConfirmed(false);
    setStatus("");
  };

  const switchMode = (nextMode, facility = null, bucket = null) => {
    setMode(nextMode);
    setFacilityId(facility?.terms.facilityId || "");
    setQuery("");
    setDraft(null);
    setConfirmed(false);
    setStatus("");
    setForm({
      ...BLANK_FORM,
      ...(facility
        ? {
          sourceId: nextMode === "draw" ? facility.terms.sourceEventId : "",
          projectId: facility.terms.projectIds.length === 1 ? facility.terms.projectIds[0] : "",
        }
        : {}),
      bucketId: bucket?.id || "",
    });
  };

  const amountDisplay = (minorValue) => formatEconomicDisplayValue(minorValue / 100, displayCurrency, { compact: false });
  const canonicalDisplay = (minorValue) => `$${(minorValue / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const projectName = (projectId) => review?.world.projects?.find((project) => project.id === projectId)?.name || projectId;

  const drawPreview = () => {
    if (!activeFacility || mode !== "draw") return null;
    try {
      return projectFinanceDrawAmount(activeFacility, parseMinorInput(form.originalDraw, activeFacility.terms.minorDigits));
    } catch {
      return null;
    }
  };

  const extractTerms = async () => {
    if (!sourceEvent || aiBusy || stale || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setAiBusy(true);
    setStatus("");
    setConfirmed(false);
    try {
      const extracted = await reviewRecordedLoan(sourceEvent, { signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return;
      setDraft(extracted);
      const extractedLender = String(extracted.lender ?? "").trim().toLowerCase();
      const matchedLender = extractedLender
        ? lenderOptions.find((entry) => (
          entry.id.toLowerCase() === extractedLender
          || entry.name.toLowerCase() === extractedLender
          || entry.label.toLowerCase() === extractedLender
        ))
        : null;
      setForm((old) => ({
        ...old,
        ...(mode === "authorize"
          ? {
            lenderKey: matchedLender ? matchedLender.key : old.lenderKey,
            currency: extracted.currency || old.currency,
            originalLimit: extracted.originalLimit || old.originalLimit,
            rate: extracted.annualRate || old.rate,
            maturity: extracted.maturity || old.maturity,
          }
          : {
            supplier: extracted.supplier || old.supplier,
            payment: extracted.supplier ? "supplier" : old.payment,
          }),
      }));
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted) setStatus(error?.message || "Extraction failed.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current) setAiBusy(false);
    }
  };

  const commit = async () => {
    if (!review || stale || busy || aiBusy || !confirmed || committingRef.current) return;
    try {
      const evidence = sourceEvent ? { sourceId: sourceEvent.id, expectedSource: financeSourceText(sourceEvent) } : {};
      let command = { type: mode, confirmed: true, ...evidence };
      if (needsSource && !sourceEvent) throw new Error("Select the recorded agreement or disbursement event.");

      if (mode === "authorize") {
        const digits = form.minorDigits.trim() === "" ? NaN : Number(form.minorDigits);
        const { lenderKind, lenderId } = decodeLenderKey(form.lenderKey);
        command = {
          ...command,
          lenderKind,
          lenderId,
          projectIds: form.projectIds,
          currency: form.currency.trim(),
          minorDigits: digits,
          originalLimitMinor: parseMinorInput(form.originalLimit, digits),
          limitMinor: parseMinorInput(form.limit),
          equivalenceBasis: form.basis.trim(),
          annualRateBps: parseMinorInput(form.rate, 2, true),
          maturity: form.maturity,
        };
      } else if (mode === "draw") {
        if (!activeFacility) throw new Error("Select a facility.");
        const originalMinor = parseMinorInput(form.originalDraw, activeFacility.terms.minorDigits);
        command = {
          ...command,
          facilityId,
          projectId: form.projectId || null,
          originalMinor,
          amountMinor: projectFinanceDrawAmount(activeFacility, originalMinor),
          supplierId: form.payment === "supplier" ? form.supplier.trim() : null,
          debtTreatment: form.debtTreatment,
        };
      } else {
        if (!activeFacility) throw new Error("Select a facility.");
        command = {
          ...command,
          id: `finance:${crypto.randomUUID()}`,
          facilityId,
          bucketId: form.bucketId,
          amountMinor: parseMinorInput(form.amount),
        };
        if (mode === "allocate") command.projectId = form.projectId;
      }

      committingRef.current = true;
      setBusy(true);
      setStatus("");
      await commitFinanceReview(review, command);
      if (mountedRef.current) {
        setMode("list");
        setForm(BLANK_FORM);
        const refreshed = await refresh();
        if (mountedRef.current && refreshed) {
          setStatus("Financing record saved.");
        }
      }
    } catch (error) {
      if (mountedRef.current) setStatus(error?.message || "Unable to save financing record.");
    } finally {
      committingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const renderInput = (key, placeholder = "", props = {}) => (
    <input
      style={fieldStyle}
      value={form[key]}
      placeholder={placeholder}
      disabled={busy || aiBusy}
      onChange={(event) => updateField(key, event.target.value)}
      {...props}
    />
  );

  const renderSelect = (key, choices, emptyLabel) => (
    <select
      style={fieldStyle}
      value={form[key]}
      disabled={busy || aiBusy}
      onChange={(event) => updateField(key, event.target.value)}
    >
      <option value="">{uiString(emptyLabel)}</option>
      {choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  );

  const mayEdit = Boolean(review && !stale && !busy && !aiBusy);
  const means = review ? ownerMeans(review.world, review.actor, review.world.projects, review.actor) : null;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-label="Project Finance"
      onCancel={(event) => {
        event.preventDefault();
        if (!committingRef.current) onClose();
      }}
      style={{
        border: "1px solid var(--oh-ui-line, #394653)",
        borderRadius: 14,
        background: "var(--oh-ui-panel, #14202d)",
        color: "var(--oh-ui-text, #f1f5f9)",
        position: "fixed",
        inset: 0,
        margin: "auto",
        width: "51.25rem",
        maxWidth: `calc(100vw - 1.5rem - ${SAFE_LEFT} - ${SAFE_RIGHT})`,
        maxHeight: `calc(${APP_HEIGHT} - 1.5rem - ${SAFE_TOP} - ${SAFE_BOTTOM})`,
        padding: 0,
        overflow: "auto",
        boxShadow: "0 24px 80px #0008",
        fontFamily: "inherit",
      }}
    >
      <style>{'dialog[aria-label="Project Finance"]::backdrop { background: rgba(0,0,0,.66); }'}</style>
      <header
        style={{
          ...flexStyle,
          position: "sticky",
          top: 0,
          zIndex: 2,
          background: "var(--oh-ui-panel, #14202d)",
          borderBottom: "1px solid var(--oh-ui-line, #394653)",
          padding: "0.9rem 1.1rem",
          justifyContent: "space-between",
        }}
      >
        <div>
          <strong style={{ fontSize: "1.1rem" }}>Project Finance</strong>
          <div style={mutedStyle}>Recorded agreements, finite funds and debt service</div>
        </div>
        <button style={buttonStyle} disabled={committingRef.current} onClick={onClose}>Close</button>
      </header>

      <main style={{ padding: "1rem 1.1rem", display: "grid", gap: "0.85rem", fontSize: "0.88rem" }}>
        {busy && !review && <div role="status">Loading financing record...</div>}
        {status && (
          <div role="status" style={{ ...mutedStyle, border: "1px solid var(--oh-ui-line, #394653)", borderRadius: 8, padding: "0.65rem" }}>
            {status}
          </div>
        )}
        {stale && (
          <div style={cardStyle}>
            <strong>Campaign changed</strong>
            <span style={mutedStyle}>Refresh before confirming any financial record.</span>
            <button style={buttonStyle} disabled={busy || aiBusy} onClick={async () => { switchMode("list"); await refresh(); }}>
              Refresh record
            </button>
          </div>
        )}
        {!review && !busy && <button style={buttonStyle} onClick={refresh}>Refresh record</button>}

        {review && mode === "list" && (
          <>
            <div style={gridStyle}>
              <div style={cardStyle}>
                <span style={mutedStyle}>Estimated recurring allowance / month</span>
                <strong>{means?.budget == null ? "Not assessed" : amountDisplay(Math.round(means.budget * 100))}</strong>
              </div>
              <div style={cardStyle}>
                <span style={mutedStyle}>Outstanding tracked loan principal</span>
                <strong>{amountDisplay(facilities.reduce((sum, entry) => sum + entry.outstandingMinor, 0))}</strong>
              </div>
            </div>
            <div style={mutedStyle}>
              Loan proceeds are a finite stock, not an increase to the monthly allowance. At maturity, recorded interest and principal are serviced from the authorized project allowance. Shortfalls remain arrears. Only recorded agreements may be booked; negotiations alone do not create funds. Completion estimates are withheld while finite funding or debt service can change the pace. Campaigns with finance records cannot be hosted as shared games yet.
            </div>
            {facilities.map((facility) => (
              <section style={cardStyle} key={facility.terms.facilityId}>
                <div style={{ ...flexStyle, justifyContent: "space-between" }}>
                  <strong>{lenderLabelOf(facility.terms)}</strong>
                  <span style={mutedStyle}>{facility.drawnMinor ? "Disbursed" : "Signed, undrawn"}</span>
                </div>
                <div>
                  <strong data-no-translate>{formatMajorUnits(facility.terms.originalLimitMinor, facility.terms.minorDigits)} {facility.terms.currency}</strong>
                  <div style={mutedStyle}>Original contractual denomination</div>
                </div>
                <div style={gridStyle}>
                  {[
                    ["Authorized equivalent", amountDisplay(facility.terms.limitMinor)],
                    ["Undrawn credit", amountDisplay(facility.undrawnMinor)],
                    ["Remaining project funds", amountDisplay(facility.remainingMinor)],
                    ["Applied to eligible costs", amountDisplay(facility.costAppliedMinor)],
                    ["Principal outstanding", amountDisplay(facility.outstandingMinor)],
                    ["Accrued interest", amountDisplay(facility.interestDueMinor)],
                    ["Principal repaid", amountDisplay(facility.principalPaidMinor)],
                    ["Interest paid", amountDisplay(facility.interestPaidMinor)],
                    ["Principal and interest arrears", amountDisplay(facility.arrearsPrincipalMinor + facility.arrearsInterestMinor)],
                    ["Maturity", facility.terms.maturity],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div style={mutedStyle}>{label}</div>
                      <strong data-no-translate>{value}</strong>
                    </div>
                  ))}
                </div>
                <div style={mutedStyle}>
                  Annual interest: {facility.terms.annualRateBps / 100}% · Actual/365 · Single maturity. Source: {review.events.find((event) => event.id === facility.terms.sourceEventId)?.title || facility.terms.sourceEventId}
                </div>
                <div style={mutedStyle}>Eligible projects: {facility.terms.projectIds.map(projectName).join(", ")}</div>
                {facility.buckets.filter((bucket) => bucket.remainingMinor > 0).map((bucket) => (
                  <div key={bucket.id} style={{ ...cardStyle, padding: "0.6rem" }}>
                    <div style={flexStyle}>
                      <strong>{amountDisplay(bucket.remainingMinor)}</strong>
                      <span style={mutedStyle}>
                        {bucket.supplierId ? `Supplier prepayment: ${bucket.supplierId}` : bucket.projectId ? "Earmarked cash" : "Unallocated cash"}
                      </span>
                    </div>
                    <div style={mutedStyle}>
                      {bucket.projectId ? projectName(bucket.projectId) : "Not assigned to a project"} · Eligible from {bucket.eligibleFrom}
                    </div>
                    {!bucket.supplierId && (
                      <div style={flexStyle}>
                        {bucket.projectId
                          ? <button style={buttonStyle} disabled={!mayEdit} onClick={() => switchMode("release", facility, bucket)}>Release earmark</button>
                          : (
                            <>
                              <button style={buttonStyle} disabled={!mayEdit} onClick={() => switchMode("allocate", facility, bucket)}>Allocate funds</button>
                              <button style={buttonStyle} disabled={!mayEdit} onClick={() => switchMode("return", facility, bucket)}>Record returned funds</button>
                            </>
                          )}
                      </div>
                    )}
                  </div>
                ))}
                {facility.undrawnMinor > 0 && compareGameDates(review.game.gameDate, facility.terms.maturity) < 0 && (
                  <div>
                    <button style={buttonStyle} disabled={!mayEdit} onClick={() => switchMode("draw", facility)}>
                      Review disbursement
                    </button>
                  </div>
                )}
                <details style={mutedStyle}>
                  <summary>Accounting basis and receipt history</summary>
                  <p>{facility.terms.equivalenceBasis}</p>
                  {review.world.projectFinance.receipts
                    .filter((receipt) => receipt.facilityId === facility.terms.facilityId)
                    .slice(-30)
                    .map((receipt) => (
                      <div key={receipt.id} data-no-translate>
                        {receipt.date} · {receipt.type} · {receipt.amountMinor
                          ? canonicalDisplay(receipt.amountMinor)
                          : receipt.type === "service"
                            ? canonicalDisplay(receipt.interestMinor + receipt.principalMinor)
                            : receipt.sourceEventId || ""}
                      </div>
                    ))}
                  <span>Showing up to 30 latest receipts; all are retained in the save.</span>
                </details>
              </section>
            ))}
            {!facilities.length && (
              <div style={cardStyle}>
                <strong>No recorded facilities</strong>
                <span style={mutedStyle}>Select a completed loan agreement from your campaign's events and review its exact terms. Unknown amounts must remain unbooked.</span>
              </div>
            )}
            <button style={buttonStyle} disabled={!mayEdit || !projects.length} onClick={() => switchMode("authorize")}>
              Review signed agreement
            </button>
          </>
        )}

        {review && mode !== "list" && (
          <>
            <div style={flexStyle}>
              <button style={buttonStyle} disabled={busy || aiBusy} onClick={() => switchMode("list")}>Back to financing</button>
              <strong>
                {({
                  authorize: "Signed agreement",
                  draw: "Actual disbursement",
                  allocate: "Allocate funds",
                  release: "Release earmark",
                  return: "Return unallocated funds",
                })[mode]}
              </strong>
            </div>

            {needsSource && (
              <section style={cardStyle}>
                <FieldLabel name="Find recorded source">
                  <input
                    style={fieldStyle}
                    value={query}
                    disabled={busy || aiBusy}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search recorded event titles or text..."
                  />
                </FieldLabel>
                <FieldLabel name="Source event">
                  {renderSelect(
                    "sourceId",
                    [
                      ...(sourceEvent && !sourceRows.some((event) => event.id === sourceEvent.id)
                        ? [[sourceEvent.id, `${sourceEvent.date} - ${sourceEvent.title}`]]
                        : []),
                      ...sourceRows.map((event) => [event.id, `${event.date} - ${event.title}`]),
                    ],
                    "Select source event",
                  )}
                </FieldLabel>
                {sourceEvent && (
                  <div style={{ ...mutedStyle, whiteSpace: "pre-wrap", maxHeight: "12rem", overflowY: "auto", overflowWrap: "anywhere" }} data-no-translate>
                    {sourceEvent.description}
                  </div>
                )}
                {sourceEvent && mode !== "return" && (
                  <div style={flexStyle}>
                    <button style={buttonStyle} disabled={!mayEdit} onClick={extractTerms}>Extract recorded terms with AI</button>
                    {aiBusy && <button style={buttonStyle} onClick={() => abortRef.current?.abort()}>Cancel</button>}
                    <span style={mutedStyle}>Optional provider request. Draft only; no money is booked.</span>
                  </div>
                )}
                {draft && (
                  <div style={mutedStyle}>
                    Review draft against source. {draft.evidence
                      ? (
                        <>
                          <div data-no-translate>{draft.evidence}</div>
                          <div data-no-translate>{draft.conditions}</div>
                        </>
                      )
                      : "No verifiable loan terms extracted."}
                    {" "}
                    {mode === "draw" && (draft.originalDraw
                      ? <div>AI-suggested original amount: <strong data-no-translate>{draft.originalDraw}</strong>. Enter it only if the source explicitly records that payment.</div>
                      : <strong>Tranche amount not established; do not estimate it.</strong>)}
                  </div>
                )}
              </section>
            )}

            {mode === "authorize" && (
              <section style={cardStyle}>
                <div style={gridStyle}>
                  <FieldLabel name="Registered lender">
                    {renderSelect("lenderKey", lenderOptions.map((entry) => [entry.key, entry.label]), "Select foreign lender")}
                  </FieldLabel>
                  <FieldLabel name="Contract currency">{renderInput("currency", "e.g. Bulgarian lev")}</FieldLabel>
                  <FieldLabel name="Contract decimal places">{renderInput("minorDigits", "2", { type: "number", min: 0, max: 6, step: 1 })}</FieldLabel>
                  <FieldLabel name="Signed credit limit (original currency)">{renderInput("originalLimit", "Exact recorded amount", { inputMode: "decimal" })}</FieldLabel>
                  <FieldLabel name="Canonical equivalent (constant 2026 USD)">{renderInput("limit", "Independently assessed equivalent", { inputMode: "decimal" })}</FieldLabel>
                  <FieldLabel name="Annual interest (%)">{renderInput("rate", "Exact annual percentage", { inputMode: "decimal" })}</FieldLabel>
                  <FieldLabel name="Maturity (game date)">{renderInput("maturity", "YYYY-MM-DD")}</FieldLabel>
                </div>
                <FieldLabel name="Basis of the agreed accounting equivalent">
                  <textarea
                    style={{ ...fieldStyle, minHeight: 64 }}
                    value={form.basis}
                    disabled={busy || aiBusy}
                    onChange={(event) => updateField("basis", event.target.value)}
                    placeholder="Record the evidence or approved valuation basis; display currency is not historical FX."
                  />
                </FieldLabel>
                <div style={mutedStyle}>Restricted eligible projects</div>
                {projects.map((project) => (
                  <label key={project.id} style={flexStyle}>
                    <input
                      type="checkbox"
                      checked={form.projectIds.includes(project.id)}
                      disabled={busy || aiBusy}
                      onChange={(event) => updateField(
                        "projectIds",
                        event.target.checked
                          ? [...form.projectIds, project.id]
                          : form.projectIds.filter((id) => id !== project.id),
                      )}
                    />
                    <span>{project.name}</span>
                  </label>
                ))}
                <div style={mutedStyle}>
                  This records a non-revolving signed limit only. It does not add funds or debt. Authorizing the facility also authorizes service from the recurring project allowance at its stated maturity. Installment/refinancing contracts require separate review and are not supported yet.
                </div>
              </section>
            )}

            {mode === "draw" && activeFacility && (
              <section style={cardStyle}>
                <div style={mutedStyle}>
                  Undrawn credit: {amountDisplay(activeFacility.undrawnMinor)} · Contract denomination: {activeFacility.terms.currency}
                </div>
                <FieldLabel name="Actual disbursed amount (original currency)">
                  {renderInput("originalDraw", "Exact recorded tranche", { inputMode: "decimal" })}
                </FieldLabel>
                <FieldLabel name="Payment route">
                  {renderSelect("payment", [["cash", "Cash proceeds"], ["supplier", "Direct supplier prepayment"]], "Select payment route")}
                </FieldLabel>
                {form.payment === "supplier" && (
                  <FieldLabel name="Recorded supplier">{renderInput("supplier", "Contract supplier designation")}</FieldLabel>
                )}
                <FieldLabel name="Earmark">
                  {renderSelect(
                    "projectId",
                    projects.filter((project) => activeFacility.terms.projectIds.includes(project.id)).map((project) => [project.id, project.name]),
                    "Unallocated cash (not automatically spent)",
                  )}
                </FieldLabel>
                <div style={mutedStyle}>
                  Canonical accounting payment: <strong>{drawPreview() === null ? "Not established" : canonicalDisplay(drawPreview())}</strong> · Eligible from {addGameDays(review.game.gameDate, 1)}
                </div>
                <FieldLabel name="Debt treatment">
                  {renderSelect(
                    "debtTreatment",
                    [
                      ["alreadyIncluded", "Already included in recorded national debt (reconcile only)"],
                      ["additional", "Not included in recorded national debt (add once)"],
                    ],
                    "Confirm reconciliation treatment",
                  )}
                </FieldLabel>
                <div style={mutedStyle}>
                  Current aggregate national debt: {review.world.countryStats?.[review.actor]?.economy?.publicDebt ?? "Not assessed"}% of GDP. Confirm the source establishes both the actual transfer and the chosen payment route and project. A supplier prepayment cannot be withdrawn as cash.
                </div>
              </section>
            )}

            {["allocate", "release", "return"].includes(mode) && activeFacility && (
              <section style={cardStyle}>
                <div style={mutedStyle}>
                  Available in selected bucket: {amountDisplay(activeFacility.buckets.find((bucket) => bucket.id === form.bucketId)?.remainingMinor || 0)}
                </div>
                <FieldLabel name="Accounting amount (constant 2026 USD)">
                  {renderInput("amount", "Exact amount", { inputMode: "decimal" })}
                </FieldLabel>
                {mode === "allocate" && (
                  <FieldLabel name="Eligible project">
                    {renderSelect(
                      "projectId",
                      projects.filter((project) => activeFacility.terms.projectIds.includes(project.id)).map((project) => [project.id, project.name]),
                      "Select project",
                    )}
                  </FieldLabel>
                )}
                {mode === "return" && (
                  <div style={mutedStyle}>
                    Return records an actual confirmed refund to the lender and reduces outstanding principal. It does not reopen the non-revolving credit limit.
                  </div>
                )}
              </section>
            )}

            <label style={{ ...flexStyle, alignItems: "flex-start" }}>
              <input type="checkbox" disabled={!mayEdit} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span style={{ flex: 1 }}>
                {needsSource
                  ? "I confirm the recorded source establishes consent and the exact terms or actual payment specified here. I authorize this accounting record for my government."
                  : "I authorize this exact allocation change for my government."}
              </span>
            </label>
            <button
              style={{ ...buttonStyle, fontWeight: 800 }}
              disabled={!mayEdit || !confirmed || (needsSource && !sourceEvent)}
              onClick={commit}
            >
              {busy ? "Saving..." : "Confirm financing record"}
            </button>
          </>
        )}
      </main>
    </dialog>,
    document.body,
  );
};
