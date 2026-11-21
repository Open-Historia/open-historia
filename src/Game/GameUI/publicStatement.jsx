/*! Open Historia - inline official public statement review. AGPL-3.0-or-later. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { capturePublicReview, commitPublicReview, cancelPublicReview } from "../../runtime/publicPublication.js";
import { normalizePublicDraft, publicationId, publicIssuerOptions, publicAudienceOptions, normalizePublicStatement, canCancelPublicStatement, PUBLICATION_MAX_BODY } from "../../runtime/publicCommunications.js";
import { getLibraryState } from "../../runtime/library.js";
import { inSharedGame } from "../../multiplayer/client/sharedGameBridge.js";
import { uiString } from "../../runtime/translator.js";

const labels = { domestic: "Domestic public", "foreign-public": "Foreign population", worldwide: "International community", institution: "International institution" };
const audienceLabel = (draft, options) => {
    const { kind, target } = draft.audience;
    if (kind === "foreign-public") return "People of " + (options.polities.find(p => p.id === target)?.label || target);
    if (kind === "institution") return options.institutions.find(p => p.id === target)?.label || target;
    return uiString(labels[kind] || kind);
};
const Megaphone = () => <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9v6h4l12 5V4L7 9H3Z"/><path d="m7 15 2 6m12-11v4"/></svg>;

export const PublicStatementCard = ({ draft: original, replyId, index, onDiscuss }) => {
    const [draft, setDraft] = useState(original);
    const [editing, setEditing] = useState(false);
    const [review, setReview] = useState(null);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const [done, setDone] = useState(false);
    const working = useRef(false);
    const revision = useRef(0);
    const id = replyId ? replyId + ":public:" + index : "";
    const world = useRuntimeState("world", w => w);
    const game = useRuntimeState("game", g => g);
    const receipt = useRuntimeState("events", events => Array.isArray(events) ? events.find(e => e.id === publicationId(id)) : null, id);
    const approved = normalizePublicStatement(receipt);
    const cancelled = world?.cancelledPublicDrafts?.includes(id);
    const cancellable = !cancelled && (!approved || canCancelPublicStatement(receipt,world,game));
    const options = useMemo(() => publicAudienceOptions(world), [world]);
    const offices = useMemo(() => publicIssuerOptions(world, game), [world, game]);
    const selectedId = draft.issuerId || offices.defaultIssuerId;
    const issuer = offices.issuers.find(p => p.id === selectedId);
    const kind = draft.audience.kind;
    const targeted = kind === "foreign-public" || kind === "institution";
    const choices = kind === "institution" ? options.institutions : options.polities.filter(p => p.id !== offices.polity);
    const valid = Boolean(normalizePublicDraft(draft) && issuer && (!targeted || choices.some(p => p.id === draft.audience.target)));
    const audience = audienceLabel(draft, options);
    const generation = JSON.stringify([game?.country, game?.gameDate, game?.round, selectedId, issuer?.label, audience]);
    useEffect(() => {
        revision.current++;
        setReview(null);
        setDone(false);
    }, [generation]);
    useEffect(() => {
        const invalidate = () => { revision.current++; setReview(null); setDone(false); };
        window.addEventListener("oh:active-game-changed", invalidate);
        window.addEventListener("oh:rolled-back", invalidate);
        return () => {
            revision.current++;
            window.removeEventListener("oh:active-game-changed", invalidate);
            window.removeEventListener("oh:rolled-back", invalidate);
        };
    }, []);
    const change = next => {
        revision.current++;
        setDraft(next);
        setReview(null);
        setStatus("");
    };
    const authorize = async checked => {
        setReview(null);
        if (!checked || !valid || working.current) return;
        working.current = true;
        setBusy(true);
        setStatus("");
        const stamp = revision.current;
        try {
            const captured = await capturePublicReview();
            if (stamp !== revision.current) return;
            if (captured.expected.country !== game.country || captured.expected.date !== game.gameDate || captured.expected.round !== game.round ||
                captured.issuers.find(p => p.id === selectedId)?.label !== issuer.label ||
                audienceLabel(draft, captured) !== audience) throw new Error("Campaign changed; review the statement again.");
            setReview({ ...captured, selectedIssuerId: selectedId, approvedDraft: normalizePublicDraft({ ...draft, issuerId: selectedId }) });
        } catch (error) {
            if (stamp === revision.current) setStatus(error.message);
        } finally {
            working.current = false;
            setBusy(false);
        }
    };
    const publish = async () => {
        if (!review || !valid || working.current || done || approved || cancelled) return;
        working.current = true;
        setBusy(true);
        setStatus("");
        try {
            const result = await commitPublicReview({ review, draft: { ...draft, issuerId: selectedId }, draftId: id, replyId, index, confirmed: true });
            setReview(null);
            setDone(true);
            setStatus(result?.skipped ? "Already published." : "Published in your campaign's Events record.");
        } catch (error) {
            setReview(null);
            setStatus(error.message);
        } finally {
            working.current = false;
            setBusy(false);
        }
    };
    const cancel = async (discuss=false) => {
        if (working.current || !cancellable) return;
        if (discuss && !approved) {
            setReview(null); setEditing(false); onDiscuss?.(draft); return;
        }
        working.current=true; setBusy(true); setStatus("");
        try {
            await cancelPublicReview({campaignId:getLibraryState().activeGameId,expected:{country:game.country,date:game.gameDate,round:game.round},draftId:id,replyId,index});
            setReview(null);setDone(false);setEditing(false);
            setStatus(approved?"Publication cancelled before time advanced.":"Draft cancelled.");
            if(discuss)onDiscuss?.(approved||draft);
        } catch(error){setStatus(error.message);}
        finally{working.current=false;setBusy(false);}
    };
    if (inSharedGame() || !id) return null;
    const displayed = approved || draft;
    return <section className="oh-public-statement" aria-label={uiString("Public statement draft")}>
        <header className="oh-public-statement-heading"><Megaphone/><strong>{cancelled ? "Cancelled public statement" : approved ? "Published public statement" : "Proposed public address"}</strong></header>
        {editing && !approved && !done && !cancelled ? <div className="oh-public-statement-fields">
            <label>Issuer<select aria-label={uiString("Issuer")} value={selectedId} disabled={busy} onChange={e => change({ ...draft, issuerId: e.target.value })}>{offices.issuers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
            <label>Audience<select aria-label={uiString("Audience")} value={kind} disabled={busy} onChange={e => change({ ...draft, audience: { kind: e.target.value, target: "" } })}>{Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{uiString(v)}</option>)}</select></label>
            {targeted && <label>Recipient<select aria-label={uiString("Recipient")} value={draft.audience.target} disabled={busy} onChange={e => change({ ...draft, audience: { ...draft.audience, target: e.target.value } })}><option value="">Select recipient</option>{choices.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>}
            <label>Title<input aria-label={uiString("Title")} maxLength={180} disabled={busy} value={draft.title} onChange={e => change({ ...draft, title: e.target.value })}/></label>
            <label>Statement<textarea aria-label={uiString("Statement")} maxLength={PUBLICATION_MAX_BODY} disabled={busy} value={draft.body} onChange={e => change({ ...draft, body: e.target.value })}/></label>
            <div className="oh-public-statement-meta">{draft.body.length} / {PUBLICATION_MAX_BODY}</div>
            <button type="button" disabled={!valid || busy} onClick={() => { setReview(null); setEditing(false); }}>Review statement</button>
            <button type="button" disabled={busy} onClick={()=>{setEditing(false);setReview(null);}}>Back to draft</button>
        </div> : <>
            <div className="oh-public-statement-meta"><div>Issuer: <span data-no-translate>{approved?.issuer || issuer?.label || "Select a valid issuer"}</span></div><div>Audience: <span data-no-translate>{approved?.audienceLabel || audience}</span></div></div>
            <div className="oh-public-statement-copy" data-no-translate><strong>{displayed.title}</strong><div>{displayed.body}</div></div>
            {cancelled ? <div className="oh-public-statement-meta">Withdrawn. Ask the Advisor for a fresh draft if needed.</div> : approved ? <div className="oh-public-statement-meta">Published on <span data-no-translate>{receipt.date}</span></div> : !done && <>
                <label className="oh-public-statement-confirm"><input type="checkbox" checked={Boolean(review)} disabled={!valid || busy} onChange={e => void authorize(e.target.checked)}/><span>I authorize publication of this exact wording to the selected public audience.</span></label>
                <div className="oh-public-statement-buttons">
                    <button type="button" disabled={busy} onClick={() => { setReview(null); setEditing(true); }}>Edit statement</button>
                    <button type="button" className="oh-public-statement-publish" disabled={!review || !valid || busy} onClick={() => void publish()}>{busy ? "Working..." : "Publish address"}</button>
                </div>
                <div className="oh-public-statement-meta">Publication records your words in Events. Reactions may occur on the next ordinary time skip. It does not execute orders or enact laws.</div>
            </>}
        </>}
        {!editing && cancellable && <div className="oh-public-statement-buttons">
            <button type="button" disabled={busy || !onDiscuss} onClick={()=>void cancel(true)}>Discuss</button>
            <button type="button" disabled={busy} onClick={()=>void cancel()}>Cancel</button>
        </div>}
        {status && <div role="status" className="oh-public-statement-meta">{status}</div>}
    </section>;
};
