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

export const GameLoadingScreen = ({ gameName = "", scenarioName = "", countryName = "", phase = "world" }) => (
  <div
    className="oh-loading-screen"
    role="status"
    aria-live="polite"
    style={{
      alignItems: "center",
      background: "radial-gradient(circle at 50% 42%, #1d1d20 0%, #0c0c0e 68%)",
      color: "white",
      display: "flex",
      fontFamily: "sans-serif",
      inset: 0,
      justifyContent: "center",
      position: "fixed",
      // Above the settings workspace portal (2147483000): the globe is switched
      // from Settings → Map, and the redraw screen has to cover that too.
      zIndex: 2147483200,
    }}
  >
    <div style={{ padding: "1rem", textAlign: "center" }}>
      <img className="oh-loading-logo" src="/logo.png" alt="" style={{ height: "6.5rem", width: "6.5rem" }} />
      <div style={{ fontSize: "1.15rem", fontWeight: 900, letterSpacing: "0.02em", marginTop: "1.15rem" }}>
        {gameName || scenarioName || "Open Historia"}
      </div>
      {(scenarioName || countryName) && (
        <div data-no-translate style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.8rem", marginTop: "0.3rem" }}>
          {[scenarioName, countryName].filter(Boolean).join(" · ")}
        </div>
      )}
      <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.7rem", letterSpacing: "0.1em", marginTop: "1.25rem", textTransform: "uppercase" }}>
        {PHASES[phase] ?? PHASES.world}
      </div>
    </div>
  </div>
);

export default GameLoadingScreen;
