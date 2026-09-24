// What the advisor reads of the world's ledgers (main.jsx buildAdvisorSystemPrompt).
import { buildCompactEconomicContext, normalizeCountryStatsTracking } from "../../runtime/countryStats.js";
import { buildCanonicalWarContext } from "./nativeWarLedger.js";
import { buildBoundedDiplomaticContext } from "./nativeDiplomaticDirector.js";

// A polity's entry in one of the per-country ledgers (countryStats,
// countryStatsHistory): the exact key, or the same name in another case.
export const polityEntry = (ledger, name) => {
  const wanted = String(name || "").trim();
  if (!wanted || !ledger || typeof ledger !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(ledger, wanted)) return ledger[wanted];
  const key = Object.keys(ledger).find((candidate) => candidate.trim().toLowerCase() === wanted.toLowerCase());
  return key === undefined ? undefined : ledger[key];
};

const MAX_ADVISOR_FOREIGN_SHEETS = 8;

// What the player's own Stats panel shows about the rest of the world, which the
// advisor otherwise had to reconstruct from the event prose: the war ledger, the
// Diplomacy tab's relations and agreements for the player and the powers they
// deal with, and those powers' recorded figures. All of it is public on the
// panel; subordinations are left out here because the canonical ledger holds
// covert ones too, and the advisor already gets them as the player knows them
// (buildAdvisorPuppetsDirective).
export function describeWorldLedgersForAdvisor(worldData, chatData, country) {
  const player = String(country || "").trim();
  if (!player || !worldData || typeof worldData !== "object") return "";
  // Newest first: a new chat is put at the front (chat.jsx, gameplay.js).
  const partners = (Array.isArray(chatData) ? chatData : [])
    .slice(0, 6)
    .flatMap((chat) => (Array.isArray(chat?.countries) ? chat.countries : []).map((entry) => entry?.name || entry?.code))
    .filter(Boolean);
  const diplomacy = buildBoundedDiplomaticContext(worldData, {
    playerPolity: player,
    focusActors: partners,
    maxActors: 8,
    puppetStates: false,
  });
  const wars = buildCanonicalWarContext(worldData);

  const tracked = normalizeCountryStatsTracking(worldData.countryStatsTracking, { playerCountry: player }).trackedPolities || [];
  const seen = new Set([player.toLowerCase()]);
  const figures = [];
  for (const name of [...diplomacy.actors, ...tracked]) {
    const key = String(name || "").trim().toLowerCase();
    if (!key || seen.has(key) || figures.length >= MAX_ADVISOR_FOREIGN_SHEETS) continue;
    seen.add(key);
    const line = buildCompactEconomicContext(polityEntry(worldData.countryStats, name), { name, conditions: false });
    if (line) figures.push(`- ${line}`);
  }

  return [
    "[Wars, Relations and Other Powers]",
    "The government's own records, as the leader can read them on the statistics sheets. Treat them as authoritative: never contradict them, and quote them when asked.",
    "",
    "WARS",
    wars.startsWith("No active") ? "No war or ceasefire is recorded." : wars,
    "",
    diplomacy.text,
    ...(figures.length ? ["", "OTHER POWERS' RECORDED FIGURES", ...figures] : []),
  ].join("\n");
}
