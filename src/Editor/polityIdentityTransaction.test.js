import test from "node:test";
import assert from "node:assert/strict";
import {
  planMapPolityRename, planMapPolityCreation, revertMapPolityCreation,
} from "./polityIdentityTransaction.js";

const document = () => ({
  polities: {
    A: {name:"A",code:"A",aliases:["Alternate A"],note:"Original"},
    B: {name:"B",code:"B"},
  },
  features:[{id:"city_a",country:"A",owner:"A"},{id:"city_b",country:"B"}],
  units:[{id:"unit_a",ownerCode:"A"}],
  flags:{A:"flag_A",B:"flag_B"},colorOverrides:{A:[1,2,3],B:[4,5,6]},
  tags:{A:["friendly"]},puppets:[{puppet:"A",overlord:"B"}],
  relations:[{a:"A",b:"B",score:0}],
  relationEdits:[{a:"A",b:"B",score:43}],
  actorGovernmentEdits:[{polity:"A",form:"Monarchy"}],
  polityRenames:[],
  fortifications:[{owner:"A",id:"wall_a"}],
});
test("one prevalidated polity rename rekeys all document identities in one immutable object",()=>{
  const before=document();
  const after=planMapPolityRename(before,"A","Kingdom of A",["A","B"]);
  assert.equal(after.polities.A,undefined);
  assert.equal(after.polities["Kingdom of A"].name,"Kingdom of A");
  assert.equal(after.polities["Kingdom of A"].code,"Kingdom of A");
  assert.equal(after.features[0].owner,"Kingdom of A");
  assert.equal(after.units[0].ownerCode,"Kingdom of A");
  assert.equal(after.fortifications[0].owner,"Kingdom of A");
  assert.equal(after.flags["Kingdom of A"],"flag_A");
  assert.deepEqual(after.colorOverrides["Kingdom of A"],[1,2,3]);
  assert.deepEqual(after.tags["Kingdom of A"],["friendly"]);
  assert.equal(after.puppets[0].puppet,"Kingdom of A");
  assert.equal(after.relations[0].a,"Kingdom of A");
  assert.equal(after.relationEdits[0].a,"Kingdom of A");
  assert.equal(after.actorGovernmentEdits[0].polity,"Kingdom of A");
  assert.deepEqual(after.polityRenames,[{from:"A",to:"Kingdom of A"}]);
  assert.deepEqual(before,document(),"planning must not mutate currently loaded document");
});
test("inverse rename cancels pending scenario authoring operation instead of double-replaying it",()=>{
  const before=document();
  const changed=planMapPolityRename(before,"A","A1",["A","B"]);
  const undone=planMapPolityRename(changed,"A1","A",["A1","B"]);
  assert.deepEqual(undone.polityRenames,[]);
  assert.equal(undone.polities.A.name,"A");
  assert.equal(undone.relations[0].a,"A");
  assert.equal(undone.actorGovernmentEdits[0].polity,"A");
});
test("identity conflicts or malformed country plans fail before any document mutation",()=>{
  const before=document();
  assert.throws(()=>planMapPolityRename(before,"A","B",["A","B"]),/already used/);
  assert.throws(()=>planMapPolityRename(before,"A","",["A","B"]),/nonempty/);
  assert.throws(()=>planMapPolityCreation(before,{ok:true,key:"B",record:{name:"B"}}),/already exists/);
  assert.throws(()=>planMapPolityCreation(before,{ok:false,key:"C"}),/not passed/);
  assert.deepEqual(before,document());
});
test("new country creation changes all authored document fields as a single plan, Undo removes just its records",()=>{
  const before=document();
  const plan={
    ok:true,key:"C",record:{name:"C",aliases:[],status:"active"},
    color:[12,34,56],flag:"new_flag",tags:["strategic"],puppets:[...before.puppets,{puppet:"C",overlord:"B"}],
    relationEdits:[{a:"C",b:"B",score:-15}],
  };
  const created=planMapPolityCreation(before,plan);
  assert.equal(created.polities.C.name,"C");
  assert.deepEqual(created.colorOverrides.C,[12,34,56]);
  assert.equal(created.flags.C,"new_flag");
  assert.deepEqual(created.tags.C,["strategic"]);
  assert.deepEqual(created.relationEdits.at(-1),plan.relationEdits[0]);
  assert.equal(created.puppets.length,2);
  const undone=revertMapPolityCreation(created,"C",before);
  assert.deepEqual(undone,before);
});

test("revertMapPolityCreation restores displaced puppet rows without clobbering unrelated post-creation puppet edits", () => {
  const before = document();
  const plan = {
    ok: true,
    key: "C",
    record: { name: "C", aliases: [], status: "active" },
    // Creation displaces A's prior overlord B with C.
    puppets: [{ puppet: "A", overlord: "C", status: "active" }],
  };
  const created = planMapPolityCreation(before, plan);
  // Author makes an unrelated puppet edit after C was created.
  const editedAfter = {
    ...created,
    puppets: [...created.puppets, { id: "puppet-d", puppet: "D", overlord: "B", loyalty: 90, status: "active" }],
  };
  const undone = revertMapPolityCreation(editedAfter, "C", before);
  assert.equal(undone.puppets.some((row) => row.puppet === "A" && row.overlord === "B"), true);
  assert.equal(undone.puppets.some((row) => row.puppet === "D" && row.overlord === "B" && row.loyalty === 90), true);
  assert.equal(undone.puppets.some((row) => row.overlord === "C" || row.puppet === "C"), false);

  // If C's starting relations were settled into doc.relations before Undo, revert removes them too.
  const withSettledRelation = {
    ...editedAfter,
    relations: [...editedAfter.relations, { a: "C", b: "B", score: 20 }],
  };
  const undoneAfterSave = revertMapPolityCreation(withSettledRelation, "C", before);
  assert.equal(undoneAfterSave.relations.some((row) => row.a === "C" || row.b === "C"), false);
});
