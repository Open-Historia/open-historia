import os from "node:os";

const linkLocal = (address) => /^169\.254\./.test(address) || /^fe80:/i.test(address);

export const register = (ctx) => {
  const { engine, clean, storage } = ctx;
  const keys = engine.mapSettings.MAP_SETTING_KEYS;
  return {
    "hud.mapMode": async () => ({ mode: clean(engine.mapSettings.getMapSettingValue(keys.mapMode, "political")) || "political" }),
    "hud.setMapMode": async ({ mode }) => {
      engine.mapSettings.setMapSettingValue(keys.mapMode, mode === "diplomatic" ? "diplomatic" : "political");
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
