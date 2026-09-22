/*! Open Historia — scenario-defined National Stats sheet editor © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useMemo, useState } from "react";
import {
  MAX_CUSTOM_STATS,
  MAX_STAT_SECTIONS,
  MAX_STATS_PER_SECTION,
  STAT_KINDS,
  defaultCustomStatSheetDefinition,
  flattenStatSheetRows,
  normalizeStatSheetDefinition,
  toStatIndexKey,
} from "../../runtime/statIndexDefinitions.js";

const clean = (value) => String(value ?? "").trim();

const buttonStyle = (accent = false) => ({
  alignItems: "center",
  background: accent ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.06)",
  border: `1px solid ${accent ? "rgba(255,255,255,0.21)" : "rgba(255,255,255,0.09)"}`,
  borderRadius: "9px",
  color: "rgba(255,255,255,0.88)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.72rem",
  fontWeight: 750,
  gap: "0.35rem",
  justifyContent: "center",
  minHeight: "2rem",
  padding: "0 0.7rem",
});

const inputStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "9px",
  color: "#f8fafc",
  fontSize: "0.78rem",
  outline: "none",
  padding: "0.56rem 0.62rem",
  width: "100%",
};

const labelStyle = {
  color: "rgba(255,255,255,0.48)",
  display: "block",
  fontSize: "0.58rem",
  fontWeight: 800,
  marginBottom: "0.25rem",
  textTransform: "uppercase",
};

// Native form controls can ignore inherited dark-theme colors, especially the
// Windows/Chromium select popup. Keep the whole Stats editor surface explicit
// so dropdown options, placeholders and disabled controls remain readable.
const statsEditorControlCss = `
  .oh-stats-sheet-editor input:not([type="checkbox"]):not([type="color"]),
  .oh-stats-sheet-editor select,
  .oh-stats-sheet-editor textarea {
    background-color: #20242b !important;
    border-color: rgba(255,255,255,0.13) !important;
    color: #f8fafc !important;
    -webkit-text-fill-color: #f8fafc !important;
    caret-color: #f8fafc;
    color-scheme: dark;
  }

  .oh-stats-sheet-editor select {
    color-scheme: dark;
  }

  .oh-stats-sheet-editor select option,
  .oh-stats-sheet-editor select optgroup {
    background-color: #20242b !important;
    color: #f8fafc !important;
    -webkit-text-fill-color: #f8fafc !important;
  }

  .oh-stats-sheet-editor input::placeholder,
  .oh-stats-sheet-editor textarea::placeholder {
    color: #9ca3af !important;
    -webkit-text-fill-color: #9ca3af !important;
    opacity: 1;
  }

  .oh-stats-sheet-editor input:focus,
  .oh-stats-sheet-editor select:focus,
  .oh-stats-sheet-editor textarea:focus {
    border-color: rgba(255,255,255,0.28) !important;
    box-shadow: 0 0 0 2px rgba(0,0,0,0.1);
  }

  .oh-stats-sheet-editor input:disabled,
  .oh-stats-sheet-editor input[readonly],
  .oh-stats-sheet-editor select:disabled,
  .oh-stats-sheet-editor textarea:disabled,
  .oh-stats-sheet-editor textarea[readonly] {
    background-color: #181b20 !important;
    color: #aeb4be !important;
    -webkit-text-fill-color: #aeb4be !important;
    opacity: 0.78;
  }

  .oh-stats-sheet-editor input[type="checkbox"] {
    accent-color: #d4d4d8;
    color-scheme: dark;
  }

  .oh-stats-sheet-editor input[type="color"] {
    background-color: #20242b !important;
    border-color: rgba(255,255,255,0.13) !important;
    color-scheme: dark;
  }

  .oh-stats-stat-editor > * {
    min-width: 0;
  }

  .oh-stats-sheet-editor code {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
`;

const deepCloneDefinition = (definition) => ({
  custom: Boolean(definition?.custom),
  version: definition?.version || 2,
  sections: (definition?.sections || []).map((section) => ({
    ...section,
    stats: (section.stats || []).map((stat) => ({ ...stat })),
  })),
});

const allKeys = (sections) => new Set(
  sections.flatMap((section) => section.stats || []).map((stat) => clean(stat.key).toLowerCase()).filter(Boolean),
);

const uniqueKeyFor = (label, sections, exceptKey = "") => {
  const used = allKeys(sections);
  if (exceptKey) used.delete(clean(exceptKey).toLowerCase());
  const base = toStatIndexKey(label) || "stat";
  let key = base;
  let suffix = 2;
  while (used.has(key.toLowerCase())) {
    const tail = String(suffix);
    key = `${base.slice(0, Math.max(1, 40 - tail.length))}${tail}`;
    suffix += 1;
  }
  return key;
};

const uniqueSectionKeyFor = (label, sections, exceptKey = "") => {
  const used = new Set(sections.map((section) => clean(section.key).toLowerCase()).filter(Boolean));
  if (exceptKey) used.delete(clean(exceptKey).toLowerCase());
  const base = toStatIndexKey(label) || "section";
  let key = base;
  let suffix = 2;
  while (used.has(key.toLowerCase())) {
    const tail = String(suffix);
    key = `${base.slice(0, Math.max(1, 40 - tail.length))}${tail}`;
    suffix += 1;
  }
  return key;
};

const compactPreviewValue = (stat) => {
  if (stat.kind === "index") return "67/100";
  if (stat.kind === "percentage") return `${stat.prefix || ""}42${stat.suffix || "%"}`;
  if (stat.kind === "currency") return `${stat.prefix || "¤"}${stat.compact ? "4.2K" : "4,200"}${stat.suffix || ""}`;
  return `${stat.prefix || ""}${stat.compact ? "18.6K" : "18,600"}${stat.suffix ? ` ${stat.suffix}` : ""}`;
};

const StatPreview = ({ stat }) => (
  <div style={{ flex: "1 1 0", maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
    <div style={{ alignItems: "center", display: "flex", gap: "0.4rem", minWidth: 0, overflow: "hidden" }}>
      <span aria-hidden="true" style={{ flex: "0 0 auto", fontSize: "0.9rem", width: "1.15rem" }}>{stat.icon || "◆"}</span>
      <span style={{ color: "rgba(255,255,255,0.91)", flex: "1 1 8rem", fontSize: "0.76rem", fontWeight: 780, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stat.label}</span>
      <span style={{ color: "rgba(255,255,255,0.28)", flex: "0 1 7rem", fontFamily: "monospace", fontSize: "0.58rem", maxWidth: "35%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stat.key}</span>
      <span style={{ color: "rgba(255,255,255,0.45)", flex: "0 1 auto", fontSize: "0.64rem", fontWeight: 800, marginLeft: "auto", maxWidth: "40%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{compactPreviewValue(stat)}</span>
    </div>
    {stat.kind === "index" && (
      <div style={{ background: "rgba(255,255,255,0.09)", borderRadius: "999px", height: "5px", marginTop: "0.4rem", overflow: "hidden" }}>
        <div style={{ background: stat.color || "rgba(255,255,255,0.22)", borderRadius: "999px", height: "100%", width: "67%" }} />
      </div>
    )}
    {stat.description && <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.62rem", lineHeight: 1.35, marginTop: "0.34rem", overflowWrap: "anywhere" }}>{stat.description}</div>}
  </div>
);

const StatEditor = ({ stat, onPatch }) => (
  <div className="oh-stats-stat-editor" style={{ borderTop: "1px solid rgba(255,255,255,0.07)", display: "grid", gap: "0.58rem", gridTemplateColumns: "repeat(auto-fit, minmax(min(7rem, 100%), 1fr))", marginTop: "0.62rem", maxWidth: "100%", minWidth: 0, paddingTop: "0.62rem", width: "100%" }}>
    <div>
      <label style={labelStyle}>Name</label>
      <input value={stat.label} maxLength={60} onChange={(event) => onPatch({ label: event.target.value })} style={inputStyle} />
    </div>
    <div>
      <label style={labelStyle}>Type</label>
      <select value={stat.kind || "index"} onChange={(event) => onPatch({ kind: event.target.value })} style={inputStyle}>
        <option value="index">0–100 index</option>
        <option value="number">Number</option>
        <option value="percentage">Percentage</option>
        <option value="currency">Currency/value</option>
      </select>
    </div>
    <div>
      <label style={labelStyle}>Icon</label>
      <input value={stat.icon || ""} maxLength={8} onChange={(event) => onPatch({ icon: event.target.value })} style={{ ...inputStyle, textAlign: "center" }} />
    </div>
    <div>
      <label style={labelStyle}>Colour</label>
      <input type="color" value={stat.color || "#94a3b8"} onChange={(event) => onPatch({ color: event.target.value })} style={{ ...inputStyle, height: "2.25rem", padding: "0.16rem" }} />
    </div>

    {stat.kind !== "index" && (
      <>
        <div>
          <label style={labelStyle}>Prefix</label>
          <input value={stat.prefix || ""} maxLength={12} onChange={(event) => onPatch({ prefix: event.target.value })} placeholder="€, $, £" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Suffix / unit</label>
          <input value={stat.suffix || ""} maxLength={24} onChange={(event) => onPatch({ suffix: event.target.value })} placeholder="%, tonnes, ships" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Decimals</label>
          <input type="number" min="0" max="4" value={stat.decimals ?? 0} onChange={(event) => onPatch({ decimals: Number(event.target.value) })} style={inputStyle} />
        </div>
        <div style={{ alignItems: "flex-end", display: "flex" }}>
          <label style={{ alignItems: "center", color: "rgba(255,255,255,0.58)", display: "flex", fontSize: "0.67rem", gap: "0.4rem", minHeight: "2.25rem" }}>
            <input type="checkbox" checked={Boolean(stat.compact)} onChange={(event) => onPatch({ compact: event.target.checked })} /> Compact K/M/B/T
          </label>
        </div>
        <div>
          <label style={labelStyle}>Minimum</label>
          <input type="number" value={stat.minimum ?? ""} onChange={(event) => onPatch({ minimum: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="unbounded" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Maximum</label>
          <input type="number" value={stat.maximum ?? ""} onChange={(event) => onPatch({ maximum: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="unbounded" style={inputStyle} />
        </div>
      </>
    )}

    <div style={{ gridColumn: "1 / -1" }}>
      <label style={labelStyle}>What it tracks / AI guidance</label>
      <textarea value={stat.description || ""} maxLength={360} rows={2} onChange={(event) => onPatch({ description: event.target.value })} placeholder="Explain what this value means in this scenario and what kinds of events should move it." style={{ ...inputStyle, resize: "vertical" }} />
    </div>
    <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.6rem", gridColumn: "1 / -1", minWidth: 0, overflowWrap: "anywhere" }}>
      Machine key: <code>{stat.key}</code>{stat.isNew ? " · follows the name until the scenario is saved, then freezes" : " · frozen so renaming does not break campaign history"}
    </div>
  </div>
);

const StatsSheetEditor = ({ value, onChange }) => {
  const normalized = useMemo(() => normalizeStatSheetDefinition(value), [value]);
  const custom = Boolean(value?.custom ?? normalized.custom);
  const sections = useMemo(() => {
    if (!custom) return defaultCustomStatSheetDefinition().sections;
    // While editing, keep raw draft metadata and empty newly-created sections.
    // normalizeStatSheetDefinition intentionally strips UI-only fields and empty
    // sections for persistence, which would otherwise freeze a new key after the
    // first keystroke or make a just-added section disappear before a stat can be
    // placed in it. Save normalizes the final definition and freezes its keys.
    if (Array.isArray(value?.sections)) {
      return value.sections.map((section) => ({
        ...section,
        stats: Array.isArray(section?.stats) ? section.stats.map((stat) => ({ ...stat })) : [],
      }));
    }
    return deepCloneDefinition(normalized).sections;
  }, [custom, normalized, value]);
  const [editingStatKey, setEditingStatKey] = useState("");
  const [editingSectionKey, setEditingSectionKey] = useState("");
  const [dragItem, setDragItem] = useState(null);

  const emitSections = (nextSections) => onChange?.({ custom: true, version: 2, sections: nextSections });

  const enableCustom = () => {
    setEditingStatKey("");
    setEditingSectionKey("");
    onChange?.(defaultCustomStatSheetDefinition());
  };

  const useStandard = () => {
    setEditingStatKey("");
    setEditingSectionKey("");
    onChange?.({ custom: false, version: 2, sections: defaultCustomStatSheetDefinition().sections });
  };

  const patchSection = (sectionKey, patch) => {
    const next = sections.map((section) => {
      if (section.key !== sectionKey) return section;
      const candidate = { ...section, ...patch };
      if (section.isNew && Object.prototype.hasOwnProperty.call(patch, "label")) {
        candidate.key = uniqueSectionKeyFor(patch.label, sections, sectionKey);
      }
      return candidate;
    });
    const changed = next.find((section) => section.key !== sectionKey && section.draftId && section.draftId === sections.find((entry) => entry.key === sectionKey)?.draftId);
    emitSections(next);
    if (editingSectionKey === sectionKey && changed) setEditingSectionKey(changed.key);
  };

  const addSection = () => {
    if (sections.length >= MAX_STAT_SECTIONS || flattenStatSheetRows({ custom: true, sections }).length >= MAX_CUSTOM_STATS) return;
    const label = "New section";
    const key = uniqueSectionKeyFor(label, sections);
    const draftId = `section-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    emitSections([...sections, { key, label, icon: "◆", isNew: true, draftId, stats: [] }]);
    setEditingSectionKey(key);
  };

  const removeSection = (sectionKey) => {
    if (sections.length <= 1) return;
    emitSections(sections.filter((section) => section.key !== sectionKey));
    if (editingSectionKey === sectionKey) setEditingSectionKey("");
  };

  const addStat = (sectionKey) => {
    const total = flattenStatSheetRows({ custom: true, sections }).length;
    const section = sections.find((entry) => entry.key === sectionKey);
    if (!section || total >= MAX_CUSTOM_STATS || section.stats.length >= MAX_STATS_PER_SECTION) return;
    const label = "New statistic";
    const key = uniqueKeyFor(label, sections);
    const draftId = `stat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const stat = { key, label, kind: "index", icon: "◆", color: "#94a3b8", description: "", decimals: 0, isNew: true, draftId };
    emitSections(sections.map((entry) => entry.key === sectionKey ? { ...entry, stats: [...entry.stats, stat] } : entry));
    setEditingStatKey(key);
  };

  const patchStat = (sectionKey, statKey, patch) => {
    let nextKey = statKey;
    const next = sections.map((section) => {
      if (section.key !== sectionKey) return section;
      return {
        ...section,
        stats: section.stats.map((stat) => {
          if (stat.key !== statKey) return stat;
          const candidate = { ...stat, ...patch };
          if (stat.isNew && Object.prototype.hasOwnProperty.call(patch, "label")) {
            candidate.key = uniqueKeyFor(patch.label, sections, statKey);
          }
          if (!STAT_KINDS.includes(candidate.kind)) candidate.kind = "index";
          if (Object.prototype.hasOwnProperty.call(patch, "kind") && candidate.kind !== stat.kind) {
            if (candidate.kind === "index") {
              candidate.minimum = 0;
              candidate.maximum = 100;
              candidate.decimals = 0;
              candidate.prefix = "";
              candidate.suffix = "";
            } else if (candidate.kind === "percentage") {
              candidate.minimum = 0;
              candidate.maximum = 100;
              candidate.decimals = Math.max(0, Number(candidate.decimals) || 0);
              if (!candidate.suffix) candidate.suffix = "%";
            } else {
              // Leaving a bounded index/percentage should not silently leave a
              // 0–100 clamp on a population, treasury, tonnage, ship count, etc.
              if (stat.kind === "index" || stat.kind === "percentage") {
                delete candidate.minimum;
                delete candidate.maximum;
              }
              if (candidate.kind === "currency" && stat.kind === "percentage" && candidate.suffix === "%") candidate.suffix = "";
            }
          } else if (candidate.kind === "index") {
            candidate.minimum = 0;
            candidate.maximum = 100;
            candidate.decimals = 0;
          }
          nextKey = candidate.key;
          return candidate;
        }),
      };
    });
    emitSections(next);
    if (editingStatKey === statKey && nextKey !== statKey) setEditingStatKey(nextKey);
  };

  const removeStat = (sectionKey, statKey) => {
    const total = flattenStatSheetRows({ custom: true, sections }).length;
    if (total <= 1) return;
    emitSections(sections.map((section) => section.key === sectionKey
      ? { ...section, stats: section.stats.filter((stat) => stat.key !== statKey) }
      : section));
    if (editingStatKey === statKey) setEditingStatKey("");
  };

  const moveSection = (sourceKey, targetKey) => {
    const sourceIndex = sections.findIndex((section) => section.key === sourceKey);
    const targetIndex = sections.findIndex((section) => section.key === targetKey);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    const next = [...sections];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    emitSections(next);
  };

  const moveStat = (sourceSectionKey, statKey, targetSectionKey, targetStatKey = "") => {
    if (!sourceSectionKey || !statKey || !targetSectionKey) return;
    const sourceSection = sections.find((section) => section.key === sourceSectionKey);
    const targetSection = sections.find((section) => section.key === targetSectionKey);
    if (!sourceSection || !targetSection) return;
    const stat = sourceSection.stats.find((entry) => entry.key === statKey);
    if (!stat) return;
    if (sourceSectionKey !== targetSectionKey && targetSection.stats.length >= MAX_STATS_PER_SECTION) return;

    const next = sections.map((section) => ({ ...section, stats: [...section.stats] }));
    const nextSource = next.find((section) => section.key === sourceSectionKey);
    const nextTarget = next.find((section) => section.key === targetSectionKey);
    const sourceIndex = nextSource.stats.findIndex((entry) => entry.key === statKey);
    const [moved] = nextSource.stats.splice(sourceIndex, 1);
    let targetIndex = targetStatKey ? nextTarget.stats.findIndex((entry) => entry.key === targetStatKey) : nextTarget.stats.length;
    if (targetIndex < 0) targetIndex = nextTarget.stats.length;
    if (sourceSectionKey === targetSectionKey && sourceIndex < targetIndex) targetIndex -= 1;
    nextTarget.stats.splice(targetIndex, 0, moved);
    emitSections(next);
  };

  const totalStats = flattenStatSheetRows({ custom: true, sections }).length;

  return (
    <div className="oh-stats-sheet-editor" style={{ display: "grid", gap: "0.8rem", maxWidth: "100%", minWidth: 0, width: "100%" }}>
      <style>{statsEditorControlCss}</style>
      <div style={{ background: "rgba(59,130,246,0.07)", border: "1px solid rgba(96,165,250,0.15)", borderRadius: "12px", color: "rgba(219,234,254,0.74)", fontSize: "0.7rem", lineHeight: 1.5, padding: "0.72rem 0.78rem" }}>
        The standard sheet is Open Historia&apos;s modern audited economy/statistics model. Customize it to make the entire National Stats panel scenario-defined: add, remove and reorder sections and values for any era. Custom sheets use general-purpose persistent numeric stats, so a medieval scenario can track timber, silver, grain, ships or legitimacy without being forced to generate modern GDP or unemployment.
      </div>

      {!custom && (
        <div style={{ alignItems: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", display: "flex", gap: "0.75rem", justifyContent: "space-between", padding: "0.75rem" }}>
          <div>
            <div style={{ fontSize: "0.78rem", fontWeight: 820 }}>Standard National Stats sheet</div>
            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.64rem", lineHeight: 1.4, marginTop: "0.18rem" }}>Uses the current audited population/GDP engine, strategic indices, and modern economy fields.</div>
          </div>
          <button type="button" onClick={enableCustom} style={buttonStyle(true)}>Customize full sheet</button>
        </div>
      )}

      {custom && sections.map((section) => {
        const sectionEditing = editingSectionKey === section.key;
        return (
          <div
            key={section.draftId || section.key}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const raw = event.dataTransfer.getData("application/x-oh-stat") || event.dataTransfer.getData("text/plain");
              try {
                const item = JSON.parse(raw);
                if (item.type === "section") moveSection(item.sectionKey, section.key);
                if (item.type === "stat") moveStat(item.sectionKey, item.statKey, section.key);
              } catch {
                // Ignore unrelated drags.
              }
              setDragItem(null);
            }}
            style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${dragItem?.sectionKey === section.key ? "rgba(255,255,255,0.23)" : "rgba(255,255,255,0.08)"}`, borderRadius: "13px", maxWidth: "100%", minWidth: 0, overflow: "hidden", width: "100%" }}
          >
            <div style={{ alignItems: "center", background: "rgba(255,255,255,0.03)", display: "flex", gap: "0.5rem", maxWidth: "100%", minWidth: 0, padding: "0.62rem 0.65rem" }}>
              <button
                type="button"
                draggable
                aria-label={`Drag section ${section.label}`}
                title="Drag section"
                onDragStart={(event) => {
                  const item = { type: "section", sectionKey: section.key };
                  setDragItem(item);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-oh-stat", JSON.stringify(item));
                  event.dataTransfer.setData("text/plain", JSON.stringify(item));
                }}
                onDragEnd={() => setDragItem(null)}
                style={{ ...buttonStyle(false), cursor: "grab", flex: "0 0 auto", minWidth: "2rem", padding: 0 }}
              >☰</button>
              <span style={{ fontSize: "0.9rem" }}>{section.icon || "◆"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.72rem", fontWeight: 850, letterSpacing: "0.06em", overflow: "hidden", textOverflow: "ellipsis", textTransform: "uppercase", whiteSpace: "nowrap" }}>{section.label}</div>
                <div style={{ color: "rgba(255,255,255,0.28)", fontFamily: "monospace", fontSize: "0.56rem", marginTop: "0.1rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{section.key} · {section.stats.length} stat{section.stats.length === 1 ? "" : "s"}</div>
              </div>
              <button type="button" title="Edit section" onClick={() => setEditingSectionKey(sectionEditing ? "" : section.key)} style={{ ...buttonStyle(false), flex: "0 0 auto", minWidth: "2rem", padding: 0 }}>✎</button>
              <button type="button" title={sections.length <= 1 ? "A custom sheet needs at least one section" : "Delete section"} disabled={sections.length <= 1} onClick={() => removeSection(section.key)} style={{ ...buttonStyle(false), color: "#fca5a5", flex: "0 0 auto", minWidth: "2rem", opacity: sections.length <= 1 ? 0.4 : 1, padding: 0 }}>🗑</button>
            </div>

            {sectionEditing && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", display: "grid", gap: "0.55rem", gridTemplateColumns: "minmax(0,1fr) 5rem", padding: "0.62rem" }}>
                <div>
                  <label style={labelStyle}>Section name</label>
                  <input value={section.label} maxLength={60} onChange={(event) => patchSection(section.key, { label: event.target.value })} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Icon</label>
                  <input value={section.icon || ""} maxLength={8} onChange={(event) => patchSection(section.key, { icon: event.target.value })} style={{ ...inputStyle, textAlign: "center" }} />
                </div>
                <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "0.6rem", gridColumn: "1 / -1" }}>Section key: <code>{section.key}</code></div>
              </div>
            )}

            <div style={{ display: "grid", gap: "0.48rem", maxWidth: "100%", minWidth: 0, padding: "0.58rem" }}>
              {section.stats.map((stat) => {
                const editing = editingStatKey === stat.key;
                return (
                  <div
                    key={stat.draftId || stat.key}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const raw = event.dataTransfer.getData("application/x-oh-stat") || event.dataTransfer.getData("text/plain");
                      try {
                        const item = JSON.parse(raw);
                        if (item.type === "stat") moveStat(item.sectionKey, item.statKey, section.key, stat.key);
                      } catch {
                        // Ignore unrelated drags.
                      }
                      setDragItem(null);
                    }}
                    style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${dragItem?.statKey === stat.key ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.07)"}`, borderRadius: "11px", maxWidth: "100%", minWidth: 0, padding: "0.6rem" }}
                  >
                    <div style={{ alignItems: "flex-start", display: "flex", gap: "0.5rem", maxWidth: "100%", minWidth: 0 }}>
                      <button
                        type="button"
                        draggable
                        aria-label={`Drag ${stat.label}`}
                        title="Drag to reorder or move to another section"
                        onDragStart={(event) => {
                          const item = { type: "stat", sectionKey: section.key, statKey: stat.key };
                          setDragItem(item);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("application/x-oh-stat", JSON.stringify(item));
                          event.dataTransfer.setData("text/plain", JSON.stringify(item));
                        }}
                        onDragEnd={() => setDragItem(null)}
                        style={{ ...buttonStyle(false), cursor: "grab", flex: "0 0 auto", minWidth: "2rem", padding: 0 }}
                      >☰</button>
                      <StatPreview stat={stat} />
                      <div style={{ display: "flex", flex: "0 0 auto", gap: "0.32rem" }}>
                        <button type="button" aria-label={`Edit ${stat.label}`} title="Edit" onClick={() => setEditingStatKey(editing ? "" : stat.key)} style={{ ...buttonStyle(false), minWidth: "2rem", padding: 0 }}>✎</button>
                        <button type="button" aria-label={`Delete ${stat.label}`} title={totalStats <= 1 ? "A custom sheet needs at least one statistic" : "Delete"} disabled={totalStats <= 1} onClick={() => removeStat(section.key, stat.key)} style={{ ...buttonStyle(false), color: "#fca5a5", minWidth: "2rem", opacity: totalStats <= 1 ? 0.4 : 1, padding: 0 }}>🗑</button>
                      </div>
                    </div>
                    {editing && <StatEditor stat={stat} onPatch={(patch) => patchStat(section.key, stat.key, patch)} />}
                  </div>
                );
              })}

              <button type="button" disabled={section.stats.length >= MAX_STATS_PER_SECTION || totalStats >= MAX_CUSTOM_STATS} onClick={() => addStat(section.key)} style={{ ...buttonStyle(true), justifySelf: "start", opacity: section.stats.length >= MAX_STATS_PER_SECTION || totalStats >= MAX_CUSTOM_STATS ? 0.45 : 1 }}>+ Add statistic</button>
            </div>
          </div>
        );
      })}

      {custom && (
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            <button type="button" onClick={addSection} disabled={sections.length >= MAX_STAT_SECTIONS || totalStats >= MAX_CUSTOM_STATS} style={{ ...buttonStyle(true), opacity: sections.length >= MAX_STAT_SECTIONS || totalStats >= MAX_CUSTOM_STATS ? 0.45 : 1 }}>+ Add section</button>
            <button type="button" onClick={useStandard} style={buttonStyle(false)}>Use standard sheet</button>
          </div>
          <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.61rem" }}>{sections.length}/{MAX_STAT_SECTIONS} sections · {totalStats}/{MAX_CUSTOM_STATS} stats</span>
        </div>
      )}
    </div>
  );
};

export const normalizeStatsEditorValue = (raw) => {
  const definition = normalizeStatSheetDefinition(raw);
  return definition.custom
    ? deepCloneDefinition(definition)
    : { custom: false, version: 2, sections: defaultCustomStatSheetDefinition().sections };
};

export default StatsSheetEditor;
