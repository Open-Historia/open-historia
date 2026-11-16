import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChats } from "./gameState.js";
import { chatInboxSignature, holdChatsInListOrder, nextChatActivityOrdinal, promoteChatActivity, sortChatsForInbox } from "./chatInboxOrder.js";
import { foldGeneratedChatsIntoStorage } from "../Game/AI/chatFold.js";
const chat=(id,day,ordinal=0)=>({id,countries:[{name:id}],messages:[{id:id+"-0",role:"leader",speaker:id,text:"Correspondence",time:day}],...(ordinal?{activityOrdinal:ordinal}:{})});
const ids=(list)=>list.map(row=>row.id);

test("historical timestamps remain for display but activity ordinals control real inbox order",()=>{
 const entries=[chat("Germany","1912-10-02"),chat("Serbia","1912-10-05"),chat("Italy","1912-10-05")];
 assert.deepEqual(ids(sortChatsForInbox(entries)),["Serbia","Italy","Germany"]);
 const next=promoteChatActivity(entries,"Germany",[...entries[0].messages,{id:"reply",role:"user",text:"We accept.",time:"1912-10-05"}]);
 assert.deepEqual(ids(sortChatsForInbox(normalizeChats(next))),["Germany","Serbia","Italy"]);
 assert.equal(next[0].activityOrdinal,1);
});

test("same-day generated outreach to an old thread becomes newest and survives normalization",()=>{
 const old=[chat("Serbia","1912-10-05"),chat("Germany","1912-10-05"),chat("Italy","1912-10-05")];
 const incoming={id:"generated",countries:[{name:"Germany"}],messages:[{id:"last",role:"leader",speaker:"Germany",text:"New ultimatum",time:"1912-10-05"}]};
 const next=foldGeneratedChatsIntoStorage(old,[incoming],{stampTime:"1912-10-05"});
 assert.equal(sortChatsForInbox(normalizeChats(next))[0].id,"Germany");
 assert.equal(next[0].messages.at(-1).text,"New ultimatum");
 assert.equal(sortChatsForInbox(normalizeChats(JSON.parse(JSON.stringify(next))))[0].id,"Germany");
});

test("read flags, reactions and unchanged/duplicate messages cannot reorder threads",()=>{
 const a=chat("A","1912-10-04",4),b=chat("B","1912-10-05",5);
 const unchanged=promoteChatActivity([b,a],"A",a.messages);
 assert.equal(unchanged.find(x=>x.id==="A").activityOrdinal,4);
 assert.deepEqual(ids(sortChatsForInbox(unchanged)),["B","A"]);
 const duplicate=foldGeneratedChatsIntoStorage([b,a],[{countries:[{name:"A"}],messages:[{id:"dup",role:"leader",speaker:"A",text:"Correspondence",time:"1912-10-05"}]}]);
 assert.deepEqual(ids(sortChatsForInbox(duplicate)),["B","A"]);
});

test("BCE legacy dates sort chronologically without wall clock conversion",()=>{
 const entries=[chat("Republic","-0219-05-01"),chat("Empire","-0218-03-01"),chat("Ancient","-1000-01-01")];
 assert.deepEqual(ids(sortChatsForInbox(entries)),["Empire","Republic","Ancient"]);
});
test("new messages advance strictly beyond existing ordinals and remain stable in saved chat state",()=>{
 const rows=[chat("A","1900-01-01",10),chat("B","1900-01-01",12)];
 assert.equal(nextChatActivityOrdinal(rows),13);
 const updated=promoteChatActivity(rows,"A",[...rows[0].messages,{id:"m2",role:"user",text:"Response",time:"1900-01-01"}]);
 assert.equal(normalizeChats(updated)[0].activityOrdinal,13);
 assert.deepEqual(ids(sortChatsForInbox(normalizeChats(updated))),["A","B"]);
});

test("the live store signature observes new activity without a date or message-count change", () => {
  const before = [chat("Germany", "1912-10-05", 11), chat("Serbia", "1912-10-05", 12)];
  const after = before.map((entry) => entry.id === "Germany" ? { ...entry, activityOrdinal: 13 } : entry);
  assert.notEqual(chatInboxSignature(before), chatInboxSignature(after));
  assert.deepEqual(ids(sortChatsForInbox(after)), ["Germany", "Serbia"]);
});

test("an inbox scrolled into history keeps its rows in place until the player returns to latest", () => {
  const before = [chat("Serbia", "1912-10-05", 12), chat("Germany", "1912-10-05", 11)];
  const heldIds = ids(sortChatsForInbox(before));
  const after = [chat("Germany", "1912-10-05", 13), before[0], chat("Italy", "1912-10-05", 14)];
  assert.deepEqual(ids(sortChatsForInbox(after)), ["Italy", "Germany", "Serbia"]);
  const held = holdChatsInListOrder(sortChatsForInbox(after), heldIds);
  assert.deepEqual(ids(held), ["Serbia", "Germany", "Italy"]);
  assert.equal(held[1].activityOrdinal, 13, "held rows still show updated activity");
});
