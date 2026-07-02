/*! Open Historia — Medieval 1200 scenario preset © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Medieval preset — c. 1200 AD (the High Middle Ages).
//
// A best-effort repartition of the modern admin-1 map into the polities of the
// year 1200. Europe, the Mediterranean and the Near East are detailed; the major
// Asian states (Song/Jin China, Kamakura Japan, Goryeo, Khmer, Khwarazm, Abbasid
// Baghdad, Georgia) are included; genuinely fragmented/steppe/tribal regions
// (the Americas, Central Asian steppe, much of India & sub-Saharan Africa) are
// left at their modern default, which the engine tolerates gracefully.
//
// Borders snap to modern provinces, so frontiers are approximate. Sub-national
// medieval realms that don't align with modern provinces (e.g. England holding
// Normandy & Aquitaine inside France) cannot be drawn and live in simulationRules.

export default {
  id: "medieval-1200",

  meta: {
    name: "Medieval — 1200 AD",
    heroTitle: "The High Middle Ages",
    heroSubtitle: "A world of emperors, caliphs and crusaders, c. 1200",
    eyebrow: "Historical Preset",
    subtitle: "c. 1200 AD",
    accentColor: "#9a6b2f",
    coverImage: "public/loading_screen_4.jpg",
    description:
      "The year 1200. The Holy Roman Empire and the Capetian kings vie for Europe, the " +
      "Angevins rule from England to Aquitaine, Byzantium still stands (the Fourth Crusade " +
      "has not yet come), the Almohads and Ayyubids dominate the Islamic west and east, and " +
      "the Crusader states cling to the Levantine coast. Lead a kingdom, empire or caliphate " +
      "through an age of faith and iron.",
  },

  // Player starts as the Holy Roman Empire. game.country MUST equal the owner code.
  game: { country: "HRE", startDate: "1200-01-01", gameDate: "1200-01-01" },

  // No air power in 1200 — restrict deployable troop types to the era.
  allowedUnitTypes: ["infantry", "armor", "artillery", "naval", "garrison"],

  // 1200's modern country names are wholesale anachronistic, so relabel every
  // owned country with its polity name (Germany/Austria/... -> Holy Roman Empire).
  relabelOwnedCountries: true,

  polities: {
    HRE:   { name: "Holy Roman Empire", color: "#caa64a", aliases: ["Empire", "Reich", "Romans"] },
    FRA_K: { name: "Kingdom of France", color: "#2f5fd0", aliases: ["France", "Capetian France"] },
    ENG_A: { name: "Angevin Empire", color: "#b23b3b", aliases: ["Kingdom of England", "England", "Plantagenet"] },
    SCOT:  { name: "Kingdom of Scotland", color: "#6a6a9a", aliases: ["Scotland", "Alba"] },
    BYZ:   { name: "Byzantine Empire", color: "#7d3fb2", aliases: ["Eastern Roman Empire", "Rhomania", "Romania"] },
    ALM:   { name: "Almohad Caliphate", color: "#2e7d4f", aliases: ["al-Muwahhidun", "Almohads"] },
    AYY:   { name: "Ayyubid Sultanate", color: "#3f8f8f", aliases: ["Ayyubids", "Saladin's realm"] },
    ABBS:  { name: "Abbasid Caliphate", color: "#6b8e23", aliases: ["Baghdad Caliphate", "Abbasids"] },
    KHWA:  { name: "Khwarazmian Empire", color: "#8b6f47", aliases: ["Khwarazm", "Khwarazmshahs"] },
    RUS_K: { name: "Kievan Rus'", color: "#9a6b2f", aliases: ["Rus", "Rus principalities"] },
    CAST:  { name: "Crown of Castile", color: "#d2a02e", aliases: ["Castile", "León-Castile"] },
    ARAG:  { name: "Crown of Aragon", color: "#d23c3c", aliases: ["Aragon"] },
    NAV:   { name: "Kingdom of Navarre", color: "#5fae5f", aliases: ["Navarra"] },
    POR_K: { name: "Kingdom of Portugal", color: "#2e7d6b", aliases: ["Portugal"] },
    PAPAL: { name: "Papal States", color: "#e6d27a", aliases: ["Patrimony of St Peter", "the Church"] },
    SICI:  { name: "Kingdom of Sicily", color: "#c97a2e", aliases: ["Sicily", "Hauteville Sicily"] },
    VEN:   { name: "Republic of Venice", color: "#8a7d3f", aliases: ["Venice", "La Serenissima"] },
    JERU:  { name: "Crusader States", color: "#e04545", aliases: ["Outremer", "Kingdom of Jerusalem", "Antioch", "Cyprus"] },
    ARM_C: { name: "Cilician Armenia", color: "#d98cae", aliases: ["Armenian Cilicia", "Little Armenia"] },
    HUNG:  { name: "Kingdom of Hungary", color: "#3f9d9d", aliases: ["Hungary", "Croatia-Hungary"] },
    POL_K: { name: "Duchy of Poland", color: "#d23ca0", aliases: ["Poland", "Piast Poland"] },
    SERB:  { name: "Grand Principality of Serbia", color: "#9a4f9a", aliases: ["Serbia", "Raška"] },
    BULG:  { name: "Bulgarian Empire", color: "#8a5a3a", aliases: ["Bulgaria", "Second Bulgarian Empire"] },
    GEOR:  { name: "Kingdom of Georgia", color: "#5a9ac0", aliases: ["Georgia", "Sakartvelo"] },
    SELJ:  { name: "Sultanate of Rum", color: "#c25a3a", aliases: ["Seljuks of Rum", "Rum"] },
    DEN_K: { name: "Kingdom of Denmark", color: "#c9385d", aliases: ["Denmark"] },
    NOR_K: { name: "Kingdom of Norway", color: "#5b8ec9", aliases: ["Norway"] },
    SWE_K: { name: "Kingdom of Sweden", color: "#4a78c0", aliases: ["Sweden"] },
    VOLG:  { name: "Volga Bulgaria", color: "#7a8a4a", aliases: ["Volga Bulgars", "Bulghar"] },
    GHUR:  { name: "Ghurid Empire", color: "#8a5a8a", aliases: ["Ghurids", "Ghor"] },
    PAGAN: { name: "Kingdom of Pagan", color: "#b08a3a", aliases: ["Pagan", "Bagan", "Burma"] },
    DAIV:  { name: "Dai Viet", color: "#4a8a5a", aliases: ["Đại Việt", "Ly dynasty Vietnam"] },
    SRIV:  { name: "Srivijaya", color: "#6a7ab0", aliases: ["Sriwijaya", "Palembang"] },
    CHOL:  { name: "Chola Empire", color: "#c07a4a", aliases: ["Cholas", "Chozha"] },
    POLO:  { name: "Kingdom of Polonnaruwa", color: "#5a9a8a", aliases: ["Polonnaruwa", "Lanka"] },
    JIN:   { name: "Jin Dynasty", color: "#b87333", aliases: ["Jurchen Jin", "Great Jin"] },
    SONG:  { name: "Southern Song", color: "#c97a5a", aliases: ["Song Dynasty", "Song"] },
    XIA:   { name: "Western Xia", color: "#d0b060", aliases: ["Tangut", "Xi Xia"] },
    DALI:  { name: "Kingdom of Dali", color: "#6aae8a", aliases: ["Dali"] },
    TIBET: { name: "Tibet", color: "#b0a0c0", aliases: ["Tibetan polities"] },
    JAP_K: { name: "Kamakura Japan", color: "#c0507a", aliases: ["Japan", "Kamakura Shogunate"] },
    GORY:  { name: "Goryeo", color: "#5a9a7a", aliases: ["Korea", "Goryeo"] },
    KHMER: { name: "Khmer Empire", color: "#c2a23a", aliases: ["Angkor", "Khmer"] },
    ETHIO: { name: "Zagwe Ethiopia", color: "#4a8f6a", aliases: ["Abyssinia", "Zagwe"] },
  },

  countryAssignments: {
    // — Latin Christendom —
    HRE:   ["DEU", "AUT", "CHE", "NLD", "BEL", "LUX", "LIE", "CZE", "SVN"],
    FRA_K: ["FRA"],
    ENG_A: ["GBR", "IRL"],                 // Scotland split out below
    POR_K: ["PRT"],
    CAST:  ["ESP"],                        // Aragon/Navarre/Almohad split out below
    HUNG:  ["HUN", "HRV", "SVK", "BIH"],   // + Transylvania & Transcarpathia below; Wallachia/Moldavia are Cuman steppe
    POL_K: ["POL"],
    SERB:  ["SRB", "MNE", "XKO"],
    DEN_K: ["DNK"],
    NOR_K: ["NOR", "ISL", "FRO", "GRL"],
    SWE_K: ["SWE", "FIN"],
    SICI:  ["MLT"],                        // + southern Italy below
    // — Eastern Christendom —
    BYZ:   ["GRC", "MKD", "ALB"],          // + western Anatolia below
    BULG:  ["BGR"],
    GEOR:  ["GEO", "ARM"],
    // Kievan Rus': Belarus whole; European Russia and forest Ukraine are granted
    // region-by-region below — Siberia, the Urals and the Pontic-Caspian steppe
    // (Cumans/Kipchaks) were NOT Rus' and stay unclaimed.
    RUS_K: ["BLR"],
    // — Islamic world —
    ALM:   ["MAR", "DZA", "TUN", "LBY", "ESH"],
    AYY:   ["EGY", "SYR", "JOR", "LBN", "ISR", "PSE", "YEM"],
    ABBS:  ["IRQ"],
    KHWA:  ["IRN", "TKM", "UZB", "TJK"],   // Afghanistan belongs to the rival Ghurids
    GHUR:  ["AFG", "PAK"],                 // + the freshly conquered north-Indian plain below
    SELJ:  ["TUR"],                        // overridden along the coasts/frontiers below
    JERU:  ["CYP"],                        // + Levantine coast & Antioch below
    // — Asia & Africa —
    JAP_K: ["JPN"],
    GORY:  ["KOR", "PRK"],
    KHMER: ["KHM", "LAO", "THA"],          // Angkor at its height rules the Chao Phraya basin
    PAGAN: ["MMR"],
    DAIV:  ["VNM"],
    SRIV:  ["IDN", "MYS"],
    POLO:  ["LKA"],
    ETHIO: ["ETH"],
  },

  regionAssignments: {
    // Scotland
    "GBR.3_1": "SCOT",

    // Kievan Rus' — the principalities of European Russia (Novgorod's north
    // included); everything east of the Volga and south into the steppe is not Rus'.
    "RUS.4_1": "RUS_K",  "RUS.7_1": "RUS_K",  "RUS.8_1": "RUS_K",  "RUS.14_1": "RUS_K",
    "RUS.19_1": "RUS_K", "RUS.23_1": "RUS_K", "RUS.26_1": "RUS_K", "RUS.31_1": "RUS_K",
    "RUS.32_1": "RUS_K", "RUS.33_1": "RUS_K", "RUS.37_1": "RUS_K", "RUS.38_1": "RUS_K",
    "RUS.39_1": "RUS_K", "RUS.43_1": "RUS_K", "RUS.44_1": "RUS_K", "RUS.45_1": "RUS_K",
    "RUS.47_1": "RUS_K", "RUS.49_1": "RUS_K", "RUS.52_1": "RUS_K", "RUS.57_1": "RUS_K",
    "RUS.59_1": "RUS_K", "RUS.64_1": "RUS_K", "RUS.70_1": "RUS_K", "RUS.72_1": "RUS_K",
    "RUS.76_1": "RUS_K", "RUS.78_1": "RUS_K", "RUS.81_1": "RUS_K",

    // Volga Bulgaria on the middle Volga.
    "RUS.68_1": "VOLG", "RUS.13_1": "VOLG", "RUS.75_1": "VOLG", "RUS.62_1": "VOLG",
    "RUS.41_1": "VOLG", "RUS.74_1": "VOLG",

    // Rus' Ukraine: the forest and forest-steppe principalities (Kiev, Chernihiv,
    // Pereyaslav, Volhynia, Galicia). The Black Sea steppe is Cuman and unclaimed.
    "UKR.1_1": "RUS_K",  "UKR.2_1": "RUS_K",  "UKR.3_1": "RUS_K",  "UKR.7_1": "RUS_K",
    "UKR.10_1": "RUS_K", "UKR.11_1": "RUS_K", "UKR.12_1": "RUS_K", "UKR.14_1": "RUS_K",
    "UKR.18_1": "RUS_K", "UKR.19_1": "RUS_K", "UKR.21_1": "RUS_K", "UKR.22_1": "RUS_K",
    "UKR.24_1": "RUS_K", "UKR.25_1": "RUS_K", "UKR.27_1": "RUS_K",
    "UKR.23_1": "HUNG",  // Transcarpathia was Hungarian

    // Hungary's Transylvania, Banat and Partium (the rest of modern Romania —
    // Wallachia and Moldavia — is Cuman steppe in 1200).
    "ROU.1_1": "HUNG",  "ROU.2_1": "HUNG",  "ROU.5_1": "HUNG",  "ROU.6_1": "HUNG",
    "ROU.8_1": "HUNG",  "ROU.13_1": "HUNG", "ROU.14_1": "HUNG", "ROU.16_1": "HUNG",
    "ROU.22_1": "HUNG", "ROU.23_1": "HUNG", "ROU.27_1": "HUNG", "ROU.29_1": "HUNG",
    "ROU.33_1": "HUNG", "ROU.34_1": "HUNG", "ROU.35_1": "HUNG", "ROU.38_1": "HUNG",

    // Ghurid India: Muhammad of Ghor's generals have just taken the northern
    // plain (Delhi 1192, Bihar c. 1200); the Deccan and the south stay indigenous.
    "IND.25_1": "GHUR", "IND.12_1": "GHUR", "IND.28_1": "GHUR", "IND.6_1": "GHUR",
    "IND.34_1": "GHUR", "IND.5_1": "GHUR",  "IND.29_1": "GHUR",

    // The Chola heartland on the Tamil coast (declining but standing).
    "IND.31_1": "CHOL", "IND.27_1": "CHOL",

    // Iberia: Aragon, Navarre, and the Almohad south carved out of Castile.
    "ESP.2_1": "ARAG", "ESP.6_1": "ARAG",            // Aragón, Cataluña
    "ESP.9_1": "NAV",                                  // Navarra
    "ESP.1_1": "ALM", "ESP.18_1": "ALM",              // Andalucía, Murcia
    "ESP.10_1": "ALM", "ESP.13_1": "ALM",             // Valencia, Baleares (still Almohad in 1200)

    // Italy: Papal centre, Sicily south, Venice north-east, HRE (Kingdom of Italy) north.
    "ITA.8_1": "PAPAL", "ITA.18_1": "PAPAL", "ITA.11_1": "PAPAL",                         // Lazio, Umbria, Marche
    "ITA.1_1": "SICI", "ITA.2_1": "SICI", "ITA.3_1": "SICI", "ITA.4_1": "SICI",           // Abruzzo, Apulia, Basilicata, Calabria
    "ITA.5_1": "SICI", "ITA.12_1": "SICI", "ITA.15_1": "SICI",                            // Campania, Molise, Sicily
    "ITA.20_1": "VEN", "ITA.7_1": "VEN",                                                  // Veneto, Friuli
    "ITA.6_1": "HRE", "ITA.9_1": "HRE", "ITA.10_1": "HRE", "ITA.13_1": "HRE",             // Emilia, Liguria, Lombardia, Piemonte
    "ITA.16_1": "HRE", "ITA.17_1": "HRE", "ITA.19_1": "HRE", "ITA.14_1": "HRE",           // Toscana, Trentino, Valle d'Aosta, Sardegna

    // Levant: Crusader coast carved out of Ayyubid Syria/Palestine.
    "ISR.3_1": "JERU", "ISR.4_1": "JERU",            // Haifa/Acre, central coast (Jaffa)
    "LBN.5_1": "JERU", "LBN.7_1": "JERU", "LBN.8_1": "JERU",  // Mt Lebanon, Tripoli, Tyre/Sidon

    // Anatolia: Byzantine west & Black-Sea coast, Georgian NE, Cilician Armenia & Antioch
    // (JERU) in the SE, Ayyubid SE Mesopotamia; the centre stays Sultanate of Rum (SELJ).
    "TUR.40_1": "BYZ", "TUR.28_1": "BYZ", "TUR.73_1": "BYZ", "TUR.50_1": "BYZ", "TUR.22_1": "BYZ",
    "TUR.12_1": "BYZ", "TUR.41_1": "BYZ", "TUR.11_1": "BYZ", "TUR.59_1": "BYZ", "TUR.25_1": "BYZ",
    "TUR.56_1": "BYZ", "TUR.21_1": "BYZ", "TUR.16_1": "BYZ", "TUR.52_1": "BYZ", "TUR.66_1": "BYZ",
    "TUR.79_1": "BYZ", "TUR.54_1": "BYZ", "TUR.77_1": "BYZ", "TUR.46_1": "BYZ", "TUR.13_1": "BYZ",
    "TUR.81_1": "BYZ", "TUR.43_1": "BYZ", "TUR.19_1": "BYZ", "TUR.27_1": "BYZ", "TUR.70_1": "BYZ",
    "TUR.67_1": "BYZ", "TUR.63_1": "BYZ", "TUR.34_1": "BYZ", "TUR.75_1": "BYZ", "TUR.65_1": "BYZ",
    "TUR.45_1": "GEOR", "TUR.9_1": "GEOR", "TUR.10_1": "GEOR", "TUR.38_1": "GEOR", "TUR.4_1": "GEOR",
    "TUR.1_1": "ARM_C", "TUR.58_1": "ARM_C", "TUR.64_1": "ARM_C",
    "TUR.37_1": "JERU",
    "TUR.26_1": "AYY", "TUR.57_1": "AYY", "TUR.68_1": "AYY", "TUR.14_1": "AYY", "TUR.69_1": "AYY",
    "TUR.71_1": "AYY", "TUR.33_1": "AYY", "TUR.48_1": "AYY", "TUR.78_1": "AYY", "TUR.18_1": "AYY", "TUR.36_1": "AYY",

    // China: Jin in the north, Western Xia, Southern Song in the south, Dali, Tibet.
    "CHN.2_1": "JIN", "CHN.10_1": "JIN", "CHN.27_1": "JIN", "CHN.25_1": "JIN", "CHN.23_1": "JIN",
    "CHN.12_1": "JIN", "CHN.22_1": "JIN", "CHN.5_1": "JIN", "CHN.18_1": "JIN", "CHN.17_1": "JIN",
    "CHN.11_1": "JIN", "CHN.19_1": "JIN",
    "CHN.20_1": "XIA",
    "CHN.1_1": "SONG", "CHN.3_1": "SONG", "CHN.4_1": "SONG", "CHN.6_1": "SONG", "CHN.7_1": "SONG",
    "CHN.8_1": "SONG", "CHN.9_1": "SONG", "CHN.13_1": "SONG", "CHN.14_1": "SONG", "CHN.15_1": "SONG",
    "CHN.16_1": "SONG", "CHN.24_1": "SONG", "CHN.26_1": "SONG", "CHN.31_1": "SONG", "CHN.HKG": "SONG",
    "CHN.30_1": "DALI",
    "CHN.29_1": "TIBET", "CHN.21_1": "TIBET",
  },

  // Era cities: [name, modern-seed-name | [lng,lat], tier, population].
  // tier 4 = great-power capital ★, 3 = major city ◆, 2 = city, 1 = town.
  // Populations are c. 1200 estimates — a medieval "great city" held 50-200k.
  cities: [
    // — Christendom —
    ["Constantinople", "Istanbul", 4, 200000],
    ["Paris", "Paris", 4, 110000],
    ["London", "London", 3, 25000],
    ["Rome", "Rome", 3, 35000],
    ["Venice", "Venice", 3, 80000],
    ["Genoa", "Genoa", 2, 50000],
    ["Pisa", "Pisa", 2, 30000],
    ["Florence", "Florence", 2, 50000],
    ["Milan", "Milan", 2, 70000],
    ["Palermo", [13.36, 38.12], 3, 100000],
    ["Naples", "Naples", 2, 40000],
    ["Cologne", "Cologne", 2, 40000],
    ["Lübeck", "Lübeck", 1, 10000],
    ["Aachen", [6.08, 50.78], 1, 10000],
    ["Prague", "Prague", 2, 30000],
    ["Vienna", "Vienna", 2, 20000],
    ["Esztergom", "Esztergom", 2, 12000], // Hungarian royal seat
    ["Kraków", "Kraków", 2, 15000],
    ["Kiev", "Kyiv", 3, 45000],
    ["Novgorod", [31.27, 58.52], 3, 30000],
    ["Vladimir", "Vladimir", 2, 20000],
    ["Smolensk", "Smolensk", 1, 15000],
    ["Uppsala", "Uppsala", 1, 5000],
    ["Nidaros", "Trondheim", 1, 5000],
    ["Roskilde", "Roskilde", 1, 6000],
    ["Tarnovo", [25.62, 43.08], 2, 15000], // Bulgarian capital
    ["Thessalonica", [22.94, 40.64], 2, 40000],
    ["Toledo", [-4.02, 39.86], 2, 35000], // Castilian royal city
    ["Lisbon", "Lisbon", 2, 20000],
    ["Barcelona", "Barcelona", 2, 25000],
    // — Dar al-Islam —
    ["Seville", [-5.99, 37.39], 3, 80000], // Almohad seat in al-Andalus
    ["Córdoba", [-4.78, 37.89], 3, 60000],
    ["Granada", "Granada", 2, 30000],
    ["Marrakesh", "Marrakech", 3, 100000], // Almohad capital
    ["Fez", "Fès", 3, 80000],
    ["Tunis", "Tunis", 2, 40000],
    ["Cairo", "Cairo", 4, 200000], // Ayyubid capital
    ["Alexandria", "Alexandria", 2, 60000],
    ["Damascus", "Damascus", 3, 80000],
    ["Aleppo", "Aleppo", 2, 60000],
    ["Jerusalem", "Jerusalem", 2, 20000],
    ["Acre", [35.07, 32.93], 2, 40000], // Crusader capital
    ["Baghdad", "Baghdad", 4, 300000], // Abbasid caliphal seat
    ["Mosul", "Mosul", 2, 40000],
    ["Konya", "Konya", 2, 30000], // Seljuk Rum capital
    ["Mecca", "Mecca", 2, 15000],
    ["Tabriz", [46.29, 38.08], 2, 40000],
    ["Isfahan", [51.67, 32.65], 2, 60000],
    ["Nishapur", [58.8, 36.21], 2, 70000],
    ["Merv", [62.19, 37.66], 3, 100000],
    ["Bukhara", "Bukhara", 2, 60000],
    ["Samarkand", "Samarkand", 3, 80000],
    ["Gurganj", [59.15, 42.33], 3, 90000], // Khwarazmian capital
    ["Ghazni", "Ghaznī", 2, 40000], // Ghurid twin capital
    ["Herat", [62.2, 34.35], 2, 40000],
    // — India and Ceylon —
    ["Delhi", "Delhi", 2, 50000], // seat of the new Ghurid conquest
    ["Lahore", "Lahore", 2, 40000],
    ["Varanasi", [83.01, 25.32], 2, 50000],
    ["Thanjavur", [79.14, 10.79], 2, 60000], // Chola capital
    ["Polonnaruwa", [81.0, 7.94], 2, 30000], // Lankan capital
    // — East and Southeast Asia —
    ["Hangzhou", "Hangzhou", 4, 500000], // Lin'an, Southern Song capital
    ["Zhongdu", "Beijing", 3, 250000], // Jin capital
    ["Kaifeng", [114.31, 34.8], 3, 300000],
    ["Chengdu", "Chengdu", 2, 150000],
    ["Guangzhou", "Guangzhou", 2, 150000],
    ["Quanzhou", "Quanzhou", 2, 150000],
    ["Chang'an", [108.94, 34.34], 2, 80000],
    ["Kyoto", [135.77, 35.01], 3, 150000], // Heian-kyō
    ["Kamakura", [139.55, 35.32], 2, 50000], // seat of the new shogunate
    ["Kaesong", [126.55, 37.97], 2, 60000], // Goryeo capital
    ["Pagan", [94.86, 21.17], 3, 60000], // Burmese capital
    ["Angkor", [103.86, 13.44], 4, 400000], // Khmer capital — largest city on earth by area
    ["Thang Long", "Hanoi", 2, 50000], // Đại Việt capital
    // — Africa beyond Islam —
    ["Koumbi Saleh", [-7.68, 15.77], 2, 20000], // Ghana Empire
    ["Timbuktu", "Timbuktu", 1, 8000],
    ["Lalibela", [39.04, 12.03], 2, 15000], // Zagwe capital
    ["Kilwa", [39.51, -8.96], 2, 12000],
    ["Mogadishu", "Mogadishu", 2, 15000],
    ["Great Zimbabwe", [30.93, -20.27], 2, 10000],
    // — The Americas —
    ["Cahokia", [-90.06, 38.66], 2, 15000],
    ["Chan Chan", [-79.07, -8.1], 2, 30000], // Chimor capital
    ["Cusco", "Cusco", 1, 5000],
    ["Mayapan", [-89.46, 20.63], 1, 10000],
  ],

  simulationRules:
    "It is the year 1200, the height of the Middle Ages. Warfare is feudal: mounted knights, " +
    "levied infantry, castles and sieges; there is NO gunpowder and NO standing professional " +
    "army. The Holy Roman Empire is a loose confederation of princes under an elected emperor. " +
    "The Angevin (Plantagenet) kings of England also hold Normandy, Anjou and Aquitaine as " +
    "vassals of the French crown — a perpetual source of war (the map cannot show these French " +
    "holdings; treat western France as contested between England and France). The Byzantine " +
    "Empire is intact but internally weak; the Fourth Crusade's sack of Constantinople (1204) " +
    "has NOT happened. The Almohads dominate the Maghreb and southern Iberia while Castile, " +
    "Aragón, Navarre and Portugal press the Reconquista. The Ayyubids of Saladin's dynasty hold " +
    "Egypt and Syria; the Crusader states (Jerusalem, Antioch, Tripoli, Cyprus) cling to the " +
    "coast. The Abbasid Caliph in Baghdad has regained real power; the Khwarazmian Empire rises " +
    "in Persia while its rival, the Ghurid Empire, has just conquered the north-Indian plain " +
    "(Delhi fell in 1192). Kievan Rus' is a quarrelling family of principalities from Novgorod " +
    "to Kiev; the Pontic steppe belongs to the pagan Cumans (Kipchaks) and the middle Volga to " +
    "Muslim Volga Bulgaria — unclaimed steppe regions are Cuman grazing lands, not empty. In " +
    "the east the Jin and Southern Song divide China, Kamakura Japan is ruled by its shogun, " +
    "the Khmer Empire at Angkor rules mainland Southeast Asia, Pagan rules Burma, Dai Viet " +
    "holds the Red River, and Srivijaya commands the straits of the spice trade. Religion — " +
    "Latin Christianity, Orthodoxy, Sunni and Shia Islam — is the primary axis of alliance and " +
    "war. Mongol unification under Temüjin (Genghis Khan) looms after 1206.",

  startingTimelineText:
    "The year of grace 1200. In Rome the formidable Pope Innocent III asserts the supremacy of " +
    "the Church over kings. In Paris, Philip II Augustus schemes to strip the Plantagenets of " +
    "their French lands; across the Channel the lion-hearted Richard is newly dead and his " +
    "brother John wears England's crown uneasily. In Constantinople the Angeloi squander the " +
    "Roman inheritance as a crusader fleet gathers at Venice. Saladin's heirs quarrel over Egypt " +
    "and Syria while the banners of the Cross still fly over Acre and Antioch. In Iberia the " +
    "Almohad caliph holds the south against the Christian kings. Beyond the steppe, an obscure " +
    "Mongol chieftain named Temüjin is uniting the tribes. An age of cathedrals, crusades and " +
    "kings begins.",
};
