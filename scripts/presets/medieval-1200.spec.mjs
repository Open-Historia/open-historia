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
    description:
      "The year 1200. The Holy Roman Empire and the Capetian kings vie for Europe, the " +
      "Angevins rule from England to Aquitaine, Byzantium still stands (the Fourth Crusade " +
      "has not yet come), the Almohads and Ayyubids dominate the Islamic west and east, and " +
      "the Crusader states cling to the Levantine coast. Lead a kingdom, empire or caliphate " +
      "through an age of faith and iron.",
  },

  // Player starts as the Holy Roman Empire. game.country MUST equal the owner code.
  game: { country: "HRE", startDate: "1200-01-01", gameDate: "1200-01-01" },

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
    HUNG:  ["HUN", "HRV", "SVK", "ROU", "BIH"],
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
    RUS_K: ["RUS", "UKR", "BLR"],
    // — Islamic world —
    ALM:   ["MAR", "DZA", "TUN", "LBY", "ESH"],
    AYY:   ["EGY", "SYR", "JOR", "LBN", "ISR", "PSE", "YEM"],
    ABBS:  ["IRQ"],
    KHWA:  ["IRN", "TKM", "UZB", "AFG", "TJK"],
    SELJ:  ["TUR"],                        // overridden along the coasts/frontiers below
    JERU:  ["CYP"],                        // + Levantine coast & Antioch below
    // — Asia & Africa —
    JAP_K: ["JPN"],
    GORY:  ["KOR", "PRK"],
    KHMER: ["KHM", "LAO"],
    ETHIO: ["ETH"],
  },

  regionAssignments: {
    // Scotland
    "GBR.3_1": "SCOT",

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
    "in Persia. In the east the Jin and Southern Song divide China, Kamakura Japan is ruled by " +
    "its shogun, and the Khmer Empire builds at Angkor. Religion — Latin Christianity, Orthodoxy, " +
    "Sunni and Shia Islam — is the primary axis of alliance and war. Mongol unification under " +
    "Temüjin (Genghis Khan) looms after 1206.",

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
