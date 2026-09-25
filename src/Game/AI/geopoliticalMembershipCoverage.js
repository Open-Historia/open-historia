/*! Open Historia Continuum — bounded geopolitical membership coverage/rescue */

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => Array.isArray(value) ? value : [];
const chunk = (items, size) => Array.from(
  { length: Math.ceil(items.length / size) },
  (_, index) => items.slice(index * size, index * size + size),
);

export const GEOPOLITICAL_MEMBERSHIP_TINY_RETRY_MAX = 2;
export const GEOPOLITICAL_MEMBERSHIP_RESCUE_BATCH_SIZE = 16;
export const GEOPOLITICAL_MEMBERSHIP_RECOVERY_SPLIT_MIN = 4;
export const GEOPOLITICAL_MEMBERSHIP_RECOVERY_MAX_DEPTH = 2;

const abortIfNeeded = (signal) => {
  if (!signal?.aborted) return;
  throw signal.reason || new DOMException("Geopolitical generation cancelled.", "AbortError");
};

/**
 * Resolve membership/regime coverage without re-running successful normal batches.
 *
 * requestProfiles(requestedPolities, meta) must return already-normalized records
 * shaped as { polityKey, ... }. Valid results are salvaged immediately.
 *
 * Recovery is deliberately bounded and size-aware:
 * - normal batches run once;
 * - unresolved work is NEVER sent back as one giant rescue request;
 * - rescue work is capped at GEOPOLITICAL_MEMBERSHIP_RESCUE_BATCH_SIZE;
 * - partially/fully failed rescue chunks are recursively subdivided at most two
 *   levels (16 -> 8 -> 4) so one malformed provider response cannot strand a
 *   large polity block;
 * - a final one/two polity retry remains available;
 * - after those bounds, generation still fails closed.
 */
