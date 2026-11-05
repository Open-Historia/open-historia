/*! Open Historia — a conversation that could not be loaded or saved © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The strip the Diplomacy panel and the advisor show above a conversation that
// could not be loaded (nothing is saved until it is: saving the short list
// would overwrite the real one) or whose latest save failed (it is kept in
// memory for the Retry). The two sentences come from the caller, whole.
import React from "react";

export default function StorageProblemNotice({ title, detail, onRetry, retrying = false, retryIcon = null }) {
    return (
        <div role="alert" style={{ alignItems: "center", background: "rgba(239,68,68,0.1)", borderBottom: "1px solid rgba(239,68,68,0.35)", display: "flex", flexShrink: 0, gap: "0.6rem", padding: "0.5rem 0.85rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#fecaca", fontSize: "0.75rem", fontWeight: 700 }}>{title}</div>
                {detail && <div style={{ color: "rgba(254,202,202,0.7)", fontSize: "0.68rem", marginTop: "0.1rem" }}>{detail}</div>}
            </div>
            {onRetry && (
                <button type="button" className="oh-tap-row" onClick={onRetry} disabled={retrying}
                style={{ alignItems: "center", background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "6px", color: "rgba(254,202,202,0.95)", cursor: retrying ? "default" : "pointer", display: "flex", flexShrink: 0, fontFamily: "sans-serif", fontSize: "0.7rem", fontWeight: 600, gap: "0.3rem", padding: "0.3rem 0.6rem" }}>
                    {retryIcon}{retrying ? "Retrying…" : "Retry"}
                </button>
            )}
        </div>
    );
}
