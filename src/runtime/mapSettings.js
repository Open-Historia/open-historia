/*! Open Historia — portions (map interaction/display settings) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Map interaction/display settings — localStorage-backed, same getter/setter
// pattern as src/Game/AI/providerConfig.js. Consumers subscribe via
// useMapSetting() below instead of receiving these as props threaded through
// GameUI/main.jsx, mirroring how useCountryDisplayName (polityNames.js) sits
// beside the data it subscribes to.
import { useEffect, useState, useSyncExternalStore } from "react";
import { logDebugEvent, logSettingChange } from "./debugLog.js";
import { isConstrainedDevice } from "./deviceProfile.js";
import { AI_TRANSLATION_SETTING } from "./aiTranslation.js";

// Immediate source of truth for string-valued settings. This also keeps a
// runtime override functional in privacy/file contexts where localStorage
// writes can be rejected.
const valueSettingMemory = new Map();

export const MAP_SETTING_KEYS = {
    // The player's default basemap, a built-in map every game starts on where
    // its scenario offers it, used while defaultBasemapOn is on. A game's own
    // pick is kept apart, per game (runtime/basemapPick.js).
    defaultBasemap: "map_basemap_default",
    defaultBasemapOn: "map_basemap_default_on",
    displayMode: "display_window_mode",
    mapMode: "map_mode",
    // Empty/unset means "use the scenario author's label font" (world.labelFont,
    // itself defaulting to Georgia). A family name here is a local, reversible
    // player override, like the default basemap above. It exists in
    // Settings as well as in the two editors because a label font you cannot
    // read is a reason to change it, and until now the only way to was through
    // the game editor.
    labelFont: "map_label_font",
    // Empty/unset shows a scenario's relief tiles when it ships them; "painted"
    // keeps its vector background only (Map/scenarioTerrain.js). Local to this
    // browser, like the default basemap.
    scenarioTerrain: "map_scenario_terrain",
    hideCountryLabels: "map_hide_country_labels",
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
    // The lookup functions (AI/lookupTools.js): the structured tasks declare
    // them beside their output function so the model can ask for exact names,
    // ids and ledgers before answering. ON by default — read with
    // getMapSettingDefaultOn, so an absent key means "on". A player whose
    // provider handles tool calls badly, or who wants the single cheaper
    // request per task, turns them off from Settings → AI.
    lookupFunctions: "ai_lookup_functions",
    // A skip's events on the Events panel as the model writes them
    // (AI/streamedEvents.js). ON by default; off leaves the skip behind the
    // Timeline panel's spinner.
    liveSkipEvents: "ai_live_skip_events",
    // A badge over the map that says whether an AI call is open, which task
    // and for how long, and how many the turn has made
    // (GameUI/AiActivityBadge.jsx, AI/requestTally.js). OFF by default — read
    // with getMapSetting, so an absent key means "off". Settings → AI.
    aiActivityBadge: "ai_activity_badge",
    // Countries writing to the player between time skips (AI/gameplay.js
    // maybeSendIdleDiplomacy). ON by default — read with
    // getMapSettingDefaultOn. Off, none is scheduled or sent. The scenario's
    // own idleDiplomacy feature still applies on top. On, it is outside the
    // background daily cap (AI/requestBudget.js UNCAPPED_BACKGROUND_TASKS).
    // Settings → AI → AI requests.
    idleDiplomacy: "ai_idle_diplomacy",
    // A skip whose player events were refused, or whose player orders got no
    // outcome, is held for the player to retry (AI/playerTurnFailures.js). OFF
    // by default: the skip lands and the orders carry over as overdue.
    stopOnPlayerFailures: "ai_stop_on_player_failures",
    // Discord's "Playing Open Historia" with the country, the scenario and the
    // in-game date under it (runtime/discordPresence.js; the desktop app and
    // the local server only). ON by default — read with
    // getMapSettingDefaultOn. Off, the page reports nothing and takes down
    // what Discord is showing. Settings → General → Privacy.
    discordPresence: "privacy_discord_presence",
    // The game's music (runtime/ambientMusic.js). ON by default — read with
    // getMapSettingDefaultOn. Settings → General → Sound.
    ambientMusic: "audio_ambient_music",
    // Its volume, 0 to 100, as the slider shows it; absent is the default
    // (ambientMusic.js DEFAULT_MUSIC_VOLUME).
    musicVolume: "audio_music_volume",
    // The game's own sound effects: the vault door the app opens on
    // (runtime/vaultSounds.js). ON by default — read with
    // getMapSettingDefaultOn. Settings → General → Sound. (The chat's chime
    // has a switch of its own, in the chat.)
    soundEffects: "audio_sound_effects",
    // Whether the vault door the app opens on (GameUI/VaultDoor.jsx) shows every
    // time the game opens. OFF by default — read with getMapSetting
    // (vaultDoorAlways): off, the door shows the first time the game opens
    // after an update (runtime/vaultDoorDue.js; the owner, 2026-10-14: "vault
    // door by default only after a new update, setting to make it always when
    // opening game"). Settings → General → Display. It is the door's only
    // switch: "remove the Vault door at start setting, just have the Every
    // time the game opens setting" (the owner, 2026-10-16).
    vaultDoorAlways: "vault_door_every_time",
    // The seasons and the weather on the map (Map/SeasonLayers.jsx,
    // FrontWeatherLayers.jsx): the season's tint over the whole map and the
    // weather. ON by
    // default — read with getMapSettingDefaultOn (useMapSettingDefaultOn).
    // Frozen water is drawn as ice either way: troops cross it. Settings → Map.
    seasonsWeather: "map_seasons_weather",
    // The weather's patterns alone (Map/FrontWeatherLayers.jsx): "add a
    // setting to turn off the visual weather effects" (the owner, 2026-10-14).
    // ON by default, and only while Seasons and weather is on; off, the
    // season's tint and the ice stay. Settings → Map.
    weatherEffects: "map_weather_effects",
    // Translate with my AI (runtime/aiTranslation.js): what the translation
    // model would translate goes to the player's AI provider instead. OFF by
    // default — read with getMapSetting — and offered only in a language whose
    // model the player downloaded. Settings → General → Language.
    translateWithAi: AI_TRANSLATION_SETTING,
};

// Kept for the sitting only, never on the device: whichever map was last shown,
// the game opens on the political map. "its opening onto the diplomatic map by
// default, it should be on political be default" (the owner, 2026-10-16).
export const SITTING_ONLY_SETTINGS = Object.freeze([MAP_SETTING_KEYS.mapMode]);
// (What an earlier build kept of them on the device is let go.)
try {
    for (const key of SITTING_ONLY_SETTINGS) globalThis.localStorage?.removeItem?.(key);
} catch { /* nothing kept, or nothing to keep it in */ }

