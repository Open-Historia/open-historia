export const register = (ctx) => {
  const { engine, emit, plain } = ctx;
  const notice = () => engine.shPromptLimitNotice;

  const take = () => {
    const waiting = notice().pendingPromptLimitNotice();
    if (!waiting.length) return [];
    const entries = waiting.map((entry) => ({
      id: String(entry.id ?? ""),
      sectionLabel: String(entry.sectionLabel ?? entry.sectionKey ?? ""),
      segmentLabel: String(entry.segmentLabel ?? entry.segmentId ?? ""),
    }));
    notice().markPromptLimitNoticeSeen();
    return entries;
  };

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener(notice().PROMPT_LIMIT_NOTICE_EVENT, () => {
      const entries = take();
      if (entries.length) emit("shell.promptLimit", { entries });
    });
  }

  return {
    "shell.promptLimit": async () => plain({ entries: take() }),
  };
};
