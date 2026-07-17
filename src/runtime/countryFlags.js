/*! Open Historia — portions (flag lookup fixes) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Shared country-flag helpers.
//
// The map layers (GADM) identify countries by GID_0, an ISO 3166-1 alpha-3 code.
// Flag images are served by flagcdn.com keyed on the alpha-2 code, and flag
// emoji are built from that alpha-2 code's regional-indicator letters. These
// replace restcountries.com, whose public API was deprecated and no longer
// returns flag data.
//
// nameToAlpha2 is generated from server/country-names.json by
// scripts/generate-name-to-alpha2.mjs, and is committed — see that script for why
// it derives the table from the real lookup below rather than restating it.
import NAME_TO_ALPHA2 from "./generated/nameToAlpha2.js";

// ISO 3166-1 alpha-3 -> alpha-2.
const ISO3_TO_ISO2 = {
    ABW: "AW", AFG: "AF", AGO: "AO", AIA: "AI", ALA: "AX", ALB: "AL", AND: "AD", ARE: "AE", ARG: "AR",
    ARM: "AM", ASM: "AS", ATA: "AQ", ATF: "TF", ATG: "AG", AUS: "AU", AUT: "AT", AZE: "AZ",
    BDI: "BI", BEL: "BE", BEN: "BJ", BES: "BQ", BFA: "BF", BGD: "BD", BGR: "BG", BHR: "BH",
    BHS: "BS", BIH: "BA", BLM: "BL", BLR: "BY", BLZ: "BZ", BMU: "BM", BOL: "BO", BRA: "BR", BRB: "BB",
    BRN: "BN", BTN: "BT", BVT: "BV", BWA: "BW", CAF: "CF", CAN: "CA", CHE: "CH", CHL: "CL",
    CHN: "CN", CIV: "CI", CMR: "CM", COD: "CD", COG: "CG", COK: "CK", COL: "CO", COM: "KM",
    CPV: "CV", CRI: "CR", CUB: "CU", CUW: "CW", CYM: "KY", CYP: "CY", CZE: "CZ", DEU: "DE",
    DJI: "DJ", DMA: "DM", DNK: "DK", DOM: "DO", DZA: "DZ", ECU: "EC", EGY: "EG", ERI: "ER",
    ESH: "EH", ESP: "ES", EST: "EE", ETH: "ET", FIN: "FI", FJI: "FJ", FLK: "FK", FRA: "FR",
    FRO: "FO", FSM: "FM", GAB: "GA", GBR: "GB", GEO: "GE", GGY: "GG", GHA: "GH", GIN: "GN",
    GLP: "GP", GMB: "GM", GNB: "GW", GNQ: "GQ", GRC: "GR", GRD: "GD", GRL: "GL", GTM: "GT",
    GUF: "GF", GUM: "GU", GUY: "GY", HKG: "HK", HMD: "HM", HND: "HN", HRV: "HR", HTI: "HT",
    HUN: "HU", IDN: "ID", IMN: "IM", IND: "IN", IRL: "IE", IRN: "IR", IRQ: "IQ", ISL: "IS",
    ISR: "IL", ITA: "IT", JAM: "JM", JEY: "JE", JOR: "JO", JPN: "JP", KAZ: "KZ", KEN: "KE",
    KGZ: "KG", KHM: "KH", KIR: "KI", KNA: "KN", KOR: "KR", KWT: "KW", LAO: "LA", LBN: "LB",
    LBR: "LR", LBY: "LY", LCA: "LC", LIE: "LI", LKA: "LK", LSO: "LS", LTU: "LT", LUX: "LU",
    LVA: "LV", MAC: "MO", MAR: "MA", MCO: "MC", MDA: "MD", MDG: "MG", MDV: "MV", MEX: "MX",
    MHL: "MH", MKD: "MK", MLI: "ML", MLT: "MT", MMR: "MM", MNE: "ME", MNG: "MN", MNP: "MP", MSR: "MS",
    MOZ: "MZ", MRT: "MR", MTQ: "MQ", MUS: "MU", MWI: "MW", MYS: "MY", MYT: "YT", NAM: "NA",
    NCL: "NC", NER: "NE", NGA: "NG", NIC: "NI", NLD: "NL", NOR: "NO", NPL: "NP", NRU: "NR",
    NZL: "NZ", OMN: "OM", PAK: "PK", PAN: "PA", PER: "PE", PHL: "PH", PLW: "PW", PNG: "PG",
    POL: "PL", PRI: "PR", PRK: "KP", PRT: "PT", PRY: "PY", PSE: "PS", PYF: "PF", QAT: "QA",
    REU: "RE", ROU: "RO", RUS: "RU", RWA: "RW", SAU: "SA", SDN: "SD", SEN: "SN", SGP: "SG",
    SGS: "GS", SHN: "SH", SJM: "SJ", SLB: "SB", SLE: "SL", SLV: "SV", SMR: "SM", SOM: "SO",
    SPM: "PM", SRB: "RS", SSD: "SS", STP: "ST", SUR: "SR", SVK: "SK", SVN: "SI", SWE: "SE",
    SWZ: "SZ", SYC: "SC", SYR: "SY", TCA: "TC", TCD: "TD", TGO: "TG", THA: "TH", TJK: "TJ",
    TKL: "TK", TKM: "TM", TLS: "TL", TON: "TO", TTO: "TT", TUN: "TN", TUR: "TR", TUV: "TV", TWN: "TW",
    TZA: "TZ", UGA: "UG", UKR: "UA", UMI: "UM", URY: "UY", USA: "US", UZB: "UZ", VAT: "VA", VCT: "VC",
    VEN: "VE", VGB: "VG", VIR: "VI", VNM: "VN", VUT: "VU", WLF: "WF", WSM: "WS", XKO: "XK",
    YEM: "YE", ZAF: "ZA", ZMB: "ZM", ZWE: "ZW",
};

// GADM assigns placeholder codes (Z01..Z09) to disputed border areas; show the
// flag of the administering / claiming country instead.
const DISPUTED_TERRITORY_PARENT = {
    Z01: "IND", Z02: "CHN", Z03: "CHN", Z04: "IND", Z05: "IND",
    Z06: "PAK", Z07: "IND", Z08: "CHN", Z09: "IND",
};

const SPECIAL_TERRITORY_PARENT = {
    XAD: "GBR",
    ZNC: "TUR",
};

// Resolve an owner to a lowercase ISO 3166-1 alpha-2 code, or null.
//
// Takes a country NAME ("Russia") or a GID_0 code ("RUS"). The name path has to
// exist because a region's owner is its name now, and 5 of the 7 flag call sites
// hand this the owner — including game.country, which has no code sibling to fall
// back on. The code path stays: the pmtiles carry GID_0 forever, so chat.jsx and
// anything reading tile properties still arrive here with a code.
//
// Order is name-then-code and the two can't collide: names are lowercased keys
// ("russia"), codes are uppercased ("RUS"), and no country is named after a
// three-letter code.
export const gidToAlpha2 = (owner) => {
    if (!owner) return null;
    const raw = String(owner).trim();
    const byName = NAME_TO_ALPHA2[raw.toLowerCase()];
    if (byName) return byName;
    const code = raw.toUpperCase();
    const iso3 = DISPUTED_TERRITORY_PARENT[code] ?? SPECIAL_TERRITORY_PARENT[code] ?? code;
    const alpha2 = ISO3_TO_ISO2[iso3];
    return alpha2 ? alpha2.toLowerCase() : null;
};

// flagcdn.com SVG flag URL for a GID_0 code, or null if unknown.
export const flagImageUrlFromGid = (gid0) => {
    const alpha2 = gidToAlpha2(gid0);
    return alpha2 ? `https://flagcdn.com/${alpha2}.svg` : null;
};

// Every country the game can already draw a flag for — the browsable set behind the
// editor's flag picker. Derived from the table above rather than a second list, so
// the two can't drift. Sorted by code for a stable grid.
export const listBuiltInFlags = () =>
    Object.entries(ISO3_TO_ISO2)
        .map(([iso3, alpha2]) => ({
            code: iso3,
            alpha2: alpha2.toLowerCase(),
            imageUrl: `https://flagcdn.com/${alpha2.toLowerCase()}.svg`,
        }))
        .sort((a, b) => a.code.localeCompare(b.code));

// Regional-indicator flag emoji (e.g. "us" -> 🇺🇸) for a GID_0 code, or null.
export const flagEmojiFromGid = (gid0) => {
    const alpha2 = gidToAlpha2(gid0);
    if (!alpha2) return null;
    return alpha2
        .toUpperCase()
        .replace(/./g, (ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65));
};
