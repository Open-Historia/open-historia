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

export const OWNER_SCHEMA = 4;

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

  // 0. A polity the map editor marked `verbatim`. The author typed this exact name
  //    and it happens to collide with a GADM code ("USA", "RUS"); take it literally
  //    so the editor never "corrects" it to the code's country ("United States").
  //    Only the editor sets this flag, and only for a name a human actually typed —
  //    legacy code owners, disputed placeholders (Z01), and model output carry no
  //    such flag, so every existing resolution below is unchanged.
  const verbatimPolity = polityOverrides?.[raw];
  if (verbatimPolity?.verbatim) return str(verbatimPolity.name) || raw;

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
  const {
    polityOverrides,
    ownershipOverrides,
    sovereigntyOverrides,
    regionClaimants,
    ownerCodes,
    features,
    colors,
    flags,
    tags,
    units,
    countryTags,
    internationalReputation,
    gameCountry,
  } = ctx;

  const tokens = new Set();
  const add = (v) => { const s = str(v); if (s) tokens.add(s); };

  Object.keys(polityOverrides ?? {}).forEach(add);
  Object.values(ownershipOverrides ?? {}).forEach(add);
  Object.values(sovereigntyOverrides ?? {}).forEach(add);
  for (const claimants of Object.values(regionClaimants ?? {})) {
    if (Array.isArray(claimants)) claimants.forEach(add);
    else if (claimants && typeof claimants === "object") {
      Object.keys(claimants).filter((key) => claimants[key]).forEach(add);
    }
  }
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

// Explicit provenance bridge: which stock GADM geography did this scenario
// deliberately use as the BASE identity for a polity? This is not ownership. An
// empire may control dozens of modern GADM countries and that must never make all
// of them aliases of the empire. We only trust evidence that already says
// "this code was named as this polity": legacy countryNameOverrides, a legacy
// code-keyed polity record, or another owner-space key that is itself a known
// GADM code. That keeps the migration universal and avoids Britain/France hacks.
export const buildPolityMapRefs = (ctx = {}, renames = buildOwnerRenameMap(ctx)) => {
  const {
    polityOverrides,
    countryNameOverrides,
    registry,
    ownerCodes,
    colors,
    flags,
    tags,
    gameCountry,
    features,
    ownershipOverrides,
    inheritedMapRefs,
    deriveMapRefsFromFeatures = true,
  } = ctx;

  const byPolity = new Map();
  const add = (rawCode, rawTarget = rawCode) => {
    const code = str(rawCode).toUpperCase();
    if (!code || !registry?.[code]) return;
    const targetToken = str(rawTarget);
    const target = str(
      renames.get(targetToken) ??
      renames.get(code) ??
      resolveOwnerName(targetToken, ctx),
    );
    if (!target) return;
    const set = byPolity.get(target) || new Set();
    set.add(code);
    byPolity.set(target, set);
  };

  // A game inherits the scenario's already-established provenance. This is the
  // safest evidence available because it was derived from the SCENARIO'S starting
  // political map, not from a campaign that may now contain occupations, annexations,
  // civil wars or other later territorial changes.
  for (const [polity, refs] of Object.entries(inheritedMapRefs ?? {})) {
    for (const code of Array.isArray(refs?.gadm0) ? refs.gadm0 : []) add(code, polity);
  }

  // Explicit legacy evidence. These paths are intentionally retained because old
  // scenarios may still carry their original GADM owner code even when they do not
  // ship custom region geometry.
  for (const [code, label] of Object.entries(countryNameOverrides ?? {})) {
    if (str(label)) add(code, code);
  }

  for (const key of Object.keys(polityOverrides ?? {})) add(key, key);
  for (const key of Object.keys(colors ?? {})) add(key, key);
  for (const key of Object.keys(flags ?? {})) add(key, key);
  for (const key of Object.keys(tags ?? {})) add(key, key);
  for (const key of Array.isArray(ownerCodes) ? ownerCodes : []) add(key, key);
  add(gameCountry, gameCountry);

  // Phase 5B.1 provenance recovery for records that were ALREADY name-migrated
  // before mapRefs existed. The previous migration correctly removed the old ISO/
  // GADM key, which means a later migration can no longer learn that e.g. the
  // scenario's "French Republic" occupied the FRA base geography just by looking
  // at polityOverrides/colors/flags — all of those are name-keyed now.
  //
  // The scenario map still contains the missing relationship. Resolve it CODE-FIRST:
  // every base GID_0 whose regions unanimously belong to one scenario polity becomes
  // a geographic reference for that polity. A polity may therefore have MANY refs
  // (an empire can span several stock countries); that is fine. What we refuse is a
  // GID_0 split between multiple actors, because that is exactly the civil-war /
  // partition case where auto-merging identities would be dangerous.
  //
  // This derivation is scenario-start provenance, not live ownership. Games normally
  // receive inheritedMapRefs from their parent scenario and set
  // deriveMapRefsFromFeatures=false, so a later conquest can never rewrite identity.
  if (deriveMapRefsFromFeatures && Array.isArray(features)) {
    const ownersByCode = new Map();

    const featureCode = (feature) => {
      const props = feature?.properties ?? {};
      const direct = str(props.GID_0 || props.gid_0 || props.GID0 || props.gid0).toUpperCase();
      if (direct && registry?.[direct]) return direct;

      // Custom region files always carry their stable region id even when the
      // country-level GID field was stripped. GADM ids begin with the GID_0 token
      // ("SRB.12_1" -> "SRB"), so this remains deterministic and cheap.
      const regionId = str(props.id || props.GID_1 || props.gid_1);
      const prefix = regionId.split('.')[0].toUpperCase();
      return prefix && registry?.[prefix] ? prefix : '';
    };

    for (const feature of features) {
      const code = featureCode(feature);
      if (!code) continue;
      const ownerToken = effectiveOwner(feature, ownershipOverrides);
      if (!ownerToken) continue;
      const owner = str(renames.get(ownerToken) ?? resolveOwnerName(ownerToken, ctx));
      if (!owner) continue;
      const owners = ownersByCode.get(code) || new Set();
      owners.add(owner);
      ownersByCode.set(code, owners);
    }

    for (const [code, owners] of ownersByCode.entries()) {
      if (owners.size !== 1) continue;
      add(code, [...owners][0]);
    }
  }

  return Object.fromEntries(
    [...byPolity.entries()].map(([polity, codes]) => [polity, { gadm0: [...codes].sort() }]),
  );
};

