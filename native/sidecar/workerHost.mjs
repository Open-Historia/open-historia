import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { installWorkerShim } from "./workers.js";

const { entry, origin, distDir } = workerData;

for (const method of ["log", "info", "debug", "warn"]) {
  console[method] = (...args) => process.stderr.write(`${args.map((value) => (typeof value === "string" ? value : String(value))).join(" ")}\n`);
}

const events = new EventTarget();
globalThis.self = globalThis;
globalThis.addEventListener = events.addEventListener.bind(events);
globalThis.removeEventListener = events.removeEventListener.bind(events);
globalThis.dispatchEvent = events.dispatchEvent.bind(events);
globalThis.location = new URL(`${origin}/`);
globalThis.close = () => process.exit(0);

const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init = undefined) => {
  const raw = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
  const url = raw && raw.startsWith("/") ? `${origin}${raw}` : raw;
  const options = init ? { ...init } : {};
  delete options.cache;
  if (typeof input === "string" || input instanceof URL) return nativeFetch(url, options);
  return nativeFetch(new Request(url, input), options);
};

globalThis.postMessage = (data, transfer = undefined) => {
  const list = Array.isArray(transfer) ? transfer : Array.isArray(transfer?.transfer) ? transfer.transfer : undefined;
  parentPort.postMessage(data, list);
};

let ready = false;
const queue = [];
const deliver = (data) => {
  const event = new MessageEvent("message", { data });
  if (typeof globalThis.onmessage === "function") globalThis.onmessage(event);
  events.dispatchEvent(event);
};
parentPort.on("message", (data) => {
  if (ready) deliver(data);
  else queue.push(data);
});

installWorkerShim({ origin, distDir });
await import(pathToFileURL(entry).href);
ready = true;
for (const data of queue.splice(0)) deliver(data);
