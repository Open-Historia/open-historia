/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
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

import { useEffect, useMemo, useRef, useState } from "react";
import Panel from "./Panel.jsx";
import Icon from "./Icon.jsx";
import { inputStyle, pillButton } from "./editorStyles.js";
import { TextField, SelectField, ColorField, TagField, Toggle } from "./fields.jsx";
import { isWaterType } from "../runtime/regionTypes.js";
import { TAG_SUGGESTIONS } from "../runtime/countryTags.js";
import { rgbToHex } from "./fields.jsx";
import { normalizeGroups } from "../runtime/groups.js";
import { commonClaimants, claimantDelta, applyClaimantDelta } from "./claimantEdits.js";
import { bundledFlagUrl } from "../runtime/countryFlags.js";
import MilitaryFields from "./MilitaryFields.jsx";
import { rateMilitaryFigures } from "../Game/AI/militaryRating.js";
import { militaryScaleOf } from "./militaryForm.js";
import { MAX_REACH } from "./fitToImage.js";

const commonOr = (arr, blank = "") => {
  if (!arr.length) return blank;
  const first = arr[0];
  return arr.every((v) => v === first) ? first ?? blank : blank;
};

const foldPolityName = (value) => String(value ?? "").trim().toLowerCase();

const InspectorSection = ({ title, children }) => (
  <section style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
    <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{title}</div>
    {children}
  </section>
);

const Field = ({ label, title, children }) => (
  <div title={title} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
    <span style={{ color: "rgba(255,255,255,0.72)", fontSize: 12 }}>{label}</span>
    {children}
  </div>
);

// Fit to background: a slider that pulls the selection's coasts onto the shore
// the background shows, as far as it reaches. Dragging previews the fit; letting
// go keeps it as one undo step. The fit always starts from the outlines the
// selection had when the slider was first touched, so sliding back to Off puts
// them back. A new selection, or an undo, starts afresh.
const FitToBackground = ({ api, selection, regionEpoch }) => {
  const [reach, setReach] = useState(0);
  const [metersPerPixel, setMetersPerPixel] = useState(null);
  const [status, setStatus] = useState("");
  const sessionRef = useRef(null);
  const frameRef = useRef(0);
  const reachRef = useRef(0);

  const reset = () => {
    cancelAnimationFrame(frameRef.current);
    sessionRef.current = null;
    reachRef.current = 0;
    setReach(0);
    setMetersPerPixel(null);
  };
  // Mounted afresh for each selection (keyed on it); what is shown is kept.
  useEffect(() => () => {
    cancelAnimationFrame(frameRef.current);
    sessionRef.current?.session?.commit();
    sessionRef.current = null;
  }, []);
  useEffect(() => {
    const session = sessionRef.current?.session;
    if (session && !session.current()) reset();
  }, [regionEpoch]);

  const start = () => {
    if (!sessionRef.current) {
      const entry = { session: null };
      setStatus("Reading the background…");
      entry.promise = api.fitToBackground(selection).then(
        (session) => {
          if (sessionRef.current !== entry) return null;
          entry.session = session;
          setMetersPerPixel(session?.metersPerPixel ?? null);
          setStatus(session ? "" : "There is no background picture here to fit to.");
          return session;
        },
        // A background that could not be read is not read again for this
        // selection on every move of the slider; a new selection tries afresh.
        (error) => {
          if (sessionRef.current === entry) {
            setStatus(
              error?.code === "outside"
                ? "These regions are not over the background picture."
                : error?.code === "no-shore"
                  ? "The background here shows no shore to fit to."
                  : error?.code === "closed"
                    ? "This background does not let the editor read its colours."
                    : "The background could not be read.",
            );
          }
          return null;
        },
      );
      sessionRef.current = entry;
    }
    return sessionRef.current.promise;
  };
  const preview = (value) => {
    reachRef.current = value;
    setReach(value);
    start().then((session) => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        if (session && !session.preview(value)) reset();
      });
    });
  };
  const keep = () => {
    const value = reachRef.current;
    sessionRef.current?.promise.then((session) => {
      cancelAnimationFrame(frameRef.current);
      if (session && !(session.preview(value) && session.commit())) reset();
    });
  };

  const km = metersPerPixel ? (reach * metersPerPixel) / 1000 : null;
  const shown = reach === 0 ? "Off" : km === null ? `${reach} px` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
  return (
    <Field label="Fit to background" title="Pull the coasts of these regions onto the shore the background picture shows. Borders between two land regions stay where they are.">
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="range"
          min="0"
          max={MAX_REACH}
          step="1"
          value={reach}
          aria-label="How far a coast may move to reach the shore"
          onChange={(e) => preview(Number(e.target.value))}
          onPointerUp={keep}
          onKeyUp={keep}
          onBlur={keep}
          style={{ flex: 1, minWidth: 0 }}
        />
        <span style={{ minWidth: 48, textAlign: "right", color: "rgba(255,255,255,0.72)", fontSize: 12 }}>{shown}</span>
      </span>
      {status && <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, lineHeight: 1.4 }}>{status}</span>}
    </Field>
  );
};

