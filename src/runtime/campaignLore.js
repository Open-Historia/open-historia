/*! Open Historia - read-only campaign lore records. AGPL-3.0-or-later. */
import { compareGameDates, isGameDate, normalizeGameDate } from "./gameDates.js";
import { normalizeInteractiveTranscript } from "./interactiveTranscript.js";
import { eventNamesPolity } from "./eventConcerns.js";
import { polityMatches } from "../Game/AI/audience.js";

export const LORE_SCHEMA_VERSION = 1;
export const LORE_DEFAULT_OPTIONS = Object.freeze({
  scope: "global", from: "", to: "", actions: false, conversations: false,
  transcripts: false, snapshot: true,
});
const list = value => Array.isArray(value) ? value : [];
const eventRows = value => (Array.isArray(value) ? value : Array.isArray(value?.events) ? value.events
  : value && typeof value === "object" ? Object.values(value) : [])
  .map(row => typeof row === "string" ? { title:row } : row)
  .filter(row => row && typeof row === "object" && !Array.isArray(row));
const record = value => value && typeof value === "object" && !Array.isArray(value);
const str = value => typeof value === "string" ? value : "";
const fields = (item, keys) => Object.fromEntries(keys.flatMap(key => {
  const value = item?.[key];
  return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) ? [[key, value]] : [];
}));
const strings = value => list(value).filter(item => typeof item === "string");
const same = (a,b) => polityMatches(a,b);
const dateOrder = (a,b) => compareGameDates(a.date, b.date);
const inRange = (date, from, to) => !isGameDate(date) ||
  (!from || compareGameDates(date,from) >= 0) && (!to || compareGameDates(date,to) <= 0);
const privateEvent = event => event?.source === "espionage" || event?.kind === "espionage" ||
  (event?.audience != null && (!Array.isArray(event.audience) || event.audience.length > 0));

