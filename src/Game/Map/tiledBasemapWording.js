/*! Open Historia — what the detailed-map offer says © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The words of TiledBasemapOffer.jsx, kept apart so they can be tested. Every
// offer says how big the download is and that without it the player sees the
// basic map the scenario carries (every scenario on a detailed map has one).
// `offer` is a `missing` or `update` from tiledBasemapOffer
// (Map/scenarioTerrain.js); `atInstall` is the hub's last install step.
import { formatBytes } from "../../runtime/tiledBasemaps.js";

const SHARED = "It downloads once, and every scenario on this map shares it.";

export const tiledBasemapWording = (offer, { atInstall = false } = {}) => {
  const name = offer?.name ? `"${offer.name}"` : "its detailed map";
  const size = formatBytes(offer?.bytes);
  const sized = size ? ` (${size})` : "";
  const download = `Download${size ? ` ${size}` : ""}`;

  if (offer?.have) {
    return {
      title: `A newer version of ${name} is available`,
      body: offer.needed
        ? `This scenario was made with version ${offer.version}. You have version ${offer.have}, which it still works with. Updating${sized} replaces your copy, so the map is never kept twice.`
        : `Version ${offer.version}${sized} replaces your version ${offer.have}, so the map is never kept twice. Every scenario on this map uses whichever version you have.`,
      accept: `Update${size ? ` ${size}` : ""}`,
      decline: "Not now",
    };
  }
  if (offer?.unofficial) {
    return {
      title: "This scenario's detailed map can't be downloaded",
      body: `${name} isn't on the official Open Historia list, so you're seeing the basic map.`,
      accept: null,
      decline: "OK",
    };
  }
  if (offer?.withdrawn) {
    return {
      title: "This scenario's detailed map is no longer available",
      body: `${name} was withdrawn from the official Open Historia list, so you're seeing the basic map.`,
      accept: null,
      decline: "OK",
    };
  }
  if (offer?.unavailable) {
    return {
      title: "This scenario's detailed map isn't available right now",
      body: `${name} isn't on the official list, or the list couldn't be reached. You're seeing the basic map. Try again later.`,
      accept: null,
      decline: "OK",
    };
  }
  if (atInstall) {
    return {
      title: "This scenario has a detailed map",
      body: `${name} is a${size ? ` ${size}` : ""} download. Download it now, or play on the basic map that comes with the scenario and download it later from the map. ${SHARED}`,
      accept: download,
      decline: "Use basic map",
    };
  }
  return {
    title: "You're seeing the basic map",
    body: `Download ${name}${sized} to see the terrain up close. ${SHARED}`,
    accept: download,
    decline: "Not now",
  };
};
