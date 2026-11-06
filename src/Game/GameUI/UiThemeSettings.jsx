import React, { useState } from "react";
import {
  DEFAULT_UI_THEME,
  UI_THEME_PRESETS,
  normalizeUiColor,
  resetUiTheme,
  selectUiTheme,
  setCustomUiThemeColor,
  uiThemeColors,
  useUiTheme,
} from "../../runtime/uiTheme.js";
import "./uiThemeSettings.css";

// Default restores each panel's own authored colors. This is only a preview swatch.
const ORIGINAL_PREVIEW = { background: "#131315", surface: "#232327", accent: "#4B91FF" };

const FIELDS = [
  { key: "background", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "accent", label: "Accent" },
];

function ThemeColorEditor({ colorKey, label, selected }) {
  const [draft, setDraft] = useState(selected);
  const [error, setError] = useState("");
  const update = (value) => {
    setDraft(value);
    const problem = setCustomUiThemeColor(colorKey, value);
    setError(problem);
  };
  return (
    <label className="oh-theme-color-field">
      <span className="oh-theme-color-label">{label}</span>
      <span className="oh-theme-color-controls">
        <input
          type="color"
          aria-label={label}
          value={normalizeUiColor(draft) || selected}
          onChange={(event) => update(event.target.value)}
        />
        <input
          type="text"
          data-no-translate
          aria-label={label + " hex color"}
          spellCheck={false}
          maxLength={7}
          value={draft}
          onChange={(event) => update(event.target.value)}
          onBlur={() => { if (error) { setDraft(selected); setError(""); } }}
        />
      </span>
      {error && <span className="oh-theme-color-error" role="status">{error}</span>}
    </label>
  );
}
const Sample = ({ colors, large = false }) => (
  <div className="oh-theme-sample" data-large={large || undefined} style={{ "--sample-bg": colors.background, "--sample-surface": colors.surface, "--sample-accent": colors.accent }} aria-hidden="true">
    <div className="oh-theme-sample-header"><span /> <span /></div>
    <div className="oh-theme-sample-panel">
      <div className="oh-theme-sample-title" />
      <div className="oh-theme-sample-rule" />
      <div className="oh-theme-sample-line" />
    </div>
  </div>
);

export default function UiThemeSettings() {
  const theme = useUiTheme();
  const colors = uiThemeColors(theme);
  return (
    <div className="oh-theme-settings">
      <div className="oh-theme-intro">Keep the original interface or choose five themed palettes or your own. Map and gameplay colors are not affected.</div>
      <div className="oh-theme-preset-grid" role="group" aria-label="Interface theme">
        <button type="button" className="oh-theme-preset" aria-pressed={theme.preset === DEFAULT_UI_THEME} onClick={() => selectUiTheme(DEFAULT_UI_THEME)}>
          <Sample colors={ORIGINAL_PREVIEW} />
          <span>Default (Original)</span>
        </button>
        {UI_THEME_PRESETS.map((item) => (
          <button key={item.id} type="button" className="oh-theme-preset" aria-pressed={theme.preset === item.id} onClick={() => selectUiTheme(item.id)}>
            <Sample colors={item.colors} />
            <span>{item.name}</span>
          </button>
        ))}
        <button type="button" className="oh-theme-preset" aria-pressed={theme.preset === "custom"} onClick={() => selectUiTheme("custom")}>
          <Sample colors={theme.custom} />
          <span>Custom preset</span>
        </button>
      </div>
      {theme.preset === "custom" && (
        <div className="oh-theme-custom-editor">
          <div className="oh-theme-custom-heading">Custom colors</div>
          <div className="oh-theme-color-grid">
            {FIELDS.map(({ key, label }) => (
              <ThemeColorEditor key={key} colorKey={key} label={label} selected={theme.custom[key]} />
            ))}
          </div>
          <p className="oh-theme-help">High-contrast colors are required so text and controls remain readable.</p>
        </div>
      )}
      <div className="oh-theme-footer">
        <div className="oh-theme-live-preview">
          <Sample colors={theme.preset === DEFAULT_UI_THEME ? ORIGINAL_PREVIEW : colors} large />
          <span>Live preview</span>
        </div>
        <button type="button" className="oh-theme-reset" onClick={resetUiTheme} disabled={theme.preset === DEFAULT_UI_THEME && JSON.stringify(theme.custom) === JSON.stringify(UI_THEME_PRESETS[0].colors)}>
          Reset to default
        </button>
      </div>
    </div>
  );
}
