/*! Open Historia — owner code → country name migration © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Rewrites a legacy record whose owners are GADM codes ("RUS") into one whose
// owners are country names ("Russia"). Everything the game keys by owner —
// colours, flags, tags, polities, ownership, units, reputation — moves with it.
//
// This runs ONCE per record, eagerly, gated on world.ownerSchema. It is not a
// read-time transform: the regionsGeojson branch of readRuntimeJsonAsset returns
// before any read hook on both platforms, and that is exactly where `owner`
// physically lives.
//
// The mirror of this file is src/runtime/web/ownerMigration.js. Keep them in step.

// ---------------------------------------------------------------------------
// The resolver. What does the token "ROM" mean in a legacy file?
//
// There is no single source, and the obvious answer is wrong. "Each scenario's
// regions carry owner→country pairs, so it can self-migrate" holds for the modern
// maps and is FALSE for every preset: region.country is the region's MODERN GADM
// country, so roman-117 has one owner ROM spanning 36 distinct country values.
// Hence an ordered resolver rather than a lookup.
// ---------------------------------------------------------------------------

export const OWNER_SCHEMA = 2;

const str = (v) => String(v ?? "").trim();

// Rule 4's input: the owner a region actually has, override winning over the
// baked property.
const effectiveOwner = (feature, ownershipOverrides) => {
  const props = feature?.properties ?? {};
  const id = str(props.id);
  const override = id ? ownershipOverrides?.[id] : null;
  return str(override || props.owner);
};

export const resolveOwnerName = (token, ctx = {}) => {
  const raw = str(token);
  if (!raw) return raw;

  const { polityOverrides, countryNameOverrides, registry, features, ownershipOverrides } = ctx;

  // 1. The scenario's own polity. Catches ROM → "Roman Empire", SOV → "Soviet Union".
  //
  //    The `name !== token` guard is load-bearing. default/world.json carries 9
  //    auto-generated entries for the disputed territories whose name IS the code
  //    ({"Z01": {code: "Z01", name: "Z01"}}). Without the guard those resolve to
  //    themselves and you ship a country called "Z01" — and the accepted
  //    240→231 merge silently dies, because rule 3 never gets to map Z01→India.
  const polity = polityOverrides?.[raw];
  const polityName = str(polity?.name);
  if (polityName && polityName !== raw) return polityName;

  // 2. The legacy per-scenario label. READ ONLY — this field is being deleted, and
  //    this is the last thing that ever reads it. It is the only reason wwii-1939's
  //    hand-authored "Siam" survives in a save made before the preset was rebuilt.
  const legacyLabel = str(countryNameOverrides?.[raw] ?? countryNameOverrides?.[raw.toUpperCase()]);
  if (legacyLabel && legacyLabel !== raw) return legacyLabel;

  // 3. The shipped GADM registry. Handles the whole modern world, and hands us the
  //    accepted disputed-territory merge for free (Z01→India, Z06→Pakistan) from
  //    data that already ships.
  //
  //    Deliberately ahead of rule 4: region.country is the same fact but WORSE.
  //    The seed says "México", "Côte d'Ivoire", "São Tomé and Príncipe", and
  //    truncates "United States Minor Outlying Isl" at 32 characters. The registry
  //    is the normalised form the rest of the code already matches against.
  const known = str(registry?.[raw]);
  if (known) return known;

  // 4. Consensus of the regions this token actually owns. Only when they agree —
  //    a preset's ROM spans 36 modern countries and must NOT pick one of them.
  //    This is what names an FMG world's polities, where nothing else knows them.
  if (Array.isArray(features)) {
    const names = new Set();
    for (const feature of features) {
      if (effectiveOwner(feature, ownershipOverrides) !== raw) continue;
      const name = str(feature?.properties?.country);
      if (name) names.add(name);
      if (names.size > 1) break; // ambiguous — stop early, this rule cannot fire
    }
    if (names.size === 1) return [...names][0];
  }

  // 5. Unknown: the token already IS its own identifier. A custom polity may
  //    simply be its name.
  return raw;
};

// token -> name for every owner reachable in this record, plus the reverse index
// used to re-key the sibling assets. Built once so a record is resolved
// consistently: resolving per-asset could name the same token differently in
// colors.json and world.json.
export const buildOwnerRenameMap = (ctx = {}) => {
  const { polityOverrides, ownershipOverrides, ownerCodes, features, colors, flags, tags, units, countryTags, internationalReputation, gameCountry } = ctx;

  const tokens = new Set();
  const add = (v) => { const s = str(v); if (s) tokens.add(s); };

  Object.keys(polityOverrides ?? {}).forEach(add);
  Object.values(ownershipOverrides ?? {}).forEach(add);
  (Array.isArray(ownerCodes) ? ownerCodes : []).forEach(add);
  Object.keys(colors ?? {}).forEach(add);
  Object.keys(flags ?? {}).forEach(add);
  Object.keys(tags ?? {}).forEach(add);
  Object.keys(countryTags ?? {}).forEach(add);
  Object.keys(internationalReputation ?? {}).forEach(add);
  (Array.isArray(units) ? units : []).forEach((u) => add(u?.ownerCode));
  add(gameCountry);
  for (const feature of Array.isArray(features) ? features : []) add(feature?.properties?.owner);

  const map = new Map();
  for (const token of tokens) map.set(token, resolveOwnerName(token, ctx));
  return map;
};

// N tokens can land on one name — that IS the accepted merge (IND + Z01 + Z04 +
// Z05 + Z07 + Z09 → "India"). When their VALUES then collide in a keyed map, pick
// deterministically rather than letting object order decide: the real country
// beats the disputed placeholder, so India keeps India's orange rather than
// Kashmir's teal.
const preferredToken = (a, b) => {
  const aDisputed = /^Z\d\d$/i.test(a);
  const bDisputed = /^Z\d\d$/i.test(b);
  if (aDisputed !== bDisputed) return aDisputed ? b : a;
  return a.localeCompare(b) <= 0 ? a : b;
};

// Re-key an owner-keyed map, resolving collisions as above. Exported because the
// sibling assets (colors.json / flags.json / tags.json) live outside world.json
// and are re-keyed by the caller in the same transaction as the marker.
export const rekeyOwnerMap = (source, renames, label, warn) => {
  if (!source || typeof source !== "object" || Array.isArray(source)) return source;
  const out = {};
  const winner = new Map(); // name -> the token that claimed it
  for (const [key, value] of Object.entries(source)) {
    const token = str(key);
    const name = renames.get(token) ?? token;
    const held = winner.get(name);
    if (held === undefined) {
      winner.set(name, token);
      out[name] = value;
      continue;
    }
    const keep = preferredToken(held, token);
    if (keep !== held) {
      winner.set(name, token);
      out[name] = value;
      warn?.(`${label}: "${name}" claimed by ${token} over ${held}`);
    } else {
      warn?.(`${label}: dropped ${token} — "${name}" already held by ${held}`);
    }
  }
  return out;
};

const renameValue = (value, renames) => {
  const token = str(value);
  if (!token) return value;
  return renames.get(token) ?? token;
};

// ---------------------------------------------------------------------------
// The record migration. Every structure listed here is owner-keyed; miss one and
// a save desyncs silently rather than failing.
// ---------------------------------------------------------------------------
export const migrateWorld = (world, renames, warn) => {
  if (!world || typeof world !== "object" || Array.isArray(world)) return world;
  const next = { ...world };

  if (next.regionOwnershipOverrides && typeof next.regionOwnershipOverrides === "object") {
    next.regionOwnershipOverrides = Object.fromEntries(
      Object.entries(next.regionOwnershipOverrides).map(([regionId, owner]) => [
        regionId, // region ids are NOT owner-space — they never move
        renameValue(owner, renames),
      ]),
    );
  }

  if (Array.isArray(next.ownerCodes)) {
    next.ownerCodes = [...new Set(next.ownerCodes.map((entry) => renameValue(entry, renames)))];
  }

  if (next.polityOverrides && typeof next.polityOverrides === "object") {
    // The `.code` field goes: the KEY is the name, and a `.code` alongside it is
    // the very thing being deleted. Keeping it would leave every polity carrying a
    // stale second identifier for the next reader to be misled by.
    //
    // Degenerate entries are DROPPED rather than renamed. default/world.json
    // auto-generates {"Z01": {code:"Z01", name:"Z01", color:<disputed teal>}} for
    // each disputed sliver: the entry claims the token is named after itself, which
    // the registry contradicts (Z01 means India). Renaming it instead produces a
    // polity asserting "India is a custom polity called India", coloured Kashmir's
    // teal — and promptContext feeds polities to the model, so that noise is taught.
    //
    // The test is NOT `name === key`: an FMG world's {"Votengia": {name:"Votengia"}}
    // has exactly that shape and is entirely real. What marks the junk is that the
    // self-name DISAGREES with what the token actually resolves to.
    const kept = {};
    for (const [key, polity] of Object.entries(next.polityOverrides)) {
      const token = str(key);
      const name = renames.get(token) ?? token;
      if (!polity || typeof polity !== "object") {
        kept[token] = polity;
        continue;
      }
      if (str(polity.name) === token && name !== token) {
        warn?.(`polityOverrides: dropped degenerate ${token} (self-named, but resolves to "${name}")`);
        continue;
      }
      const { code, ...rest } = polity;
      kept[token] = { ...rest, name };
    }
    next.polityOverrides = rekeyOwnerMap(kept, renames, "polityOverrides", warn);
  }

  if (Array.isArray(next.units)) {
    next.units = next.units.map((unit) =>
      unit && typeof unit === "object" && unit.ownerCode
        ? { ...unit, ownerCode: renameValue(unit.ownerCode, renames) }
        : unit,
    );
  }

  next.countryTags = rekeyOwnerMap(next.countryTags, renames, "countryTags", warn);
  next.internationalReputation = rekeyOwnerMap(next.internationalReputation, renames, "internationalReputation", warn);

  next.ownerSchema = OWNER_SCHEMA;
  return next;
};

// storage/events.json — persisted AND replayed into world by
// applyEventImpactsToWorld, so a code left in here is re-injected into a migrated
// world the next time the log is applied.
export const migrateEvents = (events, renames) => {
  if (!Array.isArray(events)) return events;
  return events.map((event) => {
    const impacts = event?.impacts;
    if (!impacts || typeof impacts !== "object") return event;
    const next = { ...impacts };
    if (Array.isArray(next.regionTransfers)) {
      next.regionTransfers = next.regionTransfers.map((t) => ({
        ...t,
        ...(t?.toCode ? { toCode: renameValue(t.toCode, renames) } : {}),
        ...(t?.fromCode ? { fromCode: renameValue(t.fromCode, renames) } : {}),
      }));
    }
    if (Array.isArray(next.polityChanges)) {
      next.polityChanges = next.polityChanges.map((c) => (c?.code ? { ...c, code: renameValue(c.code, renames) } : c));
    }
    if (Array.isArray(next.unitOps)) {
      next.unitOps = next.unitOps.map((op) =>
        op?.unit?.ownerCode
          ? { ...op, unit: { ...op.unit, ownerCode: renameValue(op.unit.ownerCode, renames) } }
          : op,
      );
    }
    return { ...event, impacts: next };
  });
};

// storage/chat.json — the diplomacy model. countries[].code drives the flag shown
// against each speaker.
export const migrateChat = (chat, renames) => {
  if (!chat || typeof chat !== "object" || Array.isArray(chat)) return chat;
  const next = { ...chat };
  if (Array.isArray(next.countries)) {
    next.countries = next.countries.map((c) => (c?.code ? { ...c, code: renameValue(c.code, renames) } : c));
  }
  if (Array.isArray(next.messages)) {
    next.messages = next.messages.map((m) => {
      const out = m?.code ? { ...m, code: renameValue(m.code, renames) } : { ...m };
      if (out.reactions && typeof out.reactions === "object") {
        out.reactions = Object.fromEntries(
          Object.entries(out.reactions).map(([k, v]) => [
            k, // reaction name, not owner-space
            v && typeof v === "object" && v.code ? { ...v, code: renameValue(v.code, renames) } : v,
          ]),
        );
      }
      return out;
    });
  }
  return next;
};

export const migrateGame = (game, renames) => {
  if (!game || typeof game !== "object" || Array.isArray(game) || !game.country) return game;
  return { ...game, country: renameValue(game.country, renames) };
};

// regions.geojson — properties.owner ONLY.
//
// `id` is the region's identity, not the country's. `gid0` stays as GADM
// provenance: the stock tiles are keyed on it forever, and build-preset's grants
// resolve through it. `country` is dropped — once owner IS the name, a separate
// display name beside it is a second copy of the same fact that can only drift.
export const migrateRegions = (fc, renames) => {
  if (!fc || !Array.isArray(fc.features)) return fc;
  return {
    ...fc,
    features: fc.features.map((feature) => {
      const props = feature?.properties;
      if (!props) return feature;
      const { country, ...rest } = props;
      const owner = str(rest.owner);
      return { ...feature, properties: owner ? { ...rest, owner: renames.get(owner) ?? owner } : rest };
    }),
  };
};

export const needsMigration = (world) => Number(world?.ownerSchema ?? 1) < OWNER_SCHEMA;
