/*! Open Historia — 117 AD preset spec © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Classical preset — 117 AD (Rome at its zenith).
//
// August 117: Trajan dies at Selinus and Hadrian takes the purple. The empire
// stands at its greatest territorial extent — Dacia, Armenia and Mesopotamia
// annexed, Parthia humbled. Han China rules the far east, the Kushans bridge
// the Silk Road, and beyond the Rhine-Danube line stretch the free peoples.
// Vast tracts of the world (Germania, Sarmatia, Arabia Deserta, inner Africa,
// the Americas) belong to no state at all and are left deliberately unclaimed.

export default {
  id: "roman-117",

  meta: {
    name: "Rome — 117 AD",
    heroTitle: "The Empire at its Zenith",
    heroSubtitle: "Trajan is dead. Hadrian inherits the greatest empire the west has known.",
    eyebrow: "Historical Preset",
    subtitle: "117 AD",
    accentColor: "#a31c1c",
    coverImage: "public/loading_screen_3.jpg",
    description:
      "The year 117. Rome rules from the Atlantic to the Tigris — Dacia conquered, Armenia " +
      "and Mesopotamia annexed, Parthia beaten but unbowed. In the east the Han emperor holds " +
      "the Mandate of Heaven and the Kushan kings tax the Silk Road between them. Beyond the " +
      "frontiers lie the free peoples: Germania, Caledonia, the steppe. Rule an empire at its " +
      "high-water mark — or the powers that wait for it to recede.",
  },

  // Player starts as Rome. game.country MUST equal the owner code.
  game: { country: "ROM", startDate: "0117-01-01", gameDate: "0117-01-01" },

  // No air power in antiquity; "armor" is heavy cavalry (cataphracts), "artillery"
  // is siege engines (ballistae, onagers).
  allowedUnitTypes: ["infantry", "armor", "artillery", "naval", "garrison"],

  // Modern names are wholesale anachronistic in 117 — relabel owned countries.
  relabelOwnedCountries: true,

  polities: {
    ROM:  { name: "Roman Empire", color: "#a31c1c", aliases: ["Rome", "SPQR", "the Empire"] },
    PART: { name: "Parthian Empire", color: "#8a6d3b", aliases: ["Parthia", "Arsacids"] },
    KUSH: { name: "Kushan Empire", color: "#c07830", aliases: ["Kushans", "Kusana"] },
    HAN:  { name: "Han Dynasty", color: "#b8860b", aliases: ["Han China", "Eastern Han", "China"] },
    XION: { name: "Xiongnu", color: "#7a5c8a", aliases: ["Northern Xiongnu", "the steppe confederacy"] },
    GOGU: { name: "Goguryeo", color: "#4a7a9a", aliases: ["Koguryo"] },
    AKSM: { name: "Kingdom of Aksum", color: "#3f7a4f", aliases: ["Axum", "Aksumite Empire"] },
    MERO: { name: "Kingdom of Kush", color: "#9a6a3a", aliases: ["Meroe", "Nubia"] },
    HIMY: { name: "Himyarite Kingdom", color: "#6a8a3a", aliases: ["Himyar", "Arabia Felix"] },
    ANUR: { name: "Anuradhapura", color: "#5a9a8a", aliases: ["Ceylon", "Lanka"] },
    IBER: { name: "Kingdom of Iberia", color: "#6a9ac0", aliases: ["Caucasian Iberia", "Kartli"] },
    FUNA: { name: "Funan", color: "#b09a4a", aliases: ["Nokor Phnom"] },
    CALE: { name: "Caledonian Tribes", color: "#5a7a5a", aliases: ["Caledonia", "the Picts' forebears"] },
  },

  countryAssignments: {
    // — The Roman world at maximum extent —
    ROM: [
      "ESP", "PRT", "FRA", "BEL", "LUX", "CHE", "ITA", "AUT", "SVN", "HRV",
      "BIH", "SRB", "MNE", "MKD", "ALB", "GRC", "BGR", "ROU", "HUN", "XKO",
      "MLT", "CYP", "TUR", "SYR", "LBN", "ISR", "PSE", "JOR", "EGY", "LBY",
      "TUN", "DZA", "MAR", "IRQ", "ARM", "GBR",
    ],
    // — The rival great powers —
    PART: ["IRN", "TKM"],
    KUSH: ["AFG", "PAK", "UZB", "TJK"],
    HAN:  ["CHN", "VNM"],               // Jiaozhi (northern Vietnam) was a Han commandery
    // — Steppe, Korea, Africa, Arabia, Ceylon, SE Asia —
    XION: ["MNG"],
    GOGU: ["PRK"],
    AKSM: ["ERI", "ETH"],
    MERO: ["SDN"],
    HIMY: ["YEM"],
    ANUR: ["LKA"],
    IBER: ["GEO"],
    FUNA: ["KHM"],
    // Everything else — Germania, Scandinavia, Sarmatia, Arabia Deserta, inner
    // Africa, India's warring kingdoms, Japan, the Americas — is unclaimed land.
  },

  regionAssignments: {
    // Caledonia: never Roman — carve Scotland out of Roman Britannia.
    "GBR.3_1": "CALE",
  },

  // Era cities: [name, modern-seed-name | [lng,lat], tier, population].
  // tier 4 = imperial capital ★, 3 = great city ◆, 2 = city, 1 = town.
  // Populations are the usual scholarly estimates for the early 2nd century.
  cities: [
    // — The Roman Empire —
    ["Roma", "Rome", 4, 1000000],
    ["Alexandria", "Alexandria", 3, 500000],
    ["Antiochia", [36.16, 36.2], 3, 250000],
    ["Carthago", [10.32, 36.85], 3, 150000],
    ["Ephesus", [27.34, 37.94], 2, 150000],
    ["Pergamum", [27.18, 39.13], 2, 120000],
    ["Smyrna", [27.14, 38.43], 2, 90000],
    ["Corinthus", [22.93, 37.94], 2, 80000],
    ["Athenae", "Athens", 2, 75000],
    ["Thessalonica", [22.94, 40.64], 2, 65000],
    ["Byzantium", "Istanbul", 2, 40000],
    ["Nicomedia", [29.92, 40.77], 2, 60000],
    ["Ancyra", "Ankara", 1, 25000],
    ["Londinium", "London", 2, 30000],
    ["Eboracum", [-1.08, 53.96], 1, 5000],
    ["Lutetia", "Paris", 1, 8000],
    ["Lugdunum", "Lyon", 2, 50000],
    ["Massilia", "Marseille", 2, 40000],
    ["Burdigala", "Bordeaux", 1, 20000],
    ["Colonia Agrippina", "Cologne", 2, 30000],
    ["Mediolanum", "Milan", 2, 40000],
    ["Ravenna", "Ravenna", 2, 20000],
    ["Aquileia", [13.37, 45.77], 2, 30000],
    ["Syracusae", [15.29, 37.07], 2, 60000],
    ["Tarraco", "Tarragona", 2, 30000],
    ["Corduba", [-4.78, 37.89], 2, 50000],
    ["Gades", [-6.29, 36.53], 2, 50000],
    ["Emerita Augusta", [-6.34, 38.92], 1, 25000],
    ["Tingis", "Tangier", 1, 15000],
    ["Volubilis", [-5.55, 34.07], 1, 12000],
    ["Leptis Magna", [14.29, 32.64], 2, 80000],
    ["Cyrene", [21.86, 32.82], 2, 50000],
    ["Memphis", [31.25, 29.85], 2, 60000],
    ["Hierosolyma", "Jerusalem", 1, 10000],
    ["Caesarea", [34.89, 32.5], 2, 45000],
    ["Damascus", "Damascus", 2, 45000],
    ["Palmyra", [38.28, 34.55], 2, 30000],
    ["Petra", [35.44, 30.32], 2, 20000],
    ["Sarmizegetusa", [22.79, 45.52], 2, 15000],
    ["Artaxata", [44.55, 39.88], 2, 30000],
    ["Ctesiphon", [44.58, 33.09], 3, 250000], // taken by Trajan, 116
    // — Parthia and the Iranian east —
    ["Ecbatana", [48.52, 34.8], 2, 60000],
    ["Susa", [48.26, 32.19], 1, 25000],
    ["Merv", [62.19, 37.66], 2, 50000],
    // — The Kushan realm and India —
    ["Purushapura", "Peshawar", 3, 100000],
    ["Taxila", [72.79, 33.74], 2, 40000],
    ["Mathura", "Mathura", 2, 60000],
    ["Pataliputra", "Patna", 3, 150000],
    ["Ujjain", "Ujjain", 2, 80000],
    ["Madurai", "Madurai", 2, 50000],
    ["Anuradhapura", "Anuradhapura", 3, 60000],
    // — Han China and East Asia —
    ["Luoyang", "Luoyang", 4, 500000],
    ["Chang'an", [108.94, 34.34], 3, 250000],
    ["Chengdu", "Chengdu", 2, 100000],
    ["Panyu", "Guangzhou", 2, 50000],
    ["Longbian", "Hanoi", 1, 20000],
    ["Gungnae", [126.19, 41.16], 2, 20000], // Goguryeo capital
    // — Africa, Arabia, the Caucasus —
    ["Meroe", [33.75, 16.94], 3, 25000],
    ["Aksum", [38.72, 14.13], 3, 20000],
    ["Zafar", [44.4, 14.21], 2, 15000], // Himyarite capital
    ["Mtskheta", [44.72, 41.84], 2, 15000], // Iberian capital
    // — Funan and the Americas —
    ["Vyadhapura", [105.15, 10.25], 2, 20000], // Funan (Oc Eo)
    ["Teotihuacan", [-98.84, 19.69], 3, 125000],
    ["Tikal", [-89.62, 17.22], 2, 40000],
    ["Monte Alban", [-96.77, 17.04], 1, 17000],
  ],

  simulationRules:
    "It is 117 AD, the high-water mark of Rome. Warfare is classical: legions and auxilia, " +
    "disciplined heavy infantry, cataphract and horse-archer cavalry, siege engines, war " +
    "galleys; there is NO gunpowder and NO air power. Trajan has just died (August 117) and " +
    "Hadrian is newly acclaimed; historically he abandoned Mesopotamia and Armenia within a " +
    "year — whether this Rome consolidates or retrenches is the player's choice. Parthia is " +
    "beaten but intact beyond the Zagros and will contest Mesopotamia. The Kitos War (Jewish " +
    "diaspora revolt, 115-117) is being suppressed in Egypt, Cyprus and Cyrenaica. Britain is " +
    "held to the Solway-Tyne line; Caledonia is free, as is all Germania beyond Rhine and " +
    "Danube, and the Sarmatian steppe. Han China under the young Emperor An rules through " +
    "regents and protects the Western Regions; the Kushans tax the Silk Road between Parthia " +
    "and Han; the Xiongnu press the steppe. Aksum and Himyar contest the Red Sea trade; Meroe " +
    "trades and skirmishes with Roman Egypt. India is a patchwork of contending kingdoms " +
    "(Satavahanas, Western Satraps, Cheras/Cholas/Pandyas) — treat it as fragmented, not " +
    "empty. Unclaimed regions are tribal or stateless lands: they can be raided, colonized or " +
    "federated but have no central government. Religion is pre-Christian: the imperial cult, " +
    "Hellenic and eastern mysteries, Zoroastrianism in Parthia, Buddhism spreading through " +
    "Kushan lands into Han China.",

  startingTimelineText:
    "August, 117 AD. Word races along the imperial post roads: Trajan, Optimus Princeps, " +
    "conqueror of Dacia and Ctesiphon, is dead at Selinus in Cilicia. In Antioch the armies " +
    "hail his ward Hadrian as emperor. The empire he inherits has never been larger — the " +
    "eagle standards stand on the Tigris, in Armenia, on the Dacian gold fields — and never " +
    "more overstretched. Mesopotamia seethes, the Jewish revolt smolders from Cyrene to " +
    "Cyprus, and the legions watch the Parthian king gather his cataphracts for a reckoning. " +
    "Far to the east, the boy-emperor of Han rules through his regents while the Kushan lords " +
    "of the Silk Road grow rich carrying silk west and gold east. Beyond every frontier wait " +
    "the free peoples — Germans, Sarmatians, Caledonians — patient as winter. An age of " +
    "marble and iron reaches its noon; what follows noon is the emperor's to decide.",
};
