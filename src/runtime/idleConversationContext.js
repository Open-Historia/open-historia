// Pure, bounded conversation selection for unsolicited diplomacy.
// Chat array order is NOT the last activity order. A message may be appended to
// a years-old thread while the thread remains far down the array.
const list = (value) => Array.isArray(value) ? value : [];
const dateKey = (value) => {
  const text = String(value || "").trim();
  return /^\d{4}-\d\d-\d\d/.test(text) ? text.slice(0, 10) : "";
};
const latestDate = (chat) => {
  const messages = list(chat?.messages);
  const last = messages.at(-1);
  return dateKey(last?.time || last?.date || last?.gameDate || chat?.lastMessageDate || chat?.updatedGameDate);
};
const participants = (chat) => list(chat?.countries).map((p) =>
  String(p?.name || p?.code || p || "").trim()).filter(Boolean).join(", ") || "an unnamed polity";
const messageSpeaker = (row) => String(row?.speaker || (row?.role === "user" ? "the player" : "unknown")).trim();
const summaryLine = (row, chars) => {
  const plain = String(row?.text || "").replace(/\s+/g, " ").trim();
  return `  ${messageSpeaker(row)}: ${plain.slice(0, chars)}${plain.length > chars ? "…" : ""}`;
};
export const orderOpenDiplomaticChats = (chats) => list(chats)
  .map((chat, index) => ({ chat, index, lastDate: latestDate(chat) }))
  .filter(({ chat }) => chat?.status !== "closed")
  .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.index - a.index);

// A player can reply to a diplomat while the provider is composing an idle
// note. Never append a response to a state of the thread the model did not see.
const threadTip = (chat) => {
  const tip = list(chat?.messages).at(-1);
  return tip ? JSON.stringify({
    id: tip.id || "", speaker: tip.speaker || "", text: tip.text || "",
    time: tip.time || "", at: tip.at || "",
  }) : "";
};
export const idleThreadChangedSince = (before, after) =>
  String(before?.id || "") !== String(after?.id || "") || threadTip(before) !== threadTip(after);

export const buildIdleConversationBrief = (chats, {
  fullLimit = 5, summaryLimit = 35, maxChars = 26000,
} = {}) => {
  const ordered = orderOpenDiplomaticChats(chats);
  if (!ordered.length) return { text: "There are no open conversations with the player.", includedChatIds: [] };
  const fullCount = Math.max(0, Math.min(20, Number(fullLimit) || 0));
  const total = fullCount + Math.max(0, Math.min(100, Number(summaryLimit) || 0));
  const budget = Math.max(1000, Math.min(64000, Number(maxChars) || 26000));
  const selected = [];
  const includedChatIds = [];
  let used = 0;
  for (const [rank, row] of ordered.entries()) {
    if (rank >= total) break;
    const messages = list(row.chat.messages);
    const full = rank < fullCount;
    const selectedMessages = full ? messages.slice(-8) : messages.slice(-2);
    const item = `With ${participants(row.chat)} (${full ? "recent discussion" : "earlier open thread"}; last activity ${row.lastDate || "not dated"}):\n`
      + (selectedMessages.length
        ? selectedMessages.map((msg) => summaryLine(msg, full ? 440 : 210)).join("\n")
        : "  (no messages yet)");
    if (used + item.length + 2 > budget) break;
    selected.push(item);
    includedChatIds.push(String(row.chat.id || ""));
    used += item.length + 2;
  }
  const omitted = ordered.length - selected.length;
  return {
    text: `${selected.join("\n\n")}${omitted > 0 ? `\n\n[${omitted} other open thread(s) omitted from this bounded context. Do NOT propose continuing an omitted conversation.]` : ""}`,
    includedChatIds,
  };
};
