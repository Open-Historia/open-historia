/*! Open Historia — ambiguous aliases and live canonical polity identity; AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";

import { resolvePolityIdentity } from "./polityIdentity.js";
import {
  applyRelationUpdates,
  canonicalDiplomaticPolity,
  validateDiplomaticLedgerPayload,
} from "../Game/AI/nativeDiplomaticDirector.js";

// Actual Old World Blues save has BOTH these active records. Only the first
// owns territory and is the player's configured country. They collide under
// nameKey's intentional punctuation-insensitive identity comparison.
const polities = [
  "U.S Army Alaskan HQ",
  "Brotherhood of Alaska",
  "The Suppliers",
  "Canadian Liberty Militia",
  "Confederation of the Inuit",
];
const liveWorld = () => ({
  polityOverrides: Object.fromEntries([
    ...polities.map(name => [name, { name, status: "active", aliases: [name] }]),
    ["U.S. Army Alaskan HQ", { name: "U.S. Army Alaskan HQ", status: "active" }],
  ]),
  regionOwnershipOverrides: {
    alaska1: "U.S Army Alaskan HQ",
    alaska2: "U.S Army Alaskan HQ",
    alaska3: "U.S Army Alaskan HQ",
    others1: "Brotherhood of Alaska",
    others2: "The Suppliers",
    others3: "Canadian Liberty Militia",
    others4: "Confederation of the Inuit",
  },
  relations: polities.slice(1,4).map((a,i)=>({ id: `existing-${i}`, a, b: polities[0], score: 85, status: "friendly" })),
});

test("registered polity IDs remain independently addressable through exact stable keys despite punctuation-fold collision", () => {
  const world = liveWorld();
  for (const [name, expected] of [
    ["U.S Army Alaskan HQ", polities[0]],
    ["u.s army alaskan hq", polities[0]],
    ["U.S. Army Alaskan HQ", "U.S. Army Alaskan HQ"],
  ]) {
    const resolution = resolvePolityIdentity(name, world, {allowUnknown:false});
    assert.equal(resolution.resolved, expected, name);
    assert.equal(canonicalDiplomaticPolity(name, world), expected);
  }
});

test("all ten five-way treaty relationships validate and apply against stable canonical IDs", () => {
  const world=liveWorld();
  const updates=[];
  for(let i=0;i<polities.length;i++)for(let j=i+1;j<polities.length;j++)updates.push({
    a:polities[i],b:polities[j],score:100,status:"friendly",summary:"Treaty of Ranklet.",eventIndexes:[0],
  });
  assert.equal(updates.length,10);
  const events=[{id:"treaty-event",date:"2275-02-26",title:"Treaty of Ranklet"}];
  assert.equal(validateDiplomaticLedgerPayload({events,relationUpdates:updates,agreementUpdates:[]},{world}),"");
  const result=applyRelationUpdates({world,updates,events,stopDate:"2275-02-26",round:46});
  assert.equal(result.world.relations.length,10);
  assert.equal(result.world.relations.filter(r=>r.a===polities[0]||r.b===polities[0]).length,4);
  assert.ok(result.world.relations.every(r=>r.score===100));
  assert.equal(result.world.polityOverrides["U.S. Army Alaskan HQ"].name,"U.S. Army Alaskan HQ","unrelated duplicate polity record is preserved");
  assert.equal(world.relations[0].score,85,"original save state is not mutated");
});

test("non-exact punctuation variants remain ambiguous regardless of territorial distribution", () => {
  const world=liveWorld();
  for (const hasSecondTerritory of [false,true]) {
    if (hasSecondTerritory) world.regionOwnershipOverrides.alaska4="U.S. Army Alaskan HQ";
    const token="U.S-Army Alaskan HQ";
    const resolution=resolvePolityIdentity(token,world,{allowUnknown:false});
    assert.equal(resolution.resolved,"");
    assert.equal(resolution.status,"ambiguous-exact");
    assert.equal(canonicalDiplomaticPolity(token,world),"");
  }
});

test("shared aliases between distinct registered polities never select one based on territorial weight", () => {
  const world={
    polityOverrides:{
      "First Republic": {name:"First Republic",aliases:["Former State"],status:"active"},
      "Second Republic": {name:"Second Republic",aliases:["Former State"],status:"active"},
    },
    regionOwnershipOverrides:{a:"First Republic"},
  };
  assert.equal(resolvePolityIdentity("Former State",world,{allowUnknown:false}).resolved,"");
  assert.equal(canonicalDiplomaticPolity("Former State",world),"");
});
