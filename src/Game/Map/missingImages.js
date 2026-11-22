// MapLibre 6 takes one resolver for images a style asks for and does not have, and the map has several kinds of them.
const resolvers = new WeakMap();

// `resolve(id)` adds the image if it is one of its own. Returns how to take it off.
export const resolveMissingImages = (map, resolve) => {
  let kinds = resolvers.get(map);
  if (!kinds) {
    kinds = new Set();
    resolvers.set(map, kinds);
    map.setMissingStyleImageResolver?.((id) => {
      for (const kind of kinds) kind(id);
    });
  }
  kinds.add(resolve);
  return () => kinds.delete(resolve);
};
