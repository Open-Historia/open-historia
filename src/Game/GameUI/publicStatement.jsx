/*! Open Historia - inline official public statement review. AGPL-3.0-or-later. */
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { capturePublicReview, commitPublicReview, cancelPublicReview } from "../../runtime/publicPublication.js";
import {
  normalizePublicDraft,
  publicationId,
  publicIssuerOptions,
  publicAudienceOptions,
  normalizePublicStatement,
  canCancelPublicStatement,
  PUBLICATION_MAX_BODY,
} from "../../runtime/publicCommunications.js";
import { getLibraryState } from "../../runtime/library.js";
import { isSharedMultiplayerSession, subscribeSharedGameRole } from "../../multiplayer/client/sharedGameBridge.js";
import { uiString } from "../../runtime/translator.js";

const AUDIENCE_LABELS = {
  domestic: "Domestic public",
  "foreign-public": "Foreign population",
  worldwide: "International community",
  institution: "International institution",
};

const audienceLabelFor = (draft, options) => {
  const { kind, target } = draft.audience;
  if (kind === "foreign-public") {
    return `People of ${options.polities.find((polity) => polity.id === target)?.label || target}`;
  }
  if (kind === "institution") {
    return options.institutions.find((inst) => inst.id === target)?.label || target;
  }
  return uiString(AUDIENCE_LABELS[kind] || kind);
};

const Megaphone = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9v6h4l12 5V4L7 9H3Z" />
    <path d="m7 15 2 6m12-11v4" />
  </svg>
);

