/*! Open Historia — Rostra, the social network's posts and rules: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/socialFeed.test.js
//
// What a time skip's posts become in the feed, how the player posts and
// quotes, what the feed's tabs show, and what the next skip is told.

import test from "node:test";
import assert from "node:assert/strict";

import { mergeSegmentPayloads } from "../Game/AI/jumpSegments.js";
import {
  ROSTRA_REFRESH_POSTS,
  SOCIAL_FEED_LIMIT,
  SOCIAL_POST_MAX_CHARS,
  SOCIAL_PROMPT_CHARS,
  compactCount,
  leaderOf,
  mentionsPlayer,
  normalizeSocialFeed,
  postEngagement,
  promptPosts,
  readSkipPosts,
  rostraRefreshRules,
  socialFeedPromptBlock,
  socialFeedView,
  wantsEverydayPost,
  withPlayerPost,
  withSkipPosts,
} from "./socialFeed.js";

const KNOWN = ["French Republic", "Federal Republic of Germany", "Kingdom of Spain"];
const PERIOD = { from: "2026-03-01", to: "2026-03-31", round: 5, knownNames: KNOWN };

const post = (id, fields = {}) => ({ id, author: "Ana Lima", role: "Columnist", country: "", text: `Post ${id}`, date: "2026-02-10", round: 4, kind: "voice", ...fields });

test("a skip's posts land in the feed with ids after the feed's last, in date order", () => {
  const feed = [post("p7")];
  const posts = readSkipPosts([
    { author: "Olaf Scholz", role: "Chancellor", country: "Federal Republic of Germany", date: "2026-03-20", text: "We stand by our partners." },
    { author: "Marine Dubois", role: "Analyst", country: "french republic", date: "2026-03-05", text: "Markets are nervous." },
  ], { feed, ...PERIOD });
  assert.deepEqual(posts.map((entry) => [entry.id, entry.author, entry.date]), [
    ["p8", "Marine Dubois", "2026-03-05"],
    ["p9", "Olaf Scholz", "2026-03-20"],
  ]);
  // The map's exact spelling, never another name folded onto it.
  assert.equal(posts[0].country, "French Republic");
  assert.equal(posts[1].country, "Federal Republic of Germany");
  assert.equal(posts.every((entry) => entry.round === 5 && entry.kind === "voice"), true);
  const next = withSkipPosts(feed, posts);
  assert.deepEqual(next.map((entry) => entry.id), ["p7", "p8", "p9"]);
});

test("a country the map does not have is left off the post, and a country is not a person", () => {
  const posts = readSkipPosts([
    { author: "Pedro Sánchez", role: "Prime Minister", country: "Spain", text: "Madrid will not be pressured." },
    { author: "Kingdom of Spain", text: "An official statement." },
    { author: "French Republic", text: "A country signing a post." },
    { author: "Government of Italy", text: "Another." },
    { author: "", text: "Nobody." },
    { author: "Someone", text: "" },
  ], PERIOD);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].country, "", "\"Spain\" is not the map's \"Kingdom of Spain\"");
});

test("a date outside the period is the period's last day; a missing one too", () => {
  const posts = readSkipPosts([
    { author: "A B", text: "Too early.", date: "2025-01-01" },
    { author: "C D", text: "No date." },
    { author: "E F", text: "Inside.", date: "2026-03-12" },
  ], PERIOD);
  assert.deepEqual(posts.map((entry) => entry.date), ["2026-03-12", "2026-03-31", "2026-03-31"]);
});

test("quotes resolve: an id in the feed, or #n for an earlier post of the same answer; anything else drops the post", () => {
  const feed = [post("p20", { kind: "player", author: "Leader", by: "French Republic", country: "French Republic", round: 5 })];
  const posts = readSkipPosts([
    { author: "Olaf Scholz", text: "Bold words from Paris.", quote: "p20", date: "2026-03-03" },
    { author: "Lena Weiss", text: "The Chancellor is right.", quote: "#1", date: "2026-03-04" },
    { author: "Nobody Real", text: "Quoting a post that is not there.", quote: "p999" },
    { author: "Time Traveller", text: "Quoting a later post.", quote: "#5" },
    { author: "Self Quoter", text: "Quoting myself.", quote: "#4" },
  ], { feed, ...PERIOD });
  assert.deepEqual(posts.map((entry) => [entry.id, entry.author, entry.quote]), [
    ["p21", "Olaf Scholz", "p20"],
    ["p22", "Lena Weiss", "p21"],
  ]);
});

test("a quote is never dated before what it quotes, so it never comes first", () => {
  const feed = [post("p3", { date: "2026-03-15" })];
  const posts = readSkipPosts([
    { author: "Late Original", text: "Said on the 20th.", date: "2026-03-20" },
    { author: "Early Answer", text: "Answering it on the 2nd?", date: "2026-03-02", quote: "#1" },
    { author: "Feed Answer", text: "Answering the 15th's on the 1st?", date: "2026-03-01", quote: "p3" },
  ], { feed, ...PERIOD });
  const byAuthor = Object.fromEntries(posts.map((entry) => [entry.author, entry]));
  assert.equal(byAuthor["Early Answer"].date, "2026-03-20");
  assert.equal(byAuthor["Feed Answer"].date, "2026-03-15");
  assert.ok(Number(byAuthor["Early Answer"].id.slice(1)) > Number(byAuthor["Late Original"].id.slice(1)));
  assert.equal(byAuthor["Early Answer"].quote, byAuthor["Late Original"].id);
});

test("an off-topic post is kept as everyday; a repeat is not kept twice", () => {
  const feed = [post("p1", { text: "Same words." })];
  const posts = readSkipPosts([
    { author: "Taylor Quinn", role: "Singer", text: "New album out Friday!", offTopic: true },
    { author: "Someone Else", text: "Same words." },
  ], { feed, ...PERIOD });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].kind, "everyday");
});

test("the skip's segments hand on every segment's posts, and they land in the feed", () => {
  const merged = mergeSegmentPayloads([
    { events: [], summary: "One.", stopDate: "2026-03-15", socialPosts: [{ author: "A B", text: "First half." }] },
    { events: [], summary: "Two.", stopDate: "2026-03-31", socialPosts: [{ author: "C D", text: "Second half." }] },
    { events: [], summary: "Three.", stopDate: "2026-03-31" },
  ]);
  assert.equal(merged.socialPosts.length, 2);
  const world = { socialFeed: [] };
  const feed = withSkipPosts(world.socialFeed, readSkipPosts(merged.socialPosts, PERIOD));
  assert.deepEqual(feed.map((entry) => entry.text), ["First half.", "Second half."]);
});

test("the player posts as their country's leader, and may quote a post that is there", () => {
  const world = {
    countryStats: { "French Republic": { leader: "Claire Martin" } },
    socialFeed: [post("p4")],
  };
  const made = withPlayerPost(world, { by: "French Republic", text: "France will mediate.", quote: "p4", date: "2026-03-31", round: 6 });
  assert.equal(made.error, undefined);
  assert.deepEqual(
    { id: made.post.id, author: made.post.author, role: made.post.role, country: made.post.country, kind: made.post.kind, by: made.post.by, quote: made.post.quote, round: made.post.round },
    { id: "p5", author: "Claire Martin", role: "Leader of French Republic", country: "French Republic", kind: "player", by: "French Republic", quote: "p4", round: 6 },
  );
  assert.equal(made.world.socialFeed.length, 2);
  assert.equal(world.socialFeed.length, 1, "the world handed in is not changed");
});

test("the political model's leader is preferred, and a polity with none posts under its own name", () => {
  const world = {
    politicalActors: {
      byPolity: {
        "French Republic": {
          polityKey: "French Republic",
          politicalSystem: { type: "presidential republic" },
          government: { headOfState: { name: "Claire Martin", title: "President" } },
        },
      },
    },
  };
  assert.deepEqual(leaderOf(world, "French Republic"), { name: "Claire Martin", title: "President" });
  const made = withPlayerPost({}, { by: "Kingdom of Spain", text: "Hola.", date: "2026-03-31", round: 1 });
  assert.equal(made.post.author, "Kingdom of Spain");
  assert.equal(made.post.role, "");
});

test("a post the player cannot make is refused with a reason and nothing written", () => {
  assert.match(withPlayerPost({}, { by: "French Republic", text: "   " }).error, /words/);
  assert.match(withPlayerPost({}, { by: "", text: "Hello" }).error, /Nobody/);
  assert.match(withPlayerPost({}, { by: "French Republic", text: "x".repeat(SOCIAL_POST_MAX_CHARS + 1) }).error, /at most/);
  assert.match(withPlayerPost({ socialFeed: [] }, { by: "French Republic", text: "Hi", quote: "p9" }).error, /no longer there/);
});

test("the feed keeps its newest posts, and a quote of one that has gone is marked", () => {
  const many = Array.from({ length: SOCIAL_FEED_LIMIT + 5 }, (_, at) => post(`p${at + 1}`, { text: `Post ${at + 1}` }));
  many.push(post(`p${SOCIAL_FEED_LIMIT + 6}`, { quote: "p2", text: "Quoting an old one." }));
  const feed = normalizeSocialFeed(many);
  assert.equal(feed.length, SOCIAL_FEED_LIMIT);
  assert.equal(feed[0].id, "p7");
  assert.equal(feed.at(-1).quoteGone, true);
  // Malformed posts are left out, and the same id once.
  assert.deepEqual(normalizeSocialFeed([post("p1"), post("p1"), { id: "x", author: "A", text: "B" }, null]).map((entry) => entry.id), ["p1"]);
});

test("the tabs: everything, the player's country, what mentions them, and their own", () => {
  const feed = [
    post("p1", { author: "Claire Martin", kind: "player", by: "French Republic", country: "French Republic", text: "Paris speaks." }),
    post("p2", { author: "Olaf Scholz", country: "Federal Republic of Germany", quote: "p1", text: "We hear Paris." }),
    post("p3", { author: "Jean Dupont", country: "French Republic", text: "Strikes in Lyon." }),
    post("p4", { author: "Ana Lima", text: "Claire Martin should resign." }),
    post("p5", { author: "Taylor Quinn", kind: "everyday", text: "Coffee." }),
  ];
  const ids = (tab) => socialFeedView(feed, { tab, country: "French Republic", leader: "Claire Martin" }).map((entry) => entry.id).sort();
  assert.deepEqual(ids("all"), ["p1", "p2", "p3", "p4", "p5"]);
  assert.deepEqual(ids("country"), ["p1", "p3"]);
  assert.deepEqual(ids("mentions"), ["p2", "p4"]);
  assert.deepEqual(ids("mine"), ["p1"]);
  const quoting = socialFeedView(feed, { tab: "all" }).find((entry) => entry.id === "p2");
  assert.equal(quoting.quoted.id, "p1");
  assert.equal(mentionsPlayer(feed[0], { feed, country: "French Republic", leader: "Claire Martin" }), false, "not their own post");
});

test("the player's post has no reactions until a time skip has passed over it", () => {
  const mine = post("p1", { kind: "player", round: 6 });
  const answer = post("p2", { quote: "p1", round: 7 });
  assert.deepEqual(postEngagement(mine, [mine], 6), { quotes: 0, reposts: 0, likes: 0 });
  const later = postEngagement(mine, [mine, answer], 7);
  assert.equal(later.quotes, 1);
  assert.ok(later.likes > 0 && later.reposts > 0);
  assert.deepEqual(postEngagement(answer, [mine, answer], 7), postEngagement(answer, [mine, answer], 7), "the same every time it is drawn");
  assert.equal(compactCount(950), "950");
  assert.equal(compactCount(1234), "1.2K");
  assert.equal(compactCount(2500000), "2.5M");
});

test("the player's post is in the next skip's [Social Media] block, as their own public words", () => {
  const made = withPlayerPost({ countryStats: { "French Republic": { leader: "Claire Martin" } }, socialFeed: [post("p1")] }, {
    by: "French Republic", text: "France will not recognise the annexation.", date: "2026-03-31", round: 6,
  });
  const block = socialFeedPromptBlock({ feed: made.world.socialFeed, players: ["French Republic"], round: 6 });
  assert.match(block, /^\[Social Media\]/);
  assert.match(block, /p2 \| 2026-03-31 \| Claire Martin, Leader of French Republic, French Republic \[posted by the player, since the last time skip\]: "France will not recognise the annexation\."/);
  assert.match(block, /Posts by the leader of French Republic are the player's own words/);
  assert.match(block, /Write socialPosts:/);
  assert.match(block, /quote: that post's id/);
  // Whose voice: the skip never writes the player's own posts.
  assert.match(block, /Never write a post as the leader of French Republic, or as anyone who speaks for its government/);
  // After the next skip it is still the player's, no longer new.
  const after = socialFeedPromptBlock({ feed: made.world.socialFeed, players: ["French Republic"], round: 7 });
  assert.match(after, /\[posted by the player\]: "France will not/);
});

test("the block is bounded, and leads with the player's posts and the answers to them", () => {
  const filler = Array.from({ length: 80 }, (_, at) => post(`p${at + 1}`, { text: `${"Long words ".repeat(30)}${at}`, round: 3 }));
  const mine = post("p81", { kind: "player", by: "French Republic", round: 6, text: "Mine." });
  const answer = post("p82", { quote: "p81", round: 6, text: "An answer." });
  const feed = [...filler, mine, answer];
  const chosen = promptPosts(feed, { round: 6 }).map((entry) => entry.id);
  assert.ok(chosen.includes("p81") && chosen.includes("p82"));
  const block = socialFeedPromptBlock({ feed, players: ["French Republic"], round: 6 });
  assert.ok(block.length < SOCIAL_PROMPT_CHARS + 2600, `${block.length} chars`);
  assert.match(block, /p81 \|/);
  assert.match(block, /"Nothing has been posted yet\."|p82 \|/);
  assert.match(socialFeedPromptBlock({ feed: [], players: ["French Republic"], round: 1 }), /Nothing has been posted yet\./);
});

test("a post about nothing in world affairs is asked for every other skip", () => {
  assert.equal(wantsEverydayPost([], 3), true);
  const feed = [post("p1", { kind: "everyday", round: 3 })];
  assert.equal(wantsEverydayPost(feed, 3), false, "one came with the last skip");
  assert.equal(wantsEverydayPost(feed, 4), true);
  assert.match(socialFeedPromptBlock({ feed: [], players: ["X"], round: 1 }), /exactly one post about nothing in world affairs/);
  assert.match(socialFeedPromptBlock({ feed, players: ["X"], round: 3 }), /No post about everyday things this time/);
});

test("Refresh asks for a feed's worth of posts by public figures, never in the player's name", () => {
  const rules = rostraRefreshRules({ players: ["French Republic"], date: "1936-05-01" });
  assert.match(rules, new RegExp(`Write ${ROSTRA_REFRESH_POSTS} posts, dated 1936-05-01`));
  assert.match(rules, /Exactly one post about nothing in world affairs/);
  assert.match(rules, /"#n" for an earlier post of your list/);
  assert.match(rules, /Never write a post as the leader of French Republic, or as anyone who speaks for its government/);
  assert.match(rostraRefreshRules({ players: ["French Republic", "Kingdom of Spain"] }), /dated today.*\n[\s\S]*speaks for their governments/);
  assert.match(rostraRefreshRules(), /the leader of the player's polity/);
});

test("in a shared game every player's leader is the player's own to write", () => {
  const block = socialFeedPromptBlock({ feed: [], players: ["French Republic", "Kingdom of Spain"], round: 2 });
  assert.match(block, /Never write a post as the leader of French Republic, Kingdom of Spain, or as anyone who speaks for their governments/);
});
