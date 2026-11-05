/*! Open Historia — the war room: the days ahead rehearsed © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "'Rehearse my plan' in the War Room. It would run your drawn orders a few
// days ahead on a copy of the battle, using the commander's own machinery, and
// show the projected front as a faint overlay. You'd learn strategy by trying
// it" (the owner's list, 2026-10-16).
//
// A week of the land war is fought ahead of time with the orders as they stand
// (AI/gameplay.js warRoomRehearse), exactly as the next skip would fight it
// before its story: the other side's staff thinks as it will, the weather is
// the weather that will come. Nothing is written. The map shades what the
// player's side would gain and lose (Map/warRoomCells.js, drawn by
// Map/WarRoomLayers.jsx); here, what it comes to. The staff's looks it made
// are kept, so the skip that fights those days has them again
// (AI/frontPrethink.js has the rest thought through once it is done).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { warRoomRehearse } from "../AI/gameplayLazy.js";
import { scheduleFrontsPrethink, stopFrontsPrethink } from "../AI/frontPrethink.js";
import { setWarRoom } from "../Map/warRoomStore.js";
import { rehearsalShading } from "../Map/warRoomCells.js";
import { foldBattlefieldName, normalizeBattlefield } from "../../runtime/fronts/record.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { AMBER, BONE, BONE_SOFT, keyStyle, linkStyle, trayStyle } from "./warRoomTheme.js";

// How far ahead it looks: a week.
export const REHEARSAL_DAYS = 7;

const softText = { color: BONE_SOFT, fontSize: "0.72rem", lineHeight: 1.4 };
const asArray = (value) => (Array.isArray(value) ? value : []);
const placeOf = (text) => String(text ?? "").replace(/^[a-z]+:\s*/i, "");

// What the orders as they stand are, for knowing a rehearsal of them is out of date.
export const ordersKeyOf = (record, gameDate) => JSON.stringify([
  String(gameDate ?? ""),
  asArray(record?.orders),
  record?.brief?.carry?.plans ?? null,
  record?.brief?.carry?.deploy ?? null,
  record?.brief?.carry?.away ?? null,
]);

// What a rehearsal came to for the player's `side`: the ground, the towns, the troops.
export const rehearsalSummary = (before, after, side) => {
  const shaded = rehearsalShading(before, after, side);
  const strength = (record, at) => record?.brief?.strength?.[at] ?? null;
  return {
    data: shaded.data,
    gainedKm2: shaded.gainedKm2,
    lostKm2: shaded.lostKm2,
    townsTaken: asArray(after?.brief?.cities?.[side]).map(placeOf),
    townsLost: asArray(after?.brief?.cities?.[1 - side]).map(placeOf),
    ours: [strength(before, side), strength(after, side)],
    theirs: [strength(before, 1 - side), strength(after, 1 - side)],
    cutOff: asArray(after?.brief?.pockets).filter((pocket) => pocket?.s === side).length,
    theyCutOff: asArray(after?.brief?.pockets).filter((pocket) => pocket?.s === 1 - side).length,
    closed: after?.status === "closed",
  };
};

// Each side's strength before and after, in one sentence (the phrase book takes a line whole or not at all).
const StrengthLine = ({ pair, ours, style }) => {
  const [then, now] = pair;
  if (!then || !now) return null;
  return (
    <div style={style}>
      {ours
        ? `Your troops would go from ${then.n} formations at ${then.pct}% to ${now.n} at ${now.pct}%.`
        : `Theirs would go from ${then.n} formations at ${then.pct}% to ${now.n} at ${now.pct}%.`}
    </div>
  );
};

