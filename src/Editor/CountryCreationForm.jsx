/*!
 * Open Historia Map Editor V2 — configure a whole country before registration.
 * The draft stays local. Every live map/document write occurs on final Create.
 */
import { useId, useRef, useState } from "react";
import Panel from "./Panel.jsx";
import MilitaryFields from "./MilitaryFields.jsx";
import { ColorField, rgbToHex } from "./fields.jsx";
import { inputStyle, pillButton } from "./editorStyles.js";
import { bundledFlagUrl } from "../runtime/countryFlags.js";
import { formatPopulationFigure } from "../runtime/populationFigure.js";
import { TAG_SUGGESTIONS, MAX_TAGS } from "../runtime/countryTags.js";
import { PUPPET_KIND_OPTIONS, PUPPET_SECRECY_OPTIONS } from "./scenarioPuppets.js";
import { emptyCountryDraft, planCountryDraft } from "./countryCreationDraft.js";
import StartingRelationsFields from "./StartingRelationsFields.jsx";

const TABS = [
  { id: "identity", label: "Identity" },
  { id: "appearance", label: "Appearance" },
  { id: "people", label: "People & forces" },
  { id: "relations", label: "Relations & land" },
  { id: "review", label: "Review" },
];
const section = {
  display: "grid", gap: 10, padding: 13, borderRadius: 11,
  background: "var(--oh-ui-raised, rgba(255,255,255,0.045))",
  border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.12))",
};
const label = { display: "grid", gap: 5, fontSize: 12, fontWeight: 650 };
const hint = { color: "var(--oh-ui-muted, rgba(255,255,255,0.67))", fontSize: 11, lineHeight: 1.5 };
const nameOf = (value) => String(value ?? "").trim();

function NameListEditor({ title, items = [], onChange, placeholder, suggestions, maxCount }) {
  const [candidate, setCandidate] = useState("");
  const inputRef = useRef(null);
  const suggestionId = useId();
  const add = () => {
    const text = nameOf(inputRef.current?.value ?? candidate);
    if (!text || (maxCount && items.length >= maxCount)) return;
    if (inputRef.current) inputRef.current.value = "";
    onChange([...items, text]);
    setCandidate("");
  };
  return (
    <div style={{ display: "grid", gap: 5 }}>
      <span style={{ fontSize: 12, fontWeight: 650 }}>{title}</span>
      {items.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {items.map((item, index) => (
            <span key={index} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "3px 6px 3px 9px", borderRadius: 8, maxWidth: "100%",
              background: "var(--oh-ui-active, rgba(255,255,255,0.11))",
              border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.16))",
              fontSize: 11.5,
            }}>
              <span style={{ overflowWrap: "anywhere" }}>{item}</span>
              <button type="button" title={`Remove ${item}`} aria-label={`Remove ${item}`}
                onClick={() => onChange(items.filter((_, position) => position !== index))}
                style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px" }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          ref={inputRef}
          aria-label={title}
          value={candidate}
          list={suggestions ? suggestionId : undefined}
          onChange={(event) => setCandidate(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }}
          onBlur={add}
          placeholder={placeholder}
          style={{ ...inputStyle, flex: 1, minWidth: 0 }}
        />
        <button type="button" disabled={!nameOf(candidate) || (maxCount && items.length >= maxCount)}
          onClick={add} style={pillButton(false)}>Add</button>
      </div>
      {suggestions && <datalist id={suggestionId}>{suggestions.map((value) => <option key={value} value={value} />)}</datalist>}
    </div>
  );
}

const SummaryRow = ({ title, value }) => (
  <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: 8, alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid var(--oh-ui-line, rgba(255,255,255,0.09))" }}>
    <span style={hint}>{title}</span>
    <span style={{ fontSize: 12, fontWeight: 600, overflowWrap: "anywhere" }}>{value}</span>
  </div>
);

