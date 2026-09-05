/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Inspector for the current region selection: edit name (single), type, and the
// owning country for one or many selected regions. Writes straight to the OL
// features via the map API, which live-restyles the map.
//
// Regions store a STABLE polity key. Display names and polity metadata live in
// the polity registry. The Polity field is free text over that registry: an
// existing polity is matched by key or display name (case-insensitively, so
// "france" cannot fork a second France), and a name nobody has yet becomes a
// new polity — but only on Enter or the Create button, never on blur or a
// keystroke, so a half-typed name cannot mint a one-province country by
// accident. Alt-history needs countries that do not exist yet, and the map is
// where an author has the territory in front of them.

import { useEffect, useMemo, useState } from "react";
import Panel from "./Panel.jsx";
import Icon from "./Icon.jsx";
import { pillButton } from "./editorStyles.js";
import { Row, TextField, SelectField, ColorField, TagField } from "./fields.jsx";
import { TAG_SUGGESTIONS } from "../runtime/countryTags.js";
import { rgbToHex } from "./fields.jsx";

const commonOr = (arr, blank = "") => {
  if (!arr.length) return blank;
  const first = arr[0];
  return arr.every((v) => v === first) ? first ?? blank : blank;
};

const foldPolityName = (value) => String(value ?? "").trim().toLowerCase();

