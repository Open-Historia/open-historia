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
  };
};
