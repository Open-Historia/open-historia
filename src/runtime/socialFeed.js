/*! Open Historia — Rostra, the world's social network: its posts and rules © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// "a new button where the projects button was where it opens a social media
// application and you can read posts made by powerful and influenceial people
// or you can also write posts as the leader of your country. you should also be
// able to quote other peoples posts like you can on twitter/x and every once in
// a while there should be a celebrity post of something unrelated to world
// affairs or just a normal person talking about something unrelated to world
// affairs. things that happen on the social media should be in the time skip
// ai's (simulation agent) context" (the owner, 2026-11-02).
//
// Rostra (GameUI/social.jsx) is a feed kept on the world, world.socialFeed,
// oldest first. Two things write it and nothing else:
//   - the player, as their country's leader (withPlayerPost). It costs no
//     request: the world answers with the next time skip.
//   - the time skip, in the one answer it already gives (its socialPosts field,
//     AI/gameplaySchemas.js): the people who make the news on the period's
//     events, their answers to the player's posts, and now and then one post
//     about nothing in world affairs (readSkipPosts).
// And the skip reads it back: the posts that matter go into its prompt as
// public statements by the people who wrote them (socialFeedPromptBlock).
//
// A post is named by its id ("p12"), which the skip quotes by: the model mints
// no ids of its own and is shown no other.
//
// The plain data and rules, no React and no AI, so node can test them, and so a
// shared game's host (multiplayer/host/gameHost.js) posts for its guests with
// the same rules the player's own screen uses.
import { compareGameDates, gameDateDayNumber, isGameDate } from "./gameDates.js";
import { derivePoliticalDecisionAuthority, getPoliticalProfile } from "./politicalActors.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const list = (value) => (Array.isArray(value) ? value : []);
const clip = (value, limit) => {
  const text = clean(value);
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
};
// A post's text keeps its line breaks (a list, a sign-off), but no run of blank lines.
const postText = (value, limit) => {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
};

// How long a post may be: the player's box counts to the first; a post the
// model writes longer than it was asked to is kept to the second.
export const SOCIAL_POST_MAX_CHARS = 280;
const WRITTEN_POST_LIMIT = 420;
const AUTHOR_LIMIT = 60;
const ROLE_LIMIT = 90;
const COUNTRY_LIMIT = 80;

// How many posts the world keeps (the oldest go first), and how many one time
// skip may add, however many segments it was asked in.
export const SOCIAL_FEED_LIMIT = 300;
export const SOCIAL_POSTS_PER_SKIP = 30;

// What a post is: written by a person who plays (the player), by someone who
// makes the news (a voice), or about nothing in world affairs (everyday).
export const SOCIAL_POST_KINDS = Object.freeze(["player", "voice", "everyday"]);
const KIND_SET = new Set(SOCIAL_POST_KINDS);

const POST_ID = /^p(\d{1,7})$/;
const postNumber = (id) => {
  const match = POST_ID.exec(clean(id));
  return match ? Number(match[1]) : 0;
};

// --- Polls ----------------------------------------------------------------------

// A player's post can be a poll (the owner, 2026-11-03, after a picture of one:
// "take inspiration from this image to add a poll thing"): the post is the
// question, and two to four choices go under it. The public of the leader's
// country votes over the next time skip, which writes the result in the answer
// it already gives (its pollResults field, readSkipPollResults): the share each
// choice won, how many voted, and one sentence on what the public said. Until
// then the poll is open, and from then on it shows its final results.
export const POLL_CHOICES_MIN = 2;
export const POLL_CHOICES_MAX = 4;
export const POLL_CHOICE_MAX_CHARS = 40;
const CONSENSUS_LIMIT = 240;
const MAX_VOTES = 9999999999;

// Shares as whole percentages that add up to 100, in the choices' order: what
// the model wrote, scaled, and the points rounding loses given to the largest
// remainders. Null for no share at all.
const wholeShares = (raw, count) => {
  const values = Array.from({ length: count }, (_, index) => {
    const number = Number(String(list(raw)[index] ?? "").replace(/[%\s,]/g, ""));
    return Number.isFinite(number) && number > 0 ? number : 0;
  });
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  const exact = values.map((value) => (value / total) * 100);
  const shares = exact.map(Math.floor);
  let left = 100 - shares.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => [value - Math.floor(value), index]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, index] of order) {
    if (left <= 0) break;
    shares[index] += 1;
    left -= 1;
  }
  return shares;
};

// A poll as it is kept: its choices, each once and none blank, and its results
// once the public has voted. Null for one with fewer than two choices.
export const normalizePoll = (raw) => {
  if (!isRecord(raw)) return null;
  const seen = new Set();
  const choices = [];
  for (const entry of list(raw.choices ?? raw.options)) {
    const choice = clip(entry, POLL_CHOICE_MAX_CHARS);
    if (!choice || seen.has(fold(choice))) continue;
    seen.add(fold(choice));
    choices.push(choice);
    if (choices.length >= POLL_CHOICES_MAX) break;
  }
  if (choices.length < POLL_CHOICES_MIN) return null;
  const poll = { choices };
  const results = isRecord(raw.results) ? raw.results : null;
  const shares = results ? wholeShares(results.shares, choices.length) : null;
  if (shares) {
    const votes = Math.round(Number(String(results.votes ?? "").replace(/[\s,]/g, "")));
    poll.results = {
      shares,
      votes: Number.isFinite(votes) && votes > 0 ? Math.min(MAX_VOTES, votes) : 0,
      consensus: clip(results.consensus, CONSENSUS_LIMIT),
      round: Number.isFinite(Number(results.round)) ? Math.max(0, Math.trunc(Number(results.round))) : 0,
    };
  }
  return poll;
};

// The choices the player typed, as a poll, or { error } (a sentence for them).
export const pollFromChoices = (choices) => {
  const typed = list(choices).map((choice) => clean(choice)).filter(Boolean);
  if (typed.some((choice) => Array.from(choice).length > POLL_CHOICE_MAX_CHARS)) return { error: `A choice is at most ${POLL_CHOICE_MAX_CHARS} characters.` };
  const poll = normalizePoll({ choices: typed });
  if (!poll || poll.choices.length !== typed.length) return { error: `A poll needs ${POLL_CHOICES_MIN} to ${POLL_CHOICES_MAX} different choices.` };
  return { poll };
};

// The player's polls the public has not voted on yet, oldest first.
export const openPolls = (feed) => normalizeSocialFeed(feed).filter((post) => post.poll && !post.poll.results);

// The answer's pollResults, read onto the open polls they name (by id). An
// entry for a poll that is not open, or with no share at all, changes nothing.
// `round` the round the skip lands on.
export const readSkipPollResults = (raw, { feed = [], round = 0 } = {}) => {
  const posts = normalizeSocialFeed(feed);
  const open = new Map(openPolls(posts).map((post) => [post.id, post]));
  const answered = new Map();
  for (const entry of list(raw)) {
    if (!isRecord(entry)) continue;
    const id = clean(entry.poll ?? entry.id ?? entry.post);
    const post = open.get(id);
    if (!post || answered.has(id)) continue;
    // Shares by choice, where the model named them instead of listing them.
    const asked = entry.shares ?? entry.results ?? entry.percentages;
    const shares = isRecord(asked)
      ? post.poll.choices.map((choice) => asked[choice] ?? Object.entries(asked).find(([key]) => fold(key) === fold(choice))?.[1])
      : asked;
    const poll = normalizePoll({ ...post.poll, results: { shares, votes: entry.votes, consensus: entry.consensus, round } });
    if (poll?.results) answered.set(id, poll);
  }
  if (!answered.size) return { feed: posts, answered: 0 };
  return {
    feed: posts.map((post) => (answered.has(post.id) ? { ...post, poll: answered.get(post.id) } : post)),
    answered: answered.size,
  };
};

// The winning choice's place, or -1 while the poll is open or tied at the top.
export const pollWinner = (poll) => {
  const shares = poll?.results?.shares;
  if (!Array.isArray(shares) || !shares.length) return -1;
  const top = Math.max(...shares);
  return shares.filter((share) => share === top).length === 1 ? shares.indexOf(top) : -1;
};

// --- Posts ----------------------------------------------------------------------

// One kept post, or null when it has no id, no author or nothing to say.
export const normalizeSocialPost = (raw) => {
  if (!isRecord(raw)) return null;
  const id = clean(raw.id);
  const author = clip(raw.author, AUTHOR_LIMIT);
  const text = postText(raw.text, WRITTEN_POST_LIMIT);
  if (!postNumber(id) || !author || !text) return null;
  const kind = KIND_SET.has(clean(raw.kind)) ? clean(raw.kind) : "voice";
  const post = {
    id,
    author,
    role: clip(raw.role, ROLE_LIMIT),
    country: clip(raw.country, COUNTRY_LIMIT),
    text,
    date: isGameDate(raw.date) ? clean(raw.date) : "",
    round: Number.isFinite(Number(raw.round)) ? Math.max(0, Math.trunc(Number(raw.round))) : 0,
    kind,
  };
  const quote = clean(raw.quote);
  if (postNumber(quote) && quote !== id) post.quote = quote;
  // Whose seat wrote a player's post: in a shared game, which person's country.
  if (kind === "player" && clean(raw.by)) post.by = clip(raw.by, COUNTRY_LIMIT);
  // Only a player asks a poll.
  const poll = kind === "player" ? normalizePoll(raw.poll) : null;
  if (poll) post.poll = poll;
  return post;
};

// The feed as it is kept: every post well formed and once, oldest first, a
// quote only of a post that is still there, and no more than the world keeps.
export const normalizeSocialFeed = (raw) => {
  const seen = new Set();
  const posts = [];
  for (const entry of list(raw)) {
    const post = normalizeSocialPost(entry);
    if (!post || seen.has(post.id)) continue;
    seen.add(post.id);
    posts.push(post);
  }
  posts.sort((a, b) => postNumber(a.id) - postNumber(b.id));
  const kept = posts.slice(-SOCIAL_FEED_LIMIT);
  const ids = new Set(kept.map((post) => post.id));
  // A quote of a post that has since gone shows as the quote alone, as a post
  // whose original was deleted does anywhere.
  return kept.map((post) => (post.quote && !ids.has(post.quote) ? { ...post, quoteGone: true } : post));
};

const nextNumber = (feed) => list(feed).reduce((high, post) => Math.max(high, postNumber(post?.id)), 0) + 1;

const findPost = (feed, id) => list(feed).find((post) => post?.id === clean(id)) ?? null;

// --- The player's leader -----------------------------------------------------------

// Who speaks for a polity: the person the political model names as its primary
// decision-maker, else the leader its stat sheet names. { name, title }, or
// null when the world names nobody (the player then posts under the country's
// own name).
export const leaderOf = (world, polity) => {
  const name = clean(polity);
  if (!name) return null;
  try {
    const profile = getPoliticalProfile(world, name);
    const authority = derivePoliticalDecisionAuthority(profile);
    const primary = authority?.primary;
    const person = clean(typeof primary === "string" ? primary : primary?.name);
    if (person) {
      // (An office written as a bare name takes the title of the record's leader, where that is the same person.)
      const leader = profile?.leader;
      const title = clean(typeof primary === "string" ? "" : primary?.title)
        || (fold(typeof leader === "string" ? leader : leader?.name) === fold(person) ? clean(leader?.title) : "");
      return { name: clip(person, AUTHOR_LIMIT), title: clip(title, ROLE_LIMIT) };
    }
  } catch {
    // No political model for this world: the stat sheet may still name one.
  }
  const sheets = isRecord(world?.countryStats) ? world.countryStats : {};
  const key = Object.keys(sheets).find((entry) => fold(entry) === fold(name));
  const leader = clean(key ? sheets[key]?.leader : "");
  return leader ? { name: clip(leader, AUTHOR_LIMIT), title: "" } : null;
};

// The account a player posts from: their leader, or the country itself.
export const playerAccount = (world, polity) => {
  const country = clean(polity);
  const leader = leaderOf(world, country);
  return {
    author: leader?.name || country,
    role: leader?.name ? (leader.title || `Leader of ${country}`) : "",
    country,
  };
};

// A post the player writes, as their country's leader. `by` is their country;
// `quote` the id of the post they quote, if any; `choices` a poll's choices,
// when the post asks one (its text is then the question). Returns { world,
// post } or { error } (a sentence for the player), and never writes anything
// itself.
export const withPlayerPost = (world, { by = "", text = "", quote = "", date = "", round = 0, choices = null } = {}) => {
  const country = clean(by);
  const body = postText(text, SOCIAL_POST_MAX_CHARS + 1);
  if (!country) return { error: "Nobody to post as." };
  if (!body) return { error: "A post needs words." };
  if (body.length > SOCIAL_POST_MAX_CHARS) return { error: `A post is at most ${SOCIAL_POST_MAX_CHARS} characters.` };
  const asked = Array.isArray(choices) ? pollFromChoices(choices) : null;
  if (asked?.error) return { error: asked.error };
  const feed = normalizeSocialFeed(world?.socialFeed);
  const quoted = clean(quote);
  if (quoted && !findPost(feed, quoted)) return { error: "That post is no longer there to quote." };
  const account = playerAccount(world, country);
  const post = normalizeSocialPost({
    id: `p${nextNumber(feed)}`,
    ...account,
    text: body,
    date,
    round,
    kind: "player",
    by: country,
    quote: quoted,
    ...(asked?.poll ? { poll: asked.poll } : {}),
  });
  return { world: { ...(isRecord(world) ? world : {}), socialFeed: normalizeSocialFeed([...feed, post]) }, post };
};

// --- What a time skip wrote --------------------------------------------------------

// Not a person: a country, a government or a people. The skip is asked for
// people (socialFeedPromptBlock); a post signed by one of these is left out.
const NOT_A_PERSON = /^(?:the\s+)?(?:government|ministry|people|citizens|player|state|republic|kingdom|empire|nation)\b|\b(?:government|ministry)\s+of\b/i;

const plausibleAuthor = (author, known) => {
  if (!author || author.length > AUTHOR_LIMIT || !/\p{L}/u.test(author)) return false;
  if (NOT_A_PERSON.test(author)) return false;
  // A country is not a person.
  return !known.has(fold(author));
};

// The map's own spelling of a polity the model named, or "" for one it does
// not have: names are exact, so nothing is folded onto a different name.
const exactPolity = (value, byFold) => byFold.get(fold(value)) || "";

// The posts of a time skip's answer as they are kept: a person for an author,
// the map's exact name for a country (or none), a date inside the period, and a
// quote that names a post: the id of one in the feed, or "#n" for the nth post
// of the same answer, earlier in it. A quote of anything else drops the post,
// which only makes sense beside what it quotes. A quote is never dated before
// what it quotes. Ids are given here, after the feed's last, in date order.
//
// `knownNames` every polity name the world knows (countryInfoPanel.js
// knownPolityNames); `from` and `to` the period's dates; `round` the round the
// skip lands on.
export const readSkipPosts = (raw, { feed = [], from = "", to = "", round = 0, knownNames = [] } = {}) => {
  const byFold = new Map();
  for (const name of list(knownNames)) {
    const text = clean(name);
    if (text && !byFold.has(fold(text))) byFold.set(fold(text), text);
  }
  const known = new Set(byFold.keys());
  const kept = normalizeSocialFeed(feed);
  const fromDay = gameDateDayNumber(from);
  const toDay = gameDateDayNumber(to);
  const inPeriod = (date) => {
    const day = gameDateDayNumber(date);
    if (day === null) return false;
    return (fromDay === null || day >= fromDay) && (toDay === null || day <= toDay);
  };
  const fallbackDate = isGameDate(to) ? clean(to) : "";
  const later = (a, b) => (isGameDate(b) && (!isGameDate(a) || compareGameDates(a, b) < 0) ? b : a);

  // First what each post says, by its place in the answer (1-based).
  const read = new Map();
  const seenTexts = new Set(kept.map((post) => fold(post.text)));
  list(raw).forEach((entry, index) => {
    if (read.size >= SOCIAL_POSTS_PER_SKIP || !isRecord(entry)) return;
    const author = clean(entry.author ?? entry.name);
    const text = postText(entry.text ?? entry.content, WRITTEN_POST_LIMIT);
    if (!text || !plausibleAuthor(author, known) || seenTexts.has(fold(text))) return;
    let date = inPeriod(entry.date) ? clean(entry.date) : fallbackDate;
    const asked = clean(entry.quote ?? entry.quotes);
    let quote = null;
    if (asked) {
      const place = POST_ID.test(asked) ? null : /^#?\s*(\d{1,3})$/.exec(asked);
      const earlier = place && Number(place[1]) <= index ? read.get(Number(place[1])) : null;
      const original = place ? null : kept.find((post) => post.id === asked);
      if (!earlier && !original) return;
      quote = earlier ? { place: Number(place[1]) } : { id: original.id };
      date = later(date, earlier ? earlier.date : original.date);
    }
    seenTexts.add(fold(text));
    read.set(index + 1, {
      author,
      role: entry.role,
      country: exactPolity(entry.country, byFold),
      text,
      date,
      kind: entry.offTopic === true || entry.everyday === true ? "everyday" : "voice",
      quote,
      place: index + 1,
    });
  });

  // Then their ids, oldest first, the answer's order within a day: what a post
  // quotes is dated no later than it and comes earlier in the answer, so it
  // always has its id first.
  let number = nextNumber(kept);
  const ids = new Map();
  const posts = [];
  for (const entry of [...read.values()].sort((a, b) => compareGameDates(a.date, b.date) || a.place - b.place)) {
    const id = `p${number}`;
    const post = normalizeSocialPost({
      ...entry,
      id,
      round,
      quote: entry.quote?.id || (entry.quote ? ids.get(entry.quote.place) : ""),
    });
    if (!post) continue;
    number += 1;
    ids.set(entry.place, id);
    posts.push(post);
  }
  return posts;
};

// The feed with a skip's posts added (readSkipPosts' answer, already read).
export const withSkipPosts = (feed, posts) => normalizeSocialFeed([...normalizeSocialFeed(feed), ...list(posts)]);

// --- What the screen shows -------------------------------------------------------

// A deterministic number from a post's id, so the counts under a post do not
// change each time it is drawn.
const seeded = (text) => {
  let hash = 2166136261;
  for (const char of String(text)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
};

const HIGH_OFFICE = /\b(?:president|prime minister|premier|chancellor|king|queen|emperor|empress|sultan|emir|shah|tsar|czar|pope|supreme leader|general secretary|head of state|monarch|leader of)\b/i;
const OFFICE = /\b(?:minister|secretary|senator|governor|general|admiral|ambassador|spokes(?:man|woman|person)|chair(?:man|woman)?|mayor|commander|party|parliament|deputy|mp|congress)\b/i;

// How far a post carries: the reach of who wrote it, a little luck, and the
// people who quoted it. Shown under a post as counts; nothing in the game reads
// them. A player's post has none until a time skip has passed over it: the
// world answers with the next one.
export const postEngagement = (post, feed = [], round = 0) => {
  const quotes = list(feed).filter((entry) => entry?.quote === post?.id).length;
  if (!post || (post.kind === "player" && Number(round) <= Number(post.round))) return { quotes, reposts: 0, likes: 0 };
  const role = `${post.role || ""}`;
  const reach = post.kind === "player" || HIGH_OFFICE.test(role)
    ? 180000
    : OFFICE.test(role)
      ? 24000
      : post.kind === "everyday"
        ? (seeded(`${post.id}:celebrity`) < 0.5 ? 90000 : 400)
        : 9000;
  const luck = 0.25 + seeded(post.id) * 1.5;
  const likes = Math.round(reach * luck * (1 + quotes * 0.35));
  const reposts = Math.round(likes * (0.08 + seeded(`${post.id}:r`) * 0.14));
  return { quotes, reposts, likes };
};

// 1234 → "1.2K", 2500000 → "2.5M": as counts are written under a post.
export const compactCount = (value) => {
  const number = Math.max(0, Math.round(Number(value) || 0));
  if (number < 1000) return String(number);
  const [divisor, suffix] = number < 1e6 ? [1e3, "K"] : [1e6, "M"];
  const shown = number / divisor;
  return `${shown >= 100 ? Math.round(shown) : Math.round(shown * 10) / 10}${suffix}`;
};

const same = (left, right) => Boolean(fold(left)) && fold(left) === fold(right);

// Does this post speak to or of the player: does it quote one of theirs, or
// name their country or their leader? Not the player's own posts.
export const mentionsPlayer = (post, { feed = [], country = "", leader = "" } = {}) => {
  if (!post || (post.kind === "player" && same(post.by || post.country, country))) return false;
  const quoted = post.quote ? findPost(feed, post.quote) : null;
  if (quoted?.kind === "player" && same(quoted.by || quoted.country, country)) return true;
  const text = fold(post.text);
  return [country, leader].map(fold).some((name) => name.length >= 3 && text.includes(name));
};

// The feed as one of the app's tabs shows it, newest first:
//   all       every post
//   country   posts by people of the player's country
//   mentions  posts that quote the player or name their country or leader
//   mine      the player's own
export const SOCIAL_TABS = Object.freeze(["all", "country", "mentions", "mine"]);
export const socialFeedView = (feed, { tab = "all", country = "", leader = "" } = {}) => {
  const posts = normalizeSocialFeed(feed);
  const keep = (post) => {
    if (tab === "mine") return post.kind === "player" && same(post.by || post.country, country);
    if (tab === "country") return same(post.country, country);
    if (tab === "mentions") return mentionsPlayer(post, { feed: posts, country, leader });
    return true;
  };
  return posts
    .filter(keep)
    .sort((a, b) => compareGameDates(b.date, a.date) || postNumber(b.id) - postNumber(a.id))
    .map((post) => ({ ...post, quoted: post.quote ? findPost(posts, post.quote) : null }));
};

// The newest post's number, for the dock's count of posts not yet seen.
export const newestPostNumber = (feed) => list(feed).reduce((high, post) => Math.max(high, postNumber(post?.id)), 0);
export const postsAfter = (feed, seenNumber) => list(feed).filter((post) => postNumber(post?.id) > Number(seenNumber || 0)).length;

// --- What the time skip is told ----------------------------------------------------

// How much of the feed the skip reads: the posts that matter most, up to this
// many and this many characters, so a long campaign's feed never grows the prompt.
export const SOCIAL_PROMPT_POSTS = 24;
export const SOCIAL_PROMPT_CHARS = 4800;
const PROMPT_TEXT_LIMIT = 280;

// Whether this skip is asked for a post about nothing in world affairs: when
// none came with the last one. Every other skip, then, and never left to chance.
export const wantsEverydayPost = (feed, round) => !list(feed).some((post) =>
  post?.kind === "everyday" && Number(round) - Number(post.round) < 1);

const describePost = (post, feed, round) => {
  const who = [clean(post.author), clean(post.role), clean(post.country)].filter(Boolean).join(", ");
  const marks = [];
  if (post.kind === "player") marks.push(Number(post.round) >= Number(round) ? "posted by the player, since the last time skip" : "posted by the player");
  if (post.kind === "everyday") marks.push("not about world affairs");
  const quoted = post.quote ? findPost(feed, post.quote) : null;
  const quoting = quoted
    ? ` Quoting ${quoted.id} (${clean(quoted.author)}: "${clip(quoted.text, 90)}").`
    : "";
  return `${post.id} | ${post.date || "undated"} | ${who}${marks.length ? ` [${marks.join("; ")}]` : ""}:${quoting} "${clip(post.text, PROMPT_TEXT_LIMIT)}"${pollLine(post.poll)}`;
};

// A poll's choices, and what the public answered once it has.
const pollLine = (poll) => {
  if (!poll) return "";
  const results = poll.results;
  if (!results) return ` Poll, open until this time skip: ${poll.choices.map((choice) => `"${choice}"`).join(" / ")}.`;
  const shares = poll.choices.map((choice, index) => `"${choice}" ${results.shares[index]}%`).join(", ");
  return ` Poll result: ${shares}${results.votes ? ` (${results.votes.toLocaleString("en-US")} votes)` : ""}.${results.consensus ? ` ${results.consensus}` : ""}`;
};

// What was said on Rostra in one country and about it, for a Search feed's
// prompt (gameplay.js generatePlaceFeed): the newest posts by its people and by
// its leader, and its leader's polls with what the public answered, so that the
// people there talk about what is being said where they live. "" for nothing.
export const PLACE_ROSTRA_POSTS = 8;
export const placeRostraLines = (feed, { country = "" } = {}) => {
  const name = clean(country);
  if (!name) return "";
  const posts = normalizeSocialFeed(feed);
  return [...posts]
    .reverse()
    .filter((post) => same(post.country, name) || (post.kind === "player" && same(post.by, name)))
    .slice(0, PLACE_ROSTRA_POSTS)
    .reverse()
    .map((post) => `${post.date || "undated"} | ${[clean(post.author), clean(post.role)].filter(Boolean).join(", ")}: "${clip(post.text, PROMPT_TEXT_LIMIT)}"${pollLine(post.poll)}`)
    .join("\n");
};

// The posts the skip is shown, most important first: every post of the
// player's of the last two rounds, then the answers to them, then the newest
// of those in high office, then the newest of everyone else, at most
// SOCIAL_PROMPT_POSTS. The block keeps them in this order while they fit in
// SOCIAL_PROMPT_CHARS, and lists what it kept oldest first.
export const promptPosts = (feed, { round = 0 } = {}) => {
  const posts = normalizeSocialFeed(feed);
  const newestFirst = [...posts].reverse();
  const recent = (post) => Number(round) - Number(post.round) <= 1;
  const picked = new Map();
  const take = (post) => {
    if (picked.size < SOCIAL_PROMPT_POSTS && !picked.has(post.id)) picked.set(post.id, post);
  };
  const playersPosts = newestFirst.filter((post) => post.kind === "player" && recent(post));
  const playerIds = new Set(playersPosts.map((post) => post.id));
  playersPosts.slice(0, 10).forEach(take);
  newestFirst.filter((post) => post.quote && playerIds.has(post.quote)).slice(0, 8).forEach(take);
  newestFirst.filter((post) => post.kind !== "everyday" && HIGH_OFFICE.test(post.role)).slice(0, 6).forEach(take);
  newestFirst.forEach(take);
  return [...picked.values()];
};

// The [Social Media] block of a time skip's prompt: what was posted, as public
// statements that can move events, and what the skip is to write in its
// socialPosts field. `players` the polities people play (their leaders' posts
// are theirs alone to write); `round` the round being simulated.
export const socialFeedPromptBlock = ({ feed = [], players = [], round = 0 } = {}) => {
  const people = list(players).map(clean).filter(Boolean);
  const playerNames = people.length ? people.join(", ") : "the player's polity";
  const posts = normalizeSocialFeed(feed);
  const kept = [];
  let used = 0;
  for (const post of promptPosts(posts, { round })) {
    const line = describePost(post, posts, round);
    if (used + line.length > SOCIAL_PROMPT_CHARS) continue;
    used += line.length + 1;
    kept.push({ post, line });
  }
  const lines = kept.sort((a, b) => postNumber(a.post.id) - postNumber(b.post.id)).map((entry) => entry.line);
  const everyday = wantsEverydayPost(posts, round);
  // An open poll is always shown, whatever else the block had room for: the
  // skip is to answer it.
  const polls = openPolls(posts);
  for (const post of polls) {
    if (!kept.some((entry) => entry.post.id === post.id)) lines.push(describePost(post, posts, round));
  }
  return [
    "[Social Media]",
    "Rostra is this world's social network, where the people who make the news post in public. Each post below is a public statement by the person who wrote it, and it can move events as a speech would: a leader's post can insult a neighbour or reassure an ally, calm a market or start a run on it, call people into the streets, embarrass a government or sink a negotiation. Where a post would really have consequences in this period, write them into the events, and let the people it concerns answer it.",
    `Posts by the leader of ${playerNames} are the player's own words, made in public: carry their consequences like those of an order, and never treat them as private.`,
    lines.length ? lines.join("\n") : "Nothing has been posted yet.",
    "Write socialPosts: what was posted during this period, in date order, about 6 to 12 posts for a month (fewer for a shorter period, a few more for a longer one).",
    "  • The people who make the news, on this period's events: heads of state and government, ministers, generals, party leaders, journalists, analysts, chief executives, activists. Each writes in their own voice, under their real name where history gives one.",
    "  • Answers to the player's posts since the last time skip: the people they concern quote them (quote: that post's id) and say what they make of them. Most of the player's posts get at least one answer.",
    "  • Quote other posts too where someone would: a rival answering a rival, a journalist picking a statement apart.",
    everyday
      ? "  • And exactly one post about nothing in world affairs: a celebrity, a sports star or an ordinary person talking about everyday things (offTopic: true)."
      : "  • No post about everyday things this time: every post is about world affairs.",
    `Each post: author (a person's full name, never a country, a government or a people), role (their office or what they do), country (the exact map name of the polity they belong to, or empty), date (YYYY-MM-DD inside the period), text (at most ${SOCIAL_POST_MAX_CHARS} characters, written as that person would post it, in the language the events are written in), quote (the id of the post it quotes, from the list above or "#2" for the 2nd post of your own list, else empty).`,
    `Never write a post as the leader of ${playerNames}, or as anyone who speaks for ${people.length > 1 ? "their governments" : "its government"}: those posts are the player's to write. Their opposition, press and people may post.`,
    ...(polls.length ? [
      `Write pollResults: the player's open ${polls.length === 1 ? "poll" : "polls"} (${polls.map((post) => post.id).join(", ")}), as the public of the leader's country voted on ${polls.length === 1 ? "it" : "them"} during this period. For each: poll (its id), shares (the percentage of voters who chose each choice, whole numbers in the choices' order, adding up to 100), votes (how many people voted, as many as would answer such a poll there) and consensus (one sentence: what the public said and why).`,
      "  • Decide the shares from what that public really thinks of the question in this world, never from what the leader would like to hear. A poll asked in a country at war, in a crisis or under a government its people distrust can go against it.",
      "  • The result is public opinion the government has to live with: let it show where it matters, in the events and in what people post (quoting the poll, cheering or mocking the result).",
    ] : []),
  ].join("\n");
};
