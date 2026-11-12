import { translationRunnerFor } from "../onDevice.mjs";

export const register = (ctx) => {
  const { engine, emit, plain, storage, clean, list, cacheDir, standIn } = ctx;
  const models = engine.tlModels;
  const i18n = engine.shellI18n;
  const runner = translationRunnerFor({ cacheDir, models, standIn });
  const base = (code) => clean(code).toLowerCase().split(/[-_]/)[0];

  const choiceOf = (code) => models.readModelChoice(storage.getItem(models.modelChoiceKey(code)));
  const entryOf = (code) => list(i18n.LANGUAGES).find((item) => item.code === code) ?? null;

  const offer = (raw) => {
    const code = base(raw);
    const entry = code && code !== "en" ? models.translationModelFor(code) : null;
    return {
      code,
      has: Boolean(entry),
      bytes: entry?.bytes ?? 0,
      size: entry ? models.formatModelSize(entry.bytes) : "",
      choice: entry ? choiceOf(code) : "",
      cached: entry ? runner.cached(code) : false,
      name: i18n.languageDisplayName(code),
      native: entryOf(code)?.native || i18n.languageDisplayName(code),
      packed: i18n.hasShippedPack(code) === true,
      rtl: i18n.isRtlLanguage(code) === true,
    };
  };

  const preparing = new Map();

  if (standIn && typeof ctx.addStandIn === "function") {
    ctx.addStandIn(({ tool, body }) => {
      if (tool) return null;
      const system = (body.system_instruction?.parts ?? []).map((part) => part.text ?? "").join("\n");
      if (!system.includes("You are the translation engine for a grand-strategy game.")) return null;
      const user = (body.contents ?? []).flatMap((entry) => entry.parts ?? []).map((part) => part.text ?? "").join("\n");
      let batch = [];
      try {
        batch = JSON.parse(user);
      } catch {
        return null;
      }
      if (!Array.isArray(batch) || batch.some((text) => String(text).includes("[stand-in fails]"))) return null;
      return { text: JSON.stringify(batch.map((text) => `AI·${text}`)) };
    });
  }

  return {
    "translation.languages": async () => ({
      options: plain(list(i18n.getUiLanguageOptions()).map((item) => ({ ...item, model: Boolean(models.translationModelFor(item.code)), packed: i18n.hasShippedPack(item.code) === true }))),
      current: clean(i18n.getStoredLanguage()) || "en",
    }),
    "translation.offer": async ({ code = "" } = {}) => offer(code),
    "translation.canShow": async ({ code = "" } = {}) => ({ ok: i18n.canTranslateTo(base(code)) === true }),
    "translation.choose": async ({ code = "", choice = "" } = {}) => {
      const lang = base(code);
      const value = models.readModelChoice(choice);
      if (!models.translationModelFor(lang) || !value) return offer(lang);
      storage.setItem(models.modelChoiceKey(lang), value);
      storage.flush?.();
      return offer(lang);
    },
    "translation.prepare": async ({ code = "" } = {}) => {
      const lang = base(code);
      if (!models.translationModelFor(lang)) return { ok: false, error: "No translation model for this language." };
      if (!preparing.has(lang)) {
        const wasCached = runner.cached(lang);
        const work = (async () => {
          await runner.download(lang, ({ loaded, total }) => emit("translation.progress", { code: lang, loaded, total, percent: total ? Math.max(0, Math.min(100, Math.floor((loaded / total) * 100))) : 0 }));
          await runner.load(lang);
          return { ok: true, downloaded: !wasCached };
        })().catch((error) => ({ ok: false, error: clean(error?.message) || "The translation model did not load." }));
        preparing.set(lang, work);
        void work.finally(() => preparing.delete(lang));
      }
      return preparing.get(lang);
    },
    "translation.forget": async ({ code = "" } = {}) => {
      await runner.forget(base(code));
      return offer(code);
    },
  };
};
