/*! Open Historia — accessible source details for national statistics, AGPL-3.0-or-later. */
import React, { useMemo, useState } from "react";
import { nationalStatSourceRows } from "./statSourceView.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";

export default function StatSources({ sheet, definition, world, country }) {
    const [open, setOpen] = useState(false);
    const rows = useMemo(() => open ? nationalStatSourceRows({ sheet, definition, world, country }) : [], [open, sheet, definition, world, country]);
    return (
        <details onToggle={(event) => setOpen(event.currentTarget.open)} style={{ marginTop: "1rem", borderTop: "1px solid rgba(156,188,211,0.2)", paddingTop: "0.75rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 700 }}>Sources and estimates</summary>
            <p style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.68rem", lineHeight: 1.5 }}>Source labels identify where values were recorded, not historical accuracy. Calculations may use estimates. Older values keep an unspecified source.</p>
            <dl style={{ margin: 0 }}>
                {rows.map((row) => (
                    <div key={row.path} style={{ padding: "0.55rem 0", borderBottom: "1px solid rgba(156,188,211,0.12)", overflowWrap: "anywhere" }}>
                        <dt style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.73rem" }}>{row.label}</dt>
                        <dd style={{ margin: "0.2rem 0 0", color: "rgba(255,255,255,0.55)", fontSize: "0.68rem", lineHeight: 1.5 }}>
                            <span>{row.sourceLabel}</span>
                            {row.date && <span> · {formatGameDateReadable(row.date, "D MMM YYYY")}</span>}
                            {row.round !== undefined && <span> · <span>Turn</span> <span data-no-translate>{row.round}</span></span>}
                            {row.calculated && row.source !== "unknown" && <div>Calculated from recorded inputs</div>}
                        </dd>
                    </div>
                ))}
            </dl>
        </details>
    );
}
