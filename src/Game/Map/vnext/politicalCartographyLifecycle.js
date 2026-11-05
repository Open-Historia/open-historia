/*! Open Historia — Map vNext political-cartography lifecycle helpers © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */

import { toCountryName } from "../../../runtime/ownerNames.js";

const DEFAULT_TIMEOUT_MS = 60000;

const asObject = (value) => (value && typeof value === "object" ? value : {});

/**
 * Latest-only request scheduler for expensive derived political cartography.
 *
 * The canonical world can change faster than derived boundary/label
 * cartography can finish. Keep at most one expensive request in flight and one
 * latest desired snapshot pending. Intermediate desired states are intentionally
 * coalesced; request ids are monotonically increasing presentation revisions.
 *
 * This owns no canonical state. It only schedules derived presentation work.
 */
export const createPoliticalCartographyScheduler = ({
  dispatch,
  onTimeout,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) => {
  if (typeof dispatch !== "function") {
    throw new TypeError("political cartography scheduler requires dispatch(request)");
  }

  let nextRevision = 0;
  let inFlight = null;
  let latestDesired = null;
  let timer = null;
  let stopped = false;

  const clearWatchdog = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
  };

  const dispatchLatest = () => {
    if (stopped || inFlight || !latestDesired) return;
    inFlight = latestDesired;
    dispatch(inFlight);
    const timeoutMs = Number.isFinite(Number(inFlight.timeoutMs))
      ? Math.max(1, Number(inFlight.timeoutMs))
      : DEFAULT_TIMEOUT_MS;
    timer = setTimer(() => {
      timer = null;
      if (stopped || !inFlight) return;
      const stalled = inFlight;
      inFlight = null;
      if (typeof onTimeout === "function") {
        onTimeout({ stalled, latestDesired });
      }
    }, timeoutMs);
  };

  const enqueue = (payload, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
    if (stopped) return null;

    // Claim-only work is allowed to replace another claim-only snapshot, but it
    // must never erase an ownership rebuild that is still waiting behind the
    // current request. Example: ownership changes while initialize is running,
    // then claimants change before initialize finishes. The newest payload must
    // still perform the ownership cartography update, just with the newest claim data.
    const pendingType = latestDesired?.payload?.type;
    const pendingNeedsOwnership = pendingType === "initialize" || pendingType === "update-ownership";
    const effectivePayload = pendingNeedsOwnership
      ? {
          ...latestDesired.payload,
          ...payload,
          // Ownership invalidation is cumulative until a revision is actually
          // published. A newer ownership request must not replace the exact ids
          // from an older queued ownership request that never reached the worker.
          // Specialized claims/labels also ride the same ownership publication.
          type: "update-ownership",
          forceFullSnapshot: Boolean(
            latestDesired.payload?.forceFullSnapshot
            || payload?.forceFullSnapshot
            || pendingType === "initialize"
          ),
          affectedOwners: [
            ...new Set([
              ...(latestDesired.payload?.affectedOwners ?? []),
              ...(payload?.affectedOwners ?? []),
            ]),
          ],
          changedRegionIds: [
            ...new Set([
              ...(latestDesired.payload?.changedRegionIds ?? []),
              ...(payload?.changedRegionIds ?? []),
            ]),
          ],
        }
      : payload;

    const request = {
      revision: ++nextRevision,
      payload: effectivePayload,
      timeoutMs,
    };
    latestDesired = request;
    dispatchLatest();
    return request.revision;
  };

  const complete = (revision) => {
    if (stopped || !inFlight || Number(revision) !== inFlight.revision) {
      return { accepted: false, superseded: false, request: null, supersededBy: null };
    }
    clearWatchdog();
    const request = inFlight;
    inFlight = null;

    // Queue coalescing is not enough: once canonical state advances, an older
    // in-flight result is politically obsolete even if it was the request the
    // worker legitimately finished. Never publish that result. This is the
    // invariant that prevents stale derived boundaries/labels from being
    // published over already-canonical region ownership.
    const supersededBy = latestDesired?.revision !== request.revision ? latestDesired : null;
    if (supersededBy) {
      // The UI deliberately discards this completed result, but the worker has
      // already advanced its internal boundary/label caches to that revision.
      // The next incremental patch would therefore be relative to worker state
      // the UI never published. Force that next revision to publish one complete
      // CURRENT snapshot so no rev1→rev2 boundary/label changes are lost when
      // rev2 is superseded by rev3. This applies regardless of what superseded
      // the request (another ownership change, claims, or labels).
      latestDesired = {
        ...latestDesired,
        payload: {
          ...(latestDesired.payload ?? {}),
          forceFullSnapshot: true,
        },
      };
    } else {
      latestDesired = null;
    }
    dispatchLatest();
    return {
      accepted: !supersededBy,
      superseded: Boolean(supersededBy),
      request,
      supersededBy,
    };
  };

  const stop = () => {
    stopped = true;
    clearWatchdog();
    inFlight = null;
    latestDesired = null;
  };

  const snapshot = () => ({
    nextRevision,
    inFlight,
    latestDesired,
    stopped,
  });

  return { enqueue, complete, stop, snapshot };
};

/**
 * Regions whose canonical owner differs from the last worker-acknowledged
 * derived-cartography snapshot. The returned entries are presentation deltas only; they do
 * not become another ownership ledger.
 */
export const buildOwnershipPresentationDelta = (
  records,
  currentOverrides,
  acknowledgedOverrides,
) => {
  if (!Array.isArray(records) || !acknowledgedOverrides) return [];
  const current = asObject(currentOverrides);
  const acknowledged = asObject(acknowledgedOverrides);
  const delta = [];

  for (const record of records) {
    const id = String(record?.id ?? "");
    if (!id) continue;
    const baseOwner = canonicalOwner(record?.owner);
    const fromOwner = canonicalOwner(acknowledged[id] ?? baseOwner);
    const toOwner = canonicalOwner(current[id] ?? baseOwner);
    if (fromOwner === toOwner) continue;
    delta.push({ id, fromOwner, toOwner });
  }

  return delta;
};

const canonicalOwner = (value) => toCountryName(String(value ?? "").trim());

/**
 * Diff canonical region ownership without inventing another ledger. Base-owner
 * metadata is used only when an override disappears; current/previous override
 * objects remain the canonical mutable input.
 */
export const diffPoliticalOwnership = (records, previousOverrides = {}, nextOverrides = {}) => {
  const previous = asObject(previousOverrides);
  const next = asObject(nextOverrides);
  const recordById = new Map((records ?? []).map((record) => [String(record?.id ?? ""), record]));
  const ids = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changedRegionIds = [];
  const changes = [];
  const affectedOwners = new Set();

  for (const id of ids) {
    const baseOwner = canonicalOwner(recordById.get(id)?.owner);
    const fromOwner = canonicalOwner(previous[id] ?? baseOwner);
    const toOwner = canonicalOwner(next[id] ?? baseOwner);
    if (fromOwner === toOwner) continue;
    changedRegionIds.push(id);
    changes.push({ id, fromOwner, toOwner });
    if (fromOwner) affectedOwners.add(fromOwner);
    if (toOwner) affectedOwners.add(toOwner);
  }

  return {
    changedRegionIds,
    changes,
    affectedOwners: [...affectedOwners],
  };
};
