import React, { useEffect, useRef, useState } from "react";
import { useWorldState } from "../Map/useWorldState.js";
import { SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT } from "../../runtime/mobileUi.js";
import {
  GAME_OPENING_EVENT,
  MAP_IDLE_EVENT,
  MAP_POLITIES_READY_EVENT,
  politiesReady,
  politiesSettled,
} from "../../runtime/mapReadiness.js";
import { useGameEntered } from "../../runtime/gameEntry.js";

// The screen a game opens under: the logo turning over a dark ground until the
// map has read the world, derived and drawn its borders and labels, and gone
// idle. Opening a game remounts the map and this UI (App.jsx keys both by the
// active game), so the hook starts fresh for every game. It comes up the moment
// the library starts opening a game (oh:game-opening, while the old UI is
// still mounted), stays until the polity layers are in for this game AND the
// map has gone idle since (runtime/mapReadiness.js stamps every mark with the
// game it was made for), and a hard ceiling makes sure a derivation that never
// answers cannot keep the player out.
//
// Nothing is opening until the player has opened a game (runtime/gameEntry.js):
// the page starts on the main menu with no map behind it, and this UI is
// mounted there all the same. So the wait starts when a game is entered, not
// when the hook mounts, and so does its ceiling: armed at mount, it would have
// run out under somebody who sat on the menu for a minute, and their first
// game would have opened with no cover at all.
const PHASES = {
  world: "Reading the world…",
  polities: "Drawing borders and labels…",
  settling: "Settling the map…",
  done: "",
};
export const LOADING_CEILING_MS = 60000;

export const useGameLoading = () => {
  const entered = useGameEntered();
  const { worldKnown } = useWorldState({ wait: !entered });
  const [phase, setPhase] = useState(() => (worldKnown && politiesSettled() ? "done" : "world"));
  const knownRef = useRef(worldKnown);
  useEffect(() => {
    knownRef.current = worldKnown;
  }, [worldKnown]);

  useEffect(() => {
    if (!entered) return undefined;
    let settled = false;
    const timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    const finish = () => {
      if (settled) return;
      settled = true;
      setPhase("done");
    };
    const check = () => {
      if (settled || !knownRef.current) return;
      if (politiesSettled()) finish();
      else if (politiesReady()) setPhase((current) => (current === "done" ? current : "settling"));
    };
    // The status line moves on its own after a moment; the world read is quick.
    // Armed on every opening, so a redraw (the globe switched) gets its own
    // ceiling rather than whatever was left of the first one's.
    const arm = () => {
      later(() => setPhase((current) => (current === "world" ? "polities" : current)), 1200);
      later(finish, LOADING_CEILING_MS);
    };
    const reopen = () => {
      settled = false;
      timers.splice(0).forEach(clearTimeout);
      setPhase("world");
      arm();
      later(check, 0);
    };
    window.addEventListener(MAP_POLITIES_READY_EVENT, check);
    window.addEventListener(MAP_IDLE_EVENT, check);
    window.addEventListener(GAME_OPENING_EVENT, reopen);
    arm();
    // Deferred so signals that already fired are handled like live ones.
    later(check, 0);
    return () => {
      window.removeEventListener(MAP_POLITIES_READY_EVENT, check);
      window.removeEventListener(MAP_IDLE_EVENT, check);
      window.removeEventListener(GAME_OPENING_EVENT, reopen);
      timers.forEach(clearTimeout);
    };
  }, [entered]);

  // The world store hydrating is a signal too: a stock map is ready the moment
  // it is known to be one.
  useEffect(() => {
    if (!entered || !worldKnown || phase === "done") return undefined;
    const timer = setTimeout(() => {
      if (politiesSettled()) setPhase("done");
      else if (politiesReady()) setPhase((current) => (current === "done" ? current : "settling"));
    }, 0);
    return () => clearTimeout(timer);
  }, [entered, phase, worldKnown]);

  // Before a game is entered there is no map to wait for. (The cover is up all
  // the same between a press of Play and the game landing: GameUI/main.jsx
  // `awaitingGame`.)
  return { active: entered && phase !== "done", phase };
};

// The card image the library shows for a scenario with no cover of its own
// (libraryBar.jsx DEFAULT_SCENARIO_COVER): the screen keeps the same shape
// whether or not the scenario brought a picture.
const DEFAULT_COVER = "/scenario-placeholder.webp";
const textShadow = "0 2px 14px rgba(0,0,0,0.7)";

// The scenario's cover, full bleed, with the logo turning in the bottom corner
// and the name and status beside it on a flat dark strip: the picture is the
// screen, and the strip stays legible whatever the picture is.
export const GameLoadingScreen = ({ gameName = "", scenarioName = "", countryName = "", coverUrl = "", phase = "world" }) => (
  <div
    className="oh-loading-screen"
    role="status"
    aria-live="polite"
    style={{
      background: "#0c0c0e",
      color: "white",
      fontFamily: "sans-serif",
      inset: 0,
      overflow: "hidden",
      position: "fixed",
      // Above the settings workspace portal (2147483000): the globe is switched
      // from Settings → Map, and the redraw screen has to cover that too.
      zIndex: 2147483200,
    }}
  >
    <div
      aria-hidden="true"
      style={{
        background: `url("${String(coverUrl || DEFAULT_COVER).replaceAll('"', "%22")}") center/cover no-repeat, `
          + `url("${DEFAULT_COVER}") center/cover no-repeat #0c0c0e`,
        inset: 0,
        position: "absolute",
      }}
    />
    <div
      style={{
        alignItems: "flex-end",
        background: "rgba(8,8,10,0.8)",
        bottom: 0,
        display: "flex",
        gap: "1.5rem",
        justifyContent: "space-between",
        left: 0,
        // Clear of a phone's home indicator, and of the notch when it is
        // turned sideways (all 0 on a desktop).
        padding: `1.25rem calc(2rem + ${SAFE_RIGHT}) calc(1.5rem + ${SAFE_BOTTOM}) calc(2rem + ${SAFE_LEFT})`,
        position: "absolute",
        right: 0,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "1.35rem", fontWeight: 900, letterSpacing: "0.02em", textShadow }}>
          {gameName || scenarioName || "Open Historia"}
        </div>
        {(scenarioName || countryName) && (
          <div style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.85rem", marginTop: "0.3rem", textShadow }}>
            {[scenarioName, countryName].filter(Boolean).join(" · ")}
          </div>
        )}
        <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.7rem", letterSpacing: "0.1em", marginTop: "0.9rem", textShadow, textTransform: "uppercase" }}>
          {PHASES[phase] ?? PHASES.world}        </div>
      </div>
      <img className="oh-loading-logo" src="/logo.png" alt="" style={{ flexShrink: 0, height: "4rem", width: "4rem" }} />
    </div>
  </div>
);

export default GameLoadingScreen;