export const resolveGeopoliticalMembershipCoverage = async ({
  requestedPolities = [],
  batchSize = 48,
  requestProfiles,
  signal,
  onProgress,
} = {}) => {
  if (typeof requestProfiles !== "function") throw new Error("requestProfiles must be a function");

  const requested = [...new Set(array(requestedPolities).map(clean).filter(Boolean))];
  const requestedSet = new Set(requested);
  const recordMap = new Map();
  const diagnostics = [];
  let requestCount = 0;
  let diagnosticIndex = 0;

  const unresolved = () => requested.filter((polity) => !recordMap.has(polity));

  const requestAndSalvage = async (polities, meta) => {
    const targets = array(polities).map(clean).filter((polity) => requestedSet.has(polity) && !recordMap.has(polity));
    if (!targets.length) return { requested: 0, returned: 0, accepted: 0, error: "", targets: [] };
    abortIfNeeded(signal);
    requestCount += 1;
    try {
      const returned = array(await requestProfiles(targets, meta));
      let acceptedThisCall = 0;
      for (const record of returned) {
        const polityKey = clean(record?.polityKey);
        if (!targets.includes(polityKey) || recordMap.has(polityKey)) continue;
        recordMap.set(polityKey, record);
        acceptedThisCall += 1;
      }
      const diagnostic = {
        phase: meta.phase,
        batchIndex: meta.batchIndex ?? diagnosticIndex,
        attempt: meta.attempt ?? 1,
        recoveryDepth: meta.recoveryDepth ?? 0,
        requested: targets.length,
        returned: returned.length,
        accepted: acceptedThisCall,
        acceptedTotal: recordMap.size,
        unresolved: unresolved().length,
      };
      diagnosticIndex += 1;
      diagnostics.push(diagnostic);
      return { requested: targets.length, returned: returned.length, accepted: acceptedThisCall, error: "", targets };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      const message = clean(error?.message || error);
      diagnostics.push({
        phase: meta.phase,
        batchIndex: meta.batchIndex ?? diagnosticIndex,
        attempt: meta.attempt ?? 1,
        recoveryDepth: meta.recoveryDepth ?? 0,
        requested: targets.length,
        returned: 0,
        accepted: 0,
        acceptedTotal: recordMap.size,
        unresolved: unresolved().length,
        error: message,
      });
      diagnosticIndex += 1;
      return { requested: targets.length, returned: 0, accepted: 0, error: message, targets };
    }
  };

  const recoverChunk = async (polities, { phase = "memberships-rescue", recoveryDepth = 0 } = {}) => {
    const targets = array(polities).filter((polity) => requestedSet.has(polity) && !recordMap.has(polity));
    if (!targets.length) return;

    await requestAndSalvage(targets, {
      phase,
      batchIndex: diagnosticIndex,
      attempt: 1,
      recoveryDepth,
    });

    const remainingInChunk = targets.filter((polity) => !recordMap.has(polity));
    if (!remainingInChunk.length || remainingInChunk.length <= GEOPOLITICAL_MEMBERSHIP_TINY_RETRY_MAX) return;
    if (recoveryDepth >= GEOPOLITICAL_MEMBERSHIP_RECOVERY_MAX_DEPTH) return;

    const nextSize = Math.max(
      GEOPOLITICAL_MEMBERSHIP_RECOVERY_SPLIT_MIN,
      Math.ceil(remainingInChunk.length / 2),
    );
    for (const split of chunk(remainingInChunk, nextSize)) {
      await recoverChunk(split, {
        phase: "memberships-recovery-split",
        recoveryDepth: recoveryDepth + 1,
      });
    }
  };

  const batches = chunk(requested, Math.max(1, Number(batchSize) || 48));
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    await requestAndSalvage(batches[batchIndex], { phase: "memberships", batchIndex, attempt: 1, recoveryDepth: 0 });
    onProgress?.({
      phase: "memberships",
      batchIndex,
      totalBatches: batches.length,
      resolvedPolities: recordMap.size,
      totalPolities: requested.length,
      unresolvedBatchPolities: batches[batchIndex].filter((polity) => !recordMap.has(polity)),
      unresolvedPolities: unresolved(),
    });
  }

  // Never send an arbitrarily large unresolved set back to the provider. A
  // 197-polity rescue is almost guaranteed to truncate or produce malformed JSON.
  // Instead, recover unresolved coverage in bounded chunks and only subdivide
  // the chunks that still fail/omit rows.
  let remaining = unresolved();
  if (remaining.length) {
    const rescueBatches = chunk(remaining, GEOPOLITICAL_MEMBERSHIP_RESCUE_BATCH_SIZE);
    for (let rescueIndex = 0; rescueIndex < rescueBatches.length; rescueIndex += 1) {
      await recoverChunk(rescueBatches[rescueIndex], { phase: "memberships-rescue", recoveryDepth: 0 });
      onProgress?.({
        phase: "memberships-rescue",
        batchIndex: rescueIndex,
        totalBatches: rescueBatches.length,
        resolvedPolities: recordMap.size,
        totalPolities: requested.length,
        unresolvedPolities: unresolved(),
      });
    }
    remaining = unresolved();
  }

  if (remaining.length > 0 && remaining.length <= GEOPOLITICAL_MEMBERSHIP_TINY_RETRY_MAX) {
    await requestAndSalvage(remaining, {
      phase: "memberships-tiny-retry",
      batchIndex: diagnosticIndex,
      attempt: 1,
      recoveryDepth: GEOPOLITICAL_MEMBERSHIP_RECOVERY_MAX_DEPTH + 1,
    });
    remaining = unresolved();
    onProgress?.({
      phase: "memberships-tiny-retry",
      batchIndex: diagnosticIndex,
      totalBatches: batches.length,
      resolvedPolities: recordMap.size,
      totalPolities: requested.length,
      unresolvedPolities: remaining,
    });
  }

  return {
    records: requested.map((polity) => recordMap.get(polity)).filter(Boolean),
    unresolvedPolities: remaining,
    diagnostics,
    requestCount,
  };
};
