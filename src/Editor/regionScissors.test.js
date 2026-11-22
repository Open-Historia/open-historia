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

test("scissors does not slice an unrelated island in a MultiPolygon and rejects collinear/T-junction paths", () => {
  const islandA = rectangle(0, 0, 100, 100).getCoordinates();
  const islandB = rectangle(150, 0, 180, 30).getCoordinates();
  const multi = new MultiPolygon([islandA, islandB]);
  const split = splitGeometryByLine(multi, [[10, 15], [90, 15]]);
  assert.ok(split);
  // Island B (area 900) must remain completely uncut inside the larger piece (area 8500 + 900 = 9400),
  // while the smaller piece is only the bottom slice of Island A (area 1500).
  assert.ok(approx(area(split[0]), 9400));
  assert.ok(approx(area(split[1]), 1500));
  // Collinear backtracking and T-junction self-touching lines fail closed.
  assert.equal(splitGeometryByLine(rectangle(0, 0, 100, 100), [[10, 50], [80, 50], [40, 50]]), null);
  assert.equal(splitGeometryByLine(rectangle(0, 0, 100, 100), [[10, 50], [90, 50], [90, 80], [50, 50]]), null);

  // An L-shaped island whose bounding box overlaps the cut line's bounding box
  // without actually intersecting the cut line must remain completely uncut.
  const lIsland = [[[10, 0], [120, 0], [120, 20], [30, 20], [30, 120], [10, 120], [10, 0]]];
  const mainSquare = rectangle(40, 40, 100, 100).getCoordinates();
  const lMulti = new MultiPolygon([mainSquare, lIsland]);
  const lSplit = splitGeometryByLine(lMulti, [[50, 70], [90, 70]]);
  assert.ok(lSplit);
  const lArea = area(new Polygon(lIsland));
  // Main square (3600) splits evenly into 1800 + 1800; L-island attaches intact to one side.
  assert.ok(approx(area(lSplit[0]), 1800 + lArea));
  assert.ok(approx(area(lSplit[1]), 1800));

  // Web Mercator magnitude (~1e7 m) collinear backtracking still fails closed via scale-normalized tolerance.
  const mercatorRect = rectangle(1e7, 1e7, 1e7 + 1e5, 1e7 + 1e5);
  assert.equal(
    splitGeometryByLine(mercatorRect, [[1e7 + 1e4, 1e7 + 5e4], [1e7 + 9e4, 1e7 + 5e4], [1e7 + 5e4, 1e7 + 5e4]]),
    null,
  );

  // Drawing strictly in water between two disconnected islands separates them without slicing either.
  const westIsland = rectangle(0, 0, 100, 100).getCoordinates();
  const eastIsland = rectangle(200, 0, 250, 100).getCoordinates();
  const archipelago = new MultiPolygon([westIsland, eastIsland]);
  const waterSplit = splitGeometryByLine(archipelago, [[150, 10], [150, 90]]);
  assert.ok(waterSplit);
  assert.ok(approx(area(waterSplit[0]), 10000));
  assert.ok(approx(area(waterSplit[1]), 5000));

  // Cutting off a smaller peninsula keeps an offshore islet on the peninsula's side of the cut.
  const mainland = rectangle(0, 0, 100, 100).getCoordinates();
  const offshoreIslet = rectangle(10, 120, 30, 140).getCoordinates(); // area 400, strictly above y=80
  const coastRegion = new MultiPolygon([mainland, offshoreIslet]);
  const coastSplit = splitGeometryByLine(coastRegion, [[-10, 80], [110, 80]]);
  assert.ok(coastSplit);
  // Mainland below y=80 is 8000; mainland above y=80 (2000) + offshore islet (400) = 2400.
  assert.ok(approx(area(coastSplit[0]), 8000));
  assert.ok(approx(area(coastSplit[1]), 2400));
});
