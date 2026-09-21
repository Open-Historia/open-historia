import React, { useEffect, useRef, useState } from "react";
import { useWorldState } from "../Map/useWorldState.js";
import {
  GAME_OPENING_EVENT,
  MAP_IDLE_EVENT,
  MAP_POLITIES_READY_EVENT,
  politiesReady,
  politiesSettled,
} from "../../runtime/mapReadiness.js";

// The screen a game opens under: the logo turning over a dark ground until the
// map has read the world, derived and drawn its borders and labels, and gone
// idle. Opening a game remounts the map and this UI (App.jsx keys both by the
// active game), so the hook starts fresh for every game. It comes up the moment
// the library starts opening a game (oh:game-opening, while the old UI is
// still mounted), stays until the polity layers are in for this game AND the
// map has gone idle since (runtime/mapReadiness.js stamps every mark with the
// game it was made for), and a hard ceiling makes sure a derivation that never
// answers cannot keep the player out.
const PHASES = {
  world: "Reading the world…",
  polities: "Drawing borders and labels…",
  settling: "Settling the map…",
  done: "",
};
const LOADING_CEILING_MS = 60000;

export const useGameLoading = () => {
  const { worldKnown } = useWorldState();
  const [phase, setPhase] = useState(() => (worldKnown && politiesSettled() ? "done" : "world"));
  const knownRef = useRef(worldKnown);
  useEffect(() => {
    knownRef.current = worldKnown;
  }, [worldKnown]);

  useEffect(() => {
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
  }, []);

  // The world store hydrating is a signal too: a stock map is ready the moment
  // it is known to be one.
  useEffect(() => {
    if (!worldKnown || phase === "done") return undefined;
    const timer = setTimeout(() => {
      if (politiesSettled()) setPhase("done");
      else if (politiesReady()) setPhase((current) => (current === "done" ? current : "settling"));
    }, 0);
    return () => clearTimeout(timer);
  }, [phase, worldKnown]);

  return { active: phase !== "done", phase };
};

// The card image the library shows for a scenario with no cover of its own
// (libraryBar.jsx DEFAULT_SCENARIO_COVER): the screen keeps the same shape
// whether or not the scenario brought a picture.
const DEFAULT_COVER = "/scenario-placeholder.png";
const textShadow = "0 2px 14px rgba(0,0,0,0.7)";

// The scenario's cover, full bleed, with the logo turning in the bottom corner
// and the name and status beside it. The gradient darkens only the bottom, so
// the picture is the screen and the strip under it stays legible whatever the
// picture is.
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
        background: "linear-gradient(180deg, rgba(8,8,10,0.22) 0%, rgba(8,8,10,0.08) 40%, rgba(8,8,10,0.86) 100%), "
          + `url("${String(coverUrl || DEFAULT_COVER).replaceAll('"', "%22")}") center/cover no-repeat, `
          + `url("${DEFAULT_COVER}") center/cover no-repeat #0c0c0e`,
        inset: 0,
        position: "absolute",
      }}
    />
    <div
      style={{
        alignItems: "flex-end",
        bottom: 0,
        display: "flex",
        gap: "1.5rem",
        justifyContent: "space-between",
        left: 0,
        padding: "1.75rem 2rem",
        position: "absolute",
        right: 0,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "1.35rem", fontWeight: 900, letterSpacing: "0.02em", textShadow }}>
          {gameName || scenarioName || "Open Historia"}
        </div>
        {(scenarioName || countryName) && (
          <div data-no-translate style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.85rem", marginTop: "0.3rem", textShadow }}>
            {[scenarioName, countryName].filter(Boolean).join(" · ")}
          </div>
        )}
        <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.7rem", letterSpacing: "0.1em", marginTop: "0.9rem", textShadow, textTransform: "uppercase" }}>
          {PHASES[phase] ?? PHASES.world}
        </div>
      </div>
      <img className="oh-loading-logo" src="/logo.png" alt="" style={{ flexShrink: 0, height: "4rem", width: "4rem" }} />
    </div>
  </div>
);

export default GameLoadingScreen;
