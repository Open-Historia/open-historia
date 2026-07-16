/*! Open Historia — portions (map-editor embed, apply-to-scenario, country picker) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  PROMPT_SECTION_DEFINITIONS,
  normalizePromptPack,
  serializePromptPack,
} from "../AI/gameplayPrompts.js";
import {
  activateGame,
  clearGameAsset,
  clearScenarioAsset,
  createGame,
  createScenario,
  downloadScenarioJsonAsset,
  ensureLibraryCatalog,
  exportScenarioBundle,
  importScenarioBundle,
  loadGameDetails,
  loadScenarioDetails,
  refreshLibraryCatalog,
  removeGame,
  removeScenario,
  saveGame,
  saveScenario,
  selectScenario,
  uploadGameAsset,
  uploadScenarioAsset,
  useLibraryState,
} from "../../runtime/library.js";
import { loadCountryNames } from "../../runtime/assets.js";
import { UNIT_TYPES } from "../../runtime/gameState.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { DIFFICULTY_LEVELS } from "../../runtime/difficulty.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { flagEmojiFromGid } from "../../runtime/countryFlags.js";

const UNIT_TYPE_LABELS = {
  infantry: "Infantry",
  armor: "Armor",
  air: "Air Force",
  naval: "Naval",
  artillery: "Artillery",
  garrison: "Garrison",
};

// Lazy so OpenLayers only loads when the in-game map editor is opened.
const MapEditor = lazy(() => import("../../Editor/MapEditor.jsx"));
// Lazy so the GitHub-backed Community tab costs nothing until opened.
const CommunityPanel = lazy(() => import("./communityHub.jsx"));
// Lazy so OpenLayers only loads when the country picker map is opened.
const CountryPickerMap = lazy(() => import("./CountryPickerMap.jsx"));

const BAR_HEIGHT = 64;
const TECHNICAL_OWNER_CODES = new Set([
  "NA",
  "XCA",
  "Z01",
  "Z02",
  "Z03",
  "Z04",
  "Z05",
  "Z06",
  "Z07",
  "Z08",
  "Z09",
]);

// Set by the mounted LibraryTopBar; lets the no-game gate open a tab.
let _openLibraryTab = null;
export const openLibraryTab = (tab) => {
  _openLibraryTab?.(tab);
};
const TOP_BAR_OFFSET = "4.75rem";

const surfaceStyle = {
  background:
    "linear-gradient(180deg, rgba(8, 10, 17, 0.97) 0%, rgba(8, 10, 15, 0.94) 100%)",
  border: "1px solid rgba(255,255,255,0.08)",
  boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
};

const actionButtonStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "999px",
  color: "rgba(244,246,255,0.92)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.82rem",
  fontWeight: 600,
  gap: "0.4rem",
  justifyContent: "center",
  minHeight: "2.1rem",
  padding: "0 0.95rem",
  transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease",
};

const fieldLabelStyle = {
  color: "rgba(255,255,255,0.72)",
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 600,
  letterSpacing: "0.04em",
  marginBottom: "0.45rem",
  textTransform: "uppercase",
};

const inputStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  color: "#f8fafc",
  fontSize: "0.9rem",
  outline: "none",
  padding: "0.8rem 0.9rem",
  width: "100%",
};

const textareaStyle = {
  ...inputStyle,
  minHeight: "8rem",
  resize: "vertical",
};

const IMAGE_UPLOAD_ACCEPT = ".avif,.gif,.jpeg,.jpg,.png,.webp";

const scenarioBadgeLabels = {
  cities: "Cities PMTiles",
  colors: "Colors JSON",
  countries: "Countries PMTiles",
  regions: "Regions PMTiles",
};

const scenarioAssetLabels = {
  cover: "Cover Image",
  ...scenarioBadgeLabels,
};

const scenarioAssetAccept = {
  cover: IMAGE_UPLOAD_ACCEPT,
  cities: ".pmtiles",
  colors: ".json",
  countries: ".pmtiles",
  regions: ".pmtiles",
};

const gameAssetLabels = {
  cover: "Cover Image",
};

const gameAssetAccept = {
  cover: IMAGE_UPLOAD_ACCEPT,
};

const editorSectionLabels = {
  assets: "Assets",
  bundles: "Bundles",
  overview: "Overview",
  prompts: "Prompts",
  world: "World",
};

const normalizeString = (value) => String(value ?? "").trim();

const buildScenarioEditorState = (details) => {
  const scenario = details?.scenario ?? {};
  const game = details?.data?.game ?? {};
  const prompts = normalizePromptPack(details?.data?.prompts ?? {});
  const world = details?.data?.world ?? {};

  return {
    accentColor: scenario.accentColor ?? "#7c3aed",
    allowedUnitTypes: Array.isArray(world.allowedUnitTypes) ? world.allowedUnitTypes : [...UNIT_TYPES],
    country: game.country ?? "",
    description: scenario.description ?? "",
    eyebrow: scenario.eyebrow ?? "",
    gameDate: game.gameDate ?? "",
    heroSubtitle: scenario.heroSubtitle ?? "",
    heroTitle: scenario.heroTitle ?? "",
    language: game.language ?? world.language ?? "English",
    name: scenario.name ?? "",
    prompts,
    simulationRules: world.simulationRules ?? "",
    startingTimelineText: world.startingTimelineText ?? "",
    subtitle: scenario.subtitle ?? "",
  };
};

const buildGameEditorState = (details) => {
  const gameMeta = details?.game ?? {};
  const game = details?.data?.game ?? {};
  const prompts = normalizePromptPack(details?.data?.prompts ?? {});
  const world = details?.data?.world ?? {};

  return {
    accentColor: gameMeta.accentColor ?? "#7c3aed",
    country: game.country ?? "",
    description: gameMeta.description ?? "",
    eyebrow: gameMeta.eyebrow ?? "",
    gameDate: game.gameDate ?? "",
    heroSubtitle: gameMeta.heroSubtitle ?? "",
    heroTitle: gameMeta.heroTitle ?? "",
    language: game.language ?? world.language ?? "English",
    name: gameMeta.name ?? "",
    prompts,
    simulationRules: world.simulationRules ?? "",
    startingTimelineText: world.startingTimelineText ?? "",
    subtitle: gameMeta.subtitle ?? "",
  };
};

const saveJsonBundleToDisk = (bundle, fileName) => {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const AssetBadgeRow = ({ badges }) =>
  badges.length > 0 ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.85rem" }}>
      {badges.map((badge) => (
        <span
          key={badge}
          style={{
            background: "rgba(255,255,255,0.14)",
            borderRadius: "999px",
            color: "rgba(255,255,255,0.9)",
            fontSize: "0.7rem",
            padding: "0.28rem 0.55rem",
          }}
        >
          {badge}
        </span>
      ))}
    </div>
  ) : null;

const PromptSectionEditor = ({
  onChangeHelper,
  onChangePrompt,
  promptPack,
  promptSectionKey,
  setPromptSectionKey,
}) => {
  const currentSection =
    PROMPT_SECTION_DEFINITIONS.find((section) => section.key === promptSectionKey) ??
    PROMPT_SECTION_DEFINITIONS[0];
  const currentValue =
    currentSection.type === "root"
      ? promptPack[currentSection.key]
      : promptPack.tasks[currentSection.key];

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "18px",
        padding: "0.9rem",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginBottom: "0.85rem" }}>
        {PROMPT_SECTION_DEFINITIONS.map((section) => (
          <button
            key={section.key}
            onClick={() => setPromptSectionKey(section.key)}
            style={{
              ...actionButtonStyle,
              background:
                section.key === currentSection.key ? "rgba(124,58,237,0.28)" : "rgba(255,255,255,0.05)",
              borderColor:
                section.key === currentSection.key ? "rgba(124,58,237,0.42)" : "rgba(255,255,255,0.08)",
              minHeight: "2rem",
              padding: "0 0.8rem",
            }}
            type="button"
          >
            {section.label}
          </button>
        ))}
      </div>

      <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>
        {currentSection.description}
      </div>

      <div style={{ marginBottom: "0.9rem" }}>
        <label style={fieldLabelStyle}>{currentSection.label} Prompt</label>
        <textarea
          style={{ ...textareaStyle, minHeight: "16rem" }}
          value={currentValue}
          onChange={(event) => onChangePrompt(currentSection, event.target.value)}
        />
      </div>

      <div style={{ display: "grid", gap: "0.8rem" }}>
        {currentSection.helpers.map((helperKey) => (
          <div key={helperKey}>
            <label style={fieldLabelStyle}>{helperKey}</label>
            <textarea
              style={{ ...textareaStyle, minHeight: "5.5rem", fontFamily: "Consolas, monospace" }}
              value={promptPack.helpers[helperKey] ?? ""}
              onChange={(event) => onChangeHelper(helperKey, event.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

const ScenarioCard = ({ onClone, onEdit, onPlay, onSelect, scenario, selected }) => {
  const isBuiltIn = scenario.id === "default";
  const assetBadges = Object.entries(scenarioBadgeLabels)
    .filter(([key]) => scenario.assetStatus?.[key])
    .map(([, label]) => label.replace(" PMTiles", "").replace(" JSON", ""));
  const cardImageUrl = scenario.coverImageUrl || "/loading_screen.jpg";

  return (
    <div
      style={{
        ...surfaceStyle,
        borderColor: selected ? `${scenario.accentColor}66` : "rgba(255,255,255,0.08)",
        borderRadius: "24px",
        flex: "0 0 21rem",
        minHeight: "15rem",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <button
        onClick={() => onSelect(scenario.id)}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          inset: 0,
          padding: 0,
          position: "absolute",
          zIndex: 1,
        }}
        type="button"
      />
      <div
        style={{
          background:
            `linear-gradient(180deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.72) 100%), ` +
            `radial-gradient(circle at 14% 18%, ${scenario.accentColor}bb, transparent 34%), ` +
            `url("${cardImageUrl}") center/cover`,
          inset: 0,
          opacity: 0.92,
          position: "absolute",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
          padding: "1.2rem",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div>
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
              <span
                style={{
                  background: selected ? `${scenario.accentColor}66` : "rgba(255,255,255,0.12)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: "999px",
                  color: "rgba(248,250,252,0.94)",
                  display: "inline-flex",
                  fontSize: "0.69rem",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  padding: "0.35rem 0.6rem",
                  textTransform: "uppercase",
                }}
              >
                {scenario.eyebrow || "Scenario"}
              </span>
              {isBuiltIn && (
                <span
                  style={{
                    background: "rgba(255,255,255,0.18)",
                    border: "1px solid rgba(255,255,255,0.22)",
                    borderRadius: "999px",
                    color: "#fff",
                    display: "inline-flex",
                    fontSize: "0.69rem",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    padding: "0.35rem 0.6rem",
                    textTransform: "uppercase",
                  }}
                >
                  Built-In
                </span>
              )}
            </div>
            <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.74rem" }}>
              {scenario.gameCount} game{scenario.gameCount === 1 ? "" : "s"}
            </span>
          </div>
          <div style={{ marginTop: "4rem" }}>
            <div
              style={{
                color: "#fff",
                fontSize: "2rem",
                fontWeight: 800,
                letterSpacing: "-0.03em",
                lineHeight: 1,
              }}
            >
              {scenario.heroTitle || scenario.name}
            </div>
            <div
              style={{
                color: "rgba(240,244,255,0.7)",
                fontSize: "0.92rem",
                lineHeight: 1.45,
                marginTop: "0.65rem",
                maxWidth: "16rem",
              }}
            >
              {scenario.heroSubtitle || scenario.description || scenario.subtitle}
            </div>
          </div>
        </div>

        <div>
          <div style={{ color: "rgba(255,255,255,0.68)", fontSize: "0.8rem", marginBottom: "0.7rem" }}>
            {scenario.subtitle}
          </div>
          <AssetBadgeRow badges={assetBadges} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem" }}>
            <button
              onClick={() => onPlay(scenario)}
              style={{
                ...actionButtonStyle,
                background: `${scenario.accentColor}cc`,
                borderColor: `${scenario.accentColor}dd`,
                color: "#fff",
                flex: 1,
              }}
              type="button"
            >
              New Game
            </button>
            <button onClick={() => onEdit(scenario.id)} style={{ ...actionButtonStyle, flex: 1 }} type="button">
              Edit
            </button>
            <button onClick={() => onClone(scenario)} style={{ ...actionButtonStyle, flexBasis: "100%" }} type="button">
              Clone Scenario
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const GameCard = ({ active, game, onActivate, onClone, onEdit }) => {
  const cardImageUrl = game.coverImageUrl || "/loading_screen.jpg";

  return (
    <div
      style={{
        ...surfaceStyle,
        borderColor: active ? `${game.accentColor}66` : "rgba(255,255,255,0.08)",
        borderRadius: "24px",
        flex: "0 0 21rem",
        minHeight: "14rem",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          background:
            `linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.72) 100%), ` +
            `radial-gradient(circle at 16% 20%, ${game.accentColor}aa, transparent 32%), ` +
            `url("${cardImageUrl}") center/cover`,
          inset: 0,
          opacity: 0.96,
          position: "absolute",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
          padding: "1.2rem",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div>
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
            <span
              style={{
                background: active ? `${game.accentColor}66` : "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "999px",
                color: "rgba(248,250,252,0.94)",
                display: "inline-flex",
                fontSize: "0.69rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                padding: "0.35rem 0.6rem",
                textTransform: "uppercase",
              }}
            >
              {active ? "Current Game" : game.eyebrow || "Game"}
            </span>
            <span style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.76rem" }}>
              {game.scenarioName}
            </span>
          </div>

          <div style={{ marginTop: "2rem" }}>
            <div style={{ color: "#fff", fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.03em" }}>
              {game.name}
            </div>
            <div style={{ color: "rgba(240,244,255,0.72)", fontSize: "0.92rem", marginTop: "0.45rem" }}>
              {game.country || "No player country"} / {game.currentDate || "No date"} / Round {game.round || 1}
            </div>
            <div style={{ color: "rgba(240,244,255,0.58)", fontSize: "0.84rem", marginTop: "0.5rem", lineHeight: 1.45 }}>
              {game.description || "Playable campaign session."}
            </div>
          </div>
        </div>

        <div>
          <div style={{ color: "rgba(255,255,255,0.68)", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
            {game.pendingActions} pending action{game.pendingActions === 1 ? "" : "s"} / {game.eventCount} event{game.eventCount === 1 ? "" : "s"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem" }}>
            <button
              onClick={() => onActivate(game.id)}
              style={{
                ...actionButtonStyle,
                background: active ? "rgba(255,255,255,0.16)" : `${game.accentColor}cc`,
                borderColor: active ? "rgba(255,255,255,0.22)" : `${game.accentColor}dd`,
                color: "#fff",
                flex: 1,
              }}
              type="button"
            >
              {active ? "Current" : "Play"}
            </button>
            <button onClick={() => onEdit(game.id)} style={{ ...actionButtonStyle, flex: 1 }} type="button">
              Edit
            </button>
            <button onClick={() => onClone(game)} style={{ ...actionButtonStyle, flexBasis: "100%" }} type="button">
              Clone Game
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const SectionTabs = ({ currentSection, sections, setSection }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginBottom: "0.95rem" }}>
    {sections.map((sectionKey) => (
      <button
        key={sectionKey}
        onClick={() => setSection(sectionKey)}
        style={{
          ...actionButtonStyle,
          background:
            currentSection === sectionKey ? "rgba(124,58,237,0.28)" : "rgba(255,255,255,0.05)",
          borderColor:
            currentSection === sectionKey ? "rgba(124,58,237,0.42)" : "rgba(255,255,255,0.08)",
          minHeight: "2rem",
          padding: "0 0.8rem",
        }}
        type="button"
      >
        {editorSectionLabels[sectionKey] || sectionKey}
      </button>
    ))}
  </div>
);

const EditorDrawer = ({
  details,
  editorError,
  editorSection,
  fileInputsRef,
  formState,
  isBusy,
  kind,
  onChange,
  onChangeHelper,
  onChangePrompt,
  onClearAsset,
  onClose,
  onDelete,
  onExportBundle,
  onFileSelect,
  onOpenFileDialog,
  onOpenMapEditor,
  onSave,
  promptSectionKey,
  setEditorSection,
  setPromptSectionKey,
}) => {
  if (!details || !formState) {
    return null;
  }

  const record = kind === "scenario" ? details.scenario : details.game;
  const visibleSections =
    kind === "scenario"
      ? ["overview", "world", "prompts", "assets", "bundles"]
      : ["overview", "world", "prompts", "assets"];

  return (
    <div
      style={{
        ...surfaceStyle,
        borderRadius: "26px",
        bottom: "0.85rem",
        color: "#fff",
        maxHeight: `calc(100vh - ${BAR_HEIGHT + 32}px)`,
        overflow: "auto",
        padding: "1.05rem",
        position: "fixed",
        right: "0.85rem",
        top: `calc(${TOP_BAR_OFFSET} + 3.5rem)`,
        width: "min(34rem, calc(100vw - 1.2rem))",
        zIndex: 10031,
      }}
    >
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {kind === "scenario" ? "Scenario" : "Game"} Editor
          </div>
          <div style={{ fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.03em", marginTop: "0.2rem" }}>
            {record.name}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ ...actionButtonStyle, background: "rgba(255,255,255,0.04)", minWidth: "2.35rem", padding: 0 }}
          type="button"
        >
          X
        </button>
      </div>

      <SectionTabs currentSection={editorSection} sections={visibleSections} setSection={setEditorSection} />

      {editorSection === "overview" && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem" }}>
          <div style={{ display: "grid", gap: "0.8rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={fieldLabelStyle}>Name</label>
              <input style={inputStyle} value={formState.name} onChange={(event) => onChange("name", event.target.value)} />
            </div>
            <div>
              <label style={fieldLabelStyle}>Eyebrow</label>
              <input style={inputStyle} value={formState.eyebrow} onChange={(event) => onChange("eyebrow", event.target.value)} />
            </div>
            <div>
              <label style={fieldLabelStyle}>Accent</label>
              <input style={{ ...inputStyle, height: "3.1rem", padding: "0.25rem 0.3rem" }} type="color" value={formState.accentColor} onChange={(event) => onChange("accentColor", event.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={fieldLabelStyle}>Subtitle</label>
              <input style={inputStyle} value={formState.subtitle} onChange={(event) => onChange("subtitle", event.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={fieldLabelStyle}>Description</label>
              <textarea style={{ ...textareaStyle, minHeight: "6rem" }} value={formState.description} onChange={(event) => onChange("description", event.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={fieldLabelStyle}>Hero Title</label>
              <input style={inputStyle} value={formState.heroTitle} onChange={(event) => onChange("heroTitle", event.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={fieldLabelStyle}>Hero Subtitle</label>
              <textarea style={{ ...textareaStyle, minHeight: "5rem" }} value={formState.heroSubtitle} onChange={(event) => onChange("heroSubtitle", event.target.value)} />
            </div>
          </div>
        </div>
      )}

      {editorSection === "world" && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem" }}>
          <div style={{ display: "grid", gap: "0.8rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <div>
              <label style={fieldLabelStyle}>Player Country</label>
              <input style={inputStyle} value={formState.country} onChange={(event) => onChange("country", event.target.value)} />
            </div>
            <div>
              <label style={fieldLabelStyle}>Game Date</label>
              <input style={inputStyle} value={formState.gameDate} onChange={(event) => onChange("gameDate", event.target.value)} />
            </div>
            <div>
              <label style={fieldLabelStyle}>Language</label>
              <input style={inputStyle} value={formState.language} onChange={(event) => onChange("language", event.target.value)} />
            </div>
            {kind === "scenario" && (
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={fieldLabelStyle}>Deployable Troop Types</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {UNIT_TYPES.map((unitType) => {
                    const checked = (formState.allowedUnitTypes ?? []).includes(unitType);
                    return (
                      <button
                        key={unitType}
                        type="button"
                        onClick={() => {
                          const set = new Set(formState.allowedUnitTypes ?? []);
                          if (set.has(unitType)) set.delete(unitType);
                          else set.add(unitType);
                          onChange("allowedUnitTypes", UNIT_TYPES.filter((t) => set.has(t)));
                        }}
                        style={{
                          ...actionButtonStyle,
                          background: checked ? "rgba(124,58,237,0.3)" : "rgba(255,255,255,0.04)",
                          borderColor: checked ? "rgba(124,58,237,0.5)" : "rgba(255,255,255,0.1)",
                          minHeight: "2rem",
                          padding: "0 0.7rem",
                        }}
                      >
                        {checked ? "✓ " : ""}
                        {UNIT_TYPE_LABELS[unitType] ?? unitType}
                      </button>
                    );
                  })}
                </div>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem", marginTop: "0.4rem" }}>
                  Uncheck types that don't fit the era — e.g. no Air Force in 1200. Players can only deploy the checked types.
                </div>
              </div>
            )}
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={fieldLabelStyle}>World Before Round One</label>
              <textarea style={{ ...textareaStyle, minHeight: "8rem" }} value={formState.startingTimelineText} onChange={(event) => onChange("startingTimelineText", event.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={fieldLabelStyle}>Simulation Rules</label>
              <textarea style={{ ...textareaStyle, minHeight: "8rem" }} value={formState.simulationRules} onChange={(event) => onChange("simulationRules", event.target.value)} />
            </div>
          </div>
        </div>
      )}

      {editorSection === "prompts" && (
        <PromptSectionEditor
          onChangeHelper={onChangeHelper}
          onChangePrompt={onChangePrompt}
          promptPack={formState.prompts}
          promptSectionKey={promptSectionKey}
          setPromptSectionKey={setPromptSectionKey}
        />
      )}

      {editorSection === "assets" && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem" }}>
          <div style={{ display: "grid", gap: "0.7rem" }}>
            {Object.entries(kind === "scenario" ? scenarioAssetLabels : gameAssetLabels).map(([assetKey, label]) => {
              const isCoverAsset = assetKey === "cover";
              const hasOwnAsset = Boolean(details.assetStatus?.[assetKey]);
              const previewUrl = isCoverAsset
                ? kind === "scenario"
                  ? details.scenario?.coverImageUrl
                  : details.game?.coverImageUrl || details.scenario?.coverImageUrl
                : null;
              const fallbackText =
                kind === "scenario"
                  ? isCoverAsset
                    ? "Displayed on this scenario card."
                    : "Using default/base asset"
                  : details.scenario?.coverImageUrl
                    ? "Using the linked scenario cover image."
                    : "No custom cover image.";

              return (
                <div key={assetKey} style={{ alignItems: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", display: "flex", gap: "0.75rem", justifyContent: "space-between", padding: "0.72rem 0.78rem" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>{label}</div>
                    <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.78rem", marginTop: "0.15rem" }}>
                      {hasOwnAsset
                        ? isCoverAsset
                          ? kind === "scenario"
                            ? "Stored in this scenario."
                            : "Stored in this session."
                          : "Stored in this scenario bundle"
                        : fallbackText}
                    </div>
                    {isCoverAsset && previewUrl && (
                      <img
                        alt={`${record.name} cover`}
                        src={previewUrl}
                        style={{
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: "12px",
                          display: "block",
                          height: "4.8rem",
                          marginTop: "0.7rem",
                          objectFit: "cover",
                          width: "8.6rem",
                        }}
                      />
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.45rem" }}>
                    <button onClick={() => onOpenFileDialog(assetKey)} style={actionButtonStyle} type="button">
                      Upload
                    </button>
                    <button
                      onClick={() => onClearAsset(assetKey)}
                      style={{
                        ...actionButtonStyle,
                        background: "rgba(255,255,255,0.03)",
                        color: hasOwnAsset ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.35)",
                      }}
                      disabled={!hasOwnAsset}
                      type="button"
                    >
                      Reset
                    </button>
                    <input
                      ref={(node) => {
                        fileInputsRef.current[assetKey] = node;
                      }}
                      accept={(kind === "scenario" ? scenarioAssetAccept : gameAssetAccept)[assetKey]}
                      onChange={(event) => onFileSelect(assetKey, event)}
                      style={{ display: "none" }}
                      type="file"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editorSection === "bundles" && kind === "scenario" && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", marginBottom: "0.95rem", padding: "0.9rem" }}>
          <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.82rem", lineHeight: 1.5, marginBottom: "0.85rem" }}>
            Download the scenario as one self-contained JSON file — any custom map geometry, cities and basemap travel inside it, so it's ready to share or re-import.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem" }}>
            <button onClick={() => onExportBundle("light")} style={actionButtonStyle} type="button">
              Download JSON
            </button>
          </div>
        </div>
      )}

      {editorError && (
        <div style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.34)", borderRadius: "14px", color: "#fecaca", marginBottom: "0.9rem", padding: "0.8rem 0.9rem" }}>
          {editorError}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem" }}>
        <button
          onClick={onSave}
          style={{ ...actionButtonStyle, background: `${record.accentColor}cc`, borderColor: `${record.accentColor}dd`, color: "#fff", minWidth: "7.2rem" }}
          type="button"
        >
          {isBusy ? "Saving..." : "Save"}
        </button>
        {kind === "scenario" && onOpenMapEditor && (
          <button
            onClick={onOpenMapEditor}
            style={{ ...actionButtonStyle, background: "rgba(124,58,237,0.24)", borderColor: "rgba(124,58,237,0.38)", color: "#fff", minWidth: "9rem" }}
            type="button"
          >
            🗺️ Open Map Editor
          </button>
        )}
        {record.canDelete && (
          <button
            onClick={onDelete}
            style={{ ...actionButtonStyle, background: "rgba(127,29,29,0.34)", borderColor: "rgba(248,113,113,0.28)", color: "#fecaca" }}
            type="button"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
};

const LibraryTopBar = () => {
  const {
    activeGame,
    activeGameId,
    countryNames,
    error,
    games,
    loaded,
    loading,
    scenarios,
    selectedScenarioId,
  } = useLibraryState();
  const [activeTab, setActiveTab] = useState("games");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  // Bridge for outside callers (the no-game gate): open a library tab.
  _openLibraryTab = (tab) => {
    setActiveTab(tab);
    setIsPanelOpen(true);
  };
  const [editorKind, setEditorKind] = useState(null);
  const [editorDetails, setEditorDetails] = useState(null);
  const [editorState, setEditorState] = useState(null);
  const [editorError, setEditorError] = useState(null);
  const [editorSection, setEditorSection] = useState("overview");
  const [promptSectionKey, setPromptSectionKey] = useState("leader");
  const [isBusy, setIsBusy] = useState(false);
  const assetFileInputsRef = useRef({});
  const importScenarioInputRef = useRef(null);

  useEffect(() => {
    if (!loaded) {
      ensureLibraryCatalog().catch(() => {});
    }
  }, [loaded]);

  const resetEditor = () => {
    setEditorKind(null);
    setEditorDetails(null);
    setEditorState(null);
    setEditorError(null);
    setEditorSection("overview");
    setPromptSectionKey("leader");
  };

  const openScenarioEditor = async (scenarioId) => {
    setEditorError(null);
    setIsBusy(true);

    try {
      const details = await loadScenarioDetails(scenarioId);
      setEditorKind("scenario");
      setEditorDetails(details);
      setEditorState(buildScenarioEditorState(details));
      setEditorSection("overview");
      setPromptSectionKey("leader");
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const openGameEditor = async (gameId) => {
    setEditorError(null);
    setIsBusy(true);

    try {
      const details = await loadGameDetails(gameId);
      setEditorKind("game");
      setEditorDetails(details);
      setEditorState(buildGameEditorState(details));
      setEditorSection("overview");
      setPromptSectionKey("leader");
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  // Create the game from the scenario with the starting country and difficulty
  // the player chose in the two-step picker, then open its editor.
  const startGameForCountry = async (scenario, countryCode, difficulty) => {
    setCountryPicker(null);
    setCustomRegionData(null);
    setEditorError(null);
    setIsBusy(true);
    try {
      const details = await createGame({
        name: `${scenario.name} Session`,
        scenarioId: scenario.id,
        setActive: true,
      });
      // gamePatch merges — a full `game` write would REPLACE game.json and wipe
      // startDate/gameDate/round (the "Undated" bug).
      const gamePatch = { ...(countryCode ? { country: countryCode } : null), ...(difficulty ? { difficulty } : null) };
      if (Object.keys(gamePatch).length) {
        await saveGame(details.game.id, { gamePatch });
      }
      await openGameEditor(details.game.id);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  // Build the start-country list for a scenario: only the factions that actually
  // exist in it (world.ownerCodes), named as era polities where defined. Falls
  // back to every country for scenarios without an owner list.
  const buildScenarioCountryOptions = (world, allCountries, nameOverrides = {}) => {
    const entries = Array.isArray(allCountries) ? allCountries : [];
    const entriesByCode = new Map();
    for (const entry of entries) {
      const code = String(entry?.code ?? "").trim();
      const name = String(entry?.name ?? "").trim();
      if (!code || !name || TECHNICAL_OWNER_CODES.has(code)) continue;
      const existing = entriesByCode.get(code);
      if (!existing || existing.name === code) entriesByCode.set(code, { code, name });
    }
    const list = [...entriesByCode.values()];
    const ownerCodes = Array.isArray(world?.ownerCodes) ? world.ownerCodes : null;
    const nameByCode = new Map(list.map((entry) => [entry.code, entry.name]));
    const polity = world?.polityOverrides ?? {};
    const resolveOption = (code, fallbackName = code) => {
      const scenarioName = nameOverrides[code] || nameOverrides[fallbackName];
      const polityName = polity[code]?.name;
      return {
        code,
        name: (polityName && polityName !== code ? polityName : null) || scenarioName || fallbackName,
      };
    };
    const options = !ownerCodes || !ownerCodes.length
      ? list.map((entry) => resolveOption(entry.code, entry.name))
      : ownerCodes
        .filter((code) => !TECHNICAL_OWNER_CODES.has(code))
        .map((code) => resolveOption(code, nameByCode.get(code) || code));
    return options
      .sort((left, right) => left.name.localeCompare(right.name));
  };

  const getBaseCountryOptions = () =>
    Object.entries(countryNames ?? {}).map(([code, name]) => ({ code, name }));

  // "New Game" now opens a country picker first (the player chooses who to play).
  const handleScenarioPlay = (scenario) => {
    setCountryQuery("");
    setCountryOptions([]);
    setCustomRegionData(null);
    setPlayGameId(null);
    setCountryPicker(scenario);
    Promise.all([loadCountryNames().catch(() => []), loadScenarioDetails(scenario.id).catch(() => null)])
      .then(([allCountries, details]) => {
        setCountryOptions(buildScenarioCountryOptions(
          details?.data?.world,
          [...getBaseCountryOptions(), ...allCountries],
          scenario.countryNameOverrides,
        ));
        // Load custom region geometry so the map renders the scenario's actual
        // boundaries instead of the stock world seed.
        if (details?.data?.world?.customRegions) {
          downloadScenarioJsonAsset(scenario.id, "regionsGeojson")
            .then((geojson) => { if (geojson) setCustomRegionData(geojson); })
            .catch(() => {});
        }
      })
      .catch(() => setCountryOptions([]));
  };

  const handleScenarioClone = async (scenario) => {
    setEditorError(null);
    setIsBusy(true);

    try {
      const details = await createScenario({
        accentColor: scenario.accentColor,
        name: `${scenario.name} Copy`,
        seedScenarioId: scenario.id,
        setActive: true,
        subtitle: scenario.subtitle,
      });
      await openScenarioEditor(details.scenario.id);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleGameClone = async (game) => {
    setEditorError(null);
    setIsBusy(true);

    try {
      const details = await createGame({
        name: `${game.name} Copy`,
        seedGameId: game.id,
        setActive: true,
      });
      await openGameEditor(details.game.id);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleEditorChange = (field, value) => {
    setEditorState((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handlePromptChange = (section, value) => {
    setEditorState((current) => ({
      ...current,
      prompts:
        section.type === "root"
          ? {
              ...current.prompts,
              [section.key]: value,
            }
          : {
              ...current.prompts,
              tasks: {
                ...current.prompts.tasks,
                [section.key]: value,
              },
            },
    }));
  };

  const handleHelperChange = (helperKey, value) => {
    setEditorState((current) => ({
      ...current,
      prompts: {
        ...current.prompts,
        helpers: {
          ...current.prompts.helpers,
          [helperKey]: value,
        },
      },
    }));
  };

  const handleSave = async () => {
    if (!editorKind || !editorDetails || !editorState) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      const prompts = serializePromptPack(editorState.prompts);
      if (editorKind === "scenario") {
        const currentGame = editorDetails.data?.game ?? {};
        const currentWorld = editorDetails.data?.world ?? {};
        const details = await saveScenario(editorDetails.scenario.id, {
          accentColor: editorState.accentColor,
          description: editorState.description,
          eyebrow: editorState.eyebrow,
          game: {
            ...currentGame,
            country: editorState.country,
            gameDate: editorState.gameDate,
            language: editorState.language,
            startDate: editorState.gameDate || currentGame.startDate || "",
          },
          heroSubtitle: editorState.heroSubtitle,
          heroTitle: editorState.heroTitle,
          name: editorState.name,
          prompts,
          subtitle: editorState.subtitle,
          world: {
            ...currentWorld,
            allowedUnitTypes: Array.isArray(editorState.allowedUnitTypes)
              ? editorState.allowedUnitTypes
              : [...UNIT_TYPES],
            language: editorState.language,
            simulationRules: editorState.simulationRules,
            startingTimelineText: editorState.startingTimelineText,
          },
        });
        setEditorDetails(details);
        setEditorState(buildScenarioEditorState(details));
      } else {
        const currentGame = editorDetails.data?.game ?? {};
        const currentWorld = editorDetails.data?.world ?? {};
        const details = await saveGame(editorDetails.game.id, {
          accentColor: editorState.accentColor,
          description: editorState.description,
          eyebrow: editorState.eyebrow,
          game: {
            ...currentGame,
            country: editorState.country,
            gameDate: editorState.gameDate,
            language: editorState.language,
          },
          heroSubtitle: editorState.heroSubtitle,
          heroTitle: editorState.heroTitle,
          name: editorState.name,
          prompts,
          subtitle: editorState.subtitle,
          world: {
            ...currentWorld,
            language: editorState.language,
            simulationRules: editorState.simulationRules,
            startingTimelineText: editorState.startingTimelineText,
          },
        });
        setEditorDetails(details);
        setEditorState(buildGameEditorState(details));
      }
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!editorDetails || !editorKind) {
      return;
    }

    const record = editorKind === "scenario" ? editorDetails.scenario : editorDetails.game;
    if (!record?.canDelete) {
      return;
    }

    if (!window.confirm(`Delete ${editorKind} "${record.name}"?`)) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      if (editorKind === "scenario") {
        await removeScenario(record.id);
      } else {
        await removeGame(record.id);
      }
      resetEditor();
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleEditorAssetSelect = async (assetKey, event) => {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (!file || !editorKind || !editorDetails) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      const details =
        editorKind === "scenario"
          ? await uploadScenarioAsset(editorDetails.scenario.id, assetKey, file)
          : await uploadGameAsset(editorDetails.game.id, assetKey, file);
      setEditorDetails(details);
      setEditorState(
        editorKind === "scenario"
          ? buildScenarioEditorState(details)
          : buildGameEditorState(details),
      );
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleEditorAssetClear = async (assetKey) => {
    if (!editorKind || !editorDetails?.assetStatus?.[assetKey]) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      const details =
        editorKind === "scenario"
          ? await clearScenarioAsset(editorDetails.scenario.id, assetKey)
          : await clearGameAsset(editorDetails.game.id, assetKey);
      setEditorDetails(details);
      setEditorState(
        editorKind === "scenario"
          ? buildScenarioEditorState(details)
          : buildGameEditorState(details),
      );
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleExportBundle = async (mode) => {
    if (editorKind !== "scenario" || !editorDetails) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      const bundle = await exportScenarioBundle(editorDetails.scenario.id, mode);
      saveJsonBundleToDisk(bundle, `${editorDetails.scenario.id}-${mode}.json`);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleImportScenarioFile = async (event) => {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (!file) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const details = await importScenarioBundle(bundle);
      setActiveTab("scenarios");
      setIsPanelOpen(true);
      await openScenarioEditor(details.scenario.id);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  // Full country name in the summary, never the code.
  const activeCountryName = useCountryDisplayName(activeGame?.country || "");
  const summaryText = useMemo(() => {
    if (activeGame) {
      return `${activeGame.name} / ${activeCountryName || "No country"} / ${activeGame.currentDate || "No date"}`;
    }

    return "No active game";
  }, [activeGame, activeCountryName]);

  const handleTabToggle = (tab) => {
    if (activeTab === tab) {
      setIsPanelOpen((open) => !open);
      return;
    }

    setActiveTab(tab);
    setIsPanelOpen(true);
  };

  const isMobile = useIsMobile();
  // True once the user shut the server down from the ⏻ button — swaps the whole
  // UI for a "server stopped" screen (every poll would just error underneath).
  const [serverDown, setServerDown] = useState(false);

  const handleShutdownServer = async () => {
    if (!window.confirm("Shut down the Open Historia server? The game stops for everyone connected to it.")) {
      return;
    }
    try {
      await fetch("/api/server/shutdown", { method: "POST" });
    } catch {
      // The socket may drop before the response arrives — that IS the shutdown.
    }
    setServerDown(true);
  };

  const [isMapEditorOpen, setIsMapEditorOpen] = useState(false);
  const [mapEditorScenario, setMapEditorScenario] = useState(null);
  const [mapEditorSeed, setMapEditorSeed] = useState(null); // the scenario's current map, loaded async
  const [countryPicker, setCountryPicker] = useState(null);
  const [countryOptions, setCountryOptions] = useState([]);
  const [customRegionData, setCustomRegionData] = useState(null);
  const [countryQuery, setCountryQuery] = useState("");
  // When set, the country picker refines the country of this already-active game
  // (the Apply-&-Play flow) instead of creating a brand new game.
  const [playGameId, setPlayGameId] = useState(null);
  // Step two of the new-game dialog: the chosen country waits here while the
  // player picks a difficulty.
  const [difficultyPick, setDifficultyPick] = useState(null);

  // Write a map built in the editor into its scenario (region geometry + ownership
  // + colors), then immediately spin up and activate a fresh game from it so the
  // player SEES the map right away — the stock country-level renderer can't show
  // per-region ownership, so every applied map ships its geometry and renders via
  // the custom GeoJSON layer.
  const applyMapToScenario = async (scenario, seed) => {
    if (!scenario || !seed) return;
    const scenarioId = scenario.id;

    const details = await loadScenarioDetails(scenarioId);
    const currentWorld = details?.data?.world ?? {};
    const currentGame = details?.data?.game ?? {};

    await saveScenario(scenarioId, {
      world: {
        ...currentWorld,
        regionOwnershipOverrides: seed.world?.regionOwnershipOverrides ?? {},
        polityOverrides: {
          ...(currentWorld.polityOverrides ?? {}),
          ...(seed.world?.polityOverrides ?? {}),
        },
        // Playable factions for the start-country picker.
        ownerCodes: [...new Set(Object.values(seed.world?.regionOwnershipOverrides ?? {}))].sort(),
        customRegions: true,
        customCities: seed.world?.customCities ?? false,
        author: seed.world?.author ?? "",
        mapCredit: seed.world?.mapCredit ?? "",
        // Custom map background descriptor (kind + placement); null clears it. The
        // heavy payload goes to the backgroundData asset just below.
        background: seed.world?.background ?? null,
        // The chosen built-in basemap so the game renders it (not always ocean).
        basemap: seed.world?.basemap ?? null,
      },
      game: {
        ...currentGame,
        country: seed.game?.country || currentGame.country || "",
        // Guarantee a valid date so the timeline never shows "Invalid Date".
        gameDate:
          currentGame.gameDate || currentGame.startDate || seed.game?.gameDate || seed.game?.startDate || "2016-01-01",
        startDate:
          currentGame.startDate || currentGame.gameDate || seed.game?.startDate || seed.game?.gameDate || "2016-01-01",
      },
    });

    await uploadScenarioAsset(
      scenarioId,
      "colors",
      new Blob([JSON.stringify(seed.colors ?? {})], { type: "application/json" }),
    );
    // Author-set country flags. Only written when the map actually has some: a map
    // with no flags must leave the scenario's flags.json alone rather than stamping
    // an empty one over it, and clearScenarioAsset is how a map that removed its
    // last flag gets back to the game's code-derived flags.
    if (seed.flags) {
      await uploadScenarioAsset(
        scenarioId,
        "flags",
        new Blob([JSON.stringify(seed.flags)], { type: "application/json" }),
      );
    } else {
      await clearScenarioAsset(scenarioId, "flags").catch(() => {});
    }
    // Author-set country tags, same contract as flags.
    if (seed.tags) {
      await uploadScenarioAsset(
        scenarioId,
        "tags",
        new Blob([JSON.stringify(seed.tags)], { type: "application/json" }),
      );
    } else {
      await clearScenarioAsset(scenarioId, "tags").catch(() => {});
    }
    await uploadScenarioAsset(
      scenarioId,
      "regionsGeojson",
      new Blob([JSON.stringify(seed.regions ?? { type: "FeatureCollection", features: [] })], {
        type: "application/json",
      }),
    );
    await uploadScenarioAsset(
      scenarioId,
      "citiesGeojson",
      new Blob([JSON.stringify(seed.cities ?? { type: "FeatureCollection", features: [] })], {
        type: "application/json",
      }),
    );

    // The custom background's heavy payload (image data URL / vector GeoJSON) is a
    // separate scenario asset so world.json stays light. Clear it when the map has
    // no background, so re-applying a map that dropped its background doesn't leave
    // a stale image behind.
    if (seed.backgroundData) {
      await uploadScenarioAsset(
        scenarioId,
        "backgroundData",
        new Blob([JSON.stringify(seed.backgroundData)], { type: "application/json" }),
      );
    } else {
      await clearScenarioAsset(scenarioId, "backgroundData").catch(() => {});
    }

    // Create + activate a fresh game so the running map reflects the edit. Relying
    // on the player finishing a follow-up picker left the old active game (and old
    // map) in place — this guarantees the new map is live.
    const gameDetails = await createGame({
      name: `${scenario.name} Session`,
      scenarioId,
      setActive: true,
    });
    const newGameId = gameDetails.game.id;
    if (seed.game?.country) {
      await saveGame(newGameId, { gamePatch: { country: seed.game.country } });
    }

    // Tear down all the library UI so the freshly-activated game is visible.
    setIsMapEditorOpen(false);
    setMapEditorScenario(null);
    setMapEditorSeed(null);
    resetEditor();
    setIsPanelOpen(false);

    // Optional: let the player pick who they control on the new game — limited to
    // the factions this map actually contains.
    const seedWorld = {
      ownerCodes: [...new Set(Object.values(seed.world?.regionOwnershipOverrides ?? {}))].sort(),
      polityOverrides: seed.world?.polityOverrides ?? {},
    };
    setPlayGameId(newGameId);
    setCountryQuery("");
    setCountryOptions([]);
    setCustomRegionData(null);
    setCountryPicker(scenario);
    loadCountryNames().catch(() => [])
      .then((allCountries) => {
        setCountryOptions(buildScenarioCountryOptions(
          seedWorld,
          [...getBaseCountryOptions(), ...allCountries],
          scenario.countryNameOverrides,
        ));
        // The map editor just saved custom region geometry — load it so the
        // country picker renders the scenario's actual map, not the stock seed.
        downloadScenarioJsonAsset(scenario.id, "regionsGeojson")
          .then((geojson) => { if (geojson) setCustomRegionData(geojson); })
          .catch(() => {});
      })
      .catch(() => setCountryOptions(getBaseCountryOptions()));
  };

  // Country picker resolution: in the Apply-&-Play flow update the active game;
  // in the normal "New Game" flow create a new game.
  const choosePlayCountry = async (countryCode, difficulty) => {
    const gid = playGameId;
    setCountryPicker(null);
    setCustomRegionData(null);
    setPlayGameId(null);
    if (!gid) return;
    try {
      const gamePatch = { ...(countryCode ? { country: countryCode } : null), ...(difficulty ? { difficulty } : null) };
      if (Object.keys(gamePatch).length) {
        await saveGame(gid, { gamePatch });
      }
      await activateGame(gid);
    } catch (nextError) {
      setEditorError(nextError.message);
    }
  };

  // Picking a country moves to step two (difficulty); picking a difficulty
  // actually creates/updates the game.
  const pickCountry = (countryCode) => setDifficultyPick({ countryCode });

  const pickDifficulty = (difficultyId) => {
    const countryCode = difficultyPick?.countryCode || "";
    setDifficultyPick(null);
    if (playGameId) {
      choosePlayCountry(countryCode, difficultyId);
    } else {
      startGameForCountry(countryPicker, countryCode, difficultyId);
    }
  };

  const selectedCountryOption = difficultyPick?.countryCode
    ? countryOptions.find((country) => country.code === difficultyPick.countryCode)
    : null;

  return (
    <>
      <div
        style={{
          ...surfaceStyle,
          alignItems: "center",
          borderLeft: "none",
          borderRadius: 0,
          borderRight: "none",
          borderTop: "none",
          display: "grid",
          gap: isMobile ? "0.4rem" : "0.9rem",
          gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
          height: `${BAR_HEIGHT}px`,
          left: 0,
          padding: isMobile ? "0 0.5rem" : "0 1rem",
          position: "fixed",
          right: 0,
          top: 0,
          zIndex: 10030,
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: "0.8rem", minWidth: 0 }}>
          <div style={{ alignItems: "center", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "999px", display: "flex", flexShrink: 0, height: "2.65rem", justifyContent: "center", overflow: "hidden", width: "2.65rem" }}>
            <img alt="Open Historia" src="/logo.png" style={{ height: "1.7rem", width: "1.7rem" }} />
          </div>
          {/* Phones keep the logo only — the title/summary would crowd out the tabs. */}
          {!isMobile && (
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#fff", fontSize: "1rem", fontWeight: 800, letterSpacing: "-0.03em" }}>
                Open Historia
              </div>
              <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.72rem", marginTop: "0.08rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "min(28rem, 46vw)" }}>
                {summaryText}
              </div>
            </div>
          )}
        </div>

        <div style={{ alignItems: "center", display: "flex", gap: "0.55rem", justifyContent: "center", justifySelf: "center" }}>
          {["games", "scenarios", "community"].map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabToggle(tab)}
              style={{
                ...actionButtonStyle,
                background: activeTab === tab ? "rgba(124,58,237,0.24)" : "rgba(255,255,255,0.05)",
                borderColor: activeTab === tab ? "rgba(124,58,237,0.38)" : "rgba(255,255,255,0.08)",
                minWidth: isMobile ? "0" : "6.6rem",
                padding: isMobile ? "0.55rem 0.7rem" : undefined,
              }}
              type="button"
            >
              {tab === "games" ? "Games" : tab === "scenarios" ? "Scenarios" : "Community"}
            </button>
          ))}
        </div>

        {/* Top-right: shut the server down (phones/Termux have no terminal handy).
            Hidden on the hosted website (web build) — there's no local server to
            stop there, and the compile-time flag strips this from that bundle. */}
        {!import.meta.env.VITE_OH_WEB && (
          <div style={{ alignItems: "center", display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={handleShutdownServer}
              title="Exit: shut down the Open Historia server"
              type="button"
              style={{
                ...actionButtonStyle,
                background: "rgba(220,70,70,0.14)",
                borderColor: "rgba(248,113,113,0.35)",
                color: "#fca5a5",
                minWidth: "2.35rem",
                padding: isMobile ? "0.55rem 0.7rem" : undefined,
              }}
            >
              ⏻
            </button>
          </div>
        )}
      </div>

      {serverDown && (
        <div
          style={{
            alignItems: "center",
            background: "rgba(5,8,18,0.97)",
            color: "#fff",
            display: "flex",
            flexDirection: "column",
            fontFamily: "sans-serif",
            gap: "0.8rem",
            inset: 0,
            justifyContent: "center",
            padding: "1rem",
            position: "fixed",
            textAlign: "center",
            zIndex: 20000,
          }}
        >
          <div style={{ fontSize: "2.2rem" }}>⏻</div>
          <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>Server stopped</div>
          <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.85rem", maxWidth: "22rem" }}>
            You can close this tab now. Run the launcher (or <code>node server/server.js</code>) to start it again.
          </div>
        </div>
      )}

      {isMapEditorOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10050 }}>
          <Suspense
            fallback={
              <div style={{ position: "fixed", inset: 0, background: "#0b1020", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
                Loading map editor…
              </div>
            }
          >
            <MapEditor
              onClose={() => {
                setIsMapEditorOpen(false);
                setMapEditorScenario(null);
                setMapEditorSeed(null);
              }}
              scenarioName={mapEditorScenario?.name}
              initialMap={mapEditorSeed}
              onApplyToScenario={
                mapEditorScenario ? (seed) => applyMapToScenario(mapEditorScenario, seed) : undefined
              }
            />
          </Suspense>
        </div>
      )}

      {countryPicker && (
        <div
          onClick={() => { setCountryPicker(null); setPlayGameId(null); setDifficultyPick(null); setCustomRegionData(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 10060, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ ...surfaceStyle, borderRadius: 16, width: difficultyPick ? "min(440px, 92vw)" : "min(640px, 92vw)", maxHeight: "80vh", display: "flex", flexDirection: "column", padding: "1rem", color: "#fff", fontFamily: "sans-serif", overflow: difficultyPick ? "visible" : "auto" }}
          >
            {difficultyPick ? (
              <>
                <div style={{ fontWeight: 800, fontSize: "1rem" }}>Choose your difficulty</div>
                <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.75rem", margin: "0.15rem 0 0.7rem" }}>
                  How hard should the world fight back?
                </div>
                {selectedCountryOption && (
                  <div style={{ alignItems: "center", display: "flex", fontSize: "0.9rem", fontWeight: 700, gap: "0.5rem", marginBottom: "0.7rem" }}>
                    <span aria-hidden="true" style={{ fontSize: "1.35rem" }}>
                      {flagEmojiFromGid(selectedCountryOption.code) || "🏳️"}
                    </span>
                    <span>{selectedCountryOption.name}</span>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", overflowY: "auto" }}>
                  {DIFFICULTY_LEVELS.map((level) => (
                    <button
                      key={level.id}
                      type="button"
                      onClick={() => pickDifficulty(level.id)}
                      style={{
                        ...actionButtonStyle,
                        alignItems: "center",
                        background: "rgba(255,255,255,0.04)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.2rem",
                        padding: "0.75rem 0.5rem",
                      }}
                    >
                      <span style={{ fontSize: "1.6rem", lineHeight: 1 }}>{level.emoji}</span>
                      <span style={{ fontWeight: 700 }}>{level.label}</span>
                      <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.68rem", textAlign: "center" }}>{level.blurb}</span>
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => setDifficultyPick(null)} style={{ ...actionButtonStyle, marginTop: "0.6rem" }}>
                  Back
                </button>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 800, fontSize: "1rem" }}>Choose your country</div>
                <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.75rem", margin: "0.15rem 0 0.7rem" }}>
                  Starting “{countryPicker.name}”
                </div>
                <button
                  type="button"
                  onClick={() => pickCountry("")}
                  style={{ ...actionButtonStyle, justifyContent: "flex-start", background: "rgba(124,58,237,0.18)", marginBottom: "0.4rem" }}
                >
                  {playGameId ? "Keep scenario default" : "Scenario default"}
                </button>
                <Suspense
                  fallback={
                    <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.85rem", padding: "3rem 0", textAlign: "center" }}>
                      Loading map…
                    </div>
                  }
                >
                  <CountryPickerMap
                    countryOptions={countryOptions}
                    regionsGeojson={customRegionData}
                    onPickCountry={(code) => pickCountry(code)}
                  />
                </Suspense>
                <button type="button" onClick={() => { setCountryPicker(null); setPlayGameId(null); setCustomRegionData(null); }} style={{ ...actionButtonStyle, marginTop: "0.6rem" }}>
                  {playGameId ? "Done" : "Cancel"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <input
        ref={importScenarioInputRef}
        accept=".json,application/json"
        onChange={handleImportScenarioFile}
        style={{ display: "none" }}
        type="file"
      />

      {isPanelOpen && (
        <div
          style={{
            ...surfaceStyle,
            borderRadius: "0 0 28px 28px",
            left: "0.85rem",
            maxWidth: "calc(100vw - 1.7rem)",
            padding: "1rem",
            position: "fixed",
            right: "0.85rem",
            top: `${BAR_HEIGHT}px`,
            zIndex: 10029,
          }}
        >
          {activeTab !== "community" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem", justifyContent: "flex-end", marginBottom: "0.9rem" }}>
              <button onClick={() => refreshLibraryCatalog({ force: true }).catch(() => {})} style={actionButtonStyle} type="button">
                Refresh
              </button>
              {activeTab === "scenarios" && (
                <button onClick={() => importScenarioInputRef.current?.click()} style={actionButtonStyle} type="button">
                  Import JSON
                </button>
              )}
            </div>
          )}

          {activeTab === "community" ? (
            <Suspense
              fallback={
                <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.85rem", padding: "1rem 0" }}>
                  Loading Community…
                </div>
              }
            >
              <CommunityPanel onImported={() => setActiveTab("scenarios")} />
            </Suspense>
          ) : (
            <div style={{ display: "flex", gap: "0.9rem", overflowX: "auto", paddingBottom: "0.15rem", scrollbarWidth: "thin" }}>
              {activeTab === "games"
                ? games.map((game) => (
                    <GameCard
                      key={game.id}
                      active={game.id === activeGameId}
                      game={game}
                      onActivate={activateGame}
                      onClone={handleGameClone}
                      onEdit={openGameEditor}
                    />
                  ))
                : scenarios.map((scenario) => (
                    <ScenarioCard
                      key={scenario.id}
                      onClone={handleScenarioClone}
                      onEdit={openScenarioEditor}
                      onPlay={handleScenarioPlay}
                      onSelect={selectScenario}
                      scenario={scenario}
                      selected={scenario.id === selectedScenarioId}
                    />
                  ))}
            </div>
          )}
        </div>
      )}

      <EditorDrawer
        details={editorDetails}
        editorError={editorError || error}
        editorSection={editorSection}
        fileInputsRef={assetFileInputsRef}
        formState={editorState}
        isBusy={isBusy || loading}
        kind={editorKind}
        onChange={handleEditorChange}
        onChangeHelper={handleHelperChange}
        onChangePrompt={handlePromptChange}
        onClearAsset={handleEditorAssetClear}
        onClose={resetEditor}
        onDelete={handleDelete}
        onExportBundle={handleExportBundle}
        onOpenMapEditor={() => {
          const scenario = editorDetails?.scenario || null;
          setMapEditorScenario(scenario);
          setMapEditorSeed(null);
          setIsMapEditorOpen(true);
          // Load the scenario's CURRENT map (geometry + owners + cities + palette)
          // so the editor opens it instead of the default world. Assets stream in
          // async; the editor hydrates the moment they arrive.
          if (scenario) {
            const world = editorDetails?.data?.world ?? {};
            Promise.all([
              downloadScenarioJsonAsset(scenario.id, "regionsGeojson"),
              downloadScenarioJsonAsset(scenario.id, "citiesGeojson"),
              downloadScenarioJsonAsset(scenario.id, "colors"),
              // The author-set flags, for the same reason as the background below:
              // without them the editor opens with none, and Apply & Play cannot
              // tell "this map has no flags" from "this map never loaded them" —
              // so it clears the scenario's flags.json and the author's work is gone.
              downloadScenarioJsonAsset(scenario.id, "flags"),
              downloadScenarioJsonAsset(scenario.id, "tags"),
              // The custom map background so re-opening the editor restores it.
              world.background?.kind ? downloadScenarioJsonAsset(scenario.id, "backgroundData") : Promise.resolve(null),
            ]).then(([regions, cities, colors, flags, tags, bgData]) => {
              const bgDesc = world.background;
              const background =
                bgDesc?.kind === "image" && bgData?.dataUrl
                  ? { kind: "image", dataUrl: bgData.dataUrl }
                  : bgDesc?.kind === "vector" && bgData?.geojson
                    ? { kind: "vector", geojson: bgData.geojson }
                    : null;
              setMapEditorSeed({
                name: scenario.name || "",
                author: world.author || "",
                ownershipOverrides: world.regionOwnershipOverrides || {},
                regions: regions && Array.isArray(regions.features) && regions.features.length ? regions : null,
                cities: cities && Array.isArray(cities.features) ? cities : null,
                colors: colors && typeof colors === "object" && !Array.isArray(colors) ? colors : null,
                flags: flags && typeof flags === "object" && !Array.isArray(flags) ? flags : null,
                tags: tags && typeof tags === "object" && !Array.isArray(tags) ? tags : null,
                background,
                basemap: world.basemap || null,
              });
            });
          }
        }}
        onFileSelect={handleEditorAssetSelect}
        onOpenFileDialog={(assetKey) => assetFileInputsRef.current[assetKey]?.click()}
        onSave={handleSave}
        promptSectionKey={promptSectionKey}
        setEditorSection={setEditorSection}
        setPromptSectionKey={setPromptSectionKey}
      />

      {!loaded && (
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.82rem", position: "fixed", right: "1.25rem", top: "4.35rem", zIndex: 10028 }}>
          Loading games and scenarios...
        </div>
      )}
    </>
  );
};

export { LibraryTopBar, TOP_BAR_OFFSET };