export const PublicStatementCard = ({ draft: original, threadId, replyId, index, onDiscuss }) => {
  const [draft, setDraft] = useState(original);
  const [editing, setEditing] = useState(false);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [done, setDone] = useState(false);
  const sharedSession = useSyncExternalStore(subscribeSharedGameRole, isSharedMultiplayerSession, () => false);
  const [withdrawArmed, setWithdrawArmed] = useState(false);

  const workingRef = useRef(false);
  const revisionRef = useRef(0);
  const id = replyId ? `${replyId}:public:${index}` : "";

  const world = useRuntimeState("world", (value) => value);
  const game = useRuntimeState("game", (value) => value);
  const receipt = useRuntimeState(
    "events",
    (events) => (Array.isArray(events) ? events.find((event) => event.id === publicationId(id)) : null),
    id,
  );
  const approved = normalizePublicStatement(receipt);
  const cancelled = world?.cancelledPublicDrafts?.includes(id);
  const cancellable = !cancelled && (!approved || canCancelPublicStatement(receipt, world, game));

  const options = useMemo(() => publicAudienceOptions(world), [world]);
  const offices = useMemo(() => publicIssuerOptions(world, game), [world, game]);
  const selectedId = draft.issuerId || offices.defaultIssuerId;
  const issuer = offices.issuers.find((entry) => entry.id === selectedId);
  const { kind } = draft.audience;
  const targeted = kind === "foreign-public" || kind === "institution";
  const choices = kind === "institution"
    ? options.institutions
    : options.polities.filter((polity) => polity.id !== offices.polity);
  const valid = Boolean(
    normalizePublicDraft(draft)
    && issuer
    && (!targeted || choices.some((choice) => choice.id === draft.audience.target)),
  );
  const audience = audienceLabelFor(draft, options);
  const generation = JSON.stringify([game?.country, game?.gameDate, game?.round, selectedId, issuer?.label, audience]);

  useEffect(() => {
    revisionRef.current += 1;
    setReview(null);
    setDone(false);
    setWithdrawArmed(false);
  }, [generation]);

  useEffect(() => {
    const invalidate = () => {
      revisionRef.current += 1;
      setReview(null);
      setDone(false);
      setWithdrawArmed(false);
    };
    window.addEventListener("oh:active-game-changed", invalidate);
    window.addEventListener("oh:rolled-back", invalidate);
    return () => {
      revisionRef.current += 1;
      window.removeEventListener("oh:active-game-changed", invalidate);
      window.removeEventListener("oh:rolled-back", invalidate);
    };
  }, []);

  const updateDraft = (next) => {
    revisionRef.current += 1;
    setDraft(next);
    setReview(null);
    setStatus("");
  };

  const authorize = async (checked) => {
    setReview(null);
    if (!checked || !valid || workingRef.current) return;
    workingRef.current = true;
    setBusy(true);
    setStatus("");
    const stamp = revisionRef.current;
    try {
      const captured = await capturePublicReview();
      if (stamp !== revisionRef.current) return;
      if (
        captured.expected.country !== game.country
        || captured.expected.date !== game.gameDate
        || captured.expected.round !== game.round
        || captured.issuers.find((entry) => entry.id === selectedId)?.label !== issuer.label
        || audienceLabelFor(draft, captured) !== audience
      ) {
        throw new Error("Campaign changed; review the statement again.");
      }
      setReview({
        ...captured,
        selectedIssuerId: selectedId,
        approvedDraft: normalizePublicDraft({ ...draft, issuerId: selectedId }),
      });
    } catch (error) {
      if (stamp === revisionRef.current) setStatus(error.message);
    } finally {
      workingRef.current = false;
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!review || !valid || workingRef.current || done || approved || cancelled) return;
    workingRef.current = true;
    setBusy(true);
    setStatus("");
    try {
      const result = await commitPublicReview({
        review,
        draft: { ...draft, issuerId: selectedId },
        draftId: id,
        threadId,
        replyId,
        index,
        confirmed: true,
      });
      setReview(null);
      setDone(true);
      setStatus(result?.skipped ? "Already published." : "Published in your campaign's Events record.");
    } catch (error) {
      setReview(null);
      setStatus(error.message);
    } finally {
      workingRef.current = false;
      setBusy(false);
    }
  };

  const discussDraft = () => {
    if (workingRef.current || approved || cancelled) return;
    setReview(null);
    setEditing(false);
    onDiscuss?.(draft);
  };

  const cancelOrWithdraw = async () => {
    if (workingRef.current || !cancellable) return;
    if (approved && !withdrawArmed) {
      setWithdrawArmed(true);
      return;
    }
    workingRef.current = true;
    setBusy(true);
    setStatus("");
    try {
      await cancelPublicReview({
        campaignId: getLibraryState().activeGameId,
        expected: { country: game.country, date: game.gameDate, round: game.round },
        draftId: id,
        threadId,
        replyId,
        index,
      });
      setReview(null);
      setDone(false);
      setEditing(false);
      setStatus(approved ? "Publication withdrawn before time advanced." : "Draft cancelled.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      workingRef.current = false;
      setWithdrawArmed(false);
      setBusy(false);
    }
  };

  if (sharedSession || !id) return null;
  const displayed = approved || draft;

  return (
    <section className="oh-public-statement" aria-label={uiString("Public statement draft")}>
      <header className="oh-public-statement-heading">
        <Megaphone />
        <strong>{cancelled ? "Cancelled public statement" : approved ? "Published public statement" : "Proposed public address"}</strong>
      </header>

      {editing && !approved && !done && !cancelled ? (
        <div className="oh-public-statement-fields">
          <label>
            Issuer
            <select aria-label={uiString("Issuer")} value={selectedId} disabled={busy} onChange={(event) => updateDraft({ ...draft, issuerId: event.target.value })}>
              {offices.issuers.map((office) => <option key={office.id} value={office.id}>{office.label}</option>)}
            </select>
          </label>
          <label>
            Audience
            <select aria-label={uiString("Audience")} value={kind} disabled={busy} onChange={(event) => updateDraft({ ...draft, audience: { kind: event.target.value, target: "" } })}>
              {Object.entries(AUDIENCE_LABELS).map(([key, label]) => <option key={key} value={key}>{uiString(label)}</option>)}
            </select>
          </label>
          {targeted && (
            <label>
              Recipient
              <select aria-label={uiString("Recipient")} value={draft.audience.target} disabled={busy} onChange={(event) => updateDraft({ ...draft, audience: { ...draft.audience, target: event.target.value } })}>
                <option value="">Select recipient</option>
                {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
              </select>
            </label>
          )}
          <label>
            Title
            <input aria-label={uiString("Title")} maxLength={180} disabled={busy} value={draft.title} onChange={(event) => updateDraft({ ...draft, title: event.target.value })} />
          </label>
          <label>
            Statement
            <textarea aria-label={uiString("Statement")} maxLength={PUBLICATION_MAX_BODY} disabled={busy} value={draft.body} onChange={(event) => updateDraft({ ...draft, body: event.target.value })} />
          </label>
          <div className="oh-public-statement-meta">{draft.body.length} / {PUBLICATION_MAX_BODY}</div>
          <button type="button" disabled={!valid || busy} onClick={() => { setReview(null); setEditing(false); }}>Review statement</button>
          <button type="button" disabled={busy} onClick={() => { setEditing(false); setReview(null); }}>Back to draft</button>
        </div>
      ) : (
        <>
          <div className="oh-public-statement-meta">
            <div>Issuer: <span data-no-translate>{approved?.issuer || issuer?.label || "Select a valid issuer"}</span></div>
            <div>Audience: <span data-no-translate>{approved?.audienceLabel || audience}</span></div>
          </div>
          <div className="oh-public-statement-copy" data-no-translate>
            <strong>{displayed.title}</strong>
            <div>{displayed.body}</div>
          </div>
          {cancelled ? (
            <div className="oh-public-statement-meta">Withdrawn. Ask the Advisor for a fresh draft if needed.</div>
          ) : approved ? (
            <div className="oh-public-statement-meta">Published on <span data-no-translate>{receipt.date}</span></div>
          ) : !done && (
            <>
              <label className="oh-public-statement-confirm">
                <input type="checkbox" checked={Boolean(review)} disabled={!valid || busy} onChange={(event) => void authorize(event.target.checked)} />
                <span>I authorize publication of this exact wording to the selected public audience.</span>
              </label>
              <div className="oh-public-statement-buttons">
                <button type="button" disabled={busy} onClick={() => { setReview(null); setEditing(true); }}>Edit statement</button>
                <button type="button" className="oh-public-statement-publish" disabled={!review || !valid || busy} onClick={() => void publish()}>
                  {busy ? "Working..." : "Publish address"}
                </button>
              </div>
              <div className="oh-public-statement-meta">Publication records your words in Events. Reactions may occur on the next ordinary time skip. It does not execute orders or enact laws.</div>
            </>
          )}
        </>
      )}

      {!editing && cancellable && (
        <div className="oh-public-statement-buttons">
          {!approved && (
            <button type="button" disabled={busy || !onDiscuss} onClick={discussDraft}>Discuss</button>
          )}
          <button type="button" disabled={busy} onClick={() => void cancelOrWithdraw()}>
            {approved ? (withdrawArmed ? "Confirm withdraw" : "Withdraw publication") : "Cancel"}
          </button>
          {approved && withdrawArmed && (
            <button type="button" disabled={busy} onClick={() => setWithdrawArmed(false)}>Keep published</button>
          )}
        </div>
      )}
      {status && <div role="status" className="oh-public-statement-meta">{status}</div>}
    </section>
  );
};
