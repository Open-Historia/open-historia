import { useEffect, useState } from "react";
import { getProviderField, getProviderMeta } from "../AI/providerConfig.js";
import "./simulationProgress.css";

export default function SimulationProgress({ simulation, onCancel }) {
    const [now, setNow] = useState(Date.now);
    const [cancelling, setCancelling] = useState(false);
    const [minimized, setMinimized] = useState(false);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    const seconds = Math.max(0, Math.floor((now - simulation.startedAt) / 1000));
    const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const model = getProviderField(simulation.provider, "model").trim()
        || ({ gemini: "gemini-3.5-flash-lite", anthropic: "claude-haiku-4-5", "anthropic-compatible": "claude-haiku-4-5" }[simulation.provider])
        || "Detecting model…";
    const duration = simulation.mode === "auto" ? "Auto-jump (up to 1 year)"
        : simulation.days < 1 ? `${simulation.days * 24} hours` : `${simulation.days} day${simulation.days === 1 ? "" : "s"}`;

    return (
        <section className={`simulation-progress${minimized ? " simulation-progress-minimized" : ""}`} aria-label="World simulation">
            <div className="simulation-progress-heading">
                <svg className="simulation-progress-orbit" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                    <circle cx="16" cy="16" r="12" stroke="currentColor" opacity=".3" />
                    <ellipse cx="16" cy="16" rx="5" ry="12" stroke="currentColor" opacity=".5" />
                    <path d="M4 16h24M16 4a12 12 0 0 1 12 12" stroke="currentColor" />
                    <circle cx="28" cy="16" r="2" fill="currentColor" />
                </svg>
                <div className="simulation-progress-title">
                    <h2>Simulating world</h2>
                    <p role="status">{cancelling ? "Cancelling simulation…" : simulation.stage}</p>
                </div>
                <time aria-label={`${seconds} seconds elapsed`}>{elapsed}</time>
                <button
                    className="simulation-progress-toggle"
                    type="button"
                    aria-label={minimized ? "Expand simulation details" : "Minimize simulation details"}
                    aria-expanded={!minimized}
                    title={minimized ? "Expand" : "Minimize"}
                    onClick={() => setMinimized(value => !value)}
                >
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                        {minimized ? <rect x="4" y="4" width="12" height="12" rx="1" /> : <path d="M4 14h12" />}
                    </svg>
                </button>
            </div>
            {!minimized && <>
            <dl>
                <dt>Model</dt><dd translate="no">{model}</dd>
                <dt>Provider</dt><dd>{getProviderMeta(simulation.provider).label}</dd>
                <dt>Time jump</dt><dd>{duration}</dd>
                {simulation.attempt > 1 && <><dt>Attempt</dt><dd>{simulation.attempt} of 2</dd></>}
            </dl>
            <div className="simulation-progress-footer">
                <span>{seconds >= 60 ? "Still running. Complex turns can take a few minutes." : "The world is advancing."}</span>
                <button type="button" disabled={cancelling || simulation.saving} onClick={() => {
                    setCancelling(true);
                    onCancel();
                }}>{simulation.saving ? "Saving…" : cancelling ? "Cancelling…" : "Cancel"}</button>
            </div>
            </>}
        </section>
    );
}