//   record     the battlefield shown, as it stands; side, the player's side of it
//   gameDate   the date the game stands at; locked, nothing can be done now
export const RehearsalTray = ({ record, side, gameDate, locked }) => {
  const [state, setState] = useState({ status: "idle" });
  const controllerRef = useRef(null);
  const name = record?.name ?? "";
  const key = useMemo(() => ordersKeyOf(record, gameDate), [record, gameDate]);

  // Another battlefield, or the room shut: what was rehearsed is put away, and one under way called off.
  useEffect(() => () => {
    controllerRef.current?.abort();
    setWarRoom({ rehearsalShade: null });
  }, [name]);
  useEffect(() => {
    setState({ status: "idle" });
  }, [name]);

  const rehearse = async () => {
    controllerRef.current?.abort();
    stopFrontsPrethink();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "running" });
    setWarRoom({ rehearsalShade: null });
    try {
      const found = await warRoomRehearse({ days: REHEARSAL_DAYS, signal: controller.signal });
      if (controller.signal.aborted) return;
      const after = asArray(found?.battlefields).find((entry) => foldBattlefieldName(entry?.name) === foldBattlefieldName(name));
      if (!found || !after) {
        setState({ status: "nothing" });
        return;
      }
      const summary = rehearsalSummary(record, normalizeBattlefield(after), side);
      setState({ status: "done", key, toDate: found.toDate, summary });
      setWarRoom({ rehearsalShade: summary.data });
      // (The rest of the next period is thought through now, with these days already in hand.)
      scheduleFrontsPrethink();
    } catch (error) {
      if (error?.name === "AbortError") return;
      setState({ status: "failed", message: String(error?.message || error) });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };
  const cancel = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({ status: "idle" });
  };
  const clear = () => {
    setState({ status: "idle" });
    setWarRoom({ rehearsalShade: null });
  };

  const { summary } = state;
  const stale = state.status === "done" && state.key !== key;
  return (
    <div data-oh-war-room-rehearsal={state.status} style={{ ...trayStyle(false), marginTop: "0.4rem", padding: "0.45rem 0.5rem" }}>
      {state.status !== "done" && (
        <>
          <div style={softText}>See where the front would be in a week if time passed with your orders as they stand. Their staff thinks as it will, and the weather is the weather that will come.</div>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.6rem", marginTop: "0.35rem" }}>
            <button type="button" className="oh-tap" disabled={locked || state.status === "running"} onClick={rehearse} style={keyStyle(false, locked || state.status === "running")}>
              {state.status === "running" ? <>Rehearsing…</> : <>Rehearse the next week</>}
            </button>
            {state.status === "running" && <button type="button" onClick={cancel} style={linkStyle}>Cancel</button>}
          </div>
          {state.status === "running" && <div style={{ ...softText, marginTop: "0.3rem" }}>The other side's staff is thinking its moves through. The map stays yours meanwhile.</div>}
          {state.status === "nothing" && <div style={{ ...softText, marginTop: "0.3rem" }}>Nothing would be fought here in the week ahead.</div>}
          {state.status === "failed" && <div role="alert" style={{ color: "#ffb4a8", fontSize: "0.72rem", marginTop: "0.3rem" }}><span data-no-translate>{state.message}</span></div>}
        </>
      )}
      {state.status === "done" && summary && (
        <>
          <div style={{ color: BONE, fontSize: "0.8rem", fontWeight: 700 }}>
            By {formatGameDateReadable(state.toDate) || state.toDate}, with your orders as they stand
          </div>
          <div style={{ ...softText, marginTop: "0.2rem" }}>
            {summary.gainedKm2 === 0 && summary.lostKm2 === 0
              ? <>The front would hardly move.</>
              : <>You would take about {summary.gainedKm2.toLocaleString()} km² (shaded green on the map) and lose about {summary.lostKm2.toLocaleString()} km² (shaded red).</>}
          </div>
          {summary.townsTaken.length > 0 && <div style={softText}>Towns you would take: <span data-no-translate>{summary.townsTaken.join(", ")}</span>.</div>}
          {summary.townsLost.length > 0 && <div style={{ ...softText, color: AMBER }}>Towns you would lose: <span data-no-translate>{summary.townsLost.join(", ")}</span>.</div>}
          {summary.cutOff > 0 && <div style={{ ...softText, color: AMBER }}>Troops of yours would be cut off in {summary.cutOff} place{summary.cutOff === 1 ? "" : "s"}.</div>}
          {summary.theyCutOff > 0 && <div style={softText}>Troops of theirs would be cut off in {summary.theyCutOff} place{summary.theyCutOff === 1 ? "" : "s"}.</div>}
          <StrengthLine pair={summary.ours} ours style={{ ...softText, marginTop: "0.2rem" }} />
          <StrengthLine pair={summary.theirs} ours={false} style={softText} />
          {summary.closed && <div style={{ ...softText, color: AMBER }}>The fighting here would be over.</div>}
          <div style={{ ...softText, marginTop: "0.25rem" }}>The story of the next turn can still change this: other countries act, and so do you.</div>
          {stale && <div style={{ color: AMBER, fontSize: "0.72rem", marginTop: "0.2rem" }}>Your orders have changed since: rehearse again to see what they would do.</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.3rem" }}>
            <button type="button" disabled={locked} onClick={rehearse} style={linkStyle}>Rehearse again</button>
            <button type="button" onClick={clear} style={linkStyle}>Clear</button>
          </div>
        </>
      )}
    </div>
  );
};
