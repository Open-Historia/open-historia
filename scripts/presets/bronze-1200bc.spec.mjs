/*! Open Historia — 1200 BC preset spec © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Late Bronze Age preset — c. 1200 BC, on the eve of the Collapse.
//
// The last golden generation of the Bronze Age world: New Kingdom Egypt holds
// Canaan and Nubia, the Hittite Great King rules Anatolia and north Syria,
// Assyria and Kassite Babylon contest Mesopotamia, Elam watches from Susa,
// and the Mycenaean palaces still stand. Within a generation the Sea Peoples,
// famine and systems collapse will sweep almost all of it away — unless the
// player changes history. Vast stretches of the world (Europe, the steppe,
// India, inner Africa, most of the Americas) are tribal and unclaimed.

export default {
  id: "bronze-1200bc",

  meta: {
    name: "Bronze Age — 1200 BC",
    heroTitle: "Before the Collapse",
    heroSubtitle: "The palaces still stand. The Sea Peoples are coming.",
    eyebrow: "Historical Preset",
    subtitle: "c. 1200 BC",
    accentColor: "#c28a2e",
    coverImage: "public/loading_screen_3.jpg",
    description:
      "The Late Bronze Age at its height. Pharaoh rules from Nubia to Canaan, trading " +
      "brother-to-brother with the Great Kings of Hatti, Babylon and Assyria. Bronze — and the " +
      "tin it demands — binds an international system of palaces, chariots and scribes from " +
      "Mycenae to Susa. But the harvests are failing, the Sea Peoples are stirring, and within " +
      "a generation almost every palace on this map will burn. Hold the old world together as " +
      "Egypt, break it as the raiders, or rise from its ashes.",
  },

  // Player starts as New Kingdom Egypt. game.country MUST equal the owner code.
  // BCE dates are plain text (dayjs can't parse them); the timeline shows them
  // verbatim and the AI advances them as text.
  game: { country: "EGYP", startDate: "1200 BCE", gameDate: "1200 BCE" },

  // Bronze Age warfare: massed infantry with bronze arms, chariotry ("armor"),
  // war fleets and garrisons. No true siege artillery and certainly no air.
  allowedUnitTypes: ["infantry", "armor", "naval", "garrison"],

  // Modern names are wholesale anachronistic in 1200 BC — relabel owned countries.
  relabelOwnedCountries: true,

  polities: {
    EGYP: { name: "New Kingdom Egypt", color: "#c9a227", aliases: ["Egypt", "Kemet", "Pharaoh's realm", "the Two Lands"] },
    HATT: { name: "Hittite Empire", color: "#8f5a3f", aliases: ["Hatti", "the Hittites", "the Great King of Hatti"] },
    ASSY: { name: "Middle Assyrian Empire", color: "#7a3f3f", aliases: ["Assyria", "Assur"] },
    BABY: { name: "Kassite Babylonia", color: "#3f6ab8", aliases: ["Babylon", "Karduniash", "the Kassites"] },
    ELAM: { name: "Elam", color: "#9a6a3a", aliases: ["Susa and Anshan", "the Elamites"] },
    MYCE: { name: "Mycenaean Kingdoms", color: "#4a78c0", aliases: ["Ahhiyawa", "the Achaeans", "Mycenae"] },
    WILU: { name: "Wilusa", color: "#6a8a3a", aliases: ["Troy", "Ilios"] },
    ALAS: { name: "Alashiya", color: "#3f9a8a", aliases: ["Cyprus", "the copper island"] },
    LIBU: { name: "Libu Tribes", color: "#8a7a4a", aliases: ["Libya", "the Libu and Meshwesh"] },
    SHAN: { name: "Shang Dynasty", color: "#b8860b", aliases: ["Shang", "Yin", "China"] },
    SHUU: { name: "Kingdom of Shu", color: "#5a9a5a", aliases: ["Sanxingdui", "ancient Shu"] },
    OLME: { name: "Olmec", color: "#7a5c8a", aliases: ["the Olmecs", "San Lorenzo"] },
  },

  countryAssignments: {
    // — Pharaoh's empire: Egypt, Canaan and the Transjordan vassals.
    EGYP: ["EGY", "ISR", "PSE", "LBN", "JOR"],
    // — Hatti: the Anatolian plateau (Wilusa carved out below).
    HATT: ["TUR"],
    // — The Aegean palace world, Crete included.
    MYCE: ["GRC"],
    ALAS: ["CYP"],
    LIBU: ["LBY"],
    // Everything else — temperate Europe, the steppe, Iran beyond Elam, India,
    // Arabia, inner Africa, most of the Americas — is tribal, unclaimed land.
  },

  regionAssignments: {
    // — Egyptian Nubia: the viceroyalty of Kush to the fourth cataract.
    "SDN.10_1": "EGYP", // Northern
    "SDN.12_1": "EGYP", // River Nile
    "SDN.11_1": "EGYP", // Red Sea
    // — Egyptian Syria: the province of Upe around Damascus.
    "SYR.5_1": "EGYP", "SYR.13_1": "EGYP", "SYR.12_1": "EGYP",
    "SYR.6_1": "EGYP", "SYR.4_1": "EGYP",
    // — Hittite Syria: Ugarit, Amurru, Carchemish, Kadesh (theirs since 1259 BC).
    "SYR.11_1": "HATT", "SYR.14_1": "HATT", "SYR.10_1": "HATT",
    "SYR.2_1": "HATT", "SYR.3_1": "HATT", "SYR.9_1": "HATT", "SYR.8_1": "HATT",
    // — Wilusa (Troy) on the Hellespont, carved from the Hittite grant.
    "TUR.22_1": "WILU", // Çanakkale
    // — Assyria: the middle Tigris and the conquered Mitanni lands.
    "IRQ.16_1": "ASSY", "IRQ.12_1": "ASSY", "IRQ.6_1": "ASSY",
    "IRQ.8_1": "ASSY", "IRQ.7_1": "ASSY", "IRQ.17_1": "ASSY",
    "SYR.1_1": "ASSY", "SYR.7_1": "ASSY", // Hanigalbat: Hasakah, Deir ez-Zor
    // — Karduniash: Kassite Babylonia, the alluvium from Baghdad to the Gulf.
    "IRQ.10_1": "BABY", "IRQ.9_1": "BABY", "IRQ.14_1": "BABY",
    "IRQ.5_1": "BABY", "IRQ.13_1": "BABY", "IRQ.18_1": "BABY",
    "IRQ.4_1": "BABY", "IRQ.11_1": "BABY", "IRQ.3_1": "BABY",
    "IRQ.15_1": "BABY", "IRQ.2_1": "BABY", "IRQ.1_1": "BABY",
    // — Elam: Susiana and Anshan behind the Zagros.
    "IRN.15_1": "ELAM", "IRN.12_1": "ELAM", "IRN.18_1": "ELAM",
    "IRN.3_1": "ELAM", "IRN.7_1": "ELAM", "IRN.16_1": "ELAM",
    // — Shang China on the middle Yellow River.
    "CHN.12_1": "SHAN", "CHN.10_1": "SHAN", "CHN.23_1": "SHAN",
    "CHN.25_1": "SHAN", "CHN.22_1": "SHAN", "CHN.2_1": "SHAN", "CHN.27_1": "SHAN",
    // — Sanxingdui's Shu culture in the Sichuan basin.
    "CHN.26_1": "SHUU",
    // — The Olmec heartland on the Gulf of Mexico.
    "MEX.30_1": "OLME", "MEX.27_1": "OLME", // Veracruz, Tabasco
  },

  // Era cities: [name, modern-seed-name | [lng,lat], tier, population].
  // tier 4 = great-power capital ★, 3 = major city ◆, 2 = city, 1 = town.
  // Populations are c. 1200 BC estimates — the largest cities held ~30-160k.
  cities: [
    // — Egypt and Nubia —
    ["Pi-Ramesses", [31.83, 30.8], 4, 160000], // Ramesside capital in the Delta
    ["Thebes", [32.64, 25.7], 3, 80000], // Waset, city of Amun
    ["Memphis", [31.25, 29.85], 3, 60000],
    ["Heliopolis", [31.29, 30.13], 1, 15000],
    ["Elephantine", [32.89, 24.09], 1, 10000],
    ["Napata", [31.83, 18.54], 2, 15000], // seat of the Viceroy of Kush
    // — Egyptian Canaan and Upe —
    ["Gaza", [34.46, 31.5], 2, 15000], // Pharaoh's headquarters in Canaan
    ["Megiddo", [35.18, 32.58], 1, 10000],
    ["Hazor", [35.57, 33.02], 2, 20000],
    ["Urusalim", [35.22, 31.77], 1, 5000], // Jerusalem, a hill vassal
    ["Byblos", [35.65, 34.12], 2, 15000],
    ["Tyre", [35.2, 33.27], 2, 15000],
    ["Sidon", [35.37, 33.56], 1, 12000],
    ["Damascus", "Damascus", 1, 12000],
    // — Hatti and its Syrian viceroyalties —
    ["Hattusa", [34.62, 40.02], 4, 45000], // the Great King's citadel
    ["Carchemish", [38.02, 36.83], 2, 25000], // viceroyalty on the Euphrates
    ["Ugarit", [35.78, 35.6], 3, 35000], // the great trading port
    ["Kadesh", [36.51, 34.56], 1, 10000],
    ["Apasa", [27.34, 37.94], 1, 12000], // Ephesus; old Arzawa's seat
    ["Milawata", [27.28, 37.53], 1, 10000], // Miletus, Ahhiyawa's foothold
    // — Wilusa —
    ["Wilusa", [26.24, 39.96], 2, 10000], // Troy VII
    // — Mesopotamia and Elam —
    ["Assur", [43.26, 35.46], 3, 30000], // the Assyrian capital
    ["Nineveh", [43.15, 36.36], 2, 25000],
    ["Babylon", [44.42, 32.54], 4, 80000],
    ["Dur-Kurigalzu", [44.35, 33.35], 2, 20000], // the Kassite new city
    ["Nippur", [45.23, 32.13], 1, 12000],
    ["Ur", [46.1, 30.96], 1, 10000],
    ["Uruk", [45.64, 31.32], 1, 10000],
    ["Susa", [48.26, 32.19], 3, 30000], // the Elamite capital
    ["Anshan", [52.41, 30.01], 1, 8000],
    ["Dur-Untash", [48.53, 32.01], 1, 5000], // Chogha Zanbil ziggurat city
    // — The Aegean —
    ["Mycenae", [22.75, 37.73], 3, 30000], // Agamemnon's citadel
    ["Pylos", [21.7, 37.03], 1, 10000],
    ["Tiryns", [22.8, 37.6], 1, 10000],
    ["Athens", [23.73, 37.99], 1, 10000],
    ["Knossos", [25.16, 35.3], 2, 20000],
    ["Enkomi", [33.97, 35.14], 2, 15000], // Alashiya's copper port
    // — The Far East —
    ["Yin", [114.39, 36.1], 4, 120000], // Anyang, the Shang capital
    ["Zhengzhou", [113.65, 34.75], 2, 30000],
    ["Sanxingdui", [104.2, 31.0], 3, 30000], // the bronze-mask city of Shu
    // — The Americas —
    ["San Lorenzo", [-94.75, 17.75], 2, 12000], // the first Olmec center
    ["La Venta", [-94.03, 18.1], 1, 5000],
    ["Poverty Point", [-91.41, 32.63], 1, 3000], // the mound city on the Mississippi
  ],

  simulationRules:
    "It is roughly 1200 BC, the last high summer of the Late Bronze Age. Warfare is bronze " +
    "spears and composite bows; the decisive arm is the CHARIOT (treat 'armor' as chariotry) " +
    "with massed runners in support; navies are oared galleys; sieges are blockade and escalade " +
    "— there is NO iron weaponry at scale, NO cavalry, NO siege artillery, NO coinage (wealth " +
    "moves as grain, copper, tin, gold and cloth). Great-power diplomacy is the Amarna system: " +
    "the kings of Egypt, Hatti, Babylon, Assyria and Elam write to each other as 'brother', " +
    "exchange royal daughters and gifts, and jealously guard who may be called Great King. " +
    "Egypt and Hatti are at peace under the Treaty of Kadesh (1259 BC); Assyria under " +
    "Tukulti-Ninurta I is aggressive and has recently humbled Babylon; Elam is rising. The " +
    "system is FRAGILE: harvests are failing, tin routes are long, palace economies are " +
    "over-centralized. The Sea Peoples — displaced Aegean and Anatolian raiders — will begin " +
    "striking coasts within years; drought, earthquakes and migrations should steadily stress " +
    "every palace state (the historical Bronze Age Collapse, c. 1200-1150 BC). Mycenaean " +
    "palaces, Hattusa and Ugarit historically burned within fifty years; Egypt survives but is " +
    "diminished — the player may resist, redirect or exploit the collapse. Unclaimed regions " +
    "are tribal or stateless (Aramaean and Phrygian migrants, Sherden and Lukka sea-raiders, " +
    "steppe herders, Vedic clans in India, village Europe); they can be raided, settled or " +
    "federated but have no central government. Religion is polytheist everywhere: Amun-Ra and " +
    "the Aten's memory in Egypt, the Storm God of Hatti, Marduk in Babylon, Ashur in Assyria, " +
    "ancestor oracle-bones in Shang China. Dates are BCE and count DOWN (1200 BCE, then 1199 " +
    "BCE...); write dates as e.g. '1198 BCE'.",

  startingTimelineText:
    "The year is 1200 BCE. In Pi-Ramesses the court of Pharaoh still gleams — tribute barges " +
    "from Kush, cedar from Byblos, letters of brotherhood from Hattusa and Babylon written in " +
    "the scribes' cuneiform. The Treaty with Hatti has held for two generations; the garrisons " +
    "of Canaan collect their grain; the world of bronze seems eternal. But the reports darken " +
    "year by year: harvests fail in Anatolia and Hatti begs Egypt for grain ships; strange " +
    "sails — Sherden, Lukka, Peleset — harry the coasts; Aramaean herders press the Euphrates " +
    "towns; in the north the Assyrian king boasts of conquests and calls himself Great King. " +
    "Far beyond the horizon, oracle bones crack in the temples of Yin and stone heads rise in " +
    "the jungles of the Olmec. The old world has perhaps a generation left. What Pharaoh does " +
    "with it — history is waiting to find out.",
};
