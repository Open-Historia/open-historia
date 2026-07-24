/*! Open Historia — new-game faction creator © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The "Create faction" tab of the new-game country picker. Lets a player invent
// the power they want to lead — name, flag, colour, lore — and either claim a set
// of starting regions or begin LANDLESS (a government-in-exile, a movement with no
// territory yet). It collects the choice and hands one object to onCreate; the
// parent (libraryBar) owns persistence, because a faction is written across the
// game's world.json, colors.json and flags.json.

import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";

// The editor's flag picker drops in unchanged — it is prop-driven and pulls in no
// editor stores. It returns a flag STRING (a flagcdn URL or a PNG data URL) or
// null via onPick.
const CountryPickerMap = lazy(() => import("./CountryPickerMap.jsx"));
const FlagPicker = lazy(() => import("../../Editor/FlagPicker.jsx"));

const label = { color: "rgba(255,255,255,0.7)", fontSize: "0.78rem", fontWeight: 700, margin: "0.1rem 0 0.3rem" };
const field = {
  background: "rgba(0,0,0,0.28)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 8,
  color: "#fff",
  fontFamily: "sans-serif",
  fontSize: "0.85rem",
  outline: "none",
  padding: "0.55rem 0.7rem",
  width: "100%",
  boxSizing: "border-box",
};
const pill = (active) => ({
  background: active ? "rgba(124,58,237,0.28)" : "rgba(255,255,255,0.06)",
  border: `1px solid ${active ? "rgba(124,58,237,0.7)" : "rgba(255,255,255,0.1)"}`,
  borderRadius: 999,
  color: "#fff",
  cursor: "pointer",
  fontSize: "0.8rem",
  fontWeight: 700,
  padding: "0.35rem 0.85rem",
});

const FactionCreator = ({ regionsGeojson, onCreate, onCancel, busy }) => {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#7c3aed");
  const [flag, setFlag] = useState(null); // string (URL / data URL) or null
  const [lore, setLore] = useState("");
  const [landless, setLandless] = useState(true);
  const [regionIds, setRegionIds] = useState(() => new Set());
  const [flagOpen, setFlagOpen] = useState(false);

  const toggleRegion = (id) => {
    setRegionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const trimmedName = name.trim();
  const canCreate = trimmedName.length > 0 && !busy;

  const submit = () => {
    if (!canCreate) return;
    onCreate({
      name: trimmedName,
      color,
      flag: flag || null,
      lore: lore.trim(),
      // Landless is the explicit toggle. Even with the "claim territory" mode open,
      // a faction that selected nothing starts landless — the toggle just makes that
      // a deliberate, visible choice rather than an accident.
      regionIds: landless ? [] : [...regionIds],
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div>
        <div style={label}>Name</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Free Cascadia, the Provisional Government…"
          style={field}
        />
      </div>

      <div style={{ display: "flex", gap: "0.8rem", alignItems: "flex-end" }}>
        <div>
          <div style={label}>Colour</div>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ width: 48, height: 34, background: "none", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 8, cursor: "pointer" }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={label}>Flag</div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {flag ? (
              <img src={flag} alt="" style={{ width: 34, height: 22, objectFit: "contain", borderRadius: 3, border: "1px solid rgba(255,255,255,0.25)" }} />
            ) : (
              <span aria-hidden="true" style={{ fontSize: "1.4rem" }}>🏳️</span>
            )}
            <button type="button" onClick={() => setFlagOpen(true)} style={pill(false)}>
              {flag ? "Change flag" : "Choose flag"}
            </button>
            {flag && (
              <button type="button" onClick={() => setFlag(null)} style={pill(false)}>Remove</button>
            )}
          </div>
        </div>
      </div>

      <div>
        <div style={label}>Lore</div>
        <textarea
          value={lore}
          onChange={(e) => setLore(e.target.value)}
          placeholder="Who is this power? Its history, cause, and ambitions. This steers the story the AI tells."
          rows={3}
          style={{ ...field, resize: "vertical", minHeight: "3.4rem" }}
        />
      </div>

      <div>
        <div style={label}>Starting territory</div>
        <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.4rem" }}>
          <button type="button" onClick={() => setLandless(true)} style={pill(landless)}>Start landless</button>
          <button type="button" onClick={() => setLandless(false)} style={pill(!landless)}>Claim regions</button>
        </div>
        {landless ? (
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.76rem" }}>
            You begin with no territory — a stateless power. Your campaign is to gain
            or retake land.
          </div>
        ) : (
          <>
            <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.76rem", marginBottom: "0.3rem" }}>
              {regionIds.size} region{regionIds.size === 1 ? "" : "s"} claimed
            </div>
            <Suspense fallback={<div style={{ color: "rgba(255,255,255,0.5)", padding: "2rem 0", textAlign: "center" }}>Loading map…</div>}>
              <CountryPickerMap
                countryOptions={[]}
                onPickCountry={() => {}}
                regionsGeojson={regionsGeojson}
                selectionMode="regions"
                selectedRegionIds={regionIds}
                onToggleRegion={toggleRegion}
                selectionColor={color}
              />
            </Suspense>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.2rem" }}>
        <button
          type="button"
          onClick={submit}
          disabled={!canCreate}
          style={{
            ...pill(true),
            flex: 1,
            opacity: canCreate ? 1 : 0.5,
            cursor: canCreate ? "pointer" : "not-allowed",
            padding: "0.55rem",
          }}
        >
          {busy ? "Creating…" : "Create & play"}
        </button>
        <button type="button" onClick={onCancel} style={{ ...pill(false), padding: "0.55rem 1rem" }}>Cancel</button>
      </div>

      {/* Portalled to <body>, exactly as the editor mounts it outside its own
          backdrop-filtered panel. Two things trap it otherwise: the new-game modal
          card has backdrop-filter, which makes a containing block for position:fixed
          — so the picker's full-screen overlay resolves to the card's box, not the
          viewport, and its top is cut off (its own comment documents this). And the
          picker's overlay is z-index 130 while the modal is 10060, so even freed it
          would sit behind. The portal escapes the containing block; the wrapper's
          stacking context (above the modal) lifts it in front. */}
      {flagOpen && createPortal(
        <Suspense fallback={null}>
          <div style={{ position: "relative", zIndex: 10070 }}>
            <FlagPicker
              open
              onClose={() => setFlagOpen(false)}
              ownerCode={trimmedName}
              currentFlag={flag}
              onPick={(picked) => setFlag(picked || null)}
            />
          </div>
        </Suspense>,
        document.body,
      )}
    </div>
  );
};

export default FactionCreator;
