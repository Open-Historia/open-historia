/*! Open Historia Continuum — R2.35 country Stats worker kernel.
 * Pure deterministic preparation only. No DOM, React, canonical writes, or AI calls.
 */
import { toCountryName } from "../../runtime/ownerNames.js";
import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import {
  COUNTRY_STATS_POPULATION_CALIBRATION_VERSION,
  isCompleteCountryStatSheet,
  normalizeCountryStatSheet,
} from "../../runtime/countryStats.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const canonicalStatsPolity = (token, world) => {
  const text = normalizeString(token);
  if (!text) return "";
  const resolved = resolvePolityIdentity(text, world, {
    allowUnknown: true,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
  });
  return normalizeString(resolved?.resolved) || toCountryName(text) || text;
};

const stableStatsHash = (value) => {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};


const STATS_MACRO_MAX_BUCKETS = 12;
const STATS_MACRO_TARGET_COMPONENTS = 30;
const STATS_MACRO_SAMPLE_NAMES = 10;

const statsSphericalVector = (lng, lat) => {
  const lon = (Number(lng) || 0) * Math.PI / 180;
  const phi = (Number(lat) || 0) * Math.PI / 180;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lon), cosPhi * Math.sin(lon), Math.sin(phi)];
};

const statsVectorDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const statsVectorNormalize = (value) => {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
};
const statsVectorLngLat = (value) => {
  const unit = statsVectorNormalize(value);
  return {
    lng: Math.atan2(unit[1], unit[0]) * 180 / Math.PI,
    lat: Math.asin(Math.max(-1, Math.min(1, unit[2]))) * 180 / Math.PI,
  };
};

const statsRegionHeuristicWeight = ({ tags = [], type = "" } = {}) => {
  const lowered = new Set(normalizeArray(tags).map((tag) => normalizeString(tag).toLowerCase()).filter(Boolean));
  const typeKey = normalizeString(type).toLowerCase();
  let weight = 1;
  if ([...lowered].some((tag) => tag.includes("capital"))) weight *= 4;
  else if ([...lowered].some((tag) => tag.includes("metro") || tag.includes("city") || tag.includes("urban"))) weight *= 2.5;
  if ([...lowered].some((tag) => tag.includes("desert"))) weight *= 0.5;
  if ([...lowered].some((tag) => tag.includes("mountain") || tag.includes("hill"))) weight *= 0.8;
  if ([...lowered].some((tag) => tag.includes("jungle"))) weight *= 0.75;
  if (typeKey.includes("island")) weight *= 0.8;
  return Math.max(0.1, weight);
};

const buildStatsMacroPlan = (plannedRows = []) => {
  const rows = normalizeArray(plannedRows)
    .map((row, index) => {
      const geography = normalizeString(row?.geography || row?.baseGeography);
      if (!geography) return null;
      const hasLng = row?.lng !== null && row?.lng !== undefined && row?.lng !== "";
      const hasLat = row?.lat !== null && row?.lat !== undefined && row?.lat !== "";
      const lng = Number(row?.lng);
      const lat = Number(row?.lat);
      const hasPoint = hasLng && hasLat && Number.isFinite(lng) && Number.isFinite(lat);
      return {
        sourceIndex: index,
        index: Number(row?.index) || index + 1,
        geography,
        lng: hasPoint ? lng : ((index * 137.508) % 360) - 180,
        lat: hasPoint ? lat : 0,
        weight: Math.max(0.1, Number(row?.weight) || 1),
        vector: statsSphericalVector(hasPoint ? lng : ((index * 137.508) % 360) - 180, hasPoint ? lat : 0),
        regionIds: normalizeArray(row?.regions).map((region) => normalizeString(region?.id)).filter(Boolean),
        adjacencyIds: normalizeArray(row?.regions).flatMap((region) => normalizeArray(region?.adjacencies).map(normalizeString)).filter(Boolean),
      };
    })
    .filter(Boolean);
  if (!rows.length) return [];

  const clusterSpatially = (subset, bucketCount) => {
    if (!subset.length) return [];
    const count = Math.max(1, Math.min(bucketCount, subset.length));
    if (count === 1) {
      const vector = subset.reduce((sum, row) => [
        sum[0] + row.vector[0] * row.weight,
        sum[1] + row.vector[1] * row.weight,
        sum[2] + row.vector[2] * row.weight,
      ], [0, 0, 0]);
      return [{ members: subset, ...statsVectorLngLat(vector) }];
    }

    const centers = [];
    let first = subset[0];
    for (const row of subset) {
      if (row.weight > first.weight || (row.weight === first.weight && row.geography.localeCompare(first.geography) < 0)) first = row;
    }
    centers.push(first.vector);
    while (centers.length < count) {
      let choice = null;
      let choiceScore = -Infinity;
      for (const row of subset) {
        let nearestDistance = Infinity;
        for (const center of centers) {
          const distance = 1 - Math.max(-1, Math.min(1, statsVectorDot(row.vector, center)));
          if (distance < nearestDistance) nearestDistance = distance;
        }
        const score = nearestDistance * Math.sqrt(row.weight);
        if (score > choiceScore || (score === choiceScore && row.geography.localeCompare(choice?.geography || "") < 0)) {
          choice = row;
          choiceScore = score;
        }
      }
      centers.push(choice?.vector || subset[centers.length % subset.length].vector);
    }

    let assignments = new Array(subset.length).fill(0);
    for (let iteration = 0; iteration < 5; iteration += 1) {
      assignments = subset.map((row) => {
        let best = 0;
        let bestDot = -Infinity;
        for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
          const similarity = statsVectorDot(row.vector, centers[centerIndex]);
          if (similarity > bestDot) {
            bestDot = similarity;
            best = centerIndex;
          }
        }
        return best;
      });
      for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
        const members = subset.filter((_, rowIndex) => assignments[rowIndex] === centerIndex);
        if (!members.length) continue;
        const vector = members.reduce((sum, row) => [
          sum[0] + row.vector[0] * row.weight,
          sum[1] + row.vector[1] * row.weight,
          sum[2] + row.vector[2] * row.weight,
        ], [0, 0, 0]);
        centers[centerIndex] = statsVectorNormalize(vector);
      }
    }
    return centers.map((center, centerIndex) => ({
      members: subset.filter((_, rowIndex) => assignments[rowIndex] === centerIndex),
      ...statsVectorLngLat(center),
    })).filter((bucket) => bucket.members.length);
  };

  // Preserve major disconnected territorial blocks before spatial clustering.
  // This prevents a nearby colony (e.g. North Africa) from being blended into the
  // metropole merely because a global k-means center falls across the sea.
  const rowByRegionId = new Map();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (const id of rows[rowIndex].regionIds) rowByRegionId.set(id, rowIndex);
  }
  const graph = rows.map(() => new Set());
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (const adjacentId of rows[rowIndex].adjacencyIds) {
      const other = rowByRegionId.get(adjacentId);
      if (other == null || other === rowIndex) continue;
      graph[rowIndex].add(other);
      graph[other].add(rowIndex);
    }
  }
  const visited = new Set();
  const connected = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (visited.has(rowIndex)) continue;
    const queue = [rowIndex];
    visited.add(rowIndex);
    const memberIndexes = [];
    while (queue.length) {
      const current = queue.shift();
      memberIndexes.push(current);
      for (const next of graph[current]) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    connected.push(memberIndexes.map((index) => rows[index]));
  }

  const majorCandidates = connected.filter((component) => component.length >= 4).sort((a, b) => b.length - a.length);
  const originalTinyRows = connected.filter((component) => component.length < 4).flat();
  const reserveForTiny = originalTinyRows.length || majorCandidates.length > STATS_MACRO_MAX_BUCKETS ? 1 : 0;
  const majorLimit = Math.max(0, STATS_MACRO_MAX_BUCKETS - reserveForTiny);
  const major = majorCandidates.slice(0, majorLimit);
  const tinyRows = [
    ...originalTinyRows,
    ...majorCandidates.slice(majorLimit).flat(),
  ];
  const baseDesired = Math.max(1, Math.min(STATS_MACRO_MAX_BUCKETS, Math.ceil(rows.length / STATS_MACRO_TARGET_COMPONENTS)));
  const tinyCapacity = Math.max(0, STATS_MACRO_MAX_BUCKETS - major.length);
  const tinyMinimum = tinyRows.length ? Math.min(tinyCapacity, 3, Math.ceil(tinyRows.length / 10)) : 0;
  const minimumForLandmasses = major.length + tinyMinimum;
  const desired = Math.max(1, Math.min(STATS_MACRO_MAX_BUCKETS, Math.max(baseDesired, minimumForLandmasses)));

  const allocations = major.map(() => 1);
  let tinyAllocation = tinyMinimum;
  let remaining = desired - allocations.reduce((sum, value) => sum + value, 0) - tinyAllocation;
  while (remaining > 0) {
    let bestType = "major";
    let bestIndex = -1;
    let bestPressure = tinyRows.length && tinyAllocation > 0 ? tinyRows.length / tinyAllocation : -1;
    for (let index = 0; index < major.length; index += 1) {
      const pressure = major[index].length / allocations[index];
      if (pressure > bestPressure) {
        bestPressure = pressure;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) allocations[bestIndex] += 1;
    else if (tinyRows.length) tinyAllocation += 1;
    else break;
    remaining -= 1;
  }

  const buckets = [];
  major.forEach((component, index) => buckets.push(...clusterSpatially(component, allocations[index])));
  if (tinyRows.length && tinyAllocation > 0) {
    buckets.push(...clusterSpatially(tinyRows, tinyAllocation));
  } else if (tinyRows.length && buckets.length) {
    // Pathological case with more major disconnected landmasses than the hard
    // macro cap: retain the cap and attach overflow rows to their nearest bucket.
    for (const row of tinyRows) {
      let nearest = buckets[0];
      let best = -Infinity;
      for (const bucket of buckets) {
        const center = statsSphericalVector(bucket.lng, bucket.lat);
        const similarity = statsVectorDot(row.vector, center);
        if (similarity > best) {
          best = similarity;
          nearest = bucket;
        }
      }
      nearest.members.push(row);
    }
  }
  if (!buckets.length) buckets.push(...clusterSpatially(rows, desired));

  buckets.sort((a, b) => b.lat - a.lat || a.lng - b.lng || a.members[0].geography.localeCompare(b.members[0].geography));
  return buckets.map((bucket, index) => ({ index: index + 1, ...bucket }));
};

