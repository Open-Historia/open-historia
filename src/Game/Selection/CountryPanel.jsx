/*! Open Historia — country info panel © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { getNationTags, loadRegionCatalog } from "../../runtime/assets.js";
import { resolveCountryTags } from "../../runtime/countryTags.js";
import { readEventsState, readWorldState } from "../../runtime/gameState.js";
import { requestDiplomaticChat } from "../GameUI/chat.jsx";
import { generateCountryStats } from "../AI/gameplay.js";

// Bridge: the region popup's info button opens this panel from outside React.
let _openPanel = null;

export const openCountryPanel = (country) => {
    _openPanel?.(country);
};

const FILTER_MODES = [
    { id: "all", label: "All" },
    { id: "major", label: "Major" },
    { id: "minor", label: "Minor" },
];

const surface = {
    backgroundColor: "rgba(17, 24, 39, 0.97)",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "16px",
    boxShadow: "-4px 0 24px rgba(0,0,0,0.45)",
    color: "white",
    fontFamily: "sans-serif",
};

const pillStyle = {
    border: "1px solid rgba(255,255,255,0.35)",
    borderRadius: "999px",
    color: "rgba(255,255,255,0.92)",
    display: "inline-block",
    fontSize: "0.74rem",
    fontWeight: 600,
    padding: "0.22rem 0.6rem",
};

const footerButtonStyle = {
    alignItems: "center",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: "999px",
    color: "white",
    cursor: "pointer",
    display: "flex",
    flex: 1,
    fontSize: "0.88rem",
    fontWeight: 700,
    justifyContent: "center",
    padding: "0.7rem 0.9rem",
};

// Does this event involve the country? Impacts are checked by code, prose by name.
const eventInvolvesCountry = (event, code, name) => {
    const impacts = event?.impacts ?? {};
    if ((impacts.polityChanges ?? []).some((change) => change?.code === code)) return true;
    if ((impacts.regionTransfers ?? []).some((transfer) => transfer?.toCode === code || transfer?.fromCode === code)) return true;
    if ((impacts.createdChats ?? []).some((chat) => (chat?.countries ?? []).some((country) => country?.code === code || country?.name === name))) return true;
    const haystack = `${event?.title ?? ""} ${event?.description ?? ""}`.toLowerCase();
    return Boolean(name) && haystack.includes(String(name).toLowerCase());
};

const CountryInfoPanel = () => {
    const [country, setCountry] = useState(null); // { code, name, flagUrl, flagEmoji }
    const [events, setEvents] = useState([]);
    const [aliases, setAliases] = useState([]);
    const [tags, setTags] = useState([]);
    const [regions, setRegions] = useState([]);
    const [search, setSearch] = useState("");
    const [filterIndex, setFilterIndex] = useState(0);
    const [report, setReport] = useState(null); // null | "loading" | text | {error}
    const [flagFailed, setFlagFailed] = useState(false);

    _openPanel = (next) => {
        setCountry(next);
        setSearch("");
        setFilterIndex(0);
        setReport(null);
        setFlagFailed(false);
    };

    useEffect(() => {
        if (!country) return;
        let cancelled = false;

        (async () => {
            try {
                const [allEvents, world, catalog, baseTags] = await Promise.all([
                    readEventsState({ force: true }).catch(() => []),
                    readWorldState({ force: true }),
                    loadRegionCatalog().catch(() => []),
                    getNationTags().catch(() => ({})),
                ]);
                if (cancelled) return;

                setEvents((allEvents ?? []).filter((event) => eventInvolvesCountry(event, country.code, country.name)));
                setAliases(world.polityOverrides?.[country.code]?.aliases ?? []);
                // The author's starting tags unless the AI has since rewritten them.
                setTags(resolveCountryTags(baseTags, world, country.code));

                const overrides = world.regionOwnershipOverrides ?? {};
                const owned = [];
                const seen = new Set();
                for (const region of catalog) {
                    const effective = overrides[region.id] ?? region.countryCode;
                    if (effective === country.code) {
                        owned.push(region.name);
                        seen.add(region.id);
                    }
                }
                // Overridden regions the catalog doesn't know still count.
                for (const [regionId, code] of Object.entries(overrides)) {
                    if (code === country.code && !seen.has(regionId)) owned.push(regionId);
                }
                setRegions(owned);
            } catch {
                if (!cancelled) {
                    setEvents([]);
                    setRegions([]);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [country]);

    const filteredEvents = useMemo(() => {
        const mode = FILTER_MODES[filterIndex].id;
        const query = search.trim().toLowerCase();
        return events.filter((event) => {
            if (mode !== "all" && String(event.importance).toLowerCase() !== mode) return false;
            if (query && !`${event.title} ${event.description}`.toLowerCase().includes(query)) return false;
            return true;
        });
    }, [events, filterIndex, search]);

    if (!country) return null;

    const runAdvisorReport = async () => {
        if (report === "loading") return;
        setReport("loading");
        try {
            const text = await generateCountryStats({ code: country.code, name: country.name });
            setReport(text || "No information available.");
        } catch (error) {
            setReport({ error: error?.message || "Couldn't generate a report. Set an AI provider + key in Settings." });
        }
    };

    const openDiplomacy = () => {
        requestDiplomaticChat({ name: country.name, code: country.code });
        setCountry(null);
    };

    return createPortal(
        <div
        style={{
            ...surface,
            display: "flex",
            flexDirection: "column",
            maxHeight: "calc(100vh - 5.75rem)",
            overflow: "hidden",
            position: "fixed",
            right: "0.5rem",
            top: "4.75rem",
            width: "min(28rem, calc(100vw - 1rem))",
            zIndex: 10042,
        }}
        >
        {/* Header */}
        <div style={{ alignItems: "center", display: "flex", gap: "0.6rem", padding: "1rem 1.1rem 0.8rem" }}>
        {country.flagUrl && !flagFailed ? (
            <img src={country.flagUrl} alt="" onError={() => setFlagFailed(true)} style={{ borderRadius: 4, height: "1.35rem", width: "2.1rem", objectFit: "cover" }} />
        ) : country.flagEmoji ? (
            <span style={{ fontSize: "1.3rem" }}>{country.flagEmoji}</span>
        ) : null}
        <span style={{ flex: 1, fontSize: "1.15rem", fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {country.name}
        </span>
        <button
        type="button"
        onClick={() => setCountry(null)}
        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "1.15rem", lineHeight: 1, padding: "0.2rem" }}
        >
        {"✕"}
        </button>
        </div>

        {/* Body */}
        <div style={{ display: "flex", flex: 1, flexDirection: "column", gap: "0.4rem", minHeight: 0, overflowY: "auto", padding: "0 1.1rem 1rem", scrollbarWidth: "thin" }}>
        <div style={{ alignItems: "baseline", display: "flex", justifyContent: "space-between" }}>
        <div style={{ fontSize: "1rem", fontWeight: 800 }}>Related Events</div>
        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.75rem" }}>{filteredEvents.length} shown</div>
        </div>
        <div style={{ display: "flex", gap: "0.45rem" }}>
        <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search events..."
        style={{ background: "rgba(0,0,0,0.28)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "white", flex: 1, fontSize: "0.82rem", outline: "none", padding: "0.55rem 0.7rem" }}
        />
        <button
        type="button"
        onClick={() => setFilterIndex((filterIndex + 1) % FILTER_MODES.length)}
        title="Filter by importance"
        style={{ ...footerButtonStyle, borderRadius: 8, flex: "none", fontSize: "0.78rem", padding: "0.45rem 0.7rem" }}
        >
        {"ⱶ"} {FILTER_MODES[filterIndex].id === "all" ? "Filters" : FILTER_MODES[filterIndex].label}
        </button>
        </div>

        {filteredEvents.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.8rem", padding: "0.3rem 0 0.4rem" }}>
            No events found for this country.
            </div>
        ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem", padding: "0.2rem 0 0.4rem" }}>
            {filteredEvents.slice(0, 30).map((event) => (
                <div key={event.id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.55rem 0.7rem" }}>
                <div style={{ alignItems: "baseline", display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>{event.title}</span>
                <span style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0, fontSize: "0.68rem" }}>{event.date}</span>
                </div>
                {event.description && (
                    <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.74rem", lineHeight: 1.5, marginTop: "0.2rem" }}>
                    {String(event.description).length > 220 ? `${String(event.description).slice(0, 220)}…` : event.description}
                    </div>
                )}
                </div>
            ))}
            </div>
        )}

        {tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.5rem" }}>
            {tags.map((tag) => (
                <span
                    key={tag}
                    style={{ ...pillStyle, background: "rgba(124,58,237,0.22)", borderColor: "rgba(124,58,237,0.5)" }}
                    title="What this country is — the map-maker set this, and the AI reads it as context"
                >
                    {tag}
                </span>
            ))}
            </div>
        )}

        <div style={{ fontSize: "1rem", fontWeight: 800, marginTop: "0.5rem" }}>Details</div>
        <div style={{ display: "grid", gap: "0.8rem", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)" }}>
        <div>
        <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.35rem" }}>Alternative Names</div>
        {aliases.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.78rem" }}>None</div>
        ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
            {aliases.map((alias) => (
                <span key={alias} style={pillStyle}>{alias}</span>
            ))}
            </div>
        )}
        </div>
        <div>
        <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.35rem" }}>Regions Owned ({regions.length})</div>
        {regions.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.78rem" }}>None</div>
        ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
            {regions.slice(0, 80).map((regionName) => (
                <span key={regionName} style={pillStyle}>{regionName}</span>
            ))}
            {regions.length > 80 && <span style={{ ...pillStyle, opacity: 0.6 }}>+{regions.length - 80} more</span>}
            </div>
        )}
        </div>
        </div>

        {report !== null && (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, marginTop: "0.6rem", padding: "0.7rem 0.8rem" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.3rem" }}>Advisor Report</div>
            {report === "loading" ? (
                <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.78rem" }}>Preparing the report…</div>
            ) : report?.error ? (
                <div style={{ color: "#f87171", fontSize: "0.78rem" }}>{report.error}</div>
            ) : (
                <div className="timeline-markdown" style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.79rem", lineHeight: 1.55 }}>
                <ReactMarkdown>{String(report)}</ReactMarkdown>
                </div>
            )}
            </div>
        )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: "0.6rem", padding: "0.8rem 1.1rem" }}>
        <button type="button" onClick={runAdvisorReport} style={footerButtonStyle}>
        Advisor Report
        </button>
        <button type="button" onClick={openDiplomacy} style={{ ...footerButtonStyle, background: "rgba(124,58,237,0.3)", border: "1px solid rgba(168,85,247,0.65)" }}>
        Open Diplomacy
        </button>
        </div>
        </div>,
        document.body,
    );
};

export default CountryInfoPanel;
