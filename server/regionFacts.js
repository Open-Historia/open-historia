/*! Open Historia — what the game reads of one region of a map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One reader of a region's properties, for the two places that must agree on
// them: the game's region catalog (src/runtime/assets.js), which every screen
// draws its owners, its seas and its borders from, and the map's checksum
// (server/mapLogicFingerprint.js), which a shared game's guest's copy of the
// map is checked by. The checksum read a region's name and `owner` alone,
// while the catalog takes a region's starting owner from `country` first, then
// `owner`, and reads `gid0`, whether it is land or sea (`typeId`) and what it
// borders (`adjacencies`): two copies that differed only there had one
// checksum, and a guest drew its own starting owners and seas (the review of
// 2026-11-18, wars 10). Reading both through this one function, they cannot
// drift apart.
//
// Pure, and imports nothing: the server and the page both load it (server
// code never imports src/).

const asText = (value) => (value === undefined || value === null ? "" : String(value));
// A value written the same way wherever it was stored: an object's keys in order.
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
};

// What the game reads of a region feature, or null for one with no id. Where
// it lies (`lng`, `lat`, from its centroid property) and its outline are
// read too, by the catalog alone: a map drawn more lightly is the same world.
export const regionFactsOf = (feature) => {
  const props = feature?.properties ?? {};
  // The same id vocabulary the AI's Preview resolver reads from these features
  // (resolveRegionTransfers in gameplay.js), so an id Preview accepted is never
  // "missing" from the compact catalog when Apply revalidates it.
  const rawId = props.id ?? props.GID_1 ?? props.gid_1 ?? props.HASC_1 ?? feature?.id;
  const id = rawId != null ? String(rawId) : "";
  if (!id) return null;
  const centroid = props?.centroid?.coordinates;
  return {
    // A drawn region's baked owner is its `owner` property; carrying it as the
    // catalog's base country lets the prompt tell a real change from the seed.
    country: props.country ? String(props.country) : props.owner ? String(props.owner) : "",
    // Political seed owner is distinct from geographic country on historical
    // maps. Keep the field's presence (including an explicitly unowned "").
    ...(Object.hasOwn(props, "owner") ? { owner: String(props.owner ?? "") } : {}),
    countryCode: props.gid0 ? String(props.gid0) : props.GID_0 ? String(props.GID_0) : "",
    id,
    name: props.name ?? props.NAME_1 ?? props.name_1 ?? id,
    lng: Array.isArray(centroid) ? centroid[0] : props?.lng ?? props?.longitude,
    lat: Array.isArray(centroid) ? centroid[1] : props?.lat ?? props?.latitude,
    tags: Array.isArray(props?.tags) ? props.tags : [],
    type: props?.type ?? "",
    typeId: props?.typeId ?? "",
    adjacencies: Array.isArray(props?.adjacencies) ? props.adjacencies : [],
    claimants: Array.isArray(props?.claimants) ? props.claimants : [],
  };
};

// The facts of a region that make two copies of a map one world, as one line:
// its id, its name, whose it is at the start (as the catalog reads it, and
// whether `owner` is there at all), its country code, whether it is land or
// sea, what it borders, its tags and its claimants. Not where its outline is
// drawn: a lighter outline of the same regions is the same world.
export const regionFactsLine = (feature) => {
  const facts = regionFactsOf(feature);
  if (!facts) return "";
  const sorted = (values) => values.map((entry) => (entry && typeof entry === "object" ? canonical(entry) : asText(entry))).sort();
  return JSON.stringify([
    facts.id,
    asText(facts.name).replace(/\s+/g, " ").trim(),
    asText(facts.country).replace(/\s+/g, " ").trim(),
    "owner" in facts ? asText(facts.owner).replace(/\s+/g, " ").trim() : null,
    facts.countryCode,
    asText(facts.type),
    asText(facts.typeId),
    sorted(facts.adjacencies),
    sorted(facts.tags),
    sorted(facts.claimants),
  ]);
};
