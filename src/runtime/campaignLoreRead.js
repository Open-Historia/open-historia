/*! Open Historia - native campaign lore snapshot intake. AGPL-3.0-or-later. */
import { JSON_URLS, readJson } from "./assets.js";
import { getLibraryState } from "./library.js";
import { unseenEvents } from "./unseenEvents.js";
import { inSharedGame } from "../multiplayer/client/sharedGameBridge.js";
import { isSimulationBusy } from "../Game/AI/simulationStatus.js";
import { buildCampaignLore } from "./campaignLore.js";

const epoch = game => JSON.stringify([game?.country, game?.gameDate, game?.round, game?.startDate]);
const captureKeys = options => ["game","world","events", ...(options.actions ? ["actions"] : []), ...(options.conversations ? ["chat","advisor"] : [])];
const stale = () => new Error("Campaign changed while reading its record. Reopen Campaign Lore and try again.");
const invalidators = ["oh:active-game-changed","oh:rolled-back","oh:runtime-json-updated","oh:unseen-events-changed"];

// Read by captured asset URLs, never by re-resolving an active save mid-read.
// Do not silently turn a missing/failed read into a fabricated empty history.
export const captureCampaignLore = async (options = {}, {
  library = getLibraryState, endpoints = JSON_URLS, read = readJson,
  shared = inSharedGame, busy = isSimulationBusy, unseen = world=>unseenEvents.unseenFor(world),
  target = typeof window !== "undefined" ? window : null,
} = {}) => {
  const state=library(), id=state?.activeGameId;
  if (!id || state?.activeGame?.id !== id || shared()) throw new Error("Campaign Lore is available in an active single-player campaign.");
  if (busy()) throw new Error("Finish the current simulation before exporting campaign history.");
  const keys=captureKeys(options), urls=Object.fromEntries(keys.map(k=>[k,endpoints[k]]));
  if(Object.values(urls).some(url=>!url))throw stale();
  let changed=false;
  const invalidate=()=>{changed=true;};
  for(const event of invalidators)target?.addEventListener(event,invalidate);
  const check=()=>{
    if(changed || busy() || shared() || library()?.activeGameId!==id || keys.some(k=>endpoints[k]!==urls[k]))throw stale();
  };
  const fetchKey=async key=>{
    try{return await read(urls[key],{force:true,cache:false});}
    catch(error){if((key==="chat"||key==="advisor")&&error?.status===404)return [];throw error;}
  };
  try {
    const before=await fetchKey("game");
    check();
    const pairs=await Promise.all(keys.filter(k=>k!=="game").map(async key=>[key,await fetchKey(key)]));
    const data=Object.fromEntries(pairs);
    check();
    const game=await fetchKey("game");
    check();
    if(!game || typeof game!=="object" || !game.country || !game.gameDate || epoch(before)!==epoch(game))throw stale();
    if(!data.world || typeof data.world!=="object" || Array.isArray(data.world) || !data.events || typeof data.events!=="object" || keys.some(key=>["actions","chat","advisor"].includes(key)&&!Array.isArray(data[key])))throw new Error("The campaign history could not be read.");
    if(unseen(data.world).size)throw new Error("Finish revealing the current turn's events before exporting campaign history.");
    return buildCampaignLore({metadata:{name:state.activeGame.name,scenario:state.runtimeScenario?.name},game,world:data.world,
      events:data.events,actions:data.actions,chats:data.chat,advisor:data.advisor}, options);
  } finally {
    for(const event of invalidators)target?.removeEventListener(event,invalidate);
  }
};
