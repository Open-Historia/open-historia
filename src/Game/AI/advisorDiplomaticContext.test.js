/*! Open Historia - Advisor diplomatic briefing and active/archive retrieval. AGPL-3.0-or-later. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  renderAdvisorDiplomaticContext,
  searchAdvisorDiplomaticMessages,
  readAdvisorDiplomaticMessages,
  advisorDiplomaticLookups,
  ADVISOR_DIPLOMACY_CONTEXT_MAX_CHARS,
} from "./advisorDiplomaticContext.js";

const transcript = ({ id, partner, messages, title = "" }) => ({
  id, title, countries: [{ code: partner.slice(0,3).toUpperCase(), name: partner }],
  messages: messages.map(([time, speaker, text, memorySummary], i) => ({
    id: id + "-message-" + i, role: speaker === "Russian Federation" ? "user" : "leader",
    speaker, time, text, ...(memorySummary ? { memorySummary } : {}),
  })),
});
const chats = [
  transcript({
    id:"talk-italy", partner:"Italian Republic",
    messages:[
      ["2026-07-02","Italian Republic",
        "The Sirte treaty shall guarantee independent maritime access and joint verification, with no new administrative bodies."],
      ["2029-08-31","Russian Federation","Discuss the Rome industrial partnership."],
      ["2029-08-31","Italian Republic","The institutional framework will respect sovereign equality.",
        "Italy and Russia are coordinating Mediterranean maritime verification on the existing coalition mandate."],
    ],
  }),
  transcript({
    id:"talk-ukraine", partner:"Ukraine",
    messages:[
      ["2026-04-20","Ukraine","Ukraine insisted upon verified withdrawal from Donbas, including Crimea in full border recognition."],
      ["2029-08-30","Ukraine","The OSCE review remains independent.",
        "Withdrawal and children repatriation are finished; independent OSCE access remains crucial."],
    ],
  }),
  transcript({
    id:"talk-secret", partner:"Federal Republic of Germany",
    messages:[["2028-05-01","Federal Republic of Germany","SECRET-FRANCE-ONLY intelligence briefing."]],
  }),
];
const game={ country:"Russian Federation",gameDate:"2029-08-31",round:323 };
const world={ consolidatedHistory:[], simulationHistory:[], wars:[], peaceOffers:[] };

test("bounded briefing retains breadth, binding memory, current speaker attribution and dated evidence", () => {
  const extra=Array.from({length:30},(_,i)=>transcript({
    id:"extra-"+i,partner:"Country "+i,
    messages:[["2029-08-31","Country "+i,("Long message about foreign affairs "+i+" ").repeat(800),
      "Confirmed standing economic memorandum for country "+i]],
  }));
  const text=renderAdvisorDiplomaticContext({chats:[...chats,...extra],world,game,question:"What happened in Italy?"});
  assert.ok(text.length <= ADVISOR_DIPLOMACY_CONTEXT_MAX_CHARS, text.length);
  assert.match(text,/Italian Republic/);
  assert.match(text,/Ukraine/);
  assert.match(text,/Durable diplomatic memory/);
  assert.match(text,/Italian Republic:/);
  assert.match(text,/Omitted|briefing|truncated/i);
  assert.doesNotMatch(text,/Long message about foreign affairs 0(?:.*Long message about foreign affairs 0){20}/);
});

test("targeted evidence retrieves the 2026 treaty even when 2029 messages dominate an active thread", () => {
  const long=transcript({id:"talk-old-treaty",partner:"Latvia",messages:[
    ["2026-06-01","Latvia","The Daugava technology treaty contains an explicit non-interference clause and independent verification."],
    ...Array.from({length:40},(_,i)=>["2029-08-31","Latvia","Routine conversation "+i]),
  ]});
  const evidence=searchAdvisorDiplomaticMessages([long],{
    query:"What was the Daugava technology treaty non-interference clause?",limit:4,
  });
  assert.ok(evidence.matches.length);
  assert.equal(evidence.matches[0].threadId,"talk-old-treaty");
  assert.equal(evidence.matches[0].messageIndex,0);
  assert.match(evidence.matches[0].excerpt,/independent verification/);
  assert.equal(evidence.matches[0].date,"2026-06-01");
  assert.ok(JSON.stringify(evidence).length < 7000);
});

test("explicit read uses stable thread ID and index, stays bounded and fails closed", () => {
  const res=readAdvisorDiplomaticMessages(chats,{threadId:"talk-italy",around:0,limit:2});
  assert.equal(res.threadId,"talk-italy");
  assert.equal(res.messages[0].messageIndex,0);
  assert.match(res.messages[0].excerpt,/Sirte treaty/);
  assert.equal(readAdvisorDiplomaticMessages(chats,{threadId:"does-not-exist"}).error,
    "Diplomatic thread is not accessible.");
  assert.equal(readAdvisorDiplomaticMessages(chats,{threadId:"talk-italy",around:-200}).error,
    "A valid nonnegative message index is required.");
});

test("all retrieval paths respect diplomatic visibility, including thread IDs", async () => {
  const visible=searchAdvisorDiplomaticMessages(chats,{query:"SECRET-FRANCE-ONLY",visibleTo:"Italian Republic"});
  assert.equal(visible.matches.length,0);
  const read=readAdvisorDiplomaticMessages(chats,{threadId:"talk-secret",visibleTo:"Italian Republic"});
  assert.ok(read.error);
  const tools=advisorDiplomaticLookups({chats,visibleTo:"Italian Republic"});
  const searched=await tools.execute("search_advisor_diplomacy",{query:"SECRET-FRANCE-ONLY"});
  assert.equal(searched.matches.length,0);
  const unknown=await tools.execute("unexpected_tool",{});
  assert.ok(unknown.error);
});

// The briefing chose up to three passages by the words they shared with the
// player's question: asked in another language, or another way, it chose
// nothing, and a stray shared word chose the wrong treaty. The briefing is the
// same whatever is asked; the advisor finds old terms with its own search.
test("the briefing picks no passage by the words of the player's question", () => {
  const text=renderAdvisorDiplomaticContext({chats,world,game,maxChars:6500});
  assert.doesNotMatch(text,/Relevant dated passages/);
  assert.doesNotMatch(text,/Sirte treaty shall guarantee/,"an old passage is not pulled in by its words");
  assert.match(text,/Standing commitments index/);
  assert.match(text,/Most recent unconsolidated diplomatic threads/);
  assert.ok(text.length <= 6500);
  for (const question of [
    "What was the Sirte treaty guarantee in 2026?",
    "Quelle garantie le traité de Syrte donnait-il en 2026 ?",
    "Please assess domestic administrative costs and factory labor audits.",
  ]) {
    assert.equal(renderAdvisorDiplomaticContext({chats,world,game,question,maxChars:6500}),text,question);
  }
});

test("long presidential turns: the advisor's search keeps the actual history question at the end", () => {
  const found=searchAdvisorDiplomaticMessages(chats,{query:
    ("The domestic labor inspection programme must be checked. ").repeat(300)
      +"Can you remind me of the 2026 Sirte treaty verification guarantees?"});
  assert.equal(found.matches[0]?.threadId,"talk-italy");
  assert.match(found.matches[0].excerpt,/Sirte treaty shall guarantee/);
});

test("a long exact source message is recoverable across bounded pages, including its final treaty clause", () => {
  const critical = "FINAL-CLAUSE-VERIFICATION: The signatories prohibit unilateral inspections";
  const fullText = "The parties record the common position. ".repeat(125) + critical;
  const source = transcript({id:"long-treaty",partner:"Kingdom of Norway",
    messages:[["2027-03-22","Kingdom of Norway",fullText]]});
  const pages=[];
  let offset=0;
  for(let i=0;i<8;i++){
    const page=readAdvisorDiplomaticMessages([source],{
      threadId:"long-treaty",messageIndex:0,offset,maxChars:1200,
    });
    assert.equal(page.messages.length,1);
    const part=page.messages[0];
    assert.equal(part.messageIndex,0);
    assert.equal(part.offset,offset);
    assert.equal(part.totalChars,fullText.length);
    assert.ok(part.excerpt.length <= 1200);
    pages.push(part.excerpt);
    if(!part.hasMore) break;
    assert.equal(part.nextOffset,offset+part.excerpt.length);
    offset=part.nextOffset;
  }
  assert.equal(pages.join(""),fullText);
  assert.match(pages.at(-1),/FINAL-CLAUSE-VERIFICATION/);
  assert.deepEqual(readAdvisorDiplomaticMessages([source],{
    threadId:"long-treaty",messageIndex:0,offset:fullText.length,
  }).error,"Message offset is outside this source text.");
  assert.deepEqual(readAdvisorDiplomaticMessages([source],{
    threadId:"long-treaty",messageIndex:0,offset:-1,
  }).error,"A valid nonnegative message offset is required.");
});

test("source pagination fails closed for inaccessible threads and invalid message indices", () => {
  const invalid=readAdvisorDiplomaticMessages(chats,{threadId:"talk-secret",messageIndex:0,
    visibleTo:"Ukraine",offset:1200});
  assert.equal(invalid.error,"Diplomatic thread is not accessible.");
  assert.equal(readAdvisorDiplomaticMessages(chats,{
    threadId:"talk-italy",messageIndex:999,offset:0,
  }).error,"Message index is outside this thread.");
});

test("a question in Latvian and its English twin get the same briefing", () => {
  const source=transcript({id:"treaty-in-latvian",partner:"Latvia",
    messages:[["2026-11-18","Latvia","Daugava crossing permits require joint written clearance and a signed verification protocol."]]});
  const latvian=renderAdvisorDiplomaticContext({chats:[source],world,game,
    question:"Atgādini man par Daugava šķērsošanas nosacījumiem, lūdzu"});
  const english=renderAdvisorDiplomaticContext({chats:[source],world,game,
    question:"Why did the Daugava delegation demand verification?"});
  assert.equal(latvian,english);
  // The thread is there either way, by its source id, for the advisor to read.
  assert.match(latvian,/Source thread treaty-in-latvian/);
});

test("all active standing diplomatic memories appear as compact source-backed index in a 40-thread campaign", () => {
  const many=Array.from({length:40},(_,i)=>transcript({
    id:"continuity-"+i,partner:"Independent Polity "+i,
    messages:[["2029-08-20","Independent Polity "+i,
      "Current negotiation update "+i,
      "Standing agreement with Polity "+i+" is subject to voluntary oversight " + "record".repeat(90)]],
  }));
  const context=renderAdvisorDiplomaticContext({chats:many,world,game,question:"Review domestic heating costs"});
  assert.ok(context.length<=ADVISOR_DIPLOMACY_CONTEXT_MAX_CHARS);
  for(let i=0;i<40;i++) {
    assert.ok(context.includes(`Source thread continuity-${i}: Independent Polity ${i};`));
    assert.match(context,new RegExp("Standing agreement with Polity "+i));
  }
  assert.match(context,/Standing commitments index/);
  assert.match(context,/Source thread/);
});

test("targeted evidence for a long treaty favors the requested final clause, not its earlier title", () => {
  const finalClause="Final verification clause: no military installations may be inspected without the joint consent of both parties.";
  const text="The Daugava treaty begins with a statement of intent. "
    + "Neutral commercial terms and introductory material. ".repeat(100)
    +finalClause;
  const source=transcript({id:"deep-clause",partner:"Latvia",messages:[
    ["2026-11-18","Latvia",text],
  ]});
  const query="Please remind me how the Daugava treaty final verification clause restricts military inspections.";
  const found=searchAdvisorDiplomaticMessages([source],{query});
  assert.match(found.matches[0].excerpt,/Final verification clause:/);
  assert.match(found.matches[0].excerpt,/no military installations may be inspected/);
});

test("search evidence IDs can be validated at read time and rejected when changed", async () => {
  const source=transcript({id:"immutable-source",partner:"Estonia",messages:[
    ["2026-05-05","Estonia","Bilateral verified independence and no unilateral action in maritime channels."],
  ]});
  const tool=advisorDiplomaticLookups({chats:[source]});
  const result=await tool.execute("search_advisor_diplomacy",{query:"independence maritime"});
  assert.equal(result.matches.length,1);
  const match=result.matches[0];
  assert.equal(match.sourceMessageId,"immutable-source-message-0");
  const good=await tool.execute("read_advisor_diplomacy",{
    threadId:match.threadId,messageIndex:match.messageIndex,messageId:match.sourceMessageId,offset:0,
  });
  assert.match(good.messages[0].excerpt,/verified independence/);
  const wrong=await tool.execute("read_advisor_diplomacy",{
    threadId:match.threadId,messageIndex:match.messageIndex,messageId:"invented-message-id",
  });
  assert.equal(wrong.error,"Source message ID does not match this thread and index.");
  assert.ok(tool.maxRounds>=4,"multi-page treaty reading must not be limited to only two rounds");
});

test("continuity index marks native open demands but never presents a conversation summary as an approved order", () => {
  // Demand state is projected from the canonical chat event log; a loose
  // demands:[] fixture would be discarded by normalizeChats and is not valid.
  const chat={
    id:"native-demand-thread",countries:[{code:"ITA",name:"Italian Republic"}],
    events:[
      {id:"created",kind:"chat_created",time:"2029-08-20",by:"Russian Federation",title:"Bilateral obligations"},
      {id:"member",kind:"member_joined",time:"2029-08-20",by:"Russian Federation",
        member:{code:"ITA",name:"Italian Republic"}},
      {id:"message",kind:"message",time:"2029-08-20",by:"Italian Republic",
        text:"The existing agreement must be followed."},
      {id:"demand-1",kind:"demand_made",time:"2029-08-20",by:"Russian Federation",
        demandId:"d1",target:"Italian Republic",summary:"Provide written implementation assurance."},
    ],
  };
  const state=JSON.stringify(chat);
  const text=renderAdvisorDiplomaticContext({chats:[chat],world,game,
    question:"Assess domestic procurement costs"});
  assert.ok(text.includes("1 open demand(s)"));
  assert.match(text,/recorded summaries; verify exact terms/);
  assert.equal(JSON.stringify(chat),state,"rendering must never mutate a canonical chat");
});

test("restricted audience cannot see private source messages in either briefing or retrieval", () => {
  const text=renderAdvisorDiplomaticContext({chats,world,game,
    question:"What happened in Germany?",visibleTo:"Italian Republic"});
  assert.match(text,/talk-italy/);
  assert.doesNotMatch(text,/SECRET-FRANCE-ONLY|talk-secret|talk-ukraine/);
  const search=searchAdvisorDiplomaticMessages(chats,{
    query:"SECRET-FRANCE-ONLY",visibleTo:"Italian Republic",
  });
  assert.equal(search.matches.length,0);
});

test("archived and consolidated sources remain retrievable by exact ID without being reinserted verbatim", () => {
  const old=transcript({id:"old-agreement",partner:"Republic of Iceland",
    messages:[["2026-01-01","Republic of Iceland","The Laugavegur memorandum reserves a neutral arbitration panel for fisheries disputes."]]});
  const veryOldWorld={...world,simulationHistory:Array.from({length:5},(_,i)=>({
    fromDate:"2029-01-0"+(i+1),toDate:"2029-01-0"+(i+1),round:310+i,
  }))};
  const summary=renderAdvisorDiplomaticContext({chats:[old],world:veryOldWorld,game,
    question:"Review domestic heating capacity"});
  assert.ok(summary.length<=ADVISOR_DIPLOMACY_CONTEXT_MAX_CHARS);
  const source=searchAdvisorDiplomaticMessages([old],{
    query:"Laugavegur memorandum neutral arbitration fisheries",
  });
  assert.equal(source.matches[0].threadId,"old-agreement");
  assert.match(readAdvisorDiplomaticMessages([old],{
    threadId:source.matches[0].threadId,messageIndex:0,
  }).messages[0].excerpt,/neutral arbitration panel/);
});

// The search kept words of three letters or more that were not on an English
// list of words to leave out. Every two-character Chinese word was dropped, so a
// search asked in Chinese was refused for want of a query, while French "les"
// and "pour" were kept to weigh as much as a treaty's name.
test("the advisor's search works in every script: two-character Chinese words, and the same conversation found the same way in English, French and Chinese", () => {
  const thread = (id, partner, texts) => transcript({ id, partner,
    messages: texts.map((text, index) => [`2026-0${index + 1}-01`, partner, text]) });
  const english = thread("talk-en", "Italian Republic", [
    "Routine greetings were exchanged.",
    "The Sirte treaty guarantees maritime access for both fleets.",
    "Grain prices fell this winter.",
  ]);
  const french = thread("talk-fr", "République italienne", [
    "Des salutations d'usage ont été échangées.",
    "Le traité de Syrte garantit l'accès maritime aux deux flottes.",
    "Le prix du blé a baissé cet hiver.",
  ]);
  const chinese = thread("talk-zh", "意大利共和国", [
    "双方互致问候。",
    "锡尔特条约保障两国舰队的海上通行。",
    "今年冬天粮价下跌。",
  ]);
  const first = (chat, query) => searchAdvisorDiplomaticMessages([chat], { query }).matches[0];
  assert.equal(first(english, "Sirte treaty maritime access")?.messageIndex, 1);
  assert.equal(first(french, "traité de Syrte accès maritime")?.messageIndex, 1);
  assert.equal(first(chinese, "锡尔特条约的海上通行")?.messageIndex, 1);
  // Two-character words, spaced, were each dropped: the search was refused.
  const spaced = searchAdvisorDiplomaticMessages([chinese], { query: "条约 海上" });
  assert.equal(spaced.note, undefined);
  assert.equal(spaced.matches[0]?.messageIndex, 1);
  assert.match(spaced.matches[0].excerpt, /锡尔特条约/);
  // Nothing to look for at all is still said.
  assert.match(searchAdvisorDiplomaticMessages([english], { query: "?!" }).note, /A query or a partner is required/);
  const source = readFileSync(new URL("./advisorDiplomaticContext.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /const STOP\b|\\p\{N\}\]\{3,\}/, "no list of words to leave out, no shortest length");
});

test("the partner narrows the search by a participant's exact name or code, never a word of one", () => {
  const ids = (partner, query = "") => searchAdvisorDiplomaticMessages(chats, { query, partner }).matches.map((match) => match.threadId);
  assert.deepEqual([...new Set(ids("Italian Republic"))], ["talk-italy"]);
  assert.deepEqual([...new Set(ids("ita", "verification"))], ["talk-italy"], "its code, in any case");
  // "Republic" was a word of two participants' names, and found both.
  const word = searchAdvisorDiplomaticMessages(chats, { query: "verification", partner: "Republic" });
  assert.deepEqual(word.matches, []);
  assert.match(word.note, /No saved conversation has a participant called "Republic"\. The participants, as the threads name them: Federal Republic of Germany, Italian Republic, Ukraine\./);
  // Only the threads the asker may see are named.
  const hidden = searchAdvisorDiplomaticMessages(chats, { query: "briefing", partner: "Federal Republic of Germany", visibleTo: "Italian Republic" });
  assert.deepEqual(hidden.matches, []);
  assert.doesNotMatch(hidden.note, /Germany\./);
});

test("source integration is Advisor-only; leaders and Time Skip keep their existing builders", () => {
  const main=readFileSync(new URL("./main.jsx",import.meta.url),"utf8");
  assert.match(main,/renderAdvisorDiplomaticContext\(/);
  const call=main.slice(main.indexOf("renderAdvisorDiplomaticContext({"),main.indexOf("}),",main.indexOf("renderAdvisorDiplomaticContext({")));
  assert.doesNotMatch(call,/question/,"the briefing is not chosen by the question's words");
  assert.match(main,/exclude:\s*\["advisorMessages", "chatHistoryLong"\]/);
  assert.match(main,/advisorDiplomaticLookups\(/);
  assert.match(main,/buildAdvisorSystemPrompt\(\{ recipient: storedRecipient, currentQuestion: userMessage \}\)/);
});
