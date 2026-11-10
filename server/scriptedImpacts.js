/*! Open Historia — the impacts a scenario author attaches to a scripted event © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Shared by the stores (normalizeScriptedEvents), the editor and the time skip,
// so it lives under server/ and imports nothing (server/serverImports.test.js).
//
// An event keeps the rows its author edits (`impactRows`) and the impacts they
// compile to (`impacts`), in the shape a time skip's own events carry them
// (gameplaySchemas.js impactsSchema). The engine reads `impacts` only.

const text = (value, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const array = (value) => (Array.isArray(value) ? value : []);
const record = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

export const SCRIPTED_IMPACT_LIMIT = 40;
export const SCRIPTED_IMPACT_REGION_LIMIT = 600;

// Each kind of row: the fields it shows and which of them must be filled.
export const SCRIPTED_IMPACT_TYPES = [
  { type: "transfer", label: "Regions change hands", fields: ["regions", "to", "from"], required: ["regions", "to"] },
  { type: "independence", label: "A new country gains regions", fields: ["name", "regions", "from", "color"], required: ["name", "regions"] },
  { type: "control", label: "Regions are occupied", fields: ["regions", "to", "from"], required: ["regions", "to"] },
  { type: "contest", label: "Regions become contested", fields: ["regions", "actor", "from"], required: ["regions", "actor"] },
  { type: "clear_contest", label: "Fighting over regions ends", fields: ["regions", "claimant"], required: ["regions"] },
  { type: "claim", label: "A country claims regions", fields: ["regions", "claimant"], required: ["regions", "claimant"] },
  { type: "drop_claim", label: "A country drops its claim", fields: ["regions", "claimant"], required: ["regions", "claimant"] },
  { type: "clear_country_claims", label: "Remove all claims on a country's territory", fields: ["polity", "claimant"], required: ["polity"] },
  { type: "annex", label: "A country is annexed", fields: ["polity", "to"], required: ["polity", "to"] },
  { type: "dissolve", label: "A country is dissolved", fields: ["polity", "to"], required: ["polity"] },
  { type: "create", label: "A new country is founded", fields: ["name", "color"], required: ["name"] },
  { type: "rename", label: "A country is renamed", fields: ["polity", "name"], required: ["polity", "name"] },
  { type: "leader", label: "New leader or government", fields: ["polity", "leader", "government"], required: ["polity"] },
];

const TYPE_BY_KEY = Object.fromEntries(SCRIPTED_IMPACT_TYPES.map((entry) => [entry.type, entry]));
export const scriptedImpactType = (type) => TYPE_BY_KEY[text(type)] || null;

const regionList = (value) => {
  const seen = new Set();
  const out = [];
  for (const entry of array(value)) {
    const id = text(typeof entry === "string" ? entry : entry?.id, 160);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: text(typeof entry === "string" ? "" : entry?.name, 160) || id });
    if (out.length >= SCRIPTED_IMPACT_REGION_LIMIT) break;
  }
  return out;
};

const hexColor = (value) => (/^#[0-9a-f]{6}$/i.test(text(value)) ? text(value).toLowerCase() : "");

export const normalizeImpactRow = (input) => {
  const source = record(input);
  const definition = scriptedImpactType(source.type);
  if (!definition) return null;
  const row = { type: definition.type };
  for (const field of definition.fields) {
    if (field === "regions") row.regions = regionList(source.regions);
    else if (field === "color") { const color = hexColor(source.color); if (color) row.color = color; }
    else row[field] = text(source[field], 160);
  }
  return row;
};

export const normalizeImpactRows = (value) => array(value)
  .map(normalizeImpactRow)
  .filter(Boolean)
  .slice(0, SCRIPTED_IMPACT_LIMIT);

// "Remove all claims on a country's territory" as one regionClaims entry, in
// the engine's own shape: one claimant's claims and disputes on that country's
// land, or with allClaimants every claimant's (claimantCode then names the
// country itself, so the field still holds a real name).
export const clearCountryClaimsEntry = ({ country, claimant = "" } = {}) => {
  const name = text(country, 160);
  if (!name) return null;
  const who = text(claimant, 160);
  return who
    ? { regionId: `country: ${name}`, claimantCode: who, drop: true }
    : { regionId: `country: ${name}`, claimantCode: name, drop: true, allClaimants: true };
};

const regionRefs = (row) => array(row.regions).map((region) => ({ regionId: region.id, regionName: region.name }));
const wholeCountry = (polity) => ({ regionId: `country: ${polity}`, regionName: polity, fromCode: polity, wholeCountry: true });

const EMPTY_IMPACTS = () => ({ regionTransfers: [], regionControlOps: [], regionClaims: [], polityChanges: [] });

// A row that is missing what it needs compiles to nothing.
export const compileImpactRows = (rowsInput) => {
  const out = EMPTY_IMPACTS();
  for (const row of normalizeImpactRows(rowsInput)) {
    if (impactRowProblems(row).length) continue;
    const from = row.from ? { fromCode: row.from } : {};
    switch (row.type) {
    case "transfer":
      for (const ref of regionRefs(row)) out.regionTransfers.push({ ...ref, ...from, toCode: row.to });
      break;
    case "independence":
      out.polityChanges.push({ operation: "create", code: row.name, ...(row.color ? { color: row.color } : {}) });
      for (const ref of regionRefs(row)) out.regionTransfers.push({ ...ref, ...from, toCode: row.name });
      break;
    case "control":
      for (const ref of regionRefs(row)) out.regionControlOps.push({ op: "control", ...ref, ...from, toCode: row.to });
      break;
    case "contest":
      for (const ref of regionRefs(row)) out.regionControlOps.push({ op: "contest", ...ref, ...from, actorCode: row.actor });
      break;
    case "clear_contest":
      for (const ref of regionRefs(row)) out.regionControlOps.push({ op: "clear_contest", ...ref, ...(row.claimant ? { claimantCode: row.claimant } : { clearAll: true }) });
      break;
    case "claim":
      for (const ref of regionRefs(row)) out.regionClaims.push({ ...ref, claimantCode: row.claimant });
      break;
    case "drop_claim":
      for (const ref of regionRefs(row)) out.regionClaims.push({ ...ref, claimantCode: row.claimant, drop: true });
      break;
    case "clear_country_claims": {
      const entry = clearCountryClaimsEntry({ country: row.polity, claimant: row.claimant });
      if (entry) out.regionClaims.push(entry);
      break;
    }
    case "annex":
      out.regionTransfers.push({ ...wholeCountry(row.polity), toCode: row.to });
      out.polityChanges.push({ operation: "dissolve", code: row.polity });
      break;
    case "dissolve":
      if (row.to) out.regionTransfers.push({ ...wholeCountry(row.polity), toCode: row.to });
      out.polityChanges.push({ operation: "dissolve", code: row.polity });
      break;
    case "create":
      out.polityChanges.push({ operation: "create", code: row.name, ...(row.color ? { color: row.color } : {}) });
      break;
    case "rename":
      out.polityChanges.push({ operation: "rename", code: row.polity, name: row.name });
      break;
    case "leader": {
      const stats = {};
      if (row.leader) stats.leader = row.leader;
      if (row.government) stats.government = row.government;
      out.polityChanges.push({ operation: "update", code: row.polity, stats });
      break;
    }
    default:
      break;
    }
  }
  return out;
};

// What a row still needs, as field names; [] when it is complete.
export const impactRowProblems = (rowInput) => {
  const row = record(rowInput);
  const definition = scriptedImpactType(row.type);
  if (!definition) return ["type"];
  const missing = definition.required.filter((field) => (field === "regions" ? !array(row.regions).length : !text(row[field])));
  if (row.type === "leader" && !text(row.leader) && !text(row.government)) missing.push("leader");
  if (row.type === "annex" && text(row.polity) && text(row.polity) === text(row.to)) missing.push("to");
  return missing;
};

// The kinds of row that would fight over one region if both named it.
const REGION_FAMILY = {
  transfer: "sovereignty",
  independence: "sovereignty",
  control: "control",
  contest: "control",
  clear_contest: "control",
  claim: "claims",
  drop_claim: "claims",
};

// Every row's problems: what it is missing, and each region another row of the
// same kind already names.
export const scriptedImpactProblems = (rowsInput) => {
  const rows = array(rowsInput);
  const firstSeen = new Map();
  return rows.map((row, index) => {
    const missing = impactRowProblems(row);
    const family = REGION_FAMILY[text(row?.type)];
    const repeated = [];
    if (family) {
      for (const region of array(row?.regions)) {
        const key = `${family}|${text(region?.id)}`;
        if (firstSeen.has(key) && firstSeen.get(key) !== index) repeated.push(text(region?.name) || text(region?.id));
        else firstSeen.set(key, index);
      }
    }
    return { missing, repeated };
  });
};

const pickFields = (entry, fields) => {
  const out = {};
  for (const field of fields) {
    const value = entry[field];
    if (typeof value === "boolean") { if (value) out[field] = true; }
    else if (Array.isArray(value)) { const list = value.map((item) => text(item, 160)).filter(Boolean); if (list.length) out[field] = list; }
    else if (value && typeof value === "object") out[field] = value;
    else if (text(value, 400)) out[field] = text(value, 400);
  }
  return out;
};

const FAMILY_FIELDS = {
  regionTransfers: { fields: ["regionId", "regionName", "fromCode", "toCode", "note", "basis", "wholeCountry"], needs: ["regionId", "toCode"] },
  regionControlOps: { fields: ["op", "regionId", "regionName", "fromCode", "toCode", "actorCode", "claimantCode", "clearAll", "note", "basis", "wholeCountry"], needs: ["op", "regionId"] },
  regionClaims: { fields: ["regionId", "regionName", "claimantCode", "drop", "allClaimants", "note"], needs: ["regionId"] },
  polityChanges: { fields: ["operation", "code", "name", "color", "aliases", "note", "stats"], needs: ["operation", "code"] },
};

// An event's attached impacts, in the time skip's own shape: the four families
// an author can write, each entry with only its own fields.
export const normalizeScriptedImpacts = (value) => {
  const source = record(value);
  const out = {};
  for (const [family, { fields, needs }] of Object.entries(FAMILY_FIELDS)) {
    const entries = array(source[family])
      .map((entry) => pickFields(record(entry), fields))
      .filter((entry) => needs.every((field) => entry[field] !== undefined))
      .slice(0, SCRIPTED_IMPACT_REGION_LIMIT);
    if (entries.length) out[family] = entries;
  }
  return out;
};

export const hasScriptedImpacts = (value) => Object.keys(normalizeScriptedImpacts(value)).length > 0;

// What the stores keep on an event or an outcome: the rows when there are
// any, and the impacts they compile to (or impacts written by hand).
export const scriptedImpactFields = (entry) => {
  const source = record(entry);
  const rows = normalizeImpactRows(source.impactRows);
  const impacts = normalizeScriptedImpacts(rows.length ? compileImpactRows(rows) : source.impacts);
  return {
    ...(rows.length ? { impactRows: rows } : {}),
    ...(Object.keys(impacts).length ? { impacts } : {}),
  };
};
