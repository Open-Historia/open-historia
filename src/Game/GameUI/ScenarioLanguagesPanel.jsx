/*! Open Historia — the scenario editor's Languages tab © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// A scenario's own text in other languages (server/scenarioLanguages.js),
// translated once with its author's AI and shipped with it, so every player
// of the scenario reads its names, events and descriptions properly translated
// in their language, with no request of their own (runtime/translator.js).
//
// The author picks the languages (the game's interface languages; some are
// ticked to begin with) and presses Generate: the scenario's strings are
// collected, what each pack already has is skipped, and the rest goes to the
// AI in large batches (runtime/scenarioLanguagePacks.js), the number of
// requests said beforehand. Each language shows how much of the scenario it
// covers, and any string can be corrected by hand; a later Generate asks only
// for what is missing or was rewritten since, and never touches a string
// already done.
//
// Nothing is saved from here: the packs are part of the editor's form, and
// its Save writes them with the rest of the scenario.

import React, { useEffect, useMemo, useRef, useState } from "react";

import { downloadScenarioJsonAsset } from "../../runtime/library.js";
import { DEFAULT_LANGUAGE, getStoredLanguage, getUiLanguageOptions, hasShippedPack } from "../../runtime/i18n.js";
import { useTouchPrimary } from "../../runtime/mobileUi.js";
import {
  collectScenarioStrings,
  generateScenarioLanguagePacks,
  languageCoverage,
  loadShippedPackFor,
  missingStrings,
  planScenarioTranslation,
} from "../../runtime/scenarioLanguagePacks.js";
import { isFallbackListConfigured } from "../AI/providerConfig.js";
import { askCreatorsAI } from "../AI/scenarioTranslation.js";

const cardStyle = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  marginBottom: "0.95rem",
  padding: "0.9rem",
};
const buttonStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "9px",
  color: "rgba(246,246,248,0.92)",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: "0.76rem",
  fontWeight: 700,
  gap: "0.35rem",
  justifyContent: "center",
  minHeight: "2rem",
  padding: "0 0.8rem",
};
// A little brighter than its neighbours, and still grey: no blue buttons here.
const primaryButtonStyle = { ...buttonStyle, background: "rgba(255,255,255,0.14)", borderColor: "rgba(255,255,255,0.3)", color: "#ffffff" };
const inputStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "10px",
  boxSizing: "border-box",
  color: "#f8fafc",
  fontFamily: "inherit",
  fontSize: "0.8rem",
  outline: "none",
  padding: "0.5rem 0.6rem",
  width: "100%",
};
const quietStyle = { color: "rgba(255,255,255,0.58)", fontSize: "0.76rem", lineHeight: 1.5 };
const titleStyle = { color: "#fff", fontSize: "0.86rem", fontWeight: 800, marginBottom: "0.5rem" };
const rowStyle = {
  alignItems: "center",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "12px",
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
  padding: "0.45rem 0.55rem",
};
const touchFit = (style, touch) => (touch ? { ...style, minHeight: undefined, minWidth: undefined } : style);

// Ticked for a scenario that has no pack yet: the languages most of the
// game's players read it in, and the author's own.
const DEFAULT_CODES = Object.freeze(["de", "es", "fr", "pt", "ru", "zh"]);
// The form's fields of the scenario's card, collected as typed.
const CARD_FIELDS = Object.freeze(["name", "heroTitle", "eyebrow", "subtitle", "heroSubtitle", "description"]);
// How many strings the hand editor lists at once.
const STRINGS_SHOWN = 60;

// The scenario's own files the strings come from: a custom Stats sheet, and
// the names on its own map. A scenario on the stock map has none of its own.
const loadOwnAssets = async (details) => {
  const id = details?.scenario?.id;
  const status = details?.assetStatus ?? {};
  const load = (key) => (id && status[key] ? downloadScenarioJsonAsset(id, key).catch(() => null) : Promise.resolve(null));
  const [stats, regionsGeojson, citiesGeojson] = await Promise.all([load("stats"), load("regionsGeojson"), load("citiesGeojson")]);
  return { stats, regionsGeojson, citiesGeojson };
};

const LanguageRow = ({ code, name, coverage, editing, onEdit, onRemove, touch }) => (
  <div style={rowStyle}>
    <div style={{ flex: "1 1 10rem", minWidth: 0 }}>
      <div data-no-translate style={{ fontSize: "0.84rem", fontWeight: 700 }}>{name}</div>
      {coverage ? (
        <div style={{ ...quietStyle, color: coverage.missing ? "#fde68a" : "rgba(255,255,255,0.58)" }}>
          {coverage.missing ? `${coverage.done} of ${coverage.total} strings` : "Up to date"}
        </div>
      ) : null}
    </div>
    <button className="oh-tap-row" onClick={onEdit} style={touchFit(buttonStyle, touch)} type="button">{editing ? "Hide strings" : "Edit strings"}</button>
    <button className="oh-tap-row" onClick={onRemove} style={touchFit(buttonStyle, touch)} type="button">{"Remove"}</button>
  </div>
);

// Every string of one language, the English beside its translation, which
// can be typed over. An emptied one is missing again, for the next Generate.
const StringEditor = ({ strings, pack, covered, onChange }) => {
  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [shown, setShown] = useState(STRINGS_SHOWN);
  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const missing = onlyMissing ? new Set(missingStrings(strings, pack, covered).map((item) => item.text)) : null;
    return strings.filter((item) => (!missing || missing.has(item.text))
      && (!needle || item.text.toLowerCase().includes(needle) || String(pack?.[item.text] ?? "").toLowerCase().includes(needle)));
  }, [strings, pack, covered, query, onlyMissing]);
  return (
    <div style={{ display: "grid", gap: "0.45rem", marginTop: "0.5rem" }}>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <input
          onChange={(event) => { setQuery(event.target.value); setShown(STRINGS_SHOWN); }}
          placeholder="Search strings"
          style={{ ...inputStyle, flex: "1 1 12rem", width: "auto" }}
          type="search"
          value={query}
        />
        <label style={{ ...quietStyle, alignItems: "center", display: "inline-flex", gap: "0.35rem" }}>
          <input checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)} type="checkbox" />
          {"Missing only"}
        </label>
      </div>
      {listed.slice(0, shown).map((item) => {
        const fromGame = covered && Object.hasOwn(covered, item.text) && !Object.hasOwn(pack ?? {}, item.text);
        return (
          <div key={item.text} style={{ display: "grid", gap: "0.25rem" }}>
            <div data-no-translate style={{ ...quietStyle, overflowWrap: "anywhere" }}>{item.text}</div>
            <textarea
              onChange={(event) => onChange(item.text, event.target.value)}
              placeholder={fromGame ? covered[item.text] : ""}
              rows={item.text.length > 90 ? 3 : 1}
              style={{ ...inputStyle, resize: "vertical" }}
              value={pack?.[item.text] ?? ""}
            />
          </div>
        );
      })}
      {listed.length > shown ? (
        <button className="oh-tap-row" onClick={() => setShown((count) => count + STRINGS_SHOWN)} style={buttonStyle} type="button">
          {`Show ${Math.min(STRINGS_SHOWN, listed.length - shown)} more`}
        </button>
      ) : null}
    </div>
  );
};

const ScenarioLanguagesPanel = ({ details, formState, onChange }) => {
  const touch = useTouchPrimary();
  // As the form holds them: a translation being typed keeps its spaces until
  // the scenario is saved (the stores read the record strictly then).
  const packs = useMemo(() => {
    const raw = formState?.languages;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  }, [formState?.languages]);
  const options = useMemo(() => getUiLanguageOptions().filter((entry) => entry.code !== DEFAULT_LANGUAGE), []);
  const nameOf = (code) => {
    const entry = options.find((option) => option.code === code);
    return entry ? `${entry.name} · ${entry.native}` : code;
  };
  // The languages the author is working on: those with a pack, and those
  // ticked since. A scenario with none starts with the defaults ticked.
  const [codes, setCodes] = useState(() => {
    const own = Object.keys(packs);
    if (own.length) return own;
    const mine = getStoredLanguage();
    return [...new Set([...DEFAULT_CODES, ...(mine !== DEFAULT_LANGUAGE ? [mine] : [])])]
      .filter((code) => options.some((option) => option.code === code));
  });
  const [assets, setAssets] = useState(null);
  const [covered, setCovered] = useState({});
  const [editing, setEditing] = useState("");
  const [adding, setAdding] = useState("");
  const [run, setRun] = useState(null);
  const [message, setMessage] = useState("");
  const [aiReady, setAiReady] = useState(() => isFallbackListConfigured());
  const stopRef = useRef(null);

  useEffect(() => {
    const refresh = () => setAiReady(isFallbackListConfigured());
    window.addEventListener("ai:fallback-changed", refresh);
    return () => window.removeEventListener("ai:fallback-changed", refresh);
  }, []);

  // The scenario's own files, once per scenario opened.
  const scenarioId = details?.scenario?.id || "";
  useEffect(() => {
    let current = true;
    setAssets(null);
    void loadOwnAssets(details).then((loaded) => { if (current) setAssets(loaded); });
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the files of the scenario opened, not of each details refresh
  }, [scenarioId]);

  // The game's own pack of each language ticked: what it has needs no
  // translation (a stock country, region or city).
  const codesKey = codes.join(",");
  useEffect(() => {
    let current = true;
    for (const code of codes) {
      if (covered[code] || !hasShippedPack(code)) continue;
      void loadShippedPackFor(code).then((pack) => {
        if (current) setCovered((before) => ({ ...before, [code]: pack }));
      });
    }
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per language ticked
  }, [codesKey]);

  // The strings as the form has them now: a name typed but not yet saved is
  // what a Generate translates.
  const cardKey = JSON.stringify(CARD_FIELDS.map((key) => formState?.[key] ?? ""));
  const strings = useMemo(() => (assets ? collectScenarioStrings({
    scenario: { ...(details?.scenario ?? {}), ...Object.fromEntries(JSON.parse(cardKey).map((value, index) => [CARD_FIELDS[index], value])) },
    data: details?.data ?? {},
    assets,
  }) : null), [assets, details, cardKey]);

  const plan = useMemo(() => (strings
    ? planScenarioTranslation(Object.fromEntries(codes.map((code) => [code, missingStrings(strings, packs[code], covered[code])])))
    : []), [strings, codes, packs, covered]);

  const setPacks = (next) => onChange(next);

  const editString = (code, source, value) => {
    const pack = { ...(packs[code] ?? {}) };
    if (value.trim()) pack[source] = value;
    else delete pack[source];
    setPacks({ ...packs, [code]: pack });
  };

  const removeLanguage = (code) => {
    setCodes((list) => list.filter((entry) => entry !== code));
    if (editing === code) setEditing("");
    const next = { ...packs };
    delete next[code];
    setPacks(next);
  };

  const addLanguage = (code) => {
    if (code && !codes.includes(code)) setCodes((list) => [...list, code]);
    setAdding("");
  };

  const generate = async () => {
    if (!strings || run) return;
    setMessage("");
    const controller = new AbortController();
    stopRef.current = controller;
    setRun({ done: 0, total: plan.length });
    const scenario = { ...(details?.scenario ?? {}), ...(formState ?? {}) };
    const result = await generateScenarioLanguagePacks({
      strings,
      codes,
      packs,
      covered,
      scenario: { name: scenario.name, description: scenario.description, startDate: details?.data?.game?.startDate || formState?.gameDate || "" },
      ask: askCreatorsAI,
      signal: controller.signal,
      onProgress: ({ done, total, packs: next }) => {
        setRun({ done, total });
        // Kept as it arrives: a run stopped half-way keeps what it did.
        if (done) setPacks(next ?? {});
      },
    });
    stopRef.current = null;
    setRun(null);
    if (result.failed && controller.signal.aborted) setMessage("Stopped. What was translated is kept.");
    else if (result.failed) setMessage(`The AI stopped: ${result.failed?.message || String(result.failed)}`);
    else if (result.requests) setMessage("Generated. Save the scenario to keep them.");
    else setMessage("Every language is up to date.");
  };

  const unticked = options.filter((option) => !codes.includes(option.code));

  return (
    <div style={cardStyle}>
      <div style={titleStyle}>{"Languages"}</div>
      {!aiReady ? <div style={{ ...quietStyle, color: "#fde68a", marginBottom: "0.6rem" }}>{"Set up an AI in Settings to generate language packs."}</div> : null}

      <div style={{ display: "grid", gap: "0.45rem" }}>
        {codes.map((code) => (
          <div key={code}>
            <LanguageRow
              code={code}
              coverage={strings ? languageCoverage(strings, packs[code], covered[code]) : null}
              editing={editing === code}
              name={nameOf(code)}
              onEdit={() => setEditing((current) => (current === code ? "" : code))}
              onRemove={() => removeLanguage(code)}
              touch={touch}
            />
            {editing === code && strings ? (
              <StringEditor covered={covered[code]} onChange={(source, value) => editString(code, source, value)} pack={packs[code]} strings={strings} />
            ) : null}
          </div>
        ))}
      </div>

      {unticked.length ? (
        <select
          aria-label="Add a language"
          onChange={(event) => addLanguage(event.target.value)}
          style={{ ...inputStyle, cursor: "pointer", marginTop: "0.6rem" }}
          value={adding}
        >
          <option value="">{"Add a language"}</option>
          {unticked.map((option) => <option data-no-translate key={option.code} value={option.code}>{`${option.name} · ${option.native}`}</option>)}
        </select>
      ) : null}

      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.6rem", marginTop: "0.75rem" }}>
        <button
          className="oh-tap"
          disabled={!aiReady || !strings || Boolean(run) || !plan.length}
          onClick={generate}
          style={touchFit({ ...primaryButtonStyle, opacity: !aiReady || !strings || run || !plan.length ? 0.55 : 1 }, touch)}
          type="button"
        >
          {run ? "Generating…" : "Generate"}
        </button>
        {run ? <button className="oh-tap-row" onClick={() => stopRef.current?.abort(new Error("Stopped."))} style={touchFit(buttonStyle, touch)} type="button">{"Stop"}</button> : null}
        <span style={quietStyle}>
          {!strings ? "Reading the scenario's strings…"
            : run ? `Request ${Math.min(run.done + 1, run.total)} of ${run.total}`
              : plan.length === 1 ? "1 request to your AI"
                : plan.length ? `${plan.length} requests to your AI` : "Every language is up to date."}
        </span>
      </div>
      {message ? <div style={{ ...quietStyle, marginTop: "0.5rem" }}>{message}</div> : null}
    </div>
  );
};

export default ScenarioLanguagesPanel;
