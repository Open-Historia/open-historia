import test from "node:test";
import { runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";
import { battlefieldOn } from "../../../../../src/runtime/fronts/testKit.js";
import { orderTransport } from "../../../../../src/runtime/fronts/transports.js";

const legend = { A: "Aland", B: "Borduria", "~": null };
const layout = [
  ...Array.from({ length: 6 }, () => "AAAAAAABBBBBBBB"),
  "A~~~~~~~~~~~~~~",
  "A~~~~~~~~~~~~~~",
  "A~~~~~~BBBBBBBB",
  "~~~~~~~~~~~~~~~",
];
const places = [
  { name: "Alba", lng: 25, lat: 58.5, capital: true },
  { name: "Harbour", lng: 32.5, lat: 51.5 },
  { name: "Westhaven", lng: 21, lat: 48 },
  { name: "Bordo", lng: 42, lat: 57, capital: true },
];
const row = (lng, south, north, count) => Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count }));

test("golden probes: troops far from the sea go overland to a port on their way, and a country with none is refused", () => {
  const world = syntheticMap({ layout, legend, west: 20, north: 63, step: 2, cities: places, key: "golden-ports" });
  const front = battlefieldOn(world, { troops: [row(33.9, 54.5, 58.5, 12), row(34.1, 54.5, 58.5, 8)], pool: [200, 200] });
  const day = { date: "2024-03-01", year: 2024 };
  const shore = { lng: 40.5, lat: 46, name: "region: Borduria 10.8" };
  const sent = orderTransport([], { medium: "sea", owner: "Aland", to: shore, embark: { battlefield: front.name, side: 0, troops: [0, 1, 2, 3] }, by: "Aland" }, day);
  const raised = orderTransport(sent.transports, { medium: "sea", owner: "Aland", to: shore, raise: 6 }, day);
  const back = orderTransport(raised.transports, { medium: "sea", owner: "Borduria", to: { lng: 21, lat: 48, name: "city: Westhaven" }, embark: { battlefield: front.name, side: 1, troops: [0, 1, 2] }, by: "Borduria" }, day);
  runFronts(frontInput(world, { arenas: null, troops: 1, goldenPorts: 1, battlefields: [front], transports: back.transports, days: 2 }));
});
