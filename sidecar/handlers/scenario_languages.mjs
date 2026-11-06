import fs from "node:fs";
import path from "node:path";

const DEFAULT_CODES = Object.freeze(["de", "es", "fr", "pt", "ru", "zh"]);
const CARD_FIELDS = Object.freeze(["name", "heroTitle", "eyebrow", "subtitle", "heroSubtitle", "description"]);
const STRINGS_SHOWN = 60;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const register = (ctx) => {
  const { engine, emit, plain, clean, list, repo, storage, addStandIn, standIn } = ctx;
  const packs = () => engine.scenarioLangPacks;
  const i18n = () => engine.shellI18n;
  const opened = new Map();
  const shipped = new Map();
  let running = null;

  const shippedPack = (code) => {
    if (!i18n().hasShippedPack(code)) return null;
    if (!shipped.has(code)) {
      let pack = {};
      try {
        const dist = path.join(repo, "dist", "lang");
        const dir = fs.existsSync(dist) ? dist : path.join(repo, "public", "lang");
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), "utf8"));
        pack = isRecord(parsed) ? parsed : {};
      } catch {
        pack = {};
      }
      shipped.set(code, pack);
    }
    return shipped.get(code);
  };

  const options = () => list(i18n().getUiLanguageOptions()).filter((entry) => entry.code !== "en");
  const nameOf = (code) => {
    const entry = options().find((option) => option.code === code);
    return entry ? `${entry.name} · ${entry.native}` : code;
  };

  const loadOwnAssets = async (details) => {
    const id = details?.scenario?.id;
    const status = details?.assetStatus ?? {};
    const load = (key) => (id && status[key] ? engine.library.downloadScenarioJsonAsset(id, key).catch(() => null) : Promise.resolve(null));
    const [stats, regionsGeojson, citiesGeojson] = await Promise.all([load("stats"), load("regionsGeojson"), load("citiesGeojson")]);
    return { stats, regionsGeojson, citiesGeojson };
  };

  const formPacks = (raw) => (isRecord(raw) ? raw : {});

  const stringsOf = (entry, form) => {
    const card = Object.fromEntries(CARD_FIELDS.map((key) => [key, form?.[key] ?? ""]));
    return packs().collectScenarioStrings({ scenario: { ...(entry.details?.scenario ?? {}), ...card }, data: entry.details?.data ?? {}, assets: entry.assets });
  };

  const aiReady = () => engine.providerConfig.isFallbackListConfigured() === true;

  const view = (entry, { form, codes, languages }) => {
    const strings = stringsOf(entry, form);
    const own = formPacks(languages);
    const wanted = list(codes).map((code) => clean(code)).filter(Boolean);
    const plan = packs().planScenarioTranslation(Object.fromEntries(wanted.map((code) => [code, packs().missingStrings(strings, own[code], shippedPack(code))])));
    return {
      aiReady: aiReady(),
      count: strings.length,
      plan: plan.length,
      rows: wanted.map((code) => ({ code, name: nameOf(code), coverage: packs().languageCoverage(strings, own[code], shippedPack(code)) })),
      unticked: options().filter((option) => !wanted.includes(option.code)).map((option) => ({ code: option.code, label: `${option.name} · ${option.native}` })),
    };
  };

  const entryFor = (id) => {
    const entry = opened.get(clean(id));
    if (!entry) throw new Error("That scenario is not open in the editor.");
    return entry;
  };

  if (standIn && typeof addStandIn === "function") {
    addStandIn(({ tool, body }) => {
      if (tool !== "submit_translations") return null;
      const user = (body.contents ?? []).flatMap((entry) => entry.parts ?? []).map((part) => part.text ?? "").join("\n");
      const codes = [...user.matchAll(/^([a-z]{2,3}): /gm)].map((match) => match[1]);
      const start = user.indexOf("[", user.indexOf("The strings (id, kind, text):"));
      let items = [];
      try {
        items = JSON.parse(user.slice(start));
      } catch {
        items = [];
      }
      return { args: { translations: items.flatMap((item) => codes.map((code) => ({ id: String(item.id), lang: code, text: `${code.toUpperCase()}~${item.text}` }))) } };
    });
  }

  return {
    "scenarioLanguages.open": async ({ id = "", languages = null } = {}) => {
      const scenarioId = clean(id);
      const details = await engine.library.loadScenarioDetails(scenarioId);
      const assets = await loadOwnAssets(details);
      opened.set(scenarioId, { details, assets });
      const own = Object.keys(formPacks(languages));
      let codes = own;
      if (!codes.length) {
        const mine = clean(i18n().getStoredLanguage()) || "en";
        codes = [...new Set([...DEFAULT_CODES, ...(mine !== "en" ? [mine] : [])])].filter((code) => options().some((option) => option.code === code));
      }
      return { codes };
    },
    "scenarioLanguages.view": async ({ id = "", form = {}, codes = [], languages = null } = {}) => plain(view(entryFor(id), { form, codes, languages })),
    "scenarioLanguages.strings": async ({ id = "", form = {}, code = "", languages = null, query = "", onlyMissing = false, shown = STRINGS_SHOWN } = {}) => {
      const strings = stringsOf(entryFor(id), form);
      const pack = formPacks(languages)[clean(code)] ?? {};
      const covered = shippedPack(clean(code));
      const needle = String(query).trim().toLowerCase();
      const missing = onlyMissing ? new Set(packs().missingStrings(strings, pack, covered).map((item) => item.text)) : null;
      const listed = strings.filter((item) => (!missing || missing.has(item.text))
        && (!needle || item.text.toLowerCase().includes(needle) || String(pack?.[item.text] ?? "").toLowerCase().includes(needle)));
      const count = Math.max(0, Math.trunc(Number(shown) || STRINGS_SHOWN));
      return {
        items: listed.slice(0, count).map((item) => {
          const fromGame = covered && Object.hasOwn(covered, item.text) && !Object.hasOwn(pack, item.text);
          return { text: item.text, value: typeof pack[item.text] === "string" ? pack[item.text] : "", placeholder: fromGame ? String(covered[item.text]) : "" };
        }),
        total: listed.length,
      };
    },
    "scenarioLanguages.generate": async ({ id = "", form = {}, codes = [], languages = null } = {}) => {
      if (running) throw new Error("A generation is already running.");
      const entry = entryFor(id);
      const strings = stringsOf(entry, form);
      const wanted = list(codes).map((code) => clean(code)).filter(Boolean);
      const covered = Object.fromEntries(wanted.map((code) => [code, shippedPack(code)]).filter(([, pack]) => pack));
      const controller = new AbortController();
      running = controller;
      const scenario = { ...(entry.details?.scenario ?? {}), ...(form ?? {}) };
      try {
        const result = await packs().generateScenarioLanguagePacks({
          strings,
          codes: wanted,
          packs: formPacks(languages),
          covered,
          scenario: { name: scenario.name, description: scenario.description, startDate: entry.details?.data?.game?.startDate || form?.gameDate || "" },
          ask: engine.scenarioTranslation.askCreatorsAI,
          signal: controller.signal,
          onProgress: ({ done, total, packs: next }) => emit("scenarioLanguages.progress", plain({ id: clean(id), done, total, packs: done ? next ?? {} : null })),
        });
        storage.flush?.();
        const failed = result.failed ? clean(result.failed?.message) || String(result.failed) : "";
        return plain({ packs: result.packs ?? {}, requests: result.requests, failed, aborted: Boolean(result.failed) && controller.signal.aborted });
      } finally {
        running = null;
      }
    },
    "scenarioLanguages.stop": async () => {
      running?.abort(new Error("Stopped."));
      return true;
    },
    "scenarioLanguages.close": async ({ id = "" } = {}) => {
      opened.delete(clean(id));
      return true;
    },
  };
};
