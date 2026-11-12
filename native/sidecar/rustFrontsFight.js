import { labStaffPolicy, trainedStaffPolicy } from "../../src/runtime/fronts/mind/trained.js";
import { engineRegionsOf, runTurnFronts } from "../../src/Game/AI/frontTurn.js";
import { eventNarratesHardCombat } from "../../src/Game/AI/nativeWarLedger.js";
import { territoryTempoAllowance } from "../../src/Game/AI/worldDirection.js";
import { rustRunMaker } from "./rustFronts.mjs";

let kept = { key: "", arenas: new Map() };
const arenasFor = (key) => {
  if (kept.key !== key) kept = { key, arenas: new Map() };
  return kept.arenas;
};

const regionsReadHere = async (ask) => {
  try {
    const file = await ask("regionsFile");
    if (!file?.url || typeof fetch !== "function") return null;
    const response = await fetch(file.url, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return null;
    const names = new Map(Array.isArray(file.names) ? file.names : []);
    const regions = engineRegionsOf(await response.json(), { nameOf: (id) => names.get(id) });
    return regions.length > 0 ? regions : null;
  } catch {
    return null;
  }
};

export const fightInRust = async (host, data = {}, { ask, pause = null, onRuns = null, slice } = {}) => {
  const { staff = null, tempo = 0, narrates = false, strikes = [], readsMap = false, readsRegions = false, findsRegionsFile = false, ...rest } = data ?? {};
  const asks = Array.isArray(strikes) ? strikes : [];
  let regionIds = null;
  const led = Boolean(staff && trainedStaffPolicy());
  const maker = rustRunMaker(host, { policy: led ? { by: "mindTrained.labStaffPolicy", a: [staff] } : null, regionIds: () => regionIds, ...(slice ? { slice } : {}) });
  onRuns?.(maker);
  try {
    return await runTurnFronts({
      ...rest,
      createFrontRun: maker.createFrontRun,
      ...(readsMap ? {
        readMap: async () => {
          const read = await ask("readMap");
          if (Array.isArray(read?.regionIds)) regionIds = read.regionIds;
          return read ? { ...read, arenas: arenasFor(String(read.map?.key ?? "")) } : read;
        },
      } : {}),
      ...(readsRegions ? { loadRegions: async () => (findsRegionsFile ? await regionsReadHere(ask) : null) ?? ask("loadRegions") } : {}),
      pause: typeof pause === "function" ? pause : async () => {},
      ...(tempo > 0 ? { tempoAllowance: (days) => territoryTempoAllowance(tempo, Math.max(1, days)) } : {}),
      ...(led ? { staffPolicy: labStaffPolicy(staff) } : {}),
      ...(narrates ? { narratesCombat: eventNarratesHardCombat } : {}),
      ...(asks.length > 0 ? {
        strikePlaces: Object.fromEntries(asks.map((name) => [name, (value) => ask(`strike.${name}`, value)])),
      } : {}),
    });
  } finally {
    maker.release();
  }
};
