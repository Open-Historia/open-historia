/*! Open Historia - player-confirmed publication, no AI write path. AGPL-3.0-or-later. */
import { readGameData,readWorldState,readAdvisorMessages,mutateCanonicalTurnState } from "./gameState.js";
import { getLibraryState } from "./library.js";
import { unseenEvents } from "./unseenEvents.js";
import { inSharedGame,sharedGameRole } from "../multiplayer/client/sharedGameBridge.js";
import { hostingSharedGame } from "./humanPolities.js";
import { isSimulationBusy,enterSimulation,endSimulation } from "../Game/AI/simulationStatus.js";
import { advisorMessagesFor,CHIEF_ADVISOR_THREAD } from "./advisorThreads.js";
import { parseAdvisorReply } from "../Game/GameUI/advisorReply.js";
import { planPublicPublication,planPublicCancellation,publicIssuer,publicIssuerOptions,publicAudienceOptions,normalizePublicDraft } from "./publicCommunications.js";
const shared=()=>inSharedGame()||Boolean(sharedGameRole())||hostingSharedGame();
const check=(id,world)=>{
  if(!id||getLibraryState().activeGameId!==id||shared())throw new Error("Public statements currently require the same single-player campaign.");
  if(world.activeInteractive||unseenEvents.unseenFor(world).size)throw new Error("Finish the current scene or event reveal first.");
};
export const capturePublicReview=async()=>{
  const campaignId=getLibraryState().activeGameId;
  if(isSimulationBusy())throw new Error("Finish the current simulation first.");
  const game=await readGameData({force:true}),world=await readWorldState({force:true}),latest=await readGameData({force:true});
  check(campaignId,world);
  if(isSimulationBusy()||latest.round!==game.round||latest.gameDate!==game.gameDate||latest.country!==game.country)throw new Error("Campaign changed; reopen the statement.");
  return {campaignId,expected:{country:game.country,date:game.gameDate,round:game.round},...publicIssuer(world,game),...publicIssuerOptions(world,game),...publicAudienceOptions(world)};
};
export const commitPublicReview=async({review,draft,draftId,replyId,index=-1,confirmed})=>{
  if(!replyId)throw new Error("A saved chief advisor draft is required.");
  if(isSimulationBusy())throw new Error("Finish the current simulation first.");
  await enterSimulation();
  try{
    return await mutateCanonicalTurnState(async current=>{
      check(review.campaignId,current.world);
      const rows=advisorMessagesFor(await readAdvisorMessages({force:true}),CHIEF_ADVISOR_THREAD).filter(m=>m.id===replyId&&m.role==="advisor");
      if(rows.length!==1||!parseAdvisorReply(rows[0].text).publicDrafts?.[index]||draftId!==replyId+":public:"+index)throw new Error("The saved chief advisor draft is no longer available.");
      const selected=draft.issuerId||review.defaultIssuerId;
      const issuer=publicIssuer(current.world,current.game,selected);
      if(issuer.polity!==review.polity||issuer.issuer!==review.issuers.find(p=>p.id===selected)?.label)throw new Error("Issuing government changed; reopen the statement.");
      if(selected!==review.selectedIssuerId||!review.approvedDraft||JSON.stringify(normalizePublicDraft({...draft,issuerId:selected}))!==JSON.stringify(review.approvedDraft))throw new Error("Confirm the exact statement again.");
      const kind=draft.audience.kind,target=draft.audience.target;
      if(kind==="foreign-public"||kind==="institution"){
        const fresh=publicAudienceOptions(current.world),key=kind==="institution"?"institutions":"polities";
        const old=review[key].find(row=>row.id===target),now=fresh[key].find(row=>row.id===target);
        if(!old||!now||old.label!==now.label)throw new Error("The public audience changed; review the statement again.");
      }
      return planPublicPublication({...current,expected:review.expected,draft:{...draft,issuerId:selected},draftId,confirmed});
    },{expectedGameId:review.campaignId});
  }finally{endSimulation();}
};

export const cancelPublicReview=async({campaignId,expected,draftId,replyId,index})=>{
  if(!replyId||isSimulationBusy())throw new Error("Finish the current simulation before cancelling.");
  await enterSimulation();
  try{
    return await mutateCanonicalTurnState(async current=>{
      check(campaignId,current.world);
      const rows=advisorMessagesFor(await readAdvisorMessages({force:true}),CHIEF_ADVISOR_THREAD).filter(m=>m.id===replyId&&m.role==="advisor");
      if(rows.length!==1||!parseAdvisorReply(rows[0].text).publicDrafts?.[index]||draftId!==replyId+":public:"+index)throw new Error("The saved chief advisor draft is no longer available.");
      return planPublicCancellation({...current,draftId,expected,confirmed:true});
    },{expectedGameId:campaignId});
  }finally{endSimulation();}
};