// The first export deliberately excludes intelligence, scoped events and raw
// impacts. No narrator/world-state dump, credit/key/settings fields or prompts.
// This is a visible-history presentation, NOT a reloadable save.
export const buildCampaignLore = ({ metadata = {}, game = {}, world = {}, events = [], actions = [], chats = [], advisor = [] } = {}, options = {}) => {
  const o = { ...LORE_DEFAULT_OPTIONS, ...options };
  const from = normalizeGameDate(o.from);
  const to = normalizeGameDate(o.to || game.gameDate);
  if ((o.from && !from) || (o.to && !to) || (from && to && compareGameDates(from,to) > 0))
    throw new Error("Enter a valid campaign date range.");
  if (to && isGameDate(game.gameDate) && compareGameDates(to, game.gameDate) > 0)
    throw new Error("The end date cannot be later than the recorded campaign date.");
  const player = str(game.country);
  const retained = eventRows(events);
  const eventsInRange = retained.filter(e => inRange(e.date, from, to));
  const publicEvents = retained.filter(e => !privateEvent(e));
  const hiddenIds = new Set(retained.filter(privateEvent).map(e => e.id).filter(Boolean));
  const sourceEvents = new Map(publicEvents.filter(e=>e.id).map(e=>[e.id,e]));
  const included = eventsInRange.filter(e => !privateEvent(e) &&
    (o.scope !== "player" || e.playerRelated === true || eventNamesPolity(e, player)));
  const chronology = included.map(event => {
    const entry = { ...fields(event, ["id","date","title","description","importance","kind","source","playerRelated","notable","warId"]),
      ...(str(event.title||event.headline||event.name)?{title:str(event.title||event.headline||event.name)}:{}),
      ...(str(event.description||event.summary||event.text)?{description:str(event.description||event.summary||event.text)}:{}),
      tags: strings(event.tags), concerns: strings(event.concerns), combatants: strings(event.combatants),
      ...(record(event.quote) && str(event.quote.text) ? { quote: fields(event.quote,["text","speaker","role"]) } : {}) };
    if (event.kind === "interactive" || event.kind === "catalyst") {
      const archive = normalizeInteractiveTranscript(event.interactiveTranscript);
      const permitted = archive && !hiddenIds.has(archive.sourceEventId);
      entry.transcriptStatus = !archive ? "unavailable" : !permitted || !o.transcripts ? "excluded" : "included";
      if (permitted && o.transcripts) entry.interactiveTranscript = archive;
    }
    return entry;
  }).sort(dateOrder);
  const ownActions = o.actions ? list(actions).map(a=>typeof a==="string"?{text:a}:a).filter(a => record(a) && (!a.ownerCode || same(a.ownerCode, player))).map(a =>
    fields(a, ["id","title","text","status","kind","resolvedRound","overdue"])) : [];
  // A former shared campaign can retain seat-owned threads and advisors. Never
  // export seat archives; only the host/current player's own message projection.
  const diplomatic = o.conversations ? list(chats).filter(c => record(c) &&
    (!c.player || same(c.player, player)) && !list(c.retiredFor).some(name => same(name,player)) &&
    !hiddenIds.has(c.linkedEventId)).map(c => ({
      ...fields(c,["id","title","status","institutionId","linkedEventId"]),
      participants:list(c.countries).flatMap(p => typeof p === "string" ? [p] : record(p) ? [fields(p,["name","code"])] : []),
      messages:list(c.messages).filter(m => record(m) && str(m.text) && !hiddenIds.has(m.eventId) &&
        inRange(m.time,from,to)).map(m=>fields(m,["id","role","speaker","code","text","time","eventId"])),
    })).filter(c=>c.messages.length) : [];
  const advisorMessages = o.conversations ? list(advisor).filter(m=>record(m) &&
    ["user","advisor"].includes(m.role) && m.streaming !== true && str(m.text) && !hiddenIds.has(m.eventId) &&
    inRange(m.time,from,to)).map(m=>fields(m,["id","role","text","time","threadId","speakerId"])) : [];
  // Snapshot rows describe the saved present, not the historical state at the
  // end of a filtered period. Do not flatten hidden foreign project boards.
  const snapshot = o.snapshot ? {
    date: str(game.gameDate),
    wars:list(world.wars).filter(w=>record(w) && (o.scope !== "player" ||
      [...list(w.sideA),...list(w.sideB)].some(name=>same(name,player)))).map(w=>({
      ...fields(w,["id","title","status","startedDate","endedDate","lastUpdatedDate"]),
      sideA: strings(w.sideA), sideB: strings(w.sideB),
      sourceEventIds:strings(w.sourceEventIds).filter(id=>sourceEvents.has(id)),
    })),
    projects: list(world.projects).filter(p=>record(p) && (!p.ownerCode || same(p.ownerCode,player)) &&
      (o.actions || p.secrecy === "public")).map(p=>fields(p,["id","name","kind","status","summary","progress","startedAt","targetDate","completedAt","lastUpdate","secrecy"])),
    ...(o.actions ? { standingGoal: fields(world.playerGoals?.[player],["text","date","round"]) } : {}),
    ...(record(world.countryStats?.[player]) ? { playerMetrics: {
      ...fields(world.countryStats[player],["asOf","date","source"]),
      population:fields(world.countryStats[player].population,["total","annualGrowthRate"]),
      economy:fields(world.countryStats[player].economy,["gdp","gdpGrowth","gdpPerCapita"]),
      units:{population:"people",annualGrowthRate:"percent/year",gdp:"2026 USD equivalent",gdpGrowth:"percent/year",gdpPerCapita:"2026 USD equivalent/person"},
    }} : {}),
  } : null;
  const dates = chronology.map(e=>e.date).filter(isGameDate);
  return {
    schemaVersion: LORE_SCHEMA_VERSION,
    campaign: { ...fields(metadata,["name","scenario"]), ...fields(game,["country","startDate","gameDate","round","difficulty"]) },
    coverage: { scope:o.scope === "player" ? "player" : "global", from:from || null, to:to || null,
      firstRecordedDate:dates[0] || null,lastRecordedDate:dates.at(-1) || null,
      eventCount:chronology.length, retainedPublicEventCount:publicEvents.length, excludedBySelection:publicEvents.length-chronology.length, undatedEvents:chronology.filter(e=>!isGameDate(e.date)).length,
      actionsIncluded:!!o.actions, conversationsIncluded:!!o.conversations, transcriptsIncluded:!!o.transcripts, snapshotIncluded:!!o.snapshot,
      limitations:[
        "Only retained records are exported, not reconstructed history. Early records already removed from the save cannot be recovered here.",
        "Intelligence, scoped events, hidden seat archives, raw impacts, settings, debug logs, and rollback snapshots are excluded. Compressed AI history documents are not treated as original records.",
        "Undated records cannot be reliably assigned to a selected period; retained undated records are labeled.",
        "Orders are the retained action board, with their recorded status and resolved round when known, not a complete historical order ledger. They are not date-filtered.",
        "Current state describes the saved campaign date rather than a reconstructed past snapshot. Stats are recorded estimates, not real-world facts.",
        "Conversations are attributed dialogue, not proof of executed agreements. Missing historical transcripts are not reconstructed.",
        "Player-focused events use recorded player-related markers and structured polity references, not name guesses from prose.",
        "Review private narrative text before sharing; free text may itself contain information you entered.",
      ] },
    events:chronology, actions:ownActions, diplomacy:diplomatic, advisor:advisorMessages, snapshot,
  };
};

