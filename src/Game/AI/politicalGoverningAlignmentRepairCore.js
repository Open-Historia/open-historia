/*! Open Historia — narrow governing-party / coalition alignment repair (Phase006D.1) */

import {
  POLITICAL_GENERATION_CONFIDENCE,
  POLITICAL_WORLD_GENERATION_SCHEMA_VERSION,
  validatePoliticalGenerationProposal,
} from "../../runtime/politicalWorldGeneration.js";

export const POLITICAL_GOVERNING_ALIGNMENT_BATCH_SIZE = 48;
export const POLITICAL_GOVERNING_ALIGNMENT_MAX_ATTEMPTS = 2;
export const POLITICAL_GOVERNING_ALIGNMENT_NEED = "governing_alignment";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const truncate = (value, maxChars) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 80))}\n...[bounded context truncated]`;
};


const historyAuthorityPromptBlock = (historyAuthority, scenarioDate) => {
  const target = clean(scenarioDate);
  const cutoff = clean(historyAuthority?.cutoffDate);
  if (!historyAuthority || typeof historyAuthority !== "object") {
    return `TARGET START-WORLD DATE: ${target}. External/reference canon may be used only through that target date; supplied scenario canon outranks conflicts.`;
  }
  if (historyAuthority.referenceAllowed && cutoff) {
    if (historyAuthority.cutoffInclusive) {
      return `TARGET START-WORLD DATE: ${target}. EXTERNAL/REFERENCE AUTHORITY: admissible only THROUGH ${cutoff}. Scenario-authored/derived canon and explicit current world state outrank conflicting reference material.`;
    }
    return `TARGET START-WORLD DATE: ${target}. EXTERNAL/REFERENCE AUTHORITY: admissible only BEFORE ${cutoff}; ${cutoff} itself and everything after it belong to scenario/derived canon. Do not choose governing parties from remembered post-boundary reference chronology.`;
  }
  return `TARGET START-WORLD DATE: ${target}. EXTERNAL/REFERENCE AUTHORITY: NONE. Resolve governing alignment only from supplied scenario canon and current Political Actor state.`;
};

const generatedAtValue = (generatedAt) => {
  const value = typeof generatedAt === "function" ? generatedAt() : generatedAt;
  return clean(value) || new Date().toISOString();
};

const parseResponseObject = (response) => {
  if (isPlainObject(response?.toolInput)) return response.toolInput;
  if (isPlainObject(response) && Array.isArray(response.alignments)) return response;
  const raw = typeof response === "string" ? response : String(response?.rawText ?? "");
  if (!raw) return null;
  const unfenced = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const first = unfenced.indexOf("{");
    const last = unfenced.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    try {
      return JSON.parse(unfenced.slice(first, last + 1));
    } catch {
      return null;
    }
  }
};

const normalizedTransportKey = (value) => clean(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const buildRequestedResolver = (items) => {
  const exact = new Set();
  const normalized = new Map();
  const entries = [];
  for (const item of items) {
    const key = clean(item?.polityKey);
    if (!key) continue;
    exact.add(key);
    const token = normalizedTransportKey(key);
    entries.push({ key, token });
    if (!normalized.has(token)) normalized.set(token, new Set());
    normalized.get(token).add(key);
  }
  return (value) => {
    const raw = clean(value);
    if (exact.has(raw)) return raw;
    const token = normalizedTransportKey(raw);
    const matches = normalized.get(token);
    if (matches?.size === 1) return [...matches][0];
    if (!token) return "";

    // Providers occasionally shorten a canonical polity label on a retry
    // (for example "State of Israel" -> "israel"). Accept that transport
    // drift only when it identifies exactly one currently-requested polity.
    // Ambiguous short forms such as "congo" remain unresolved.
    const fuzzy = entries.filter(({ token: candidate }) => candidate && (
      candidate === token
      || candidate.endsWith(` ${token}`)
      || candidate.startsWith(`${token} `)
      || token.endsWith(` ${candidate}`)
      || token.startsWith(`${candidate} `)
    ));
    return fuzzy.length === 1 ? fuzzy[0].key : "";
  };
};

const chunk = (items, size) => {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
};

const partyRows = (actor) => (Array.isArray(actor?.parties) ? actor.parties : [])
  .filter((party) => clean(party?.id) && clean(party?.name || party?.shortName || party?.id));

const validPartyIds = (actor) => new Set(partyRows(actor).map((party) => clean(party.id)));

const validGovernmentRefs = (actor) => {
  const ids = validPartyIds(actor);
  const government = isPlainObject(actor?.government) ? actor.government : {};
  const rulingPartyIds = (Array.isArray(government.rulingPartyIds) ? government.rulingPartyIds : [])
    .map(clean)
    .filter((id) => ids.has(id));
  const coalitionPartyIds = (Array.isArray(government.coalitionPartyIds) ? government.coalitionPartyIds : [])
    .map(clean)
    .filter((id) => ids.has(id));
  return { rulingPartyIds, coalitionPartyIds };
};

const repairableRepresentation = (actor) => {
  const representation = clean(actor?.politicalSystem?.representation).toLocaleLowerCase();
  return representation === "electoral" || representation === "party_state";
};

const candidateForRepair = (polityKey, actor, depth = "standard") => {
  if (!isPlainObject(actor) || !repairableRepresentation(actor)) return null;
  const parties = partyRows(actor);
  if (!parties.length) return null;
  const refs = validGovernmentRefs(actor);
  if (refs.rulingPartyIds.length) return null;
  return {
    polityKey,
    depth: clean(depth).toLocaleLowerCase() || "standard",
    needs: [POLITICAL_GOVERNING_ALIGNMENT_NEED],
    hasExistingActor: true,
  };
};

const compactOfficeholder = (value) => clean(isPlainObject(value) ? value.name : value);

const repairPromptBlock = (item, politicalActors, contextByPolity) => {
  const actor = politicalActors?.byPolity?.[item.polityKey] ?? {};
  const government = isPlainObject(actor?.government) ? actor.government : {};
  const representation = clean(actor?.politicalSystem?.representation).toLocaleLowerCase() || "unknown";
  const parties = partyRows(actor).map((party) => {
    const details = [
      clean(party.id),
      clean(party.name || party.shortName || party.id),
      clean(party.ideology),
      compactOfficeholder(party.leader) ? `leader=${compactOfficeholder(party.leader)}` : "",
      Number.isFinite(Number(party?.support?.percent)) ? `support=${Number(party.support.percent)}%` : "",
    ].filter(Boolean);
    return `- ${details.join(" | ")}`;
  });
  const governmentBits = [
    clean(government.form),
    compactOfficeholder(government.headOfState) ? `HoS=${compactOfficeholder(government.headOfState)}` : "",
    compactOfficeholder(government.headOfGovernment) ? `HoG=${compactOfficeholder(government.headOfGovernment)}` : "",
    clean(government.coalitionName) ? `coalitionName=${clean(government.coalitionName)}` : "",
  ].filter(Boolean);
  const localContext = contextByPolity?.[item.polityKey];
  return [
    `POLITY: ${item.polityKey}`,
    `REPRESENTATION: ${representation}`,
    `GOVERNMENT: ${governmentBits.join(" | ") || "(no compact government metadata)"}`,
    "EXISTING PARTY ROSTER — return ONLY these stable ids:",
    ...parties,
    ...(localContext ? [`SCENARIO-SPECIFIC CONTEXT: ${truncate(localContext, 700)}`] : []),
  ].join("\n");
};

export const POLITICAL_GOVERNING_ALIGNMENT_TOOL = Object.freeze({
  name: "submit_political_governing_alignment_repair",
  description: "Resolve only which already-existing party ids lead or formally participate in the current government. Never add or rewrite political identity.",
  schema: Object.freeze({
    type: "object",
    properties: {
      alignments: {
        type: "array",
        maxItems: POLITICAL_GOVERNING_ALIGNMENT_BATCH_SIZE,
        items: {
          type: "object",
          properties: {
            polityKey: { type: "string" },
            confidence: { type: "string", enum: ["low", "moderate", "high", "unknown"] },
            alignmentJson: {
              type: "string",
              description: "JSON object text with rulingPartyIds and coalitionPartyIds using ONLY supplied stable ids, or {\"nonPartisan\":true} when no supplied party formally leads the government.",
            },
          },
          required: ["polityKey", "confidence", "alignmentJson"],
          additionalProperties: false,
        },
      },
    },
    required: ["alignments"],
    additionalProperties: false,
  }),
});

export const buildPoliticalGoverningAlignmentRepairPrompt = ({
  scenarioDate,
  historyAuthority = null,
  items = [],
  politicalActors = null,
  scenarioContext = "",
  contextByPolity = {},
} = {}) => ({
  systemPrompt: `You perform ONLY a governing-party / coalition alignment repair for already-existing Political Actors.\n\n`
    + `${historyAuthorityPromptBlock(historyAuthority, scenarioDate)}\n`
    + `Do NOT generate or correct leaders, officeholders, party identities, ideology, support, goals, traits, government form, political system, or any other Political Actor field.\n`
    + `Use ONLY stable party ids supplied in each polity roster. Never add, rename, remove, merge, or replace a party.\n`
    + `Return the party that actually LEADS the executive/government in rulingPartyIds. For a formal coalition, put the other governing coalition members in coalitionPartyIds. Do not duplicate an id between the two arrays.\n`
    + `For presidential systems, use the incumbent president/executive's party when that party is in the supplied roster. For parliamentary systems, use the prime minister/chancellor's leading party and formal coalition partners. For party states, use the ruling state party.\n`
    + `If the government is genuinely non-partisan, technocratic, military, personalist, or led by an independent and none of the supplied parties formally leads it, return {"nonPartisan":true}. Do NOT force a party merely because it is pro-government.\n`
    + `TOOL TRANSPORT: alignmentJson must be a JSON STRING. Normal example: {"rulingPartyIds":["cdu-csu"],"coalitionPartyIds":["spd"]}. Non-partisan example: {"nonPartisan":true}. No markdown fences or prose inside alignmentJson.`,
  userMessage: [
    `SCENARIO DATE: ${scenarioDate}`,
    "",
    "GLOBAL SCENARIO CANON / BACKSTORY (authoritative when supplied):",
    scenarioContext ? truncate(scenarioContext, 4000) : "(none supplied)",
    "",
    "GOVERNING ALIGNMENTS TO REPAIR:",
    ...items.map((item, index) => `\n=== ${index + 1} ===\n${repairPromptBlock(item, politicalActors, contextByPolity)}`),
  ].join("\n"),
});

const parseAlignmentJson = (value) => {
  const text = clean(value);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const uniqueStrings = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const id = clean(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

const validateAlignment = (actor, parsed) => {
  if (!isPlainObject(parsed)) return { ok: false, error: "alignmentJson is not a JSON object" };
  if (parsed.nonPartisan === true) return { ok: true, nonPartisan: true, rulingPartyIds: [], coalitionPartyIds: [] };
  const known = validPartyIds(actor);
  const rulingPartyIds = uniqueStrings(parsed.rulingPartyIds);
  const coalitionPartyIds = uniqueStrings(parsed.coalitionPartyIds);
  if (!rulingPartyIds.length) return { ok: false, error: "alignmentJson did not identify a ruling party or explicitly mark the government non-partisan" };
  for (const id of [...rulingPartyIds, ...coalitionPartyIds]) {
    if (!known.has(id)) return { ok: false, error: `alignmentJson references unknown party id ${id}` };
  }
  const ruling = new Set(rulingPartyIds);
  if (coalitionPartyIds.some((id) => ruling.has(id))) return { ok: false, error: "alignmentJson duplicated a party between rulingPartyIds and coalitionPartyIds" };
  return { ok: true, nonPartisan: false, rulingPartyIds, coalitionPartyIds };
};

const makeProposalEntry = ({ item, actor, scenarioDate, generatedAt, confidence, alignment }) => {
  const government = { rulingPartyIds: alignment.rulingPartyIds };
  if (alignment.coalitionPartyIds.length) government.coalitionPartyIds = alignment.coalitionPartyIds;
  const proposal = {
    schemaVersion: POLITICAL_WORLD_GENERATION_SCHEMA_VERSION,
    polityKey: item.polityKey,
    scenarioDate,
    depth: item.depth,
    provenance: {
      source: "generated",
      confidence,
      generatedAt,
    },
    actorPatch: { government },
  };
  const validation = validatePoliticalGenerationProposal(proposal, {
    polityKey: item.polityKey,
    scenarioDate,
    depth: item.depth,
    existingActor: actor,
    allowEntityExpansion: false,
    fillEmptyGovernmentPartyRefs: true,
  });
  return validation.ok ? { item, proposal, validation } : { item, proposal, validation: null, errors: validation.errors ?? [] };
};

const nativePartyStateRepair = (item, actor, scenarioDate, generatedAt) => {
  const representation = clean(actor?.politicalSystem?.representation).toLocaleLowerCase();
  const parties = partyRows(actor);
  if (representation !== "party_state" || parties.length !== 1) return null;
  return makeProposalEntry({
    item,
    actor,
    scenarioDate,
    generatedAt,
    confidence: POLITICAL_GENERATION_CONFIDENCE.HIGH,
    alignment: { rulingPartyIds: [clean(parties[0].id)], coalitionPartyIds: [] },
  });
};

export const generatePoliticalGoverningAlignmentRepairCore = async ({
  scenarioDate,
  historyAuthority = null,
  polities = [],
  politicalActors = null,
  relevanceByPolity = {},
  scenarioContext = "",
  contextByPolity = {},
  maxAttempts = POLITICAL_GOVERNING_ALIGNMENT_MAX_ATTEMPTS,
  callModel,
  generatedAt = () => new Date().toISOString(),
  signal,
  onBatch,
} = {}) => {
  if (typeof callModel !== "function") throw new Error("Governing alignment repair requires a callModel function");
  const date = clean(scenarioDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Governing alignment repair requires the canonical scenario date");
  const actors = politicalActors?.byPolity ?? {};
  const polityKeys = (Array.isArray(polities) ? polities : [])
    .map((entry) => clean(typeof entry === "string" ? entry : entry?.polityKey))
    .filter(Boolean);
  const timestamp = generatedAtValue(generatedAt);
  const allItems = polityKeys
    .map((polityKey) => candidateForRepair(polityKey, actors[polityKey], relevanceByPolity?.[polityKey]?.depth))
    .filter(Boolean);

  const proposals = [];
  const failures = [];
  const warnings = [];
  const batches = [];
  const diagnostics = [];
  const nativeResolved = [];
  const nonPartisan = [];
  const modelItems = [];

  for (const item of allItems) {
    const native = nativePartyStateRepair(item, actors[item.polityKey], date, timestamp);
    if (native?.validation) {
      proposals.push(native);
      nativeResolved.push(item.polityKey);
    } else {
      modelItems.push(item);
    }
  }

  const modelBatches = chunk(modelItems, POLITICAL_GOVERNING_ALIGNMENT_BATCH_SIZE);
  const attemptsLimit = Math.max(1, Math.min(POLITICAL_GOVERNING_ALIGNMENT_MAX_ATTEMPTS, Math.trunc(Number(maxAttempts)) || 1));
  let modelCalls = 0;
  let modelResolved = 0;

  for (const [batchIndex, batch] of modelBatches.entries()) {
    let unresolved = [...batch];
    const acceptedKeys = new Set();
    const skippedKeys = new Set();
    let attempt = 0;
    const batchDiagnostics = [];

    while (unresolved.length && attempt < attemptsLimit) {
      if (signal?.aborted) throw signal.reason || new DOMException("Governing alignment repair cancelled.", "AbortError");
      attempt += 1;
      const { systemPrompt, userMessage } = buildPoliticalGoverningAlignmentRepairPrompt({
        scenarioDate: date,
        historyAuthority,
        items: unresolved,
        politicalActors,
        scenarioContext,
        contextByPolity,
      });
      const response = await callModel(systemPrompt, [{ role: "user", parts: [{ text: userMessage }] }], {
        signal,
        reasoningEnabled: false,
        taskKey: "politicalWorldGeneration",
        logLabel: "political governing alignment repair",
        tool: POLITICAL_GOVERNING_ALIGNMENT_TOOL,
      });
      modelCalls += 1;
      const payload = parseResponseObject(response);
      const resolver = buildRequestedResolver(unresolved);
      const rows = new Map();
      const duplicates = new Set();
      if (Array.isArray(payload?.alignments)) {
        for (const row of payload.alignments) {
          const key = resolver(row?.polityKey);
          if (!key) continue;
          if (rows.has(key)) duplicates.add(key);
          else rows.set(key, row);
        }
      }

      const nextUnresolved = [];
      const polityDiagnostics = [];
      for (const item of unresolved) {
        const actor = actors[item.polityKey];
        const row = duplicates.has(item.polityKey) ? null : rows.get(item.polityKey);
        const parsed = row ? parseAlignmentJson(row.alignmentJson) : null;
        const alignment = validateAlignment(actor, parsed);
        if (alignment.ok && alignment.nonPartisan) {
          skippedKeys.add(item.polityKey);
          nonPartisan.push(item.polityKey);
          polityDiagnostics.push({ polityKey: item.polityKey, status: "non-partisan", errors: [] });
          continue;
        }
        if (alignment.ok) {
          const entry = makeProposalEntry({
            item,
            actor,
            scenarioDate: date,
            generatedAt: timestamp,
            confidence: Object.values(POLITICAL_GENERATION_CONFIDENCE).includes(clean(row?.confidence).toLocaleLowerCase())
              ? clean(row.confidence).toLocaleLowerCase()
              : POLITICAL_GENERATION_CONFIDENCE.UNKNOWN,
            alignment,
          });
          if (entry.validation?.appliedPaths?.length) {
            proposals.push(entry);
            acceptedKeys.add(item.polityKey);
            modelResolved += 1;
            polityDiagnostics.push({ polityKey: item.polityKey, status: "accepted", errors: [] });
            continue;
          }
          alignment.ok = false;
          alignment.error = entry.errors?.join("; ") || "validated repair did not fill missing governing references";
        }
        nextUnresolved.push(item);
        polityDiagnostics.push({
          polityKey: item.polityKey,
          status: "failed",
          errors: [alignment.error || (row ? "alignmentJson was malformed" : "AI omitted this requested polity")],
        });
      }

      batchDiagnostics.push({
        attempt,
        requested: unresolved.map((item) => item.polityKey),
        providerResponse: typeof response === "string" ? truncate(response, 30000) : clone(response?.toolInput ?? response?.rawText ?? response ?? null),
        parsedPayload: Array.isArray(payload?.alignments) ? clone(payload) : null,
        polities: polityDiagnostics,
      });
      unresolved = nextUnresolved;

      if (typeof onBatch === "function") {
        const resolvedBefore = nativeResolved.length
          + modelBatches.slice(0, batchIndex).reduce((sum, current) => sum + current.length, 0);
        const finalAttempt = attempt >= attemptsLimit;
        onBatch({
          phase: "generation",
          generationMode: "governing-alignment-fast",
          batchIndex,
          totalBatches: modelBatches.length,
          attempt,
          maxAttempts: attemptsLimit,
          accepted: [...acceptedKeys],
          unresolved: unresolved.map((item) => item.polityKey),
          resolvedPolities: Math.min(allItems.length, resolvedBefore + acceptedKeys.size + skippedKeys.size + (finalAttempt ? unresolved.length : 0)),
          totalPolities: allItems.length,
          acceptedTotal: proposals.length,
          failedTotal: failures.length + (finalAttempt ? unresolved.length : 0),
          sampleError: unresolved.length ? { polityKey: unresolved[0].polityKey, errors: [polityDiagnostics.find((entry) => entry.polityKey === unresolved[0].polityKey)?.errors?.[0] || "unresolved governing alignment"] } : null,
        });
      }
    }

    for (const item of unresolved) {
      failures.push({
        polityKey: item.polityKey,
        depth: item.depth,
        needs: [...item.needs],
        errors: ["Governing alignment repair could not resolve a valid existing ruling-party reference after the bounded retry budget"],
      });
    }
    batches.push({
      phase: "governing-alignment-fast",
      batchIndex,
      requested: batch.map((item) => item.polityKey),
      attempts: attempt,
      accepted: batch.filter((item) => acceptedKeys.has(item.polityKey)).map((item) => item.polityKey),
      nonPartisan: batch.filter((item) => skippedKeys.has(item.polityKey)).map((item) => item.polityKey),
      failed: unresolved.map((item) => item.polityKey),
    });
    diagnostics.push({ phase: "governing-alignment-fast", batchIndex, attempts: batchDiagnostics });
  }

  if (nonPartisan.length) warnings.push(`Governing alignment repair left ${nonPartisan.length} polity/polities without a party-government badge because the supplied roster does not formally lead the government`);

  return {
    schemaVersion: 1,
    scenarioDate: date,
    generatedAt: timestamp,
    plan: { scenarioDate: date, items: allItems },
    proposals,
    failures,
    warnings,
    batches,
    diagnostics,
    historicalVerification: {
      enabled: false,
      skippedReason: "governing-alignment repair is a separate bounded pass and never invokes the temporal verifier",
      requested: 0,
      confirmed: 0,
      corrected: 0,
      failed: 0,
      batches: [],
      diagnostics: [],
    },
    governingAlignmentRepair: {
      requested: allItems.length,
      nativeResolved: nativeResolved.length,
      modelRequested: modelItems.length,
      modelResolved,
      nonPartisan: [...nonPartisan],
      batchSize: POLITICAL_GOVERNING_ALIGNMENT_BATCH_SIZE,
      batches: modelBatches.length,
      modelCalls,
    },
    generatedPolities: proposals.length,
    failedPolities: failures.length,
  };
};

