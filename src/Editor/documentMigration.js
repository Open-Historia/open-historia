/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Brings a saved map document forward when the owner scheme changes.
//
// A document written before the rename owns its regions by GADM code ("MNG"), and
// keys colorOverrides / flags / tags the same way. Opened as-is in an editor that
// speaks names, every one of those lookups misses: the map renders in procedural
// hash colours instead of its palette, and the first edit to a country forks it in
// two — the region says "MNG" while the field you just typed says "Mongolia".
//
// Worse, it does not stay in the editor. Applying such a document to a scenario
// writes `world: { ...currentWorld, ... }`, so the code-keyed payload INHERITS the
// target's ownerSchema marker and the store's migration — the one thing that could
// have repaired it — never runs. A document is the one place legacy owners can
// enter the system already wearing a "migrated" badge, which is why this exists
// here rather than in the store.

import COUNTRY_NAMES from "../runtime/generated/countryNames.js";
import { OWNER_SCHEMA, rekeyOwnerMap } from "../../server/ownerMigration.js";

export { OWNER_SCHEMA };

// A document is legacy until it says otherwise, exactly like a world.
export const docNeedsOwnerMigration = (doc) => Number(doc?.ownerSchema ?? 1) < OWNER_SCHEMA;

// The registry alone is enough here, and rules 2-4 of the store's resolver are not
// available anyway: a document has no scenario meta and no polityOverrides. Every
// one of the 239 modern GADM codes resolves; anything else (an FMG world's
// "Yardibyurt", a country someone invented) is already its own name and passes
// through untouched — which is exactly what rule 5 would have done.
const ownerName = (owner) => {
  const raw = String(owner ?? "").trim();
  if (!raw) return raw;
  return COUNTRY_NAMES[raw] || raw;
};

// Migrate a loaded document in place-safe copies. Returns the doc unchanged when it
// is already name-keyed, so this is safe to call on every open.
export const migrateDocumentOwners = (doc) => {
  if (!doc || typeof doc !== "object") return doc;
  if (!docNeedsOwnerMigration(doc)) return doc;

  const renames = new Map();
  const remember = (owner) => {
    const raw = String(owner ?? "").trim();
    if (raw && !renames.has(raw)) renames.set(raw, ownerName(raw));
  };

  const regions = doc.regions;
  for (const f of regions?.features ?? []) remember(f?.properties?.owner);
  for (const key of Object.keys(doc.colorOverrides ?? {})) remember(key);
  for (const key of Object.keys(doc.flags ?? {})) remember(key);
  for (const key of Object.keys(doc.tags ?? {})) remember(key);

  const warn = (message) => console.warn(`[owner-migration] document ${doc.id ?? "(unsaved)"}: ${message}`);

  const next = {
    ...doc,
    colorOverrides: rekeyOwnerMap(doc.colorOverrides, renames, "colorOverrides", warn) ?? doc.colorOverrides,
    flags: rekeyOwnerMap(doc.flags, renames, "flags", warn) ?? doc.flags,
    tags: rekeyOwnerMap(doc.tags, renames, "tags", warn) ?? doc.tags,
    ownerSchema: OWNER_SCHEMA,
  };

  if (regions?.features) {
    next.regions = {
      ...regions,
      features: regions.features.map((f) => {
        const props = f?.properties;
        if (!props) return f;
        // `country` goes the same way it does everywhere else: once owner IS the
        // name, a second copy beside it can only drift. `id` and `gid0` stay.
        const { country, ...rest } = props;
        const owner = String(rest.owner ?? "").trim();
        return { ...f, properties: owner ? { ...rest, owner: renames.get(owner) ?? owner } : rest };
      }),
    };
  }

  const moved = [...renames.entries()].filter(([from, to]) => from !== to).length;
  if (moved) console.log(`[owner-migration] document ${doc.id ?? "(unsaved)"}: ${moved} owner(s) renamed`);
  return next;
};
