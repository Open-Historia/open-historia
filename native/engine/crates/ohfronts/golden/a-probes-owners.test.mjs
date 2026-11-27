import test from "node:test";
import { MAX_TRANSPORTS, TRANSPORTS_OUT_MOST, normalizeTransports, orderTransport } from "../../../../../src/runtime/fronts/transports.js";

test("golden probes: how many transporters a country has out is its own", () => {
  const one = (owner, index, status) => ({ id: `${owner[0]}${index}`, medium: "sea", kind: "c", owner, to: { name: "p" }, speed: 700, capacity: 6, raise: 1, status });
  const out = (owner, count, status = (index) => (index % 2 ? "moving" : "ordered")) => Array.from({ length: count }, (_, index) => one(owner, index, status(index)));
  const ask = (owner) => ({ medium: "sea", owner, to: { name: "p" }, raise: 1 });
  const busy = [...out("Borduria", TRANSPORTS_OUT_MOST), ...out("Cisland", TRANSPORTS_OUT_MOST - 1)];
  orderTransport(busy, ask("Aland"), { year: 2024 });
  orderTransport(busy, ask("Borduria"), { year: 2024 });
  orderTransport(busy, ask(" borduria "), { year: 2024 });
  orderTransport(busy, ask("Cisland"), { year: 2024 });
  orderTransport(out("Aland", TRANSPORTS_OUT_MOST, () => "landed"), ask("Aland"), { year: 2024 });
  normalizeTransports(out("Aland", MAX_TRANSPORTS + 3, () => "landed"));
});
