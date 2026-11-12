export const register = (ctx) => {
  const { engine, clean } = ctx;
  return {
    "map.structure.move": async ({ id = "", lng = null, lat = null } = {}) => {
      const marker = clean(id);
      if (!marker) throw new Error("No structure to move.");
      await engine.ctStructurePlacement.saveSettledStructure(marker, { lng: Number(lng), lat: Number(lat) });
      return { ok: true };
    },
  };
};
