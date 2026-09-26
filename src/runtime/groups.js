/*! Open Historia — groups and the areas they control © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A group is an actor that is not a country: a terrorist organisation, a
// cartel, a militia, a zombie outbreak, a cult — whatever a scenario or the AI
// says it is. A group owns no land: every region stays its country's. It
// CONTROLS an area — the regions the map outlines in the group's colour with a
// light tint over the countries' own colours — and it carries a description,
// which is what the AI is told the group is.
//
//   world.groups     { [name]: { name, description, color, formerNames? } }
//   world.groupAreas { [regionId]: groupName }   one group per region, sparse
//
// Groups are keyed by their exact name, like countries, so the name the model
// reads is the name it writes back. Pure: no IO, shared by the game, the
// Workshop export and the tests.

export const GROUP_NAME_MAX = 80;
export const GROUP_DESCRIPTION_MAX = 1200;
export const MAX_GROUPS = 64;
export const MAX_GROUP_OP_REGIONS = 200;

// Distinct, readable over any country colour. No purple: the interface keeps
// its greys and one accent, and the map's own colours are the countries'.
export const GROUP_PALETTE = ["#e11d48", "#f97316", "#eab308", "#65a30d", "#10b981", "#06b6d4", "#3b82f6", "#ec4899", "#dc2626", "#0ea5e9"];

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const fold = (value) => clean(value).toLocaleLowerCase();

// "#abc" / "#aabbcc" (any case) → "#aabbcc"; anything else → "".
export const normalizeGroupColor = (value) => {
  const text = clean(value).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${[...text.slice(1)].map((digit) => digit + digit).join("")}`;
  return "";
};

// The palette colour a name hashes to, so a group without a chosen colour looks
// the same every time it is drawn.
export const defaultGroupColor = (name) => {
  let hash = 0;
  for (const char of fold(name)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return GROUP_PALETTE[hash % GROUP_PALETTE.length];
};

export const normalizeGroupName = (value) => clean(value).slice(0, GROUP_NAME_MAX).trim();
export const normalizeGroupDescription = (value) =>
  String(value ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, GROUP_DESCRIPTION_MAX).trim();

// The key a name resolves to: exact, then any case, then a former name.
export const findGroupKey = (groups, name) => {
  const registry = isRecord(groups) ? groups : {};
  const wanted = fold(name);
  if (!wanted) return "";
  if (isRecord(registry[clean(name)])) return clean(name);
  const keys = Object.keys(registry);
  return keys.find((key) => fold(key) === wanted)
    ?? keys.find((key) => (registry[key]?.formerNames ?? []).some((former) => fold(former) === wanted))
    ?? "";
};

const normalizeGroup = (key, value) => {
  const name = normalizeGroupName(key || value?.name);
  if (!name) return null;
  const record = isRecord(value) ? value : {};
  const formerNames = [...new Set((Array.isArray(record.formerNames) ? record.formerNames : []).map(normalizeGroupName).filter((former) => former && fold(former) !== fold(name)))].slice(0, 12);
  return {
    name,
    description: normalizeGroupDescription(record.description ?? record.note),
    color: normalizeGroupColor(record.color) || defaultGroupColor(name),
    ...(formerNames.length ? { formerNames } : {}),
  };
};

export const normalizeGroups = (raw) => {
  const out = {};
  for (const [key, value] of Object.entries(isRecord(raw) ? raw : {})) {
    const group = normalizeGroup(key, value);
    if (!group || Object.keys(out).some((existing) => fold(existing) === fold(group.name))) continue;
    out[group.name] = group;
    if (Object.keys(out).length >= MAX_GROUPS) break;
  }
  return out;
};

// Rows naming a group the registry does not have are dropped: an area with no
// group has no colour, no description, nothing to draw or tell.
export const normalizeGroupAreas = (raw, groups) => {
  const out = {};
  for (const [regionId, name] of Object.entries(isRecord(raw) ? raw : {})) {
    const id = clean(regionId);
    const key = findGroupKey(groups, name);
    if (id && key) out[id] = key;
  }
  return out;
};

// The regions each group controls, in the order they were written.
export const groupRegions = (groupAreas) => {
  const byGroup = {};
  for (const [regionId, name] of Object.entries(isRecord(groupAreas) ? groupAreas : {})) (byGroup[name] ??= []).push(regionId);
  return byGroup;
};

// ---- the AI's operations ------------------------------------------------------

const OP_ALIASES = {
  create: "create", add: "create", new: "create", found: "create", form: "create",
  update: "update", modify: "update", edit: "update", rename: "update", describe: "update", recolor: "update", recolour: "update",
  dissolve: "dissolve", erase: "dissolve", delete: "dissolve", remove: "dissolve", disband: "dissolve", destroy: "dissolve",
  take: "take", control: "take", seize: "take", expand: "take", spread: "take", occupy: "take", claim: "take",
  release: "release", lose: "release", withdraw: "release", retreat: "release", abandon: "release", shrink: "release",
};
export const GROUP_OP_KINDS = ["create", "update", "dissolve", "take", "release"];

export const normalizeGroupOp = (entry) => {
  if (!isRecord(entry)) return null;
  const op = OP_ALIASES[fold(entry.op ?? entry.operation)] ?? "";
  const name = normalizeGroupName(entry.name ?? entry.group ?? entry.groupName);
  if (!op || !name) return null;
  const list = Array.isArray(entry.regionIds) ? entry.regionIds
    : Array.isArray(entry.regions) ? entry.regions
      : entry.regionId ? [entry.regionId] : [];
  const regionIds = [...new Set(list.map(clean).filter(Boolean))].slice(0, MAX_GROUP_OP_REGIONS);
  const newName = normalizeGroupName(entry.newName);
  const description = normalizeGroupDescription(entry.description);
  const color = normalizeGroupColor(entry.color);
  return {
    op,
    name,
    ...(newName && fold(newName) !== fold(name) ? { newName } : {}),
    ...(description ? { description } : {}),
    ...(color ? { color } : {}),
    regionIds,
    note: clean(entry.note).slice(0, 300),
  };
};

// Applies operations to { groups, groupAreas }; pure, returns the new pair and
// a line per change for the turn's record. Lenient where the model is likely to
// be loose and the intent is plain: an update or a take naming a group nobody
// has creates it; a create naming one that exists updates it.
export const applyGroupOps = ({ groups = {}, groupAreas = {} } = {}, ops = []) => {
  const nextGroups = normalizeGroups(groups);
  const nextAreas = normalizeGroupAreas(groupAreas, nextGroups);
  const changes = [];
  for (const raw of Array.isArray(ops) ? ops : []) {
    const op = normalizeGroupOp(raw);
    if (!op) continue;
    let key = findGroupKey(nextGroups, op.name);

    if (op.op === "dissolve") {
      if (!key) continue;
      delete nextGroups[key];
      for (const [regionId, name] of Object.entries(nextAreas)) if (name === key) delete nextAreas[regionId];
      changes.push({ op: "dissolve", name: key });
      continue;
    }

    if (!key) {
      if (op.op === "release") continue;
      if (Object.keys(nextGroups).length >= MAX_GROUPS) continue;
      key = op.name;
      nextGroups[key] = {
        name: key,
        description: op.description ?? "",
        color: op.color || defaultGroupColor(key),
      };
      changes.push({ op: "create", name: key });
    } else if (op.description || op.color) {
      nextGroups[key] = {
        ...nextGroups[key],
        ...(op.description ? { description: op.description } : {}),
        ...(op.color ? { color: op.color } : {}),
      };
      changes.push({ op: "update", name: key });
    }

    if (op.newName && !findGroupKey(nextGroups, op.newName)) {
      const record = nextGroups[key];
      delete nextGroups[key];
      const formerNames = [...new Set([...(record.formerNames ?? []), key])].filter((former) => fold(former) !== fold(op.newName)).slice(-12);
      nextGroups[op.newName] = { ...record, name: op.newName, ...(formerNames.length ? { formerNames } : {}) };
      for (const [regionId, name] of Object.entries(nextAreas)) if (name === key) nextAreas[regionId] = op.newName;
      changes.push({ op: "rename", name: op.newName, from: key });
      key = op.newName;
    }

    if (op.op === "release") {
      const released = [];
      for (const [regionId, name] of Object.entries(nextAreas)) {
        if (name !== key || (op.regionIds.length && !op.regionIds.includes(regionId))) continue;
        delete nextAreas[regionId];
        released.push(regionId);
      }
      if (released.length) changes.push({ op: "release", name: key, regionIds: released });
      continue;
    }

    const taken = op.regionIds.filter((regionId) => nextAreas[regionId] !== key);
    for (const regionId of taken) nextAreas[regionId] = key;
    if (taken.length) changes.push({ op: "take", name: key, regionIds: taken });
  }
  return { groups: nextGroups, groupAreas: nextAreas, changes };
};

// ---- what the AI and the player are shown -----------------------------------

// One line per group for a prompt: exact name, what it is, where it holds.
// `regionName(id)` turns an id into the name the model should read.
export const describeGroupsForPrompt = (world, { regionName = (id) => id, maxRegions = 12 } = {}) => {
  const groups = normalizeGroups(world?.groups);
  const names = Object.keys(groups);
  if (!names.length) return "";
  const areas = groupRegions(normalizeGroupAreas(world?.groupAreas, groups));
  return names.map((name) => {
    const group = groups[name];
    const regions = areas[name] ?? [];
    const shown = regions.slice(0, maxRegions).map((id) => `${regionName(id)} (${id})`);
    const where = regions.length
      ? `controls ${regions.length} region${regions.length === 1 ? "" : "s"}: ${shown.join(", ")}${regions.length > shown.length ? `, +${regions.length - shown.length} more` : ""}`
      : "controls no area on the map";
    return `- ${name}${group.description ? ` — ${group.description.replace(/\n+/g, " ")}` : ""} [${where}]`;
  }).join("\n");
};
