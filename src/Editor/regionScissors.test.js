import test from "node:test";
import assert from "node:assert/strict";
import Feature from "ol/Feature.js";
import Polygon from "ol/geom/Polygon.js";
import MultiPolygon from "ol/geom/MultiPolygon.js";
import VectorSource from "ol/source/Vector.js";
import { planarGeometryArea } from "./geometry.js";
import { splitGeometryByLine, splitRegionFeature } from "./regionScissors.js";

const rectangle=(x0,y0,x1,y1)=>new Polygon([[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]);
const area=(g)=>planarGeometryArea(g);
const approx=(x,y)=>Math.abs(x-y)<=Math.max(1e-5,Math.abs(y)*1e-6);

test("scissors divides a region on a straight line without gaps or lost area",()=>{
  const geo=rectangle(0,0,100,100);
  const split=splitGeometryByLine(geo,[[40,10],[40,90]]);
  assert.ok(split);
  assert.equal(split.length,2);
  assert.ok(approx(area(split[0]),6000));
  assert.ok(approx(area(split[1]),4000));
  assert.ok(approx(area(split[0])+area(split[1]),area(geo)));
});

test("scissors follows bent lines and preserves polygon holes and disconnected geometry",()=>{
  const bent=splitGeometryByLine(rectangle(0,0,100,100),[[25,20],[65,40],[75,75]]);
  assert.ok(bent);
  assert.ok(approx(area(bent[0])+area(bent[1]),10000));
  const donut=new Polygon([
    [[0,0],[100,0],[100,100],[0,100],[0,0]],
    [[40,40],[60,40],[60,60],[40,60],[40,40]],
  ]);
  const donutSplit=splitGeometryByLine(donut,[[25,15],[25,85]]);
  assert.ok(donutSplit);
  assert.ok(approx(area(donutSplit[0])+area(donutSplit[1]),9600));
  const multipoly=new MultiPolygon([rectangle(0,0,100,100).getCoordinates(),rectangle(150,0,180,30).getCoordinates()]);
  const multiSplit=splitGeometryByLine(multipoly,[[50,20],[50,80]]);
  assert.ok(multiSplit);
  assert.ok(approx(area(multiSplit[0])+area(multiSplit[1]),10900));
});

test("scissors fails closed on noncrossing, malformed and crossed lines",()=>{
  const geo=rectangle(0,0,100,100);
  assert.equal(splitGeometryByLine(geo,[[180,20],[180,80]]),null);
  assert.equal(splitGeometryByLine(geo,[[10,10]]),null);
  assert.equal(splitGeometryByLine(geo,[[30,20],[30,20]]),null);
  assert.equal(splitGeometryByLine(geo,[[20,20],[80,80],[20,80],[80,20]]),null);
  assert.equal(splitGeometryByLine(geo,[[NaN,10],[10,20]]),null);
});

test("scissors preserves original ID, ownership, claimant metadata and Undo/Redo flags",()=>{
  for(const previousEdited of [undefined,false,true]){
    const feature=new Feature({geometry:rectangle(0,0,100,100),name:"Old region",owner:"Old polity",typeId:"land",gid0:"DEU",gid1:"DEU.1_1",claimants:["Claimant"],group:"Group A"});
    feature.setId("DEU.1_1");
    if(previousEdited!==undefined)feature.set("edited",previousEdited);
    const source=new VectorSource({features:[feature]});
    const result=splitRegionFeature(source,feature,[[40,10],[40,90]],()=> "reg_scissors_test");
    assert.ok(result);
    assert.equal(result.retainedId,"DEU.1_1");
    assert.equal(source.getFeatures().length,2);
    const created=source.getFeatureById(result.createdId);
    assert.equal(created.get("owner"),"Old polity");
    assert.equal(created.get("group"),"Group A");
    assert.deepEqual(created.get("claimants"),["Claimant"]);
    assert.equal(created.get("name"),"Old region (split)");
    assert.equal(created.get("gid0"),"");
    assert.equal(created.get("gid1"),undefined);
    assert.equal(created.get("edited"),true);
    assert.equal(feature.get("edited"),true);
    assert.ok(approx(area(created.getGeometry())+area(feature.getGeometry()),10000));
    result.undo();
    assert.equal(source.getFeatures().length,1);
    assert.equal(area(feature.getGeometry()),10000);
    assert.equal(feature.get("edited"),previousEdited);
    assert.equal(feature.getKeys().includes("edited"),previousEdited!==undefined);
    result.redo();
    assert.equal(source.getFeatures().length,2);
    assert.equal(source.getFeatureById(result.createdId),created);
    assert.equal(feature.get("edited"),true);
  }
});

test("scissors does not change the existing region when split fails or a new ID collides",()=>{
  const feature=new Feature({geometry:rectangle(0,0,100,100),owner:"A"});
  feature.setId("original");
  const source=new VectorSource({features:[feature]});
  const before=feature.getGeometry().getCoordinates();
  assert.equal(splitRegionFeature(source,feature,[[180,10],[180,90]],()=> "new"),null);
  assert.equal(splitRegionFeature(source,feature,[[40,10],[40,90]],()=> "original"),null);
  assert.deepEqual(feature.getGeometry().getCoordinates(),before);
  assert.equal(source.getFeatures().length,1);
});
