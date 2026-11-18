import os from "node:os";
import { diplomaticSettings } from "./diplomap.mjs";

const linkLocal = (address) => /^169\.254\./.test(address) || /^fe80:/i.test(address);

export const register = (ctx) => {
  const { engine, storage } = ctx;
  const keys = engine.mapSettings.MAP_SETTING_KEYS;
  return {
    "hud.mapMode": async () => {
      const kept = diplomaticSettings(engine);
      engine.mapSettings.setMapSettingValue(keys.mapMode, kept.mode);
      return { mode: kept.mode };
    },
    "hud.setMapMode": async ({ mode }) => {
      const shown = mode === "diplomatic" ? "diplomatic" : "political";
      diplomaticSettings(engine);
      engine.mapSettings.setMapSettingValue(keys.mapMode, shown);
      engine.diplomaticMapSettings.setDiplomaticMapState(shown === "diplomatic" ? { mode: shown, legendOpen: true } : { mode: shown });
      storage.flush?.();
      return true;
    },
    "net.online": async () => {
      let groups = [];
      try {
        groups = Object.values(os.networkInterfaces() ?? {});
      } catch {
        return { online: true };
      }
      return { online: groups.some((rows) => (rows ?? []).some((row) => row && !row.internal && row.address && !linkLocal(row.address))) };
    },
  };
};