const mergeMapRefs = (existing, derived) => {
  const current = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  const next = derived && typeof derived === "object" && !Array.isArray(derived) ? derived : {};
  const gadm0 = [...new Set([
    ...(Array.isArray(current.gadm0) ? current.gadm0 : []),
    ...(Array.isArray(next.gadm0) ? next.gadm0 : []),
  ].map((entry) => str(entry).toUpperCase()).filter(Boolean))];
  return gadm0.length ? { ...current, ...next, gadm0 } : current;
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

const renameClaimants = (value, renames) => {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => renameValue(entry, renames)).filter(Boolean))];
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, enabled] of Object.entries(value)) {
      if (!enabled) continue;
      const name = renameValue(key, renames);
      if (name) out[name] = enabled;
    }
    return out;
  }
  return value;
};

// ---------------------------------------------------------------------------
// The record migration. Every structure listed here is owner-keyed; miss one and
// a save desyncs silently rather than failing.
// ---------------------------------------------------------------------------
export const migrateWorld = (world, renames, warn, derivedMapRefs = {}) => {
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

  // controller, legal sovereign and military/diplomatic claimants all live in owner-space.
  // miss one here and a migrated save can look fine until the first occupation. lovely.
  if (next.regionSovereigntyOverrides && typeof next.regionSovereigntyOverrides === "object") {
    next.regionSovereigntyOverrides = Object.fromEntries(
      Object.entries(next.regionSovereigntyOverrides).map(([regionId, owner]) => [
        regionId,
        renameValue(owner, renames),
      ]),
    );
  }

  if (next.regionClaimants && typeof next.regionClaimants === "object") {
    next.regionClaimants = Object.fromEntries(
      Object.entries(next.regionClaimants).map(([regionId, claimants]) => [
        regionId,
        renameClaimants(claimants, renames),
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
      const refs = mergeMapRefs(rest.mapRefs, derivedMapRefs[name]);
      kept[token] = {
        ...rest,
        ...(Object.keys(refs).length ? { mapRefs: refs } : {}),
        name,
      };
    }
    next.polityOverrides = rekeyOwnerMap(kept, renames, "polityOverrides", warn);

    for (const [polityName, refs] of Object.entries(derivedMapRefs ?? {})) {
      const current = next.polityOverrides?.[polityName];
      if (!current || typeof current !== "object") continue;
      next.polityOverrides[polityName] = {
        ...current,
        mapRefs: mergeMapRefs(current.mapRefs, refs),
      };
    }
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
    if (Array.isArray(next.regionControlOps)) {
      next.regionControlOps = next.regionControlOps.map((op) => ({
        ...op,
        ...(op?.fromCode ? { fromCode: renameValue(op.fromCode, renames) } : {}),
        ...(op?.toCode ? { toCode: renameValue(op.toCode, renames) } : {}),
        ...(op?.actorCode ? { actorCode: renameValue(op.actorCode, renames) } : {}),
        ...(op?.claimantCode ? { claimantCode: renameValue(op.claimantCode, renames) } : {}),
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