const buildStatsMacroContext = (macroPlan = []) => normalizeArray(macroPlan).map((bucket) => {
  const center = statsVectorLngLat(statsSphericalVector(bucket?.lng, bucket?.lat));
  const members = normalizeArray(bucket?.members);
  const samples = [...members]
    .sort((a, b) => b.weight - a.weight || a.geography.localeCompare(b.geography))
    .slice(0, STATS_MACRO_SAMPLE_NAMES)
    .map((member) => member.geography);
  return `[M${bucket.index}] ${members.length} live component(s); center ${Math.abs(center.lat).toFixed(1)}°${center.lat >= 0 ? "N" : "S"}, ${Math.abs(center.lng).toFixed(1)}°${center.lng >= 0 ? "E" : "W"}; representative places: ${samples.join(", ")}`;
}).join("\n");

const statsPolityAliases = (world, canonicalName) => {
  const values = new Set([normalizeString(canonicalName)]);
  const target = normalizeString(canonicalName).toLowerCase();
  for (const [key, polity] of Object.entries(world?.polityOverrides || {})) {
    const candidates = [key, polity?.code, polity?.name, ...normalizeArray(polity?.aliases)]
      .map(normalizeString)
      .filter(Boolean);
    const belongs = candidates.some((candidate) => {
      const resolved = canonicalStatsPolity(candidate, world);
      return normalizeString(resolved).toLowerCase() === target;
    });
    if (belongs) candidates.forEach((candidate) => values.add(candidate));
  }
  return [...values].filter(Boolean);
};


// R2.41 — deterministic Stats middle-stage context runs off the UI thread.
const STATS_ECONOMIC_EVENT_SCAN_LIMIT = 64;
const STATS_ECONOMIC_EVIDENCE_LIMIT = 12;
const STATS_ACCOUNTED_EVENT_LIMIT = 64;
const ECONOMIC_EVENT_PATTERN = /\b(?:tax|taxation|levy|budget|fiscal|deficit|surplus|debt|bond|loan|credit|bank|banking|currency|monetary|inflation|unemployment|recession|depression|boom|growth|trade|tariff|customs|sanction|blockade|shortage|harvest|famine|food|coal|oil|energy|industry|industrial|factory|rail|railway|infrastructure|subsid|spending|appropriation|finance|financial|wage|strike|mobiliz|war finance|occupation|annex|cession|reparat|investment|export|import)\b/i;
const STATS_GENERIC_POLITY_WORDS = new Set([
  "empire", "kingdom", "republic", "state", "states", "federation", "federal",
  "union", "united", "people", "peoples", "grand", "duchy", "commonwealth",
]);

const statsTextMentionsTarget = (textValue, aliases) => {
  const text = normalizeString(textValue).toLowerCase();
  if (!text) return false;
  for (const alias of aliases) {
    const phrase = normalizeString(alias).toLowerCase();
    if (phrase.length >= 4 && text.includes(phrase)) return true;
    const tokens = phrase
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/[\s-]+/)
      .filter((token) => token.length >= 5 && !STATS_GENERIC_POLITY_WORDS.has(token));
    for (const token of tokens) {
      if (text.includes(token)) return true;
      if (token.length >= 6 && text.includes(token.slice(0, 5))) return true;
    }
  }
  return false;
};

const parseIsoDateKernel = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizeString(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return null;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1] ? { day, month, year } : null;
};
const statsDateMillisKernel = (value) => {
  const parsed = parseIsoDateKernel(value);
  if (!parsed) return null;
  const time = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  return Number.isFinite(time) ? time : null;
};

const statsTerritorialPlanMatchesSheetKernel = (sheet, plan = []) => {
  const expected = normalizeArray(plan)
    .map((entry) => normalizeString(entry?.geography).toLowerCase())
    .filter(Boolean)
    .sort();
  if (!expected.length) return true;
  const actual = normalizeArray(sheet?.territorialComponents)
    .map((entry) => normalizeString(entry?.geography).toLowerCase())
    .filter(Boolean)
    .sort();
  if (actual.length !== expected.length) return false;
  return expected.every((geography, index) => actual[index] === geography);
};

