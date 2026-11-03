/*! Open Historia — a war's after-action report © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "After-action report when a war ends: its turning points (breakthroughs,
// encirclements, walls breached) from the battle's log and replay" (the
// owner's list, 2026-10-16). Once a battlefield the player fought on has
// closed, its report is put before the player once (AfterActionReports,
// mounted beside the war room: main.jsx), and it stays to be read again from
// the list of the war's reports in the country's Diplomacy pane
// (WarReportsList, stats.jsx). It is made of what the battlefield kept of its
// war (runtime/fronts/chronicle.js; afterActionData.js picks the turning
// points), on the war room's steel plate.

import React, { useEffect, useMemo, useState } from "react";
import { useLibraryState, useActiveGameCountry } from "../../runtime/library.js";
import { battlefieldSideOf, foldBattlefieldName } from "../../runtime/fronts/record.js";
import { formatGameDateReadable } from "../../runtime/gameDates.js";
import { SAFE_BOTTOM, SAFE_TOP } from "../../runtime/mobileUi.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { daysFought, isRecentReport, reportKey, reportsFor, talliesOf, turningPointsOf } from "./afterActionData.js";
import { placeName } from "./warRoomData.js";
import { AMBER, BONE, BONE_FAINT, BONE_SOFT, RED, STEEL, keyStyle, linkStyle, plateStyle, rivetStyle, stencilStyle, trayStyle } from "./warRoomTheme.js";
import { useTurnRunning } from "./useTurnRunning.js";

// Asks for a report to be opened, by its battlefield's name (WarReportsList).
export const OPEN_REPORT_EVENT = "oh:after-action-open";
const SEEN_KEY = "oh:after-action-seen";
const SEEN_MOST = 60;
const readSeen = () => {
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};
const markSeen = (key) => {
  try {
    globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify([...readSeen().filter((entry) => entry !== key), key].slice(-SEEN_MOST)));
  } catch { /* not kept: it may be shown again */ }
};

// The tones of the two sides, as the map draws their aircraft and transporters: the player's, the other.
const TONE_OWN = AMBER;
const TONE_ENEMY = "#e0454d";

const Who = ({ name }) => <span data-no-translate style={{ color: BONE, fontWeight: 700 }}>{name}</span>;
const Place = ({ at }) => <span data-no-translate>{placeName(at) || at}</span>;

// One turning point, in words.
const Moment = ({ moment, names }) => {
  const who = <Who name={names[moment.s] ?? ""} />;
  const enemy = <Who name={names[1 - moment.s] ?? ""} />;
  const at = <Place at={moment.at} />;
  switch (moment.k) {
    case "offensive": return moment.at === "the whole line" ? <>{who} went over to the attack along the whole line.</> : <>{who} went over to the attack in the <Place at={moment.at} />.</>;
    case "counter": return <>{who} answered a breakthrough at {at} with a counter-offensive.</>;
    case "city": return moment.capital ? <>{who} took {at}, a capital.</> : <>{who} took {at}.</>;
    case "pocket": return <>{enemy} surrounded troops of {who} near {at}, and they surrendered.</>;
    case "siege": return <>{enemy} shut troops of {who} in at {at}.</>;
    case "breached": return <>{who} broke through {at}.</>;
    case "destroyed": return <>{who} destroyed {at}.</>;
    case "invaded": return <>{who} sent its troops into {at}.</>;
    case "attacked": return <>{who} attacked {at}.</>;
    case "landed": return <>Troops of {who} came ashore at {at}.</>;
    case "withdrew": return <>{who} withdrew its last troops.</>;
    case "returned": return <>{who} sent its troops back.</>;
    case "assault": return <>{who} stormed {at}.</>;
    case "bombed": return <>{who} bombed {at} from the air.</>;
    default: return null;
  }
};

