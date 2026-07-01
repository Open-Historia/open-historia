/*! Pax Historia — 1300 AD preset spec © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Mongol preset — 1300 AD (the Mongol world).
//
// The empire of Genghis Khan spans Eurasia, but two generations on it has
// settled into four khanates — the Yuan Great Khanate, the Golden Horde, the
// Chagatai ulus and the Ilkhanate — bound by lineage and (thin) deference to
// the Great Khan in Khanbaliq. The Russian principalities and Bulgaria pay the
// Horde tribute; Georgia and the Seljuk rump serve the Ilkhan; Goryeo serves
// the Yuan. On the empire's western rim, 1300 Europe fights its own wars —
// and in a Bithynian valley a beg named Osman has just begun raiding.

export default {
  id: "mongol-1300",

  meta: {
    name: "Mongol World — 1300 AD",
    heroTitle: "The Mongol Century",
    heroSubtitle: "Four khanates rule from Korea to the Carpathians, 1300 AD",
    eyebrow: "Historical Preset",
    subtitle: "1300 AD",
    accentColor: "#c9a227",
    coverImage: "public/loading_screen_4.jpg",
    description:
      "The year 1300. The heirs of Genghis Khan rule the largest land empire in history — " +
      "the Yuan emperor in Khanbaliq, the Golden Horde on the steppe, the Chagatai in " +
      "Transoxiana, the Ilkhan in Persia — while Russian princes and Balkan tsars pay " +
      "tribute. Beyond the hooves: Mamluk Egypt stands unbeaten, Delhi's sultan conquers " +
      "India, Edward I hammers Scotland, Philip IV squeezes the Templars' France, and an " +
      "obscure Ottoman beg raids the Byzantine frontier. Ride with the Horde or against it.",
  },

  // Player starts as the Yuan Great Khanate. game.country MUST equal the owner code.
  game: { country: "YUAN", startDate: "1300-01-01", gameDate: "1300-01-01" },

  // No air power in 1300; "armor" is heavy cavalry, "artillery" is siege engines
  // (trebuchets, and the first Chinese gunpowder siege weapons).
  allowedUnitTypes: ["infantry", "armor", "artillery", "naval", "garrison"],

  relabelOwnedCountries: true,

  polities: {
    // — The Mongol khanates —
    YUAN:  { name: "Yuan Dynasty", color: "#c9a227", aliases: ["Great Khanate", "Yuan China", "Khanbaliq", "the Great Khan"] },
    GHOR:  { name: "Golden Horde", color: "#b06a2e", aliases: ["Ulus of Jochi", "Kipchak Khanate", "the Horde"] },
    CHAG:  { name: "Chagatai Khanate", color: "#8a5aa0", aliases: ["Chagatai ulus", "Transoxiana"] },
    ILKH:  { name: "Ilkhanate", color: "#34869a", aliases: ["Ilkhans", "Hulaguids", "Mongol Persia"] },
    // — Mongol vassals & tributaries —
    RUSP:  { name: "Russian Principalities", color: "#7a94b8", aliases: ["the Rus'", "Vladimir-Suzdal", "Novgorod", "Horde tributaries"] },
    GALI:  { name: "Galicia-Volhynia", color: "#a05a7a", aliases: ["Kingdom of Ruthenia", "Halych-Volhynia"] },
    GORY:  { name: "Goryeo", color: "#5a9a7a", aliases: ["Korea", "Yuan vassal Korea"] },
    GEOR:  { name: "Kingdom of Georgia", color: "#5a9ac0", aliases: ["Georgia", "Sakartvelo"] },
    ARM_C: { name: "Cilician Armenia", color: "#d98cae", aliases: ["Little Armenia", "Armenian Cilicia"] },
    BULG:  { name: "Bulgarian Empire", color: "#8a5a3a", aliases: ["Bulgaria", "Tarnovo"] },
    // — Western Europe —
    FRA_K: { name: "Kingdom of France", color: "#2f5fd0", aliases: ["France", "Philip the Fair's realm"] },
    ENG_K: { name: "Kingdom of England", color: "#b23b3b", aliases: ["England", "Plantagenet England"] },
    SCOT:  { name: "Kingdom of Scotland", color: "#6a6a9a", aliases: ["Scotland", "Alba"] },
    CAST:  { name: "Crown of Castile", color: "#d2a02e", aliases: ["Castile", "Castile-León"] },
    ARAG:  { name: "Crown of Aragon", color: "#d23c3c", aliases: ["Aragon"] },
    NAV:   { name: "Kingdom of Navarre", color: "#5fae5f", aliases: ["Navarra"] },
    PORT:  { name: "Kingdom of Portugal", color: "#2e7d6b", aliases: ["Portugal"] },
    GRAN:  { name: "Emirate of Granada", color: "#2e7d4f", aliases: ["Granada", "Nasrids"] },
    HRE:   { name: "Holy Roman Empire", color: "#caa64a", aliases: ["the Empire", "Habsburg Empire"] },
    PAPAL: { name: "Papal States", color: "#e6d27a", aliases: ["the Church", "Boniface VIII"] },
    NAPL:  { name: "Kingdom of Naples", color: "#c97a2e", aliases: ["Angevin Naples", "Regno"] },
    SICI:  { name: "Kingdom of Trinacria", color: "#c9385d", aliases: ["Sicily", "Aragonese Sicily"] },
    VEN:   { name: "Republic of Venice", color: "#8a7d3f", aliases: ["Venice", "La Serenissima"] },
    HUNG:  { name: "Kingdom of Hungary", color: "#3f9d9d", aliases: ["Hungary"] },
    POL_K: { name: "Kingdom of Poland", color: "#d23ca0", aliases: ["Poland", "Piast Poland"] },
    SERB:  { name: "Kingdom of Serbia", color: "#9a4f9a", aliases: ["Serbia", "Milutin's realm"] },
    LITH:  { name: "Grand Duchy of Lithuania", color: "#6b8e23", aliases: ["Lithuania", "pagan Lithuania"] },
    TEUT:  { name: "Teutonic Order", color: "#aab4c4", aliases: ["the Order", "Ordensstaat", "Livonia"] },
    DEN_K: { name: "Kingdom of Denmark", color: "#b0486a", aliases: ["Denmark"] },
    NOR_K: { name: "Kingdom of Norway", color: "#5b8ec9", aliases: ["Norway"] },
    SWE_K: { name: "Kingdom of Sweden", color: "#4a78c0", aliases: ["Sweden"] },
    // — Eastern Mediterranean —
    BYZ:   { name: "Byzantine Empire", color: "#7d3fb2", aliases: ["Eastern Roman Empire", "Palaiologos Empire"] },
    OTTO:  { name: "Ottoman Beylik", color: "#6b4f2e", aliases: ["Osman's beylik", "Ottomans"] },
    CYPR:  { name: "Kingdom of Cyprus", color: "#e07a7a", aliases: ["Lusignan Cyprus"] },
    MAML:  { name: "Mamluk Sultanate", color: "#3f8f5f", aliases: ["Mamluks", "Egypt and Syria"] },
    // — Africa & Arabia —
    MAKU:  { name: "Makuria", color: "#9a6a3a", aliases: ["Nubia", "Dongola"] },
    ETHIO: { name: "Ethiopian Empire", color: "#4a8f6a", aliases: ["Abyssinia", "Solomonic Ethiopia"] },
    RASU:  { name: "Rasulid Yemen", color: "#6a8a3a", aliases: ["Rasulids", "Yemen"] },
    MALI:  { name: "Mali Empire", color: "#c2a23a", aliases: ["Mali", "the Mansas"] },
    HAFS:  { name: "Hafsid Sultanate", color: "#4f7d2e", aliases: ["Hafsids", "Tunis"] },
    ZAYY:  { name: "Zayyanid Kingdom", color: "#7d6b2e", aliases: ["Zayyanids", "Tlemcen"] },
    MARI:  { name: "Marinid Sultanate", color: "#2e5d8f", aliases: ["Marinids", "Fez"] },
    // — India & Southeast Asia —
    DELH:  { name: "Delhi Sultanate", color: "#3a7d4f", aliases: ["Delhi", "Khalji Sultanate"] },
    PAND:  { name: "Pandya Empire", color: "#c07a4a", aliases: ["Pandyas", "Madurai"] },
    HOYS:  { name: "Hoysala Kingdom", color: "#6f8f3f", aliases: ["Hoysalas"] },
    YADA:  { name: "Yadava Kingdom", color: "#b8604a", aliases: ["Yadavas", "Devagiri"] },
    KAKA:  { name: "Kakatiya Kingdom", color: "#8f5f8f", aliases: ["Kakatiyas", "Warangal"] },
    DAIV:  { name: "Dai Viet", color: "#4a8a5a", aliases: ["Đại Việt", "Tran dynasty"] },
    KHMER: { name: "Khmer Empire", color: "#c97a5a", aliases: ["Angkor", "Cambodia"] },
    SUKH:  { name: "Sukhothai", color: "#d0b060", aliases: ["Ramkhamhaeng's kingdom", "Siam"] },
    MAJA:  { name: "Majapahit", color: "#6a7ab0", aliases: ["Java", "Majapahit Empire"] },
    JAP_K: { name: "Kamakura Japan", color: "#c0507a", aliases: ["Japan", "Kamakura Shogunate"] },
  },

  countryAssignments: {
    // — The khanates —
    YUAN:  ["CHN", "MNG"],
    GHOR:  ["KAZ", "MDA"],                 // + the Pontic-Caspian steppe below
    CHAG:  ["UZB", "TJK", "KGZ", "TKM", "AFG"],
    ILKH:  ["IRN", "IRQ", "AZE", "ARM", "TUR"],  // Anatolia's Seljuk rump serves the Ilkhan; NW carved out below
    // — Vassals —
    GORY:  ["KOR", "PRK"],
    GEOR:  ["GEO"],
    BULG:  ["BGR"],
    // — Europe —
    FRA_K: ["FRA"],
    ENG_K: ["GBR", "IRL"],                 // Scotland carved out below
    CAST:  ["ESP"],                        // Aragon/Navarre/Granada carved out below
    PORT:  ["PRT"],
    HRE:   ["DEU", "AUT", "CHE", "NLD", "BEL", "LUX", "LIE", "CZE", "SVN"],
    HUNG:  ["HUN", "HRV", "SVK", "BIH"],
    POL_K: ["POL"],
    SERB:  ["SRB", "MNE", "XKO", "MKD"],   // Milutin has taken Skopje
    LITH:  ["LTU", "BLR"],
    TEUT:  ["EST", "LVA"],                 // + Prussia (Kaliningrad) below
    DEN_K: ["DNK"],
    NOR_K: ["NOR", "ISL", "FRO", "GRL"],
    SWE_K: ["SWE", "FIN"],
    BYZ:   ["GRC", "ALB"],                 // + the Anatolian northwest below
    CYPR:  ["CYP"],
    // — Mamluks, Africa, Arabia —
    MAML:  ["EGY", "SYR", "LBN", "ISR", "PSE", "JOR"],
    MAKU:  ["SDN"],
    ETHIO: ["ETH", "ERI"],
    RASU:  ["YEM"],
    MALI:  ["MLI", "SEN", "GMB", "GIN"],
    HAFS:  ["TUN"],
    ZAYY:  ["DZA"],
    MARI:  ["MAR"],
    // — India & Southeast Asia —
    DELH:  ["PAK"],                        // + the conquered north-Indian plain below
    DAIV:  ["VNM"],
    KHMER: ["KHM", "LAO"],
    SUKH:  ["THA"],
    MAJA:  ["IDN"],
    JAP_K: ["JPN"],
    // Deliberately unclaimed: Siberia, the far steppe, Arabia Deserta, Wallachia/
    // Moldavia (forming), Burma (Pagan fell to the Mongols in 1287), inner Africa,
    // the Americas.
  },

  regionAssignments: {
    // Scotland — Wars of Independence raging, but not England.
    "GBR.3_1": "SCOT",

    // Iberia: Aragon, Navarre, Granada carved from Castile.
    "ESP.2_1": "ARAG", "ESP.6_1": "ARAG", "ESP.10_1": "ARAG", "ESP.13_1": "ARAG",
    "ESP.9_1": "NAV",
    "ESP.1_1": "GRAN",   // Nasrid Granada (coarse: the emirate is the south of Andalucía)

    // Italy c. 1300: imperial north, papal centre (with Romagna), Angevin south,
    // Aragonese Sicily, Venetian north-east; Sardinia is contested (unclaimed).
    "ITA.9_1": "HRE", "ITA.10_1": "HRE", "ITA.13_1": "HRE", "ITA.16_1": "HRE",
    "ITA.17_1": "HRE", "ITA.19_1": "HRE",
    "ITA.8_1": "PAPAL", "ITA.18_1": "PAPAL", "ITA.11_1": "PAPAL", "ITA.6_1": "PAPAL",
    "ITA.1_1": "NAPL", "ITA.2_1": "NAPL", "ITA.3_1": "NAPL", "ITA.4_1": "NAPL",
    "ITA.5_1": "NAPL", "ITA.12_1": "NAPL",
    "ITA.15_1": "SICI",
    "ITA.20_1": "VEN", "ITA.7_1": "VEN",

    // The Golden Horde's own steppe: lower Volga, Urals fringe, north Caucasus.
    "RUS.1_1": "GHOR",  "RUS.5_1": "GHOR",  "RUS.6_1": "GHOR",  "RUS.7_1": "GHOR",
    "RUS.10_1": "GHOR", "RUS.13_1": "GHOR", "RUS.15_1": "GHOR", "RUS.17_1": "GHOR",
    "RUS.20_1": "GHOR", "RUS.22_1": "GHOR", "RUS.25_1": "GHOR", "RUS.34_1": "GHOR",
    "RUS.41_1": "GHOR", "RUS.42_1": "GHOR", "RUS.48_1": "GHOR", "RUS.53_1": "GHOR",
    "RUS.54_1": "GHOR", "RUS.58_1": "GHOR", "RUS.62_1": "GHOR", "RUS.63_1": "GHOR",
    "RUS.65_1": "GHOR", "RUS.67_1": "GHOR", "RUS.68_1": "GHOR", "RUS.75_1": "GHOR",
    "RUS.77_1": "GHOR", "RUS.79_1": "GHOR",
    // ...and the Black Sea steppe of Ukraine (with Crimea).
    "UKR.4_1": "GHOR",  "UKR.5_1": "GHOR",  "UKR.6_1": "GHOR",  "UKR.8_1": "GHOR",
    "UKR.9_1": "GHOR",  "UKR.13_1": "GHOR", "UKR.15_1": "GHOR", "UKR.16_1": "GHOR",
    "UKR.17_1": "GHOR", "UKR.26_1": "GHOR",

    // The Russian principalities — self-governing tributaries of the Horde.
    "RUS.4_1": "RUSP",  "RUS.8_1": "RUSP",  "RUS.14_1": "RUSP", "RUS.19_1": "RUSP",
    "RUS.23_1": "RUSP", "RUS.26_1": "RUSP", "RUS.31_1": "RUSP", "RUS.32_1": "RUSP",
    "RUS.33_1": "RUSP", "RUS.37_1": "RUSP", "RUS.38_1": "RUSP", "RUS.39_1": "RUSP",
    "RUS.43_1": "RUSP", "RUS.44_1": "RUSP", "RUS.45_1": "RUSP", "RUS.47_1": "RUSP",
    "RUS.49_1": "RUSP", "RUS.52_1": "RUSP", "RUS.55_1": "RUSP", "RUS.57_1": "RUSP",
    "RUS.59_1": "RUSP", "RUS.64_1": "RUSP", "RUS.70_1": "RUSP", "RUS.72_1": "RUSP",
    "RUS.76_1": "RUSP", "RUS.78_1": "RUSP", "RUS.81_1": "RUSP",
    "UKR.1_1": "RUSP",  "UKR.2_1": "RUSP",  "UKR.11_1": "RUSP", "UKR.12_1": "RUSP",
    "UKR.18_1": "RUSP", "UKR.21_1": "RUSP", "UKR.27_1": "RUSP",

    // Galicia-Volhynia, King Lev's Ruthenia between Poland and the Horde.
    "UKR.3_1": "GALI",  "UKR.7_1": "GALI",  "UKR.10_1": "GALI", "UKR.14_1": "GALI",
    "UKR.19_1": "GALI", "UKR.22_1": "GALI", "UKR.24_1": "GALI", "UKR.25_1": "GALI",
    "UKR.23_1": "HUNG", // Transcarpathia

    // Hungary's Transylvania, Banat and Partium; Wallachia/Moldavia stay unclaimed.
    "ROU.1_1": "HUNG",  "ROU.2_1": "HUNG",  "ROU.5_1": "HUNG",  "ROU.6_1": "HUNG",
    "ROU.8_1": "HUNG",  "ROU.13_1": "HUNG", "ROU.14_1": "HUNG", "ROU.16_1": "HUNG",
    "ROU.22_1": "HUNG", "ROU.23_1": "HUNG", "ROU.27_1": "HUNG", "ROU.29_1": "HUNG",
    "ROU.33_1": "HUNG", "ROU.34_1": "HUNG", "ROU.35_1": "HUNG", "ROU.38_1": "HUNG",

    // Teutonic Prussia.
    "RUS.21_1": "TEUT",

    // Anatolia: the Byzantine northwest and Aegean coast; Osman's beylik at
    // Söğüt on the Byzantine frontier; Cilician Armenia under Ilkhan protection.
    "TUR.40_1": "BYZ", "TUR.28_1": "BYZ", "TUR.50_1": "BYZ", "TUR.73_1": "BYZ",
    "TUR.22_1": "BYZ", "TUR.21_1": "BYZ", "TUR.12_1": "BYZ", "TUR.41_1": "BYZ",
    "TUR.79_1": "BYZ",
    "TUR.16_1": "OTTO", "TUR.32_1": "OTTO", "TUR.66_1": "OTTO",
    "TUR.1_1": "ARM_C", "TUR.58_1": "ARM_C", "TUR.64_1": "ARM_C",

    // Delhi under Alauddin Khalji: the northern plain, Gujarat (1299), Bengal.
    "IND.25_1": "DELH", "IND.12_1": "DELH", "IND.28_1": "DELH", "IND.6_1": "DELH",
    "IND.34_1": "DELH", "IND.5_1": "DELH",  "IND.29_1": "DELH", "IND.11_1": "DELH",
    "IND.36_1": "DELH",

    // The Deccan and the south: Yadavas, Kakatiyas, Hoysalas, Pandyas.
    "IND.20_1": "YADA",
    "IND.32_1": "KAKA", "IND.2_1": "KAKA",
    "IND.16_1": "HOYS",
    "IND.31_1": "PAND", "IND.27_1": "PAND",
  },

  simulationRules:
    "It is 1300 AD. The Mongol Empire is the largest land empire in history but is no longer " +
    "one state: the Yuan Great Khan (Temur, Kublai's grandson) reigns in Khanbaliq and is " +
    "acknowledged — nominally — by the Golden Horde on the western steppe, the Chagatai " +
    "khans of Transoxiana and the Ilkhans of Persia, who all war among themselves (Ilkhanate " +
    "vs Horde over the Caucasus, Chagatai vs Yuan over the old homeland). Warfare is feudal " +
    "and steppe-nomadic: massed horse archers, heavy lancers, trebuchets, and the first " +
    "Chinese gunpowder siege weapons; there is NO modern artillery and NO air power. The " +
    "Russian principalities, Bulgaria and Georgia are TRIBUTARIES: self-governing but taxed " +
    "and militarily answerable to their khanate overlords — treat them as vassals who dream " +
    "of independence. The Mamluks of Egypt have beaten every Mongol invasion of Syria (Ain " +
    "Jalut 1260, and they will win again at Marj al-Saffar 1303) — the Ilkhan-Mamluk war is " +
    "the era's defining front, and the Ilkhans court Christian Europe as allies against it. " +
    "Alauddin Khalji's Delhi is conquering India and will soon raid the Deccan kingdoms " +
    "(Yadava, Kakatiya, Hoysala, Pandya). In Anatolia the Seljuk rump serves the Ilkhan while " +
    "coastal beyliks slip loose — among them Osman's tiny Ottoman beylik, founded c. 1299, " +
    "which history will make an empire. In Europe: Edward I fights Scotland, Philip IV of " +
    "France feuds with Pope Boniface VIII, the Sicilian Vespers war splits Naples (Anjou) " +
    "from island Sicily (Aragon), and pagan Lithuania resists the Teutonic Order. Kamakura " +
    "Japan has repelled two Mongol invasions (1274, 1281). Unclaimed regions are tribal or " +
    "stateless lands — steppe, forest, desert — raidable and colonizable but ungoverned.",

  startingTimelineText:
    "The year 1300. From the Pacific to the Carpathians the descendants of Genghis Khan " +
    "divide the world's greatest empire. In Khanbaliq, Temur Khan holds his grandfather " +
    "Kublai's throne; on the Volga, Toqta rules the Golden Horde and counts the tribute of " +
    "Russian princes; in Tabriz the Ilkhan Ghazan, newly Muslim, plans one more march on " +
    "Mamluk Syria. Cairo's slave-soldier sultans remain the one power the Mongols never " +
    "broke. In Delhi, Alauddin Khalji sharpens his armies for the conquest of the south. In " +
    "Rome, Boniface VIII proclaims the first Jubilee as kings in Paris and London tax their " +
    "clergy for war. On a hillside in Bithynia, a Turkish beg named Osman watches the " +
    "Byzantine frontier and dreams. The world belongs to the horse — for now.",
};
