// The game's MapLibre, compiled from this folder. The worker is built as a module of its own.
import {setWorkerUrl} from "./src/index.ts";
import workerUrl from "./src/source/worker.ts?worker&url";

setWorkerUrl(workerUrl);

export * from "./src/index.ts";
