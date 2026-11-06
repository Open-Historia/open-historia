const THEME_KEY = "openhistoria:ui-theme:v1";
const SETUP_KEY = "oh-first-setup";

export const register = (ctx) => {
  const { engine, storage, standIn } = ctx;
  const read = (key) => {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, value);
      storage.flush?.();
    } catch {
      return false;
    }
    return true;
  };
  return {
    "look.theme.get": async () => {
      const raw = read(THEME_KEY);
      if (!raw) return { theme: null };
      try {
        return { theme: JSON.parse(raw) };
      } catch {
        return { theme: null };
      }
    },
    "look.theme.set": async ({ theme = null } = {}) => {
      if (!theme || typeof theme !== "object" || Array.isArray(theme)) return false;
      const custom = theme.custom && typeof theme.custom === "object" ? theme.custom : {};
      const kept = {
        preset: String(theme.preset ?? "default"),
        custom: { background: String(custom.background ?? ""), surface: String(custom.surface ?? ""), accent: String(custom.accent ?? "") },
      };
      return write(THEME_KEY, JSON.stringify(kept));
    },
    "look.setup.due": async () => {
      if (standIn) return { due: false };
      return { due: read(SETUP_KEY) !== "1" };
    },
    "look.setup.done": async () => write(SETUP_KEY, "1"),
    "look.release": async ({ id = "" } = {}) => {
      const notes = engine.shellNotes ?? {};
      const notices = engine.shellNotices ?? {};
      const all = Array.isArray(notes.UPDATES) ? notes.UPDATES : [];
      const release = all.find((entry) => entry?.kind === "release" && (!id || entry.id === id));
      if (!release) return { release: null };
      const language = (() => {
        try {
          return String(engine.shellI18n?.getStoredLanguage?.() || "en");
        } catch {
          return "en";
        }
      })();
      const dated = (date) => {
        const [year, month, day] = String(date || "").split("-").map(Number);
        if (!year || !month) return "";
        try {
          return new Intl.DateTimeFormat(language, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(year, month - 1, day || 1));
        } catch {
          return String(date);
        }
      };
      const entriesOf = (chapter) => {
        try {
          return typeof notices.releaseChapterEntries === "function" ? notices.releaseChapterEntries(release, chapter) : [];
        } catch {
          return [];
        }
      };
      return {
        release: {
          id: String(release.id),
          version: String(release.version ?? ""),
          date: String(release.date ?? ""),
          dateText: dated(release.date),
          title: String(release.title ?? ""),
          subtitle: String(release.subtitle ?? ""),
          lead: String(release.lead ?? ""),
          button: String(release.button ?? ""),
          chapters: (release.chapters ?? []).map((chapter) => ({
            key: String(chapter.key),
            scene: String(chapter.scene),
            title: String(chapter.title ?? ""),
            subtitle: String(chapter.subtitle ?? ""),
            lead: String(chapter.lead ?? ""),
            highlights: (chapter.highlights ?? []).map((item) => ({ heading: String(item.heading ?? ""), text: String(item.text ?? "") })),
            entries: entriesOf(chapter).map((entry) => ({ key: String(entry.key), title: String(entry.title ?? ""), dateText: dated(entry.date), lines: (entry.lines ?? []).map(String) })),
          })),
        },
      };
    },
    "look.languages": async () => {
      const i18n = engine.shellI18n ?? {};
      let options = [];
      try {
        options = typeof i18n.getUiLanguageOptions === "function" ? i18n.getUiLanguageOptions() : (i18n.LANGUAGES ?? []);
      } catch {
        options = i18n.LANGUAGES ?? [];
      }
      let current = "en";
      try {
        current = String(i18n.getStoredLanguage?.() || "en");
      } catch {
        current = "en";
      }
      return {
        current,
        options: options.map((entry) => ({ code: String(entry.code), name: String(entry.name ?? entry.code), native: String(entry.native ?? entry.name ?? entry.code), rtl: Boolean(i18n.isRtlLanguage?.(entry.code)) })),
      };
    },
  };
};
