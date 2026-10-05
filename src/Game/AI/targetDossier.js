/*! Open Historia — a target's standing in the ledgers © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The target dossier (gameplay.js buildTargetDossier) is the only evidence about
// ONE polity that the intelligence briefing, the intelligence assessment, the
// spy reports, the motion repair and the stat sheets are given. It used to say
// a name, the regions from regionOwnershipOverrides and a unit count — so the
// player paid a request for a briefing whose army, economy and stance toward
// them could contradict the Stats tab and the ledgers the rest of the game runs
// on. These are those ledgers' lines for the target, compact: its wars, its
// standing with the player, who directs it or whom it directs, the groups in
// its land, its reputation and service, and its stat sheet.
//
// What the PLAYER may know, never more: the briefing and the spy reports are
// shown to them. A covert subordination appears only once the player's own
// intelligence has found it (runtime/puppets.js visiblePuppetsFor).

import { diplomaticDisplayName, relationStatusForScore } from "./nativeDiplomaticDirector.js";
import { buildPolityIdentityIndex, resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import { visiblePuppetsFor } from "../../runtime/puppets.js";
import { groupRegions } from "../../runtime/groups.js";
import { buildCompactEconomicContext } from "../../runtime/countryStats.js";
import { intelligenceOf, isIntelligenceRated } from "../../runtime/spycraft.js";

const text = (value) => String(value ?? "").trim();
const array = (value) => (Array.isArray(value) ? value : []);
const listOf = (names, max = 6) => (names.length > max ? `${names.slice(0, max).join(", ")} and ${names.length - max} more` : names.join(", "));

// `world` is normalized (normalizeWorldState). `target` and `playerPolity` are
// polity names. `ownerOf(regionId)` says who holds a region (the overrides, then
// the map); without it only the overrides count. `statSheet: false` for the
// tasks that write the sheet themselves: quoting the old one back at them would
// only hold a reassessment where it was.
export const buildTargetLedgerLines = (world, target, {
    playerPolity = "",
    ownerOf = null,
    puppetStates = true,
    espionage = true,
    groups = true,
    statSheet = true,
} = {}) => {
    const name = text(target);
    if (!world || !name) return [];
    // Each name resolved once, through one identity index, the way the
    // diplomatic ledger resolves it (nativeDiplomaticDirector.js
    // canonicalDiplomaticPolity). Resolving without an index rebuilds the
    // world's polity tables on every call — several ms each — and this runs on
    // the main thread for every briefing, stat sheet and agent report, against
    // every war side, agreement party and group region.
    const identityIndex = buildPolityIdentityIndex(world);
    const resolved = new Map();
    const canonical = (value) => {
        const raw = text(value);
        if (!raw) return "";
        if (!resolved.has(raw)) {
            const identity = resolvePolityIdentity(raw, world, {
                allowUnknown: false,
                requireActive: false,
                allowCoreMatch: true,
                allowStockBase: true,
                identityIndex,
            });
            resolved.set(raw, text(identity?.resolved) || raw);
        }
        return resolved.get(raw);
    };
    const key = canonical(name);
    const same = (value) => {
        const other = canonical(value);
        return Boolean(other) && other === key;
    };
    const shown = (value) => diplomaticDisplayName(world, canonical(value)) || text(value);
    const player = text(playerPolity);
    const playerKey = canonical(player);
    const isPlayer = Boolean(player) && same(player);
    const withPlayer = (value) => Boolean(playerKey) && canonical(value) === playerKey;
    const lines = [];

    // Wars — world.wars is the only authority on who is fighting.
    const wars = array(world.wars)
        .filter((war) => war?.status === "active" || war?.status === "ceasefire")
        .map((war) => {
            const onA = array(war.sideA).some(same);
            const onB = array(war.sideB).some(same);
            if (!onA && !onB) return null;
            const enemies = (onA ? array(war.sideB) : array(war.sideA)).map(shown);
            return `${text(war.title) || "a war"} against ${listOf(enemies)}${war.status === "ceasefire" ? " (ceasefire)" : ""}`;
        })
        .filter(Boolean);
    lines.push(wars.length ? `Wars: ${wars.join("; ")}.` : "Wars: none recorded.");

    // Its standing with the player: the bilateral relation and their agreements,
    // read from the normalized ledgers (the status is the band of the score, as
    // the diplomatic ledger reads it).
    if (player && !isPlayer) {
        const relation = array(world.relations).find((entry) => (same(entry?.a) && withPlayer(entry?.b)) || (same(entry?.b) && withPlayer(entry?.a)));
        if (relation) {
            const score = Number(relation.score) || 0;
            const summary = text(relation.summary).slice(0, 200).replace(/[.\s]+$/, "");
            lines.push(`Standing with ${player}: ${relationStatusForScore(score)} (${score >= 0 ? "+" : ""}${score})${summary ? ` — ${summary}` : ""}.`);
        } else {
            lines.push(`Standing with ${player}: no bilateral relation recorded.`);
        }
        const agreements = array(world.agreements)
            .filter((agreement) => agreement?.status === "active" || agreement?.status === "suspended")
            .filter((agreement) => array(agreement.parties).some(same) && array(agreement.parties).some(withPlayer))
            .map((agreement) => {
                const type = text(agreement.type).replace(/_/g, " ");
                return `${text(agreement.title) || type} (${type}${agreement.status === "suspended" ? ", suspended" : ""})`;
            });
        if (agreements.length) lines.push(`Agreements with ${player}: ${agreements.join("; ")}.`);
    }

    // Who directs it, and whom it directs — as far as the player can see.
    if (puppetStates) {
        const rows = visiblePuppetsFor(world, player || name).filter((row) => row.status === "active");
        const overlords = rows.filter((row) => same(row.puppet)).map((row) => `${shown(row.overlord)} (${row.kind}, ${row.secrecy})`);
        const puppets = rows.filter((row) => same(row.overlord)).map((row) => `${shown(row.puppet)} (${row.kind}, ${row.secrecy})`);
        if (overlords.length) lines.push(`Directed by: ${overlords.join("; ")}.`);
        if (puppets.length) lines.push(`Directs: ${puppets.join("; ")}.`);
    }

    // The groups holding ground inside its borders, while the game has groups
    // (server/gameFeatures.js).
    const holder = typeof ownerOf === "function"
        ? ownerOf
        : (regionId) => world.regionOwnershipOverrides?.[regionId] ?? "";
    const groupsHolding = !groups ? [] : Object.entries(groupRegions(world.groupAreas))
        .map(([group, regionIds]) => [group, regionIds.filter((regionId) => same(holder(regionId)))])
        .filter(([, regionIds]) => regionIds.length > 0)
        .map(([group, regionIds]) => `${text(world.groups?.[group]?.name) || group} (${regionIds.length} region${regionIds.length === 1 ? "" : "s"})`);
    if (groupsHolding.length) lines.push(`Groups controlling part of its land: ${groupsHolding.join("; ")}.`);

    const reputation = Number(world.internationalReputation?.[name]);
    if (Number.isFinite(reputation)) lines.push(`International reputation: ${Math.round(reputation)}/100.`);
    if (espionage && isIntelligenceRated(world, name)) lines.push(`Intelligence service: ${intelligenceOf(world, name)}/100.`);

    if (statSheet) {
        const sheet = text(buildCompactEconomicContext(world.countryStats?.[name], { name }));
        if (sheet) lines.push(`STAT SHEET (the figures the Stats tab shows; quote these rather than estimating): ${sheet}`);
    }
    return lines;
};
