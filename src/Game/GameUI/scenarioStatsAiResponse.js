/*! Open Historia — bounded identity-safe interpretation of scenario Statistics AI proposals. */
import { extractJsonPayload } from "../AI/jsonSalvage.js";
import { toolResponsePayload } from "../AI/toolResponsePayload.js";

const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const has = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);

// Diagnostic only. Distinguish absent required provider arguments, wrong JSON
// types, non-finite values and out-of-range numbers. Never coerce a failure to
// zero or expose the untrusted fiscal value in a generic debug log.
export const describeScenarioFiscalScalarFailure = (payload, field, minimum, maximum) => {
  if (!has(payload, field)) return "the required tool argument was omitted";
  const value = payload[field];
  if (value === null) return "null was returned, not a number";
  if (typeof value !== "number") return `a ${Array.isArray(value) ? "JSON array" : typeof value === "object" ? "JSON object" : typeof value} was returned, not a number`;
  if (!Number.isFinite(value)) return "the number was non-finite";
  if (value < minimum || value > maximum) return "the number was outside the permitted range";
  return "";
};

// The other scenario generators use forced output tools rather than hoping
// an unconstrained text reply happens to match the requested JSON shape.
// Keep the function declaration shallow: large nested country schemas are
// less portable across providers, and the canonical native validators still
// own the authority to accept each generated figure and territorial bucket.
// Country identity is owned by the native request slot, not free-form AI
// abbreviations (CAN, NZL, FIC...). The provider's declared schema binds one
// required, separately named JSON string to each requested canonical polity.
// A generated row must not claim another country inside its assigned slot.
// Bounded shallow custom fields give the provider a native numeric contract,
// not a second set of optional keys hidden in countryNJson. For exceptionally
// large author-defined sheets, retain the existing JSON transport rather than
// exploding Gemini's function declaration. All values remain native-validated.
export const MAX_TYPED_CUSTOM_STATS = 20;
export const typedCustomStatsKeys = (keys) =>
  Array.isArray(keys) && keys.length <= MAX_TYPED_CUSTOM_STATS
    ? [...new Set(keys.filter((key) => typeof key === "string" && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key)))]
    : null;

export const buildScenarioStartingStatsTool = (expected, { customKeys = null } = {}) => {
  const targets = Array.isArray(expected) ? expected.filter((row) => clean(row?.code)) : [];
  if (targets.length < 1 || targets.length > 3) throw new Error("Statistics generation requires 1 to 3 explicitly identified countries.");
  const properties = {};
  const required = [];
  const typedKeys = typedCustomStatsKeys(customKeys);
  if (typedKeys && typedKeys.length !== customKeys.length) throw new Error("Custom Statistics keys must be unique valid native authoring keys.");
  targets.forEach((target, index) => {
    const key = `country${index + 1}Json`;
    required.push(key);
    properties[key] = {
      type: "string",
      description: `JSON object proposing Statistics ONLY for scenario polity ${target.code} (${target.name || target.code}). Do not include code, countryCode, polityCode, country, polity or name: this tool argument itself is the authoritative country identity. Include exactly its supplied regional bucket indices; no other polity. Supply fiscal numbers in the separate required numeric fields, not this JSON string.`,
    };
    if (typedKeys?.length) {
      const customField = `country${index + 1}CustomStats`;
      required.push(customField);
      properties[customField] = {
        type: "object", additionalProperties: false,
        required: typedKeys,
        properties: Object.fromEntries(typedKeys.map((key) => [key, {
          type: "number", minimum: -1e18, maximum: 1e18,
          description: `Independent author-defined custom statistic ${key} for ${target.code}. No implied native binding or substitute zero.`,
        }])),
        description: `Exactly the listed independently authored custom numeric metrics for ${target.code}; omit customStats from country${index + 1}Json.`,
      };
    }
    // These two values were routinely omitted inside opaque JSON strings.
    // Typed, required shallow tool arguments preserve provider compatibility
    // while making missing or nonnumeric values a hard validation failure.
    for (const [suffix, minimum, maximum, label] of [
      ["PublicDebt", 0, 1000, "Public debt as percent of GDP"],
      ["BudgetBalance", -1000, 1000, "Budget balance as percent of GDP per year"],
    ]) {
      const field = `country${index + 1}${suffix}`;
      required.push(field);
      properties[field] = {
        type: "number", minimum, maximum,
        description: `${label} for ${target.code} (${target.name || target.code}); a JSON number, never a string or a guessed zero.`,
      };
    }
  });
  return {
    name: "submit_scenario_starting_statistics",
    description: "Submit one separate reviewed-only Statistics proposal in each explicitly assigned canonical country slot.",
    schema: { type: "object", additionalProperties: false, required, properties },
  };
};

