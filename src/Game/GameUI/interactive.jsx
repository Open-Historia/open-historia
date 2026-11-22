/*! Open Historia — interactive events © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// An interactive event: a moment of the campaign played out as a scene, beat by
// beat, then written into the record as one event. The player does not start
// one. Now and then a time skip offers one of its own events for it
// (runtime/interactiveOffer.js); the event's card says so (time.jsx), and this
// panel opens on the offer. The player plays it out, with an angle of their own
// if they like, or lets it pass; picks or writes each move; may take a move
// back; and ends the scene or sets it aside. Time stands still while a scene is
// in progress (gameplay.js refuses a skip).
//
// Costs, said beside the buttons that spend them: playing an offer out is one
// AI request and each move one more. Ending the scene yourself is one more; a
// scene that reaches its own end is usually written up by its last move at no
// extra cost (gameplay.js resolveInteractiveScene). Letting an offer pass,
// taking a move back and setting a scene aside cost nothing.
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackToClose } from "../../runtime/backToClose.js";
import { APP_HEIGHT, SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP, useTouchPrimary } from "../../runtime/mobileUi.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { offeredEvent } from "../../runtime/interactiveOffer.js";
import { formatGameDateReadable, isGameDate } from "../../runtime/gameDates.js";
import { canRewindInteractiveTo, interactiveChoiceTexts, isSceneInProgress } from "../AI/interactiveRewind.js";
import { advanceActiveInteractive, createInteractive, declineInteractiveOffer, endActiveInteractive, rewindActiveInteractive, setAsideActiveInteractive } from "../AI/gameplayLazy.js";
import { sceneCompletionTitle } from "../AI/interactiveCompletion.js";
import { useUnseenEventIds } from "./useUnseenEvents.js";
import { interactiveTranscriptIsComplete } from "../../runtime/interactiveTranscript.js";
import { showEventOnTimeline } from "./turnReveal.js";

const YELLOW = "#facc15";
// A scene the player never took up (one a time skip proposed, before skips
// stopped proposing them) is no scene here: the next skip clears it.
const selectScene = (world) => (isSceneInProgress(world?.activeInteractive) ? world.activeInteractive : null);
const selectOffer = (world) => world?.interactiveOffer ?? null;

const panelStyle = {
    background: "var(--oh-ui-overlay-strong, rgba(18,18,22,0.97))",
    border: "1px solid rgba(250,204,21,0.38)",
    borderRadius: "16px",
    boxShadow: "0 18px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(250,204,21,0.06) inset",
    color: "white",
    display: "flex",
    flexDirection: "column",
    fontFamily: "sans-serif",
    // Inside the backdrop's padding, which keeps clear of a notch and a home
    // indicator (the insets are 0 everywhere else).
    maxHeight: `min(52rem, calc(${APP_HEIGHT} - 2rem - ${SAFE_TOP} - ${SAFE_BOTTOM}))`,
    maxWidth: `calc(100vw - 2rem - ${SAFE_LEFT} - ${SAFE_RIGHT})`,
    overflow: "hidden",
    width: "48rem",
};
const primaryButton = (disabled) => ({
    background: disabled ? "rgba(250,204,21,0.25)" : YELLOW,
    border: "none",
    borderRadius: "10px",
    color: "#1c1917",
    cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit",
    fontSize: "0.82rem",
    fontWeight: 800,
    padding: "0.6rem 1rem",
});
const quietButton = (disabled) => ({
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "10px",
    color: disabled ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.85)",
    cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit",
    fontSize: "0.78rem",
    fontWeight: 700,
    padding: "0.55rem 0.9rem",
});
const choiceButton = (disabled) => ({
    background: "rgba(250,204,21,0.06)",
    border: "1px solid rgba(250,204,21,0.28)",
    borderRadius: "10px",
    color: disabled ? "rgba(255,255,255,0.4)" : "#fef9c3",
    cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit",
    fontSize: "0.82rem",
    lineHeight: 1.4,
    padding: "0.6rem 0.8rem",
    textAlign: "left",
    width: "100%",
});
const inputStyle = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: "10px",
    boxSizing: "border-box",
    color: "white",
    fontFamily: "inherit",
    fontSize: "0.82rem",
    lineHeight: 1.45,
    padding: "0.6rem 0.75rem",
    resize: "vertical",
    width: "100%",
};
const caption = { color: "rgba(255,255,255,0.60)", fontSize: "0.74rem", lineHeight: 1.45 };

// The scene's own words, written in the game's language already.
const SceneText = ({ children, style }) => (
    <div data-no-translate style={{ fontSize: "0.94rem", lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...style }}>{children}</div>
);

// Completed scenes are read-only. The timeline owns only a small launcher;
// the reader is a separate top-level dialog, with no simulation callbacks.
export const InteractiveTranscript = ({ event, sourceEvent, onOpenSource }) => {
    const [expanded, setExpanded] = useState(false);
    const dialogRef = useRef(null);
    const transcript = event.interactiveTranscript;
    useBackToClose(expanded, () => setExpanded(false));
    useEffect(() => {
        if (!expanded) return undefined;
        const dialog = dialogRef.current;
        if (!dialog) return undefined;
        dialog.showModal();
        return () => { if (dialog.open) dialog.close(); };
    }, [expanded]);
    if (!transcript) return <div style={caption}>Interactive transcript unavailable for this event.</div>;
    return (
        <>
            <button type="button" className="oh-tap-row" aria-haspopup="dialog" onClick={() => setExpanded(true)} style={{ ...quietButton(false), width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", borderColor: "rgba(250,204,21,0.28)" }}>
                <span><span style={{ color: "#fde68a", fontWeight: 800 }}>Explore interactive event</span><span style={{ ...caption, display: "block", marginTop: "0.2rem" }}>Read the scene and your decisions</span></span><span aria-hidden="true" style={{ color: "#fde68a", fontSize: "1rem" }}>→</span>
            </button>
            {expanded && createPortal(
                <dialog ref={dialogRef} aria-label="Interactive event transcript" onCancel={e => { e.preventDefault(); setExpanded(false); }} onClick={e => { if (e.target === e.currentTarget) setExpanded(false); }} style={{ ...panelStyle, position: "fixed", inset: 0, margin: "auto", padding: 0, maxWidth: "calc(100vw - 2rem)", height: "fit-content", zIndex: 2147483000 }}>
                    <style>{'dialog[aria-label="Interactive event transcript"]::backdrop { background: rgba(0,0,0,.68); }'}</style>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.8rem", borderBottom: "1px solid rgba(250,204,21,0.18)", padding: "1rem 1.25rem", flexShrink: 0 }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: "#fde68a", fontWeight: 800, fontSize: "0.78rem" }}>Interactive event transcript</div>
                            <div style={{ ...caption, marginTop: "0.2rem" }}>Completed scene · Read-only history</div>
                        </div>
                        <button type="button" className="oh-tap" onClick={() => setExpanded(false)} style={quietButton(false)}>Close</button>
                    </div>
                    <div style={{ overflowY: "auto", minHeight: 0, padding: "clamp(1rem, 2.5vw, 1.65rem)", display: "flex", flexDirection: "column", gap: "1.15rem" }}>
                        <div>
                            <SceneText style={{ fontSize: "1.3rem", lineHeight: 1.35, fontWeight: 800 }}>{transcript.title}</SceneText>
                            <div style={{ ...caption, marginTop: "0.35rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                                {transcript.startedOn && <span>{isGameDate(transcript.startedOn) ? formatGameDateReadable(transcript.startedOn, "MMMM Do, YYYY") : transcript.startedOn}</span>}
                                <span>{transcript.beats.length} <span>moves</span></span>
                                <span>{transcript.endedBy === "player" ? "Ended by the player" : "Resolved by the scene"}</span>
                            </div>
                        </div>
                        {sourceEvent && typeof onOpenSource === "function" && <button type="button" className="oh-tap-row" onClick={() => { setExpanded(false); onOpenSource(sourceEvent.id); }} style={{ ...quietButton(false), textAlign: "left", overflowWrap: "anywhere" }}>Source event: <span data-no-translate>{sourceEvent.title} ({sourceEvent.date})</span></button>}
                        {transcript.premise && <SceneText style={{ color: "rgba(255,255,255,0.72)", fontStyle: "italic" }}>{transcript.premise}</SceneText>}
                        {transcript.request && <div style={{ ...caption, fontSize: "0.8rem" }}>Your angle: <span data-no-translate>{transcript.request}</span></div>}
                        {transcript.firstOpening && <div><div style={{ ...caption, fontWeight: 800, marginBottom: "0.4rem" }}>Scene opening</div><SceneText>{transcript.firstOpening}</SceneText></div>}
                        {!interactiveTranscriptIsComplete(transcript) && <div style={caption}>Some original scene text or choices were not saved. Only recorded information is shown.</div>}
                        {transcript.beats.map((beat, index) => <div key={index} style={{ display: "grid", gap: "0.7rem", borderLeft: "2px solid rgba(250,204,21,0.35)", padding: "0.2rem 0 0.65rem 1rem", minWidth: 0 }}>
                            <div style={{ ...caption, color: "#fde68a", fontWeight: 800 }}>Move {index + 1}</div>
                            {beat.before && beat.before !== (index === 0 ? transcript.firstOpening : transcript.beats[index - 1]?.summary) && <div><div style={caption}>Before the move</div><SceneText>{beat.before}</SceneText></div>}
                            {beat.offered?.length > 0 && <div><div style={caption}>Offered choices</div><ul style={{ margin: "0.3rem 0", paddingLeft: "1.15rem", display: "grid", gap: "0.25rem" }}>{beat.offered.map((choice, i) => <li key={i} data-no-translate style={{ fontSize: "0.82rem", overflowWrap: "anywhere", color: choice === beat.choice ? "#fde68a" : "rgba(255,255,255,0.65)", fontWeight: choice === beat.choice ? 700 : 400 }}>{choice}</li>)}</ul></div>}
                            <div style={{ background: "rgba(250,204,21,0.06)", border: "1px solid rgba(250,204,21,0.18)", borderRadius: "8px", padding: "0.65rem 0.8rem" }}><div style={{ ...caption, color: "#fde68a" }}>Your move</div><SceneText>{beat.choice}</SceneText></div>
                            {beat.summary && <div><div style={{ ...caption, marginBottom: "0.3rem" }}>Scene response</div><SceneText>{beat.summary}</SceneText></div>}
                        </div>)}
                        <div style={{ borderTop: "1px solid var(--oh-ui-line, rgba(255,255,255,0.12))", paddingTop: "1rem" }}>
                            <div style={{ ...caption, fontWeight: 800, marginBottom: "0.3rem" }}>Outcome</div>
                            <SceneText style={{ fontWeight: 800, fontSize: "1rem" }}>{event.title}</SceneText>
                            {event.description && <SceneText style={{ marginTop: "0.4rem" }}>{event.description}</SceneText>}
                        </div>
                    </div>
                </dialog>, document.body)}
        </>
    );
};

export const InteractivePanel = ({ open = true, onClose, onOpenTimeline }) => {
    const scene = useRuntimeState("world", selectScene);
    const offer = useRuntimeState("world", selectOffer);
    const events = useRuntimeState("events");
    const unseen = useUnseenEventIds();
    const [angle, setAngle] = useState("");
    const [move, setMove] = useState("");
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [finished, setFinished] = useState(null); // { title } of a scene just written into the record
    // Setting a scene aside throws away every move played in it, and each was a
    // request, so once there is a move it takes two presses (as deleting a chat
    // or abandoning a project does). The blur that disarms it with a mouse never
    // comes on a phone, so there the question lapses after four seconds.
    const [confirmingAside, setConfirmingAside] = useState(false);
    const touch = useTouchPrimary();
    useEffect(() => {
        if (!confirmingAside || !touch) return undefined;
        const timer = setTimeout(() => setConfirmingAside(false), 4000);
        return () => clearTimeout(timer);
    }, [confirmingAside, touch]);

    const choices = interactiveChoiceTexts(scene?.choices);
    const beats = Array.isArray(scene?.history) ? scene.history : [];
    const offered = offeredEvent({ offer, events, sceneInProgress: Boolean(scene) });
    // An offer is shown once the reveal has reached its event; the scene starts
    // from what the player has seen, so the rest of the reveal comes first.
    const offerShown = offered && !unseen.has(offered.id) ? offered : null;
    const revealing = unseen.size > 0;

    // One engine call at a time; its errors are the panel's to show.
    const run = async (label, work) => {
        if (busy) return null;
        setBusy(label);
        setError("");
        try {
            return await work();
        } catch (failure) {
            setError(String(failure?.message || failure));
            return null;
        } finally {
            setBusy("");
        }
    };

    const begin = () => run("Writing the scene…", async () => {
        setFinished(null);
        await createInteractive({ eventId: offerShown?.id, angle });
        setAngle("");
    });
    const letPass = () => run("Letting it pass…", async () => {
        await declineInteractiveOffer();
        onClose?.();
    });
    // A move: one of the offered choices, or the player's own words. When the
    // scene resolves, it is written into the record and closes.
    const play = (text) => run("Playing the move…", async () => {
        const wording = String(text ?? "").trim();
        if (!wording) return;
        const title = scene?.title || "";
        const result = await advanceActiveInteractive(wording);
        setMove("");
        if (result && !result.interactive) setFinished({ title: sceneCompletionTitle(result, title), eventId: result.resolvedSceneEventId });
    });
    const takeBack = (index) => run("Taking the move back…", () => rewindActiveInteractive({ beatIndex: index }));
    const end = () => run("Writing the scene into the record…", async () => {
        const title = scene?.title || "";
        const result = await endActiveInteractive();
        if (result?.resolved) setFinished({ title: sceneCompletionTitle(result, title), eventId: result.resolvedSceneEventId });
    });
    const setAside = () => {
        if (beats.length > 0 && !confirmingAside) {
            setConfirmingAside(true);
            return null;
        }
        setConfirmingAside(false);
        return run("Setting the scene aside…", () => setAsideActiveInteractive());
    };

    if (!open) return null;
    const idle = !busy;

    return (
        <div style={{ alignItems: "center", background: "rgba(0,0,0,0.63)", display: "flex", inset: 0, justifyContent: "center", padding: `calc(1rem + ${SAFE_TOP}) calc(1rem + ${SAFE_RIGHT}) calc(1rem + ${SAFE_BOTTOM}) calc(1rem + ${SAFE_LEFT})`, position: "fixed", zIndex: 10001 }}>
            <div role="dialog" aria-modal="true" aria-label="Interactive event" style={panelStyle}>
                <div style={{ alignItems: "center", borderBottom: "1px solid rgba(250,204,21,0.18)", display: "flex", gap: "0.75rem", justifyContent: "space-between", padding: "0.9rem 1.1rem" }}>
                    <div>
                        <div style={{ color: YELLOW, fontSize: "0.95rem", fontWeight: 850, letterSpacing: "0.02em" }}>⚡ Interactive event</div>
                        <div style={{ ...caption, marginTop: "0.15rem" }}>A moment of the campaign played out as a scene. Time stands still until it ends.</div>
                    </div>
                    {/* Kept on one line: squeezed by the caption on a phone, it
                        broke into "✕" over "Leave". */}
                    <button type="button" className="oh-tap" onClick={onClose} aria-label="Leave" title="Close — a scene in progress stays where it is, and an offer stays until the next time skip" style={{ ...quietButton(false), flexShrink: 0, whiteSpace: "nowrap" }}>✕ Leave</button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "1.05rem", minHeight: 0, overflowY: "auto", padding: "clamp(1rem, 2.5vw, 1.65rem)" }}>
                    {finished && (
                        <div style={{ background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.3)", borderRadius: "10px", fontSize: "0.8rem", lineHeight: 1.5, padding: "0.7rem 0.85rem" }}>
                            The scene is over and written into the record{finished.title ? <>: <span data-no-translate style={{ fontWeight: 800 }}>{finished.title}</span></> : null}.
                            {typeof onOpenTimeline === "function" && (
                                <button type="button" className="oh-tap-row" onClick={() => { onOpenTimeline(); if (finished.eventId) showEventOnTimeline(finished.eventId); }} style={{ ...quietButton(false), marginLeft: "0.6rem", padding: "0.3rem 0.6rem" }}>See it on the timeline</button>
                            )}
                        </div>
                    )}

                    {scene ? (
                        <>
                            <div>
                                <SceneText style={{ fontSize: "1.3rem", lineHeight: 1.35, fontWeight: 800 }}>{scene.title || "Untitled scene"}</SceneText>
                                {scene.premise && <SceneText style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.78rem", fontStyle: "italic", marginTop: "0.2rem" }}>{scene.premise}</SceneText>}
                                {scene.request && <div style={{ ...caption, marginTop: "0.3rem" }}>Your angle: <span data-no-translate>{scene.request}</span></div>}
                            </div>

                            {beats.length > 0 && (
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                                    {beats.map((beat, index) => (
                                        <div key={index} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "0.55rem 0.7rem" }}>
                                            <div style={{ alignItems: "baseline", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                                                <div style={{ fontSize: "0.74rem", color: "#fde68a" }}>
                                                    Your move: <span data-no-translate>{beat.choice}</span>
                                                </div>
                                                {canRewindInteractiveTo(scene, index) && (
                                                    <button type="button" className="oh-tap-row" onClick={() => takeBack(index)} disabled={!idle} title="Return the scene to just before this move — free; choosing again is one request" style={{ ...quietButton(!idle), fontSize: "0.68rem", padding: "0.2rem 0.5rem" }}>↶ Take back</button>
                                                )}
                                            </div>
                                            {beat.summary && <SceneText style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.9rem", marginTop: "0.4rem" }}>{beat.summary}</SceneText>}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {!beats.length && scene.opening && <SceneText>{scene.opening}</SceneText>}

                            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                                {choices.map((choice) => (
                                    <button type="button" className="oh-tap-row" key={choice} onClick={() => play(choice)} disabled={!idle} style={choiceButton(!idle)}>
                                        <span data-no-translate>{choice}</span>
                                    </button>
                                ))}
                            </div>

                            <div style={{ display: "flex", gap: "0.5rem" }}>
                                <input
                                    value={move}
                                    disabled={!idle}
                                    onChange={(event) => setMove(event.target.value)}
                                    onKeyDown={(event) => { if (event.key === "Enter") play(move); }}
                                    placeholder="Or write your own move…"
                                    style={{ ...inputStyle, minWidth: 0, resize: "none" }}
                                />
                                <button type="button" className="oh-tap-row" onClick={() => play(move)} disabled={!idle || !move.trim()} style={primaryButton(!idle || !move.trim())}>Play</button>
                            </div>
                            <div style={caption}>Each move is one AI request. The scene ends when it reaches its outcome, or when you end it.</div>

                            <div style={{ alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", flexWrap: "wrap", gap: "0.6rem", paddingTop: "0.8rem" }}>
                                <button type="button" className="oh-tap-row" onClick={end} disabled={!idle || !beats.length} title={beats.length ? "Write what has happened into the record — one request" : "Play a move first; with none played there is nothing to record"} style={quietButton(!idle || !beats.length)}>End the scene</button>
                                <button
                                    type="button"
                                    className="oh-tap-row"
                                    onClick={setAside}
                                    onBlur={() => setConfirmingAside(false)}
                                    disabled={!idle}
                                    title={confirmingAside ? "Press again to set the scene aside: the moves played in it are not kept" : "Close the scene without writing anything — free"}
                                    style={confirmingAside
                                        ? { ...quietButton(!idle), background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.6)", color: "#fca5a5" }
                                        : quietButton(!idle)}
                                >
                                    {!confirmingAside
                                        ? "Set aside"
                                        : beats.length === 1
                                            ? "You've played 1 move — set it aside anyway?"
                                            : `You've played ${beats.length} moves — set it aside anyway?`}
                                </button>
                                <span style={caption}>Ending writes the scene into the record (one request). Setting it aside keeps nothing.</span>
                            </div>
                        </>
                    ) : offerShown ? (
                        <>
                            <div>
                                <div style={caption}>The last time skip offers this moment to be played out</div>
                                <SceneText style={{ fontSize: "1.3rem", lineHeight: 1.35, fontWeight: 800, marginTop: "0.35rem" }}>{offerShown.title}</SceneText>
                                {offerShown.date && <div style={{ ...caption, marginTop: "0.1rem" }}>{isGameDate(offerShown.date) ? formatGameDateReadable(offerShown.date, "MMMM Do, YYYY") : offerShown.date}</div>}
                                {offerShown.description && (
                                    <SceneText style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.92rem", marginTop: "0.8rem", lineHeight: 1.7 }}>{offerShown.description}</SceneText>
                                )}
                            </div>
                            <label htmlFor="interactive-angle" style={{ fontSize: "0.84rem", fontWeight: 800 }}>Your angle <span style={{ ...caption, fontWeight: 400 }}>(optional)</span></label>
                            <textarea
                                id="interactive-angle"
                                rows={3}
                                value={angle}
                                disabled={!idle}
                                onChange={(event) => setAngle(event.target.value)}
                                placeholder="Who you are in the room, what you are after… Leave it empty and the scene is built on the event as it stands."
                                style={inputStyle}
                            />
                            {revealing && <div style={{ ...caption, color: "#fde68a" }}>Finish revealing the last time skip first: a scene starts from what you have seen.</div>}
                            <div style={{ alignItems: "center", display: "flex", gap: "0.75rem", flexWrap: "wrap", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "1rem" }}>
                                <button type="button" className="oh-tap-row" onClick={begin} disabled={!idle || revealing} style={primaryButton(!idle || revealing)}>Play it out</button>
                                <button type="button" className="oh-tap-row" onClick={letPass} disabled={!idle} title="Let the moment pass as it happened — free" style={quietButton(!idle)}>Let it pass</button>
                                <span style={{ ...caption, flexBasis: "100%" }}>Playing it out is one AI request, and each move is one more. Ending it yourself is one more; a scene that reaches its own end is usually written up with its last move. Letting it pass costs nothing.</span>
                            </div>
                        </>
                    ) : !finished && !busy && (
                        <div style={{ ...caption, fontSize: "0.8rem" }}>
                            No interactive event is waiting. Now and then a time skip offers one of its events that concerns you to be played out; the event's card says so.
                        </div>
                    )}

                    {busy && <div style={{ color: YELLOW, fontSize: "0.78rem", fontWeight: 700 }}>{busy}</div>}
                    {error && <div style={{ color: "#fca5a5", fontSize: "0.78rem", lineHeight: 1.45 }}>{error}</div>}
                </div>
            </div>
        </div>
    );
};

export default InteractivePanel;
