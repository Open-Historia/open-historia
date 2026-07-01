/*! Pax Historia — 1650 AD preset spec © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Colonial preset — 1650 AD (the colonization of the New World).
//
// The Age of Sail in full stride: Spain's viceroyalties span two continents,
// Portugal is retaking Dutch Brazil, England (a republic since the king lost
// his head in 1649) seeds the Atlantic coast, New France holds the St Lawrence,
// New Netherland the Hudson, New Sweden the Delaware — and inland, native
// nations remain the true powers of the continent: the Haudenosaunee are
// mid-Beaver-Wars, the Mapuche have stopped Spain cold at the Biobío, and the
// Itza still rule from Lake Petén. Unclaimed land is native or unexplored, not
// empty; colonization there is contact, trade and war, not free settlement.

export default {
  id: "colonial-1650",

  meta: {
    name: "New World — 1650",
    heroTitle: "The Colonization of the New World",
    heroSubtitle: "Empires of sail and the nations that met them, 1650 AD",
    eyebrow: "Historical Preset",
    subtitle: "1650 AD",
    accentColor: "#2e6b8a",
    coverImage: "public/loading_screen_4.jpg",
    description:
      "The year 1650. Spanish silver fleets sail from two viceroyalties, Portugal fights " +
      "the Dutch for Brazil, republican England plants colonies from Massachusetts to " +
      "Barbados, and France trades furs up the St Lawrence. But most of the Americas " +
      "still belong to the nations that were always there — Haudenosaunee, Cherokee, " +
      "Sioux, Apache, Maya, Mapuche. Build an empire across the ocean, or drive one " +
      "back into it.",
  },

  // Player starts as the Commonwealth of England. game.country MUST equal the owner code.
  game: { country: "GBR", startDate: "1650-01-01", gameDate: "1650-01-01" },

  // Pike-and-shot warfare: muskets, cannon, cavalry, ships of the line — no air.
  allowedUnitTypes: ["infantry", "armor", "artillery", "naval", "garrison"],

  relabelOwnedCountries: true,

  polities: {
    // — Colonial empires (real ISO codes where the polity IS that country, so
    //   their real flags resolve in the popup) —
    ESP:   { name: "Spanish Empire", color: "#d2a02e", aliases: ["Spain", "the Indies", "New Spain", "Peru"] },
    POR:   { name: "Portuguese Empire", color: "#2e7d6b", aliases: ["Portugal", "Brazil", "Braganza Portugal"] },
    GBR:   { name: "Commonwealth of England", color: "#b23b3b", aliases: ["England", "the Commonwealth", "Cromwell's England"] },
    FRA:   { name: "Kingdom of France", color: "#2f5fd0", aliases: ["France", "New France"] },
    NLD:   { name: "Dutch Republic", color: "#e08a2e", aliases: ["the Netherlands", "United Provinces", "VOC", "WIC"] },
    SWE:   { name: "Swedish Empire", color: "#4a78c0", aliases: ["Sweden", "New Sweden"] },
    // — Native nations of North America —
    IROQ:  { name: "Haudenosaunee", color: "#8a5a8a", aliases: ["Iroquois", "Five Nations", "the Confederacy"] },
    CHER:  { name: "Cherokee", color: "#6f8f3f", aliases: ["Aniyunwiya", "Tsalagi"] },
    CREE_M:{ name: "Muscogee", color: "#c07a4a", aliases: ["Creek", "Creek Confederacy"] },
    CHOC:  { name: "Choctaw and Chickasaw", color: "#b8604a", aliases: ["Choctaw", "Chickasaw"] },
    SIOU:  { name: "Oceti Sakowin", color: "#7a94b8", aliases: ["Sioux", "Lakota", "Dakota"] },
    APAC:  { name: "Apacheria", color: "#9a6a3a", aliases: ["Apache", "Ndee"] },
    NAVA:  { name: "Dine (Navajo)", color: "#8f5f8f", aliases: ["Navajo", "Diné"] },
    MAYA:  { name: "Itza Maya", color: "#5a9a8a", aliases: ["Itza", "Peten Itza", "Maya"] },
    // — Native nations of South America —
    MAPU:  { name: "Mapuche", color: "#3f7a4f", aliases: ["Wallmapu", "Araucania"] },
    // — The Old World, coarsely —
    HRE:   { name: "Holy Roman Empire", color: "#b0a878", aliases: ["the Empire", "German princes"] },
    HABS:  { name: "Habsburg Monarchy", color: "#caa64a", aliases: ["Austria", "the Habsburgs"] },
    POL_L: { name: "Polish-Lithuanian Commonwealth", color: "#d23ca0", aliases: ["Poland-Lithuania", "the Commonwealth"] },
    RUS:   { name: "Tsardom of Russia", color: "#7a6b9a", aliases: ["Russia", "Muscovy"] },
    DEN_N: { name: "Denmark-Norway", color: "#b0486a", aliases: ["Denmark", "the Oldenburg realm"] },
    OTTO:  { name: "Ottoman Empire", color: "#6b4f2e", aliases: ["the Porte", "the Turks"] },
    SAFA:  { name: "Safavid Persia", color: "#34869a", aliases: ["Persia", "Iran", "the Safavids"] },
    MUGH:  { name: "Mughal Empire", color: "#3a7d4f", aliases: ["Hindustan", "the Mughals"] },
    QING:  { name: "Qing Dynasty", color: "#c9a227", aliases: ["China", "the Manchus"] },
    JOSE:  { name: "Joseon", color: "#5a9a7a", aliases: ["Korea"] },
    TOKU:  { name: "Tokugawa Japan", color: "#c0507a", aliases: ["Japan", "the Shogunate"] },
    SIAM:  { name: "Ayutthaya", color: "#d0b060", aliases: ["Siam"] },
    MOR:   { name: "Sultanate of Morocco", color: "#2e5d8f", aliases: ["Morocco"] },
    ETHIO: { name: "Ethiopian Empire", color: "#4a8f6a", aliases: ["Abyssinia"] },
  },

  countryAssignments: {
    // — Spanish Empire: both viceroyalties, the Caribbean core, the Philippines.
    ESP: [
      "ESP", "MEX", "GTM", "HND", "SLV", "NIC", "CRI", "PAN", "BLZ",
      "CUB", "DOM", "HTI", "PRI", "TTO",
      "COL", "VEN", "ECU", "PER", "BOL", "PRY",
      "PHL",
    ],
    // — Portuguese Empire: the restored crown, African posts, coastal Brazil below.
    POR: ["PRT", "AGO", "MOZ", "GNB", "CPV", "STP"],
    // — Commonwealth of England: the home isles, the young Atlantic colonies below,
    //   the sugar Caribbean, and brand-new Suriname (Willoughby's colony, 1650).
    GBR: ["GBR", "IRL", "BRB", "ATG", "KNA", "BHS", "SUR"],
    // — Kingdom of France (New France & Acadia below).
    FRA: ["FRA", "GUF", "MTQ", "GLP"],
    // — Dutch Republic: the Hudson & Delaware trade, Guiana forts, the East Indies,
    //   Dutch Formosa.
    NLD: ["NLD", "GUY", "IDN", "TWN"],
    // — Swedish Empire (incl. Baltic dominions; New Sweden on the Delaware below).
    SWE: ["SWE", "FIN", "EST", "LVA"],
    // — The Old World —
    HRE:   ["DEU", "CHE", "LUX", "LIE"],
    HABS:  ["AUT", "CZE", "SVK", "SVN", "HRV"],
    POL_L: ["POL", "LTU", "BLR", "UKR"],
    RUS:   ["RUS"],
    DEN_N: ["DNK", "NOR", "ISL", "GRL", "FRO"],
    OTTO: [
      "TUR", "GRC", "BGR", "SRB", "MKD", "ALB", "BIH", "XKO", "MNE", "HUN",
      "ROU", "MDA", "EGY", "SYR", "LBN", "ISR", "PSE", "JOR", "IRQ",
      "LBY", "TUN", "DZA",
    ],
    SAFA:  ["IRN", "AZE", "ARM", "GEO", "AFG"],
    MUGH:  ["IND", "PAK", "BGD"],
    QING:  ["CHN", "MNG"],
    JOSE:  ["KOR", "PRK"],
    TOKU:  ["JPN"],
    SIAM:  ["THA"],
    MOR:   ["MAR", "ESH"],
    ETHIO: ["ETH", "ERI"],
    // Deliberately unclaimed: the North American interior and plains, the Amazon,
    // Patagonia, Australia/Oceania, inner Africa, Arabia Deserta, Siberia's far
    // fringe is Russian; unclaimed land is native or unexplored, not empty.
  },

  regionAssignments: {
    // — English America, 1650: New England, the Chesapeake, Newfoundland.
    "USA.22_1": "GBR",  // Massachusetts (incl. Plymouth)
    "USA.7_1": "GBR",   // Connecticut
    "USA.40_1": "GBR",  // Rhode Island
    "USA.30_1": "GBR",  // New Hampshire
    "USA.20_1": "GBR",  // Maine (fishing settlements)
    "USA.47_1": "GBR",  // Virginia
    "USA.21_1": "GBR",  // Maryland
    "CAN.5_1": "GBR",   // Newfoundland

    // — New Netherland on the Hudson; New Sweden on the Delaware.
    "USA.33_1": "NLD",  // New York (New Amsterdam)
    "USA.31_1": "NLD",  // New Jersey
    "USA.8_1": "SWE",   // Delaware (Fort Christina)

    // — New France and Acadia.
    "CAN.11_1": "FRA",  // Québec (Canada)
    "CAN.7_1": "FRA",   // Nova Scotia (Acadia)
    "CAN.4_1": "FRA",   // New Brunswick (Acadia)
    "CAN.10_1": "FRA",  // Prince Edward Island (Île Saint-Jean)

    // — Spanish North America.
    "USA.10_1": "ESP",  // Florida (San Agustín)
    "USA.32_1": "ESP",  // New Mexico (Santa Fe, 1598)

    // — Native North America (the map can only show the largest nations).
    "USA.39_1": "IROQ", // Pennsylvania (Susquehanna country under Iroquois pressure)
    "USA.36_1": "IROQ", // Ohio (emptied and claimed in the Beaver Wars, 1650)
    "CAN.9_1": "IROQ",  // Ontario (Huronia destroyed 1649 — Iroquois conquest)
    "USA.43_1": "CHER", // Tennessee
    "USA.18_1": "CHER", // Kentucky (Cherokee hunting grounds)
    "USA.11_1": "CREE_M", // Georgia
    "USA.1_1": "CREE_M",  // Alabama
    "USA.25_1": "CHOC", // Mississippi
    "USA.24_1": "SIOU", // Minnesota
    "USA.35_1": "SIOU", // North Dakota
    "USA.42_1": "SIOU", // South Dakota
    "USA.44_1": "APAC", // Texas
    "USA.37_1": "APAC", // Oklahoma
    "USA.3_1": "NAVA",  // Arizona
    "USA.45_1": "NAVA", // Utah
    "GTM.12_1": "MAYA", // Petén — the Itza kingdom (falls only in 1697)

    // — Brazil: Portuguese coast vs the Dutch northeast (the WIC holds Recife
    //   until 1654); the interior is unexplored/native.
    "BRA.2_1": "POR",  "BRA.5_1": "POR",  "BRA.6_1": "POR",  "BRA.8_1": "POR",
    "BRA.10_1": "POR", "BRA.14_1": "POR", "BRA.19_1": "POR", "BRA.25_1": "POR",
    "BRA.26_1": "POR",
    "BRA.15_1": "NLD", "BRA.17_1": "NLD", "BRA.20_1": "NLD",

    // — Spanish South America beyond the whole-country grants: the Río de la
    //   Plata and Chile; the Pampa and Patagonia stay native.
    "ARG.1_1": "ESP",  "ARG.2_1": "ESP",  "ARG.5_1": "ESP",  "ARG.6_1": "ESP",
    "ARG.7_1": "ESP",  "ARG.8_1": "ESP",  "ARG.10_1": "ESP", "ARG.12_1": "ESP",
    "ARG.13_1": "ESP", "ARG.14_1": "ESP", "ARG.17_1": "ESP", "ARG.18_1": "ESP",
    "ARG.19_1": "ESP", "ARG.21_1": "ESP", "ARG.22_1": "ESP", "ARG.24_1": "ESP",
    "CHL.4_1": "ESP",  "CHL.15_1": "ESP", "CHL.2_1": "ESP",  "CHL.5_1": "ESP",
    "CHL.7_1": "ESP",  "CHL.16_1": "ESP", "CHL.14_1": "ESP", "CHL.8_1": "ESP",
    "CHL.12_1": "ESP", "CHL.13_1": "ESP",

    // — Wallmapu: the Mapuche south of the Biobío, unconquered.
    "CHL.6_1": "MAPU", "CHL.3_1": "MAPU", "CHL.10_1": "MAPU", "CHL.9_1": "MAPU",
  },

  simulationRules:
    "It is 1650, the height of the first colonial age. Warfare is pike-and-shot: matchlock " +
    "muskets, pikes, siege cannon and ships of the line; armies are small and oceans are " +
    "slow — a crossing takes 6-10 weeks, and colonial ventures live or die by supply " +
    "fleets. NO industrial technology. Spain's two viceroyalties (New Spain and Peru) ship " +
    "silver convoys that everyone else's privateers hunt. Portugal, independent of Spain " +
    "again since 1640, is at war with the Dutch West India Company for the Brazilian " +
    "northeast (Recife falls to Portugal in 1654). England is a REPUBLIC — Charles I was " +
    "beheaded in 1649 and Cromwell's Commonwealth is subduing Ireland and will pass the " +
    "Navigation Act (1651), lighting the fuse of the Anglo-Dutch wars. New France is a fur " +
    "empire of a few thousand colonists allied to the Huron and Algonquin; New Netherland " +
    "and tiny New Sweden trade on the Hudson and Delaware. NATIVE NATIONS ARE REAL POWERS: " +
    "the Haudenosaunee (Iroquois) are mid-Beaver-Wars — they destroyed Huronia in 1649 and " +
    "dominate the eastern woodlands with Dutch muskets; the Mapuche have beaten Spain at " +
    "the Biobio frontier for a century; the Itza Maya of Peten remain unconquered until " +
    "1697; the Sioux, Apache, Navajo, Cherokee, Muscogee and Choctaw control the interior. " +
    "Horses are only now spreading north from New Mexico. Unclaimed regions are native " +
    "homelands or unexplored country — entering them means diplomacy or war with peoples " +
    "who know the ground. Disease is the colonizers' cruelest weapon and should shadow " +
    "every contact. In Europe the Thirty Years' War just ended (Westphalia 1648), the " +
    "Khmelnytsky uprising tears at Poland-Lithuania, and the Fronde paralyzes France. The " +
    "Qing have taken Beijing (1644) and are hunting the Ming remnant; Japan is closed " +
    "(sakoku); the VOC rules the spice trade from Batavia and Dutch Formosa.",

  startingTimelineText:
    "The year 1650. In London a king's severed head has made England a republic, and " +
    "Cromwell's Ironsides are in Ireland. In Madrid the silver of Potosi and Zacatecas " +
    "still buys armies, though the treasure fleets sail through seas thick with enemies. " +
    "In Recife the Dutch cling to their Brazilian conquest as Portuguese planters rise " +
    "against them. On the St Lawrence, Quebec mourns the Huron nation, shattered last " +
    "year by Haudenosaunee war parties armed with Dutch muskets — the Beaver Wars have " +
    "made the Five Nations the terror of the woodlands. On Manhattan island, Stuyvesant " +
    "counts furs; on the Delaware, a few hundred Swedes hold Fort Christina; at Santa Fe " +
    "and San Agustin, Spain's frontier priests and soldiers hold the edge of empire. " +
    "South of the Biobio the Mapuche sharpen their lances, unbeaten. Two worlds have met, " +
    "and neither will yield the continent without a fight.",
};
