/*! Open Historia — the war room © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The war room opens from the red button that appears while the player's
// troops are on a battlefield (main.jsx). While it is open it is the whole of
// the screen: every other control is put out of sight, the map is fitted to the
// battlefield inside a frame of plate steel, and a panel of the same plate
// stands on the right (warRoomTheme.js). In the panel are
//
//   - a tab a battlefield, when the player is fighting on more than one;
//   - the KEY: the player's generals, each with the body of troops he commands
//     (runtime/fronts/command.js). Pointing at a general lights his troops on
//     the map; "Pick" picks them out;
//   - the TOOLS for the troops picked out: a box dragged on the map picks
//     them, and they are sent along a route drawn for them, or told to dig in,
//     hold or fall back, or given back to their stretch of line;
//   - the PLANS: every movement the player's side means to make, drawn on the
//     map as an arrow before it is made (runtime/fronts/plans.js): his routes,
//     his generals' orders, the Board's operations (each can be redrawn, or
//     told to move nothing), and diversions; and under them what his agents
//     and his Board have of the other side's;
//   - the TROOP TOOLS, which are not in the drawer: they are on a rail that
//     comes out of the left edge of the screen, beside the map they are used
//     on (warRoomRail.jsx). At its foot, Fortify draws a fortified line to be
//     built (warRoomFortify.jsx) and Fleets commands the player's fleets
//     (warRoomFleets.jsx), each on a plate beside the rail; the drawer lists
//     the player's lines and fleets as they stand. Beside Deploy, Aircraft
//     sends an air unit to strike troops, a structure or a city
//     (warRoomAircraft.jsx), and the drawer lists the strikes.
//   - the TALK with the generals: one request a message (AI/gameplay.js
//     generateWarRoomReply). They answer, push back, and take orders.
//
// Nothing moves while the war room is open. What is ordered here is put to
// the troops when time next passes (runtime/fronts/engine.js). Every change
// goes through runtime/warRoomWrites.js.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateWarRoomReply, warRoomChart, warRoomRouteAttacks, warRoomTransportWays } from "../AI/gameplayLazy.js";
import { normalizeAirStrikeOrders, normalizeAirStrikes } from "../../runtime/fronts/airStrike.js";
import { airReachOf, airUnitsOf, strikableStructures } from "../../runtime/fronts/airStrikeOps.js";
import { kmBetween, measureOptions } from "../../runtime/fronts/worldGrid.js";
import { engineMapOf } from "../../../server/mapDistance.js";
import { warRoomIntel, warRoomPlans } from "../AI/frontPlans.js";
import { isSimulationBusy } from "../AI/simulationStatus.js";
import { closeWarRoom, getWarRoom, onWarRoomWay, openWarRoom, setWarRoom, showBattlefield, takeTool, useWarRoom } from "../Map/warRoomStore.js";
import { requestDiplomaticChat } from "./chat.jsx";
import { PLAN_COLOURS, planTone } from "../Map/warRoomGeometry.js";
import { readFrontCities } from "../../runtime/frontCities.js";
import { chosenOrdersOf, commandTitle, generalsOf, ownTroopsOf, talkOf } from "../../runtime/fronts/command.js";
import { THRUST_TROOPS } from "../../runtime/fronts/constants.js";
import { handicapOf } from "../../runtime/fronts/handicap.js";
import { deployLinesOf } from "../../runtime/fronts/deploy.js";
import { foldBattlefieldName, normalizeBattlefield } from "../../runtime/fronts/record.js";
import { TRANSPORT_MEDIA, carrierFor, isUnderWay, loadOf, normalizeTransports } from "../../runtime/fronts/transports.js";
import { formatGameDateReadable, gameDateYear } from "../../runtime/gameDates.js";
import { isActiveFeatureEnabled, useActiveFeatures } from "../../runtime/gameFeatures.js";
import { humanCountriesOf } from "../../runtime/humanPolities.js";
import { useLibraryState } from "../../runtime/library.js";
import { SAFE_BOTTOM, SAFE_LEFT, SAFE_RIGHT, SAFE_TOP } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { kmOnMap } from "../../runtime/unitMotion.js";
import { currentMapMeasure } from "../../runtime/mapMeasure.js";
import { convoysOf, enemiesOf, fleetsOf } from "../../runtime/naval/fleetOps.js";
import { sendAirStrikeOp, sendFleetOp, sendFortifyOp, sendWarRoomOp } from "../../runtime/warRoomWrites.js";
import { warSettingsOf, warfareOf } from "../../runtime/warSettings.js";
import { ADVISOR_SLIDE } from "./advisorSlide.js";
import { placeName, playerFronts } from "./warRoomData.js";
import { FleetsList, FleetsPlate } from "./warRoomFleets.jsx";
import { AircraftList, AircraftPlate } from "./warRoomAircraft.jsx";
import { FortifyPlate, LinesList } from "./warRoomFortify.jsx";
import { WarRoomRail } from "./warRoomRail.jsx";
import { WeatherAhead } from "./warRoomWeather.jsx";
import { RehearsalTray } from "./warRoomRehearsal.jsx";
import { supplyShading } from "../Map/warRoomCells.js";
import { airOn, naviesOn, strategyNetOn } from "../AI/frontsGate.js";
import { scheduleFrontsPrethink } from "../AI/frontPrethink.js";
import { commanderOf } from "../../runtime/fronts/mind/commanders.js";
import {
  AMBER,
  BONE,
  BONE_FAINT,
  BONE_SOFT,
  BRASS,
  OLIVE,
  OLIVE_LINE,
  RED,
  RED_BRIGHT,
  RED_DARK,
  STEEL,
  STENCIL,
  keyStyle,
  linkStyle,
  plateStyle,
  rivetStyle,
  stencilStyle,
  trayStyle,
} from "./warRoomTheme.js";
import { useTurnRunning } from "./useTurnRunning.js";

const WAR_ROOM_WIDTH = "min(26rem, calc(100vw - 1rem))";
// A structure or a city this near where the map was clicked is what an air strike is sent at.
const STRIKE_SNAP_KM = 60;
// The frame of plate round the map: a bar across the top with the
// battlefield's name on it, and a strip down the left and along the bottom.
const FRAME_BAR = "2.2rem";
const FRAME_STRIP = "0.55rem";

const selectWorld = (world) => world ?? null;
const selectGame = (game) => ({
  country: game?.country || "",
  gameDate: String(game?.gameDate || game?.startDate || ""),
  // (What the level gives the other side on a battlefield is said in the room.)
  difficulty: String(game?.difficulty || ""),
});

// What an order is called on the panel.
const OrderWord = ({ order }) => {
  if (order === "advance") return <>Advance</>;
  if (order === "blitz") return <>Blitz</>;
  if (order === "spearhead") return <>Spearhead</>;
  if (order === "flank") return <>Flank</>;
  if (order === "encircle") return <>Encircle</>;
  if (order === "hold") return <>Hold</>;
  if (order === "dig in") return <>Dig in</>;
  if (order === "fall back") return <>Fall back</>;
  if (order === "withdraw") return <>Withdraw</>;
  return <>Order</>;
};

// What a general's troops are at, as the engine's brief has it.
const DoingWord = ({ doing }) => {
  if (doing === "advancing" || doing === "advance") return <>advancing</>;
  if (doing === "dug-in") return <>dug in</>;
  if (doing === "cut-off") return <>cut off</>;
  if (doing === "on-route") return <>following a route</>;
  if (doing === "closing") return <>closing on a pocket</>;
  if (doing === "assaulting") return <>assaulting</>;
  if (doing === "falling-back") return <>falling back</>;
  if (doing === "withdrawing") return <>withdrawing</>;
  if (doing === "breaking-out") return <>breaking out</>;
  if (doing === "pursuing") return <>pursuing</>;
  if (doing === "spearhead") return <>driving a spearhead</>;
  if (doing === "encircle") return <>encircling</>;
  if (doing === "flank") return <>turning a flank</>;
  if (doing === "blitz") return <>massing to attack</>;
  return <>holding the line</>;
};

// Why a transporter did not set out, or no way was found for it.
const WayRefusal = ({ code }) => {
  if (code === "no-coast") return <>no sea is near where it would set out</>;
  if (code === "no-shore") return <>no shore is near that place</>;
  if (code === "no-sea-way") return <>no sea leads there</>;
  if (code === "no-ground") return <>it has no land of your side's to start on</>;
  if (code === "no-troops") return <>its troops were gone</>;
  if (code === "no-war") return <>you are fighting no war</>;
  if (code === "no-navy") return <>your country has no navy to carry them</>;
  if (code === "no-air-force") return <>your country has no air arm to carry them</>;
  if (code === "railhead") return <>its line ends before that place</>;
  if (code === "too-far" || code === "off-map") return <>that place cannot be reached</>;
  return <>no way was found</>;
};
// What a carrier goes by.
const MediumWord = ({ medium }) => {
  if (medium === "sea") return <>by sea</>;
  if (medium === "land") return <>by rail</>;
  return <>by air</>;
};

const ProjectStatus = ({ status }) => {
  if (status === "active") return <>under way</>;
  if (status === "proposed") return <>proposed</>;
  if (status === "paused") return <>paused</>;
  if (status === "stalled") return <>stalled</>;
  return null;
};

// What the other side's staff's plan is called (runtime/fronts/mind/planner.js PLAN_NAMES), as an agent reports it.
const StaffPlanWord = ({ plan }) => {
  if (plan === "push") return <>an attack along the whole line</>;
  if (plan === "dig in") return <>to dig in along the whole line</>;
  if (plan === "the weakest place") return <>a blow at the weakest point of your line</>;
  if (plan === "the second weakest place" || plan === "the third weakest place") return <>a blow at a weak point of your line</>;
  if (plan === "everyone on the weakest place") return <>everything at the weakest point of your line</>;
  if (plan === "a pincer") return <>a pincer</>;
  if (plan === "the towns") return <>to take the towns</>;
  if (plan === "the walls") return <>to break through the walls</>;
  if (plan === "net, digging in") return <>its own judgement troop by troop, digging in where it holds</>;
  if (plan === "net, resting the worn") return <>its own judgement troop by troop, resting its worn troops</>;
  return <>its own judgement, troop by troop</>;
};

// A heading stencilled on the plate, ruled off to the right.
const Heading = ({ children, action = null, style = null }) => (
  <div style={{ alignItems: "center", display: "flex", gap: "0.55rem", ...style }}>
    <div style={stencilStyle}>{children}</div>
    <div aria-hidden="true" style={{ background: "rgba(201,165,76,0.3)", flex: 1, height: "1px" }} />
    {action}
  </div>
);

// A general's number, as it is stamped on his tag.
const Tag = ({ number, lit }) => (
  <span aria-hidden="true" style={{
    alignItems: "center", background: lit ? BRASS : "rgba(0,0,0,0.45)", border: `1px solid ${BRASS}`, borderRadius: "2px", color: lit ? "#1c1608" : BRASS,
    display: "inline-flex", flex: "0 0 auto", fontFamily: STENCIL, fontSize: "0.86rem", fontWeight: 700, height: "1.5rem", justifyContent: "center", width: "1.5rem",
  }}>{number}</span>
);

const softText = { color: BONE_SOFT, fontSize: "0.72rem", lineHeight: 1.4 };

const WarRoomPanel = ({ open, onClose, width, onResize, onResizeEnd }) => {
  const isMobile = useIsMobile();
  // (Read through the hook so that a switch thrown in the game's settings is seen.)
  useActiveFeatures();
  const espionage = isActiveFeatureEnabled("espionage");
  const world = useRuntimeState("world", selectWorld);
  const game = useRuntimeState("game", selectGame);
  const { activeGame } = useLibraryState();
  const turnRunning = useTurnRunning(open);
  const shown = useWarRoom((state) => state.battlefield);
  const tool = useWarRoom((state) => state.tool);
  const replan = useWarRoom((state) => state.replan);
  const selected = useWarRoom((state) => state.selected);
  const highlight = useWarRoom((state) => state.highlight);
  const pointed = useWarRoom((state) => state.pointed);
  // The fortified line drawn and waiting for its level, and the fleets' plate.
  const draft = useWarRoom((state) => state.draft);
  const level = useWarRoom((state) => state.level);
  const fleetsOut = useWarRoom((state) => state.fleets);
  // The supply map, shaded while the rail's Supply key is down.
  const supplyOn = useWarRoom((state) => state.supply);
  const pickedFleet = useWarRoom((state) => state.fleet);
  const station = useWarRoom((state) => state.station);
  const deployForm = useWarRoom((state) => state.deployForm);
  // The aircraft's plate, the air unit picked out on it, and what it is to strike.
  const aircraftOut = useWarRoom((state) => state.aircraft);
  const pickedWing = useWarRoom((state) => state.wing);
  const strikeKind = useWarRoom((state) => state.strikeKind);

  // ---- which battlefield ---------------------------------------------------------------
  const fronts = useMemo(() => playerFronts(world?.battlefields, game.country, world?.wars), [world?.battlefields, game.country, world?.wars]);
  const front = fronts.find((entry) => foldBattlefieldName(entry.name) === foldBattlefieldName(shown)) ?? fronts[0] ?? null;
  const record = useMemo(() => {
    if (!front) return null;
    const row = world.battlefields.find((entry) => foldBattlefieldName(entry?.name) === foldBattlefieldName(front.name));
    return row ? normalizeBattlefield(row) : null;
  }, [world?.battlefields, front]);
  const side = front?.side ?? -1;

  // The store follows the panel: open on the battlefield shown, shut with it.
  useEffect(() => {
    if (!open || !front) return undefined;
    openWarRoom(front.name, front.side);
    return () => closeWarRoom();
    // Opened once per opening: a change of battlefield goes through showBattlefield.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, Boolean(front)]);
  useEffect(() => {
    if (open && front) showBattlefield(front.name, front.side);
  }, [open, front]);
  // The war is over, or the troops are gone from every front: the room shuts.
  useEffect(() => {
    if (open && world && fronts.length === 0) onClose?.();
  }, [open, world, fronts.length, onClose]);

  // How much of the map the panel covers, for fitting a battlefield beside it.
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open || !rootRef.current || isMobile) {
      setWarRoom({ cover: 0 });
      return undefined;
    }
    const measure = () => setWarRoom({ cover: Math.round(rootRef.current?.getBoundingClientRect().width ?? 0) });
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [open, isMobile]);

  // ---- what is on it -------------------------------------------------------------------
  const [cities, setCities] = useState([]);
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    readFrontCities(world, game).then((list) => { if (live) setCities(list); }).catch(() => {});
    return () => { live = false; };
    // The cities are the map's: read once an opening, and again when the date moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, game.gameDate, activeGame?.id]);

  // (On a side of several countries each commands its own: these are the player's generals, with the player's troops.)
  const generals = useMemo(() => (record ? generalsOf(record, side, { member: game.country }) : []), [record, side, game.country]);
  // Who fights beside the player here, with how many formations and under what orders of its own.
  const allies = useMemo(() => {
    if (!record || (side !== 0 && side !== 1)) return [];
    const mine = String(game.country ?? "").trim().toLowerCase();
    const counted = new Map((record.brief?.strength?.[side]?.members ?? []).map((entry) => [String(entry.name).toLowerCase(), entry.n]));
    return record.sides[side].filter((member) => member.toLowerCase() !== mine).map((member) => ({
      name: member,
      n: counted.get(member.toLowerCase()) ?? 0,
      orders: record.orders.filter((order) => order.s === side && !order.chosen && String(order.by ?? "").toLowerCase() === member.toLowerCase()),
    }));
  }, [record, side, game.country]);
  // What the game's difficulty gives the other side on this battlefield (runtime/fronts/handicap.js),
  // as percentages: the room says it, so that the handicap is never a hidden one. Null on even terms.
  const theirEdge = useMemo(() => {
    if (!record || (side !== 0 && side !== 1)) return null;
    const people = humanCountriesOf(game);
    const given = handicapOf({ difficulty: game.difficulty, sides: record.sides, players: people });
    return given.side === 1 - side ? { power: Math.round(given.edge.power * 100), pace: Math.round(given.edge.pace * 100), reserves: Math.round(given.edge.reserves * 100) } : null;
  }, [record, side, game]);
  // Strategy with an ally is agreed with its leader: the room shuts and the conversation opens.
  const talkTo = (ally) => {
    onClose?.();
    requestDiplomaticChat({ name: ally });
  };
  const orders = useMemo(() => (record ? chosenOrdersOf(record, side) : []), [record, side]);
  const talk = useMemo(() => (record ? talkOf(record, side) : []), [record, side]);
  const plans = useMemo(
    () => (record ? warRoomPlans({ world, game, record, side, cities }) : []),
    [world, game, record, side, cities],
  );
  const intel = useMemo(
    () => (record ? warRoomIntel({ world, game, record, side, cities, espionage }) : { plans: [], sources: [], lines: [], double: false }),
    [world, game, record, side, cities, espionage],
  );
  // The other side's staff's plan, where it is found out (the record keeps it: runtime/fronts/engine.js
  // noteStaffPlan): "Spies or air reconnaissance could reveal it" (the owner's list, 2026-10-16). An agent in one
  // of their countries sends the plan itself; the player's aircraft over the front see the troops it sends.
  const theirPlan = useMemo(() => {
    const plan = side === 0 || side === 1 ? record?.brief?.carry?.staff?.[1 - side] : null;
    if (!plan || typeof plan.plan !== "string") return null;
    if (intel.sources.length > 0) return { ...plan, by: "agent" };
    return Number(record?.brief?.air?.wings?.[side]) > 0 && plan.at && plan.n > 0 ? { ...plan, by: "air" } : null;
  }, [record, side, intel]);
  // Who leads them, where the game's difficulty says otherwise than the best there is (runtime/fronts/mind/trained.js).
  const theirCommander = useMemo(() => {
    if (!record || (side !== 0 && side !== 1) || !strategyNetOn()) return null;
    const people = humanCountriesOf(game);
    const who = commanderOf({ sides: record.sides, side: 1 - side, difficulty: game.difficulty || "medium", players: people });
    return who === "trained" ? null : who;
  }, [record, side, game]);
  // How well supplied the ground is (Map/warRoomCells.js), for the map while the Supply key is down.
  const supplyShade = useMemo(() => (open && supplyOn && record ? supplyShading(record, side) : null), [open, supplyOn, record, side]);
  useEffect(() => {
    if (open) setWarRoom({ supplyShade: supplyShade?.data ?? null });
  }, [open, supplyShade]);
  // Where the player's new troops on this battlefield come in, where a line was drawn for them (runtime/fronts/deploy.js):
  // drawn on the map with the plans.
  const deployLine = useMemo(() => {
    const country = String(game?.country ?? "").trim().toLowerCase();
    return record && country ? deployLinesOf(record, side).find((line) => line.country.toLowerCase() === country) ?? null : null;
  }, [record, side, game]);
  // What the deployment calls up when time next passes, and what came of the last it called up (deploy.js).
  const calling = deployLine?.call;
  const called = deployLine?.last?.n ?? 0;
  const calledWhy = deployLine?.last?.why ?? "";
  const calledOn = deployLine?.last ? formatGameDateReadable(deployLine.last.d) || deployLine.last.d : "";
  useEffect(() => {
    if (open) setWarRoom({ plans: deployLine ? [...plans, { id: "deploy", kind: "deploy", form: deployLine.form ?? "front", ways: [deployLine.way], picked: [], troops: 0 }] : plans, known: intel.plans });
  }, [open, plans, intel, deployLine]);
  // What the Deploy tool deploys when the room opens on a battlefield: as the player deployed there last, else as the
  // scenario's wars are fought (runtime/warSettings.js warfareOf): along a front, or as a swarm.
  const deployLineRef = useRef(deployLine);
  deployLineRef.current = deployLine;
  useEffect(() => {
    if (!open || !record?.name) return;
    const last = deployLineRef.current;
    setWarRoom({ deployForm: last ? (last.form === "swarm" ? "swarm" : "front") : warfareOf(world, game.gameDate) });
    // (Only as the room opens or turns to another battlefield: a choice made since stands.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record?.name]);

  // A route drawn into a country that is not in this war is an attack on it
  // (runtime/fronts/invade.js). The engine reads that when time passes; the
  // room reads it from the same ground as soon as the route is drawn, so that
  // it is said before anything moves: by plan, the names it goes into.
  const [intoOthers, setIntoOthers] = useState(null);
  useEffect(() => {
    if (!open || !record) {
      setIntoOthers(null);
      return undefined;
    }
    let live = true;
    warRoomRouteAttacks({ world, game, record })
      .then((found) => { if (live) setIntoOthers(found); })
      .catch(() => { if (live) setIntoOthers(null); });
    return () => { live = false; };
    // The routes are the record's: read again when it changes, and for another game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record, activeGame?.id]);
  const attackedBy = (plan) => {
    if (plan.kind !== "route") return [];
    if (plan.attacks?.length > 0) return plan.attacks;
    return intoOthers?.get(Number(String(plan.id).replace("order:", ""))) ?? [];
  };

  // ---- transporters ------------------------------------------------------------------------
  // The world's transporters that are this side's or the other's on the battlefield shown.
  const transports = useMemo(() => normalizeTransports(world?.transports), [world?.transports]);
  const sameName = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
  const ownTransports = transports.filter((entry) => sameName(entry.owner, game.country));
  const theirTransports = record ? transports.filter((entry) => entry.status === "moving" && (record.sides[1 - side] ?? []).some((member) => sameName(member, entry.owner))) : [];
  // What carries troops this year. (Nothing by sea in a scenario without navies, nor by air in one without air units: the Wars feature.)
  const navies = naviesOn();
  const aircraft = airOn();
  const carriers = useMemo(() => {
    const year = gameDateYear(game.gameDate);
    return TRANSPORT_MEDIA.map((medium) => ({ medium, ...carrierFor(medium, year) }))
      .filter((carrier) => carrier.kind && (carrier.medium !== "sea" || navies) && (carrier.medium !== "air" || aircraft));
  }, [game.gameDate, navies, aircraft]);
  // The way found for each of the player's own that has not set out, so that it
  // is seen on the map before time passes (no request: read from the map).
  const waiting = ownTransports.filter((entry) => entry.status === "ordered").map((entry) => `${entry.id}:${entry.medium}:${entry.to.lng},${entry.to.lat}:${entry.embark?.troops.join(".") ?? ""}`).join("|");
  const [transportWays, setTransportWays] = useState(null);
  useEffect(() => {
    if (!open || !waiting) {
      setTransportWays(null);
      return undefined;
    }
    let live = true;
    warRoomTransportWays({ world, game })
      .then((found) => { if (live) setTransportWays(found); })
      .catch(() => { if (live) setTransportWays(null); });
    return () => { live = false; };
    // Found again only when what is waiting changes, or the game does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, waiting, activeGame?.id]);
  useEffect(() => {
    if (open) setWarRoom({ transportWays });
  }, [open, transportWays]);

  // ---- fortified lines and fleets ------------------------------------------------------------
  // A line can be drawn where the scenario's wars have them (runtime/warSettings.js "walls").
  const canFortify = useMemo(() => warSettingsOf({ warSettings: world?.warSettings }).mechanics.walls === true, [world?.warSettings]);
  // The player's fleets, the countries they may blockade, and the convoys they may cover (runtime/naval/fleetOps.js).
  // None in a scenario without navies.
  const fleets = useMemo(() => (navies ? fleetsOf({ units: world?.units, pendingUnitOrders: world?.pendingUnitOrders }, game.country) : []), [navies, world?.units, world?.pendingUnitOrders, game.country]);
  const enemies = useMemo(() => enemiesOf({ wars: world?.wars }, game.country), [world?.wars, game.country]);
  // The player's air units, how far they reach and their bombs fall, and their strikes: waiting, and the last turn's
  // (runtime/fronts/airStrikeOps.js, airStrike.js). None in a scenario without air units. The whole world: a
  // front's air arm (airArmsOf) is found from the battlefields, the war settings and the military figures, and
  // with the units alone the Aircraft key stayed greyed out for a country flying only those ("why is the aircraft
  // button always greyed out?", the owner, 2026-11-04).
  const wings = useMemo(() => (aircraft ? airUnitsOf(world, game.country) : []), [aircraft, world, game.country]);
  const { reach: airReach, blast: airBlast } = useMemo(() => airReachOf({ warSettings: world?.warSettings }, game.gameDate), [world?.warSettings, game.gameDate]);
  const ownStrike = (entry) => String(entry?.owner ?? "").trim().toLowerCase() === String(game.country ?? "").trim().toLowerCase();
  const strikesWaiting = useMemo(() => (aircraft ? normalizeAirStrikeOrders(world?.airStrikeOrders).filter(ownStrike) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aircraft, world?.airStrikeOrders, game.country]);
  // (Those of the last turn the player's flew in.)
  const strikesFlown = useMemo(() => {
    const own = aircraft ? normalizeAirStrikes(world?.airStrikes).filter(ownStrike) : [];
    const round = own.reduce((most, strike) => Math.max(most, strike.round), 0);
    return own.filter((strike) => strike.round === round);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraft, world?.airStrikes, game.country]);
  const wingName = (id) => wings.find((entry) => entry.id === id)?.name ?? (world?.units ?? []).find((unit) => unit?.id === id)?.name ?? "";
  useEffect(() => {
    if (open) setWarRoom({ blast: airBlast });
  }, [open, airBlast]);
  const convoys = useMemo(() => convoysOf({ transports: world?.transports }, game.country), [world?.transports, game.country]);
  // What the nearest town to a place on the map is called, if one is near: a
  // transporter is told where it is bound in words as well.
  const placeNear = (lng, lat) => {
    let best = null;
    // (By the map's own measure where it is not plain Mercator: server/mapDistance.js.)
    const measure = currentMapMeasure();
    for (const city of cities) {
      const across = (Number(city.lng) - lng) * Math.cos((lat * Math.PI) / 180) * 111;
      const down = (Number(city.lat) - lat) * 111;
      const far = measure.plain ? Math.sqrt(across * across + down * down) : kmOnMap(lat, lng, Number(city.lat), Number(city.lng), measure);
      if (far <= 70 && (!best || far < best.far)) best = { far, name: city.name };
    }
    // (The place with its kind, as the engine names places: put together here, it is no words of the interface.)
    return best ? ["city", best.name].join(": ") : "";
  };

  // ---- doing things --------------------------------------------------------------------
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const act = useCallback(async (op) => {
    setBusy(true);
    setNotice("");
    try {
      await sendWarRoomOp(op, { turnRunning: isSimulationBusy });
      // (New orders: the next period is thought through again with them, AI/frontPrethink.js.)
      scheduleFrontsPrethink();
      return true;
    } catch (error) {
      setNotice(String(error?.message || error));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  // The fortified lines and the fleets have seams of their own (runtime/
  // warRoomWrites.js sendFortifyOp, sendFleetOp): they are held to the map,
  // which is read for them (AI/gameplay.js warRoomChart) only where this page
  // writes the world itself.
  const orderWith = useCallback(async (send, op) => {
    setBusy(true);
    setNotice("");
    try {
      await send(op, { turnRunning: isSimulationBusy, readChart: () => warRoomChart() });
      return true;
    } catch (error) {
      setNotice(String(error?.message || error));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  const name = record?.name ?? "";

  // A way drawn on the map (Map/WarRoomTools.jsx) comes here.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const placeNearRef = useRef(placeNear);
  useEffect(() => {
    placeNearRef.current = placeNear;
  });
  useEffect(() => {
    if (!open || !name) return undefined;
    return onWarRoomWay(async (drawn, way, extra) => {
      if (drawn === "route") {
        if (await act({ op: "route", battlefield: name, troops: selectedRef.current, way })) setWarRoom({ selected: [] });
      } else if (drawn === "diversion") {
        await act({ op: "diversion", battlefield: name, way, troops: selectedRef.current.length || THRUST_TROOPS.spearhead });
      } else if (drawn === "deploy") {
        // Where the player's new troops here come in: one line, drawn again over the last; or a swarm's place. And the
        // fresh formations it calls up there when time next passes, as many as the country can (runtime/fronts/engine.js callUpSize).
        if (await act({ op: "deploy", battlefield: name, way, ...(extra?.form === "swarm" ? { form: "swarm" } : {}) })) setWarRoom({ tool: "pan" });
      } else if (drawn === "replan" && extra?.replan) {
        await act({ op: "plan", battlefield: name, project: extra.replan, way });
      } else if (drawn === "transport" && extra?.medium && way[0]) {
        // The place that was clicked: the troops picked out are carried there, by what was chosen.
        const [lng, lat] = way[0];
        if (await act({ op: "transport", battlefield: name, troops: selectedRef.current, medium: extra.medium, to: [lng, lat], name: placeNearRef.current(lng, lat) })) setWarRoom({ selected: [] });
      } else if (drawn === "fortify") {
        // A fortified line: it waits beside the rail for the level it is to be built to (warRoomFortify.jsx).
        setWarRoom({ draft: way });
      } else if (drawn === "aircraft" && extra?.wing && way[0]) {
        // What was clicked: the air unit picked out is to strike it when time next passes.
        await orderWith(sendAirStrikeOp, await strikeAtRef.current(extra.wing, extra.kind, way[0]));
      } else if (drawn === "fleet" && extra?.fleet && way[0]) {
        // The place clicked at sea: the fleet picked out sails there, or patrols it.
        await orderWith(sendFleetOp, { op: "station", unit: extra.fleet, to: way[0], order: extra.station === "patrol" ? "patrol" : "move" });
      }
    });
  }, [open, name, act, orderWith]);

  // The strike a click on the map orders (Deploy Aircraft): troops where it was clicked on this battlefield, the
  // enemy's structure nearest it, or the city nearest it with whoever holds it (the map's own chart says).
  const strikeAt = async (unit, kind, [lng, lat]) => {
    const near = (list) => list
      .map((entry) => ({ entry, km: kmBetween(lng, lat, Number(entry.lng), Number(entry.lat), measureOptions(engineMapOf(currentMapMeasure()))) }))
      .filter((item) => item.km <= STRIKE_SNAP_KM)
      .sort((a, b) => a.km - b.km)[0]?.entry ?? null;
    if (kind === "structure") {
      const found = near(strikableStructures(world, game.country));
      return { op: "airstrike", unit, kind, marker: found?.id ?? "" };
    }
    if (kind === "city") {
      const city = near(cities);
      if (!city) return { op: "airstrike", unit, kind, to: [lng, lat] };
      const chart = await Promise.resolve().then(() => warRoomChart()).catch(() => null);
      const country = enemies.find((name) => chart?.holds?.(name, Number(city.lng), Number(city.lat)) === true) ?? (chart ? "" : enemies.length === 1 ? enemies[0] : "");
      return { op: "airstrike", unit, kind, to: [Number(city.lng), Number(city.lat)], target: city.name, country, people: Number(city.population) || 0 };
    }
    return { op: "airstrike", unit, kind: "troops", to: [lng, lat], battlefield: name, target: placeNear(lng, lat) };
  };
  const strikeAtRef = useRef(strikeAt);
  useEffect(() => {
    strikeAtRef.current = strikeAt;
  });

  // A line drawn is built at the level picked for it, under the name given it, once confirmed.
  const buildLine = async (title) => {
    const { draft: points, level: height } = getWarRoom();
    if (!points) return;
    if (await orderWith(sendFortifyOp, { op: "fortify", points, level: height, name: title })) setWarRoom({ draft: null });
  };

  const orderPicked = async (order) => {
    if (await act({ op: "order", battlefield: name, troops: selected, order })) setWarRoom({ selected: [] });
  };
  const releasePicked = async () => {
    if (await act({ op: "release", battlefield: name, troops: selected })) setWarRoom({ selected: [] });
  };
  // The troops picked out leave the battlefield; with none picked, every troop of the player's own does.
  const ownTroops = useMemo(() => (record && side >= 0 ? ownTroopsOf(record, side, game.country) : []), [record, side, game.country]);
  const away = record?.brief?.carry?.away?.[side] === true;
  const withdrawPicked = async () => {
    const troops = selected.length > 0 ? selected : ownTroops;
    if (troops.length > 0 && await act({ op: "order", battlefield: name, troops, order: "withdraw" })) setWarRoom({ selected: [] });
  };
  const sendBack = () => act({ op: "return", battlefield: name });

  // Esc shuts the room, once no tool is in hand (with one in hand it puts the
  // tool down: Map/WarRoomTools.jsx).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape" || getWarRoom().tool !== "pan") return;
      const typing = event.target instanceof HTMLElement && (event.target.tagName === "TEXTAREA" || event.target.tagName === "INPUT");
      if (!typing) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ---- the talk ------------------------------------------------------------------------
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(null);
  const [failure, setFailure] = useState(null);
  const [took, setTook] = useState([]);
  const abortRef = useRef(null);
  const gameIdRef = useRef(activeGame?.id);
  useEffect(() => {
    gameIdRef.current = activeGame?.id;
  }, [activeGame?.id]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  const say = async (text) => {
    const said = String(text ?? "").trim();
    if (!said || sending || !name) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setSending({ battlefield: name, text: said });
    setFailure(null);
    setTook([]);
    setInput("");
    try {
      if (isSimulationBusy()) throw new Error("A turn is being resolved: the generals answer once it has landed.");
      const answer = await generateWarRoomReply({ battlefield: name, message: said, signal: controller.signal });
      // The game was changed while they were answering: it is not this game's answer.
      if (controller.signal.aborted || (answer.campaignId && gameIdRef.current && answer.campaignId !== gameIdRef.current)) return;
      await sendWarRoomOp({ op: "talk", battlefield: answer.battlefield, said, lines: answer.lines, orders: answer.orders, names: answer.names }, { turnRunning: isSimulationBusy });
      setTook(answer.orders);
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") return;
      setFailure({ battlefield: name, text: said, reason: String(error?.message || error) });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(null);
    }
  };

  // The talk is kept at its end as it grows.
  const talkRef = useRef(null);
  useEffect(() => {
    const box = talkRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [talk.length, sending, failure, took, open, name]);

  const [resizing, setResizing] = useState(false);
  const startResize = useCallback((event) => {
    if (typeof onResize !== "function") return;
    event.preventDefault();
    const target = event.currentTarget;
    try { target.setPointerCapture(event.pointerId); } catch { /* optional */ }
    setResizing(true);
    const onMove = (moveEvent) => onResize(window.innerWidth - moveEvent.clientX);
    const onUp = () => {
      setResizing(false);
      onResizeEnd?.();
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }, [onResize, onResizeEnd]);

  // On a phone the panel is the whole screen, so the map is looked at by
  // folding the panel down to its tools.
  const [folded, setFolded] = useState(false);
  const foldedNow = isMobile && folded;
  // On a phone with the drawer folded down to show the map, how much of the screen's foot it still covers, in px:
  // the rail ends above it (warRoomRail.jsx). Its lower keys were under the drawer, out of reach (found at 375 px,
  // 2026-10-16).
  const [foot, setFoot] = useState(0);
  useEffect(() => {
    if (!open || !foldedNow || !rootRef.current) return undefined;
    const measure = () => setFoot(Math.max(0, Math.round(window.innerHeight - (rootRef.current?.getBoundingClientRect().top ?? window.innerHeight))));
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(rootRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, foldedNow]);
  // A fleet picked out, in the drawer or on its plate: the plate comes out beside
  // the rail, and on a phone the drawer folds down to the map it is beside.
  const pickFleet = useCallback((id) => {
    setWarRoom({ fleet: id, fleets: true, aircraft: false });
    if (isMobile) setFolded(true);
  }, [isMobile]);
  // And an air unit, on the aircraft's plate.
  const pickWing = useCallback((id) => {
    setWarRoom({ wing: id, aircraft: true, fleets: false });
    if (isMobile) setFolded(true);
  }, [isMobile]);
  const nameOf = (command) => generals.find((general) => general.command === command)?.name || "";
  const locked = turnRunning || busy;
  const other = record ? record.sides[1 - side] ?? [] : [];
  const mine = record ? record.sides[side] ?? [] : [];
  const ownPlans = plans.filter((plan) => !(plan.kind === "order" && !plan.chosen && plan.ways.length === 0));
  // A movement still to be made has its arrow on the map. One that time has
  // passed over is being carried out, or has been: it is listed apart, and its
  // arrow is off the map unless it is pointed at.
  const planned = ownPlans.filter((plan) => !plan.begun && !plan.done);
  const underWay = ownPlans.filter((plan) => plan.begun || plan.done);
  const planRow = (plan) => {
    const past = plan.begun || plan.done;
    const attacked = attackedBy(plan);
    const tone = planTone(plan);
    const redrawing = tool === "replan" && replan === plan.project;
    return (
      <div
        key={plan.id}
        onPointerEnter={() => setWarRoom({ pointed: plan.id })}
        style={{ ...trayStyle(pointed === plan.id), display: "flex", gap: "0.55rem", marginTop: "0.3rem", padding: "0.4rem 0.5rem" }}
      >
        <span aria-hidden="true" style={{ background: past ? PLAN_COLOURS.idle : PLAN_COLOURS[tone], flex: "0 0 auto", height: "0.22rem", marginTop: "0.45rem", width: "0.95rem" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>
            {plan.kind === "diversion" && <>Diversion</>}
            {plan.kind === "route" && <>Route</>}
            {plan.kind === "project" && <span data-no-translate>{plan.name}</span>}
            {plan.kind === "order" && (plan.name ? <span data-no-translate>{plan.name}</span> : <OrderWord order={plan.order} />)}
            {plan.objective && plan.kind !== "project" && <> toward <span data-no-translate>{placeName(plan.objective)}</span></>}
          </div>
          <div style={softText}>
            {plan.kind === "project" && <><OrderWord order={plan.order} />{plan.objective && <> toward <span data-no-translate>{placeName(plan.objective)}</span></>} · </>}
            {plan.kind === "diversion" && <>made to look like {plan.troops} formations</>}
            {plan.kind !== "diversion" && !plan.done && <>{plan.troops} formations</>}
            {plan.done && <>carried out</>}
            {plan.kind === "project" && !plan.done && <> · <ProjectStatus status={plan.status} /></>}
            {plan.kind === "project" && plan.off && <> · held back</>}
            {plan.kind === "project" && plan.edited && <> · redrawn</>}
            {plan.kind === "order" && !plan.chosen && plan.sector && plan.sector !== "all" && <> · <span data-no-translate>{plan.sector}</span></>}
          </div>
          {attacked.length > 0 && (
            <div style={{ color: AMBER, fontSize: "0.72rem", lineHeight: 1.4, marginTop: "0.12rem" }}>
              This route goes into <span data-no-translate>{attacked.join(", ")}</span>, which is not in this war. Sending troops along it is an attack: when they reach its border it is at war with you, and its land is fought over.
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.1rem" }}>
            {plan.kind === "project" && plan.own && !plan.done && (
              <>
                <button type="button" disabled={locked} onClick={() => takeTool("replan", { replan: plan.project })} style={linkStyle}>{redrawing ? <>Cancel</> : <>Redraw</>}</button>
                {plan.edited && <button type="button" disabled={locked} onClick={() => act({ op: "plan", battlefield: name, project: plan.project, way: [] })} style={linkStyle}>Suggested way</button>}
                <button type="button" disabled={locked} onClick={() => act({ op: "plan", battlefield: name, project: plan.project, off: !plan.off })} style={linkStyle}>{plan.off ? <>Let it go ahead</> : <>Hold it back</>}</button>
              </>
            )}
            {plan.kind === "project" && plan.own && plan.done && (
              <button type="button" disabled={locked} onClick={() => act({ op: "plan", battlefield: name, project: plan.project, again: true })} style={linkStyle}>Send it again</button>
            )}
            {plan.kind === "diversion" && <button type="button" disabled={locked} onClick={() => act({ op: "unplan", battlefield: name, id: plan.id })} style={linkStyle}>Remove</button>}
            {(plan.kind === "route" || (plan.kind === "order" && plan.chosen)) && plan.picked.length > 0 && (
              <>
                <button type="button" onClick={() => setWarRoom({ selected: plan.picked })} style={linkStyle}>Pick its troops</button>
                <button type="button" disabled={locked} onClick={() => act({ op: "release", battlefield: name, troops: plan.picked })} style={linkStyle}>Call it off</button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };
  const panelWidth = `calc(${width || WAR_ROOM_WIDTH} + ${SAFE_RIGHT})`;
  const plate = plateStyle();
  // The tools are out while the map is in sight: always beside the drawer, and
  // on a phone once the drawer is folded down to show the map.
  const railShown = open && Boolean(record) && (!isMobile || foldedNow);
  const railTop = isMobile ? `calc(${SAFE_TOP} + 0.6rem)` : `calc(${FRAME_BAR} + ${SAFE_TOP} + 0.7rem)`;

  return (
    <>
      <WarRoomRail
        shown={railShown}
        top={railTop}
        isMobile={isMobile}
        tool={tool}
        selected={selected}
        locked={locked}
        turnRunning={turnRunning}
        notice={notice}
        onTool={takeTool}
        onOrder={orderPicked}
        onRelease={releasePicked}
        own={ownTroops.length}
        away={away}
        onWithdraw={withdrawPicked}
        onReturn={sendBack}
        onClear={() => setWarRoom({ selected: [] })}
        carriers={carriers}
        onCarrier={(medium) => takeTool("transport", { medium })}
        canFortify={canFortify}
        drafted={Boolean(draft)}
        navies={navies}
        fleets={fleets.length}
        fleetsOut={fleetsOut}
        onFleets={() => setWarRoom({ fleets: !getWarRoom().fleets, aircraft: false })}
        station={station}
        deployForm={deployForm}
        onDeployForm={(form) => setWarRoom({ deployForm: form === "swarm" ? "swarm" : "front" })}
        aircraft={aircraft}
        wings={wings.length}
        aircraftOut={aircraftOut}
        onAircraft={() => setWarRoom({ aircraft: !getWarRoom().aircraft, fleets: false })}
        peace={record?.status === "standing"}
        home={record?.home === true}
        supply={supplyOn}
        onSupply={() => setWarRoom({ supply: !getWarRoom().supply })}
        supplyAreas={supplyShade?.areas ?? null}
        foot={open && foldedNow ? foot : 0}
      />

      {/* A fortified line drawn, waiting for its level and the word to build it; or else the fleets' plate. Both beside the rail. */}
      {railShown && draft && (
        <FortifyPlate
          isMobile={isMobile}
          draft={draft}
          level={level}
          world={world}
          country={game.country}
          gameDate={game.gameDate}
          locked={locked}
          onLevel={(value) => setWarRoom({ level: value })}
          onConfirm={buildLine}
          onRedraw={() => takeTool("fortify")}
          onCancel={() => setWarRoom({ draft: null })}
        />
      )}
      {railShown && !draft && fleetsOut && (
        <FleetsPlate
          isMobile={isMobile}
          fleets={fleets}
          picked={pickedFleet}
          enemies={enemies}
          convoys={convoys}
          locked={locked}
          tool={tool}
          station={station}
          onPick={pickFleet}
          onOrder={(op) => orderWith(sendFleetOp, op)}
          onPlace={(kind) => takeTool("fleet", { station: kind })}
          onClose={() => setWarRoom({ fleets: false })}
        />
      )}
      {railShown && !draft && !fleetsOut && aircraftOut && (
        <AircraftPlate
          isMobile={isMobile}
          wings={wings}
          picked={pickedWing}
          kind={strikeKind}
          reach={airReach}
          flown={strikesFlown}
          locked={locked}
          tool={tool}
          onPick={pickWing}
          onKind={(kind) => setWarRoom({ strikeKind: kind })}
          onAim={() => takeTool("aircraft")}
          onCallOff={(unit) => orderWith(sendAirStrikeOp, { op: "unairstrike", unit })}
          onClose={() => setWarRoom({ aircraft: false })}
        />
      )}

      {/* The frame of plate round the map: its bar says which battlefield this
          is and what day it is, now that the date widget is out of sight. */}
      {open && !isMobile && record && (
        <>
          <div data-oh-no-motion="" data-oh-war-room-frame="" style={{
            ...plate, position: "fixed", top: 0, left: 0, right: panelWidth, height: `calc(${FRAME_BAR} + ${SAFE_TOP})`, paddingTop: SAFE_TOP, boxSizing: "border-box",
            borderBottom: `2px solid ${STEEL.seam}`, boxShadow: "0 2px 8px rgba(0,0,0,0.5)", zIndex: 9996,
            alignItems: "center", display: "flex", gap: "0.8rem", paddingLeft: "1.5rem", paddingRight: "1.5rem",
          }}>
            <span aria-hidden="true" style={rivetStyle({ left: "0.45rem", bottom: "0.75rem" })} />
            <span aria-hidden="true" style={rivetStyle({ right: "0.45rem", bottom: "0.75rem" })} />
            <div data-no-translate style={{ ...stencilStyle, color: BONE, fontSize: "1rem", letterSpacing: "0.2em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.name}</div>
            <div style={{ ...stencilStyle, color: BONE_SOFT, fontSize: "0.74rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {record.home ? <><span data-no-translate>{mine.join(", ")}</span> · forces at home</> : <><span data-no-translate>{mine.join(", ")}</span> against <span data-no-translate>{other.join(", ")}</span></>}
              {record.status === "frozen" && <> · ceasefire</>}
              {record.status === "standing" && !record.home && <> · built up in peace</>}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ ...stencilStyle, flex: "0 0 auto", fontSize: "0.8rem" }}>{formatGameDateReadable(game.gameDate) || game.gameDate}</div>
          </div>
          <div data-oh-no-motion="" style={{ ...plate, position: "fixed", top: `calc(${FRAME_BAR} + ${SAFE_TOP})`, bottom: 0, left: 0, width: FRAME_STRIP, borderRight: `2px solid ${STEEL.seam}`, zIndex: 9996, pointerEvents: "none" }} />
          <div data-oh-no-motion="" style={{ ...plate, position: "fixed", bottom: 0, left: 0, right: panelWidth, height: FRAME_STRIP, borderTop: `2px solid ${STEEL.seam}`, zIndex: 9996, pointerEvents: "none" }} />
        </>
      )}

      <div
        ref={rootRef}
        data-oh-war-room=""
        style={{
          ...plate,
          position: "fixed",
          top: foldedNow ? "auto" : 0,
          bottom: 0,
          right: 0,
          transform: open ? "translateX(0)" : "translateX(100%)",
          ...(isMobile
            ? { left: 0, paddingTop: foldedNow ? 0 : SAFE_TOP, paddingBottom: SAFE_BOTTOM, paddingLeft: SAFE_LEFT, paddingRight: SAFE_RIGHT, boxSizing: "border-box" }
            : { width: panelWidth, paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM, paddingRight: SAFE_RIGHT, boxSizing: "border-box", borderLeft: `3px solid ${STEEL.seam}` }),
          zIndex: isMobile ? 10040 : 9997,
          boxShadow: open ? `inset 1px 0 0 ${STEEL.lip}, -6px 0 26px rgba(0,0,0,0.55)` : "none",
          transition: `transform ${ADVISOR_SLIDE}, box-shadow ${ADVISOR_SLIDE}`,
          display: "flex",
          flexDirection: "column",
          color: BONE,
          fontFamily: "sans-serif",
          overflow: "hidden",
        }}
      >
        {typeof onResize === "function" && !isMobile && (
          <div
            onPointerDown={startResize}
            title="Drag to resize"
            style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "10px", cursor: "ew-resize", zIndex: 30, touchAction: "none", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <div style={{ width: "3px", height: "42px", borderRadius: "1px", backgroundColor: resizing ? AMBER : "rgba(236,231,218,0.24)" }} />
          </div>
        )}

        {/* The head: what this is, and the way out. A band of red across the top of it. */}
        <div style={{ alignItems: "center", background: "rgba(0,0,0,0.4)", borderBottom: `2px solid ${STEEL.seam}`, borderTop: `4px solid ${RED}`, boxShadow: `0 1px 0 ${STEEL.lip}`, display: "flex", gap: "0.55rem", padding: "0.62rem 1.25rem 0.62rem 1.3rem", position: "relative" }}>
          <span aria-hidden="true" style={rivetStyle({ left: "0.4rem", top: "0.4rem" }, "0.5rem")} />
          <span aria-hidden="true" style={rivetStyle({ left: "0.4rem", bottom: "0.4rem" }, "0.5rem")} />
          <span aria-hidden="true" style={rivetStyle({ right: "0.4rem", top: "0.4rem" }, "0.5rem")} />
          <span aria-hidden="true" style={rivetStyle({ right: "0.4rem", bottom: "0.4rem" }, "0.5rem")} />
          <div style={{ minWidth: 0 }}>
            <div style={{ ...stencilStyle, color: BONE, fontSize: "1.25rem", letterSpacing: "0.24em", lineHeight: 1 }}>War Room</div>
            {record && isMobile && (
              <div style={{ ...softText, fontSize: "0.66rem", marginTop: "0.2rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {record.home ? <><span data-no-translate>{mine.join(", ")}</span> · forces at home</> : <><span data-no-translate>{mine.join(", ")}</span> against <span data-no-translate>{other.join(", ")}</span></>}
                {record.status === "frozen" && <> · ceasefire</>}
                {record.status === "standing" && !record.home && <> · built up in peace</>}
              </div>
            )}
          </div>
          <div style={{ flex: 1 }} />
          {isMobile && (
            <button type="button" className="oh-tap" onClick={() => setFolded((value) => !value)} style={keyStyle(false, false)}>
              {foldedNow ? <>Generals</> : <>Map</>}
            </button>
          )}
          <button type="button" className="oh-tap" onClick={() => setWarRoom({ fit: getWarRoom().fit + 1 })} title="Show the whole battlefield" aria-label="Show the whole battlefield" style={{ ...keyStyle(false, false), padding: "0.42rem 0.5rem" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          </button>
          <button type="button" className="oh-tap" onClick={onClose} title="Close the war room" aria-label="Close the war room" style={{ ...keyStyle(false, false), padding: "0.42rem 0.55rem" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
          </button>
        </div>

        {/* A tab a battlefield, when there is more than one. */}
        {fronts.length > 1 && (
          <div role="tablist" aria-label="Battlefields" style={{ background: "rgba(0,0,0,0.26)", borderBottom: `1px solid ${STEEL.seam}`, display: "flex", gap: "0.3rem", overflowX: "auto", padding: "0.45rem 0.7rem" }}>
            {fronts.map((entry) => {
              const on = front && entry.name === front.name;
              return (
                <button
                  key={entry.name}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className="oh-tap"
                  data-no-translate
                  onClick={() => showBattlefield(entry.name, entry.side)}
                  style={{ ...keyStyle(on, false), display: "block", flex: "0 0 auto", maxWidth: "14rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >{entry.name}</button>
              );
            })}
          </div>
        )}

        {!record && (
          <div style={{ ...softText, fontSize: "0.85rem", padding: "1.5rem 1rem", textAlign: "center" }}>Your troops are on no battlefield.</div>
        )}

        {record && (
          <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0 }}>
            {/* The troop tools are on the rail at the left of the map (warRoomRail.jsx): here, only where they are and when orders are carried out. */}
            <div style={{ borderBottom: `1px solid ${STEEL.seam}`, boxShadow: `0 1px 0 ${STEEL.lip}`, flex: "0 0 auto", padding: "0.5rem 0.8rem 0.5rem" }}>
              {isMobile && fronts.length === 1 && <div data-no-translate style={{ ...stencilStyle, color: BONE, marginBottom: "0.35rem" }}>{record.name}</div>}
              <div style={softText}>
                {turnRunning ? <>A turn is being resolved. Orders are taken once it has landed.</> : <>Nothing moves here: orders are carried out when time next passes.</>}
                {isMobile && !foldedNow ? <> The troop tools are beside the map: press Map to use them.</> : <> The troop tools are on the left of the map.</>}
              </div>
            </div>
            <div style={{ borderBottom: foldedNow ? "none" : `2px solid ${STEEL.seam}`, display: foldedNow ? "none" : "block", flex: "0 1 auto", maxHeight: "44%", overflowY: "auto", padding: "0.7rem 0.8rem 0.8rem" }}>

              {/* The key: who commands which troops. */}
              {!foldedNow && (
                <div onPointerLeave={() => setWarRoom({ highlight: -1 })} style={{ marginBottom: "0.8rem" }}>
                  <Heading>Your generals</Heading>
                  {generals.length === 0 && (
                    <div style={{ ...softText, marginTop: "0.4rem" }}>No general has a command here yet. They are given their commands when time next passes.</div>
                  )}
                  {generals.map((general) => {
                    const lit = highlight === general.command;
                    // What he has been told, with how many of his own troops each order is for.
                    const own = new Set(general.troops);
                    const told = orders
                      .map((order) => ({ ...order, mine: order.troops.filter((troop) => own.has(troop)).length }))
                      .filter((order) => order.mine > 0);
                    return (
                      <div
                        key={general.command}
                        data-oh-war-room-general={general.command}
                        onPointerEnter={() => setWarRoom({ highlight: general.command })}
                        onClick={() => setWarRoom({ highlight: lit && isMobile ? -1 : general.command })}
                        style={{ ...trayStyle(lit), display: "flex", gap: "0.55rem", marginTop: "0.3rem", padding: "0.34rem 0.5rem" }}
                      >
                        <Tag number={general.command + 1} lit={lit} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ alignItems: "baseline", display: "flex", gap: "0.4rem" }}>
                            <span data-no-translate style={{ fontSize: "0.84rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{general.name || commandTitle(general.command)}</span>
                            {general.name && <span data-no-translate style={{ ...stencilStyle, color: BONE_FAINT, flex: "0 0 auto", fontSize: "0.68rem" }}>{commandTitle(general.command)}</span>}
                          </div>
                          <div style={{ ...softText, marginTop: "0.1rem" }}>
                            {general.n} formations at {general.pct}% · <DoingWord doing={general.doing} />
                            {general.at && <> near <span data-no-translate>{placeName(general.at)}</span></>}
                            {general.cut > 0 && <> · {general.cut} cut off</>}
                          </div>
                          {told.map((order) => (
                            <div key={order.index} style={{ color: AMBER, fontSize: "0.72rem", marginTop: "0.12rem" }}>
                              Ordered: {order.way ? <>a route drawn for {order.mine}</> : <><OrderWord order={order.order} />{order.objective && <> toward <span data-no-translate>{placeName(order.objective)}</span></>}{order.mine < general.n && <> ({order.mine})</>}</>}
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="oh-tap"
                          onClick={(event) => { event.stopPropagation(); setWarRoom({ selected: general.troops, highlight: general.command }); }}
                          title="Pick out this general's troops"
                          style={{ ...linkStyle, alignSelf: "center", flex: "0 0 auto" }}
                        >Pick</button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* The weather of the days ahead (warRoomWeather.jsx): what will come, to time an offensive by. */}
              {!foldedNow && Array.isArray(record.brief?.forecast) && record.brief.forecast.length > 0 && (
                <div style={{ marginTop: "0.85rem" }}>
                  <Heading>Weather ahead</Heading>
                  <WeatherAhead forecast={record.brief.forecast} gameDate={game.gameDate} />
                </div>
              )}

              {/* Every movement meant and not yet made. */}
              {!foldedNow && (
                <div onPointerLeave={() => setWarRoom({ pointed: "" })} style={{ marginTop: "0.85rem" }}>
                  <Heading>Planned movements</Heading>
                  {/* The week ahead, fought ahead of time with these orders (warRoomRehearsal.jsx). */}
                  <RehearsalTray record={record} side={side} gameDate={game.gameDate} locked={locked} />
                  {planned.length === 0 && (
                    <div style={{ ...softText, marginTop: "0.4rem" }}>None. A route you draw, an order a general takes, and an operation on your Board that sends troops at a place here all show on the map as arrows.</div>
                  )}
                  {planned.map(planRow)}
                  {deployLine && (
                    <div
                      onPointerEnter={() => setWarRoom({ pointed: "deploy" })}
                      style={{ ...trayStyle(pointed === "deploy"), display: "flex", gap: "0.55rem", marginTop: "0.3rem", padding: "0.4rem 0.5rem" }}
                    >
                      {deployLine.form === "swarm"
                        ? <span aria-hidden="true" style={{ border: `2px solid ${PLAN_COLOURS.deploy}`, borderRadius: "50%", boxSizing: "border-box", flex: "0 0 auto", height: "0.8rem", marginTop: "0.2rem", width: "0.8rem" }} />
                        : <span aria-hidden="true" style={{ background: PLAN_COLOURS.deploy, flex: "0 0 auto", height: "0.22rem", marginTop: "0.45rem", width: "0.95rem" }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {deployLine.form === "swarm"
                          ? <>
                            <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>Swarm deployment</div>
                            <div style={softText}>Your new troops here gather at this place as a swarm, under one general of their own: levies, drafts and reinforcements.</div>
                          </>
                          : <>
                            <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>Deployment line</div>
                            <div style={softText}>Your new troops here come in along it: levies, drafts and reinforcements.</div>
                          </>}
                        {/* The formations it calls up when time next passes, or what came of the last it called up. */}
                        {calling !== undefined && (
                          <div data-oh-war-room-deploy-call="" style={{ ...softText, color: BONE, marginTop: "0.15rem" }}>
                            {calling === "usual"
                              ? <>Fresh formations come in here when time next passes: as many as a draft usually brings.</>
                              : calling === 1
                                ? <>1 fresh formation comes in here when time next passes.</>
                                : <>{calling} fresh formations come in here when time next passes.</>}
                          </div>
                        )}
                        {calling === undefined && deployLine.last && (
                          <div data-oh-war-room-deploy-call="" style={{ ...softText, color: called > 0 ? BONE_SOFT : AMBER, marginTop: "0.15rem" }}>
                            {called === 1
                              ? <>1 fresh formation came in here on {calledOn}.</>
                              : called > 0
                                ? <>{called} fresh formations came in here on {calledOn}.</>
                                : calledWhy === "men"
                                  ? <>None could be called up on {calledOn}: your country has no more men fit to serve.</>
                                  : calledWhy === "full"
                                    ? <>None could be called up on {calledOn}: this battlefield holds as many of your troops as it can.</>
                                    : calledWhy === "ground"
                                      ? <>None could be called up on {calledOn}: your side holds no ground along it.</>
                                      : calledWhy === "halted"
                                        ? <>None could be called up on {calledOn}: the fighting here has halted.</>
                                        : <>None could be called up on {calledOn}.</>}
                          </div>
                        )}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.1rem" }}>
                          <button type="button" disabled={locked} onClick={() => takeTool("deploy")} style={linkStyle}>{tool === "deploy" ? <>Cancel</> : <>Redraw</>}</button>
                          <button type="button" disabled={locked} onClick={() => act({ op: "deploy", battlefield: name, way: [] })} style={linkStyle}>Remove</button>
                        </div>
                      </div>
                    </div>
                  )}
                  {ownPlans.some((plan) => plan.kind === "diversion") && (
                    <div style={{ ...softText, color: intel.double ? AMBER : BONE_SOFT, marginTop: "0.35rem" }}>
                      {intel.double
                        ? <>The agent of theirs you turned will send them your diversions in place of your plans.</>
                        : <>You have turned no agent of theirs, so there is nobody to show a diversion to. An agent of theirs you have not caught sends them your real plans.</>}
                    </div>
                  )}

                  {underWay.length > 0 && (
                    <>
                      <Heading style={{ marginTop: "0.8rem" }}>Under way</Heading>
                      <div style={{ ...softText, marginTop: "0.3rem" }}>Time has passed over these, so their arrows are off the map. Point at one to see what is left of it.</div>
                      {underWay.map(planRow)}
                    </>
                  )}

                  {/* Who fights beside the player: each commands its own troops, and its leader is who a plan is agreed with. */}
                  {allies.length > 0 && (
                    <>
                      <Heading style={{ marginTop: "0.8rem" }}>Allies</Heading>
                      <div style={{ ...softText, marginTop: "0.3rem" }}>Each ally commands its own troops here. Agree a plan with its leader, and its troops carry it out when time passes.</div>
                      {allies.map((ally) => (
                        <div key={ally.name} data-oh-war-room-ally="" style={{ ...trayStyle(false), marginTop: "0.3rem", padding: "0.4rem 0.5rem" }}>
                          <div data-no-translate style={{ fontSize: "0.8rem", fontWeight: 700 }}>{ally.name}</div>
                          <div style={softText}>
                            {ally.n} formations
                            {ally.orders.length === 0
                              ? <> · no orders of its own yet</>
                              : ally.orders.map((order, index) => <React.Fragment key={index}> · <OrderWord order={order.order} /></React.Fragment>)}
                          </div>
                          <button type="button" onClick={() => talkTo(ally.name)} style={linkStyle}>Talk strategy with its leader</button>
                        </div>
                      ))}
                    </>
                  )}

                  {/* The transporters: this side's, and the other side's that are on their way. */}
                  {(ownTransports.length > 0 || theirTransports.length > 0) && (
                    <>
                      <Heading style={{ marginTop: "0.8rem" }}>Transporters</Heading>
                      {ownTransports.map((entry) => {
                        const found = transportWays?.[entry.id] ?? null;
                        return (
                          <div key={entry.id} data-oh-war-room-transport={entry.status} style={{ ...trayStyle(false), marginTop: "0.3rem", padding: "0.4rem 0.5rem" }}>
                            <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>
                              <span data-no-translate>{entry.kind}</span>{entry.to.name ? <> bound for <span data-no-translate>{placeName(entry.to.name)}</span></> : <> bound for a place on the map</>}
                            </div>
                            <div style={softText}>
                              {loadOf(entry)} formations <MediumWord medium={entry.medium} />
                              {entry.status === "ordered" && <> · sets out when time next passes</>}
                              {entry.status === "moving" && <> · on its way, due {formatGameDateReadable(entry.due) || entry.due}</>}
                              {entry.status === "landed" && <> · put its troops down on {formatGameDateReadable(entry.ended) || entry.ended}</>}
                              {entry.status === "lost" && <> · lost on the way on {formatGameDateReadable(entry.ended) || entry.ended}</>}
                              {entry.status === "returned" && <> · turned back: <WayRefusal code={entry.note} /></>}
                              {entry.status === "refused" && <> · did not set out: <WayRefusal code={entry.note} /></>}
                              {entry.sunk > 0 && entry.status !== "lost" && <> · {entry.sunk} lost on the way</>}
                            </div>
                            {entry.status === "ordered" && found && !found.error && (
                              <div style={softText}>{found.days === 1 ? <>About a day</> : <>About {found.days} days</>} {found.arrived === false ? <>to where its line ends</> : <>on the way found for it</>} ({found.km} km).</div>
                            )}
                            {entry.status === "ordered" && found?.error && (
                              <div style={{ color: AMBER, fontSize: "0.72rem", lineHeight: 1.4 }}>It cannot set out as things stand: <WayRefusal code={found.error} />.</div>
                            )}
                            {entry.status === "ordered" && (
                              <button type="button" disabled={locked} onClick={() => act({ op: "untransport", battlefield: name, id: entry.id })} style={linkStyle}>Call it off</button>
                            )}
                          </div>
                        );
                      })}
                      {theirTransports.map((entry) => {
                        const hunted = entry.hunters.some((hunter) => sameName(hunter, game.country));
                        return (
                          <div key={entry.id} data-oh-war-room-transport="theirs" style={{ ...trayStyle(false), marginTop: "0.3rem", padding: "0.4rem 0.5rem" }}>
                            <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>
                              <span data-no-translate>{entry.owner}</span>: <span data-no-translate>{entry.kind}</span>{entry.to.name && <> bound for <span data-no-translate>{placeName(entry.to.name)}</span></>}
                            </div>
                            <div style={softText}>
                              About {loadOf(entry)} formations <MediumWord medium={entry.medium} /> · due {formatGameDateReadable(entry.due) || entry.due}
                              {hunted && <> · your forces are after it</>}
                            </div>
                            <button type="button" disabled={locked || !isUnderWay(entry)} onClick={() => act({ op: "hunt", battlefield: name, id: entry.id, off: hunted })} style={linkStyle}>{hunted ? <>Call off the hunt</> : <>Go after it</>}</button>
                          </div>
                        );
                      })}
                    </>
                  )}

                  {/* The player's fleets, commanded from the plate beside the rail, and its fortified lines (warRoomFleets.jsx, warRoomFortify.jsx). */}
                  <FleetsList fleets={fleets} picked={pickedFleet} onPick={pickFleet} />
                  <AircraftList orders={strikesWaiting} flown={strikesFlown} names={wingName} onPick={pickWing} />
                  <LinesList world={world} country={game.country} gameDate={game.gameDate} locked={locked} onStop={(id) => orderWith(sendFortifyOp, { op: "unfortify", id })} />

                  <Heading style={{ marginTop: "0.8rem" }}>What is known of theirs</Heading>
                  {theirEdge && (
                    <div data-oh-war-room-edge="" style={{ ...softText, marginTop: "0.4rem" }}>
                      At this difficulty their troops here fight at {theirEdge.power}% of their strength and advance at {theirEdge.pace}% of their pace, with {theirEdge.reserves}% of the usual reserves.
                    </div>
                  )}
                  {theirCommander && (
                    <div data-oh-war-room-commander={theirCommander} style={{ ...softText, marginTop: "0.4rem" }}>
                      {theirCommander === "plainer"
                        ? <>At this difficulty their staff is a plainer one: it looks less far ahead and weighs fewer plans.</>
                        : <>At this difficulty their staff weighs each of its plans against how you are likely to answer it.</>}
                    </div>
                  )}
                  {theirPlan?.by === "agent" && (
                    <div data-oh-war-room-their-plan="agent" style={{ ...trayStyle(false), marginTop: "0.4rem", padding: "0.4rem 0.5rem" }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>Their staff's plan: <StaffPlanWord plan={theirPlan.plan} /></div>
                      <div style={softText}>
                        {theirPlan.at && <>Aimed at <span data-no-translate>{placeName(theirPlan.at)}</span>{theirPlan.n > 0 && <>, with about {theirPlan.n} formations sent forward</>}. </>}
                        Decided on {formatGameDateReadable(theirPlan.since) || theirPlan.since}.
                      </div>
                    </div>
                  )}
                  {theirPlan?.by === "air" && (
                    <div data-oh-war-room-their-plan="air" style={{ ...trayStyle(false), marginTop: "0.4rem", padding: "0.4rem 0.5rem" }}>
                      <div style={softText}>Your aircraft over the front see about {theirPlan.n} of their formations on the move toward <span data-no-translate>{placeName(theirPlan.at)}</span>. An agent in one of their countries would tell you what their staff means by it.</div>
                    </div>
                  )}
                  {intel.plans.length === 0 && !theirPlan && (
                    <div style={{ ...softText, marginTop: "0.4rem" }}>
                      {espionage
                        ? <>Nothing. An agent inside one of their countries would send their planned movements here.</>
                        : <>Nothing.</>}
                    </div>
                  )}
                  {intel.plans.map((plan) => (
                    <div
                      key={plan.id}
                      onPointerEnter={() => setWarRoom({ pointed: plan.id })}
                      style={{ ...trayStyle(pointed === plan.id), display: "flex", gap: "0.55rem", marginTop: "0.3rem", padding: "0.4rem 0.5rem" }}
                    >
                      <span aria-hidden="true" style={{ background: PLAN_COLOURS.known, flex: "0 0 auto", height: "0.22rem", marginTop: "0.45rem", width: "0.95rem" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>
                          {plan.name ? <span data-no-translate>{plan.name}</span> : <OrderWord order={plan.order} />}
                          {plan.objective && <> toward <span data-no-translate>{placeName(plan.objective)}</span></>}
                        </div>
                        <div style={softText}>
                          {plan.troops > 0 && <>about {plan.troops} formations</>}
                          {plan.doubted && <> · doubted</>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {intel.sources.length > 0 && (
                    <div style={{ color: BONE_FAINT, fontSize: "0.68rem", marginTop: "0.3rem" }}>
                      From your agent in <span data-no-translate>{[...new Set(intel.sources.map((source) => source.inside))].join(", ")}</span>.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* The talk with the generals: a tray let into the plate. */}
            {!foldedNow && (
              <div style={{ background: "rgba(0,0,0,0.3)", display: "flex", flex: "1 1 0", flexDirection: "column", minHeight: "9rem" }}>
                <div ref={talkRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0.6rem 0.8rem" }}>
                  {talk.length === 0 && !sending && !failure && (
                    <div style={{ ...softText, fontSize: "0.78rem", lineHeight: 1.45, padding: "0.4rem 0.2rem" }}>
                      Speak to your generals. Tell them what you want done and they will say what they think of it; an order they accept is carried out when time next passes.
                    </div>
                  )}
                  {talk.map((line, index) => (
                    <TalkLine key={`${index}:${line.who}`} line={line} name={line.who === "" ? "" : nameOf(line.who)} />
                  ))}
                  {sending && sending.battlefield === name && (
                    <>
                      <TalkLine line={{ who: "", text: sending.text }} name="" />
                      <div role="status" style={{ ...softText, fontSize: "0.74rem", padding: "0.2rem 0.2rem 0.4rem" }}>The generals are conferring…</div>
                    </>
                  )}
                  {!sending && took.length > 0 && took.map((order) => (
                    <div key={order.command} style={{ color: AMBER, fontSize: "0.72rem", padding: "0.1rem 0.2rem" }}>
                      <span data-no-translate>{nameOf(order.command) || commandTitle(order.command)}</span>: <OrderWord order={order.order} />{order.objective && <> toward <span data-no-translate>{placeName(order.objective)}</span></>}. Carried out when time next passes.
                    </div>
                  ))}
                  {failure && failure.battlefield === name && !sending && (
                    <div role="alert" style={{ ...trayStyle(false), margin: "0.3rem 0", padding: "0.6rem 0.7rem" }}>
                      <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>The generals could not be reached.</div>
                      {failure.reason && <div data-no-translate style={{ ...softText, marginTop: "0.25rem", overflowWrap: "anywhere" }}>{failure.reason}</div>}
                      <button type="button" className="oh-tap" onClick={() => say(failure.text)} style={{ ...keyStyle(false, false), marginTop: "0.45rem" }}>Try again</button>
                    </div>
                  )}
                </div>
                <form
                  onSubmit={(event) => { event.preventDefault(); say(input); }}
                  style={{ ...plate, alignItems: "flex-end", borderTop: `2px solid ${STEEL.seam}`, boxShadow: `inset 0 1px 0 ${STEEL.lip}`, display: "flex", gap: "0.45rem", padding: "0.55rem 0.7rem" }}
                >
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        say(input);
                      }
                    }}
                    rows={2}
                    maxLength={700}
                    disabled={generals.length === 0}
                    placeholder="Speak to your generals…"
                    aria-label="Speak to your generals"
                    style={{ backgroundColor: "rgba(0,0,0,0.5)", borderTop: `1px solid ${STEEL.sunkLine}`, borderLeft: `1px solid ${STEEL.sunkLine}`, borderRight: `1px solid ${STEEL.lip}`, borderBottom: `1px solid ${STEEL.lip}`, borderRadius: "3px", color: BONE, flex: 1, fontFamily: "inherit", fontSize: "0.85rem", outline: "none", padding: "0.5rem 0.65rem", resize: "none" }}
                  />
                  <button
                    type="submit"
                    className="oh-tap"
                    disabled={Boolean(sending) || !input.trim() || generals.length === 0}
                    title="Send"
                    aria-label="Send"
                    style={{ ...keyStyle(true, Boolean(sending) || !input.trim()), height: "2.6rem", justifyContent: "center", padding: 0, width: "2.6rem" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

// One line of the talk: the commander's on the right, in red; a general's on
// the left, in drab, under his name. What a general says is the model's, in
// the game's language.
const TalkLine = ({ line, name }) => {
  const own = line.who === "";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: own ? "flex-end" : "flex-start", margin: "0.35rem 0" }}>
      {!own && (
        <div style={{ ...stencilStyle, fontSize: "0.7rem", margin: "0 0 0.15rem 0.1rem" }}>
          <span data-no-translate>{name || commandTitle(line.who)}</span>
          {name && <span data-no-translate style={{ color: BONE_FAINT }}> · {commandTitle(line.who)}</span>}
        </div>
      )}
      <div
        data-no-translate
        style={{
          background: own ? RED_DARK : OLIVE,
          borderTop: `1px solid ${own ? RED_BRIGHT : OLIVE_LINE}`,
          borderLeft: `1px solid ${own ? RED : OLIVE_LINE}`,
          borderRight: `1px solid ${STEEL.seam}`,
          borderBottom: `1px solid ${STEEL.seam}`,
          borderRadius: "3px",
          color: BONE,
          fontSize: "0.84rem",
          lineHeight: 1.45,
          maxWidth: "92%",
          overflowWrap: "anywhere",
          padding: "0.5rem 0.7rem",
          whiteSpace: "pre-wrap",
        }}
      >{line.text}</div>
    </div>
  );
};

export { WarRoomPanel };