export default function CountryCreationForm({
  polities = {}, occupiedKeys = [], puppets = [], polityChoices = [],
  militaryDefaults = null, selectionCount = 0,
  onCreate, onOpenFlagPicker, onCancel,
}) {
  const [draft, setDraft] = useState(emptyCountryDraft);
  const [tab, setTab] = useState("identity");
  const [error, setError] = useState("");
  const patch = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
  };
  const plan = planCountryDraft({ draft, polities, occupiedKeys, puppets, polityChoices });
  const cancel = () => {
    const touched = draft.name.trim() || draft.aliases.length || draft.formerNames.length ||
      draft.note.trim() || draft.population.trim() || draft.military || draft.color || draft.flag ||
      draft.tags.length || draft.overlord || draft.assignSelectedRegions || draft.startingRelations.length;
    if (touched && !window.confirm("Discard this unfinished country? No country has been created.")) return;
    onCancel?.();
  };
  const create = () => {
    if (!plan.ok) { setError(plan.reason); return; }
    const result = onCreate?.(draft);
    if (result && result.ok === false) setError(result.reason);
  };
  const index = TABS.findIndex((item) => item.id === tab);
  const overlord = nameOf(draft.overlord);
  const chosenOverlord = polityChoices.find((choice) => choice.key === overlord);
  return (
    <Panel title="Create a country" icon="flag" width={485} onClose={cancel}>
      <div style={{ ...section, gap: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "var(--oh-ui-accent, #e7e7ea)", letterSpacing: ".06em", textTransform: "uppercase" }}>
          New country · Not yet created
        </span>
        <strong style={{ fontSize: 18, overflowWrap: "anywhere" }}>{draft.name.trim() || "Untitled country"}</strong>
        <span style={hint}>Set up its identity and starting conditions first. Optional fields may be left empty. The country is not registered until you confirm on the Review tab.</span>
      </div>

      <div role="tablist" aria-label="Country setup sections" style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {TABS.map((item, position) => (
          <button type="button" key={item.id} role="tab" aria-selected={tab === item.id}
            onClick={() => { setTab(item.id); setError(""); }}
            style={{
              ...pillButton(tab === item.id), padding: "7px 10px",
              borderColor: tab === item.id ? "var(--oh-ui-accent, #e7e7ea)" : undefined,
            }}>
            {position + 1}. {item.label}
          </button>
        ))}
      </div>

      {tab === "identity" && (
        <section style={section} aria-label="Set country identity">
          <strong style={{ fontSize: 14 }}>Name & identity</strong>
          <label style={label}>
            Country name
            <input autoFocus value={draft.name} onChange={(event) => patch("name", event.target.value)}
              placeholder="For example: Kingdom of Bulgaria" style={inputStyle} />
          </label>
          <span style={hint}>This becomes the country's registered name. Renaming later will not automatically create an alternative name.</span>
          <NameListEditor title="Alternative names" items={draft.aliases}
            onChange={(next) => patch("aliases", next)} placeholder="Another name for the same country" />
          <span style={hint}>Alternative names help the game recognize the same country. They do not change its government, history or ideology.</span>
          <NameListEditor title="Former names" items={draft.formerNames}
            onChange={(next) => patch("formerNames", next)} placeholder="Older name, if applicable" />
          <span style={hint}>Only add former names supported by the scenario you're building. The editor does not invent historical transitions.</span>
          <label style={label}>
            Scenario note
            <textarea value={draft.note} onChange={(event) => patch("note", event.target.value)} rows={3}
              placeholder="Context about this country's role when the scenario begins"
              style={{ ...inputStyle, resize: "vertical" }} />
          </label>
        </section>
      )}

      {tab === "appearance" && (
        <section style={section} aria-label="Set country appearance">
          <strong style={{ fontSize: 14 }}>Flag, map colour & traits</strong>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 58, height: 38, borderRadius: 7, flexShrink: 0,
              background: draft.color ? rgbToHex(draft.color) : "var(--oh-ui-active, rgba(255,255,255,0.12))",
              border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.25))" }} />
            <span style={{ flex: 1 }}>
              <strong style={{ display: "block", fontSize: 12 }}>Map colour</strong>
              <span style={hint}>{draft.color ? rgbToHex(draft.color) : "Use the game's automatic colour"}</span>
            </span>
            <ColorField value={draft.color || [128, 128, 128]} onChange={(color) => patch("color", color)} />
            {draft.color && <button type="button" style={pillButton(false)} onClick={() => patch("color", null)}>Reset</button>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {draft.flag ? <img src={bundledFlagUrl(draft.flag)} alt="Selected country flag"
              style={{ width: 58, height: 38, objectFit: "contain", flexShrink: 0, borderRadius: 7,
                border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.25))" }} />
              : <span style={{ ...hint, width: 58, flexShrink: 0 }}>No flag</span>}
            <span style={{ flex: 1 }}>
              <strong style={{ display: "block", fontSize: 12 }}>Starting flag</strong>
              <span style={hint}>{draft.flag ? "Flag chosen" : "No custom flag selected"}</span>
            </span>
            <button type="button" style={pillButton(true)} onClick={() => onOpenFlagPicker?.({
              name: draft.name.trim(), flag: draft.flag,
              onPick: (value) => patch("flag", value),
            })}>Choose flag</button>
            {draft.flag && <button type="button" style={pillButton(false)} onClick={() => patch("flag", null)}>Clear</button>}
          </div>
          <span style={hint}>Uploading a new flag also stores it in My flags, even if you cancel this country setup.</span>
          <NameListEditor title={`Country traits (max ${MAX_TAGS})`} items={draft.tags}
            onChange={(next) => patch("tags", next)} maxCount={MAX_TAGS}
            placeholder="e.g. democratic" suggestions={TAG_SUGGESTIONS} />
          <span style={hint}>These tags describe the country's starting character. Its government and political actors are configured in the Scenario Editor.</span>
        </section>
      )}

      {tab === "people" && (
        <section style={section} aria-label="Set people and military">
          <strong style={{ fontSize: 14 }}>Population & military</strong>
          <label style={label}>
            Starting population
            <input value={draft.population} onChange={(event) => patch("population", event.target.value)}
              inputMode="numeric" placeholder="Leave blank for scenario defaults" style={inputStyle} />
          </label>
          <span style={hint}>A whole number of people, for example 4,600,000. Empty means no country-specific population was authored.</span>
          <MilitaryFields recordKey="new-country-draft" value={draft.military}
            defaults={militaryDefaults} onChange={(value) => patch("military", value)} />
          <span style={hint}>Leave a military figure empty to inherit the scenario's normal behaviour. Zero is a deliberate value where allowed.</span>
        </section>
      )}

      {tab === "relations" && (
        <section style={section} aria-label="Set country relationships and territory">
          <strong style={{ fontSize: 14 }}>Relationships & starting territory</strong>
          <label style={label}>
            Overlord or dependency
            <select value={draft.overlord} onChange={(event) => patch("overlord", event.target.value)} style={inputStyle}>
              <option value="">Independent country</option>
              {polityChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.name}</option>)}
            </select>
          </label>
          {overlord && (
            <>
              <span style={hint}>This country will begin under {chosenOverlord?.name || overlord}.</span>
              <label style={label}>Relationship type
                <select value={draft.dependencyKind} onChange={(event) => patch("dependencyKind", event.target.value)} style={inputStyle}>
                  {PUPPET_KIND_OPTIONS.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
                </select>
              </label>
              <label style={label}>Public or secret
                <select value={draft.secrecy} onChange={(event) => patch("secrecy", event.target.value)} style={inputStyle}>
                  {PUPPET_SECRECY_OPTIONS.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
                </select>
              </label>
              <label style={label}>Starting loyalty: {draft.loyalty}/100
                <input type="range" min="0" max="100" value={draft.loyalty}
                  onChange={(event) => patch("loyalty", Number(event.target.value))} />
              </label>
            </>
          )}
          <div style={{ borderTop: "1px solid var(--oh-ui-line, rgba(255,255,255,0.12))", paddingTop: 10 }}>
            <StartingRelationsFields
              owner={draft.name.trim()}
              choices={polityChoices}
              rows={draft.startingRelations}
              onSave={(other, score) => {
                patch("startingRelations", [...draft.startingRelations.filter((row) => row.other !== other), { other, score }]);
                return { ok: true };
              }}
              onClear={(other) => {
                patch("startingRelations", draft.startingRelations.filter((row) => row.other !== other));
                return { ok: true };
              }}
            />
          </div>
          <div style={{ borderTop: "1px solid var(--oh-ui-line, rgba(255,255,255,0.12))", paddingTop: 10, display: "grid", gap: 8 }}>
            <strong style={{ fontSize: 12 }}>Starting territory</strong>
            {selectionCount ? (
              <label style={{ display: "flex", alignItems: "start", gap: 9, fontSize: 12, cursor: "pointer" }}>
                <input type="checkbox" checked={draft.assignSelectedRegions}
                  onChange={(event) => patch("assignSelectedRegions", event.target.checked)} />
                <span>Give this new country the {selectionCount.toLocaleString()} regions currently selected on the map.</span>
              </label>
            ) : <span style={hint}>No regions selected. The new country can start without land. Assign or paint its territory afterwards.</span>}
            <span style={hint}>Territory assignment may change other countries' borders and cannot always be undone with the map Undo button. It needs separate confirmation.</span>
          </div>
        </section>
      )}

      {tab === "review" && (
        <section style={section} aria-label="Review country before creation">
          <strong style={{ fontSize: 14 }}>Review before creating</strong>
          <span style={hint}>This is what will be registered. You can go back and change anything. The country and its territory have not changed yet.</span>
          <SummaryRow title="Name" value={draft.name.trim() || "Required"} />
          <SummaryRow title="Other names" value={draft.aliases.join(", ") || "None"} />
          <SummaryRow title="Former names" value={draft.formerNames.join(", ") || "None"} />
          <SummaryRow title="Scenario note" value={draft.note.trim() || "Not added"} />
          <SummaryRow title="Map colour" value={draft.color ? rgbToHex(draft.color) : "Automatic"} />
          <SummaryRow title="Starting flag" value={draft.flag ? "Chosen" : "Not set"} />
          <SummaryRow title="Tags" value={draft.tags.join(", ") || "Not added"} />
          <SummaryRow title="Population" value={formatPopulationFigure(draft.population) || "Scenario default"} />
          <SummaryRow title="Military" value={draft.military ? "Custom starting figures" : "Scenario defaults"} />
          <SummaryRow title="Diplomatic scores" value={draft.startingRelations.length
            ? draft.startingRelations.map((row) => `${polityChoices.find((c) => c.key === row.other)?.name || row.other}: ${Number(row.score) > 0 ? "+" : ""}${row.score}`).join(", ")
            : "Unset"} />
          <SummaryRow title="Dependency" value={overlord ? `${chosenOverlord?.name || overlord} (${draft.dependencyKind})` : "Independent"} />
          <SummaryRow title="Territory" value={draft.assignSelectedRegions
            ? `Assign ${selectionCount.toLocaleString()} selected regions`
            : "Start with no territory"} />
          {!plan.ok && <span role="alert" style={{ fontSize: 12, color: "#fca5a5", lineHeight: 1.4 }}>{plan.reason}</span>}
          {plan.ok && <span style={{ fontSize: 11.5, color: "var(--oh-ui-muted, rgba(255,255,255,0.74))" }}>Ready to create. Country identity and relationships have passed preflight checks.</span>}
        </section>
      )}

      {error && <div role="alert" style={{
        border: "1px solid rgba(239,68,68,.4)", padding: 10, borderRadius: 9,
        color: "#fca5a5", fontSize: 12, lineHeight: 1.45,
      }}>{error}</div>}
      <div style={{
        display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
        paddingTop: 11, borderTop: "1px solid var(--oh-ui-line, rgba(255,255,255,.13))",
      }}>
        <button type="button" style={pillButton(false)} onClick={cancel}>Cancel</button>
        <div style={{ flex: 1 }} />
        {index > 0 && <button type="button" style={pillButton(false)}
          onClick={() => { setTab(TABS[index - 1].id); setError(""); }}>Back</button>}
        {tab === "review" ? (
          <button type="button" style={pillButton(true)} onClick={create} disabled={!plan.ok}>
            Create country
          </button>
        ) : (
          <button type="button" style={pillButton(true)} onClick={() => { setTab(TABS[index + 1].id); setError(""); }}>
            Continue
          </button>
        )}
      </div>
    </Panel>
  );
}