const responseIdentity = (row, keyedIdentity = "") => {
  // An explicit machine identifier wins over a display name. An inconsistent
  // code must not be rescued by a matching display name.
  for (const key of ["code", "countryCode", "polityCode"]) {
    if (has(row, key)) return clean(row[key]);
  }
  if (typeof row.country === "string") return clean(row.country);
  if (typeof row.polity === "string") return clean(row.polity);
  if (keyedIdentity) return clean(keyedIdentity);
  return clean(row.name);
};

const collect = (value) => {
  if (Array.isArray(value)) return value.map((row) => ({ row, keyedIdentity: "" }));
  if (!object(value)) return [];
  // Tool calls carry the bounded country array as a JSON string. Parse only
  // its actual contents; never reinterpret malformed text as another polity.
  if (has(value, "countriesJson")) {
    if (typeof value.countriesJson !== "string") return [];
    const decoded = extractJsonPayload(value.countriesJson);
    return Array.isArray(decoded) ? collect(decoded) : [];
  }
  if (Array.isArray(value.countries)) return collect(value.countries);
  if (Array.isArray(value.countryStats)) return collect(value.countryStats);
  if (object(value.countries)) return collect(value.countries);
  if (object(value.countryStats)) return collect(value.countryStats);
  if (object(value.country)) return collect(value.country);
  if (object(value.data)) return collect(value.data);
  if (object(value.result)) return collect(value.result);
  if (object(value.output)) return collect(value.output);
  if (Array.isArray(value.data)) return collect(value.data);
  if (Array.isArray(value.result)) return collect(value.result);
  if (Array.isArray(value.output)) return collect(value.output);
  if (Array.isArray(value.macro) || has(value, "code") || has(value, "countryCode") || has(value, "polityCode")) {
    return [{ row: value, keyedIdentity: "" }];
  }
  return collectKeyed(value);
};

const collectKeyed = (value) => Object.entries(value)
  .filter(([, row]) => object(row))
  .map(([keyedIdentity, row]) => ({ row, keyedIdentity }));

// Only accept a country explicitly named in a legacy result or assigned by a
// schema-enforced native country slot. Never infer identity from array position.
const identityMatches = (identity, target, resolveIdentity) => {
  if ([target.code, target.name].map(fold).includes(fold(identity))) return true;
  return identity && typeof resolveIdentity === "function"
    && fold(resolveIdentity(identity)) === fold(target.code);
};

// The provider is asked to omit country identity inside a schema-assigned slot,
// but legacy replies can include several identity fields. Checking only the
// first lets a correct code conceal an explicitly contradictory name/polity.
// Every supplied identity must resolve to the SAME assigned canonical polity.
const conflictingResponseIdentity = (row, target, resolveIdentity) => {
  if (!object(row)) return "";
  for (const field of ["code", "countryCode", "polityCode", "country", "polity", "name"]) {
    if (!has(row, field)) continue;
    const value = row[field];
    if (typeof value !== "string" || !clean(value)
      || !identityMatches(value, target, resolveIdentity)) {
      return `${clean(value) || "(blank)"} (${field})`;
    }
  }
  return "";
};

