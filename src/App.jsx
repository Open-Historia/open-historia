/*! Open Historia — portions (standalone map-editor mode) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import UI from "./Game/GameUI/main.jsx";

// Lazy so OpenLayers is only fetched when the editor is actually opened.
const MapEditor = lazy(() => import("./Editor/MapEditor.jsx"));
// A shared game's lobby and round bar (multiplayer/): outside the game's UI, so
// it survives the UI remounting when the page switches to the shared game.
const SharedGameOverlay = lazy(() => import("./multiplayer/ui/SharedGameOverlay.jsx"));
const DiscordInvites = lazy(() => import("./multiplayer/ui/DiscordInvites.jsx"));
// Lazy too: the map and MapLibre with it (over 1 MB) are fetched and parsed
// only when a game is opened (runtime/gameEntry.js), never for the main menu,
// and the editor never loads them. Nothing outside Game/Map imports maplibre-gl.
const WorldMap = lazy(() => import("./Game/Map/World.jsx"));
// What the update brings, behind the vault door (Game/GameUI/updates/): loaded only when there is one to show.
const UpdateNotice = lazy(() => import("./Game/GameUI/updates/UpdateNotice.jsx"));
import StartupScreen from "./runtime/StartupScreen.jsx";
import ErrorBoundary from "./runtime/ErrorBoundary.jsx";
import AppUpdateBanner from "./runtime/AppUpdateBanner.jsx";
import {
  STARTUP_TIME_BUDGET_MS,
  createMenuStartupState,
  runStartupPreload,
} from "./runtime/preload.js";
import { ensureLibraryCatalog, useLibraryState } from "./runtime/library.js";
import { hasEnteredGame, useGameEntered } from "./runtime/gameEntry.js";
import { VaultDoor } from "./Game/GameUI/VaultDoor.jsx";
import { holdMusicBehindDoor } from "./runtime/ambientMusic.js";
import { vaultDoorAlways } from "./runtime/mapSettings.js";
import { decideVaultDoor, rememberVaultDoorBuild } from "./runtime/vaultDoorDue.js";
import { pendingUpdates, previewedUpdates, rememberUpdate } from "./Game/GameUI/updates/updateNotices.js";
import { appBuildId } from "./runtime/buildId.js";
import { announceMapRerender } from "./runtime/mapReadiness.js";
import { prefetchGameplay } from "./Game/AI/gameplayLazy.js";
import { isConstrainedDevice } from "./runtime/deviceProfile.js";

const WorldShell = {
  backgroundColor: "#000",
  position: "fixed",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  touchAction: "none",
};

// The vault door is an ornament, and the main menu is behind it: should the
// door ever fail to draw, it is taken away and the menu is simply there,
// rather than the whole page going to the error screen with the menu shut in.
class DoorFrame extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn("The vault door could not be drawn:", error);
    this.props.onFailed?.();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function GameApp() {
  const mapRef = useRef(null);
  const worldIdleRef = useRef(false);
  const [startupState] = useState(createMenuStartupState);
  const [isReady, setIsReady] = useState(false);
  // The page starts on the main menu with no game loaded behind it: no map,
  // none of a game's regions, tiles, borders or labels. The map is mounted when
  // the player opens a game (runtime/gameEntry.js says who counts as opening
  // one), and from then on stays, as it always has, behind a menu gone back to.
  const gameEntered = useGameEntered();
  // What the player meets once the startup screen is done: a vault door, shut
  // over the main menu, to be opened by its wheel (GameUI/VaultDoor.jsx). The
  // menu's music waits behind it and begins as the leaves part. Once a page:
  // going back to the menu from a game does not shut it again.
  //
  // It shows the first time the game opens after an update, or at every
  // opening with Every time the game opens on (runtime/vaultDoorDue.js), so
  // whether this opening is one is decided first ("deciding"): the running
  // build is asked of the desktop app's own server (runtime/buildId.js), and
  // the music is held meanwhile.
  const [door, setDoor] = useState(() => {
    holdMusicBehindDoor(true);
    return "deciding";
  });
  // The build the door is shown for, kept when it has opened.
  const doorBuildRef = useRef("");
  useEffect(() => {
    if (door !== "deciding") return undefined;
    let live = true;
    decideVaultDoor({
      always: vaultDoorAlways(),
      resolveBuild: () => appBuildId({ env: import.meta.env }),
    })
      .catch(() => ({ show: false, build: "" }))
      .then(({ show, build }) => {
        if (!live) return;
        doorBuildRef.current = build;
        // Not this time: there is nothing for the music to wait behind.
        if (!show) holdMusicBehindDoor(false);
        setDoor(show ? "shut" : "open");
      });
    return () => {
      live = false;
    };
  }, [door]);
  // What the update brings (Game/GameUI/updates/notes.js): each new update once a device, behind the door, so
  // the door opens onto it; shown as the leaves part (or at once, with the door off). ?updateNotice=<id> shows
  // one whatever was seen, and keeps nothing.
  const [notice, setNotice] = useState(() => {
    const asked = typeof window === "undefined" ? null : previewedUpdates(window.location.search);
    return asked ? { updates: asked, preview: true } : { updates: pendingUpdates(), preview: false };
  });
  const [parting, setParting] = useState(false);
  const closeNotice = useCallback(() => setNotice((now) => ({ updates: [], preview: now.preview })), []);
  const letMusicIn = useCallback(() => {
    setParting(true);
    holdMusicBehindDoor(false);
  }, []);
  const doorGone = useCallback(() => {
    holdMusicBehindDoor(false);
    setDoor("open");
  }, []);
  // Opened: not shown again for this build. A door that could not be drawn,
  // or a page closed before the door opened, is shown again next time.
  const doorOpened = useCallback(() => {
    rememberVaultDoorBuild(doorBuildRef.current);
    doorGone();
  }, [doorGone]);
  const [isGlobeEnabled, setIsGlobeEnabled] = useState(() => {
    const saved = localStorage.getItem("Globe");
    return saved !== null ? JSON.parse(saved) : false;
  });
  const [isTerrainEnabled, setIsTerrainEnabled] = useState(() => {
    const saved = localStorage.getItem("Terrain");
    if (saved !== null) return JSON.parse(saved);
    // Terrain is the map's most memory-hungry option: off to start with on the
    // devices the rest of the map treats as short of memory (deviceProfile.js).
    return !isConstrainedDevice();
  });
  // Key the map/UI on the active GAME id, not the library token. The token also
  // bumps on scenario/asset writes, so Apply & Play (which saves the scenario and
  // uploads several assets before activating the new game) would otherwise remount
  // the map ~8 times — the repeated flashing/reloading. The game id changes once,
  // when the new game activates, so the map remounts exactly once.
  const { activeGameId } = useLibraryState();

  // Switching the globe on or off replaces the map instance (World.jsx keys it
  // on the projection): a full redraw of the world, covered by the same opening
  // screen a game gets. Announced BEFORE the state changes, so the new
  // instance's readiness marks land after the reset rather than under it.
  const globeRef = useRef(isGlobeEnabled);
  useEffect(() => {
    globeRef.current = isGlobeEnabled;
  }, [isGlobeEnabled]);
  const setGlobeEnabled = useCallback((next) => {
    const value = typeof next === "function" ? next(globeRef.current) : Boolean(next);
    // Switched from the main menu's Settings before any game was opened, there
    // is no map to redraw and nothing for the opening screen to cover.
    if (value !== globeRef.current && hasEnteredGame()) announceMapRerender();
    setIsGlobeEnabled(value);
  }, []);

  useEffect(() => {
    localStorage.setItem("Globe", JSON.stringify(isGlobeEnabled));
  }, [isGlobeEnabled]);

  useEffect(() => {
    localStorage.setItem("Terrain", JSON.stringify(isTerrainEnabled));
  }, [isTerrainEnabled]);

  // The startup screen ends when the main menu has what it needs, which is the
  // list of games and scenarios and nothing else. It used to wait for the
  // active game's warm-ups and for its world to be drawn as well; no world is
  // drawn at startup any more. A catalog that cannot be read ends it too (the
  // menu says so, and asks again), and so does the time budget, should the
  // request never answer.
  useEffect(() => {
    let isActive = true;
    const ceiling = setTimeout(() => {
      if (isActive) setIsReady(true);
    }, STARTUP_TIME_BUDGET_MS);

    ensureLibraryCatalog()
      .catch((error) => {
        console.warn("Failed to load library catalog at startup:", error);
      })
      .finally(() => {
        if (isActive) setIsReady(true);
      });

    return () => {
      isActive = false;
      clearTimeout(ceiling);
    };
  }, []);

  // A game's warm-ups (runtime/preload.js: its documents, the first map
  // textures, the city and border archives) start with the first game opened
  // rather than with the page, once a page. Nothing waits for them and nothing
  // shows them: the cover a game opens under is held by the map itself
  // (runtime/mapReadiness.js), which draws correctly with or without a warm-up.
  useEffect(() => {
    if (!gameEntered) return;
    runStartupPreload().catch((error) => {
      console.warn("The game's preload failed:", error);
    });
  }, [gameEntered]);

  // The startup screen waits for the door to be decided as well, so the menu
  // never shows for a moment before a door shuts over it. The decision takes
  // no time on the website and in the Android app, and one request to this
  // computer's own server in the desktop app (at most a second and a half).
  const menuReady = isReady && door !== "deciding";
  // What the update brings is shown once the menu is ready and the door is open or opening; it is kept as shown the
  // moment it is shown, not when it is closed, so a page closed on it does not show it again.
  const noticeShown = menuReady && notice.updates.length > 0 && (door === "open" || parting);
  useEffect(() => {
    if (noticeShown && !notice.preview) rememberUpdate(notice.updates[0].id);
  }, [noticeShown, notice]);

  const handleFirstWorldIdle = () => {
    if (worldIdleRef.current) return;
    worldIdleRef.current = true;

    // Warm the AI chunk now that the map has settled, so the player's first turn
    // pays for the turn and not for the download too.
    prefetchGameplay();
  };

  return (
    <>
    <div style={WorldShell}>
    {gameEntered && (
      <Suspense fallback={null}>
      <WorldMap
      key={`map-${activeGameId || "default"}`}
      mapRef={mapRef}
      projection={isGlobeEnabled ? "globe" : "mercator"}
      terrainEnabled={isTerrainEnabled}
      onInitialIdle={handleFirstWorldIdle}
      />
      </Suspense>
    )}
    </div>
    {menuReady && (
      <UI
      key={`ui-${activeGameId || "default"}`}
      isGlobeEnabled={isGlobeEnabled}
      isTerrainEnabled={isTerrainEnabled}
      mapRef={mapRef}
      setIsGlobeEnabled={setGlobeEnabled}
      setIsTerrainEnabled={setIsTerrainEnabled}
      />
    )}
    {noticeShown && (
      <Suspense fallback={null}>
      <UpdateNotice updates={notice.updates} onClose={closeNotice} />
      </Suspense>
    )}
    {menuReady && door === "shut" && (
      <DoorFrame onFailed={doorGone}>
      <VaultDoor onOpening={letMusicIn} onOpened={doorOpened} />
      </DoorFrame>
    )}
    {!menuReady && <StartupScreen {...startupState} />}
    </>
  );
}

// Standalone modes are isolated behind URL flags so the real game is untouched:
//   ?editor=1  -> the OpenLayers map editor (author custom maps)
// Flags are read once at render time, so hook order stays consistent.
function App() {
  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  if (params.has("editor")) {
    return (
      <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#111113" }} />}>
        <MapEditor />
      </Suspense>
    );
  }
  // Wrap the game view (not the editor route, which has its own Suspense fallback)
  // so a render/lifecycle throw in the map, UI or panels shows a recoverable Reload
  // screen instead of unmounting to a blank page. Wrapping <GameApp/> at this level
  // (rather than inside GameApp's return) also catches GameApp's own render throws.
  return (
    <>
      <AppUpdateBanner />
      <ErrorBoundary>
        <GameApp />
      </ErrorBoundary>
      <Suspense fallback={null}>
        <SharedGameOverlay />
        <DiscordInvites />
      </Suspense>
    </>
  );
}

export default App;
