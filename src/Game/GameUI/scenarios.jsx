import React, { useEffect, useRef, useState } from "react";
import { GAMEPLAY_PROMPT_DEFAULTS } from "../AI/gameplayPrompts.js";
import {
  activateScenario,
  clearScenarioAsset,
  createScenario,
  ensureScenarioCatalog,
  loadScenarioDetails,
  refreshScenarioCatalog,
  removeScenario,
  saveScenario,
  uploadScenarioAsset,
  useScenarioState,
} from "../../runtime/scenarios.js";

const BAR_HEIGHT = 64;
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
  minHeight: "8.5rem",
  resize: "vertical",
};

const uploadLabels = {
  cities: "Cities PMTiles",
  colors: "Colors JSON",
  countries: "Countries PMTiles",
  regions: "Regions PMTiles",
};

const uploadAccept = {
  cities: ".pmtiles",
  colors: ".json",
  countries: ".pmtiles",
  regions: ".pmtiles",
};

const formatCountryOverrides = (overrides) => {
  if (!overrides || typeof overrides !== "object") {
    return "";
  }

  return Object.entries(overrides)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([key, value]) => `${key} = ${value}`)
  .join("\n");
};

const parseCountryOverrides = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Country overrides must be an object.");
    }
    return parsed;
  }

  const overrides = {};

  for (const line of trimmed.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry || entry.startsWith("#") || entry.startsWith("//")) {
      continue;
    }

    const separatorIndex = entry.includes("=")
    ? entry.indexOf("=")
    : entry.indexOf(":");

    if (separatorIndex <= 0) {
      throw new Error("Use `CODE = New Name` or JSON for country overrides.");
    }

    const key = entry.slice(0, separatorIndex).trim();
    const resolvedValue = entry.slice(separatorIndex + 1).trim();

    if (!key || !resolvedValue) {
      throw new Error("Country override rows must include both key and value.");
    }

    overrides[key] = resolvedValue;
  }

  return overrides;
};

const parseAdvancedPrompts = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Advanced prompts must be a JSON object.");
  }

  return parsed;
};

const buildEditorState = (details) => {
  const scenario = details?.scenario ?? {};
  const game = details?.data?.game ?? {};
  const prompts = details?.data?.prompts ?? {};
  const world = details?.data?.world ?? {};

  const advancedPrompts = {
    actions: prompts.actions ?? GAMEPLAY_PROMPT_DEFAULTS.actions,
    autoJumpForward: prompts.autoJumpForward ?? GAMEPLAY_PROMPT_DEFAULTS.autoJumpForward,
    catalystCreation: prompts.catalystCreation ?? GAMEPLAY_PROMPT_DEFAULTS.catalystCreation,
    catalystExecutor: prompts.catalystExecutor ?? GAMEPLAY_PROMPT_DEFAULTS.catalystExecutor,
    catalystSummary: prompts.catalystSummary ?? GAMEPLAY_PROMPT_DEFAULTS.catalystSummary,
    descriptionToAction: prompts.descriptionToAction ?? GAMEPLAY_PROMPT_DEFAULTS.descriptionToAction,
    eventConsolidator: prompts.eventConsolidator ?? GAMEPLAY_PROMPT_DEFAULTS.eventConsolidator,
    gameMaster: prompts.gameMaster ?? GAMEPLAY_PROMPT_DEFAULTS.gameMaster,
    jumpForward: prompts.jumpForward ?? GAMEPLAY_PROMPT_DEFAULTS.jumpForward,
    nextSpeaker: prompts.nextSpeaker ?? GAMEPLAY_PROMPT_DEFAULTS.nextSpeaker,
  };

  return {
    accentColor: scenario.accentColor ?? "#7c3aed",
    advancedPromptsText: JSON.stringify(advancedPrompts, null, 2),
    country: game.country ?? "",
    countryOverridesText: formatCountryOverrides(scenario.countryNameOverrides),
    description: scenario.description ?? "",
    difficulty: game.difficulty ?? world.difficulty ?? "standard",
    eyebrow: scenario.eyebrow ?? "",
    gameDate: game.gameDate ?? "",
    heroSubtitle: scenario.heroSubtitle ?? "",
    heroTitle: scenario.heroTitle ?? "",
    language: game.language ?? world.language ?? "English",
    leaderPrompt: prompts.leader ?? "",
    name: scenario.name ?? "",
    simulationRules: world.simulationRules ?? "",
    startingTimelineText: world.startingTimelineText ?? "",
    subtitle: scenario.subtitle ?? "",
    systemPrompt: prompts.advisor ?? "",
  };
};

