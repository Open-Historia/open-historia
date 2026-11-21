/*! Open Historia - N031 capital relocation regressions. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { normalizeScriptedEvents } from "../../../server/gameFeatures.js";
import { normalizeWorldState, applyEventImpactsToWorld, normalizeEvents } from "../../runtime/gameState.js";
import { capitalCityOptions, capitalCityId } from "../../runtime/capitalSeats.js";
import { mergeCountryStatPatch } from "../../runtime/countryStats.js";
import { buildLookupContext } from "./lookupTools.js";
import { prepareNativeScriptedOutcomes, bindNativeScriptedOutcomes, verifyNativeScriptedRecords, verifyNativeScriptedOutcomes } from "./scriptedNativeOutcomes.js";
import { applyNativeCapitalOutcomes } from "./scriptedCapitalRelocation.js";
import { ensureScriptedEventsWithImpacts } from "./scriptedEventImpacts.js";
import { giveSegmentEventIds } from "./ledgerPins.js";
import { capitalNamesOf,retiredCapitalNamesOf } from "../Map/useWorldState.js";
import { capitalExpr } from "../Map/cityLayerExpressions.js";
import { frontCitiesOf } from "../../runtime/frontCities.js";
import { seatsByCountry } from "../Map/diplomaticSeats.js";

const point=(name,lng,lat,capital="",population=100)=>({type:"Feature",geometry:{type:"Point",coordinates:[lng,lat]},properties:{city:name,capital,population}});
const geojson={type:"FeatureCollection",features:[point("Berlin",13,52,"primary",1000),point("Munich",11,48,"",500),point("Hamburg",10,53,"primary",900),point("Paris",2,48,"primary",1200)]};
const polygon=(x,y)=>({type:"Polygon",coordinates:[[[x-1,y-1],[x+1,y-1],[x+1,y+1],[x-1,y+1],[x-1,y-1]]]});
const regions=[["berlin","Germany",13,52],["munich","Germany",11,48],["hamburg","Germany",10,53],["paris","France",2,48]].map(([id,country,x,y])=>({id,country,geometry:polygon(x,y)}));
const world=normalizeWorldState({customRegions:true,customCities:true,polityOverrides:{Germany:{code:"Germany",name:"Germany",status:"active"},France:{code:"France",name:"France",status:"active"}},regionOwnershipOverrides:{berlin:"Germany",munich:"Germany",hamburg:"Germany",paris:"France"},countryStats:{Germany:{capital:"Berlin",government:"Empire",economy:{gdp:100}}}});
const context=(w=world,geo=geojson)=>buildLookupContext({world:w,regions,cities:geo.features.map(f=>({name:w.cityRenames?.[f.properties.city.toLowerCase()]||f.properties.city,aliases:w.cityRenames?.[f.properties.city.toLowerCase()]?[f.properties.city]:[],coordinates:f.geometry.coordinates,capital:f.properties.capital,population:f.properties.population}))});
const date="1914-03-21";
const beat=(cityId,polity="Germany")=>normalizeScriptedEvents([{id:"capital-move",date,text:"The government relocates its seat.",impactRows:[{type:"relocate_capital",polity,cityId,cityName:"Munich"}]}])[0];
const target=capitalCityId("Munich",[11,48]);
const prepare=(e,w=world,c=context(w))=>prepareNativeScriptedOutcomes([e],w,{regionCatalog:regions,cityContext:c});
const shows=(expr,props)=>featureFilter(expr,"layers[0].filter").filter({zoom:4},{type:1,properties:props,geometry:[]});

test("N031 city identity persists across authoring and map-name rename",()=>{
 const cities=capitalCityOptions(geojson,{munich:"Munich-New"});
 assert.equal(cities.find(c=>c.name==="Munich-New").id,target);
 assert.equal(capitalCityOptions([...[]]).length,0);
 const e=beat(target);
 assert.deepEqual(normalizeScriptedEvents([e]),[e]);
 assert.equal(e.impactRows[0].cityId,target);
 assert.equal(e.impacts,undefined);
});

test("N031 relocation applies exact ordinary stats patch and validated map reference in native pipeline",()=>{
 const e=beat(target),req=prepare(e);
 const candidate={events:ensureScriptedEventsWithImpacts([], [e]).events};
 giveSegmentEventIds(candidate.events);
 const bound=bindNativeScriptedOutcomes(candidate,[e],req,world);
 verifyNativeScriptedRecords(bound,candidate,world);
 const impacted=applyEventImpactsToWorld({world,events:normalizeEvents(candidate.events),colors:{},regionCatalog:regions}).world;
 assert.equal(impacted.countryStats.Germany.capital,"Munich");
 const next=applyNativeCapitalOutcomes(bound,impacted);
 verifyNativeScriptedOutcomes(bound,next,normalizeEvents(candidate.events));
 assert.equal(next.countryStats.Germany.capitalMap.current.id,target);
 assert.equal(next.countryStats.Germany.capitalMap.current.regionId,"munich");
 assert.deepEqual(next.countryStats.Germany.capitalMap.retired,["berlin"]);
 assert.equal(next.countryStats.Germany.government,"Empire");
 assert.equal(world.countryStats.Germany.capital,"Berlin");
 assert.deepEqual(next.regionOwnershipOverrides,world.regionOwnershipOverrides);
 const persisted=normalizeWorldState(JSON.parse(JSON.stringify(next)));
 verifyNativeScriptedOutcomes(bound,persisted,normalizeEvents(candidate.events));
 const filter=capitalExpr(capitalNamesOf(persisted).split("\n"),{},undefined,retiredCapitalNamesOf(persisted).split("\n"));
 assert.equal(shows(filter,geojson.features[0].properties),false);
 assert.equal(shows(filter,geojson.features[1].properties),true);
 assert.equal(shows(filter,geojson.features[2].properties),true);
 assert.equal(shows(filter,geojson.features[3].properties),true);
 const cities=frontCitiesOf(geojson,persisted,{gameDate:date});
 assert.equal(cities.find(c=>c.name==="Berlin").capital,false);
 assert.equal(cities.find(c=>c.name==="Munich").capitalOwner,"Germany");
 const records=regions.map(r=>({id:r.id,bounds:[[r.geometry.coordinates[0][0][0],r.geometry.coordinates[0][0][1]],[r.geometry.coordinates[0][2][0],r.geometry.coordinates[0][2][1]]],lng:0,lat:0}));
 assert.equal(seatsByCountry({cities,records,ownerOf:id=>persisted.regionOwnershipOverrides[id]}).get("germany").name,"Munich");
 assert.equal(mergeCountryStatPatch(persisted.countryStats.Germany,{capital:"Berlin",economy:{gdp:200}},{replaceComponents:true}).capital,"Munich");
 const ordinary=mergeCountryStatPatch(persisted.countryStats.Germany,{capital:"Hamburg"});
 assert.equal(ordinary.capital,"Hamburg");
 assert.equal(ordinary.capitalMap.current,undefined);
 assert.ok(ordinary.capitalMap.retired.includes("berlin"));
 assert.ok(ordinary.capitalMap.retired.includes("munich"));
});

test("N031 capital rejects unknown, foreign, ambiguous and unowned destinations",()=>{
 assert.throws(()=>prepare(beat("city:invalid")),/unambiguous city/);
 assert.throws(()=>prepare(beat(capitalCityId("Paris",[2,48]))),/controlled and legally held/);
 assert.throws(()=>prepare(beat(capitalCityId("Berlin",[13,52]))),/already the capital/);
 const duplicate={...geojson,features:[...geojson.features,point("Munich",3,49)]};
 assert.equal(capitalCityOptions(duplicate).some(c=>c.name==="Munich"),false);
 assert.throws(()=>prepare(beat(target),world,context(world,duplicate)),/unambiguous city/);
 const e=beat(target),req=prepare(e);
 const bound=req.map(r=>({...r,eventId:"source"}));
 const lost={...world,regionOwnershipOverrides:{...world.regionOwnershipOverrides,munich:"France"},countryStats:{...world.countryStats,Germany:{capital:"Munich"}}};
 assert.throws(()=>applyNativeCapitalOutcomes(bound,lost),/no longer held/);
 assert.throws(()=>applyNativeCapitalOutcomes(bound,world),/did not apply/);
});

test("N031 capital uses stable original city after a rename and keeps retired map marker",()=>{
 const renamed={...world,cityRenames:{munich:"Munich-New"}};
 const req=prepare(beat(target),renamed);
 assert.equal(req[0].name,"Munich-New");
 assert.equal(req[0].ref.id,target);
 const next=applyNativeCapitalOutcomes(req.map(r=>({...r,eventId:"native-source"})),renamed,{preview:true});
 const result=applyEventImpactsToWorld({world:next,colors:{},events:[{id:"rename",date,title:"New name",description:"Munich-New is renamed.",impacts:{markerOps:[{op:"rename",name:"Munich-New",newName:"Munich-Crown"}]}}],regionCatalog:regions}).world;
 assert.equal(result.countryStats.Germany.capital,"Munich-Crown");
 assert.equal(result.countryStats.Germany.capitalMap.current.id,target);
 assert.equal(result.cityRenames.munich,"Munich-Crown");
 assert.deepEqual(result.countryStats.Germany.capitalMap.retired,["berlin"]);
});
