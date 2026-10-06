/*! Open Historia — Listen in: what the model is told about the place © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The facts of the place a Listen in feed is written for (runtime/listenIn.js),
// as the lines of its prompt (gameplay.js generateListenInFeed). They are handed
// over rather than left for the model to look up: a lookup round is a second
// request, and a feed is only worth having at one.
//
// Only what the people living there could know. The country is described as
// its public knows it (runtime/politicalKnowledge.js buildPublicPoliticalView),
// a subordination only when it is an open one, and nothing from the
// intelligence ledgers at all: a post that mentioned a covert arrangement would
// tell the player something their own service has not found.
//
// Plain inputs in, text out, so node can test it.

import { listenInPlace } from "../../runtime/listenIn.js";
import { puppetKindLabel } from "../../runtime/puppets.js";

const clean = (value) => String(value ?? "").trim();
const array = (value) => (Array.isArray(value) ? value : []);
const listOf = (names, max) => (names.length > max ? `${names.slice(0, max).join(", ")} and ${names.length - max} more` : names.join(", "));
const sentence = (value) => {
  const text = clean(value).replace(/\s+/g, " ");
  return text && !/[.!?…]$/.test(text) ? `${text}.` : text;
};

// How the place is named in a sentence: "Bayern, in Germany", "Bayern" where
// nobody holds it, "Germany".
export const listenInPlaceLabel = (place) => {
  const target = listenInPlace(place);
  if (!target) return "";
  if (target.scope === "country") return target.polity;
  return target.polity ? `${target.regionName}, in ${target.polity}` : target.regionName;
};

// The instruction the request carries.
export const listenInRequest = (place) => {
  const target = listenInPlace(place);
  if (!target) return "";
  if (target.scope === "country") return `Show what people across ${target.polity} are posting today.`;
  return `Show what people in ${target.regionName}${target.polity ? ` (${target.polity})` : ""} are posting today.`;
};

const officeholder = (value) => {
  if (typeof value === "string") return clean(value);
  const name = clean(value?.name);
  return name ? `${name}${clean(value?.title) ? ` (${clean(value.title)})` : ""}` : "";
};

// The country's politics as a newspaper reader knows them.
const politicsLines = (view) => {
  if (!view || typeof view !== "object") return [];
  const lines = [];
  const government = view.government ?? {};
  const system = view.politicalSystem ?? {};
  const form = [clean(government.form) || clean(system.label) || clean(system.type), clean(government.ideology)].filter(Boolean).join(", ");
  if (form) lines.push(`Government: ${form}.`);
  const headOfState = officeholder(government.headOfState);
  const headOfGovernment = officeholder(government.headOfGovernment);
  const leader = officeholder(view.leader);
  const offices = [
    headOfState ? `head of state ${headOfState}` : "",
    headOfGovernment && headOfGovernment !== headOfState ? `head of government ${headOfGovernment}` : "",
  ].filter(Boolean);
  if (offices.length) lines.push(`In office: ${offices.join("; ")}.`);
  else if (leader) lines.push(`Leader: ${leader}.`);
  const parties = array(view.parties).slice(0, 8).map((party) => {
    const support = Number(party?.support?.percent);
    const facts = [
      clean(party?.ideology),
      party?.ruling ? "in government" : party?.coalition ? "in the governing coalition" : "",
      Number.isFinite(support) ? `${Math.round(support)}% support` : "",
    ].filter(Boolean);
    return `${clean(party?.name)}${facts.length ? ` (${facts.join(", ")})` : ""}`;
  }).filter(Boolean);
  if (parties.length) lines.push(`Parties: ${parties.join("; ")}.`);
  return lines;
};

// The region as region_info answers it (lookupTools.js): who holds it, whose
// it is by right, who claims it, the group that runs it, its cities and what
// lies next to it.
const regionLines = (target, region, { groupsOn }) => {
  const name = target.regionName;
  const owner = clean(region?.owner) && region.owner !== "unowned" ? clean(region.owner) : target.polity;
  const sovereign = clean(region?.sovereign) && region.sovereign !== "unowned" ? clean(region.sovereign) : "";
  const lines = [`Place: ${name}, a region ${owner ? `held by ${owner}` : "that no country holds"}.`];
  if (sovereign && owner && sovereign !== owner) lines.push(`By right it belongs to ${sovereign}; ${owner} holds it.`);
  const claimants = array(region?.claimants).map(clean).filter((claimant) => claimant && claimant !== owner && claimant !== sovereign);
  if (claimants.length) lines.push(`Also claimed by ${listOf(claimants, 6)}.`);
  const group = groupsOn ? region?.controlledByGroup : null;
  if (clean(group?.name)) {
    lines.push(`On the ground it is run by ${clean(group.name)}, which is not a country${clean(group.description) ? `: ${sentence(group.description)}` : "."}`);
  }
  const cities = array(region?.cities).map((city) => {
    const population = Number(city?.population);
    const facts = [population > 0 ? population.toLocaleString("en-US") : "", city?.capital ? "capital" : ""].filter(Boolean);
    return `${clean(city?.name)}${facts.length ? ` (${facts.join(", ")})` : ""}`;
  }).filter(Boolean);
  if (cities.length) lines.push(`Towns and cities here: ${listOf(cities, 12)}.`);
  const byOwner = new Map();
  for (const neighbour of array(region?.neighbours)) {
    const holder = clean(neighbour?.owner) && neighbour.owner !== "unowned" ? clean(neighbour.owner) : "held by no country";
    if (!byOwner.has(holder)) byOwner.set(holder, []);
    byOwner.get(holder).push(clean(neighbour?.name) || clean(neighbour?.id));
  }
  const neighbours = [...byOwner.entries()].map(([holder, names]) => `${listOf(names.filter(Boolean), 8)} (${holder})`);
  if (neighbours.length) lines.push(`Next to it: ${neighbours.join("; ")}.`);
  lines.push(`The posts come from people living in ${name}.${owner ? ` What happens in the rest of ${owner} reaches them as news.` : ""}`);
  return lines;
};

// The country, as far as its own people know it. `country`:
//   { name, aliases, note, politics, economy, isPlayer, relationWithPlayer:
//     { player, status }, overlords: [{ name, kind }], puppets: [{ name, kind }],
//     groups: [name] }
// with only OPEN arrangements in overlords and puppets.
const countryLines = (country, { groupsOn }) => {
  const name = clean(country?.name);
  if (!name) return [];
  const lines = [`About ${name}, as its own people know it:`];
  const aliases = array(country.aliases).map(clean).filter(Boolean);
  if (aliases.length) lines.push(`Also called ${listOf(aliases, 4)}.`);
  if (clean(country.note)) lines.push(sentence(country.note));
  lines.push(...politicsLines(country.politics));
  if (clean(country.economy)) lines.push(`Economy: ${sentence(country.economy)}`);
  for (const row of array(country.overlords)) {
    if (clean(row?.name)) lines.push(`${name} is a ${puppetKindLabel(row.kind).toLowerCase()} of ${clean(row.name)}, openly.`);
  }
  const puppets = array(country.puppets).filter((row) => clean(row?.name)).map((row) => `${clean(row.name)} (${puppetKindLabel(row.kind).toLowerCase()})`);
  if (puppets.length) lines.push(`It openly holds ${listOf(puppets, 6)}.`);
  const groups = groupsOn ? array(country.groups).map(clean).filter(Boolean) : [];
  if (groups.length) lines.push(`Part of its land is run by ${listOf(groups, 6)}, ${groups.length === 1 ? "which is not a country" : "none of them a country"}.`);
  if (country.isPlayer) {
    lines.push(`This is the country the player leads: what its government has done is what the player ordered.`);
  } else if (clean(country.relationWithPlayer?.player) && clean(country.relationWithPlayer?.status)) {
    lines.push(`Its relations with ${clean(country.relationWithPlayer.player)}, the country the player leads, are ${clean(country.relationWithPlayer.status)}.`);
  }
  return lines.length > 1 ? lines : [];
};

// The whole "[The Place]" block. `region` is null for a country's feed, and for
// a region the map could not describe.
export const describeListenInPlace = ({ place, region = null, country = null, groupsOn = true } = {}) => {
  const target = listenInPlace(place);
  if (!target) return "";
  const lines = target.scope === "region"
    ? regionLines(target, region, { groupsOn })
    : [`Place: the whole of ${target.polity}. The posts come from all over the country, town and countryside alike.`];
  const about = countryLines(country, { groupsOn });
  return [...lines, ...(about.length ? ["", ...about] : [])].join("\n");
};
