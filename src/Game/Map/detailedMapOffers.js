/*! Open Historia — what a scenario's detailed maps offer to download © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A scenario may name several detailed maps (docs/adr/0007). Installing it from
// the hub (communityHub.jsx) and a game's Settings → Map (settings.jsx) both
// look each one up on this device and on the official list, and offer the ones
// that can be downloaded (DetailedMapsInstallOffer.jsx).
import { tiledBasemapOffer } from "./scenarioTerrain.js";
import { fetchOfficialBasemaps, findOfficialBasemap, findOfficialEntry, findTiledBasemap } from "../../runtime/tiledBasemaps.js";

// `maps`: the scenario's maps (runtime/basemapPick.js scenarioMapsOfWorld).
// Answers [{ map, installed, official }] for each detailed one: this device's
// copy, or null, and the official list's entry, or null (a map named by
// checksum, or the list out of reach).
export const lookUpDetailedMaps = async (maps) => {
  const detailed = maps.filter((map) => map.kind === "detailed" && map.detailed);
  if (!detailed.length) return [];
  const list = await fetchOfficialBasemaps().catch(() => null);
  return Promise.all(detailed.map(async ({ detailed: named, ...rest }) => ({
    map: { ...rest, detailed: named },
    installed: await (named.id ? findOfficialBasemap(named.id) : findTiledBasemap(named.hash)).catch(() => null),
    official: named.id && list ? findOfficialEntry(list, named.id) : null,
  })));
};

// What can be downloaded: a map this device lacks, at the newest version, and
// a newer version of one it has (`optionalUpdates`: any; else only one the
// scenario needs). Each { id, version, name, bytes, have?, pick, starting }.
export const detailedMapOffers = (lookups, { optionalUpdates = false } = {}) => lookups.flatMap(({ map, installed, official }) => {
  if (!map.detailed?.id) return [];
  const { missing, update } = tiledBasemapOffer({ named: { ...map.detailed, name: map.name }, installed, official });
  const offer = missing && !missing.unavailable ? missing : update && (optionalUpdates || update.needed) ? update : null;
  return offer ? [{ ...offer, pick: map.pick, starting: map.starting }] : [];
});

// Settings → Map's line about them, "" when there is nothing to download.
// `format(text, params)` fills the slots: the game's translator
// (runtime/translator.js uiString), or English as it is.
const DOWNLOAD_LINE_LABELS = {
  missingOne: "1 of this scenario's detailed maps isn't on this device.",
  missingMany: "{{missing}} of this scenario's detailed maps aren't on this device.",
  updateOne: "1 of this scenario's detailed maps has a newer version.",
  updateMany: "{{updates}} of this scenario's detailed maps have a newer version.",
  missingOneUpdateOne: "1 of this scenario's detailed maps isn't on this device, and 1 has a newer version.",
  missingOneUpdateMany: "1 of this scenario's detailed maps isn't on this device, and {{updates}} have a newer version.",
  missingManyUpdateOne: "{{missing}} of this scenario's detailed maps aren't on this device, and 1 has a newer version.",
  missingManyUpdateMany: "{{missing}} of this scenario's detailed maps aren't on this device, and {{updates}} have a newer version.",
};
const fillSlots = (text, params) => text.replace(/\{\{(\w+)\}\}/g, (slot, name) => String(params[name] ?? slot));
export const detailedMapsDownloadLine = (offers, format = fillSlots) => {
  const missing = offers.filter((offer) => !offer.have).length;
  const updates = offers.length - missing;
  const count = (n, word) => (n === 1 ? `${word}One` : `${word}Many`);
  const key = missing && updates ? `${count(missing, "missing")}${count(updates, "Update")}`
    : missing ? count(missing, "missing")
      : updates ? count(updates, "update") : "";
  return key ? format(DOWNLOAD_LINE_LABELS[key], { missing, updates }) : "";
};
