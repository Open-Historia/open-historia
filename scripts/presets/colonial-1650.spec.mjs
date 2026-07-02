/*! Open Historia — 1650 AD preset spec © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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
    // Russia's old #7a6b9a read as "unclaimed gray" on the map — clear green now.
    RUS:   { name: "Tsardom of Russia", color: "#2f8f4f", aliases: ["Russia", "Muscovy"] },
    DEN_N: { name: "Denmark-Norway", color: "#b0486a", aliases: ["Denmark", "the Oldenburg realm"] },
    OTTO:  { name: "Ottoman Empire", color: "#6b4f2e", aliases: ["the Porte", "the Turks"] },
    SAFA:  { name: "Safavid Persia", color: "#34869a", aliases: ["Persia", "Iran", "the Safavids"] },
    MUGH:  { name: "Mughal Empire", color: "#3a7d4f", aliases: ["Hindustan", "the Mughals"] },
    QING:  { name: "Qing Dynasty", color: "#c9a227", aliases: ["China", "the Manchus"] },
    JOSE:  { name: "Joseon", color: "#5a9a7a", aliases: ["Korea"] },
    TOKU:  { name: "Tokugawa Japan", color: "#c0507a", aliases: ["Japan", "the Shogunate"] },
    SIAM:  { name: "Ayutthaya", color: "#d0b060", aliases: ["Siam"] },
    MOR:   { name: "Sultanate of Morocco", color: "#2e5d8f", aliases: ["Morocco", "Pashalik of Timbuktu"] },
    ETHIO: { name: "Ethiopian Empire", color: "#4a8f6a", aliases: ["Abyssinia"] },
    // — The steppe, Central Asia and the khanates (real 1650 states; previously
    //   left unclaimed, which grayed out everything around Russia) —
    KAZH:  { name: "Kazakh Khanate", color: "#b8722e", aliases: ["the Kazakhs", "Kazakh Hordes"] },
    BUKH:  { name: "Khanate of Bukhara", color: "#3f9a9a", aliases: ["Bukhara", "the Janids"] },
    KHIV:  { name: "Khanate of Khiva", color: "#a04f70", aliases: ["Khiva", "Khwarazm"] },
    KHAL:  { name: "Khalkha Mongols", color: "#7a9a3f", aliases: ["Mongolia", "the Khalkha"] },
    DZUN:  { name: "Dzungar Khanate", color: "#4f6ab8", aliases: ["Dzungars", "the Oirats"] },
    TIBE:  { name: "Ganden Phodrang", color: "#d0a040", aliases: ["Tibet", "the Dalai Lama's government"] },
    CRIM:  { name: "Crimean Khanate", color: "#5aa06a", aliases: ["Crimea", "the Girays"] },
    // — Arabia and the Indian Ocean rim —
    OMAN:  { name: "Imamate of Oman", color: "#b85a2e", aliases: ["Oman", "the Ya'rubids"] },
    YEME:  { name: "Qasimid Yemen", color: "#8f6a2e", aliases: ["Yemen", "the Zaydi Imamate"] },
    KAND:  { name: "Kingdom of Kandy", color: "#7a5a30", aliases: ["Kandy", "Ceylon's interior"] },
    // — Mainland Southeast Asia —
    TOUN:  { name: "Toungoo Burma", color: "#c04f4f", aliases: ["Burma", "Ava"] },
    DAIV:  { name: "Dai Viet", color: "#3f7ab8", aliases: ["Vietnam", "Trinh and Nguyen lords"] },
    LANX:  { name: "Lan Xang", color: "#9a8f2e", aliases: ["Laos"] },
    CAMB:  { name: "Kingdom of Cambodia", color: "#6a9a4f", aliases: ["Cambodia", "Oudong"] },
    // — African states beyond the coasts —
    FUNJ:  { name: "Funj Sultanate", color: "#4f8f6a", aliases: ["Sennar", "the Funj"] },
    BORN:  { name: "Kanem-Bornu", color: "#6f5a9a", aliases: ["Bornu"] },
    AJUR:  { name: "Ajuran Sultanate", color: "#3a6a8f", aliases: ["Ajuran", "the Somali coast"] },
    MUTA:  { name: "Kingdom of Mutapa", color: "#8f7a3f", aliases: ["Mutapa", "Monomotapa"] },
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
    QING:  ["CHN"],
    JOSE:  ["KOR", "PRK"],
    TOKU:  ["JPN"],
    SIAM:  ["THA"],
    MOR:   ["MAR", "ESH", "MLI"], // incl. the Pashalik of Timbuktu
    ETHIO: ["ETH", "ERI"],
    // — The steppe and Central Asia —
    KAZH:  ["KAZ"],
    BUKH:  ["UZB", "TJK"],
    KHIV:  ["TKM"],
    KHAL:  ["MNG"], // the Khalkha submit to the Qing only in 1691
    // — Arabia, Ceylon, mainland Southeast Asia —
    OMAN:  ["OMN"],
    YEME:  ["YEM"],
    KAND:  ["LKA"],
    TOUN:  ["MMR"],
    DAIV:  ["VNM"],
    LANX:  ["LAO"],
    CAMB:  ["KHM"],
    // — Africa beyond the coastal forts —
    FUNJ:  ["SDN"],
    BORN:  ["TCD"],
    AJUR:  ["SOM"],
    MUTA:  ["ZWE"],
    // Deliberately unclaimed: the North American interior and plains, the Amazon,
    // Patagonia, Australia/Oceania, inner Africa's stateless zones and Arabia
    // Deserta; unclaimed land is native or unexplored, not empty.
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

    // — Inner Asia carved out of the Qing grant: the Dzungars hold the Tarim-Ili,
    //   the Dalai Lama's new government holds Tibet and Qinghai (since 1642).
    "CHN.28_1": "DZUN",
    "CHN.29_1": "TIBE", "CHN.21_1": "TIBE",
    // — The Crimean Khanate (Ottoman client, raiding the Commonwealth yearly).
    "UKR.4_1": "CRIM",
    // — Bornu proper on the Nigerian side of Lake Chad.
    "NGA.8_1": "BORN",
  },

  // Era cities: [name, modern-seed-name | [lng,lat], tier, population].
  // tier 4 = great-power capital ★, 3 = major city ◆, 2 = city, 1 = town.
  // Cape Town is deliberately absent — the VOC station is founded in 1652.
  cities: [
    // — English, Dutch, French and Swedish North America —
    ["Boston", "Boston", 2, 3000],
    ["Plymouth", [-70.67, 41.96], 1, 1000],
    ["New Amsterdam", "New York", 2, 1000], // capital of New Netherland
    ["Fort Orange", [-73.75, 42.65], 1, 500], // Albany — the fur trade post
    ["Jamestown", [-76.78, 37.21], 1, 1000],
    ["St. Mary's City", [-76.43, 38.19], 1, 500],
    ["Fort Christina", [-75.55, 39.74], 1, 400], // capital of New Sweden
    ["Québec", "Quebec City", 2, 1500], // capital of New France
    ["Ville-Marie", "Montréal", 1, 300], // the new mission at Montréal
    ["St. Augustine", "St. Augustine", 1, 1500],
    ["Santa Fe", [-105.94, 35.69], 1, 1500],
    // — Native nations —
    ["Onondaga", [-76.15, 43.05], 2, 2000], // Haudenosaunee council fire
    ["Chota", [-84.13, 35.56], 1, 1000], // Cherokee mother town
    // — New Spain and the Caribbean —
    ["Mexico City", "Mexico City", 4, 100000], // capital of New Spain
    ["Puebla", "Puebla", 2, 30000],
    ["Veracruz", "Veracruz", 2, 8000],
    ["Acapulco", "Acapulco de Juárez", 1, 4000], // the Manila galleon port
    ["Mérida", "Mérida", 1, 6000],
    ["Santiago de Guatemala", "Antigua Guatemala", 2, 25000],
    ["Havana", "Havana", 2, 30000],
    ["Santo Domingo", "Santo Domingo", 2, 15000],
    ["San Juan", "San Juan", 1, 5000],
    ["Cartagena", "Cartagena", 2, 20000],
    ["Portobelo", [-79.65, 9.55], 1, 3000], // the silver fleet's Atlantic port
    ["Panamá", "Panama City", 2, 8000],
    ["Bridgetown", "Bridgetown", 2, 10000], // Barbados sugar boom
    // — Spanish South America —
    ["Bogotá", "Bogotá", 2, 15000],
    ["Quito", "Quito", 2, 25000],
    ["Lima", "Lima", 4, 60000], // capital of the Viceroyalty of Peru
    ["Cusco", "Cusco", 2, 20000],
    ["Potosí", "Potosí", 3, 150000], // the silver mountain — biggest city in the Americas
    ["La Paz", "La Paz", 1, 5000],
    ["Asunción", "Asunción", 1, 4000],
    ["Buenos Aires", "Buenos Aires", 1, 4000],
    ["Santiago", "Santiago", 1, 5000],
    // — Portuguese and Dutch Brazil —
    ["Salvador", "Salvador", 3, 25000], // capital of Portuguese Brazil
    ["Mauritsstad", "Recife", 2, 15000], // capital of Dutch Brazil
    ["Rio de Janeiro", "Rio de Janeiro", 2, 8000],
    ["São Paulo", "São Paulo", 1, 2000],
    ["Belém", "Belém", 1, 2000],
    // — Europe: the metropoles —
    ["London", "London", 4, 400000],
    ["Paris", "Paris", 4, 450000],
    ["Madrid", "Madrid", 3, 130000],
    ["Seville", [-5.99, 37.39], 3, 120000], // the Indies trade monopoly
    ["Lisbon", "Lisbon", 3, 150000],
    ["Amsterdam", "Amsterdam", 4, 175000], // the warehouse of the world
    ["The Hague", "The Hague", 2, 20000],
    ["Rome", "Rome", 2, 120000],
    ["Vienna", "Vienna", 2, 60000],
    ["Berlin", "Berlin", 1, 12000], // small after the Thirty Years' War
    ["Stockholm", "Stockholm", 2, 35000],
    ["Copenhagen", "Copenhagen", 2, 30000],
    ["Warsaw", "Warsaw", 2, 20000],
    ["Moscow", "Moscow", 3, 150000],
    ["Constantinople", "Istanbul", 3, 700000], // the Ottoman capital
    // — Africa —
    ["Luanda", "Luanda", 2, 6000], // just retaken from the Dutch, 1648
    ["Elmina", [-1.35, 5.08], 2, 4000], // Dutch Gold Coast castle
    ["Fez", "Fès", 2, 80000],
    ["Algiers", "Algiers", 2, 60000],
    ["Tunis", "Tunis", 2, 70000],
    ["Cairo", "Cairo", 3, 300000],
    ["Mombasa", "Mombasa", 1, 6000],
    ["Mozambique Island", [40.74, -15.03], 1, 5000],
    // — Asia: the factories and the empires —
    ["Goa", "Panaji", 3, 60000], // capital of the Portuguese Estado da Índia
    ["Batavia", "Jakarta", 3, 30000], // VOC headquarters
    ["Manila", "Manila", 3, 40000],
    ["Macau", "Macau", 2, 20000],
    ["Malacca", "Melaka", 2, 10000], // Dutch since 1641
    ["Colombo", "Colombo", 1, 8000],
    ["Fort St. George", "Chennai", 1, 5000], // Madras, founded 1639
    ["Surat", [72.83, 21.17], 3, 100000], // the Mughal port
    ["Nagasaki", "Nagasaki", 2, 30000], // Dejima — Japan's one window
    ["Edo", "Tokyo", 4, 400000], // seat of the Tokugawa shoguns
    ["Kyoto", [135.77, 35.01], 3, 350000],
    ["Osaka", "Ōsaka", 3, 300000],
    ["Beijing", "Beijing", 4, 600000], // the new Qing capital
    ["Nanjing", "Nanjing", 3, 300000],
    ["Canton", "Guangzhou", 3, 200000],
    ["Shahjahanabad", "Delhi", 4, 400000], // Shah Jahan's new Mughal capital
    ["Agra", [78.01, 27.18], 3, 500000],
    ["Isfahan", [51.67, 32.65], 4, 400000], // Safavid capital — "half the world"
    ["Ayutthaya", [100.57, 14.35], 3, 150000], // Siamese capital
    ["Thang Long", "Hanoi", 2, 60000],
    // — The khanates, Arabia and the African states —
    ["Turkestan", [68.25, 43.3], 2, 20000], // seat of the Kazakh khans
    ["Bukhara", "Bukhara", 3, 60000],
    ["Samarkand", "Samarkand", 2, 50000],
    ["Khiva", [60.36, 41.38], 2, 20000],
    ["Bakhchysarai", [33.86, 44.75], 2, 20000], // Crimean capital
    ["Urga", [106.91, 47.92], 1, 5000], // the Khalkha monastic camp
    ["Lhasa", [91.18, 29.65], 2, 30000],
    ["Ava", [95.98, 21.86], 2, 30000], // Burmese capital
    ["Vientiane", [102.63, 17.97], 1, 15000],
    ["Oudong", [104.74, 11.81], 1, 10000], // Cambodian capital
    ["Kandy", [80.64, 7.29], 1, 15000],
    ["Muscat", "Muscat", 2, 15000],
    ["Sana'a", [44.21, 15.35], 2, 30000],
    ["Sennar", [33.63, 13.55], 2, 20000], // Funj capital
    ["Timbuktu", "Timbuktu", 2, 25000],
    ["Ngazargamu", [12.36, 13.09], 2, 20000], // Bornu capital
    ["Mogadishu", "Mogadishu", 2, 20000],
  ],

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