// Each side's formations as the war went, a line a side.
const StrengthChart = ({ strength, tones }) => {
  const points = Array.isArray(strength) ? strength : [];
  if (points.length < 2) return null;
  const width = 300;
  const height = 92;
  const most = Math.max(1, ...points.flatMap((point) => [point[1], point[2]]));
  const xOf = (at) => 6 + (at * (width - 12)) / (points.length - 1);
  const yOf = (value) => height - 8 - (value * (height - 18)) / most;
  const line = (side) => points.map((point, at) => `${at === 0 ? "M" : "L"}${xOf(at).toFixed(1)} ${yOf(point[side + 1]).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Each side's formations as the war went" style={{ display: "block", marginTop: "0.3rem" }}>
      <rect x="0" y="0" width={width} height={height} fill="rgba(0,0,0,0.32)" stroke={STEEL.seam} />
      <path d={`M6 ${height - 8}H${width - 6}`} stroke={BONE_FAINT} strokeWidth="0.6" />
      {[0, 1].map((side) => <path key={side} d={line(side)} fill="none" stroke={tones[side]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
    </svg>
  );
};

//   record   the closed battlefield; mine, the country the player plays; onClose
export const AfterActionReport = ({ record, mine, onClose }) => {
  const side = battlefieldSideOf(record, mine);
  const names = record.sides.map((members) => members[0] ?? "");
  const tones = [0, 1].map((at) => (side < 0 ? (at === 0 ? BONE : BONE_SOFT) : at === side ? TONE_OWN : TONE_ENEMY));
  const points = useMemo(() => turningPointsOf(record.chronicle), [record]);
  const tallies = useMemo(() => talliesOf(record.chronicle), [record]);
  const strength = Array.isArray(record.chronicle?.strength) ? record.chronicle.strength : [];
  const first = strength[0];
  const last = strength[strength.length - 1];
  const days = daysFought(record);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="presentation" onClick={onClose} style={{ alignItems: "center", background: "rgba(3,5,8,0.62)", display: "flex", inset: 0, justifyContent: "center", padding: `calc(0.5rem + ${SAFE_TOP}) 0.5rem calc(0.5rem + ${SAFE_BOTTOM})`, position: "fixed", zIndex: 10060 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="After-action report"
        data-oh-after-action=""
        onClick={(event) => event.stopPropagation()}
        style={{ ...plateStyle(), border: `2px solid ${STEEL.seam}`, borderRadius: "5px", borderTop: `4px solid ${RED}`, boxShadow: `inset 0 1px 0 ${STEEL.lip}, 0 12px 40px rgba(0,0,0,0.6)`, boxSizing: "border-box", color: BONE, display: "flex", flexDirection: "column", fontFamily: "sans-serif", maxHeight: "100%", maxWidth: "34rem", overflow: "hidden", position: "relative", width: "100%" }}
      >
        <span aria-hidden="true" style={rivetStyle({ left: "0.4rem", top: "0.4rem" }, "0.5rem")} />
        <span aria-hidden="true" style={rivetStyle({ right: "0.4rem", top: "0.4rem" }, "0.5rem")} />
        <div style={{ alignItems: "flex-start", borderBottom: `2px solid ${STEEL.seam}`, display: "flex", gap: "0.6rem", padding: "0.75rem 1.1rem 0.6rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...stencilStyle, color: BONE_SOFT, fontSize: "0.68rem", letterSpacing: "0.2em" }}>After-action report</div>
            <div data-no-translate style={{ ...stencilStyle, color: BONE, fontSize: "1.15rem", letterSpacing: "0.12em", marginTop: "0.15rem", overflowWrap: "anywhere" }}>{record.name}</div>
            <div style={{ color: BONE_SOFT, fontSize: "0.74rem", marginTop: "0.2rem" }}>
              <span data-no-translate>{record.sides[0].join(", ")}</span> against <span data-no-translate>{record.sides[1].join(", ")}</span>
            </div>
            <div style={{ color: BONE_FAINT, fontSize: "0.7rem", marginTop: "0.12rem" }}>
              {formatGameDateReadable(record.openedDate) || record.openedDate} to {formatGameDateReadable(record.closedDate) || record.closedDate}
              {days !== null && <> · {days} days</>}
            </div>
          </div>
          <button type="button" className="oh-tap" onClick={onClose} aria-label="Close the report" title="Close the report" style={{ ...keyStyle(false, false), padding: "0.42rem 0.55rem" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: "0.7rem 1.1rem 1rem" }}>
          {first && last && (
            <div style={{ ...trayStyle(false), padding: "0.45rem 0.55rem" }}>
              <div style={{ ...stencilStyle, fontSize: "0.66rem" }}>Strength</div>
              <StrengthChart strength={strength} tones={tones} />
              {[0, 1].map((at) => (
                <div key={at} style={{ color: BONE_SOFT, fontSize: "0.72rem", lineHeight: 1.4, marginTop: at === 0 ? "0.3rem" : 0 }}>
                  <span aria-hidden="true" style={{ background: tones[at], display: "inline-block", height: "0.2rem", marginRight: "0.35rem", verticalAlign: "middle", width: "0.9rem" }} />
                  <Who name={names[at]} />: {first[at + 1]} formations at the first count, {last[at + 1]} at the end, at {last[at + 3]}% strength
                </div>
              ))}
            </div>
          )}
          <div style={{ ...stencilStyle, fontSize: "0.7rem", marginTop: "0.8rem" }}>Turning points</div>
          {points.length === 0 && <div style={{ color: BONE_SOFT, fontSize: "0.74rem", marginTop: "0.3rem" }}>Nothing that turned the war was kept of it.</div>}
          <ol style={{ listStyle: "none", margin: "0.3rem 0 0", padding: 0 }}>
            {points.map((moment) => (
              <li key={`${moment.order}`} style={{ borderLeft: `2px solid ${tones[moment.s] ?? BONE_FAINT}`, color: BONE_SOFT, fontSize: "0.76rem", lineHeight: 1.4, marginTop: "0.35rem", paddingLeft: "0.55rem" }}>
                <div style={{ color: BONE_FAINT, fontSize: "0.66rem" }}>{formatGameDateReadable(moment.d) || moment.d}</div>
                <Moment moment={moment} names={names} />
              </li>
            ))}
          </ol>
          <div style={{ ...stencilStyle, fontSize: "0.7rem", marginTop: "0.8rem" }}>What each side came to</div>
          {[0, 1].map((at) => (
            <div key={at} style={{ color: BONE_SOFT, fontSize: "0.74rem", lineHeight: 1.45, marginTop: "0.3rem" }}>
              <Who name={names[at]} />:{" "}
              {tallies[at].towns.length > 0
                ? <>took {tallies[at].towns.length} {tallies[at].towns.length === 1 ? <>town</> : <>towns</>} (<span data-no-translate>{tallies[at].towns.slice(0, 4).map((town) => placeName(town.at) || town.at).join(", ")}</span>{tallies[at].towns.length > 4 && <> and more</>})</>
                : <>took no town</>}
              {tallies[at].breached > 0 && <>; broke through a fortified line {tallies[at].breached === 1 ? <>once</> : <>{tallies[at].breached} times</>}</>}
              {tallies[at].surrendered > 0 && <>; had troops surrounded and surrender {tallies[at].surrendered === 1 ? <>once</> : <>{tallies[at].surrendered} times</>}</>}
              .
            </div>
          ))}
          <div style={{ marginTop: "0.9rem" }}>
            <button type="button" className="oh-tap" onClick={onClose} style={keyStyle(false, false)}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Puts the report of a battlefield the player fought on before the player once, as it closes, and opens one when
// asked (OPEN_REPORT_EVENT). Not while a turn is being worked out and shown.
export const AfterActionReports = () => {
  const world = useRuntimeState("world");
  const game = useRuntimeState("game");
  const { activeGame } = useLibraryState();
  const mine = useActiveGameCountry();
  const turnRunning = useTurnRunning(true);
  // A report asked for by name, and how many have been closed (what was seen is read again then).
  const [asked, setAsked] = useState(null);
  const [closed, setClosed] = useState(0);
  const reports = useMemo(() => reportsFor(world?.battlefields, mine), [world?.battlefields, mine]);
  const campaign = activeGame?.id ?? "";
  // A war just over: its report, once.
  const due = useMemo(() => {
    if (turnRunning) return null;
    const seen = new Set(readSeen());
    return reports.find((record) => !seen.has(reportKey(campaign, record)) && isRecentReport(record, game?.gameDate)) ?? null;
    // (`closed` reads what was seen again.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, campaign, game?.gameDate, turnRunning, closed]);
  // One asked for.
  useEffect(() => {
    const open = (event) => setAsked(foldBattlefieldName(event?.detail?.name));
    window.addEventListener(OPEN_REPORT_EVENT, open);
    return () => window.removeEventListener(OPEN_REPORT_EVENT, open);
  }, []);
  const record = asked ? reports.find((entry) => foldBattlefieldName(entry.name) === asked) ?? null : due;
  if (!record) return null;
  const close = () => {
    markSeen(reportKey(campaign, record));
    setAsked(null);
    setClosed((count) => count + 1);
  };
  return <AfterActionReport record={record} mine={mine} onClose={close} />;
};

// The reports there are for the country shown, to read again (the Diplomacy pane: stats.jsx).
export const WarReportsList = ({ world, country, style = null }) => {
  const reports = useMemo(() => reportsFor(world?.battlefields, country), [world?.battlefields, country]);
  if (reports.length === 0) return null;
  return (
    <div data-oh-war-reports="" style={style}>
      <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.72rem", fontWeight: 800, padding: "0.55rem 0.65rem" }}>War reports</div>
      {reports.map((record) => (
        <div key={record.name} style={{ alignItems: "center", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: "0.5rem", justifyContent: "space-between", padding: "0.45rem 0.65rem" }}>
          <div style={{ minWidth: 0 }}>
            <div data-no-translate style={{ color: "rgba(255,255,255,0.86)", fontSize: "0.72rem", fontWeight: 750 }}>{record.name}</div>
            <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.61rem", marginTop: "0.14rem" }}>Ended {formatGameDateReadable(record.closedDate) || record.closedDate}</div>
          </div>
          <button
            type="button"
            className="oh-tap-row"
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_REPORT_EVENT, { detail: { name: record.name } }))}
            style={{ ...linkStyle, color: "#2bc1f3", fontSize: "0.66rem" }}
          >Read the report</button>
        </div>
      ))}
    </div>
  );
};