const renderAssetBadges = (assetStatus = {}) =>
Object.entries(uploadLabels)
.filter(([key]) => assetStatus[key])
.map(([, label]) => label.replace(" PMTiles", "").replace(" JSON", ""));

const ScenarioCard = ({
  active,
  onActivate,
  onEdit,
  scenario,
}) => {
  const assetBadges = renderAssetBadges(scenario.assetStatus);

  return (
    <div
    style={{
      ...surfaceStyle,
      borderColor: active ? `${scenario.accentColor}66` : "rgba(255,255,255,0.08)",
          borderRadius: "24px",
          flex: "0 0 21rem",
          minHeight: "15rem",
          overflow: "hidden",
          position: "relative",
    }}
    >
    <div
    style={{
      background:
      `linear-gradient(180deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.72) 100%), ` +
      `radial-gradient(circle at 14% 18%, ${scenario.accentColor}bb, transparent 34%), ` +
      "url('/loading_screen.jpg') center/cover",
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
      zIndex: 1,
    }}
    >
    <div>
    <div
    style={{
      alignItems: "center",
      display: "flex",
      gap: "0.5rem",
      justifyContent: "space-between",
    }}
    >
    <span
    style={{
      background: active ? `${scenario.accentColor}66` : "rgba(255,255,255,0.12)",
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
    {active && (
      <span
      style={{
        background: "rgba(255,255,255,0.18)",
                borderRadius: "999px",
                color: "#fff",
                fontSize: "0.72rem",
                fontWeight: 700,
                padding: "0.32rem 0.65rem",
      }}
      >
      Active
      </span>
    )}
    </div>
    <div style={{ marginTop: "4.2rem" }}>
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
          maxWidth: "15rem",
    }}
    >
    {scenario.heroSubtitle || scenario.description || scenario.subtitle}
    </div>
    </div>
    </div>
    <div>
    <div
    style={{
      color: "rgba(255,255,255,0.68)",
          fontSize: "0.8rem",
          marginBottom: "0.7rem",
    }}
    >
    {scenario.subtitle}
    </div>
    {assetBadges.length > 0 && (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.85rem" }}>
      {assetBadges.map((badge) => (
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
    )}
    <div style={{ display: "flex", gap: "0.55rem" }}>
    <button
    onClick={() => onActivate(scenario.id)}
    style={{
      ...actionButtonStyle,
      background: active ? "rgba(255,255,255,0.16)" : `${scenario.accentColor}cc`,
          borderColor: active ? "rgba(255,255,255,0.22)" : `${scenario.accentColor}dd`,
          color: "#fff",
          flex: 1,
    }}
    >
    {active ? "Selected" : "Open"}
    </button>
    <button
    onClick={() => onEdit(scenario.id)}
    style={{
      ...actionButtonStyle,
      background: "rgba(10,13,20,0.58)",
          color: "rgba(255,255,255,0.92)",
          flex: 1,
    }}
    >
    Edit
    </button>
    </div>
    </div>
    </div>
    </div>
  );
};

const ScenarioEditor = ({
  details,
  editorError,
  fileInputsRef,
  formState,
    isBusy,
    onChange,
    onClearAsset,
    onClose,
    onDelete,
    onFileSelect,
    onOpenFileDialog,
    onSave,
    onSetActive,
}) => {
  if (!details || !formState) {
    return null;
  }

  const { assetStatus = {}, scenario } = details;

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
          width: "min(32rem, calc(100vw - 1.2rem))",
          zIndex: 10031,
    }}
    >
    <div
    style={{
      alignItems: "center",
      display: "flex",
      gap: "0.7rem",
      justifyContent: "space-between",
      marginBottom: "1rem",
    }}
    >
    <div>
    <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
    Scenario Editor
    </div>
    <div style={{ fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.03em", marginTop: "0.2rem" }}>
    {scenario.name}
    </div>
    </div>
    <button
    onClick={onClose}
    style={{
      ...actionButtonStyle,
      background: "rgba(255,255,255,0.04)",
          minWidth: "2.35rem",
          padding: 0,
    }}
    >
    ×
    </button>
    </div>

    <div
    style={{
      background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "18px",
          marginBottom: "0.95rem",
          padding: "0.9rem",
    }}
    >
    <div style={{ display: "grid", gap: "0.8rem", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
    <div style={{ gridColumn: "1 / -1" }}>
    <label style={fieldLabelStyle}>Name</label>
    <input
    style={inputStyle}
    value={formState.name}
    onChange={(event) => onChange("name", event.target.value)}
    />
    </div>
    <div>
    <label style={fieldLabelStyle}>Eyebrow</label>
    <input
    style={inputStyle}
    value={formState.eyebrow}
    onChange={(event) => onChange("eyebrow", event.target.value)}
    />
    </div>
    <div>
    <label style={fieldLabelStyle}>Accent</label>
    <input
    style={{
      ...inputStyle,
      height: "3.1rem",
      padding: "0.25rem 0.3rem",
    }}
    type="color"
    value={formState.accentColor}
    onChange={(event) => onChange("accentColor", event.target.value)}
    />
    </div>
    <div style={{ gridColumn: "1 / -1" }}>
    <label style={fieldLabelStyle}>Subtitle</label>
    <input
    style={inputStyle}
    value={formState.subtitle}
    onChange={(event) => onChange("subtitle", event.target.value)}
    />
    </div>
    <div style={{ gridColumn: "1 / -1" }}>
    <label style={fieldLabelStyle}>Description</label>
    <textarea
    style={{ ...textareaStyle, minHeight: "6.5rem" }}
    value={formState.description}
    onChange={(event) => onChange("description", event.target.value)}
    />
    </div>
    <div style={{ gridColumn: "1 / -1" }}>
    <label style={fieldLabelStyle}>Hero Title</label>
    <input
    style={inputStyle}
    value={formState.heroTitle}
    onChange={(event) => onChange("heroTitle", event.target.value)}
    />
    </div>
    <div style={{ gridColumn: "1 / -1" }}>
    <label style={fieldLabelStyle}>Hero Subtitle</label>
    <textarea
    style={{ ...textareaStyle, minHeight: "5.5rem" }}
    value={formState.heroSubtitle}
    onChange={(event) => onChange("heroSubtitle", event.target.value)}
    />
    </div>
    <div>
    <label style={fieldLabelStyle}>Player Country</label>
    <input
    style={inputStyle}
    value={formState.country}
    onChange={(event) => onChange("country", event.target.value)}
    />
    </div>
    <div>
    <label style={fieldLabelStyle}>Game Date</label>
    <input
    style={inputStyle}
    value={formState.gameDate}
    onChange={(event) => onChange("gameDate", event.target.value)}
    />
    </div>
    <div>
    <label style={fieldLabelStyle}>Language</label>
    <input
    style={inputStyle}
    value={formState.language}
    onChange={(event) => onChange("language", event.target.value)}
    />
    </div>
    <div>
    <label style={fieldLabelStyle}>Difficulty</label>
    <input
    style={inputStyle}
    value={formState.difficulty}
    onChange={(event) => onChange("difficulty", event.target.value)}
    />
    </div>
    <div style={{ gridColumn: "1 / -1" }}>
    <label style={fieldLabelStyle}>Country Name Overrides</label>
    <textarea
    style={{ ...textareaStyle, minHeight: "6.5rem" }}
    placeholder={"DEU = German Empire\nRUS = Russian State"}
    value={formState.countryOverridesText}
    onChange={(event) => onChange("countryOverridesText", event.target.value)}
    />
    </div>
    <div style={{ gridColumn: "1 / -1" }}>
    <label style={fieldLabelStyle}>World Before Round One</label>
    <textarea
    style={{ ...textareaStyle, minHeight: "8rem" }}
    value={formState.startingTimelineText}
    onChange={(event) => onChange("startingTimelineText", event.target.value)}
    />
    </div>
    <div style={{ gridColumn: "1 / -1" }}>
    <label style={fieldLabelStyle}>Simulation Rules</label>
    <textarea
    style={{ ...textareaStyle, minHeight: "8rem" }}
    value={formState.simulationRules}
    onChange={(event) => onChange("simulationRules", event.target.value)}
    />
    </div>
    </div>
    </div>

    <div
    style={{
      background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "18px",
          marginBottom: "0.95rem",
          padding: "0.9rem",
    }}
    >
    <div style={{ fontSize: "0.76rem", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "0.75rem", textTransform: "uppercase" }}>
    Prompts
    </div>
    <div style={{ display: "grid", gap: "0.9rem" }}>
    <div>
    <label style={fieldLabelStyle}>Advisor Prompt</label>
    <textarea
    style={textareaStyle}
    value={formState.systemPrompt}
    onChange={(event) => onChange("systemPrompt", event.target.value)}
    />
    </div>
    <div>
    <label style={fieldLabelStyle}>Leader Prompt</label>
    <textarea
    style={{ ...textareaStyle, minHeight: "11rem" }}
    value={formState.leaderPrompt}
    onChange={(event) => onChange("leaderPrompt", event.target.value)}
    />
    </div>
    <div>
    <label style={fieldLabelStyle}>Advanced AI Prompt Pack</label>
    <textarea
    style={{ ...textareaStyle, minHeight: "16rem", fontFamily: "Consolas, monospace", fontSize: "0.8rem" }}
    value={formState.advancedPromptsText}
    onChange={(event) => onChange("advancedPromptsText", event.target.value)}
    />
    </div>
    </div>
    </div>

    <div
    style={{
      background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "18px",
          marginBottom: "0.95rem",
          padding: "0.9rem",
    }}
    >
    <div style={{ fontSize: "0.76rem", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "0.75rem", textTransform: "uppercase" }}>
    Asset Overrides
    </div>
    <div style={{ display: "grid", gap: "0.7rem" }}>
    {Object.entries(uploadLabels).map(([assetKey, label]) => (
      <div
      key={assetKey}
      style={{
        alignItems: "center",
        background: "rgba(255,255,255,0.03)",
                                                              border: "1px solid rgba(255,255,255,0.08)",
                                                              borderRadius: "14px",
                                                              display: "flex",
                                                              gap: "0.75rem",
                                                              justifyContent: "space-between",
                                                              padding: "0.72rem 0.78rem",
      }}
      >
      <div>
      <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>{label}</div>
      <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.78rem", marginTop: "0.15rem" }}>
      {assetStatus[assetKey] ? "Stored on the server for this scenario" : "Using base asset"}
      </div>
      </div>
      <div style={{ display: "flex", gap: "0.45rem" }}>
      <button
      onClick={() => onOpenFileDialog(assetKey)}
      style={actionButtonStyle}
      >
      Upload
      </button>
      <button
      onClick={() => onClearAsset(assetKey)}
      style={{
        ...actionButtonStyle,
        background: "rgba(255,255,255,0.03)",
                                                              color: assetStatus[assetKey] ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.35)",
      }}
      disabled={!assetStatus[assetKey]}
      >
      Reset
      </button>
      <input
      ref={(node) => {
        fileInputsRef.current[assetKey] = node;
      }}
      accept={uploadAccept[assetKey]}
      onChange={(event) => onFileSelect(assetKey, event)}
      style={{ display: "none" }}
      type="file"
      />
      </div>
      </div>
    ))}
    </div>
    </div>

    {editorError && (
      <div
      style={{
        background: "rgba(248,113,113,0.12)",
                     border: "1px solid rgba(248,113,113,0.34)",
                     borderRadius: "14px",
                     color: "#fecaca",
                     marginBottom: "0.9rem",
                     padding: "0.8rem 0.9rem",
      }}
      >
      {editorError}
      </div>
    )}

    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem" }}>
    <button
    onClick={onSave}
    style={{
      ...actionButtonStyle,
      background: `${scenario.accentColor}cc`,
      borderColor: `${scenario.accentColor}dd`,
      color: "#fff",
      minWidth: "7.2rem",
    }}
    >
    {isBusy ? "Saving..." : "Save"}
    </button>
    <button onClick={onSetActive} style={actionButtonStyle}>
    Activate
    </button>
    {scenario.canDelete && (
      <button
      onClick={onDelete}
      style={{
        ...actionButtonStyle,
        background: "rgba(127,29,29,0.34)",
                            borderColor: "rgba(248,113,113,0.28)",
                            color: "#fecaca",
      }}
      >
      Delete
      </button>
    )}
    </div>
    </div>
  );
};

const ScenarioTopBar = () => {
  const {
    activeScenario,
    activeScenarioId,
    error,
    loaded,
    loading,
    scenarios,
  } = useScenarioState();
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [editorDetails, setEditorDetails] = useState(null);
  const [editorState, setEditorState] = useState(null);
  const [editorError, setEditorError] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const fileInputsRef = useRef({});

  useEffect(() => {
    if (!loaded) {
      ensureScenarioCatalog().catch(() => {});
    }
  }, [loaded]);

  const openEditor = async (scenarioId) => {
    setEditorError(null);
    setIsBusy(true);

    try {
      const details = await loadScenarioDetails(scenarioId);
      setEditorDetails(details);
      setEditorState(buildEditorState(details));
      setIsPanelOpen(true);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateScenario = async () => {
    setEditorError(null);
    setIsBusy(true);

    try {
      const details = await createScenario({
        name: activeScenario ? `${activeScenario.name} Copy` : "New Scenario",
        seedScenarioId: activeScenario?.id ?? "default",
        setActive: true,
        subtitle: activeScenario?.subtitle ?? "Scenario clone",
      });

      await openEditor(details.scenario.id);
      setIsPanelOpen(true);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSave = async () => {
    if (!editorDetails || !editorState) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      const currentGame = editorDetails.data?.game ?? {};
      const currentPrompts = editorDetails.data?.prompts ?? {};
      const currentWorld = editorDetails.data?.world ?? {};
      const advancedPrompts = parseAdvancedPrompts(editorState.advancedPromptsText);
      const details = await saveScenario(editorDetails.scenario.id, {
        accentColor: editorState.accentColor,
        countryNameOverrides: parseCountryOverrides(editorState.countryOverridesText),
                                         description: editorState.description,
                                         eyebrow: editorState.eyebrow,
                                         game: {
                                           ...currentGame,
                                           country: editorState.country,
                                           difficulty: editorState.difficulty,
                                           gameDate: editorState.gameDate,
                                           language: editorState.language,
                                           startDate: editorState.gameDate || currentGame.startDate || "",
                                         },
                                         heroSubtitle: editorState.heroSubtitle,
                                         heroTitle: editorState.heroTitle,
                                         name: editorState.name,
                                         prompts: {
                                           ...currentPrompts,
                                           advisor: editorState.systemPrompt,
                                           leader: editorState.leaderPrompt,
                                           ...advancedPrompts,
                                         },
                                         subtitle: editorState.subtitle,
                                         world: {
                                           ...currentWorld,
                                           difficulty: editorState.difficulty,
                                           language: editorState.language,
                                           simulationRules: editorState.simulationRules,
                                           startingTimelineText: editorState.startingTimelineText,
                                         },
      });

      setEditorDetails(details);
      setEditorState(buildEditorState(details));
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleFileSelect = async (assetKey, event) => {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (!file || !editorDetails) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      const details = await uploadScenarioAsset(editorDetails.scenario.id, assetKey, file);
      setEditorDetails(details);
      setEditorState(buildEditorState(details));
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleClearAsset = async (assetKey) => {
    if (!editorDetails?.assetStatus?.[assetKey]) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      const details = await clearScenarioAsset(editorDetails.scenario.id, assetKey);
      setEditorDetails(details);
      setEditorState(buildEditorState(details));
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!editorDetails?.scenario?.canDelete) {
      return;
    }

    if (!window.confirm(`Delete scenario "${editorDetails.scenario.name}"?`)) {
      return;
    }

    setEditorError(null);
    setIsBusy(true);

    try {
      await removeScenario(editorDetails.scenario.id);
      setEditorDetails(null);
      setEditorState(null);
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleActivate = async (scenarioId) => {
    setEditorError(null);
    setIsBusy(true);

    try {
      await activateScenario(scenarioId);
      if (editorDetails?.scenario?.id === scenarioId) {
        const details = await loadScenarioDetails(scenarioId);
        setEditorDetails(details);
        setEditorState(buildEditorState(details));
      }
    } catch (nextError) {
      setEditorError(nextError.message);
    } finally {
      setIsBusy(false);
    }
  };

  const panelCards = scenarios.length > 0 ? scenarios : [];

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
      display: "flex",
      gap: "0.9rem",
      height: `${BAR_HEIGHT}px`,
      justifyContent: "space-between",
      left: 0,
      padding: "0 1rem",
      position: "fixed",
      right: 0,
      top: 0,
      zIndex: 10030,
    }}
    >
    <div style={{ alignItems: "center", display: "flex", gap: "0.8rem", minWidth: 0 }}>
    <div
    style={{
      alignItems: "center",
      background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "999px",
          display: "flex",
          height: "2.65rem",
          justifyContent: "center",
          overflow: "hidden",
          width: "2.65rem",
    }}
    >
    <img alt="Open Historia" src="/logo.png" style={{ height: "1.7rem", width: "1.7rem" }} />
    </div>
    <div style={{ minWidth: 0 }}>
    <div style={{ color: "#fff", fontSize: "1rem", fontWeight: 800, letterSpacing: "-0.03em" }}>
    Open Historia
    </div>
    <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.72rem", marginTop: "0.08rem" }}>
    Server-backed scenario deck
    </div>
    </div>
    </div>

    <div
    style={{
      alignItems: "center",
      display: "flex",
      flex: 1,
      gap: "0.55rem",
      justifyContent: "center",
      minWidth: 0,
      overflowX: "auto",
      padding: "0 0.35rem",
      scrollbarWidth: "none",
    }}
    >
    {panelCards.slice(0, 6).map((scenario) => {
      const active = scenario.id === activeScenarioId;

      return (
        <button
        key={scenario.id}
        onClick={() => handleActivate(scenario.id)}
        style={{
          ...actionButtonStyle,
          background: active ? `${scenario.accentColor}55` : "rgba(255,255,255,0.05)",
              borderColor: active ? `${scenario.accentColor}88` : "rgba(255,255,255,0.08)",
              color: "#fff",
              flexShrink: 0,
        }}
        >
        {scenario.name}
        </button>
      );
    })}
    </div>

    <div style={{ alignItems: "center", display: "flex", gap: "0.55rem" }}>
    <button onClick={() => setIsPanelOpen((open) => !open)} style={actionButtonStyle}>
    {isPanelOpen ? "Hide Deck" : "Scenarios"}
    </button>
    <button
    onClick={() => refreshScenarioCatalog({ force: true }).catch(() => {})}
    style={actionButtonStyle}
    >
    Refresh
    </button>
    <button
    onClick={handleCreateScenario}
    style={{
      ...actionButtonStyle,
      background: `${activeScenario?.accentColor ?? "#7c3aed"}cc`,
      borderColor: `${activeScenario?.accentColor ?? "#7c3aed"}dd`,
      color: "#fff",
    }}
    >
    New Scenario
    </button>
    </div>
    </div>

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
      <div
      style={{
        alignItems: "center",
        display: "flex",
        gap: "0.7rem",
        justifyContent: "space-between",
        marginBottom: "0.9rem",
      }}
      >
      <div>
      <div style={{ color: "#fff", fontSize: "1.45rem", fontWeight: 800, letterSpacing: "-0.04em" }}>
      {activeScenario?.heroTitle || activeScenario?.name || "Scenario Deck"}
      </div>
      <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.9rem", marginTop: "0.2rem" }}>
      {activeScenario?.heroSubtitle || "Switch prompts, names, and PMTiles without cloning full saves."}
      </div>
      </div>
      <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.8rem" }}>
      {scenarios.length} scenario{scenarios.length === 1 ? "" : "s"}
      </div>
      </div>

      <div
      style={{
        display: "flex",
        gap: "0.9rem",
        overflowX: "auto",
        paddingBottom: "0.15rem",
        scrollbarWidth: "thin",
      }}
      >
      {panelCards.map((scenario) => (
        <ScenarioCard
        key={scenario.id}
        active={scenario.id === activeScenarioId}
        onActivate={handleActivate}
        onEdit={openEditor}
        scenario={scenario}
        />
      ))}
      </div>
      </div>
    )}

    <ScenarioEditor
    details={editorDetails}
    editorError={editorError || error}
    fileInputsRef={fileInputsRef}
    formState={editorState}
    isBusy={isBusy || loading}
    onChange={(field, value) => {
      setEditorState((current) => ({
        ...current,
        [field]: value,
      }));
    }}
    onClearAsset={handleClearAsset}
    onClose={() => {
      setEditorDetails(null);
      setEditorState(null);
      setEditorError(null);
    }}
    onDelete={handleDelete}
    onFileSelect={handleFileSelect}
    onOpenFileDialog={(assetKey) => fileInputsRef.current[assetKey]?.click()}
    onSave={handleSave}
    onSetActive={() => handleActivate(editorDetails?.scenario?.id)}
    />

    {!loaded && (
      <div
      style={{
        color: "rgba(255,255,255,0.6)",
                 fontSize: "0.82rem",
                 position: "fixed",
                 right: "1.25rem",
                 top: "4.35rem",
                 zIndex: 10028,
      }}
      >
      Loading scenarios...
      </div>
    )}
    </>
  );
};

export { ScenarioTopBar, TOP_BAR_OFFSET };
