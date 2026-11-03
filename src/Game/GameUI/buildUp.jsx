/*! Open Historia — a country's forces built up at home, from its own Stats © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "lets design a whole system so you can build up forces and strengthen and
// gather troops before any war or conflict is happening yet"; "building up
// forces shouldnt happen on a border, it should just happen in your country
// around cities. you can them move them with war room tools to a border" (the
// owner, 2026-11-02). On the player's own country's Diplomacy tab, while the
// game fights its land wars on battlefields: its forces called up at home,
// round its cities (Game/AI/gameplay.js buildUpForces; runtime/fronts/home.js),
// and the War Room opened on them to move them with (GameUI/main.jsx listens).

import React, { useState } from "react";
import { activeWars, useActiveFeatures } from "../../runtime/gameFeatures.js";
import { decodeTroops } from "../../runtime/fronts/codec.js";
import { buildUpForces } from "../AI/gameplayLazy.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLowerCase();
const list = (value) => (Array.isArray(value) ? value : []);

const openWarRoom = () => window.dispatchEvent(new CustomEvent("oh:open-war-room"));

const buttonStyle = (busy) => ({
  background: "none",
  border: "1px solid rgba(43,193,243,0.55)",
  borderRadius: "6px",
  color: "#2bc1f3",
  cursor: busy ? "default" : "pointer",
  font: "inherit",
  fontSize: "0.66rem",
  fontWeight: 750,
  marginRight: "0.4rem",
  marginTop: "0.35rem",
  opacity: busy ? 0.6 : 1,
  padding: "0.32rem 0.6rem",
});

//   world    the world as the Stats pane reads it
//   viewer   the player's country; target, the country the tab is of: shown only where they are the same
//   style    the card it is drawn in
export const BuildUpControl = ({ world, viewer, target, style }) => {
  useActiveFeatures();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const player = clean(viewer);
  if (!activeWars().battlefields || !player || fold(player) !== fold(target)) return null;
  // (Its forces at home: the record that is, of the player's country: runtime/fronts/home.js.)
  const home = list(world?.battlefields).find((row) => row?.home === true && row.status !== "closed" && fold(row.sides?.[0]?.[0]) === fold(player));
  const formations = home && typeof home.troops?.[0] === "string" ? decodeTroops(home.troops[0]).filter((troop) => troop.strength > 0).length : 0;
  const buildUp = async () => {
    setBusy(true);
    setSaid("");
    try {
      const why = await buildUpForces();
      if (why) setSaid(why);
      else openWarRoom();
    } catch {
      setSaid("Your forces could not be called up.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={style} data-oh-build-up="">
      <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.72rem", fontWeight: 800 }}>Forces at home</div>
      {formations > 0 ? (
        <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.63rem", marginTop: "0.2rem" }}>
          {formations === 1 ? <>1 formation at home</> : <><span data-no-translate>{formations}</span> formations at home</>}
        </div>
      ) : null}
      <div>
        <button type="button" className="oh-tap-row" disabled={busy} onClick={buildUp} style={buttonStyle(busy)}>
          {busy ? <>Calling up…</> : formations > 0 ? <>Call up more</> : <>Build up forces</>}
        </button>
        {formations > 0 ? <button type="button" className="oh-tap-row" onClick={openWarRoom} style={buttonStyle(false)}>Open the War Room</button> : null}
      </div>
      {said ? <div style={{ color: "rgba(255,255,255,0.58)", fontSize: "0.63rem", marginTop: "0.3rem" }}>{said}</div> : null}
    </div>
  );
};
