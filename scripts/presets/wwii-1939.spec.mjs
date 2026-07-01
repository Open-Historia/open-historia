// World War II preset — 1 September 1939 (the day Germany invades Poland).
//
// Borders are approximated from modern admin-1 regions. We override only where
// 1939 differs from today: colonial empires fold into their mother country, the
// Axis annexations are applied, the 1939 USSR and Kingdom of Yugoslavia are
// unified. Independent states that existed in 1939 with ~modern borders are left
// alone (they keep their modern color/owner). Editorial choices are noted.
//
// Timing note: on 1 Sept 1939 the invasion is only beginning, so Poland is still
// whole; the Soviet invasion (17 Sept) and the Baltic/Bessarabian annexations
// (June 1940) have NOT happened yet — they live in simulationRules, not the map.

export default {
  id: "wwii-1939",

  meta: {
    name: "World War II — 1939",
    heroTitle: "World War II",
    heroSubtitle: "Europe on the eve of war, 1 September 1939",
    eyebrow: "Historical Preset",
    subtitle: "1 September 1939",
    accentColor: "#8a1f1f",
    description:
      "The world as the Wehrmacht crosses into Poland. The Axis is ascendant, the " +
      "colonial empires span the globe, and the United States stands neutral. Lead any " +
      "power through the deadliest conflict in human history.",
    // 1939 country names mostly still fit, so only relabel the German annexations
    // (Austria, the Czech lands) and a couple of period names. Colonies keep their
    // own names but share their empire's color.
    countryNameOverrides: { THA: "Siam", AUT: "Germany", CZE: "Germany" },
  },

  // Keep modern names except the hand-authored annexations above.
  relabelOwnedCountries: false,

  // Player starts as Germany. game.country MUST equal the owner code used below.
  game: { country: "GER", startDate: "1939-09-01", gameDate: "1939-09-01" },

  polities: {
    GER: { name: "Germany", color: "#3a3a3a", aliases: ["Third Reich", "German Reich", "Nazi Germany", "Deutsches Reich"] },
    SVK: { name: "Slovakia", color: "#9a9a4f", aliases: ["Slovak Republic"] },
    ITA: { name: "Italy", color: "#4f7942", aliases: ["Kingdom of Italy", "Fascist Italy"] },
    JAP: { name: "Japan", color: "#b23b3b", aliases: ["Empire of Japan", "Imperial Japan"] },
    MAN: { name: "Manchukuo", color: "#cc8844", aliases: ["Manchuria", "Manchukuo"] },
    SOV: { name: "Soviet Union", color: "#8b1a1a", aliases: ["USSR", "Soviet Union", "Soviet Russia"] },
    GBR: { name: "British Empire", color: "#c0507a", aliases: ["United Kingdom", "Britain", "Great Britain"] },
    FRA: { name: "French Republic", color: "#3f6fd0", aliases: ["France", "French Empire"] },
    NLD: { name: "Netherlands", color: "#e08a2e", aliases: ["Dutch Empire", "Holland"] },
    BEL: { name: "Belgium", color: "#b0902e", aliases: ["Belgian Empire"] },
    POR: { name: "Portugal", color: "#2e7d6b", aliases: ["Portuguese Empire", "Estado Novo"] },
    ESP: { name: "Spain", color: "#d0a02e", aliases: ["Spanish State"] },
    USA: { name: "United States", color: "#4a8f7a", aliases: ["America", "United States of America"] },
    YUG: { name: "Yugoslavia", color: "#6a8caf", aliases: ["Kingdom of Yugoslavia"] },
    ROU: { name: "Romania", color: "#c08a3a", aliases: ["Kingdom of Romania"] },
  },

  // Whole-country grants (every GID_1 of these modern GID_0 -> owner).
  countryAssignments: {
    // — Greater Germany: Anschluss (Austria) + the Czech lands (Protectorate).
    GER: ["DEU", "AUT", "CZE"],
    // Slovakia: a German client state, distinct from the Czech Protectorate.
    SVK: ["SVK"],
    // — Italian Empire: Libya, Italian East Africa (Ethiopia/Eritrea/Somaliland), Albania (occ. Apr 1939).
    ITA: ["ITA", "LBY", "ETH", "ERI", "SOM", "ALB"],
    // — Empire of Japan: Korea, Taiwan, and the South Seas (Pacific) Mandate.
    JAP: ["JPN", "KOR", "TWN", "MNP", "PLW", "MHL", "FSM"],
    // — Soviet Union (1939 republics; Baltics & Bessarabia NOT yet annexed).
    SOV: ["RUS", "UKR", "BLR", "KAZ", "GEO", "ARM", "AZE", "UZB", "TKM", "TJK", "KGZ"],
    // — British Empire: dominions + colonies + mandates (Éire is neutral, left out).
    GBR: [
      "GBR", "IND", "PAK", "BGD", "MMR", "LKA",
      "CAN", "AUS", "NZL", "ZAF", "NAM",
      "NGA", "GHA", "KEN", "UGA", "TZA", "ZMB", "ZWE", "MWI", "BWA", "LSO", "SWZ", "SDN", "SLE", "GMB",
      "GUY", "BLZ", "JAM", "TTO", "BHS", "BRB", "ATG", "DMA", "GRD", "KNA", "LCA", "CYM", "VGB", "TCA",
      "CYP", "MLT", "MYS", "SGP", "BRN", "JOR", "ISR", "PSE",
      "FJI", "SLB", "PNG", "MUS", "SYC",
    ],
    // — French Empire: North Africa, Levant mandates, Indochina, West/Equatorial Africa, islands.
    FRA: [
      "FRA", "DZA", "TUN", "MAR", "SYR", "LBN",
      "VNM", "LAO", "KHM",
      "SEN", "MLI", "CIV", "GIN", "BFA", "BEN", "NER", "TCD", "CAF", "COG", "GAB", "CMR", "MRT", "TGO",
      "MDG", "DJI", "COM",
      "GUF", "NCL", "PYF", "MYT", "REU", "GLP", "MTQ", "SPM", "WLF", "ATF",
    ],
    // — Dutch Empire.
    NLD: ["NLD", "IDN", "SUR"],
    // — Belgian Empire.
    BEL: ["BEL", "COD", "RWA", "BDI"],
    // — Portuguese Empire.
    POR: ["PRT", "AGO", "MOZ", "GNB", "CPV", "STP", "TLS"],
    // — Spanish State.
    ESP: ["ESP", "ESH", "GNQ"],
    // — United States + commonwealths/territories.
    USA: ["USA", "PHL", "PRI", "GUM", "VIR"],
    // — Kingdom of Yugoslavia (unified 1939).
    YUG: ["SRB", "HRV", "BIH", "MNE", "MKD", "SVN", "XKO"],
    // — Kingdom of Romania (incl. Bessarabia = modern Moldova, Romanian until 1940).
    ROU: ["ROU", "MDA"],
  },

  // Region-level exceptions (applied after, so they win).
  regionAssignments: {
    "LTU.3_1": "GER",   // Memelland (Klaipeda), annexed March 1939
    "CHN.HKG": "GBR",   // Hong Kong, British colony
    // Manchukuo — Japanese puppet state in northeast China (the three Manchurian provinces).
    "CHN.11_1": "MAN",  // Heilongjiang
    "CHN.17_1": "MAN",  // Jilin
    "CHN.18_1": "MAN",  // Liaoning
  },

  simulationRules:
    "It is 1 September 1939. Germany has just invaded Poland; Britain and France will " +
    "declare war within 48 hours, beginning the Second World War. The Molotov–Ribbentrop " +
    "Pact is in force: the USSR will invade eastern Poland on 17 September and is not yet a " +
    "belligerent. The Baltic states (Estonia, Latvia, Lithuania) and Romanian Bessarabia are " +
    "still independent/Romanian but will be pressured by the USSR in 1940. Italy is non-" +
    "belligerent until June 1940. The United States is neutral and isolationist. Japan is " +
    "bogged down in its war with China and holds Korea, Taiwan, Manchukuo and the Pacific " +
    "mandates. Technology and economy must reflect 1939: NO nuclear weapons (until 1945), " +
    "propeller aircraft, evolving armored/blitzkrieg doctrine, battleships and carriers at " +
    "sea. Colonial empires (British, French, Dutch, Belgian, Portuguese) are intact and " +
    "supply manpower and resources to their mother countries. Note that the map shows modern " +
    "province borders approximating 1939 control; the Polish Corridor, Danzig and the exact " +
    "Sudeten line are approximate.",

  startingTimelineText:
    "September 1939. At dawn the German battleship Schleswig-Holstein opens fire on the Polish " +
    "garrison at Westerplatte and 1.5 million Wehrmacht troops pour across the frontier behind " +
    "screaming Stukas and racing panzers — the first Blitzkrieg. In Berlin the swastika flies " +
    "over a Reich that has swallowed Austria, the Sudetenland and Bohemia. In London and Paris, " +
    "Chamberlain and Daladier honor their guarantee to Poland as the clocks run down to war. " +
    "Stalin waits in Moscow with a secret protocol in hand; Mussolini hesitates in Rome; Roosevelt " +
    "watches from a neutral America. The British and French empires still circle the globe in red " +
    "and blue. The world holds its breath.",
};
