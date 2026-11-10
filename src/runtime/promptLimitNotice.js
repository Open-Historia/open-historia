/*! Open Historia — the notice that an edited prompt passage was too long to use © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// An edited prompt passage may be at most 20% longer than the built-in one
// (guidanceCharLimit, src/Game/AI/promptGuidance.js). A longer one, from a save
// or a scenario made before the limit, an imported prompt pack or a hub
// download, is never cut to fit: the game leaves it out whole and the AI reads
// the built-in passage. Cutting would end the author's text mid-sentence, and
// the AI would follow half an instruction without anyone knowing.
//
// Leaving it out without a word would be as bad, so the game says so, once
// for each passage: the loaders (gameplay.js loadPromptCatalog, main.jsx
// ensurePromptsLoaded) hand what they left out to notePromptsOverLimit, and
// PromptLimitNotice (GameUI) shows it. A passage is remembered on this device
// by its section, its segment and a fingerprint of its text, so the notice
// comes back only when a different text is too long.

import { guidanceFingerprint } from "../Game/AI/promptGuidance.js";

export const PROMPT_LIMIT_NOTICE_EVENT = "oh:prompt-limit-notice";
const SEEN_KEY = "oh.promptLimitNotice.seen";
const SEEN_MAX = 200;

let pending = [];

const storageOf = (storage) => {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const readSeen = (storage) => {
  try {
    const list = JSON.parse(storage?.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
};

export const promptLimitNoticeId = (entry) =>
  `${entry?.sectionKey ?? ""}.${entry?.segmentId ?? ""}:${guidanceFingerprint(entry?.text ?? "")}`;

// The passages a loader left out (normalizePromptPack's `overLimit`). Those
// not told of before, on this device, wait for the notice.
export const notePromptsOverLimit = (entries, { storage } = {}) => {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return pending;
  const seen = new Set(readSeen(storageOf(storage)));
  const waiting = new Set(pending.map((entry) => entry.id));
  let added = false;
  for (const entry of list) {
    const id = promptLimitNoticeId(entry);
    if (seen.has(id) || waiting.has(id)) continue;
    waiting.add(id);
    pending = [...pending, {
      id,
      sectionKey: entry.sectionKey,
      sectionLabel: entry.sectionLabel ?? entry.sectionKey,
      segmentId: entry.segmentId,
      segmentLabel: entry.segmentLabel ?? entry.segmentId,
      length: entry.length,
      limit: entry.limit,
    }];
    added = true;
  }
  if (added) {
    try {
      globalThis.dispatchEvent?.(new globalThis.CustomEvent(PROMPT_LIMIT_NOTICE_EVENT));
    } catch { /* no window (tests) */ }
  }
  return pending;
};

export const pendingPromptLimitNotice = () => pending;

// Shown: each passage is remembered, so it is said once.
export const markPromptLimitNoticeSeen = ({ storage } = {}) => {
  const target = storageOf(storage);
  const ids = pending.map((entry) => entry.id);
  pending = [];
  if (!ids.length || !target) return;
  try {
    const seen = [...new Set([...readSeen(target), ...ids])].slice(-SEEN_MAX);
    target.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch { /* storage full or blocked: it may be said again */ }
};

// Tests only.
export const resetPromptLimitNotice = () => {
  pending = [];
};