// freezingRegions / onSetFreezing(ids, on): the water regions that can freeze
// (warGeographyDoc.js), offered for a selection that is all water.
// militaryDefaults: what an empty military field stands for in this scenario
// (militaryForm.js militaryDefaultsFor), or null for a map opened on its own.
const SelectionInspector = ({ api, selection, types, colors, colorOverrides, setColorOverride, flags, setFlag, onOpenFlagPicker, tags, setTags, setSelection, polities = {}, upsertPolity, regionEpoch = 0, onOpenPolities, groups = {}, onOpenGroups, onCopyToClipboard = null, freezingRegions = [], onSetFreezing = null, militaryDefaults = null }) => {
  const summaries = useMemo(
    () => (api ? selection.map((id) => api.getRegionSummary(id)).filter(Boolean) : []),
    [api, selection, regionEpoch],
  );
  const [form, setForm] = useState({ name: "", typeId: "", owner: "", claimants: [], claimantsMixed: false, group: "" });
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
    // Claimants are an array: the field shows the claims every region shares,
    // and a selection whose lists differ is marked mixed.
    const claimants = commonClaimants(summaries.map((s) => s.claimants || []));
    setForm({
      name: summaries.length === 1 ? summaries[0].name : "",
      typeId: commonOr(summaries.map((s) => s.typeId)),
      owner: commonOr(summaries.map((s) => s.owner || "")),
      claimants: claimants.shown,
      claimantsMixed: claimants.mixed,
      group: commonOr(summaries.map((s) => s.group || "")),
    });
    setOwnerDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.join(","), regionEpoch]);

  if (!selection.length) return null;
  const groupRegistry = normalizeGroups(groups);
  const single = selection.length === 1;
  // Water that can freeze: offered when every region selected is of a water
  // type, and on when every one of them is marked.
  const typesById = Object.fromEntries((types || []).map((type) => [type.id, type]));
  const allWater = summaries.length > 0 && summaries.every((s) => isWaterType(typesById[s.typeId]));
  const freezing = new Set((freezingRegions || []).map(String));
  const allFreeze = allWater && summaries.every((s) => freezing.has(String(s.id)));
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

  const actionButton = { ...pillButton(false), display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 9px", minWidth: 0 };

  return (
    <Panel
      title={single ? "Region" : `${selection.length} regions`}
      icon="modify"
      onClose={() => setSelection([])}
      side="right"
      width={320}
    >
      {single && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "ui-monospace, monospace", overflowWrap: "anywhere" }}>
          {summaries[0]?.id}
        </div>
      )}

      <InspectorSection title="Region">
        {single && (
          <Field label="Name">
            <TextField
              value={form.name}
              onChange={(v) => {
                setForm((f) => ({ ...f, name: v }));
                apply({ name: v });
              }}
            />
          </Field>
        )}
        <Field label="Type">
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
            width="100%"
          />
        </Field>
        {allWater && onSetFreezing && (
          <div title="Ices over in a season of its climate zone whose effects say Water freezes (the War map panel's Climate tab)." style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12.5 }}>
            <span style={{ color: "rgba(255,255,255,0.72)" }}>Can freeze</span>
            <Toggle value={allFreeze} onChange={(on) => onSetFreezing(summaries.map((s) => String(s.id)), on)} />
          </div>
        )}
      </InspectorSection>

      <InspectorSection title="Polity">
        <Field label="Polity" title="The polity that owns these regions. Type an existing polity's name, or a name that does not exist yet and press Enter to create it — a country that has never existed is one keystroke away. Rename and manage polities in the Polities panel; changing a display name there keeps all territory attached.">
          <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
            {ownerRgb && (
              <span style={{ width: 18, height: 18, flexShrink: 0, borderRadius: 4, border: "1px solid rgba(255,255,255,0.3)", background: rgbToHex(ownerRgb) }} />
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
                ...inputStyle,
                flex: 1,
                minWidth: 0,
                padding: "5px 7px",
                border: `1px solid ${draftIsNew ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.16)"}`,
              }}
            />
            <datalist id="oh-polity-options">
              {polityOptions.map((row) => (
                <option key={row.key} value={row.name} label={row.name !== row.key ? row.key : undefined} />
              ))}
            </datalist>
            <button type="button" onClick={onOpenPolities} style={{ ...pillButton(false), flexShrink: 0 }} title="Create, rename and manage polities">
              Polities…
            </button>
          </span>
          {ownerDraft !== null && !draftText && form.owner && (
            <button type="button" onClick={() => setOwner("")} style={{ ...pillButton(false), alignSelf: "flex-start" }}>
              Make unowned
            </button>
          )}
          {draftIsNew && (
            <button
              type="button"
              onClick={commitOwner}
              style={{ ...pillButton(true), alignSelf: "flex-start", maxWidth: "100%", overflowWrap: "anywhere", textAlign: "left" }}
              title="No polity has this name yet. Create it and give it these regions (Enter does the same)."
            >
              Create “{draftText}”
            </button>
          )}
        </Field>
        {form.owner && (setColorOverride || setFlag) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {setColorOverride && (
              <Field label="Colour" title="The colour this country is painted, here and in the game">
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
              </Field>
            )}
            {setFlag && (
              <Field label="Flag" title="Shown in the country panel and profile circles in-game">
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {ownerFlag && (
                    <img
                      src={bundledFlagUrl(ownerFlag)}
                      alt=""
                      style={{ width: 26, height: 18, flexShrink: 0, objectFit: "contain", borderRadius: 3, border: "1px solid rgba(255,255,255,0.3)" }}
                    />
                  )}
                  <button onClick={() => onOpenFlagPicker(form.owner)} style={{ ...pillButton(false), minWidth: 0 }}>
                    {ownerFlag ? "Change" : "Choose flag"}
                  </button>
                </span>
              </Field>
            )}
          </div>
        )}
        {form.owner && setTags && (
          <Field
            label="Tags"
            title="What this country IS — ideology, alignment, posture. Shown in the country panel, and given to the AI as context for everything this country does."
          >
            <TagField
              value={ownerTags}
              suggestions={TAG_SUGGESTIONS}
              onChange={(next) => setTags(form.owner, next)}
            />
          </Field>
        )}
        {/* The country's military figures, here as in the Countries panel (MilitaryFields.jsx), kept with its record as
            `military`: "make it so the military settings per country are availible just by selecting the country so
            you dont need to go into the country menu" (the owner, 2026-10-16). For a selection of one country's land. */}
        {form.owner && upsertPolity && (
          <div data-oh-selection-military="">
            <MilitaryFields
              recordKey={form.owner}
              value={polities?.[form.owner]?.military}
              defaults={militaryDefaults}
              onChange={(military) => upsertPolity(form.owner, { military: military ?? undefined })}
              onRate={() => rateMilitaryFigures({
                name: polities?.[form.owner]?.name || form.owner,
                note: polities?.[form.owner]?.note,
                population: polities?.[form.owner]?.population,
                rated: militaryScaleOf(polities, groups),
                date: militaryDefaults?.gameDate,
                era: Number.isInteger(militaryDefaults?.era) ? militaryDefaults.era : null,
                rules: militaryDefaults?.rules,
              })}
            />
          </div>
        )}
      </InspectorSection>

      <InspectorSection title="Claims">
        <Field
          label="Disputed by"
          title="Countries that claim this region. With any claimant set, the region renders STRIPED — the current owner's colour plus each claimant's — here and in the game."
        >
          <TagField
            value={form.claimants}
            suggestions={polityOptions.map((row) => row.key)}
            placeholder={form.claimantsMixed ? "mixed — adds to every region…" : undefined}
            onChange={(next) => {
              const claimants = next.map((v) => String(v).trim()).filter(Boolean);
              // Differing lists change per region: an added claimant joins each
              // region's own list and a removed one leaves it, so the claims only
              // some regions carry survive. Identical lists are replaced whole.
              const delta = form.claimantsMixed ? claimantDelta(form.claimants, claimants) : null;
              setForm((f) => ({ ...f, claimants }));
              apply({ claimants: delta ? (list) => applyClaimantDelta(list, delta) : claimants });
            }}
          />
        </Field>
        <Field
          label="Controlled by group"
          title="A group — a cartel, a militia, a zombie outbreak — that controls these regions without owning them. The game outlines the group's whole area and tints it in the group's colour; the AI is told what the group is. Create and describe groups in the Groups panel."
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
            {form.group && groupRegistry[form.group] && (
              <span style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, background: groupRegistry[form.group].color, boxShadow: "0 0 0 1px rgba(0,0,0,0.5)" }} />
            )}
            <span style={{ flex: 1, minWidth: 0, display: "flex" }}>
              <SelectField
                value={form.group}
                onChange={(value) => {
                  setForm((f) => ({ ...f, group: value }));
                  apply({ group: value || null });
                }}
                options={[
                  { value: "", label: selection.length > 1 && !form.group ? "— none / mixed —" : "— none —" },
                  ...[...new Set([...Object.keys(groupRegistry), ...(form.group ? [form.group] : [])])]
                    .sort((a, b) => a.localeCompare(b))
                    .map((name) => ({ value: name, label: name })),
                ]}
                width="100%"
              />
            </span>
            <button type="button" onClick={onOpenGroups} style={{ ...pillButton(false), flexShrink: 0 }} title="Create, describe and colour groups">
              Groups…
            </button>
          </span>
        </Field>
      </InspectorSection>

      <InspectorSection title="Actions">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <button
            onClick={() => {
              setForm((f) => ({ ...f, owner: "" }));
              apply({ owner: null });
            }}
            style={actionButton}
          >
            Clear country
          </button>
          {selection.length >= 2 && (
            <button onClick={() => api?.mergeRegions(selection)} style={actionButton}>
              <Icon name="merge" size={13} /> Merge
            </button>
          )}
          <button onClick={() => api?.simplifyRegions(selection)} style={actionButton} title="Lighten these outlines to this map's own detail">
            <Icon name="modify" size={13} /> Simplify
          </button>
          <button
            onClick={() => api?.copyRegions(selection)}
            style={actionButton}
            title="Duplicate the selection beside itself, on this map"
          >
            <Icon name="copy" size={13} /> Duplicate
          </button>
          {onCopyToClipboard && (
            <button
              onClick={() => onCopyToClipboard(selection)}
              style={actionButton}
              title="Copy the selection to the region clipboard, to paste into another map (Ctrl+C)"
            >
              <Icon name="copy" size={13} /> Copy to clipboard
            </button>
          )}
          <button onClick={() => api?.zoomToSelection(selection)} style={actionButton}>
            <Icon name="fit" size={13} /> Zoom
          </button>
          <button
            onClick={() => api?.deleteRegions(selection)}
            style={{ ...actionButton, gridColumn: "1 / -1", background: "rgba(127,29,29,0.34)", border: "1px solid rgba(248,113,113,0.28)", color: "#fecaca" }}
          >
            <Icon name="trash" size={13} /> Delete
          </button>
        </div>
        {api?.fitBackground?.() && <FitToBackground key={selection.join(",")} api={api} selection={selection} regionEpoch={regionEpoch} />}
      </InspectorSection>
    </Panel>
  );
};

export default SelectionInspector;