// Escape structure and HTML without altering the original narrative inside
// fenced text sections. Fence length is chosen from the actual stored text.
const escape = value => str(value).replace(/[\\`*_{}[\]()<>#+.!|]/g,"\\$&").replace(/\r?\n/g," ");
const block = value => {
  const text = str(value);
  const fence = "`".repeat((text.match(/`+/g)||[]).reduce((max,run)=>Math.max(max,run.length+1),3));
  return fence+"text\n"+text+(text.endsWith("\n")?"":"\n")+fence;
};
const named = (label,value) => value === undefined || value === null || value === "" ? "" : "- "+label+": "+escape(String(value));
const ref = (item) => item.id ? named("Source ID",item.id) : "- Source ID: not recorded";
export const campaignLoreMarkdown = lore => {
  const c=lore.campaign,k=lore.coverage;
  const out=["# Campaign record: "+escape(c.name||"Unnamed campaign"),
    "Deterministic export of retained Open Historia records. Not an AI-generated chronicle or a reloadable save.",
    [named("Scenario",c.scenario),named("Player polity",c.country),named("Start date",c.startDate),named("Recorded date",c.gameDate),named("Commit round",c.round),named("Difficulty",c.difficulty)].filter(Boolean).join("\n"),
    "## Coverage", [named("Scope",k.scope),named("Selected start",k.from||"All retained earlier dates"),named("Selected end",k.to),named("First available dated event",k.firstRecordedDate),named("Last available dated event",k.lastRecordedDate),named("Events",k.eventCount),named("Available public events",k.retainedPublicEventCount),named("Events outside selected scope or dates",k.excludedBySelection),named("Undated events",k.undatedEvents),named("Orders included",k.actionsIncluded),named("Conversations included",k.conversationsIncluded),named("Interactive transcripts included",k.transcriptsIncluded),named("Current snapshot included",k.snapshotIncluded)].filter(Boolean).join("\n"),...k.limitations.map(text=>"- "+text),"## Chronology"];
  if(!lore.events.length) out.push("No matching retained events.");
  for(const e of lore.events){
    out.push("### "+escape(e.date||"Undated")+" - "+escape(e.title||"Untitled event"),[ref(e),named("Kind",e.kind),named("Importance",e.importance),named("Source",e.source),named("Categories",e.tags.join(", ")),named("Concerns",e.concerns.join(", ")),named("Combatants",e.combatants.join(", ")),named("War ID",e.warId)].filter(Boolean).join("\n"));
    if(e.description)out.push(block(e.description));
    if(e.quote?.text)out.push("**Attributed quotation**",[named("Speaker",e.quote.speaker),named("Role",e.quote.role)].filter(Boolean).join("\n"),block(e.quote.text));
    if(e.transcriptStatus && !e.interactiveTranscript)out.push("Interactive transcript: "+e.transcriptStatus+".");
    const t=e.interactiveTranscript;
    if(t){
      out.push("#### Interactive transcript: "+escape(t.title),[named("Source event ID",t.sourceEventId),named("Scene date",t.startedOn),named("Ending",t.endedBy)].filter(Boolean).join("\n"));
      for(const [label,text] of [["Premise",t.premise],["Player angle",t.request],["Opening",t.firstOpening]])if(text)out.push("**"+label+"**",block(text));
      t.beats.forEach((b,i)=>{out.push("##### Move "+(i+1));if(b.before)out.push("Before move",block(b.before));if(b.offered)out.push("Offered choices",...b.offered.map(block));out.push("Accepted choice",block(b.choice),"Response",block(b.summary));});
    }
  }
  if(k.actionsIncluded){out.push("## Retained orders (intent and execution status)"); for(const a of lore.actions)out.push("### "+escape(a.title||"Order"),[ref(a),named("Status",a.status),named("Resolved round",a.resolvedRound),named("Overdue",a.overdue)].filter(Boolean).join("\n"),block(a.text));}
  if(k.conversationsIncluded){
    out.push("## Retained diplomatic conversations");
    for(const chat of lore.diplomacy){out.push("### "+escape(chat.title||"Diplomatic thread"),[ref(chat),named("Status",chat.status),named("Participants",chat.participants.map(p=>typeof p==="string"?p:p.name||p.code).join(", "))].filter(Boolean).join("\n"));for(const m of chat.messages)out.push("**"+escape(m.time||"Undated")+" | "+escape(m.speaker||m.code||m.role||"Speaker not recorded")+"**",ref(m),block(m.text));}
    out.push("## Advisor conversations");for(const m of lore.advisor)out.push("**"+escape(m.time||"Undated")+" | "+escape(m.role)+"**", [ref(m),named("Thread ID",m.threadId),named("Speaker ID",m.speakerId)].filter(Boolean).join("\n"),block(m.text));
  }
  if(lore.snapshot){out.push("## Recorded current state (not reconstructed history)",block(JSON.stringify(lore.snapshot,null,2)));}
  return out.filter(Boolean).join("\n\n")+"\n";
};

export const campaignLoreFileName = (lore, format="md") =>
  ((lore.campaign.name||"campaign").replace(/[^a-z0-9_-]+/gi,"-").replace(/^-+|-+$/g,"").slice(0,80)||"campaign")+
  "-lore-"+(normalizeGameDate(lore.campaign.gameDate)||"undated")+"."+(format==="json"?"json":"md");