export const interpretScenarioStatsAiResponse = (response, expected, { resolveIdentity = null, customKeys = null } = {}) => {
  const parsedText = typeof response?.rawText === "string" ? extractJsonPayload(response.rawText) : null;
  const toolPayload = toolResponsePayload(response);
  const payload = (object(toolPayload) && (has(toolPayload, "rawText") || has(toolPayload, "toolInput")))
    ? parsedText ?? toolPayload
    : toolPayload ?? parsedText;
  const expectedRows = (Array.isArray(expected) ? expected : []).filter((item) => clean(item?.code));
  const slotFields = object(payload) ? Object.keys(payload).filter((key) => /^country[1-9]\d*(?:Json|CustomStats|PublicDebt|BudgetBalance)$/.test(key)) : [];
  if (slotFields.length) {
    const results = {};
    const typedKeys = typedCustomStatsKeys(customKeys);
    const recognized = expectedRows.flatMap((_, index) => [
      `country${index + 1}Json`, `country${index + 1}PublicDebt`, `country${index + 1}BudgetBalance`,
      ...(typedKeys?.length ? [`country${index + 1}CustomStats`] : []),
    ]);
    const unexpected = slotFields.filter((field) => !recognized.includes(field));
    for (const [index, target] of expectedRows.entries()) {
      const key = `country${index + 1}Json`;
      const value = payload[key];
      const parsed = typeof value === "string" ? extractJsonPayload(value) : null;
      const conflictingIdentity = conflictingResponseIdentity(parsed, target, resolveIdentity);
      const fiscalFields = [
        [`country${index + 1}PublicDebt`, "publicDebt", 0, 1000],
        [`country${index + 1}BudgetBalance`, "budgetBalance", -1000, 1000],
      ];
      let error = unexpected.length
        ? `AI returned unrequested country slot(s): ${unexpected.join(", ")}. No values were saved.`
        : !object(parsed)
          ? `AI did not return a JSON country object in ${key} for ${target.name || target.code}. No values were saved.`
          : conflictingIdentity
            ? `AI supplied conflicting country identity ${conflictingIdentity} in ${key} for ${target.name || target.code}. No values were saved.`
            : "";
      if (!error) for (const [field, name, minimum, maximum] of fiscalFields) {
        const reading = payload[field];
        if (typeof reading !== "number" || !Number.isFinite(reading) || reading < minimum || reading > maximum) {
          error = `AI did not return a valid numeric ${name} in ${field} for ${target.name || target.code} (${minimum} to ${maximum}): ${describeScenarioFiscalScalarFailure(payload, field, minimum, maximum)}. No values were saved.`;
          break;
        }
        if (has(parsed, name) && parsed[name] !== reading) {
          error = `AI supplied conflicting ${name} values in ${key} and ${field} for ${target.name || target.code}. No values were saved.`;
          break;
        }
      }
      let custom = null;
      if (!error && typedKeys?.length) {
        const field = `country${index + 1}CustomStats`;
        const supplied = payload[field];
        if (!object(supplied)) {
          error = `AI did not provide required typed custom Statistics object ${field} for ${target.code}. No values were saved.`;
        } else if (Object.keys(supplied).some((key) => !typedKeys.includes(key))) {
          error = `AI supplied unrequested custom Statistics key(s) for ${target.code}. No values were saved.`;
        } else if (has(parsed, "customStats")) {
          error = `AI duplicated independently sourced customStats values inside ${key} for ${target.code}. No values were saved.`;
        } else {
          for (const customKey of typedKeys) {
            const value = supplied[customKey];
            if (typeof value !== "number" || !Number.isFinite(value) || value < -1e18 || value > 1e18) {
              error = `AI did not provide a valid typed custom statistic ${customKey} in ${field} for ${target.code}: ${describeScenarioFiscalScalarFailure(supplied, customKey, -1e18, 1e18)}. No values were saved.`;
              break;
            }
          }
          if (!error) custom = { ...supplied };
        }
      }
      // Slot provenance, not arbitrary AI names, determines canonical identity.
      // Mandatory typed fiscal fields are incorporated only after all guards.
      results[target.code] = {
        row: error ? null : {
          ...parsed, code: target.code,
          ...(typedKeys?.length ? { customStats: custom } : {}),
          publicDebt: payload[fiscalFields[0][0]], budgetBalance: payload[fiscalFields[1][0]],
        }, error,
      };
    }
    return results;
  }

  const rows = collect(payload).filter(({ row }) => object(row));
  const results = {};
  for (const target of expectedRows) {
    const matches = rows.filter(({ row, keyedIdentity }) => {
      const identity = responseIdentity(row, keyedIdentity);
      // Legacy countriesJson / text results are still strictly ID-matched.
      return identityMatches(identity, target, resolveIdentity);
    });
    if (matches.length === 1) {
      const conflict = conflictingResponseIdentity(matches[0].row, target, resolveIdentity);
      results[target.code] = conflict
        ? { row: null, error: `AI supplied conflicting country identity ${conflict} for ${target.name || target.code}. No values were saved.` }
        : { row: matches[0].row, error: "" };
      continue;
    }
    if (matches.length > 1) {
      results[target.code] = { row: null, error: `AI supplied duplicate entries for ${target.name || target.code}; nothing was saved.` };
      continue;
    }
    const identities = [...new Set(rows.map(({ row, keyedIdentity }) => responseIdentity(row, keyedIdentity) || "(unlabelled)"))];
    const found = identities.slice(0, 4).join(", ") + (identities.length > 4 ? ", …" : "");
    const formatHint = has(payload, "countriesJson")
      ? "The declared countriesJson tool field did not contain a JSON array."
      : object(payload)
        ? `No country array in the provider response (fields: ${Object.keys(payload).slice(0, 5).join(", ") || "none"}).`
        : "The provider did not return a parseable structured country array.";
    results[target.code] = { row: null, error: rows.length
      ? `AI returned ${rows.length} country record(s), but none identified ${target.name || target.code}. Received: ${found}. No values were saved.`
      : `AI returned no usable country records for ${target.name || target.code}. ${formatHint} No values were saved.` };
  }
  return results;
};