// Families the label-font pickers suggest — Settings → Map and the game and
// scenario editors, one list. Suggestions only: labels rasterize from the
// player's own fonts, so any installed family works.
export const LABEL_FONT_SUGGESTIONS = Object.freeze([
    "Georgia", "Times New Roman", "Garamond", "Palatino Linotype", "Impact",
    "Arial Black", "Arial", "Trebuchet MS", "Verdana", "Courier New", "Comic Sans MS",
]);

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
// lookupFunctions, liveSkipEvents, idleDiplomacy, discordPresence,
// ambientMusic, soundEffects, seasonsWeather and weatherEffects ship on;
// limitAiGeneration and chunkLongJumps, which used to, went default-off in the
// beta.
const OFF_IN_LOW_MEMORY = new Set([MAP_SETTING_KEYS.weatherEffects]);

export function getMapSettingDefaultOn(key) {
    if (typeof localStorage === "undefined") return true;
    const stored = localStorage.getItem(key);
    if (stored === null && OFF_IN_LOW_MEMORY.has(key) && isConstrainedDevice()) return false;
    return stored !== "0";
}

// Whether the door shows every time the game opens rather than the first time
// after an update (off unless the player turned it on).
export const vaultDoorAlways = () => {
    try {
        return getMapSetting(MAP_SETTING_KEYS.vaultDoorAlways);
    } catch {
        return false;
    }
};

