import test from "node:test";
import assert from "node:assert/strict";
import { applyGovernmentEdits, stageGovernmentEdit, rekeyGovernmentEdits, removeGovernmentEdits, settleGovernmentEditRows } from "./scenarioGovernmentEdits.js";

const world = () => ({
  polityOverrides:{A:{name:"A"},B:{name:"B"}},
  politicalActors:{schemaVersion:3,byPolity:{
    A:{polityKey:"A",government:{form:"Constitutional monarchy",ideology:"Liberal",rulingPartyIds:["p1"],approval:60},parties:[{id:"p1",name:"Party A",supportPercent:40}],goals:["Preserve borders"],politicalSystem:{type:"parliamentary"}},
    B:{polityKey:"B",government:{form:"Republic"}},
  }},
  relations:[{a:"A",b:"B",score:10}],
});
test("in-place political transition preserves the same actor/party IDs, territory and diplomacy",()=>{
  const original=world();
  const edits=stageGovernmentEdit([], "A", {form:"Parliamentary republic",ideology:"Social liberal"});
  const changed=applyGovernmentEdits(original,edits);
  assert.equal(changed.politicalActors.byPolity.A.government.form,"Parliamentary republic");
  assert.equal(changed.politicalActors.byPolity.A.government.ideology,"Social liberal");
  assert.deepEqual(changed.politicalActors.byPolity.A.government.rulingPartyIds,["p1"]);
  assert.deepEqual(changed.politicalActors.byPolity.A.parties[0].id,"p1");
  assert.deepEqual(changed.politicalActors.byPolity.A.goals,["Preserve borders"]);
  assert.deepEqual(changed.politicalActors.byPolity.B,original.politicalActors.byPolity.B);
  assert.deepEqual(changed.relations,original.relations);
  assert.equal(original.politicalActors.byPolity.A.government.form,"Constitutional monarchy");
});
test("edits use stable polity keys, merge partial fields and preserve explicit clear",()=>{
  let edits=stageGovernmentEdit([], "A", {form:"Federal republic"});
  edits=stageGovernmentEdit(edits,"a",{ideology:"Democratic"});
  assert.equal(edits.length,1);
  assert.equal(edits[0].form,"Federal republic");
  assert.equal(edits[0].ideology,"Democratic");
  assert.deepEqual(rekeyGovernmentEdits(edits,"A","New A")[0].polity,"New A");
  assert.deepEqual(removeGovernmentEdits(edits,"A"),[]);
  const cleared=stageGovernmentEdit([], "A", {ideology:null});
  const changed=applyGovernmentEdits(world(),cleared);
  assert.equal("ideology" in changed.politicalActors.byPolity.A.government,false);
});
test("malformed, ambiguous, duplicate and missing references fail without world mutation",()=>{
  const original=world();
  assert.throws(()=>stageGovernmentEdit([],"A",{form:""}),/must contain/);
  assert.throws(()=>stageGovernmentEdit([],"",{form:"Republic"}),/Choose/);
  assert.throws(()=>stageGovernmentEdit([],"A",{}),/No government/);
  assert.throws(()=>applyGovernmentEdits(original,[{polity:"C",form:"Republic"}]),/missing polity/);
  assert.throws(()=>applyGovernmentEdits(original,[{polity:"A",form:"Republic",unknown:5}]),/Unsupported/);
  assert.throws(()=>applyGovernmentEdits(original,[{polity:"A",form:"Republic"},{polity:"a",ideology:"Liberal"}]),/Duplicate/);
  assert.deepEqual(original,world());
});
test("new actor from explicit author-selected form is canonical and leaves other polities untouched",()=>{
  const base=world();delete base.politicalActors.byPolity.B;
  const revised=applyGovernmentEdits(base,[{polity:"B",form:"Transitional republic"}]);
  assert.equal(revised.politicalActors.byPolity.B.polityKey,"B");
  assert.equal(revised.politicalActors.byPolity.B.government.form,"Transitional republic");
  assert.equal(base.politicalActors.byPolity.B,undefined);
});


test("successful Save settles only written government edits and preserves unrelated authorship",()=>{
  const saved=stageGovernmentEdit([], "A", {form:"Parliamentary republic",ideology:"Liberal"});
  const other=stageGovernmentEdit(saved,"B",{form:"Federal republic"});
  assert.deepEqual(settleGovernmentEditRows(saved,saved),[]);
  assert.deepEqual(settleGovernmentEditRows(other,saved),[{polity:"B",form:"Federal republic"}]);
  assert.deepEqual(settleGovernmentEditRows(other,[]),other);
});
test("Save settlement preserves newer edits to the same field made while the write was in flight",()=>{
  const saved=stageGovernmentEdit([], "A", {form:"Constitutional monarchy",ideology:"Liberal"});
  const updated=stageGovernmentEdit(saved,"a",{form:"Constitutional parliamentary monarchy",ideology:"Social democracy"});
  assert.deepEqual(settleGovernmentEditRows(updated,saved),[
    {polity:"a",form:"Constitutional parliamentary monarchy",ideology:"Social democracy"},
  ]);
  const onlyOneFieldChanged=stageGovernmentEdit(saved,"A",{ideology:"Green liberalism"});
  assert.deepEqual(settleGovernmentEditRows(onlyOneFieldChanged,saved),[
    {polity:"A",ideology:"Green liberalism"},
  ]);
});
test("explicit null clears settle, while a newer clear survives an in-flight Save",()=>{
  const saved=stageGovernmentEdit([], "A", {form:"Republic"});
  const cleared=stageGovernmentEdit(saved,"A",{form:null});
  assert.deepEqual(settleGovernmentEditRows(cleared,saved),[{polity:"A",form:null}]);
  assert.deepEqual(settleGovernmentEditRows(cleared,cleared),[]);
});
test("Save settlement replays in-flight polity renames so already-saved government edits do not stay queued",()=>{
  const saved=stageGovernmentEdit([], "A", {form:"Parliamentary republic",ideology:"Liberal"});
  // While Save was in flight, polity A was renamed A -> New A -> Newer A, and ideology was edited again.
  let current=rekeyGovernmentEdits(saved,"A","New A");
  current=rekeyGovernmentEdits(current,"New A","Newer A");
  const renamedOnly=settleGovernmentEditRows(current,saved,[{from:"A",to:"New A"},{from:"New A",to:"Newer A"}]);
  assert.deepEqual(renamedOnly,[]);

  const editedInFlight=stageGovernmentEdit(current,"Newer A",{ideology:"Social democracy"});
  const settled=settleGovernmentEditRows(editedInFlight,saved,[{from:"A",to:"New A"},{from:"New A",to:"Newer A"}]);
  assert.deepEqual(settled,[{polity:"Newer A",ideology:"Social democracy"}]);
});
