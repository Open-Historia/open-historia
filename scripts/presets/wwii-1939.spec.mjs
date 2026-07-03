/*! Open Historia — WWII 1939 scenario preset © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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
    coverImage: "public/loading_screen_2.jpg",
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

  // 1939 is near-modern: countries the spec does not assign (Mexico, Brazil,
  // Turkey, Iran, Sweden...) were real sovereign states and keep their modern
  // owner on the map instead of rendering as unclaimed land.
  unassignedKeepModernOwner: true,

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
    CHI: { name: "Republic of China", color: "#4a6db5", aliases: ["China", "Nationalist China", "Kuomintang"] },
    MON: { name: "Mongolian People's Republic", color: "#a85454", aliases: ["Mongolia", "Outer Mongolia"] },
    DAN: { name: "Denmark", color: "#8a5f6d", aliases: ["Kingdom of Denmark"] },
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
    // — British Empire: dominions + colonies + mandates + Gulf protectorates
    //   (Éire is neutral, left out; Egypt, Iraq and Nepal are treaty-bound but
    //   independent and keep their own governments).
    GBR: [
      "GBR", "IND", "PAK", "BGD", "MMR", "LKA",
      "CAN", "AUS", "NZL", "ZAF", "NAM",
      "NGA", "GHA", "KEN", "UGA", "TZA", "ZMB", "ZWE", "MWI", "BWA", "LSO", "SWZ", "SDN", "SLE", "GMB",
      "GUY", "BLZ", "JAM", "TTO", "BHS", "BRB", "ATG", "DMA", "GRD", "KNA", "LCA", "CYM", "VGB", "TCA",
      "CYP", "MLT", "MYS", "SGP", "BRN", "JOR", "ISR", "PSE",
      "BHR", "QAT", "ARE", "KWT",
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
    // — Republic of China (Japanese-occupied east carved out below).
    CHI: ["CHN"],
    // — Mongolian People's Republic: a Soviet satellite (Khalkhin Gol is being
    //   fought on its border this very month).
    MON: ["MNG"],
    // — Kingdom of Denmark: Greenland and the Faroes (Iceland is a sovereign
    //   kingdom in personal union and keeps its own government).
    DAN: ["DNK", "GRL", "FRO"],
  },

  // Region-level exceptions (applied after, so they win).
  regionAssignments: {
    "LTU.3_1": "GER",   // Memelland (Klaipeda), annexed March 1939
    "CHN.HKG": "GBR",   // Hong Kong, British colony
    // Manchukuo — Japanese puppet state in northeast China (the three Manchurian provinces).
    "CHN.11_1": "MAN",  // Heilongjiang
    "CHN.17_1": "MAN",  // Jilin
    "CHN.18_1": "MAN",  // Liaoning
    // Japanese-occupied China, Sept 1939 (two years into the Second Sino-Japanese
    // War): the northern plain, the lower Yangtze, the Canton coast and Hainan.
    // Free China (Chungking) holds the interior.
    "CHN.2_1": "JAP",   // Beijing
    "CHN.27_1": "JAP",  // Tianjin
    "CHN.10_1": "JAP",  // Hebei
    "CHN.25_1": "JAP",  // Shanxi
    "CHN.23_1": "JAP",  // Shandong
    "CHN.15_1": "JAP",  // Jiangsu (Nanking)
    "CHN.24_1": "JAP",  // Shanghai
    "CHN.31_1": "JAP",  // Zhejiang (north)
    "CHN.13_1": "JAP",  // Hubei (Wuhan, fell Oct 1938)
    "CHN.6_1": "JAP",   // Guangdong (Canton, fell Oct 1938)
    "CHN.9_1": "JAP",   // Hainan (occupied Feb 1939)
    "CHN.19_1": "JAP",  // Nei Mongol (Mengjiang puppet regime)
    // British Somaliland (the north of modern Somalia; the rest is Italian).
    "SOM.1_1": "GBR",   // Awdal
    "SOM.18_1": "GBR",  // Woqooyi Galbeed (Hargeisa)
    "SOM.17_1": "GBR",  // Togdheer
    "SOM.13_1": "GBR",  // Sanaag
    "SOM.16_1": "GBR",  // Sool
    // Aden Colony + the Aden Protectorates (southern/eastern Yemen); the north
    // stays the independent Mutawakkilite Kingdom of Yemen.
    "YEM.1_1": "GBR",   // 'Adan
    "YEM.15_1": "GBR",  // Lahij
    "YEM.2_1": "GBR",   // Abyan
    "YEM.4_1": "GBR",   // Al Dali'
    "YEM.20_1": "GBR",  // Shabwah
    "YEM.12_1": "GBR",  // Hadramawt
    "YEM.7_1": "GBR",   // Al Mahrah
  },

  // Era cities: [name, modern-seed-name | [lng,lat], tier, population].
  // tier 4 = great-power capital ★, 3 = major city ◆, 2 = city, 1 = town.
  // Names and populations as of 1939 (Danzig, Königsberg, Leningrad, Batavia...).
  cities: [
    // — Europe —
    ["Berlin", "Berlin", 4, 4339000],
    ["Hamburg", "Hamburg", 3, 1712000],
    ["Munich", "Munich", 2, 829000],
    ["Cologne", "Cologne", 2, 772000],
    ["Vienna", "Vienna", 3, 1918000], // annexed, 1938
    ["Prague", "Prague", 2, 962000], // Protectorate of Bohemia-Moravia
    ["Danzig", "Gdańsk", 2, 400000], // the Free City — the war's first prize
    ["Königsberg", "Kaliningrad", 2, 372000],
    ["Breslau", "Wrocław", 2, 630000],
    ["Warsaw", "Warsaw", 3, 1289000],
    ["London", "London", 4, 8615000],
    ["Manchester", "Manchester", 2, 736000],
    ["Glasgow", [-4.25, 55.86], 2, 1128000],
    ["Paris", "Paris", 4, 2830000],
    ["Marseille", "Marseille", 2, 914000],
    ["Rome", "Rome", 4, 1284000],
    ["Milan", "Milan", 3, 1116000],
    ["Naples", "Naples", 2, 866000],
    ["Madrid", "Madrid", 3, 1048000], // Franco's Spain, war just ended
    ["Barcelona", "Barcelona", 2, 1081000],
    ["Lisbon", "Lisbon", 2, 594000],
    ["Amsterdam", "Amsterdam", 2, 800000],
    ["Brussels", [4.35, 50.85], 2, 913000],
    ["Bern", [7.45, 46.95], 1, 122000],
    ["Copenhagen", "Copenhagen", 2, 700000],
    ["Oslo", "Oslo", 2, 276000],
    ["Stockholm", "Stockholm", 2, 570000],
    ["Helsinki", "Helsinki", 2, 291000],
    ["Tallinn", "Tallinn", 1, 145000],
    ["Riga", "Riga", 2, 385000],
    ["Kaunas", "Kaunas", 1, 152000], // interwar Lithuanian capital
    ["Budapest", "Budapest", 3, 1163000],
    ["Bucharest", "Bucharest", 2, 870000],
    ["Belgrade", "Belgrade", 2, 320000],
    ["Sofia", "Sofia", 2, 401000],
    ["Athens", "Athens", 2, 481000],
    ["Dublin", "Dublin", 1, 472000],
    // — Soviet Union —
    ["Moscow", "Moscow", 4, 4137000],
    ["Leningrad", [30.32, 59.94], 3, 3191000],
    ["Stalingrad", "Volgograd", 2, 445000],
    ["Kiev", "Kyiv", 2, 847000],
    ["Kharkov", "Kharkiv", 2, 833000],
    ["Minsk", "Minsk", 2, 239000],
    ["Odessa", "Odesa", 2, 604000],
    ["Baku", "Baku", 2, 809000], // the oil fields
    ["Tbilisi", "Tbilisi", 1, 519000],
    ["Tashkent", "Tashkent", 2, 585000],
    ["Novosibirsk", "Novosibirsk", 1, 404000],
    ["Vladivostok", "Vladivostok", 1, 206000],
    // — Middle East and Africa —
    ["Istanbul", "Istanbul", 3, 793000],
    ["Ankara", "Ankara", 2, 157000],
    ["Tehran", "Tehran", 2, 540000],
    ["Baghdad", "Baghdad", 2, 400000],
    ["Jerusalem", "Jerusalem", 1, 132000], // British Mandate
    ["Cairo", "Cairo", 3, 1312000],
    ["Alexandria", "Alexandria", 2, 686000],
    ["Tripoli", "Tripoli", 1, 111000], // Italian Libya
    ["Algiers", "Algiers", 2, 252000],
    ["Casablanca", "Casablanca", 2, 257000],
    ["Dakar", "Dakar", 1, 92000],
    ["Lagos", "Lagos", 1, 167000],
    ["Léopoldville", "Kinshasa", 1, 46000], // Belgian Congo
    ["Nairobi", "Nairobi", 1, 61000],
    ["Addis Ababa", "Addis Ababa", 2, 300000], // occupied Italian East Africa
    ["Johannesburg", "Johannesburg", 2, 500000],
    ["Cape Town", "Cape Town", 2, 344000],
    // — Asia —
    ["Tokyo", "Tokyo", 4, 6779000],
    ["Osaka", "Ōsaka", 3, 3252000],
    ["Kyoto", [135.77, 35.01], 2, 1090000],
    ["Hiroshima", "Hiroshima", 1, 344000],
    ["Keijo", "Seoul", 2, 774000], // colonial Seoul
    ["Hsinking", [125.32, 43.88], 2, 415000], // capital of Manchukuo
    ["Mukden", "Shenyang", 2, 863000],
    ["Peiping", "Beijing", 3, 1556000], // occupied
    ["Tientsin", "Tianjin", 3, 1210000], // occupied
    ["Shanghai", "Shanghai", 4, 3727000], // occupied — the foreign concessions remain
    ["Nanking", "Nanjing", 2, 700000], // occupied
    ["Chungking", "Chongqing", 3, 635000], // Free China's wartime capital
    ["Canton", "Guangzhou", 2, 1122000], // occupied
    ["Hong Kong", "Hong Kong", 2, 1050000],
    ["Hanoi", "Hanoi", 2, 149000], // French Indochina
    ["Saigon", "Ho Chi Minh City", 2, 256000],
    ["Bangkok", "Bangkok", 2, 681000],
    ["Rangoon", [96.16, 16.87], 2, 400000], // British Burma
    ["Singapore", "Singapore", 2, 728000], // the fortress
    ["Batavia", "Jakarta", 2, 533000], // Dutch East Indies capital
    ["Manila", "Manila", 2, 623000], // U.S. Commonwealth
    ["Delhi", "Delhi", 3, 522000], // capital of the British Raj
    ["Bombay", "Mumbai", 3, 1490000],
    ["Calcutta", [88.36, 22.57], 3, 2109000],
    ["Karachi", "Karachi", 2, 387000],
    ["Colombo", "Colombo", 1, 362000],
    // — The Americas —
    ["New York", "New York", 4, 7455000],
    ["Washington", [-77.04, 38.91], 3, 663000],
    ["Chicago", "Chicago", 3, 3397000],
    ["Detroit", "Detroit", 2, 1623000],
    ["Los Angeles", "Los Angeles", 3, 1504000],
    ["San Francisco", "San Francisco", 2, 635000],
    ["Honolulu", "Honolulu", 1, 179000],
    ["Ottawa", "Ottawa", 2, 155000],
    ["Toronto", "Toronto", 2, 667000],
    ["Montreal", "Montréal", 2, 903000],
    ["Vancouver", "Vancouver", 1, 275000],
    ["Mexico City", "Mexico City", 3, 1560000],
    ["Havana", "Havana", 2, 570000],
    ["Caracas", "Caracas", 1, 269000],
    ["Bogotá", "Bogotá", 1, 330000],
    ["Lima", "Lima", 2, 533000],
    ["Santiago", "Santiago", 2, 952000],
    ["Buenos Aires", "Buenos Aires", 3, 2400000],
    ["Montevideo", "Montevideo", 2, 700000],
    ["Rio de Janeiro", "Rio de Janeiro", 3, 1764000],
    ["São Paulo", "São Paulo", 3, 1258000],
    // — Oceania —
    ["Sydney", "Sydney", 2, 1302000],
    ["Melbourne", "Melbourne", 2, 1046000],
    ["Canberra", "Canberra", 1, 11000],
    ["Wellington", "Wellington", 1, 158000],
    ["Auckland", "Auckland", 1, 221000],
  ],

  simulationRules:
    "It is 1 September 1939. Germany has just invaded Poland; Britain and France will " +
    "declare war within 48 hours, beginning the Second World War. The Molotov–Ribbentrop " +
    "Pact is in force: the USSR will invade eastern Poland on 17 September and is not yet a " +
    "belligerent. The Baltic states (Estonia, Latvia, Lithuania) and Romanian Bessarabia are " +
    "still independent/Romanian but will be pressured by the USSR in 1940. Italy is non-" +
    "belligerent until June 1940. The United States is neutral and isolationist. Japan is two " +
    "years into its war with the Republic of China: it holds Korea, Taiwan, Manchukuo, the " +
    "Pacific mandates and occupied eastern China (the northern plain, the lower Yangtze, " +
    "Canton and Hainan), while Chiang Kai-shek's Nationalists fight on from Chungking in the " +
    "interior, with Communist guerrillas active behind Japanese lines. Mongolia is a Soviet " +
    "satellite where Zhukov is beating the Japanese at Khalkhin Gol this very month. " +
    "Technology and economy must reflect 1939: NO nuclear weapons (until 1945), " +
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
