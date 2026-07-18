/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Inspector for the current region selection: edit name (single), type, and the
// owning country for one or many selected regions. Writes straight to the OL
// features via the map API, which live-restyles the map.
//
// The Country field is free text holding the country's NAME. Typing a name that
// doesn't exist yet is how a new country is created — there is no separate "add
// country" step, because a country exists precisely when a region says it owns it.

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

const SelectionInspector = ({ api, selection, types, colors, colorOverrides, setColorOverride, flags, setFlag, onOpenFlagPicker, tags, setTags, setSelection }) => {
  const summaries = useMemo(
    () => (api ? selection.map((id) => api.getRegionSummary(id)).filter(Boolean) : []),
    [api, selection],
  );
  const [form, setForm] = useState({ name: "", typeId: "", owner: "", claimants: [] });
  // Recomputed per selection rather than memoised on the region set: the map has
  // no change event to key on, and a scan of 3,662 features to build ~230 strings
  // is cheap next to opening a panel.
  const countryNames = useMemo(
    () => (api?.listOwners ? api.listOwners() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, selection.join(",")],
  );

  useEffect(() => {
    // Claimants are an array, so "common value" compares serialized lists.
    const claimantKeys = summaries.map((s) => JSON.stringify(s.claimants || []));
    setForm({
      name: summaries.length === 1 ? summaries[0].name : "",
      typeId: commonOr(summaries.map((s) => s.typeId)),
      owner: commonOr(summaries.map((s) => s.owner || "")),
      claimants: JSON.parse(commonOr(claimantKeys, "[]") || "[]"),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.join(",")]);

  if (!selection.length) return null;
  const single = selection.length === 1;
  const apply = (patch) => api?.setRegionAttrs(selection, patch);
  const ownerRgb = form.owner && colors[form.owner];
  // Only offer Reset when there is something to reset to — i.e. the map-maker set
  // this colour, rather than it being the country's stock one.
  const isCustomColor = Boolean(form.owner && colorOverrides?.[form.owner]);
  const ownerFlag = form.owner ? flags?.[form.owner] : null;
  const ownerTags = (form.owner && tags?.[form.owner]) || [];

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
      <Row label="Country" title="The country that owns this region — type its full name. A name that doesn't exist yet becomes a new country.">
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {ownerRgb && (
            <span style={{ width: 18, height: 18, borderRadius: 4, border: "1px solid rgba(255,255,255,0.3)", background: rgbToHex(ownerRgb) }} />
          )}
          {/* Every country already on the map, so an author picks "United Arab
              Emirates" rather than retyping it and forking a near-miss. Free-text
              still wins — typing a new name is how a new country is created. */}
          <datalist id="oh-country-names">
            {countryNames.map((name) => <option key={name} value={name} />)}
          </datalist>
          <TextField
            list="oh-country-names"
            value={form.owner}
            onChange={(v) => {
              // No case-folding: the owner IS the country's display name, so
              // "Russia" must stay "Russia".
              //
              // The field keeps v RAW and only what's applied is trimmed. Trimming
              // the state would make multi-word names untypeable: "United " trims
              // back to "United", so the next keystroke yields "UnitedS". Trimming
              // on apply still matters — a trailing space forks a second polity
              // that looks identical to a human.
              setForm((f) => ({ ...f, owner: v }));
              apply({ owner: v.trim() || null });
            }}
            width={180}
          />
        </span>
      </Row>
      <Row
        label="Disputed by"
        title="Countries that claim this region. With any claimant set, the region renders STRIPED — the current owner's colour plus each claimant's — here and in the game."
      >
        <TagField
          value={form.claimants}
          suggestions={countryNames}
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
