import test from "node:test";
import { runFronts } from "../../../../../src/runtime/fronts/engine.js";
import { frontInput, syntheticMap } from "../../../../../src/runtime/fronts/syntheticMap.js";
import { battlefieldOn } from "../../../../../src/runtime/fronts/testKit.js";
import { orderTransport } from "../../../../../src/runtime/fronts/transports.js";

const legend = { A: "Aland", B: "Borduria", "~": null };
const layout = [
  ...Array.from({ length: 12 }, () => "AAAAAAAAAAAAAAABBBBBBBBBBBBBBB"),
  ...Array.from({ length: 3 }, () => "AA~~~~~~~~~~~~~~~~~~~~~~~~~~~~"),
  "AA~~~~~~~~~~~~BBBBBBBBBBBBBBBB",
  "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
];
const places = [
  { name: "Alba", lng: 26, lat: 58.5, capital: true },
  { name: "Harbour", lng: 33.5, lat: 51.5 },
  { name: "Westhaven", lng: 21.5, lat: 48.5 },
  { name: "Southport", lng: 40.5, lat: 47.5 },
];
const sheet = (cities, key) => syntheticMap({ layout, legend, west: 20, north: 63, step: 1, cities, key });
const row = (lng, south, north, count) => Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count }));
const fight = (world, probe, extra = {}) => runFronts(frontInput(world, { arenas: new Map(), troops: 1, [probe]: 1, ...extra }));

test("golden probes: troops far from the sea go overland to a port on their way", () => {
  const world = sheet(places, "golden-ports");
  const front = runFronts(frontInput(world, { arenas: new Map(), troops: 1, battlefields: [battlefieldOn(world, { troops: [row(34.9, 54.5, 58.5, 12), row(35.1, 54.5, 58.5, 8)], pool: [200, 200] })], days: 0 })).battlefields[0];
  if (!front) return;
  const picked = Array.from({ length: 4 }, (_, index) => index);
  const sent = orderTransport([], { medium: "sea", owner: "Aland", to: { lng: 40.5, lat: 47.5, name: "city: Southport" }, embark: { battlefield: front.name, side: 0, troops: picked }, by: "Aland" }, { date: "2024-03-01", year: 2024 });
  const both = orderTransport(sent.transports, { medium: "sea", owner: "Aland", to: { name: "city: Southport" }, raise: 6 }, { date: "2024-03-01", year: 2024 });
  fight(world, "goldenPortsSail", { battlefields: [front], transports: both.transports, days: 2 });
  const portless = sheet([places[0], places[3]], "golden-ports-none");
  fight(portless, "goldenPortsNone", { battlefields: [front], transports: sent.transports, days: 1 });
});
