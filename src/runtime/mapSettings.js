/*! Open Historia — portions (map interaction/display settings) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Map interaction/display settings — localStorage-backed, same getter/setter
// pattern as src/Game/AI/providerConfig.js. Consumers subscribe via
// useMapSetting() below instead of receiving these as props threaded through
// GameUI/main.jsx, mirroring how useCountryDisplayName (polityNames.js) sits
// beside the data it subscribes to.
import { useEffect, useState } from "react";
import { logDebugEvent, setDebugLogContext } from "./debugLog.js";

// Immediate source of truth for string-valued settings. This also keeps a
// runtime override functional in privacy/file contexts where localStorage
// writes can be rejected.
const valueSettingMemory = new Map();

export const MAP_SETTING_KEYS = {
    // Empty/unset means "use the scenario author's basemap". A built-in ESRI
    // basemap id here is a local, reversible player override for this browser.
    basemapStyle: "map_basemap_style",
    // Empty/unset means "use the scenario author's label font" (world.labelFont,
    // itself defaulting to Georgia). A family name here is a local, reversible
    // player override, the same shape as basemapStyle above. It exists in
    // Settings as well as in the two editors because a label font you cannot
    // read is a reason to change it, and until now the only way to was through
    // the game editor.
    labelFont: "map_label_font",
    hideCountryLabels: "map_hide_country_labels",
    // Draw the map with the renderer this project used before Map vNext, kept
    // verbatim under src/Game/Map/legacy/ (see the README there). MapScene picks
    // which set of components mounts; nothing else about vNext is touched.
    //
    // OFF by default, and that is load-bearing: vNext is the renderer for
    // everyone who does not ask otherwise, so its development is unaffected by
    // this key existing.
    legacyMapRenderer: "map_legacy_renderer",
    disableIdleRotation: "map_disable_idle_rotation",
    disableEventCamera: "map_disable_event_camera",
    // Not a map setting, but the same localStorage-toggle mechanism: when ON,
    // an AI task gives up when the model goes quiet — 5 minutes part-way through
    // an answer, 15 with no answer at all — and falls back to canned events. Off
    // waits as long as the model needs.
    //
    // OFF by default — read with getMapSetting, so an absent key means "off".
    //
    // It measures SILENCE rather than elapsed time (see AI/idleDeadline.js): a
    // window that every token restarts never interrupts a model that is still
    // answering, so turning it on is safe, and it is the only thing that ever
    // ends a genuine stall. It ships off all the same, because the fallback it
    // triggers is a canned turn the player did not ask for; the beta leaves
    // that trade to the player, who opts in from Settings → AI.
    limitAiGeneration: "ai_limit_generation",
    // Opt-in (ported from the abdulrahman-2005 fork): tasks nobody is waiting
    // on — today the event consolidator — ride the provider's batch endpoint
    // at about half the price, with the result applied later by a poller.
    // Anthropic only; every other provider keeps the synchronous call.
    batchBackgroundTasks: "ai_batch_background_tasks",
    // Long time skips are generated in SEGMENTS — several shorter model calls
    // merged into the one round the player asked for — rather than as a single
    // request. A nine-month skip asks for 30-odd events at once, which on a
    // hosted provider is tens of minutes of generation in one HTTP request; the
    // field report behind this was a gateway closing exactly that with a 502 at
    // 301.7s, costing the player a turn with fourteen queued orders in it.
    //
    // OFF by default — read with getMapSetting, so an absent key means "off":
    // a skip is one request unless the player opts in. Segments re-send the
    // prompt per piece, so they cost more tokens and a round reads less like
    // one; a player whose provider drops long requests turns them on from
    // Settings → AI.
    chunkLongJumps: "ai_chunk_long_jumps",
    // The work-in-progress unit system: the AI owns movement and combat, units
    // carry a posture, and the engine advances standing orders every turn
    // (runtime/unitMotion.js). OFF — the default, and what an absent key means —
    // is the classic system: the player moves and attacks by hand and combat
    // resolves through the seeded resolver in Map/unitCombat.js.
    //
    // Both modes read and write the SAME save shape, so switching is lossless in
    // either direction; see isBetaUnits() below for why it is read once.
    //
    // UNLIKE every other key here, this one is NOT where the setting actually
    // lives. The unit system is a property of a CAMPAIGN, not of a browser
    // profile: a save carries it in game.json (`betaUnits`), so it survives a
    // restart on any build, and a copied or duplicated save keeps playing the
    // way it was set up. This key survives only as the default handed to a save
    // that has never chosen — which is what migrates every save made before the
    // setting moved, and what makes a newly created game start the way the last
    // one did. See resolveBetaUnits() below.
    betaUnits: "beta_unit_system",
};

export function getMapSetting(key) {
    // Guarded because these reads are reached from modules that node --test
    // imports without a DOM, and an unguarded read would turn "import this
    // module" into a ReferenceError. An absent store reads as every setting
    // off, which is the shipped default anyway.
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(key) === "1";
}

// The same read for a setting that ships ON: only an explicit "0" (the player
// turned it off) disables it, so a fresh install or cleared storage gets the
// feature without opting in. Mirrors getReasoningEnabled() in AI/providerConfig.js.
//
// A default-on setting CANNOT use getMapSetting above — an absent key reads as
// "1" !== null, i.e. off — so every consumer of such a key must come through here.
//
// No key ships on today: the two AI toggles that did (limitAiGeneration and
// chunkLongJumps) went default-off in the beta. Kept for the next one.
export function getMapSettingDefaultOn(key) {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(key) !== "0";
}

// Storage keys are what the game persists; they are not what a maintainer wants
// to read in a bug report. Kept beside MAP_SETTING_KEYS so a new setting that
// forgets to add a name still logs its key rather than nothing.
const SETTING_LABELS = {
    [MAP_SETTING_KEYS.hideCountryLabels]: "Hide country labels",
    [MAP_SETTING_KEYS.legacyMapRenderer]: "Legacy map renderer",
    [MAP_SETTING_KEYS.disableIdleRotation]: "Disable idle globe rotation",
    [MAP_SETTING_KEYS.disableEventCamera]: "Disable camera movement during events",
    [MAP_SETTING_KEYS.limitAiGeneration]: "Limit AI generation",
    [MAP_SETTING_KEYS.batchBackgroundTasks]: "Batch background AI tasks",
    [MAP_SETTING_KEYS.chunkLongJumps]: "Generate long time skips in segments",
    [MAP_SETTING_KEYS.betaUnits]: "Beta unit system",
};

export function setMapSetting(key, value) {
    localStorage.setItem(key, value ? "1" : "0");
    // Every toggle in Settings that matters to a bug report goes through here.
    // One line covers all of them, and it lands in the log at the moment it was
    // flipped rather than as a state dump at the end.
    logDebugEvent("setting", `${SETTING_LABELS[key] || key} turned ${value ? "on" : "off"}.`);
    window.dispatchEvent(new Event("mapSettings:updated"));
}

export function getMapSettingValue(key, fallback = "") {
    if (valueSettingMemory.has(key)) return valueSettingMemory.get(key);
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value;
    } catch {
        return fallback;
    }
}

export function setMapSettingValue(key, value) {
    const normalized = String(value ?? "").trim();
    valueSettingMemory.set(key, normalized);
    try {
        if (normalized) localStorage.setItem(key, normalized);
        else localStorage.removeItem(key);
    } catch {
        // The live in-memory setting still applies for this session.
    }
    window.dispatchEvent(new CustomEvent("mapSettings:updated", {
        detail: { key, value: normalized },
    }));
}

// ---------------------------------------------------------------------------
// The beta unit system: a PER-SAVE setting.
//
// It lives in the active save's game.json, not in localStorage, for three
// reasons the old storage could not give:
//   * it survives a restart of any build — two desktop builds can share their
//     saves without sharing a Chromium profile, so a localStorage flag would
//     silently reset every time a tester swapped builds;
//   * two campaigns can run under different systems, which is the only way to
//     try the beta without converting a campaign you care about;
//   * copying or duplicating a save copies game.json with it, so the copy plays
//     the way the original did.
//
// Loading it is asynchronous (game.json is fetched), so mapSettings.js does not
// read it — runtime/library.js loads it whenever the active save changes and
// pushes it in here through applySaveBetaUnits(). Everything below is plain
// module state so this file stays importable without a DOM, a fetch or a save.

// What the loaded save says: true, false, or null for a save that has never
// chosen (every save written before the setting moved, and every new one).
let saveBetaUnits = null;
// Which save saveBetaUnits was read from. "" = nothing loaded yet. This is what
// tells isBetaUnits() that it is looking at a DIFFERENT campaign and must take a
// fresh pin, as opposed to the same campaign's toggle being flipped.
let saveBetaUnitsGameId = "";

// The value in force for the active save right now — what the settings checkbox
// shows, which is not necessarily what the running session is doing (see the pin
// below). A save that has never chosen inherits the app-wide default.
export function resolveBetaUnits() {
    return saveBetaUnits === null ? getMapSetting(MAP_SETTING_KEYS.betaUnits) : saveBetaUnits;
}

// What gameState.js stamps onto every game.json write, or null when there is no
// save open to stamp.
//
// The resolved value, not only an explicit one, and that is what finishes the
// move off localStorage: a save that has never chosen writes down whatever it
// inherited the first time it is written to at all — the end of its first turn —
// and from then on it is independent. Flip the default while playing another
// campaign and this one is unaffected, which is the whole point of the setting
// being per save.
//
// Nothing is written merely to open a save: a game.json write bumps the save's
// updatedAt, and re-sorting the library menu because someone looked at a save is
// worse than waiting for the first turn.
export function getBetaUnitsToStamp() {
    return saveBetaUnitsGameId ? resolveBetaUnits() : null;
}

// Called by runtime/library.js when a save loads, and by the settings panel when
// the player flips the toggle. `value` is the raw game.json field: undefined or
// null both mean "this save has never chosen".
export function applySaveBetaUnits(gameId, value) {
    const nextId = String(gameId ?? "");
    const next = value === undefined || value === null ? null : Boolean(value);
    if (nextId === saveBetaUnitsGameId && next === saveBetaUnits) return;
    saveBetaUnitsGameId = nextId;
    saveBetaUnits = next;
    // Same event the localStorage toggles fire, so an open settings panel and any
    // useMapSetting subscriber refresh on a save switch too.
    if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("mapSettings:updated"));
    }
}

// Is the beta unit system active for THIS session?
//
// Pinned on first read rather than re-read live, because the two systems are not
// interchangeable halfway through a turn: unitsController.js holds the
// interaction mode and unit list in module state, an AI prompt is assembled from
// a dozen call sites that must all agree about what the model was told, and a
// jump already in flight would otherwise land its events under different rules
// than it was planned under. The settings toggle says a reload is needed, and
// this is what makes that true rather than merely advisory.
//
// The pin is per SAVE, not per page load: loading a different campaign is not a
// mid-turn switch, and the whole point of a per-save setting is that opening a
// beta campaign plays it under the beta rules. App.jsx keys the map and the UI
// on the active game id, so both remount around the new pin.
//
// Read through this everywhere outside React. Inside React, either is fine:
// resolveBetaUnits() reflects the toggle immediately (so the settings panel shows
// the real checkbox state), while this reflects what the running session is doing.
let betaUnitsPinned = false;
let pinnedGameId = null;
export function isBetaUnits() {
    if (pinnedGameId !== saveBetaUnitsGameId) {
        pinnedGameId = saveBetaUnitsGameId;
        betaUnitsPinned = resolveBetaUnits();
        // Pinned once per save, recorded once per save: a bug report about units
        // is unreadable without knowing which system the SESSION is running.
        setDebugLogContext({ unitSystem: betaUnitsPinned ? "beta (AI-driven)" : "classic" });
    }
    return betaUnitsPinned;
}

// Tests only: drop the pin AND the loaded save so a case can start clean. Never
// call this from app code — re-pinning the save that is already open is exactly
// the mid-session switch the pin prevents.
export function resetBetaUnitsPinForTests() {
    betaUnitsPinned = false;
    pinnedGameId = null;
    saveBetaUnits = null;
    saveBetaUnitsGameId = "";
}

export function useMapSetting(key) {
    const [value, setValue] = useState(() => getMapSetting(key));

    useEffect(() => {
        setValue(getMapSetting(key));
        const onUpdated = () => setValue(getMapSetting(key));
        window.addEventListener("mapSettings:updated", onUpdated);
        return () => window.removeEventListener("mapSettings:updated", onUpdated);
    }, [key]);

    return value;
}

export function useMapSettingValue(key, fallback = "") {
    const [value, setValue] = useState(() => getMapSettingValue(key, fallback));

    useEffect(() => {
        const onUpdated = (event) => setValue(
            event?.detail?.key === key
                ? event.detail.value
                : getMapSettingValue(key, fallback),
        );
        onUpdated();
        window.addEventListener("mapSettings:updated", onUpdated);
        return () => window.removeEventListener("mapSettings:updated", onUpdated);
    }, [fallback, key]);

    return value;
}
