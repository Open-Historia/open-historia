/*! Pax Historia — language setting & 200+ language catalog © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// UI language: stored once, read everywhere. "en" (the authored language)
// means no translation work happens at all.
const STORAGE_KEY = "ui_language";
export const DEFAULT_LANGUAGE = "en";

// Full ISO 639-1 set (bh dropped — deprecated in favor of bho below)...
const ISO_639_1 = [
  "aa","ab","ae","af","ak","am","an","ar","as","av","ay","az",
  "ba","be","bg","bi","bm","bn","bo","br","bs",
  "ca","ce","ch","co","cr","cs","cu","cv","cy",
  "da","de","dv","dz","ee","el","en","eo","es","et","eu",
  "fa","ff","fi","fj","fo","fr","fy",
  "ga","gd","gl","gn","gu","gv",
  "ha","he","hi","ho","hr","ht","hu","hy","hz",
  "ia","id","ie","ig","ii","ik","io","is","it","iu",
  "ja","jv","ka","kg","ki","kj","kk","kl","km","kn","ko","kr","ks","ku","kv","kw","ky",
  "la","lb","lg","li","ln","lo","lt","lu","lv",
  "mg","mh","mi","mk","ml","mn","mr","ms","mt","my",
  "na","nb","nd","ne","ng","nl","nn","no","nr","nv","ny",
  "oc","oj","om","or","os",
  "pa","pi","pl","ps","pt","qu",
  "rm","rn","ro","ru","rw",
  "sa","sc","sd","se","sg","si","sk","sl","sm","sn","so","sq","sr","ss","st","su","sv","sw",
  "ta","te","tg","th","ti","tk","tl","tn","to","tr","ts","tt","tw","ty",
  "ug","uk","ur","uz","ve","vi","vo","wa","wo","xh","yi","yo","za","zh","zu",
];

// ...plus widely spoken languages that only have 639-2/3 codes. Names are
// hardcoded because Intl.DisplayNames coverage for these varies by browser.
const EXTRA_LANGUAGES = {
  ace: "Acehnese",
  bcl: "Bikol",
  bho: "Bhojpuri",
  ceb: "Cebuano",
  ckb: "Kurdish (Sorani)",
  crh: "Crimean Tatar",
  doi: "Dogri",
  fil: "Filipino",
  gaa: "Ga",
  gom: "Konkani (Goan)",
  haw: "Hawaiian",
  hil: "Hiligaynon",
  hmn: "Hmong",
  ilo: "Ilocano",
  kaa: "Karakalpak",
  kbd: "Kabardian",
  lus: "Mizo",
  mai: "Maithili",
  min: "Minangkabau",
  mni: "Meitei (Manipuri)",
  pag: "Pangasinan",
  pam: "Kapampangan",
  sat: "Santali",
  tet: "Tetum",
  tpi: "Tok Pisin",
  war: "Waray",
};

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "dv", "ug", "yi", "ckb"]);

const displayNamesOf = (code, inLocale) => {
  try {
    const names = new Intl.DisplayNames([inLocale], { type: "language" });
    const name = names.of(code);
    return name && name !== code ? name : "";
  } catch {
    return "";
  }
};

export const languageDisplayName = (code) =>
  EXTRA_LANGUAGES[code] || displayNamesOf(code, "en") || code;

let optionsCache = null;

export const getLanguageOptions = () => {
  if (optionsCache) {
    return optionsCache;
  }

  const codes = [...ISO_639_1, ...Object.keys(EXTRA_LANGUAGES)];
  optionsCache = codes
    .map((code) => {
      const name = languageDisplayName(code);
      // Endonym so people can find their own language in the list.
      const nativeName = EXTRA_LANGUAGES[code] ? "" : displayNamesOf(code, code);
      return { code, name, nativeName: nativeName === name ? "" : nativeName };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  return optionsCache;
};

export const getStoredLanguage = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && stored.trim() ? stored.trim() : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
};

export const setStoredLanguage = (code) => {
  try {
    if (!code || code === DEFAULT_LANGUAGE) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, code);
    }
  } catch {
    // Private-mode storage failures just leave the game in English.
  }
};

export const isRtlLanguage = (code) => RTL_LANGUAGES.has(code);

// Appended to every AI system prompt (see callAI) so replies arrive in the
// player's language natively instead of being machine-translated after.
export const languageDirective = () => {
  const code = getStoredLanguage();
  if (code === DEFAULT_LANGUAGE) {
    return "";
  }

  const name = languageDisplayName(code);
  return (
    `LANGUAGE: The player's interface language is ${name} (${code}). ` +
    `Write ALL natural-language text in ${name} — prose replies, titles, descriptions, summaries, and suggestions. ` +
    `If the response must be JSON, keep the JSON structure, keys, ISO codes, and date formats exactly as specified, ` +
    `but write every human-readable string value in ${name}.`
  );
};
