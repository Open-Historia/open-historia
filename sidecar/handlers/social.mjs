import fs from "node:fs";
import path from "node:path";
import { cssHex, flagFile, loadExtras } from "./country.mjs";

const SEEN_KEY = "oh:rostra-seen";
const SEEN_GAMES_KEPT = 40;
const PLACE_GAMES_KEPT = 12;
const STOCK_REGION_ID = /^[A-Z]{3}\.\d+(?:_\d+)?$/;
const NOT_SAVED = "The post could not be saved. Try again.";

export const register = (ctx) => {
  const { engine, emit, clean, list } = ctx;
  const sf = () => engine.socialFeed;
  const fold = (value) => clean(value).toLocaleLowerCase();
  const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const readWorld = (force = false) => engine.gameState.readWorldStateView({ force }).catch(() => ({}));
  const readGame = (force = false) => engine.gameState.readGameData({ force }).catch(() => ({}));
  const enabled = () => {
    try {
      return engine.gameFeatures.isActiveFeatureEnabled("socialMedia") !== false;
    } catch {
      return true;
    }
  };
  const shared = () => Boolean(engine.mpBridge?.inSharedGame?.());
  const busy = () => Boolean(engine.simulationStatus.isSimulationBusy());
  const gameId = () => clean(engine.getLibraryState?.()?.activeGameId) || "game";
  const countryOf = (game) => engine.ownerNames.toCountryName(clean(game?.country)) || clean(game?.country);
  const readable = (value, pattern) => (clean(value) ? engine.gameDates.formatGameDateReadable(clean(value), pattern) || "" : "");
  const postDate = (value) => readable(value, "D MMM YYYY");
  const uiLanguage = () => {
    try {
      return clean(ctx.storage.getItem("ui_language")) || "en";
    } catch {
      return "en";
    }
  };
  const log = (message) => {
    try {
      engine.debugLog?.logDebugEvent?.("action", message);
    } catch {
      return;
    }
  };

  const initials = (name) => {
    const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
    return letters.map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "?";
  };

  const readSeen = () => {
    try {
      const raw = JSON.parse(ctx.storage.getItem(SEEN_KEY) || "{}");
      return isRecord(raw) ? raw : {};
    } catch {
      return {};
    }
  };
  const writeSeen = (id, number) => {
    try {
      const seen = readSeen();
      if ((Number(seen[id]) || 0) >= number) return;
      const kept = Object.entries({ ...seen, [id]: number }).slice(-SEEN_GAMES_KEPT);
      ctx.storage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(kept)));
    } catch {
      return;
    }
  };

  const flagCache = new WeakMap();
  const flagsFor = async (world, extras) => {
    const custom = (await engine.assets.getNationFlags().catch(() => ({}))) || {};
    const holder = isRecord(world) ? world : {};
    let entry = flagCache.get(holder);
    if (!entry || entry.custom !== custom) {
      entry = { custom, index: null, names: new Map() };
      flagCache.set(holder, entry);
    }
    const polities = isRecord(holder.polityOverrides) ? holder.polityOverrides : {};
    return (country) => {
      const name = clean(country);
      if (!name) return "";
      if (!entry.names.has(name)) {
        let url = "";
        try {
          entry.index ??= extras.polityIdentity.buildPolityIdentityIndex(holder);
          url = extras.polityFlags.resolvePolityFlag({ polity: name, world: holder, flags: custom, identityIndex: entry.index })?.imageUrl || "";
        } catch {
          url = "";
        }
        if (!url) {
          const key = polities[name] ? name : Object.keys(polities).find((item) => fold(polities[item]?.name) === fold(name)) || name;
          url = custom[key] || custom[name] || polities[key]?.flag || engine.flagImageUrlFromGid(key) || engine.flagImageUrlFromGid(name) || "";
        }
        let file = "";
        try {
          file = flagFile(ctx, url);
        } catch {
          file = "";
        }
        entry.names.set(name, file);
      }
      return entry.names.get(name);
    };
  };

  const pollView = (poll) => {
    if (!poll) return null;
    const results = poll.results;
    return {
      choices: list(poll.choices),
      winner: sf().pollWinner(poll),
      results: results ? {
        shares: list(results.shares).map((share) => Number(share) || 0),
        votes: results.votes ? Number(results.votes).toLocaleString() : "",
        consensus: clean(results.consensus),
      } : null,
    };
  };

  const quoteCard = (post, flag) => ({
    id: clean(post?.id),
    author: clean(post?.author),
    role: clean(post?.role),
    date: postDate(post?.date),
    text: String(post?.text ?? ""),
    flag: flag(post?.country),
    initials: initials(post?.author),
    mine: post?.kind === "player",
  });

  const postView = (post, { feed, round, country, flag }) => {
    const engagement = sf().postEngagement(post, feed, round);
    const mine = post.kind === "player" && fold(post.by || post.country) === fold(country);
    return {
      id: post.id,
      author: post.author,
      initials: initials(post.author),
      flag: flag(post.country),
      mine,
      date: postDate(post.date),
      hasMeta: Boolean(post.role || post.country || post.poll),
      meta: [post.role, post.country && post.country !== post.author ? post.country : ""].filter(Boolean).join(" · "),
      text: String(post.text ?? ""),
      poll: pollView(post.poll),
      quote: post.quote ? (post.quoteGone || !post.quoted ? { gone: true } : { gone: false, ...quoteCard(post.quoted, flag) }) : null,
      card: quoteCard(post, flag),
      waiting: post.kind === "player" && Number(round) <= Number(post.round),
      quotes: sf().compactCount(engagement.quotes),
      reposts: sf().compactCount(engagement.reposts),
      likes: sf().compactCount(engagement.likes),
    };
  };

  const context = async (force = false) => {
    const extras = await loadExtras(ctx);
    const [world, game] = await Promise.all([readWorld(force), readGame(force)]);
    const feed = list(world?.socialFeed);
    const country = countryOf(game);
    const round = Number(game?.round) || 0;
    const flag = await flagsFor(world, extras);
    return { extras, world, game, feed, country, round, flag };
  };

  const view = async ({ tab = "all", force = false } = {}) => {
    const { world, game, feed, country, round, flag } = await context(force);
    const social = sf();
    const account = social.playerAccount(world, country);
    const leader = social.leaderOf(world, country)?.name ?? "";
    const running = busy();
    const shown = tab === "search" ? [] : social.socialFeedView(feed, { tab, country, leader });
    return {
      enabled: enabled(),
      shared: shared(),
      country,
      author: account.author,
      role: account.role,
      playerFlag: flag(country),
      playerInitials: initials(account.author),
      date: postDate(game?.gameDate),
      round,
      busy: running,
      canPost: Boolean(country) && !running,
      tab,
      posts: shown.map((post) => postView(post, { feed, round, country, flag })),
      mentionCount: feed.filter((post) => social.mentionsPlayer(post, { feed, country, leader }) && Number(post.round) >= round).length,
      newest: social.newestPostNumber(feed),
      maxChars: social.SOCIAL_POST_MAX_CHARS,
      pollMin: social.POLL_CHOICES_MIN,
      pollMax: social.POLL_CHOICES_MAX,
      choiceMax: social.POLL_CHOICE_MAX_CHARS,
    };
  };

  const state = async () => {
    const world = await readWorld(false);
    const feed = list(world?.socialFeed);
    const seen = Number(readSeen()[gameId()]) || 0;
    return { enabled: enabled(), newest: sf().newestPostNumber(feed), unseen: sf().postsAfter(feed, seen) };
  };

  const post = async ({ text = "", quote = "", choices = null } = {}) => {
    const body = String(text ?? "").trim();
    const quoted = clean(quote);
    const poll = Array.isArray(choices) ? choices.map((choice) => clean(choice)).filter(Boolean) : null;
    try {
      if (shared()) {
        const answer = await engine.mpBridge.requestFromHost("post", { text: body, quote: quoted, ...(poll ? { choices: poll } : {}) });
        if (!answer?.ok) return { ok: false, error: clean(answer?.error) || "The host did not take the post." };
      } else {
        const game = await readGame(true);
        const country = countryOf(game);
        let refusal = "";
        await engine.gameState.mutateWorldState((world) => {
          const made = sf().withPlayerPost(world, { by: country, text: body, quote: quoted, date: clean(game?.gameDate), round: Number(game?.round) || 0, choices: poll });
          refusal = made.error || "";
          return made.error ? null : made.world;
        });
        if (refusal) return { ok: false, error: refusal };
      }
      log(`Posted on Rostra${quoted ? ` (quoting ${quoted})` : ""}${poll ? ` (a poll: ${poll.join(" / ")})` : ""}: ${body}`);
      return { ok: true };
    } catch (error) {
      emit("log", { category: "social", message: `The post could not be saved: ${error?.message ?? error}` });
      return { ok: false, error: NOT_SAVED };
    }
  };

  const refresh = async () => {
    try {
      const { kept } = await engine.gameplay.generateRostraPosts();
      return kept ? { ok: true, kept } : { ok: false, error: "No posts came back. Try again." };
    } catch (error) {
      return { ok: false, error: String(error?.message || error || "The posts could not be loaded.") };
    }
  };

  const placeFile = path.join(ctx.dataRoot, "native", "rostra-places.json");
  let placesKept = null;
  const placeRequests = new Map();

  const placesAll = () => {
    if (placesKept) return placesKept;
    try {
      const parsed = JSON.parse(fs.readFileSync(placeFile, "utf8"));
      placesKept = isRecord(parsed) ? parsed : {};
    } catch {
      placesKept = {};
    }
    return placesKept;
  };

  const placeStore = (pf, id) => {
    const key = clean(id);
    if (!key) return pf.emptyPlaceFeedStore();
    return pf.normalizePlaceFeedStore(placesAll()[key]);
  };

  const placeUpdate = (pf, id, change) => {
    const key = clean(id);
    if (!key) return pf.emptyPlaceFeedStore();
    const next = pf.normalizePlaceFeedStore(change(placeStore(pf, key)));
    const all = placesAll();
    all[key] = { id: key, updatedAt: Date.now(), ...next };
    const stale = Object.values(all)
      .sort((a, b) => (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0))
      .slice(PLACE_GAMES_KEPT)
      .map((row) => row.id);
    for (const old of stale) delete all[old];
    try {
      fs.mkdirSync(path.dirname(placeFile), { recursive: true });
      const temp = `${placeFile}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(all));
      fs.renameSync(temp, placeFile);
    } catch (error) {
      emit("log", { category: "social", message: `The feed was kept for this session only: ${error?.message ?? error}` });
    }
    return next;
  };

  const readSession = async (extras, world, game) => {
    const language = uiLanguage();
    return {
      gameId: clean(engine.getLibraryState?.()?.activeGameId),
      gameDate: String(game?.gameDate ?? ""),
      readFor: String(game?.gameDate ?? ""),
      uiLanguage: language,
      language: extras.placeFeed.placeFeedReadingLanguage({
        uiLanguage: language,
        uiLanguageName: extras.i18n.languageDisplayName(language),
        saveLanguage: world?.language || game?.language,
      }),
    };
  };

  let catalogRows = null;
  let mapRegions = { key: "", rows: [] };
  const loadCatalog = async () => {
    if (catalogRows) return catalogRows;
    const rows = await engine.assets.loadRegionCatalog().catch(() => []);
    catalogRows = Array.isArray(rows) ? rows : [];
    return catalogRows;
  };
  const ownershipKeyOf = (world) => {
    const overrides = world?.regionOwnershipOverrides ?? {};
    const names = world?.polityOverrides ?? {};
    return `${Object.keys(overrides).length}:${JSON.stringify(overrides).length}:${Object.keys(names).length}:${world?.customRegions ? 1 : 0}`;
  };
  const regionsOnMap = (catalog, world) => {
    const key = `${catalog.length}|${engine.getLibraryState?.()?.activeGameId ?? ""}|${ownershipKeyOf(world)}`;
    if (mapRegions.key === key) return mapRegions.rows;
    const overrides = world?.regionOwnershipOverrides ?? {};
    const drawn = Boolean(world?.customRegions) && catalog.some((region) => !STOCK_REGION_ID.test(String(region?.id ?? "")));
    const rows = catalog
      .filter((region) => !drawn || !STOCK_REGION_ID.test(String(region?.id ?? "")) || region?.custom === true || overrides[String(region?.id)] !== undefined)
      .map((region) => {
        const holder = String(overrides[String(region?.id)] ?? "").trim() || String(region?.country ?? "").trim();
        return { id: String(region.id), name: String(region.name ?? region.id), owner: holder ? engine.ownerNames.toCountryName(holder) || holder : "" };
      });
    mapRegions = { key, rows };
    return rows;
  };

  const find = async ({ query = "" } = {}) => {
    const extras = await loadExtras(ctx);
    const pf = extras.placeFeed;
    const [world, game, catalog] = await Promise.all([readWorld(false), readGame(false), loadCatalog()]);
    const regions = regionsOnMap(catalog, world);
    const country = countryOf(game);
    const names = new Set();
    for (const region of regions) if (region.owner) names.add(region.owner);
    for (const [key, record] of Object.entries(world?.polityOverrides ?? {})) names.add(clean(record?.name) || key);
    if (country) names.add(country);
    const hits = pf.placeFeedSearch({ query, countries: [...names].filter(Boolean), regions });
    return {
      query,
      hits: hits.map((hit) => ({
        place: hit,
        key: pf.placeFeedPlaceKey(hit),
        title: pf.placeFeedPlaceTitle(hit),
        scope: hit.scope,
        polity: hit.polity,
      })),
    };
  };

  const placeView = async ({ place = null, nationwide = false, session = null, asked = {}, loading = {}, failed = {}, wanted = {} } = {}) => {
    const { extras, world, game, feed, country, round, flag } = await context(false);
    const pf = extras.placeFeed;
    const own = pf.placeFeedPlace({ polity: country, polityKey: country });
    const target = pf.placeFeedPlace(place) ?? own;
    const countryOfTarget = target?.scope === "region" ? pf.placeFeedCountryOf(target) : null;
    const shown = nationwide && countryOfTarget ? countryOfTarget : target;
    const today = String(game?.gameDate ?? "");
    const fresh = isRecord(session) && clean(session.gameId) === clean(engine.getLibraryState?.()?.activeGameId) && String(session.readFor ?? "") === today;
    const open = fresh ? session : await readSession(extras, world, game);
    const store = placeStore(pf, open.gameId);
    const requestKey = shown ? pf.placeFeedRequestKey({ ...open, place: shown }) : "";
    const failure = requestKey && Object.prototype.hasOwnProperty.call(failed ?? {}, requestKey) ? String(failed[requestKey] ?? "") : null;
    const placeKey = pf.placeFeedPlaceKey(shown);
    const isWanted = Boolean(wanted?.[placeKey]);
    const state = pf.placeFeedView({
      store,
      place: shown,
      gameDate: open.gameDate,
      language: open.language,
      asked: Boolean(asked?.[requestKey]) || !isWanted,
      loading: Boolean(loading?.[requestKey]),
      failed: failure !== null,
    });
    const polity = shown?.scope === "country" ? shown.polity : "";
    const rostraPosts = polity ? sf().socialFeedView(feed, { tab: "country", country: polity }).slice(0, 6) : [];
    return {
      session: open,
      place: shown,
      target,
      placeKey,
      requestKey,
      title: pf.placeFeedPlaceTitle(shown),
      dateLong: readable(open.gameDate),
      tabs: countryOfTarget ? [target.regionName, countryOfTarget.polity] : null,
      nationwide: Boolean(nationwide && countryOfTarget),
      shouldAsk: state.shouldAsk,
      waiting: state.waiting,
      canAsk: state.canAsk,
      wanted: isWanted,
      failure,
      trends: state.trends,
      canPost: Boolean(country) && !busy(),
      rostraPosts: rostraPosts.map((entry) => postView(entry, { feed, round, country, flag })),
      batches: state.batches.map((batch, index) => {
        const line = pf.placeFeedBatchLine(state.batches, index, open.gameDate);
        return {
          id: batch.id,
          line: line ? (line.kind === "date" ? readable(line.gameDate) || line.gameDate : "Earlier") : "",
          posts: batch.posts.map((entry) => {
            const avatar = pf.placeFeedAvatar(entry.author);
            return {
              id: entry.id,
              author: entry.author,
              handle: entry.handle ? `@${entry.handle}` : "",
              age: `· ${pf.placeFeedAgeLabel(entry.minutesAgo, open.uiLanguage)}`,
              about: entry.about,
              text: entry.text,
              replies: pf.placeFeedCountLabel(entry.replies, open.uiLanguage),
              reposts: pf.placeFeedCountLabel(entry.reposts, open.uiLanguage),
              likes: pf.placeFeedCountLabel(entry.likes, open.uiLanguage),
              likesWithMine: pf.placeFeedCountLabel(entry.likes + 1, open.uiLanguage),
              initials: avatar.initials,
              colour: cssHex(avatar.colour),
            };
          }),
        };
      }),
    };
  };

  const placeLoad = async ({ place = null, language = "", key = "" } = {}) => {
    const extras = await loadExtras(ctx);
    const pf = extras.placeFeed;
    const target = pf.placeFeedPlace(place);
    if (!target) return { ok: false, error: "There is no place to show." };
    const name = clean(key) || pf.placeFeedPlaceKey(target);
    if (!placeRequests.has(name)) {
      const run = (async () => {
        const answer = await engine.gameplay.generatePlaceFeed({ place: target, language });
        const batch = pf.createPlaceFeedBatch(answer);
        placeUpdate(pf, answer.campaignId, (kept) => pf.addPlaceFeedBatch(kept, target, batch));
        return { campaignId: answer.campaignId, gameDate: answer.gameDate };
      })();
      placeRequests.set(name, run);
      run.finally(() => placeRequests.delete(name)).catch(() => {});
    }
    try {
      const outcome = await placeRequests.get(name);
      return { ok: true, ...outcome };
    } catch (error) {
      return { ok: false, error: String(error?.message || "") };
    }
  };

  if (ctx.standIn) {
    ctx.addStandIn(({ tool, text }) => {
      if (tool !== "submit_place_feed") return null;
      const near = /Paris|Île-de-France|France/.test(String(text));
      return {
        args: {
          posts: [
            { author: "Camille Bernard", handle: "camille_b", about: "Night-shift nurse, Créteil", text: near ? "Third strike notice this month. The RER was packed again and half the ward came in late." : "The buses were late again this morning.", minutesAgo: 4, likes: 38, reposts: 6, replies: 9 },
            { author: "Julien Moreau", handle: "jmoreau75", about: "Café owner, 11th arrondissement", text: "Terraces full despite the cold. People want to be outside together after everything.", minutesAgo: 22, likes: 214, reposts: 31, replies: 18 },
            { author: "Inès", handle: "ines.dessine", about: "Illustrator", text: "Lost cat near Place de la République: grey, answers to Biscotte. Please share!", filler: true, minutesAgo: 47, likes: 1240, reposts: 902, replies: 66 },
            { author: "Marc Lefèvre", handle: "", about: "Retired teacher", text: "The news from the south worries me. Nobody on television explains what we are doing there.", minutesAgo: 95, likes: 57, reposts: 4, replies: 23 },
          ],
          trends: ["#GrèveRER", "Sahel", "Biscotte", "Prix du gazole"],
        },
      };
    });
    ctx.addStandIn(({ tool, expected }) => {
      if (tool !== "submit_rostra_posts") return null;
      const day = clean(expected?.origin) || "";
      return {
        args: {
          posts: [
            { author: "Olaf Scholz", role: "Chancellor of Germany", country: "Germany", date: day, text: "Spoke with our partners in France tonight. Europe's answer to the energy crisis has to be a common one.", quote: "" },
            { author: "Rishi Sunak", role: "Prime Minister", country: "United Kingdom", date: day, text: "Britain will keep standing with its allies. Our support is not up for negotiation.", quote: "" },
            { author: "Anne Hidalgo", role: "Mayor of Paris", country: "France", date: day, text: "Paris is ready for the summit. The city will be open, safe and proud.", quote: "" },
            { author: "Christine Lagarde", role: "President of the European Central Bank", country: "", date: day, text: "Price stability comes first. We will do what is needed, and no more.", quote: "#1" },
            { author: "Kylian Mbappé", role: "Footballer", country: "France", date: day, text: "What a night at the Parc! Thank you to every single fan who sang until the end.", offTopic: true, quote: "" },
            { author: "Laura Kuenssberg", role: "Political journalist", country: "United Kingdom", date: day, text: "Downing Street insists nothing has changed. Ministers I spoke to are less sure.", quote: "#2" },
          ],
        },
      };
    });
  }

  return {
    "social.view": async (args) => view(args),
    "social.state": async () => state(),
    "social.seen": async ({ number = 0 } = {}) => {
      writeSeen(gameId(), Number(number) || 0);
      return true;
    },
    "social.post": async (args) => post(args),
    "social.refresh": async () => refresh(),
    "social.find": async (args) => find(args),
    "social.place": async (args) => placeView(args),
    "social.place.load": async (args) => placeLoad(args),
    ...(ctx.standIn ? {
      "social.testSkip": async ({ posts = [], pollResults = [] } = {}) => {
        const extras = await loadExtras(ctx);
        const game = await readGame(true);
        const round = Number(game?.round) || 0;
        await engine.gameState.mutateWorldState((world) => {
          const read = sf().readSkipPosts(posts, { feed: world.socialFeed, from: "", to: clean(game?.gameDate), round, knownNames: extras.countryInfoPanel.knownPolityNames(world) });
          const voted = sf().readSkipPollResults(pollResults, { feed: world.socialFeed, round });
          return { ...world, socialFeed: sf().withSkipPosts(voted.feed, read) };
        });
        return { ok: true };
      },
      "social.testFeature": async ({ on = true } = {}) => {
        await engine.refreshLibraryCatalog({ force: true });
        const library = engine.getLibraryState?.() ?? {};
        const id = clean(library.activeGameId);
        if (!id) return { ok: false, enabled: enabled() };
        const features = engine.cmServerFeatures.withFeatureOverride(library.activeGame?.features, "socialMedia", { enabled: Boolean(on) });
        await engine.library.saveGame(id, { features });
        await engine.refreshLibraryCatalog({ force: true });
        return { ok: true, enabled: enabled() };
      },
    } : {}),
  };
};
