import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";

process.env.OH_DATA_DIR = workerData.dataDir;
process.env.OH_ASSETS_DIR = workerData.assetsDir;
process.env.OH_CHANNEL = workerData.channel;
process.env.OH_DISCORD_PRESENCE = workerData.discord ? "1" : "0";
process.env.PORT = String(workerData.port);

for (const method of ["log", "info", "debug"]) {
  console[method] = (...args) => console.error(...args);
}

await import(pathToFileURL(path.join(workerData.repo, "server", "server.js")).href);
parentPort.postMessage({ type: "imported" });
