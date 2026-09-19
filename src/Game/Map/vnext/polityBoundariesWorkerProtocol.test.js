/*! Open Historia — Political Cartography Pipeline v2 worker protocol tests © 2026 Open Historia contributors, AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";

const rectangle = (id, owner, x0, x1) => ({
  type: "Feature",
  id,
  properties: { id, owner, name: id },
  geometry: {
    type: "Polygon",
    coordinates: [[
      [x0, 0], [x1, 0], [x1, 1], [x0, 1], [x0, 0],
    ]],
  },
});


const box = (id, owner, x0, x1, y0, y1) => ({
  type: "Feature",
  id,
  properties: {
    id,
    owner,
    name: id,
    centroid: { type: "Point", coordinates: [(x0 + x1) / 2, (y0 + y1) / 2] },
  },
  geometry: {
    type: "Polygon",
    coordinates: [[
      [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0],
    ]],
  },
});


const denseRectangle = (id, owner, x0, x1, pointsPerEdge = 160) => {
  const points = [];
  const y0 = 0;
  const y1 = 1;
  for (let i = 0; i < pointsPerEdge; i += 1) points.push([x0 + ((x1 - x0) * i) / pointsPerEdge, y0]);
  for (let i = 0; i < pointsPerEdge; i += 1) points.push([x1, y0 + ((y1 - y0) * i) / pointsPerEdge]);
  for (let i = 0; i < pointsPerEdge; i += 1) points.push([x1 - ((x1 - x0) * i) / pointsPerEdge, y1]);
  for (let i = 0; i < pointsPerEdge; i += 1) points.push([x0, y1 - ((y1 - y0) * i) / pointsPerEdge]);
  points.push(points[0]);
  return {
    type: "Feature",
    id,
    properties: { id, owner, name: id },
    geometry: { type: "Polygon", coordinates: [points] },
  };
};

const regions = {
  type: "FeatureCollection",
  features: [
    rectangle("a1", "A", 0, 1),
    rectangle("a2", "A", 1, 2),
    rectangle("b1", "B", 2, 3),
    rectangle("c1", "C", 3, 4),
  ],
};

const messages = [];
globalThis.self = {
  postMessage(message) {
    messages.push(message);
  },
};
await import(`./polityBoundariesWorker.js?protocol-test=${Date.now()}`);

const send = async (data) => {
  const start = messages.length;
  await globalThis.self.onmessage({ data });
  return messages.slice(start);
};

test("worker publishes compact catalog before initial political cartography", async () => {
  const out = await send({
    requestId: 1,
    type: "initialize",
    geometryEpoch: "g1",
    regions,
    ownershipOverrides: {},
    regionClaimants: {},
    labelNames: { A: "A", B: "B", C: "C" },
  });
  assert.equal(out[0]?.messageType, "catalog-ready");
  assert.equal(out[0]?.metadata?.records?.length, 4);
  assert.equal(out[1]?.messageType, "cartography-result");
  assert.equal(out[1]?.boundaryPatch?.removeAll, true);
});

test("ownership update removes a polity label when its canonical region membership reaches zero", async () => {
  const out = await send({
    requestId: 2,
    type: "update-ownership",
    geometryEpoch: "g1",
    ownershipOverrides: { a1: "B", a2: "B" },
    regionClaimants: {},
    labelNames: { A: "A", B: "B", C: "C" },
    affectedOwners: ["A", "B"],
    changedRegionIds: ["a1", "a2"],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0]?.messageType, "ownership-transition-ready");
  assert.equal(out[1]?.messageType, "cartography-result");
  const result = out[1];
  const owners = new Set((result.labels?.labelData?.features ?? []).map((feature) => feature?.properties?.sourceOwner ?? feature?.properties?.owner));
  assert.equal(owners.has("A"), false, "a vanished polity must not retain a derived label");
  assert.equal(owners.has("B"), true);
  assert.ok((result.boundaryPatch?.removeIds?.length ?? 0) + (result.boundaryPatch?.upsert?.length ?? 0) > 0);
  assert.equal(result.ownershipTransitionData?.features?.length, 2);
  const transitionIds = new Set(result.ownershipTransitionData.features.map((feature) => feature.properties.id));
  assert.deepEqual(transitionIds, new Set(["a1", "a2"]));
  assert.ok(result.ownershipTransitionData.features.every((feature) => Number.isFinite(feature.properties.sweepDx)));
  assert.ok(result.ownershipTransitionData.features.every((feature) => Number.isFinite(feature.properties.sweepDy)));
});

test("forceFullSnapshot returns a self-contained current boundary snapshot after an unpublished worker revision", async () => {
  const out = await send({
    requestId: 3,
    type: "update-ownership",
    geometryEpoch: "g1",
    ownershipOverrides: { a1: "C", a2: "B" },
    regionClaimants: {},
    labelNames: { A: "A", B: "B", C: "C" },
    affectedOwners: ["B", "C"],
    changedRegionIds: ["a1"],
    forceFullSnapshot: true,
  });
  const result = out.find((message) => message?.messageType === "cartography-result");
  assert.equal(result?.boundaryPatch?.removeAll, true);
  assert.ok(Array.isArray(result?.boundaryPatch?.upsert));
  assert.ok((result?.labels?.labelData?.features?.length ?? 0) >= 2);
});


test("forceFullSnapshot on claim-only recovery republishes boundaries labels and current disputes", async () => {
  const out = await send({
    requestId: 4,
    type: "update-claims",
    geometryEpoch: "g1",
    ownershipOverrides: { a1: "C", a2: "B" },
    regionClaimants: { a1: ["A"] },
    labelNames: { A: "Alpha", B: "Beta", C: "Gamma" },
    forceFullSnapshot: true,
  });
  const result = out[0];
  assert.equal(result?.boundaryPatch?.removeAll, true);
  assert.ok(Array.isArray(result?.boundaryPatch?.upsert));
  assert.ok((result?.labels?.labelData?.features?.length ?? 0) >= 2);
  const dispute = (result?.disputedData?.features ?? []).find((feature) => feature?.properties?.id === "a1");
  assert.deepEqual(dispute?.properties?._liveClaimants, ["A"]);
});

test("forceFullSnapshot on label-only recovery also republishes current dispute state", async () => {
  const out = await send({
    requestId: 5,
    type: "update-labels",
    geometryEpoch: "g1",
    ownershipOverrides: { a1: "C", a2: "B" },
    regionClaimants: { a1: ["A"] },
    labelNames: { A: "Alpha", B: "Beta", C: "Gamma Prime" },
    affectedOwners: ["C"],
    forceFullSnapshot: true,
  });
  const result = out[0];
  assert.equal(result?.boundaryPatch?.removeAll, true);
  assert.ok((result?.labels?.labelData?.features?.length ?? 0) >= 2);
  const dispute = (result?.disputedData?.features ?? []).find((feature) => feature?.properties?.id === "a1");
  assert.deepEqual(dispute?.properties?._liveClaimants, ["A"]);
});

test("claim and display-name changes coalesce without losing the label revision", async () => {
  await send({
    requestId: 6,
    type: "update-labels",
    geometryEpoch: "g1",
    ownershipOverrides: { a1: "C", a2: "B" },
    regionClaimants: {},
    labelNames: { A: "Alpha", B: "Beta", C: "Gamma Before" },
    affectedOwners: ["C"],
  });

  const out = await send({
    requestId: 7,
    type: "update-claims",
    geometryEpoch: "g1",
    ownershipOverrides: { a1: "C", a2: "B" },
    regionClaimants: { a1: ["A"] },
    labelNames: { A: "Alpha", B: "Beta", C: "Gamma After" },
    affectedOwners: ["C"],
  });
  const result = out[0];
  assert.ok(result?.disputedData?.features?.length > 0);
  const cLabel = (result?.labels?.labelData?.features ?? []).find(
    (feature) => (feature?.properties?.sourceOwner ?? feature?.properties?.owner) === "C",
  );
  assert.equal(cLabel?.properties?.name, "GAMMA AFTER");
});

test("forceFullSnapshot derives the complete ownership delta from worker state, not an incomplete hint", async () => {
  await send({
    requestId: 8,
    type: "initialize",
    geometryEpoch: "g2",
    regions,
    ownershipOverrides: {},
    regionClaimants: {},
    labelNames: { A: "A", B: "B", C: "C" },
  });

  const out = await send({
    requestId: 9,
    type: "update-ownership",
    geometryEpoch: "g2",
    ownershipOverrides: { a1: "C", c1: "A" },
    regionClaimants: {},
    labelNames: { A: "A", B: "B", C: "C" },
    // Simulate a coalesced UI hint that only mentions the final incremental leg.
    changedRegionIds: ["c1"],
    affectedOwners: ["A", "C"],
    forceFullSnapshot: true,
  });
  const result = out.find((message) => message?.messageType === "cartography-result");
  const ownerGroups = new Set(
    (result?.boundaryPatch?.upsert ?? []).map((feature) => feature?.properties?.owners),
  );
  assert.equal(result?.boundaryPatch?.removeAll, true);
  assert.ok(ownerGroups.has("A | C"), "a1 must be reclassified even though the incremental hint omitted it");
});


test("tiny ownership changes do not synchronously rebuild huge complex polity labels", async () => {
  const denseRegions = {
    type: "FeatureCollection",
    features: [
      ...Array.from({ length: 100 }, (_, index) => denseRectangle(`huge-${index}`, "Huge", index, index + 0.9)),
      ...Array.from({ length: 8 }, (_, index) => denseRectangle(`small-${index}`, "Small", 110 + index, 110.9 + index, 4)),
    ],
  };

  await send({
    requestId: 10,
    type: "initialize",
    geometryEpoch: "g3",
    regions: denseRegions,
    ownershipOverrides: {},
    regionClaimants: {},
    labelNames: { Huge: "Huge", Small: "Small" },
  });

  const out = await send({
    requestId: 11,
    type: "update-ownership",
    geometryEpoch: "g3",
    ownershipOverrides: { "huge-0": "Small" },
    regionClaimants: {},
    labelNames: { Huge: "Huge", Small: "Small" },
    affectedOwners: ["Huge", "Small"],
    changedRegionIds: ["huge-0"],
  });
  const result = out.find((message) => message?.messageType === "cartography-result");
  assert.equal(result?.stats?.changedRegionCount, 1);
  assert.equal(result?.stats?.refreshedLabelOwnerCount, 1, "the small gaining polity should refresh immediately");
  assert.equal(result?.stats?.deferredLabelOwnerCount, 1, "the huge losing polity should keep its last accepted label for a tiny change");
  assert.deepEqual(result?.stats?.deferredLabelOwners, ["Huge"]);
  const owners = new Set((result?.labels?.labelData?.features ?? []).map(
    (feature) => feature?.properties?.sourceOwner ?? feature?.properties?.owner,
  ));
  assert.equal(owners.has("Huge"), true, "the deferred polity must retain its previous accepted label");
  assert.equal(owners.has("Small"), true, "the gaining polity must publish its current label");
});


test("ownership sweep direction comes from the touching recipient landmass mass, not the local frontier normal", async () => {
  const directionRegions = {
    type: "FeatureCollection",
    features: [
      // Target sits south-east of the recipient polity. Its ONLY direct shared
      // frontier is along the target's NORTH edge; a pure frontier-normal rule
      // would therefore sweep almost straight top->bottom.
      box("target", "A", 0, 2, 0, 2),
      box("recipient-touch", "B", 0, 2, 2, 3),
      // The overwhelming connected territorial mass is WEST / NORTH-WEST.
      // This is the Finland/Karelia class of case the live videos exposed.
      box("recipient-main", "B", -8, 0, 2, 8),
      // A huge detached possession must not drag a local frontier animation
      // toward itself merely because it contributes lots of global area.
      box("recipient-detached", "B", 20, 35, -10, 10),
    ],
  };

  await send({
    requestId: 100,
    type: "initialize",
    geometryEpoch: "direction-g1",
    regions: directionRegions,
    ownershipOverrides: {},
    regionClaimants: {},
    labelNames: { A: "A", B: "B" },
  });

  const out = await send({
    requestId: 101,
    type: "update-ownership",
    geometryEpoch: "direction-g1",
    ownershipOverrides: { target: "B" },
    regionClaimants: {},
    labelNames: { A: "A", B: "B" },
    affectedOwners: ["A", "B"],
    changedRegionIds: ["target"],
  });

  const early = out.find((message) => message?.messageType === "ownership-transition-ready");
  const result = out.find((message) => message?.messageType === "cartography-result");
  assert.equal(out[0]?.messageType, "ownership-transition-ready", "sweep geometry must publish before derived cartography");
  const transition = result?.ownershipTransitionData?.features?.find(
    (feature) => feature?.properties?.id === "target",
  );
  const earlyTransition = early?.ownershipTransitionData?.features?.find(
    (feature) => feature?.properties?.id === "target",
  );
  assert.deepEqual(earlyTransition?.properties, transition?.properties);
  assert.equal(transition?.properties?.sweepBasis, "recipient-landmass-mass");
  assert.ok(Array.isArray(transition?.properties?.frontierSegments));
  assert.ok(transition.properties.frontierSegments.length > 0, "the exact pre-transfer recipient frontier must accompany the macro direction");
  assert.ok(transition?.properties?.sweepDx > 0.45, "recipient mass west of target must drive the sweep eastward");
  assert.ok(transition?.properties?.sweepDy < -0.25, "recipient mass north-west of target must also drive the sweep southward");
  assert.ok(
    Math.abs(transition?.properties?.sweepDx) > Math.abs(transition?.properties?.sweepDy) * 0.6,
    "a north-edge contact must not collapse the sweep into a near-vertical frontier normal when most territory is west/north-west",
  );
});

test("a dispute the world ended stays ended; one it never recorded shows the map's own claimants", async () => {
  const withClaims = (feature, claimants) => ({ ...feature, properties: { ...feature.properties, claimants } });
  await send({
    requestId: 200,
    type: "initialize",
    geometryEpoch: "claims-g1",
    regions: {
      type: "FeatureCollection",
      features: [
        withClaims(rectangle("d1", "A", 0, 1), ["B"]),
        withClaims(rectangle("d2", "A", 1, 2), ["B"]),
        rectangle("d3", "B", 2, 3),
      ],
    },
    ownershipOverrides: {},
    regionClaimants: {},
    labelNames: { A: "A", B: "B", C: "C" },
  });
  const disputes = async (requestId, regionClaimants) => {
    const out = await send({ requestId, type: "update-claims", geometryEpoch: "claims-g1", ownershipOverrides: {}, regionClaimants, labelNames: { A: "A", B: "B", C: "C" } });
    const result = out.find((message) => message?.disputedData) ?? out[0];
    return Object.fromEntries((result?.disputedData?.features ?? []).map((feature) => [feature.properties.id, feature.properties._liveClaimants]));
  };
  assert.deepEqual(await disputes(201, {}), { d1: ["B"], d2: ["B"] }, "nothing recorded: the map's own claims show");
  assert.deepEqual(await disputes(202, { d1: [] }), { d2: ["B"] }, "an ended dispute stays ended");
  assert.deepEqual(await disputes(203, { d1: ["C"] }), { d1: ["C"], d2: ["B"] }, "the world's live list wins");
});