const SelectionInspector = ({ api, selection, types, colors, colorOverrides, setColorOverride, flags, setFlag, onOpenFlagPicker, tags, setTags, setSelection, polities = {}, upsertPolity, regionEpoch = 0, onOpenPolities }) => {
  const summaries = useMemo(
    () => (api ? selection.map((id) => api.getRegionSummary(id)).filter(Boolean) : []),
    [api, selection, regionEpoch],
  );
  const [form, setForm] = useState({ name: "", typeId: "", owner: "", claimants: [] });
  // What the Polity field shows while it is being typed in; null when it is
  // not, so the field follows the owner (and a rename in the Polities panel).
  const [ownerDraft, setOwnerDraft] = useState(null);
  // Recomputed per selection rather than memoised on the region set: the map has
  // no change event to key on, and a scan of 3,662 features to build ~230 strings
  // is cheap next to opening a panel.
  const countryNames = useMemo(
    () => (api?.listOwners ? api.listOwners() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, selection.join(","), regionEpoch],
  );
  const polityOptions = useMemo(() => {
    const keys = new Set([...countryNames, ...Object.keys(polities || {})]);
    return [...keys]
      .map((key) => ({ key, name: String(polities?.[key]?.name || key) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  }, [countryNames, polities]);

  useEffect(() => {
    // Claimants are an array, so "common value" compares serialized lists.
    const claimantKeys = summaries.map((s) => JSON.stringify(s.claimants || []));
    setForm({
      name: summaries.length === 1 ? summaries[0].name : "",
      typeId: commonOr(summaries.map((s) => s.typeId)),
      owner: commonOr(summaries.map((s) => s.owner || "")),
      claimants: JSON.parse(commonOr(claimantKeys, "[]") || "[]"),
    });
    setOwnerDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.join(","), regionEpoch]);

  if (!selection.length) return null;
  const single = selection.length === 1;
  const apply = (patch) => api?.setRegionAttrs(selection, patch);
  const ownerRgb = form.owner && colors[form.owner];
  // Only offer Reset when there is something to reset to — i.e. the map-maker set
  // this colour, rather than it being the country's stock one.
  const isCustomColor = Boolean(form.owner && colorOverrides?.[form.owner]);
  const ownerFlag = form.owner ? flags?.[form.owner] : null;
  const ownerTags = (form.owner && tags?.[form.owner]) || [];
  const polityLabel = (key) => (key ? String(polities?.[key]?.name || key) : "");
  const ownerShown = ownerDraft ?? polityLabel(form.owner);
  // The polity a typed name means: its exact key, else a key or display name
  // matched without regard to case. null means nobody has this name yet.
  const resolvePolityKey = (text) => {
    const exact = String(text ?? "").trim();
    const wanted = foldPolityName(exact);
    if (!wanted) return "";
    if (polityOptions.some((row) => row.key === exact)) return exact;
    const byKey = polityOptions.find((row) => foldPolityName(row.key) === wanted);
    if (byKey) return byKey.key;
    const byName = polityOptions.find((row) => foldPolityName(row.name) === wanted);
    return byName ? byName.key : null;
  };
  const draftText = String(ownerShown ?? "").trim();
  const draftResolved = ownerDraft === null ? form.owner : resolvePolityKey(draftText);
  const draftIsNew = ownerDraft !== null && draftResolved === null;
  const setOwner = (key) => {
    setOwnerDraft(null);
    if (key === form.owner) return;
    setForm((f) => ({ ...f, owner: key }));
    apply({ owner: key || null });
  };
  // Enter / Create: an existing polity is assigned, a new name is created in
  // the registry (the same record the Polities panel makes) and assigned.
  const commitOwner = () => {
    if (ownerDraft === null) return;
    const key = resolvePolityKey(draftText);
    if (key === null) {
      upsertPolity?.(draftText, { name: draftText, code: draftText, aliases: [draftText], status: "active", note: "" });
      setOwner(draftText);
      return;
    }
    setOwner(key);
  };
  // Leaving the field assigns only what already exists; a new name stays in
  // the field with its Create button, so creation is always a deliberate act.
  const settleOwner = () => {
    if (ownerDraft === null) return;
    const key = resolvePolityKey(draftText);
    if (key === null) return;
    setOwner(key);
  };

  return (
    <Panel
      title={single ? "Region" : `${selection.length} regions`}
      icon="modify"
      onClose={() => setSelection([])}
      side="right"
      width={300}
    >
      {single && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
          {summaries[0]?.id}
        </div>
      )}
      {single && (
        <Row label="Name">
          <TextField
            value={form.name}
            onChange={(v) => {
              setForm((f) => ({ ...f, name: v }));
              apply({ name: v });
            }}
            width={160}
          />
        </Row>
      )}
      <Row label="Type">
        <SelectField
          value={form.typeId}
          onChange={(v) => {
            setForm((f) => ({ ...f, typeId: v }));
            apply({ typeId: v });
          }}
          options={[
            ...(form.typeId ? [] : [{ value: "", label: "— mixed —" }]),
            ...types.map((t) => ({ value: t.id, label: t.name })),
          ]}
          width={160}
        />
      </Row>
      <Row label="Polity" title="The polity that owns these regions. Type an existing polity's name, or a name that does not exist yet and press Enter to create it — a country that has never existed is one keystroke away. Rename and manage polities in the Polities panel; changing a display name there keeps all territory attached.">
        <span style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
            {ownerRgb && (
              <span style={{ width: 18, height: 18, borderRadius: 4, border: "1px solid rgba(255,255,255,0.3)", background: rgbToHex(ownerRgb) }} />
            )}
            <input
              value={ownerShown}
              list="oh-polity-options"
              placeholder={selection.length > 1 && !form.owner ? "mixed / unowned" : "Unowned — type a polity"}
              onChange={(e) => setOwnerDraft(e.target.value)}
              onBlur={settleOwner}
              onKeyDown={(e) => {
                // No Escape shortcut: the suggestion popup owns that key.
                if (e.key === "Enter" || e.code === "Enter" || e.keyCode === 13) {
                  e.preventDefault();
                  commitOwner();
                }
              }}
              style={{
                flex: 1,
                minWidth: 0,
                padding: "0.45rem 0.5rem",
                borderRadius: 8,
                border: `1px solid ${draftIsNew ? "rgba(120,200,255,0.55)" : "rgba(255,255,255,0.16)"}`,
                background: "rgba(0,0,0,0.28)",
                color: "white",
              }}
            />
            <datalist id="oh-polity-options">
              {polityOptions.map((row) => (
                <option key={row.key} value={row.name} label={row.name !== row.key ? row.key : undefined} />
              ))}
            </datalist>
            <button type="button" onClick={onOpenPolities} style={pillButton(false)} title="Create, rename and manage polities">
              Polities…
            </button>
          </span>
          {ownerDraft !== null && !draftText && form.owner && (
            <button type="button" onClick={() => setOwner("")} style={pillButton(false)}>
              Make unowned
            </button>
          )}
          {draftIsNew && (
            <button
              type="button"
              onClick={commitOwner}
              style={pillButton(true)}
              title="No polity has this name yet. Create it and give it these regions (Enter does the same)."
            >
              Create “{draftText}”
            </button>
          )}
        </span>
      </Row>
      <Row
        label="Disputed by"
        title="Countries that claim this region. With any claimant set, the region renders STRIPED — the current owner's colour plus each claimant's — here and in the game."
      >
        <TagField
          value={form.claimants}
          suggestions={polityOptions.map((row) => row.key)}
          onChange={(next) => {
            const claimants = next.map((v) => String(v).trim()).filter(Boolean);
            setForm((f) => ({ ...f, claimants }));
            apply({ claimants });
          }}
        />
      </Row>
      {form.owner && setColorOverride && (
        <Row label="Colour" title="The colour this country is painted, here and in the game">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ColorField
              value={ownerRgb || [128, 128, 128]}
              onChange={(rgb) => setColorOverride(form.owner, rgb)}
            />
            {isCustomColor && (
              <button
                onClick={() => setColorOverride(form.owner, null)}
                style={pillButton(false)}
                title="Go back to this country's standard colour"
              >
                Reset
              </button>
            )}
          </span>
        </Row>
      )}
      {form.owner && setFlag && (
        <Row label="Flag" title="Shown in the country panel and profile circles in-game">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {ownerFlag && (
              <img
                src={ownerFlag}
                alt=""
                style={{ width: 26, height: 18, objectFit: "contain", borderRadius: 3, border: "1px solid rgba(255,255,255,0.3)" }}
              />
            )}
            <button onClick={() => onOpenFlagPicker(form.owner)} style={pillButton(false)}>
              {ownerFlag ? "Change" : "Choose flag"}
            </button>
          </span>
        </Row>
      )}
      {form.owner && setTags && (
        <Row
          label="Tags"
          title="What this country IS — ideology, alignment, posture. Shown in the country panel, and given to the AI as context for everything this country does."
        >
          <TagField
            value={ownerTags}
            suggestions={TAG_SUGGESTIONS}
            onChange={(next) => setTags(form.owner, next)}
          />
        </Row>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        <button
          onClick={() => {
            setForm((f) => ({ ...f, owner: "" }));
            apply({ owner: null });
          }}
          style={pillButton(false)}
        >
          Clear country
        </button>
        {selection.length >= 2 && (
          <button onClick={() => api?.mergeRegions(selection)} style={{ ...pillButton(false), display: "flex", alignItems: "center", gap: 4 }}>
            <Icon name="merge" size={13} /> Merge
          </button>
        )}
        <button onClick={() => api?.copyRegions(selection)} style={{ ...pillButton(false), display: "flex", alignItems: "center", gap: 4 }}>
          <Icon name="copy" size={13} /> Copy
        </button>
        <button onClick={() => api?.zoomToSelection(selection)} style={{ ...pillButton(false), display: "flex", alignItems: "center", gap: 4 }}>
          <Icon name="fit" size={13} /> Zoom
        </button>
        <button
          onClick={() => api?.deleteRegions(selection)}
          style={{ ...pillButton(false), color: "#f87171", display: "flex", alignItems: "center", gap: 4 }}
        >
          <Icon name="trash" size={13} /> Delete
        </button>
      </div>
    </Panel>
  );
};

export default SelectionInspector;