const buildStatsPreviousMacroContextKernel = (previous, macroPlan = []) => {
  const byGeography = new Map(
    normalizeArray(previous?.territorialComponents)
      .map((component) => [normalizeString(component?.geography).toLowerCase(), component]),
  );
  const lines = [];
  for (const bucket of normalizeArray(macroPlan)) {
    const components = normalizeArray(bucket?.members)
      .map((member) => byGeography.get(normalizeString(member?.geography).toLowerCase()))
      .filter(Boolean);
    if (!components.length) continue;
    const population = components.reduce(
      (sum, component) => sum + Math.max(0, Number(component?.population) || 0), 0,
    );
    const gdp = components.reduce(
      (sum, component) => sum +
        Math.max(0, Number(component?.population) || 0) *
        Math.max(0, Number(component?.gdpPerCapita) || 0),
      0,
    );
    const groups = new Map();
    for (const component of components) {
      groups.set(
        component.group,
        (groups.get(component.group) || 0) + Math.max(0, Number(component.population) || 0),
      );
    }
    const group = [...groups.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "core";
    lines.push(
      `[M${bucket.index}] group=${group}; population=${Math.round(population)}; ` +
      `gdpPerCapita=${population > 0 ? Math.round(gdp / population) : 0}; ` +
      `matched=${components.length}/${normalizeArray(bucket.members).length}`,
    );
  }
  return lines.join("\n");
};

const buildTargetEconomicEvidenceKernel = ({ bundle, statCode, previous, world }) => {
  const target = canonicalStatsPolity(statCode, world) || normalizeString(statCode);
  const targetKey = target.toLowerCase();
  const aliases = statsPolityAliases(world, target);
  const accounted = new Set(
    normalizeArray(previous?.continuity?.accountedEventIds)
      .map(normalizeString)
      .filter(Boolean),
  );
  const sameTarget = (token) => {
    const resolved = canonicalStatsPolity(token, world);
    return normalizeString(resolved).toLowerCase() === targetKey;
  };

  const recent = normalizeArray(bundle?.events).slice(-STATS_ECONOMIC_EVENT_SCAN_LIMIT);
  const relevant = [];
  for (const event of recent) {
    const id = normalizeString(event?.id);
    if (!id) continue;
    const prose = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
    const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
    const statImpact = normalizeArray(impacts.polityChanges).some((change) =>
      change?.stats && sameTarget(change?.code || change?.name));
    const legalTerritoryImpact = normalizeArray(impacts.regionTransfers).some((transfer) =>
      sameTarget(transfer?.fromCode) || sameTarget(transfer?.toCode));
    const controlImpact = normalizeArray(impacts.regionControlOps).some((op) =>
      sameTarget(op?.fromCode) || sameTarget(op?.toCode) ||
      sameTarget(op?.actorCode) || sameTarget(op?.claimantCode));
    const combatant = normalizeArray(event?.combatants).some(sameTarget);
    const mentioned = statsTextMentionsTarget(prose, aliases);
    const economicCue = ECONOMIC_EVENT_PATTERN.test(prose);
    if (!(statImpact || legalTerritoryImpact || (economicCue && (mentioned || controlImpact || combatant)))) continue;
    relevant.push({
      id,
      date: normalizeString(event?.date),
      title: normalizeString(event?.title) || "Economic development",
      description: normalizeString(event?.description),
      importance: normalizeString(event?.importance),
      directStatImpact: statImpact,
      legalTerritoryImpact,
    });
  }

  const unaccounted = relevant.filter((event) => !accounted.has(event.id));
  const selectedFresh = unaccounted.slice(-STATS_ECONOMIC_EVIDENCE_LIMIT);
  const deferredCount = Math.max(0, unaccounted.length - selectedFresh.length);
  const lines = selectedFresh.map((event) => {
    const detail = event.description.length > 360
      ? `${event.description.slice(0, 359).trimEnd()}…`
      : event.description;
    const flags = [
      event.directStatImpact ? "event carries explicit stats impact" : "",
      event.legalTerritoryImpact ? "legal-territory change" : "",
    ].filter(Boolean).join(", ");
    return `- [${event.id}] ${event.date || "undated"} — ${event.title}${flags ? ` [${flags}]` : ""}${detail ? `: ${detail}` : ""}`;
  });
  if (deferredCount > 0) {
    lines.unshift(`- ${deferredCount} earlier fresh relevant economic event(s) are intentionally deferred by the bounded evidence window; do not invent their details.`);
  }
  return {
    text: lines.join("\n"),
    relevantIds: relevant.map((event) => event.id).slice(-STATS_ACCOUNTED_EVENT_LIMIT),
    selectedFreshIds: selectedFresh.map((event) => event.id),
    unaccountedCount: unaccounted.length,
  };
};

const STATS_CALIBRATION_STARTING_TEXT_LIMIT = 5000;
const STATS_CALIBRATION_PREGAME_EVENT_LIMIT = 12;
const STATS_CALIBRATION_CAMPAIGN_EVENT_LIMIT = 16;
const STATS_CALIBRATION_HISTORY_LIMIT = 8;
const STATS_CALIBRATION_CONSOLIDATED_LIMIT = 10;
const STATS_DEMOGRAPHIC_CANON_PATTERN = /\b(?:war|battle|casualt|killed|deaths?|mortality|epidem|pandemic|disease|famine|starvation|refuge|migration|emigration|immigration|expulsion|deport|population|birth|annex|cession|partition|occupation|independence|secession|mobiliz|demobiliz|reconstruction|coloniz|settlement)\b/i;

const compactStatsCalibrationEventKernel = (event) => {
  const date = normalizeString(event?.date) || "undated";
  const title = normalizeString(event?.title) || "Untitled event";
  const description = normalizeString(event?.description);
  const detail = description.length > 240
    ? `${description.slice(0, 239).trimEnd()}…`
    : description;
  return `- ${date} — ${title}${detail ? `: ${detail}` : ""}`;
};

const buildStatsPopulationCalibrationCanonKernel = ({ bundle, statCode, world }) => {
  const target = canonicalStatsPolity(statCode, world) || normalizeString(statCode);
  const targetKey = target.toLowerCase();
  const aliases = statsPolityAliases(world, target);
  const startDate = normalizeString(bundle?.game?.startDate || bundle?.game?.gameDate);
  const currentDate = normalizeString(bundle?.game?.gameDate || startDate);
  const events = normalizeArray(bundle?.events);

  const sameTarget = (token) => {
    const resolved = canonicalStatsPolity(token, world);
    return normalizeString(resolved).toLowerCase() === targetKey;
  };
  const isBeforeStart = (event) => {
    if (normalizeString(event?.source).toLowerCase() === "pregame") return true;
    const eventDate = normalizeString(event?.date);
    if (parseIsoDateKernel(eventDate) && parseIsoDateKernel(startDate)) {
      return statsDateMillisKernel(eventDate) < statsDateMillisKernel(startDate);
    }
    return false;
  };

  const pregame = events.filter(isBeforeStart).slice(-STATS_CALIBRATION_PREGAME_EVENT_LIMIT);
  const campaignRelevant = events
    .filter((event) => !isBeforeStart(event))
    .filter((event) => {
      const prose = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
      const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
      const directStats = normalizeArray(impacts.polityChanges).some((change) =>
        change?.stats && sameTarget(change?.code || change?.name));
      const territory = normalizeArray(impacts.regionTransfers).some((transfer) =>
        sameTarget(transfer?.fromCode) || sameTarget(transfer?.toCode));
      const combatant = normalizeArray(event?.combatants).some(sameTarget);
      const mentioned = statsTextMentionsTarget(prose, aliases);
      return directStats || territory || combatant ||
        (mentioned && STATS_DEMOGRAPHIC_CANON_PATTERN.test(prose)) ||
        (STATS_DEMOGRAPHIC_CANON_PATTERN.test(prose) &&
          /\b(?:pandemic|epidemic|global|worldwide)\b/i.test(prose));
    })
    .slice(-STATS_CALIBRATION_CAMPAIGN_EVENT_LIMIT);

  const startingTimelineText = normalizeString(world?.startingTimelineText);
  const historySummaries = normalizeArray(world?.simulationHistory)
    .map((entry) => {
      const rawSummary = normalizeString(entry?.summary);
      if (!rawSummary) return "";
      const summary = rawSummary.length > 600 ? `${rawSummary.slice(0, 599).trimEnd()}…` : rawSummary;
      const fromDate = normalizeString(entry?.fromDate);
      const toDate = normalizeString(entry?.toDate || entry?.date);
      const mode = normalizeString(entry?.mode);
      return `- ${fromDate || "?"}${toDate && toDate !== fromDate ? ` → ${toDate}` : ""}${mode ? ` [${mode}]` : ""}: ${summary}`;
    })
    .filter(Boolean)
    .slice(-STATS_CALIBRATION_HISTORY_LIMIT);

  const consolidatedAll = normalizeArray(world?.consolidatedHistory)
    .map((entry) => {
      const rawSummary = normalizeString(entry?.summary);
      if (!rawSummary) return "";
      const summary = rawSummary.length > 700 ? `${rawSummary.slice(0, 699).trimEnd()}…` : rawSummary;
      const throughDate = normalizeString(entry?.throughDate);
      const round = Number(entry?.throughRound);
      return `- through ${throughDate || "?"}${Number.isFinite(round) ? ` (round ${Math.trunc(round)})` : ""}: ${summary}`;
    })
    .filter(Boolean);

  const consolidatedHistory = (() => {
    if (consolidatedAll.length <= STATS_CALIBRATION_CONSOLIDATED_LIMIT) return consolidatedAll;
    const selected = [];
    for (let index = 0; index < STATS_CALIBRATION_CONSOLIDATED_LIMIT; index += 1) {
      const sourceIndex = Math.round(
        index * (consolidatedAll.length - 1) / (STATS_CALIBRATION_CONSOLIDATED_LIMIT - 1),
      );
      selected.push(consolidatedAll[sourceIndex]);
    }
    return [...new Set(selected)];
  })();

  const blocks = [
    `Scenario start: ${startDate || "unknown"}. Current campaign date: ${currentDate || "unknown"}.`,
    "Use this canon to locate the latest genuinely shared historical frontier. A changed polity name, changed borders, a different war outcome, a surviving/dissolved regime, or any other supplied contradiction is evidence that later real-world history belongs to another timeline.",
  ];
  if (startingTimelineText) {
    blocks.push(`SCENARIO AUTHOR'S WORLD-BEFORE-ROUND-ONE BRIEFING (highest-priority pre-start canon):\n${startingTimelineText.slice(0, STATS_CALIBRATION_STARTING_TEXT_LIMIT)}`);
  }
  if (pregame.length) {
    blocks.push(`CANONICAL PRE-GAME EVENTS (${pregame.length} shown):\n${pregame.map(compactStatsCalibrationEventKernel).join("\n")}`);
  }
  if (consolidatedHistory.length) {
    blocks.push(`LONG-CAMPAIGN CONSOLIDATED CANON (${consolidatedHistory.length} chronological coverage samples):\n${consolidatedHistory.join("\n")}`);
  }
  if (historySummaries.length) {
    blocks.push(`RECENT CAMPAIGN HISTORY CHECKPOINTS (${historySummaries.length} shown):\n${historySummaries.join("\n")}`);
  }
  if (campaignRelevant.length) {
    blocks.push(`TARGET/DEMOGRAPHIC CAMPAIGN EVENTS AFTER START (${campaignRelevant.length} shown):\n${campaignRelevant.map(compactStatsCalibrationEventKernel).join("\n")}`);
  }
  if (!startingTimelineText && !pregame.length) {
    blocks.push("No explicit pre-start divergence text/events are available. Do NOT interpret that absence as proof that same-date real history is canonical: the live polity identity and authoritative territorial basis may themselves demonstrate an alternate scenario. If they materially conflict with real history, treat the divergence frontier as earlier/unknown and estimate forward from shared regional priors plus scenario state instead of copying a historical headline total.");
  }
  return blocks.join("\n\n");
};

const buildStatsWorkerMiddleContext = ({
  bundle,
  code,
  territorialBasis,
  forceReassess = false,
}) => {
  const world = bundle?.world || {};
  const previous = normalizeCountryStatSheet(world?.countryStats?.[code]);
  const previousComplete = isCompleteCountryStatSheet(previous);
  const territorialPlan = normalizeArray(territorialBasis?.plan);
  const territorialMacroPlan = normalizeArray(territorialBasis?.macroPlan);
  const territorialFingerprint = normalizeString(territorialBasis?.fingerprint);
  const previousTerritorialFingerprint = normalizeString(previous?.continuity?.territorialFingerprint);
  const previousStateFingerprint = normalizeString(previous?.continuity?.stateFingerprint);
  const territorialCoverageMatches = !previousComplete
    ? true
    : statsTerritorialPlanMatchesSheetKernel(previous, territorialPlan);
  const previousComponentCount = normalizeArray(previous?.territorialComponents).length;
  const previousPopulationCalibrationVersion = Math.max(
    0,
    Math.trunc(Number(previous?.continuity?.populationCalibrationVersion) || 0),
  );
  const currentDate = normalizeString(bundle?.game?.gameDate || bundle?.game?.startDate);
  const campaignStartDate = normalizeString(bundle?.game?.startDate) || currentDate;
  const currentRound = Math.max(0, Math.trunc(Number(bundle?.game?.round) || 0));
  const atScenarioStartState = Boolean(
    campaignStartDate && currentDate === campaignStartDate && currentRound <= 1,
  );
  const legacyComponentCapPoison = Boolean(
    previousComplete &&
    territorialPlan.length > 64 &&
    previousComponentCount === 64 &&
    previousTerritorialFingerprint &&
    previousTerritorialFingerprint === territorialFingerprint &&
    !territorialCoverageMatches,
  );
  const startPopulationCalibrationUpgrade = Boolean(
    previousComplete &&
    Boolean(territorialFingerprint) &&
    atScenarioStartState &&
    previousPopulationCalibrationVersion < COUNTRY_STATS_POPULATION_CALIBRATION_VERSION,
  );
  const rebuildNumericBaseline = Boolean(
    forceReassess || legacyComponentCapPoison || startPopulationCalibrationUpgrade,
  );
  const populationCalibrationRequested = Boolean(
    territorialFingerprint && (!previousComplete || rebuildNumericBaseline),
  );
  const legacyContinuityBootstrap = Boolean(previousComplete && !previousStateFingerprint);
  const legacyMappedTerritoryBootstrap = Boolean(
    legacyContinuityBootstrap && Boolean(territorialFingerprint),
  );

  const rawEconomicEvidence = buildTargetEconomicEvidenceKernel({
    bundle,
    statCode: code,
    previous,
    world,
  });

  const previousContext = !rebuildNumericBaseline && previous
    ? (() => {
        const normalizedPrevious = normalizeCountryStatSheet(previous) || previous;
        const { territorialComponents: _previousComponents = [], ...previousSummary } = normalizedPrevious;
        const macroSummary = buildStatsPreviousMacroContextKernel(
          normalizedPrevious,
          territorialMacroPlan,
        );
        return [
          "Previous whole-sheet metadata / derived aggregates:",
          JSON.stringify(previousSummary, null, 2),
          macroSummary ? `Previous bounded regional macro roll-up:\n${macroSummary}` : "",
        ].filter(Boolean).join("\n");
      })()
    : "";

  const statsScenarioCalibrationCanon = populationCalibrationRequested
    ? buildStatsPopulationCalibrationCanonKernel({ bundle, statCode: code, world })
    : "";

  return {
    prepared: true,
    rawEconomicEvidence,
    previousContext,
    statsScenarioCalibrationCanon,
  };
};

export const buildTargetStatsTerritorialBasisKernel = ({ bundle, code, scenarioCatalog = [], fallbackCatalog = [] } = {}) => {
  const world = bundle?.world || {};
  const target = canonicalStatsPolity(code, world);
  if (!target) {
    return {
      context: "No target polity was resolved.",
      plan: [],
      macroPlan: [],
      mode: "none",
      referenceContext: "",
    };
  }

  // 8B.2.14: Stats must use the SAME scenario geography that the player actually
  // sees. loadRegionCatalog() is deliberately broad: stock GADM rows are merged
  // with scenario/custom rows and its cache may outlive individual runtime fetches.
  // That is useful for name resolution, but it is not authoritative enough for
  // territorial accounting on hybrid maps. The rendered regionsGeojson is the
  // current map partition and therefore wins whenever it exists. Stock/merged
  // catalog data is retained only as a compatibility fallback for maps that do not
  // expose a rendered region FeatureCollection.
  // 8B.2.18.1 performance: the rendered scenario map is authoritative, so do
  // not eagerly load/merge the broad stock region catalog in parallel. That fallback
  // can be much larger than the active scenario and used to block Stats even when it
  // was immediately discarded.
  // R2.31 performance: never reopen / parse the giant scenario GeoJSON merely to
  // inspect another country's Stats. Nations already projects the exact rendered
  // scenario partition into a compact non-geometry catalog. Use that authoritative
  // projection directly; stock merged catalog remains fallback-only.
  const liveScenarioCatalog = normalizeArray(scenarioCatalog);

  const renderedCatalog = [];
  for (const region of liveScenarioCatalog) {
    const id = normalizeString(region?.id);
    const name = normalizeString(region?.name) || id;

    if (id && name) {
      const countryCode = normalizeString(region?.countryCode);
      const mappedCountryCode = countryCode
        ? normalizeString(toCountryName(countryCode))
        : "";
      const resolvedCodeGeography =
        mappedCountryCode && mappedCountryCode.toLowerCase() !== countryCode.toLowerCase()
          ? mappedCountryCode
          : "";

      const country = normalizeString(region?.country);
      const baseGeography = country || resolvedCodeGeography || name || id;
      const baseOwner = country || resolvedCodeGeography || mappedCountryCode || "";

      renderedCatalog.push({
        id,
        name,
        countryCode,
        baseGeography,
        baseOwner,
        lng: Number.isFinite(Number(region?.lng)) ? Number(region.lng) : null,
        lat: Number.isFinite(Number(region?.lat)) ? Number(region.lat) : null,
        weight: statsRegionHeuristicWeight({ tags: region?.tags, type: region?.type }),
        adjacencies: normalizeArray(region?.adjacencies).map(normalizeString).filter(Boolean),
      });
    }

  }

  const mergedCatalog = renderedCatalog.length ? [] : normalizeArray(fallbackCatalog);

  const projectedFallbackCatalog = normalizeArray(mergedCatalog)
    .map((region) => {
      const id = normalizeString(region?.id);
      const name = normalizeString(region?.name) || id;
      if (!id || !name) return null;

      const rawCountryCode = normalizeString(region?.countryCode);
      const mappedCountryCode = rawCountryCode
        ? normalizeString(toCountryName(rawCountryCode))
        : "";
      const resolvedCodeGeography =
        mappedCountryCode && mappedCountryCode.toLowerCase() !== rawCountryCode.toLowerCase()
          ? mappedCountryCode
          : "";
      const country = normalizeString(region?.country);
      const baseGeography = country || resolvedCodeGeography || name || id;
      const baseOwner = country || resolvedCodeGeography || mappedCountryCode || "";

      const centroid = region?.centroid?.coordinates;
      const lng = Number(Array.isArray(centroid) ? centroid[0] : region?.lng ?? region?.longitude);
      const lat = Number(Array.isArray(centroid) ? centroid[1] : region?.lat ?? region?.latitude);
      return {
        id,
        name,
        countryCode: rawCountryCode,
        baseGeography,
        baseOwner,
        lng: Number.isFinite(lng) ? lng : null,
        lat: Number.isFinite(lat) ? lat : null,
        weight: statsRegionHeuristicWeight({ tags: region?.tags, type: region?.type }),
        adjacencies: normalizeArray(region?.adjacencies).map(normalizeString).filter(Boolean),
      };
    })
    .filter(Boolean);

  const catalog = renderedCatalog.length > 0 ? renderedCatalog : projectedFallbackCatalog;
  if (!catalog.length) {
    return {
      context: "No region catalog is available; use existing campaign records conservatively.",
      plan: [],
      macroPlan: [],
      mode: "none",
      referenceContext: "",
    };
  }

  // 8B.2.18.1 performance: target membership is the hot path over every map
  // feature. Do not invoke the full polity identity resolver 2-4 times per region.
  // Resolve the target once, build its known identity/alias set once, and compare raw
  // map ownership tokens against that set. Keep a tiny generic resolver cache only
  // for the rare displaced-sovereign/donor comparisons that truly need it.
  const targetIdentityKeys = new Set([
    target,
    code,
    ...statsPolityAliases(world, target),
  ].map((value) => normalizeString(value).toLowerCase()).filter(Boolean));
  const mappedTargetCode = normalizeString(toCountryName(code));
  if (mappedTargetCode) targetIdentityKeys.add(mappedTargetCode.toLowerCase());

  const sameTarget = (value) => {
    const raw = normalizeString(value);
    if (!raw) return false;
    const key = raw.toLowerCase();
    if (targetIdentityKeys.has(key)) return true;
    const mapped = normalizeString(toCountryName(raw)).toLowerCase();
    return Boolean(mapped && targetIdentityKeys.has(mapped));
  };

  const canonicalCache = new Map();
  const canonicalCached = (value) => {
    const raw = normalizeString(value);
    if (!raw) return "";
    const key = raw.toLowerCase();
    if (canonicalCache.has(key)) return canonicalCache.get(key);
    const resolved = canonicalStatsPolity(raw, world);
    canonicalCache.set(key, resolved);
    return resolved;
  };
  const same = (a, b) =>
    normalizeString(canonicalCached(a)).toLowerCase() ===
    normalizeString(canonicalCached(b)).toLowerCase();

  const totalByBase = new Map();
  const legalByBase = new Map();
  const controlledByBase = new Map();
  const displacedSovereigns = new Set();

  let occupiedByTarget = 0;
  let targetOccupiedByOthers = 0;
  let nativeHomelandControlled = 0;

  const pushRegion = (map, baseGeography, region) => {
    if (!map.has(baseGeography)) map.set(baseGeography, []);
    map.get(baseGeography).push(region);
  };

  for (let catalogIndex = 0; catalogIndex < catalog.length; catalogIndex += 1) {
    const region = catalog[catalogIndex];
    const regionId = normalizeString(region?.id);
    const baseGeography = normalizeString(region?.baseGeography) || normalizeString(region?.name) || regionId;
    if (!regionId || !baseGeography) continue;

    totalByBase.set(baseGeography, (totalByBase.get(baseGeography) || 0) + 1);

    const baseOwner = normalizeString(region?.baseOwner);
    const controller = normalizeString(
      world.regionOwnershipOverrides?.[regionId] || baseOwner,
    );
    // 8B.2.14: regionSovereigntyOverrides is intentionally SPARSE. normalizeWorldState
    // drops an explicit sovereignty entry whenever legal sovereign === current controller
    // to avoid persisting thousands of redundant normal-ownership rows. Therefore, when
    // no explicit sovereignty anchor exists, the CURRENT CONTROLLER is the effective legal
    // sovereign. A genuine wartime occupation is safe because its old legal sovereign is
    // preserved as an explicit differing sovereignty override before control flips.
    const sovereign = normalizeString(
      world.regionSovereigntyOverrides?.[regionId] || controller || baseOwner,
    );

    const row = {
      id: regionId,
      name: normalizeString(region?.name) || regionId,
      sovereign,
      lng: Number.isFinite(Number(region?.lng)) ? Number(region.lng) : null,
      lat: Number.isFinite(Number(region?.lat)) ? Number(region.lat) : null,
      weight: Math.max(0.1, Number(region?.weight) || 1),
      adjacencies: normalizeArray(region?.adjacencies).map(normalizeString).filter(Boolean),
    };

    if (sameTarget(controller)) {
      pushRegion(controlledByBase, baseGeography, row);

      if (!sameTarget(sovereign)) {
        occupiedByTarget += 1;
        if (sovereign) displacedSovereigns.add(sovereign);

        // Strong native evidence that the controlled land is the polity's own
        // homeland/base geography rather than an arbitrary foreign occupation.
        if (sameTarget(baseGeography)) nativeHomelandControlled += 1;
      }
    }

    if (sameTarget(sovereign) && controller && !sameTarget(controller)) {
      targetOccupiedByOthers += 1;
    }

    if (sameTarget(sovereign)) pushRegion(legalByBase, baseGeography, row);

  }

  const targetOverrideEntry = Object.entries(world.polityOverrides || {})
    .find(([key, record]) => [
      key,
      record?.code,
      record?.name,
      ...normalizeArray(record?.aliases),
    ].some((value) => value && sameTarget(value)));

  const targetOverride = targetOverrideEntry?.[1] || null;
  const targetExplicitlyActive =
    normalizeString(targetOverride?.status).toLowerCase() === "active";

  // Structured lifecycle evidence is universal and identity-safe. Merely being a
  // CREATEd/RESTOREd polity is not by itself enough (a government-in-exile or newly
  // created foreign invader must not absorb whatever it happens to occupy). Stronger
  // evidence exists when the establishing event ALSO assigns territory/control to the
  // polity. No country names, historical keywords, or scenario-specific ids.
  let lifecycleEstablished = false;
  let foundingTerritoryEstablished = false;
  for (const event of normalizeArray(bundle?.events)) {
    const changes = normalizeArray(event?.impacts?.polityChanges);
    const establishesTarget = changes.some((change) => {
      const operation = normalizeString(change?.operation).toLowerCase();
      return ["create", "restore"].includes(operation) &&
        (sameTarget(change?.code) || sameTarget(change?.name));
    });

    if (!establishesTarget) continue;
    lifecycleEstablished = true;

    const grantsControl = normalizeArray(event?.impacts?.regionControlOps)
      .some((operation) =>
        ["control", "control_flip"].includes(normalizeString(operation?.op).toLowerCase()) &&
        sameTarget(operation?.toCode));

    const grantsSovereignty = normalizeArray(event?.impacts?.regionTransfers)
      .some((transfer) => sameTarget(transfer?.toCode));

    if (grantsControl || grantsSovereignty) foundingTerritoryEstablished = true;
  }

  // Canonical war context is supporting evidence, especially for older saves whose
  // lifecycle-establishing event may have been consolidated away. It is NOT enough
  // by itself to convert a normal foreign occupation into national Stats scope.
  let opposedToDisplacedSovereign = false;
  for (const war of normalizeArray(world?.wars)) {
    if (!["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase())) continue;

    const sideA = normalizeArray(war?.sideA);
    const sideB = normalizeArray(war?.sideB);
    const targetInA = sideA.some((party) => sameTarget(party));
    const targetInB = sideB.some((party) => sameTarget(party));
    if (!targetInA && !targetInB) continue;

    const opponents = targetInA ? sideB : sideA;
    if (opponents.some((party) =>
      [...displacedSovereigns].some((sovereign) => same(party, sovereign)))) {
      opposedToDisplacedSovereign = true;
      break;
    }
  }

  const legalRegionCount = [...legalByBase.values()]
    .reduce((sum, regions) => sum + regions.length, 0);
  const controlledRegionCount = [...controlledByBase.values()]
    .reduce((sum, regions) => sum + regions.length, 0);

  // Universal de-facto-state rule.
  //
  // Normal states stay on LEGAL SOVEREIGNTY accounting, even while occupying
  // foreign territory. Controller-based accounting is selected ONLY when:
  //   1) there is no usable legal-sovereign mapped basis;
  //   2) the polity actually controls mapped territory;
  //   3) it is an explicitly active campaign polity; and
  //   4) native evidence identifies those holdings as its territorial state base,
  //      not ordinary foreign occupation.
  const deFactoStatehoodEvidence = Boolean(
    nativeHomelandControlled > 0 ||
    foundingTerritoryEstablished ||
    (lifecycleEstablished && opposedToDisplacedSovereign)
  );

  const useDeFactoStateBasis = Boolean(
    legalRegionCount === 0 &&
    controlledRegionCount > 0 &&
    targetExplicitlyActive &&
    deFactoStatehoodEvidence,
  );

  const selectedByBase = useDeFactoStateBasis ? controlledByBase : legalByBase;
  const mode = useDeFactoStateBasis ? "de_facto_state" : "legal";

  if (useDeFactoStateBasis) {
    console.info(
      `[stats 8B.2.18.1] ${target}: DE-FACTO STATE ADMINISTRATION selected — ` +
        `${controlledRegionCount} controlled region(s), 0 legal-sovereign region(s), ` +
        `rendered-geography=${renderedCatalog.length ? "yes" : "fallback"}, ` +
        `own-base=${nativeHomelandControlled}, lifecycle=${lifecycleEstablished ? "yes" : "no"}, ` +
        `founding-territory=${foundingTerritoryEstablished ? "yes" : "no"}, ` +
        `war-with-displaced-sovereign=${opposedToDisplacedSovereign ? "yes" : "no"}.`,
    );
  } else if (legalRegionCount === 0 && controlledRegionCount > 0) {
    console.info(
      `[stats 8B.2.18.1] ${target}: ${controlledRegionCount} controlled region(s) excluded from national Stats; ` +
        `de-facto state qualification failed (active=${targetExplicitlyActive ? "yes" : "no"}, ` +
        `own-base=${nativeHomelandControlled}, lifecycle=${lifecycleEstablished ? "yes" : "no"}, ` +
        `founding-territory=${foundingTerritoryEstablished ? "yes" : "no"}, ` +
        `war-with-displaced-sovereign=${opposedToDisplacedSovereign ? "yes" : "no"}).`,
    );
  }

  const rows = [...selectedByBase.entries()]
    .map(([baseGeography, regions]) => ({
      baseGeography,
      regions,
      total: totalByBase.get(baseGeography) || regions.length,
    }))
    .sort((a, b) =>
      b.regions.length - a.regions.length ||
      a.baseGeography.localeCompare(b.baseGeography));

  if (!rows.length) {
    return {
      context: [
        `Target: ${target}`,
        "Accounting mode: LEGAL SOVEREIGNTY",
        "No legally sovereign map regions were resolved for this polity.",
        controlledRegionCount > 0
          ? `The polity controls ${controlledRegionCount} region(s), but native statehood safeguards did NOT classify those holdings as a de-facto national administrative basis. Ordinary occupation therefore remains excluded from national population/GDP.`
          : "No de-facto controlled mapped regions were resolved either.",
        "Do not silently substitute modern borders. If this is a landless polity, estimate only what the campaign canon actually supports.",
      ].join("\n"),
      plan: [],
      mode,
      referenceContext: "",
    };
  }

  const plannedRows = rows.map((row, index) => {
    const located = row.regions.filter((region) =>
      region?.lng !== null && region?.lng !== undefined && region?.lng !== "" &&
      region?.lat !== null && region?.lat !== undefined && region?.lat !== "" &&
      Number.isFinite(Number(region.lng)) && Number.isFinite(Number(region.lat))
    );
    const weight = row.regions.reduce((sum, region) => sum + Math.max(0.1, Number(region?.weight) || 1), 0);
    const vector = located.reduce((sum, region) => {
      const localWeight = Math.max(0.1, Number(region?.weight) || 1);
      const local = statsSphericalVector(region.lng, region.lat);
      return [sum[0] + local[0] * localWeight, sum[1] + local[1] * localWeight, sum[2] + local[2] * localWeight];
    }, [0, 0, 0]);
    const point = located.length ? statsVectorLngLat(vector) : { lng: null, lat: null };
    return {
      index: index + 1,
      geography: row.baseGeography,
      regions: row.regions,
      total: row.total,
      lng: point.lng,
      lat: point.lat,
      weight,
    };
  });

  const macroPlan = buildStatsMacroPlan(plannedRows);
  const macroContext = buildStatsMacroContext(macroPlan);
  console.info(
    `[stats 8B.2.18.1] ${target}: ${plannedRows.length} authoritative live component(s) -> ${macroPlan.length} bounded demographic macro bucket(s) (${mode}); AI output no longer scales with province count.`,
  );
  // eslint-disable-next-line no-constant-condition
  if (false) {
    console.debug(
      `[stats 8B.2.18.1 debug] ${target}: full authoritative component plan`,
      plannedRows.map((row) => ({
        index: row.index,
        geography: row.geography,
        coverage: `${row.regions.length}/${row.total}`,
        regions: row.regions.map((region) => `${region.name} [${region.id}]`),
      })),
    );
    console.debug(`[stats 8B.2.18.1 debug] ${target}: macro plan`, macroPlan);
  }

  const lines = [
    `Target: ${target}`,
    `Accounting mode: ${useDeFactoStateBasis ? "DE-FACTO STATE ADMINISTRATION" : "LEGAL SOVEREIGNTY"}`,
    useDeFactoStateBasis
      ? `De-facto administered mapped regions: ${controlledRegionCount}. Legal-sovereign mapped regions: 0.`
      : `Legally sovereign mapped regions: ${legalRegionCount}.`,
    `Exact live-map accounting components held natively: ${plannedRows.length}.`,
    `Bounded demographic macro buckets for this AI assessment: ${macroPlan.length}.`,
    "The macro buckets below are native spatial groupings used only to bound demographic/economic estimation. They do NOT redefine sovereignty, province identity, or constitutional status.",
    macroContext,
  ];

  if (useDeFactoStateBasis) {
    lines.push(
      "SPECIAL STATEHOOD RULE: native code selected controller-based Stats because this active polity has no usable legal-sovereign map basis but does administer territory as a state actor. Count ONLY the controlled territory represented by the macro buckets. This rule must NOT be generalized by the model to ordinary foreign occupation.",
    );
    lines.push(
      `Native qualification evidence: own-base controlled regions=${nativeHomelandControlled}; lifecycle create/restore=${lifecycleEstablished ? "yes" : "no"}; founding event granted territory/control=${foundingTerritoryEstablished ? "yes" : "no"}; active/ceasefire conflict with displaced sovereign=${opposedToDisplacedSovereign ? "yes" : "no"}.`,
    );
  }

  if (!useDeFactoStateBasis && occupiedByTarget > 0) {
    lines.push(
      `Temporary occupations held by ${target} but legally sovereign to others: ${occupiedByTarget} region(s) — DO NOT add these inhabitants/GDP to the national component total.`,
    );
  }

  if (targetOccupiedByOthers > 0) {
    lines.push(
      `Legally sovereign ${target} regions under temporary foreign control: ${targetOccupiedByOthers} region(s) — keep them in legal population/GDP scope, but current occupation may economically depress/disrupt them if campaign evidence supports it.`,
    );
  }

  // For a de-facto state, the displaced legal sovereign often already has a mature
  // component ledger for the same geography. Expose exact canonical donor rows as
  // continuity anchors. This is universal data reuse, not scenario-specific data.
  const referenceLines = [];
  if (useDeFactoStateBasis) {
    for (const row of plannedRows) {
      const sourcePolities = [...new Set(
        row.regions
          .map((region) => canonicalCached(region?.sovereign))
          .filter((source) => source && !same(source, target)),
      )];

      for (const source of sourcePolities) {
        const sourceSheet = normalizeCountryStatSheet(world?.countryStats?.[source]);
        const sourceComponents = normalizeArray(sourceSheet?.territorialComponents);
        const donor = sourceComponents.find((component) =>
          normalizeString(component?.geography).toLowerCase() ===
          normalizeString(row.geography).toLowerCase());

        const donorPopulation = Number(donor?.population);
        const donorGdpPerCapita = Number(donor?.gdpPerCapita);
        if (
          !donor ||
          !Number.isFinite(donorPopulation) ||
          donorPopulation < 0 ||
          !Number.isFinite(donorGdpPerCapita) ||
          donorGdpPerCapita <= 0
        ) {
          continue;
        }

        const full = row.regions.length >= row.total;
        referenceLines.push(
          `[${row.index}] ${row.geography} ← ${source}: canonical donor component population=${Math.round(donorPopulation)}, gdpPerCapita=${donorGdpPerCapita}. ${
            full
              ? "Current scope is FULL/NEAR-FULL for this base bucket; treat this as a strong pre-separation continuity anchor."
              : `Current scope is PARTIAL (${row.regions.length}/${row.total}); DO NOT copy the donor's whole population. Estimate ONLY the listed controlled subregions while using donor productivity/demography as context.`
          }`,
        );
      }
    }
  }

  if (referenceLines.length) {
    console.info(`[stats 8B.2.18.1] ${target}: ${referenceLines.length} donor/reference component anchor(s) available.`);
    // eslint-disable-next-line no-constant-condition
    if (false) {
      console.debug(`[stats 8B.2.18.1 debug] ${target}: donor/reference component anchors`, referenceLines);
    }
  }

  const fingerprintSource = [
    `mode=${mode}`,
    `geographySource=${renderedCatalog.length ? "rendered" : "fallback"}`,
    ...plannedRows.map((row) => [
      row.geography,
      row.total,
      row.regions.map((region) => region.id).sort().join(","),
    ].join("|")),
  ].join("\n");

  return {
    context: lines.join("\n"),
    plan: plannedRows.map((row) => ({ index: row.index, geography: row.geography })),
    macroPlan: macroPlan.map((bucket) => ({
      index: bucket.index,
      lng: bucket.lng,
      lat: bucket.lat,
      members: bucket.members.map((member) => ({
        geography: member.geography,
        weight: member.weight,
      })),
    })),
    fingerprint: `territory-${stableStatsHash(fingerprintSource)}`,
    mode,
    referenceContext: referenceLines.slice(0, 24).join("\n") + (referenceLines.length > 24 ? `\n(+${referenceLines.length - 24} more donor anchors retained natively but omitted from the bounded AI context)` : ""),
  };
};


export const buildTargetDossierKernel = ({ bundle, code, scenarioCatalog = [], fallbackCatalog = [] } = {}) => {
  const world = bundle?.world || {};
  const lines = [];

  const polity = code ? world.polityOverrides?.[code] : null;
  if (polity) {
    lines.push(
      `Polity: ${polity.name || code} (code ${code})${
        polity.aliases?.length > 0 ? ` — also known as ${polity.aliases.join(", ")}` : ""
      }`,
    );
    if (polity.note) lines.push(`Notes: ${polity.note}`);
  }

  const overrides = Object.entries(world.regionOwnershipOverrides ?? {});
  const owned = code ? overrides.filter(([, owner]) => owner === code) : [];
  if (owned.length > 0) {
    const catalog = normalizeArray(scenarioCatalog).length
      ? normalizeArray(scenarioCatalog)
      : normalizeArray(fallbackCatalog);
    const regionLookup = new Map(catalog.map((region) => [String(region?.id ?? ""), region]));
    const names = owned.slice(0, 40).map(([regionId]) => {
      const region = regionLookup.get(regionId);
      return region
        ? `${region.name || regionId}${region.country ? ` (${region.country})` : ""}`
        : regionId;
    });
    lines.push(
      `Territory: holds ${owned.length} regions${owned.length > names.length ? ", including" : ""}: ${names.join(", ")}${
        owned.length > names.length ? ", …" : ""
      }`,
    );
  } else if (code) {
    lines.push(
      overrides.length > 0
        ? `Territory: no regions on the current map are recorded as held by ${code}.`
        : `Territory: holds its modern-day territory (no territorial changes recorded).`,
    );
  }

  const units = normalizeArray(bundle?.world?.units).filter((unit) => unit?.ownerCode === code);
  if (units.length > 0) {
    const byType = new Map();
    let strength = 0;
    for (const unit of units) {
      byType.set(unit.type, (byType.get(unit.type) || 0) + 1);
      strength += Number(unit.strength) || 0;
    }
    const composition = Array.from(byType.entries())
      .map(([type, count]) => `${count} ${type}`)
      .join(", ");
    lines.push(`Deployed forces: ${units.length} units (${composition}), combined strength ${strength}.`);
  } else {
    lines.push("Deployed forces: none currently on the map.");
  }

  return lines.join("\n");
};


export const projectCountryStatsScenarioCatalog = (geojson) => {
  const entries = [];
  for (const feature of geojson?.features || []) {
    const props = feature?.properties || {};
    const id =
      props?.id != null
        ? String(props.id)
        : props?.GID_1 != null
          ? String(props.GID_1)
          : "";
    if (!id) continue;

    const rawName = props?.name ?? props?.NAME_1 ?? props?.name_1;
    const name = normalizeString(rawName) || id;
    const centroid = props?.centroid?.coordinates;
    const lng = Number(
      Array.isArray(centroid)
        ? centroid[0]
        : props?.lng ?? props?.longitude
    );
    const lat = Number(
      Array.isArray(centroid)
        ? centroid[1]
        : props?.lat ?? props?.latitude
    );

    entries.push({
      country: props?.country ? String(props.country) : "",
      countryCode:
        props?.gid0 != null
          ? String(props.gid0)
          : props?.GID_0 != null
            ? String(props.GID_0)
            : "",
      id,
      name,
      lng: Number.isFinite(lng) ? lng : null,
      lat: Number.isFinite(lat) ? lat : null,
      tags: Array.isArray(props?.tags)
        ? props.tags.map((value) => String(value))
        : [],
      type: props?.type ? String(props.type) : "",
      adjacencies: Array.isArray(props?.adjacencies)
        ? props.adjacencies.map((value) => String(value)).filter(Boolean)
        : [],
    });
  }
  return entries;
};

export const prepareCountryStatsKernel = (payload = {}) => {
  const common = {
    bundle: payload.bundle || {},
    code: payload.code || "",
    scenarioCatalog: payload.scenarioCatalog || [],
    fallbackCatalog: payload.fallbackCatalog || [],
  };

  const territorialBasis = buildTargetStatsTerritorialBasisKernel(common);
  return {
    territorialBasis,
    dossier: buildTargetDossierKernel(common),
    middle: buildStatsWorkerMiddleContext({
      bundle: common.bundle,
      code: common.code,
      territorialBasis,
      forceReassess: Boolean(payload.forceReassess),
    }),
  };
};
