/*! Open Historia — portions (map interaction/display settings) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Map interaction/display settings — localStorage-backed, same getter/setter
// pattern as src/Game/AI/providerConfig.js. Consumers subscribe via
// useMapSetting() below instead of receiving these as props threaded through
// GameUI/main.jsx, mirroring how useCountryDisplayName (polityNames.js) sits
// beside the data it subscribes to.
import { useEffect, useState } from "react";
import { logDebugEvent, setDebugLogContext } from "./debugLog.js";

export const MAP_SETTING_KEYS = {
    hideCountryLabels: "map_hide_country_labels",
    disableIdleRotation: "map_disable_idle_rotation",
    disableEventCamera: "map_disable_event_camera",
    // Not a map setting, but the same localStorage-toggle mechanism: when ON,
    // timeline-jump generation gets a 5-minute deadline and falls back to
    // canned events past it. OFF (the default) waits as long as the model
    // needs — the fallback is only reachable through a real error, never a
    // slow model (Cancel still works either way).
    limitAiGeneration: "ai_limit_generation",
    // Long time skips are generated in SEGMENTS — several shorter model calls
    // merged into the one round the player asked for — rather than as a single
    // request. A nine-month skip asks for 30-odd events at once, which on a
    // hosted provider is tens of minutes of generation in one HTTP request; the
    // field report behind this was a gateway closing exactly that with a 502 at
    // 301.7s, costing the player a turn with fourteen queued orders in it.
    //
    // ON by default — read with getMapSettingDefaultOn, NOT getMapSetting, since
    // an absent key here means "on", not "off". Off restores the single-request
    // behaviour for players who would rather have one long wait than several
    // short ones (it re-sends the prompt per segment, so it costs more tokens).
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
    // Guarded because isBetaUnits() below is read from gameplay.js and
    // promptContext.js, not just from components — and node --test has no
    // localStorage, so an unguarded read would turn "import this module" into a
    // ReferenceError for any future test that touches those paths. An absent
    // store reads as every setting off, which is the shipped default anyway.
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(key) === "1";
}

// The same read for a setting that ships ON: only an explicit "0" (the player
// turned it off) disables it, so a fresh install or cleared storage gets the
// feature without opting in. Mirrors getReasoningEnabled() in AI/providerConfig.js.
//
// A default-on setting CANNOT use getMapSetting above — an absent key reads as
// "1" !== null, i.e. off — so every consumer of such a key must come through here.
export function getMapSettingDefaultOn(key) {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(key) !== "0";
}

// Storage keys are what the game persists; they are not what a maintainer wants
// to read in a bug report. Kept beside MAP_SETTING_KEYS so a new setting that
// forgets to add a name still logs its key rather than nothing.
const SETTING_LABELS = {
    [MAP_SETTING_KEYS.hideCountryLabels]: "Hide country labels",
    [MAP_SETTING_KEYS.disableIdleRotation]: "Disable idle globe rotation",
    [MAP_SETTING_KEYS.disableEventCamera]: "Disable camera movement during events",
    [MAP_SETTING_KEYS.limitAiGeneration]: "Limit AI generation",
    [MAP_SETTING_KEYS.chunkLongJumps]: "Generate long time skips in segments",
    [MAP_SETTING_KEYS.betaUnits]: "Beta unit system",
};

export function setMapSetting(key, value) {
    localStorage.setItem(key, value ? "1" : "0");
    // Every toggle in Settings that matters to a bug report goes through here —
    // the beta unit system above all, which changes who moves the units and so
    // changes what half the reports in the tracker even mean. One line here
    // covers all of them, and it lands in the log at the moment it was flipped
    // rather than as a state dump at the end.
    logDebugEvent("setting", `${SETTING_LABELS[key] || key} turned ${value ? "on" : "off"}.`);
    window.dispatchEvent(new Event("mapSettings:updated"));
}

// ---------------------------------------------------------------------------
// The beta unit system: a PER-SAVE setting.
//
// It lives in the active save's game.json, not in localStorage, for three
// reasons the old storage could not give:
//   * it survives a restart of any build — the desktop beta and the stable app
//     share their saves but NOT their Chromium profile (electron/main.cjs), so
//     a localStorage flag silently reset every time a tester swapped builds;
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
// updatedAt (writeGameMeta on the server's runtime-JSON route), and re-sorting
// the library menu because someone looked at a save is worse than waiting for
// the first turn.
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
        // Pinned once per save, recorded once per save. Which unit system the
        // SESSION is running is not the same as which one the toggle currently
        // shows, and a bug report about units is unreadable without knowing the
        // first — so the report header carries the pinned value, taken here
        // where it is set.
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