// Storage keys are what the game persists; they are not what a maintainer wants
// to read in a bug report. Kept beside MAP_SETTING_KEYS so a new setting that
// forgets to add a name still logs its key rather than nothing.
const SETTING_LABELS = {
    [MAP_SETTING_KEYS.hideCountryLabels]: "Hide country labels",
    [MAP_SETTING_KEYS.disableIdleRotation]: "Disable idle globe rotation",
    [MAP_SETTING_KEYS.disableEventCamera]: "Disable camera movement during events",
    [MAP_SETTING_KEYS.limitAiGeneration]: "Limit AI generation",
    [MAP_SETTING_KEYS.batchBackgroundTasks]: "Batch background AI tasks",
    [MAP_SETTING_KEYS.chunkLongJumps]: "Generate long time skips in segments",
    [MAP_SETTING_KEYS.lookupFunctions]: "AI lookup functions",
    [MAP_SETTING_KEYS.liveSkipEvents]: "Show time skip events as they are written",
    [MAP_SETTING_KEYS.aiActivityBadge]: "Show AI activity on the map",
    [MAP_SETTING_KEYS.idleDiplomacy]: "Countries write to me between time skips",
    [MAP_SETTING_KEYS.stopOnPlayerFailures]: "Stop when my events fail",
    [MAP_SETTING_KEYS.discordPresence]: "Show what I am playing on Discord",
    [MAP_SETTING_KEYS.ambientMusic]: "Music",
    [MAP_SETTING_KEYS.soundEffects]: "Sound effects",
    // "Every time the game opens" in the panel; named in full here, where the
    // log line stands alone.
    [MAP_SETTING_KEYS.vaultDoorAlways]: "Vault door every time the game opens",
    [MAP_SETTING_KEYS.seasonsWeather]: "Seasons and weather",
    [MAP_SETTING_KEYS.weatherEffects]: "Weather effects",
    [MAP_SETTING_KEYS.defaultBasemapOn]: "Use my default basemap",
    [MAP_SETTING_KEYS.translateWithAi]: "Translate with my AI",
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
    if (SITTING_ONLY_SETTINGS.includes(key)) return fallback;
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value;
    } catch {
        return fallback;
    }
}

// The value settings' names in the diagnostics log, as the Settings panel shows
// them; an empty value is the scenario author's choice.
const VALUE_SETTING_LABELS = {
    [MAP_SETTING_KEYS.defaultBasemap]: "Default basemap",
    [MAP_SETTING_KEYS.labelFont]: "Label font",
    [MAP_SETTING_KEYS.musicVolume]: "Music volume",
    [MAP_SETTING_KEYS.scenarioTerrain]: "Scenario terrain",
};

export function setMapSettingValue(key, value) {
    const normalized = String(value ?? "").trim();
    // Logged once it settles: the label font is typed, and saves per keystroke.
    if (normalized !== getMapSettingValue(key, "")) {
        logSettingChange(VALUE_SETTING_LABELS[key] || key, normalized || "scenario default", { settle: true });
    }
    valueSettingMemory.set(key, normalized);
    try {
        if (normalized && !SITTING_ONLY_SETTINGS.includes(key)) localStorage.setItem(key, normalized);
        else localStorage.removeItem(key);
    } catch {
        // The live in-memory setting still applies for this session.
    }
    window.dispatchEvent(new CustomEvent("mapSettings:updated", {
        detail: { key, value: normalized },
    }));
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

// The same subscription for a setting that ships ON (getMapSettingDefaultOn):
// useMapSetting would read its absent key as off.
const subscribeMapSettings = (notify) => {
    window.addEventListener("mapSettings:updated", notify);
    return () => window.removeEventListener("mapSettings:updated", notify);
};
export function useMapSettingDefaultOn(key) {
    return useSyncExternalStore(subscribeMapSettings, () => getMapSettingDefaultOn(key), () => true);
}

// The operating system's own reduced-motion setting. While it is on, the game
// behaves as if its Reduce motion switch (Settings → General, both motion
// switches below it) were on — no idle globe spin, no event camera, no
// ownership sweep — and the switch shows as on, following it.
export const SYSTEM_REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function systemPrefersReducedMotion() {
    try {
        return Boolean(globalThis.window?.matchMedia?.(SYSTEM_REDUCED_MOTION_QUERY)?.matches);
    } catch {
        return false;
    }
}

// The Reduce motion switch in force, read when an animation is about to start:
// the player's (both motion switches on) or the system's.
export function reduceMotionEnabled() {
    return systemPrefersReducedMotion()
        || (getMapSetting(MAP_SETTING_KEYS.disableIdleRotation) && getMapSetting(MAP_SETTING_KEYS.disableEventCamera));
}

export function useSystemReducedMotion() {
    const [value, setValue] = useState(systemPrefersReducedMotion);

    useEffect(() => {
        const query = globalThis.window?.matchMedia?.(SYSTEM_REDUCED_MOTION_QUERY);
        const onChange = () => setValue(systemPrefersReducedMotion());
        onChange();
        if (!query) return undefined;
        if (query.addEventListener) query.addEventListener("change", onChange);
        else query.addListener?.(onChange);
        return () => {
            if (query.removeEventListener) query.removeEventListener("change", onChange);
            else query.removeListener?.(onChange);
        };
    }, []);

    return value;
}

// One motion switch (disableIdleRotation, disableEventCamera) in force: the
// player turned it on, or the system asks for reduced motion.
export function useMotionSetting(key) {
    const own = useMapSetting(key);
    const system = useSystemReducedMotion();
    return own || system;
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
