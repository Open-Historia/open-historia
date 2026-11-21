/*! Open Historia - source-linked Project Finance player review. AGPL-3.0-or-later. */
import { readWorldState, readGameData, readEventsState, mutateWorldState } from "./gameState.js";
import { getLibraryState } from "./library.js";
import { unseenEvents } from "./unseenEvents.js";
import { inSharedGame, sharedGameRole } from "../multiplayer/client/sharedGameBridge.js";
import { hostingSharedGame } from "./humanPolities.js";
import { isSimulationBusy, enterSimulation, endSimulation } from "../Game/AI/simulationStatus.js";
import { bookProjectFinance, eligibleFinanceSource, financeReviewStamp } from "./projectFinanceWorld.js";
import { buildOwnerAliasMap, createOwnerResolver, toCountryName } from "./ownerNames.js";

const shared=()=>inSharedGame()||Boolean(sharedGameRole())||hostingSharedGame();
const checkCampaign=id=>{
  if(!id||getLibraryState().activeGameId!==id||shared())throw new Error("Project Finance requires the same active single-player campaign.");
};
const checkWorld=world=>{
  if(world?.activeInteractive||unseenEvents.unseenFor(world).size)throw new Error("Finish revealing the turn or interactive scene before reviewing financing.");
  if(world?.projectFundingMode==="nonmonetary")throw new Error("Project Finance is unavailable in non-monetary campaigns.");
};
export const captureFinanceReview=async()=>{
  const campaignId=getLibraryState().activeGameId;
  checkCampaign(campaignId);
  if(isSimulationBusy())throw new Error("Finish the current simulation before reviewing financing.");
  const first=await readGameData({force:true});
  const [world,events]=await Promise.all([readWorldState({force:true}),readEventsState({force:true})]);
  const game=await readGameData({force:true});
  checkCampaign(campaignId);checkWorld(world);
  if(isSimulationBusy()||first.round!==game.round||first.country!==game.country||first.gameDate!==game.gameDate)throw new Error("Campaign changed; reopen the finance review.");
  const resolve=createOwnerResolver(buildOwnerAliasMap(world.polityOverrides));
  const actor=resolve(toCountryName(game.country));
  return {campaignId,game,world,actor,stamp:financeReviewStamp(world,game),events:events.filter(e=>eligibleFinanceSource(e,actor,resolve))};
};
export const commitFinanceReview=async(review,command)=>{
  checkCampaign(review.campaignId);
  if(isSimulationBusy())throw new Error("Finish the current simulation before confirming financing.");
  // Acquire the same simulation lock as Stats and time advancement before
  // entering the canonical queue. No model call while holding either lock.
  await enterSimulation();
  try{
    checkCampaign(review.campaignId);
    return await mutateWorldState(async world=>{
      checkCampaign(review.campaignId);checkWorld(world);
      const [game,events]=await Promise.all([readGameData({force:true}),readEventsState({force:true})]);
      checkCampaign(review.campaignId);checkWorld(world);
      return bookProjectFinance({world,game,events,command,expected:review.stamp,shared:shared(),unseen:unseenEvents.unseenFor(world).size>0});
    });
  }finally{endSimulation();}
};
