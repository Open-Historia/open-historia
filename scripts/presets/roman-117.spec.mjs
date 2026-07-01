/*! Pax Historia — 117 AD preset spec © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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
