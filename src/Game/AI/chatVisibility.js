/*! Open Historia — diplomatic chat visibility © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Who is allowed to have read which conversation.
//
// THE BUG THIS EXISTS TO FIX. The `leader` prompt renders
// ${CHATS_NON_CONSOLIDATED_ROUNDS} — a verbatim transcript of every recent chat,
// regardless of who was in it. So every AI leader was handed the player's private
// letters to every OTHER power. There was no such thing as a confidential channel:
// a player could not make a secret offer, could not play two powers against each
// other, and could not promise different things in different rooms, because every
// room was public.
//
// It surfaced as tone rather than as an error, which is why it survived so long.
// From a round-356 campaign, three letters written on one in-game day:
//
//   Algeria — "...we walk away having lost nothing but time. Send your delegation.
//              Algiers will read every page."
//   Nigeria — "...we walk away having lost nothing but time. Send your delegation
//              in January. Nigeria will read every page."
//   Angola  — "Angola will examine every clause for hidden sovereignty costs before
//              any signature, JUST AS OUR NEIGHBOURS HAVE LEARNED TO DO."
//
// Angola's clause is the diagnosis in plain sight: it is reasoning openly from
// correspondence it should never have seen. (For the record, this is not prompt
// caching — that caches the INPUT KV state and cannot make two polities share an
// output. The two are unrelated.)
//
// THE RULE. Filter every transcript by who the prompt is speaking as:
//
//   leader          -> one polity  -> only chats that polity was in
//   advisor         -> the player  -> everything (the player is in every chat, so
//                                     passing no filter is the correct no-op)
//   jumpForward     -> the narrator-> everything; it must resolve what actually
//                                     happened across the whole world
//   eventConsolidator -> archivist -> everything
//
// A chat's `countries` lists the NON-PLAYER participants (a 1-on-1 with Angola is
// `[{code:"AGO",name:"Angola"}]`; the player is implicit), so "was this polity in
// the room?" is answerable directly, with no new data and no migration.
//
// DELIBERATELY IMPORT-FREE, like jsonSalvage.js / providerErrors.js: this decides
// what one government is allowed to know about another, and promptContext.js
// reaches the whole browser runtime and cannot be unit-tested.

const normalize = (value) => String(value ?? "").trim().toLowerCase();

/**
 * Does one entry in a chat's `countries` refer to `polity`?
 *
 * Matches the full name or the short code, since chats store `{code, name}` and
 * neither is canonicalised on the way in (`normalizeChatCountry`,
 * runtime/gameState.js). A blank code never matches a blank polity — otherwise
 * every unnamed participant would match everything.
 */
export const chatParticipantMatches = (country, polity) => {
    const wanted = normalize(polity);
    if (!wanted) return false;
    if (!country) return false;
    if (typeof country === "string") return normalize(country) === wanted;
    if (typeof country !== "object") return false;
    return normalize(country.name) === wanted || normalize(country.code) === wanted;
};

/**
 * May `polity` see this chat?
 *
 * A blank `polity` means "no restriction" — the narrator and advisor paths — and
 * is the documented way to opt out, so callers that legitimately need everything
 * simply pass nothing.
 */
export const isChatVisibleTo = (chat, polity) => {
    if (!normalize(polity)) return true;
    const countries = Array.isArray(chat?.countries) ? chat.countries : [];
    // A chat with no recorded participants is NOT shown to a specific polity.
    // Failing closed is the whole point: the cost of wrongly hiding a chat is a
    // leader that forgets a conversation, which is visible and recoverable; the
    // cost of wrongly showing one is the confidentiality breach this module was
    // written to end.
    return countries.some((country) => chatParticipantMatches(country, polity));
};

/**
 * Keep only the chats `polity` was a participant in. Group chats fall out
 * correctly for free: every power listed in `countries` was in the room, so each
 * of them still sees it.
 */
export const filterChatsVisibleTo = (chats, polity) => {
    const list = Array.isArray(chats) ? chats : [];
    if (!normalize(polity)) return list;
    return list.filter((chat) => isChatVisibleTo(chat, polity));
};
