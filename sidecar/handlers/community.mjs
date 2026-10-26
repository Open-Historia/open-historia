import fs from "node:fs";
import path from "node:path";

const GITHUB_ATTACHMENT_LIMIT = 25 * 1000 * 1000;
const SUGGESTION_CHECK_MS = 5 * 60 * 1000;

const DETAIL_FIELD_LABELS = {
  "meta.name": "Name",
  "meta.eyebrow": "Eyebrow",
  "meta.accentColor": "Accent",
  "meta.subtitle": "Subtitle",
  "meta.description": "Description",
  "meta.heroTitle": "Hero Title",
  "meta.heroSubtitle": "Hero Subtitle",
  "game.country": "Player Country",
  "game.startDate": "Start Date",
  "game.gameDate": "Game Date",
  "game.difficulty": "Difficulty",
  "game.language": "Language",
  "world.allowedUnitTypes": "Deployable Troop Types",
  "world.labelFont": "Country Label Font",
  "world.labelTextColor": "Label Letter Color",
  "world.labelHaloColor": "Label Border Color",
  "world.simulationRules": "Simulation Rules",
  "world.startingTimelineText": "World Before Round One",
};
const POLITICS_FIELD_LABELS = {
  politicalActors: "Political actors",
  institutions: "Institutions",
  powerStatus: "Power status",
  agreements: "Agreements",
  canonContext: "Canon context",
};
const MAP_SECTION_LABELS = {
  countries: "Countries",
  ownership: "Who owns which region",
  borders: "Borders",
  regions: "Region names and types",
  claims: "Claims",
  groups: "Groups",
  cities: "Cities",
  units: "Units",
  features: "Map features",
  puppets: "Puppet states",
  basemaps: "Basemaps",
  detailedMap: "Detailed map",
  settings: "Map settings",
};
const POLITICS_VALUE_CHARS = 90;
const POLITICS_PATHS_SHOWN = 5;

export const register = (ctx) => {
  const { engine, emit, plain, clean, list, cacheDir } = ctx;
  const lib = engine.library;
  const hub = engine.hubPosts;
  const hubFiles = engine.cmHubFiles;
  const provenance = engine.cmProvenance;
  const changesKit = engine.cmChanges;
  const suggestionKit = engine.cmSuggestion;
  const applyKit = engine.cmApply;

  let shown = [];
  const updating = new Set();
  const updateNotes = new Map();
  const reviews = new Map();
  const undoStore = new Map();
  let suggestionsCheckedAt = 0;
  let suggestDraft = null;

  const libraryState = () => engine.getLibraryState() ?? {};
  const scenariosNow = () => list(libraryState().scenarios);
  const scenarioById = (id) => scenariosNow().find((entry) => entry?.id === id) ?? null;
  const refreshLibrary = () => engine.refreshLibraryCatalog({ force: true }).catch(() => {});
  const messageOf = (error) => clean(error?.message ?? error) || "Something went wrong.";

  const links = () => ({
    hub: hub.HUB_URL,
    newPost: hub.HUB_NEW_POST_URL,
    discord: engine.cmLinks.DISCORD_URL,
    license: engine.edLicense.SCENARIO_LICENSE_URL,
  });

  const postView = (post) => ({
    id: Number(post?.id) || 0,
    title: String(post?.title ?? ""),
    author: String(post?.author ?? ""),
    avatarUrl: clean(post?.avatarUrl),
    url: clean(post?.url),
    createdAt: clean(post?.createdAt),
    pinned: post?.pinned === true,
    official: post?.official === true,
    upvotes: Number(post?.upvotes) || 0,
    comments: Number(post?.comments) || 0,
    installs: post?.installs === null || post?.installs === undefined ? null : Number(post.installs),
    description: String(post?.description ?? ""),
    fullDescription: String(post?.fullDescription ?? ""),
    hasBundle: Boolean(post?.bundleUrl),
    coverImageUrl: clean(post?.coverImageUrl),
    startDate: clean(post?.startDate),
  });

  const statusesOf = (posts) => {
    const copies = hub.hubCopiesByPostId(scenariosNow());
    const out = {};
    for (const post of list(posts)) {
      const { status, copy } = hub.hubCopyStatus(copies.get(Number(post?.id)), post);
      out[String(post.id)] = { status: status ?? "", copy: copy ? { id: clean(copy.id), name: clean(copy.name) } : null };
    }
    return out;
  };

  const publishable = () => scenariosNow().map((scenario) => ({ id: clean(scenario?.id), name: String(scenario?.name ?? "") }));

  const countHits = (text, query) => {
    if (!text) return 0;
    let count = 0;
    let from = 0;
    const lower = text.toLowerCase();
    while (true) {
      const index = lower.indexOf(query, from);
      if (index === -1) break;
      count += 1;
      from = index + query.length;
    }
    return count;
  };

  const browseOf = ({ query = "", from = "", to = "", sort = "installs" } = {}) => {
    const range = engine.cmDateRange;
    const fromBound = range.dateRangeBound(from);
    const toBound = range.dateRangeBound(to, { end: true });
    const needle = String(query ?? "").trim().toLowerCase();
    const dated = fromBound || toBound ? shown.filter((post) => range.startsBetween(post.startDate, fromBound, toBound)) : shown;
    const filtered = !needle ? dated : dated.filter((post) =>
      post.title.toLowerCase().includes(needle)
      || post.author.toLowerCase().includes(needle)
      || post.description.toLowerCase().includes(needle));
    let search = null;
    if (needle) {
      const weighted = filtered.map((post) => ({
        post,
        score: countHits(post.title, needle) * 5 + countHits(post.description, needle) * 3 + countHits(post.author, needle),
      }));
      weighted.sort((a, b) =>
        b.score - a.score
        || (b.post.installs ?? -1) - (a.post.installs ?? -1)
        || b.post.upvotes - a.post.upvotes
        || b.post.createdAt.localeCompare(a.post.createdAt));
      search = weighted.map((entry) => Number(entry.post.id));
    }
    const pinned = filtered.filter((post) => post.pinned);
    const browse = filtered.filter((post) => !post.pinned);
    if (sort === "likes") {
      browse.sort((a, b) => b.upvotes - a.upvotes || b.createdAt.localeCompare(a.createdAt));
    } else if (sort === "recent") {
      browse.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } else {
      browse.sort((a, b) =>
        (b.installs ?? -1) - (a.installs ?? -1)
        || b.upvotes - a.upvotes
        || b.createdAt.localeCompare(a.createdAt));
    }
    return {
      fromBound: fromBound ?? "",
      toBound: toBound ?? "",
      search,
      pinned: pinned.map((post) => Number(post.id)),
      browse: browse.map((post) => Number(post.id)),
    };
  };

  const detailedMapsOf = (bundle) => engine.cmBasemapPick.scenarioMapsOfWorld(bundle?.data?.world || {}).filter((map) => map.kind === "detailed");

  const describeScenarioTiledBasemap = (bundle) => {
    const detailed = detailedMapsOf(bundle);
    if (!detailed.length) return "";
    const unlisted = detailed.filter((map) => !map.detailed?.id);
    const offered = detailed.length === 1
      ? " Players installing it are offered its detailed map from the official list, with its size, as part of the install."
      : " Players installing it are offered its detailed maps from the official list, with their sizes, as part of the install.";
    if (!unlisted.length) return offered;
    const names = unlisted.map((map) => map.name).join(", ");
    const notListed = ` Not on the official Open Historia list: ${names}. Players see the drawn map it is shown over instead. To get one added, use ⤴ on it in the Map Editor's Maps window (My Maps → Your detailed maps): the Open Historia team reviews it and adds it to the list.`;
    return (unlisted.length < detailed.length ? offered : "") + notListed;
  };

  const installOffersFor = async (bundle) => {
    const named = detailedMapsOf(bundle);
    const offers = engine.cmDetailedOffers;
    return { offers: offers.detailedMapOffers(await offers.lookUpDetailedMaps(named)), count: named.length };
  };

  const offerView = (offer) => ({
    id: clean(offer?.id),
    version: Number(offer?.version) || 0,
    name: String(offer?.name ?? ""),
    bytes: Number(offer?.bytes) || 0,
    size: engine.cmTiled.formatBytes(offer?.bytes),
    have: offer?.have ?? null,
    needed: offer?.needed === true,
    starting: offer?.starting === true,
    ticked: offer?.ticked ?? null,
    wording: engine.cmTiledWording.tiledBasemapWording(offer, { atInstall: true }),
  });

  const countPublishableFlags = async (flagsData) => {
    const values = Object.values(flagsData ?? {}).filter((value) => typeof value === "string" && value.startsWith("data:"));
    if (!values.length) return 0;
    let communityHashes;
    try {
      communityHashes = new Set(
        list(await engine.cmFlagLibrary.listFlags())
          .filter((flag) => flag?.source?.community && flag?.contentHash)
          .map((flag) => flag.contentHash),
      );
    } catch {
      return values.length;
    }
    if (!communityHashes.size) return values.length;
    const hashes = await Promise.all(values.map((value) => engine.cmBasemapLibrary.sha256Hex(value).catch(() => null)));
    return hashes.filter((hash) => !hash || !communityHashes.has(hash)).length;
  };

  const writeStaged = async (folder, name, data) => {
    const file = path.join(folder, name);
    const bytes = data instanceof Uint8Array ? data : Buffer.from(await data.arrayBuffer());
    fs.writeFileSync(file, bytes);
    return file;
  };

  const publish = async (scenario) => {
    const bundle = await lib.exportScenarioBundle(scenario.id);
    const basemaps = engine.communityBasemaps;
    const dedup = await basemaps.dedupeScenarioBundleBackground(bundle).catch(() => ({ referenced: false, needsPublish: false }));
    const split = dedup.referenced ? null : await basemaps.splitScenarioBundleImage(bundle).catch(() => null);
    const files = {};
    let extra;
    if (split) {
      delete bundle.assets.backgroundData;
      files[split.imageName] = split.imageBytes;
      if (split.previewBytes) files[split.previewName] = split.previewBytes;
      extra =
        " Its custom basemap is bundled inside the .zip, so the scenario is self-contained — just drag the one file." +
        " (To also list the basemap on its own in the community Basemaps tab, open the editor's Basemap picker and hit ⤴ on it.)";
    } else {
      extra = dedup.referenced
        ? " Its custom basemap was reused from the community hub, so the file stays small."
        : "";
    }
    let hasCover = false;
    let coverBlob = null;
    let coverDownloadName = "";
    const cover = bundle.assets?.cover;
    if (cover?.mode === "embedded" && cover.data) {
      const ext = /png/i.test(cover.contentType || "") ? "png" : /webp/i.test(cover.contentType || "") ? "webp" : "jpg";
      try {
        coverBlob = await (await fetch(`data:${cover.contentType || "image/jpeg"};base64,${cover.data}`)).blob();
        files[`cover.${ext}`] = new Uint8Array(await coverBlob.arrayBuffer());
        coverDownloadName = `${scenario.id}-cover.${ext}`;
        hasCover = true;
      } catch {
        hasCover = false;
      }
    }
    const lifted = engine.edBundleFiles.splitBundleFiles(bundle);
    Object.assign(files, lifted.files);
    files["scenario.json"] = JSON.stringify(lifted.bundle);
    files[engine.edLicense.SCENARIO_LICENSE_FILE] = engine.edLicense.SCENARIO_LICENSE_TEXT;
    const fileName = `${scenario.id}-scenario.zip`;
    const zipped = await engine.bundleZip.zipBundle(files);
    const folder = path.join(cacheDir, "community-publish", `${Date.now()}`);
    fs.mkdirSync(folder, { recursive: true });
    const zipFile = await writeStaged(folder, fileName, zipped);
    const coverFile = coverBlob && coverDownloadName ? await writeStaged(folder, coverDownloadName, coverBlob) : "";
    const customFlagCount = await countPublishableFlags(bundle.assets?.flags?.data);
    const publishKey = scenario.hubPublished?.key || suggestionKit.newPublishKey();
    const technicalLines = [
      ...(split ? [`Basemap-Hash: ${split.hash}`, `Basemap-Kind: ${split.kind}`] : []),
      ...(customFlagCount > 0 ? [`Flags-Count: ${customFlagCount}`] : []),
      `${hub.SCENARIO_KEY_LINE}: ${publishKey}`,
    ];
    const url =
      `${hub.HUB_NEW_POST_URL}&title=${encodeURIComponent(`[Scenario] ${scenario.name}`)}` +
      `&technical=${encodeURIComponent(technicalLines.join("\n"))}`;
    extra += describeScenarioTiledBasemap(bundle);
    if (!scenario.hubPublished?.key) {
      await lib.saveScenario(scenario.id, {
        hubPublished: { ...(scenario.hubPublished ?? {}), key: publishKey, publishedAt: new Date().toISOString() },
      }).catch((error) => console.warn("[hub] could not record the publish key:", error));
    }
    const notice =
      `${hasCover ? `"${fileName}" and its cover image were` : `"${fileName}" was`} downloaded. ` +
      (hasCover
        ? "On the GitHub post page, drag both files into the Description box, then submit."
        : "On the GitHub post page, drag that file into the Description box, then submit.") +
      " If that page did not open, use the Open the GitHub post button." +
      `${hasCover ? " The cover image becomes the card's preview in the hub." : ""}${extra}`;
    const error = zipped.size > GITHUB_ATTACHMENT_LIMIT
      ? `"${fileName}" is ${(zipped.size / 1e6).toFixed(1)} MB, and GitHub takes files of up to 25 MB, so the post will refuse it. In the map editor select the scenario's most detailed regions, press Simplify, save, and publish again.`
      : "";
    return { fileName, zipFile, coverName: coverDownloadName, coverFile, url, notice, error };
  };

  const updateEvent = () => emit("community.updates", { running: [...updating], notes: Object.fromEntries(updateNotes) });

  const beginUpdate = (id) => {
    if (updating.has(id)) return false;
    updating.add(id);
    updateNotes.delete(id);
    updateEvent();
    return true;
  };

  const endUpdate = (id, note = "") => {
    if (!updating.has(id)) return;
    updating.delete(id);
    const text = String(note ?? "").trim();
    if (text) updateNotes.set(id, text);
    else updateNotes.delete(id);
    updateEvent();
  };

  const hubPostById = async () => {
    const posts = await hub.fetchHubPosts();
    return new Map(list(posts).map((post) => [Number(post.id), post]));
  };

  const updateScenario = async (scenario, post) => {
    if (!post?.bundleUrl || !beginUpdate(scenario.id)) return { started: false, note: "" };
    let outcome = "";
    try {
      const bundle = await hub.downloadHubScenario({ postId: post.id, bundleUrl: post.bundleUrl, title: post.title, author: post.author, flatMap: post.flatMap });
      engine.missingBasemap.noteMissingBasemapTried({ id: scenario.id, missingBasemap: provenance.missingBasemapOfBundle(bundle) });
      await lib.updateScenarioFromBundle(scenario.id, bundle);
      const missingBasemap = engine.communityBasemaps.unresolvedBundleBackground(bundle);
      if (missingBasemap) {
        outcome = `The scenario was updated, but its new community basemap could not be downloaded, so it keeps the basemap it had. ${missingBasemap} The game tries again the next time you start it and open the scenario.`;
      }
    } catch (error) {
      outcome = `Update failed: ${error.message}`;
    } finally {
      endUpdate(scenario.id, outcome);
    }
    return { started: true, note: outcome };
  };

  const openSuggestionsOf = (scenario) => list(provenance.openHubSuggestions(scenario?.hubPublished, scenario?.hubReviews));

  const postTitleOf = (origin) => origin?.title || `#${origin?.postId}`;

  const promptLabelOf = (pathParts) => {
    const [first, second, third] = pathParts;
    const sectionKey = first === "tasks" ? second : first;
    const segmentId = first === "tasks" ? third : second;
    const section = list(engine.edPrompts.PROMPT_EDITOR_SECTIONS).find((entry) => entry.key === sectionKey);
    const segment = list(engine.edGuidance.guidanceSegmentsFor(sectionKey)).find((entry) => entry.id === segmentId);
    return { section: section?.label || sectionKey, segment: segment?.label || segmentId };
  };

  const describeDetailChange = (change) => {
    if (change.kind === "field") {
      const [area, ...rest] = change.path;
      if (area === "features") {
        const definition = list(engine.cmServerFeatures.FEATURE_DEFINITIONS).find((entry) => entry.key === rest[0]);
        const setting = list(definition?.settings).find((entry) => entry.key === rest[1]);
        return { tab: "Features", title: definition?.label || rest[0], detail: rest[1] === "enabled" ? "On or off" : setting?.label || rest[1] };
      }
      if (area === "prompts") {
        const { section, segment } = promptLabelOf(rest);
        return { tab: "Prompts", title: section, detail: segment };
      }
      const key = `${area}.${rest[0]}`;
      return { tab: area === "meta" ? "Overview" : "World", title: DETAIL_FIELD_LABELS[key] || rest[0], detail: "" };
    }
    if (change.kind === "politics") return { tab: "Politics", title: POLITICS_FIELD_LABELS[change.field] || change.field, detail: change.label || "" };
    if (change.kind === "history") {
      return change.part === "setup"
        ? { tab: "Pre-history", title: "Summary and Day-one facts", detail: "" }
        : { tab: "Pre-history", title: "Pre-history event", detail: change.label || "" };
    }
    if (change.kind === "stats") return { tab: "Stats", title: "National Stats sheet", detail: "" };
    if (change.kind === "institutionLogos") return { tab: "Politics", title: "Institution logos", detail: "" };
    if (change.kind === "music") return { tab: "Music", title: "Scenario music", detail: "" };
    if (change.kind === "cover") return { tab: "Assets", title: "Cover Image", detail: "" };
    return { tab: "", title: change.kind, detail: "" };
  };

  const valueText = (value) => {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "On" : "Off";
    if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
    if (typeof value === "object") return `${Object.keys(value).length}`;
    return String(value);
  };

  const politicsValueText = (value) => {
    if (value === null || value === undefined || value === "") return "—";
    const text = Array.isArray(value) && value.every((item) => item === null || typeof item !== "object")
      ? value.join(", ")
      : typeof value === "object" ? JSON.stringify(value) : String(value);
    return text.length > POLITICS_VALUE_CHARS ? `${text.slice(0, POLITICS_VALUE_CHARS).trimEnd()}…` : text || "—";
  };

  const statsSummary = (sheet) => {
    const sections = Array.isArray(sheet?.sections) ? sheet.sections : [];
    const stats = sections.reduce((total, section) => total + (Array.isArray(section?.stats) ? section.stats.length : 0), 0);
    return sheet ? `${sections.length} sections, ${stats} stats` : "The standard sheet";
  };

  const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const COLOR = /^#[0-9a-f]{6}$/i;

  const valueView = (change, coverBefore) => {
    if (change.kind === "field" && (change.text || (typeof change.to === "string" && String(change.to).length > 60))) {
      return { type: "tracked", parts: applyKit.diffWords(change.from ?? "", change.to ?? "") };
    }
    if (change.kind === "cover") {
      return {
        type: "cover",
        before: coverBefore ? { base64: coverBefore.base64, contentType: coverBefore.contentType || "image/jpeg" } : null,
        after: change.to?.base64 ? { base64: change.to.base64, contentType: change.to.contentType || "image/jpeg" } : null,
      };
    }
    if (change.kind === "stats") return { type: "text", text: `${statsSummary(change.from)} → ${statsSummary(change.to)}` };
    if (change.kind === "politics" || change.kind === "history") {
      const text = change.op === "add" ? "Added" : change.op === "remove" ? "Removed" : "Changed";
      const whole = !change.op && (isRecord(change.from) || isRecord(change.to));
      const paths = change.op === "change" || whole
        ? list(changesKit.changedPathsOf(whole ? change.from ?? {} : change.from, whole ? change.to ?? {} : change.to, { max: POLITICS_PATHS_SHOWN }))
        : [];
      return {
        type: "politics",
        text,
        paths: paths.slice(0, POLITICS_PATHS_SHOWN).map((entry) => ({ path: String(entry.path), from: politicsValueText(entry.from), to: politicsValueText(entry.to) })),
        more: paths.length > POLITICS_PATHS_SHOWN,
      };
    }
    if (change.kind === "institutionLogos") return { type: "text", text: "Changed" };
    if (change.kind === "music") {
      const music = engine.scenarioMusic;
      const before = music.normalizeScenarioMusic(change.from);
      const after = music.normalizeScenarioMusic(change.to);
      const idsOf = (value, situation) => list(value?.[situation]).map((entry) => entry.id).join(", ");
      const situations = list(music.SCENARIO_MUSIC_SITUATIONS);
      const changed = situations.filter((situation) => JSON.stringify(before?.[situation] ?? []) !== JSON.stringify(after?.[situation] ?? []));
      const volumeBefore = music.scenarioMusicVolumes(before);
      const volumeAfter = music.scenarioMusicVolumes(after);
      const louder = situations.filter((situation) => volumeBefore[situation] !== volumeAfter[situation]);
      return {
        type: "music",
        volumes: louder.map((situation) => ({ label: music.MUSIC_SITUATION_LABELS[situation], before: `${volumeBefore[situation]}%`, after: `${volumeAfter[situation]}%` })),
        lists: changed.map((situation) => ({ label: music.MUSIC_SITUATION_LABELS[situation], before: idsOf(before, situation) || "—", after: idsOf(after, situation) || "—" })),
      };
    }
    return {
      type: "plain",
      from: valueText(change.from),
      to: valueText(change.to),
      fromColor: COLOR.test(String(change.from ?? "")) ? String(change.from) : "",
      toColor: COLOR.test(String(change.to ?? "")) ? String(change.to) : "",
    };
  };

  const rowView = (change, { status = "", decision = "", canUndo = true, coverBefore = null } = {}) => ({
    id: String(change.id),
    label: describeDetailChange(change),
    value: valueView(change, coverBefore),
    status: status || "",
    decision: decision || "",
    canUndo,
  });

  const mapSummaryOf = (changes, decided = null) => {
    const counts = new Map();
    for (const change of changes) {
      const section = engine.cmSections.sectionOfChange(change);
      const entry = counts.get(section) ?? { total: 0, decided: 0 };
      entry.total += 1;
      if (decided?.has(change.id)) entry.decided += 1;
      counts.set(section, entry);
    }
    return list(engine.cmSections.REVIEW_SECTIONS).filter((section) => counts.has(section.id)).map((section) => {
      const entry = counts.get(section.id);
      return {
        label: MAP_SECTION_LABELS[section.id],
        text: decided ? `${entry.decided} of ${entry.total} decided` : entry.total === 1 ? "1 change" : `${entry.total} changes`,
      };
    });
  };

  const reviewKeyOf = (source) => source?.ref?.id || source?.suggestion?.id || "";

  const undoesOf = (scenarioId, key) => {
    const id = `${scenarioId}\n${key}`;
    if (!undoStore.has(id)) undoStore.set(id, new Map());
    return undoStore.get(id);
  };

  const reviewView = (review) => {
    const scenario = scenarioById(review.scenarioId);
    const changes = list(review.suggestion?.changes);
    const detailChanges = changes.filter((change) => change.area === "details");
    const mapChanges = changes.filter((change) => change.area === "map");
    const decided = new Set([...review.decisions.accepted, ...review.decisions.rejected]);
    const settledCount = changes.filter((change) => decided.has(change.id)).length;
    const canUndo = (change) => !review.decisions.accepted.has(change.id) || review.undoes.has(change.id);
    const author = review.source?.ref?.author ? `@${review.source.ref.author}` : review.suggestion?.by || "";
    const when = review.source?.ref?.createdAt || review.suggestion?.createdAt || "";
    const pendingDetails = detailChanges.filter((change) => !decided.has(change.id) && review.statuses[change.id] !== "applied");
    return {
      key: review.key,
      scenarioId: review.scenarioId,
      scenarioName: String(scenario?.name ?? ""),
      phase: review.phase,
      error: review.error,
      author,
      when,
      refUrl: clean(review.source?.ref?.url),
      refAuthor: clean(review.source?.ref?.author),
      note: review.suggestion?.note || review.source?.ref?.note || "",
      status: review.status,
      total: changes.length,
      settled: settledCount,
      pendingDetails: pendingDetails.map((change) => String(change.id)),
      details: detailChanges.map((change) => rowView(change, {
        status: review.statuses[change.id],
        decision: review.decisions.accepted.has(change.id) ? "accepted" : review.decisions.rejected.has(change.id) ? "rejected" : "",
        canUndo: canUndo(change),
        coverBefore: review.coverBefore,
      })),
      map: mapChanges.length ? mapSummaryOf(mapChanges, decided) : [],
    };
  };

  const persistReview = async (review, nextDecisions, nextStatus) => {
    const scenario = scenarioById(review.scenarioId);
    const all = { ...(scenario?.hubReviews ?? {}) };
    all[review.key] = {
      status: nextStatus,
      accepted: [...nextDecisions.accepted],
      rejected: [...nextDecisions.rejected],
      updatedAt: new Date().toISOString(),
    };
    await lib.saveScenario(review.scenarioId, { hubReviews: all });
  };

  const decideReview = async (review, nextDecisions, nextStatus) => {
    await persistReview(review, nextDecisions, nextStatus ?? review.status);
    review.decisions = nextDecisions;
    if (nextStatus) review.status = nextStatus;
  };

  const applyReviewChanges = async (review, changes) => {
    if (!changes.length) return;
    const details = await lib.loadScenarioDetails(review.scenarioId);
    const { patch, uploads, clears } = applyKit.buildDetailSave(changes, details);
    await lib.withSingleLibraryRefresh(async () => {
      if (Object.keys(patch).length) await lib.saveScenario(review.scenarioId, patch, { refresh: false });
      for (const upload of uploads) {
        const blob = upload.json !== undefined
          ? new Blob([JSON.stringify(upload.json)], { type: "application/json" })
          : new Blob([Uint8Array.from(globalThis.atob(upload.base64), (char) => char.charCodeAt(0))], { type: upload.contentType });
        await lib.uploadScenarioAsset(review.scenarioId, upload.key, blob, { refresh: false });
      }
      for (const assetKey of clears) await lib.clearScenarioAsset(review.scenarioId, assetKey, { refresh: false });
    });
  };

  const findRef = (scenario, refId) => list(scenario?.hubPublished?.suggestions).find((ref) => ref?.id === refId) ?? null;

  const cardView = (scenario) => {
    if (!scenario) return null;
    const origin = scenario.hubOrigin;
    const published = scenario.hubPublished;
    const reviewsOf = scenario.hubReviews ?? {};
    const open = openSuggestionsOf(scenario);
    const openIds = new Set(open.map((ref) => ref.id));
    const reviewed = list(published?.suggestions).filter((ref) => !openIds.has(ref.id));
    const groups = [...open.reduce((byLogin, ref) => {
      const login = ref.author || "";
      byLogin.set(login, [...(byLogin.get(login) ?? []), ref]);
      return byLogin;
    }, new Map())].sort((a, b) => b[1].length - a[1].length);
    const refView = (ref) => ({
      id: String(ref.id),
      author: clean(ref.author),
      createdAt: clean(ref.createdAt),
      started: Boolean(reviewsOf[ref.id]),
      note: String(ref.note ?? ""),
      reviewStatus: clean(reviewsOf[ref.id]?.status),
    });
    return {
      id: clean(scenario.id),
      name: String(scenario.name ?? ""),
      origin: origin ? {
        title: postTitleOf(origin),
        author: clean(origin.author),
        postId: Number(origin.postId) || 0,
        postUrl: hub.hubPostUrl(origin.postId),
        edited: Boolean(origin.editedAt),
      } : null,
      published: published ? {
        postIds: list(published.postIds).map(Number),
        postUrls: list(published.postIds).map((postId) => hub.hubPostUrl(postId)),
        blocked: list(published.blocked).map(String),
      } : null,
      groups: groups.map(([login, refs]) => ({ login, refs: refs.map(refView) })),
      openCount: open.length,
      reviewed: reviewed.map(refView),
    };
  };

  const refreshSuggestionsFor = async (scenario, { force = false } = {}) => {
    if (!scenario?.hubPublished) return null;
    const posts = await hub.fetchHubPosts({ force });
    const { published, changed } = await hub.refreshPublishedRecord(scenario.hubPublished, posts, {
      fetchComments: (postId) => hub.fetchPostComments(postId, { force }),
      reviews: scenario.hubReviews,
      unlinked: scenario.hubUnlinked,
    });
    if (!changed) return published;
    const details = await lib.saveScenario(scenario.id, { hubPublished: published });
    return details?.scenario?.hubPublished ?? null;
  };

  const summaryRows = () => scenariosNow()
    .map((scenario) => ({ id: clean(scenario.id), name: String(scenario.name ?? ""), count: openSuggestionsOf(scenario).length }))
    .filter((row) => row.count > 0);

  return {
    "community.posts": async ({ force = false } = {}) => {
      const posts = await hub.fetchHubPosts({ force: force === true });
      shown = list(posts);
      await refreshLibrary();
      return { posts: shown.map(postView), library: statusesOf(shown), scenarios: publishable(), links: links() };
    },
    "community.library": async () => {
      await refreshLibrary();
      return { library: statusesOf(shown), scenarios: publishable() };
    },
    "community.browse": async (args = {}) => browseOf(args),
    "community.import": async ({ postId } = {}) => {
      const post = shown.find((entry) => Number(entry.id) === Number(postId));
      if (!post?.bundleUrl) throw new Error("This post has no scenario file attached");
      const bundle = await hub.downloadHubScenario({ postId: post.id, bundleUrl: post.bundleUrl, title: post.title, author: post.author, flatMap: post.flatMap });
      const details = await lib.importScenarioBundle(bundle);
      const { offers, count } = await installOffersFor(bundle).catch(() => ({ offers: [], count: 0 }));
      engine.missingBasemap.noteMissingBasemapTried(details?.scenario);
      return {
        scenario: details?.scenario ? { id: clean(details.scenario.id), name: String(details.scenario.name ?? "") } : null,
        missingBasemap: engine.communityBasemaps.unresolvedBundleBackground(bundle) ?? "",
        offers: offers.map(offerView),
        detailedCount: count,
        library: statusesOf(shown),
        scenarios: publishable(),
      };
    },
    "community.installMaps": async ({ offers = [] } = {}, { signal, id }) => {
      for (const offer of list(offers)) {
        const name = String(offer?.name ?? "");
        emit("community.mapProgress", { call: id, name, received: 0, total: 0 });
        await engine.cmTiled.installOfficialBasemap({
          id: clean(offer?.id),
          version: Number(offer?.version),
          signal,
          onProgress: ({ received, total }) => emit("community.mapProgress", { call: id, name, received: Number(received) || 0, total: Number(total) || 0 }),
        });
      }
      return true;
    },
    "community.publish": async ({ scenarioId } = {}) => {
      await refreshLibrary();
      const scenario = scenarioById(clean(scenarioId));
      if (!scenario) throw new Error("That scenario is no longer in your library.");
      return publish(scenario);
    },
    "community.updates": async () => {
      await refreshLibrary();
      const result = { reasons: {}, edited: {}, running: [...updating], notes: Object.fromEntries(updateNotes) };
      const scenarios = scenariosNow();
      if (!scenarios.some((entry) => entry.hubOrigin)) return result;
      const byId = await hubPostById().catch(() => null);
      for (const scenario of scenarios) {
        if (!scenario.hubOrigin) continue;
        result.edited[scenario.id] = Boolean(scenario.hubOrigin.editedAt);
        const reason = byId ? hub.hubUpdateReason(scenario, byId.get(Number(scenario.hubOrigin.postId)) ?? null) : null;
        if (reason) result.reasons[scenario.id] = reason;
      }
      return result;
    },
    "community.update": async ({ scenarioId, replaceEdits = false, postId = 0 } = {}) => {
      await refreshLibrary();
      const scenario = scenarioById(clean(scenarioId));
      if (!scenario) throw new Error("That scenario is no longer in your library.");
      const byId = await hubPostById().catch(() => new Map());
      const post = byId.get(Number(postId || scenario.hubOrigin?.postId)) ?? null;
      if (post?.bundleUrl && scenario.hubOrigin?.editedAt && replaceEdits !== true) {
        return { ask: { name: String(scenario.name ?? ""), postId: Number(post.id) } };
      }
      return updateScenario(scenario, post);
    },
    "community.music": async ({ force = false } = {}) => {
      const music = engine.hubMusic;
      const listed = await music.fetchHubMusic({ force: force === true });
      return { ...plain(listed), offered: plain(music.offeredTracks(listed)), problem: music.hubMusicProblem(listed) ?? "" };
    },
    "community.suggestions.summary": async () => {
      await refreshLibrary();
      return { rows: summaryRows() };
    },
    "community.suggestions.check": async ({ force = false } = {}) => {
      await refreshLibrary();
      const mine = scenariosNow().filter((entry) => entry.hubPublished);
      if (!mine.length || (!force && Date.now() - suggestionsCheckedAt < SUGGESTION_CHECK_MS)) return { rows: summaryRows(), checked: false };
      suggestionsCheckedAt = Date.now();
      try {
        const posts = await hub.fetchHubPosts();
        for (const scenario of mine) {
          const { published, changed } = await hub.refreshPublishedRecord(scenario.hubPublished, posts, {
            reviews: scenario.hubReviews,
            unlinked: scenario.hubUnlinked,
          });
          if (changed) await lib.saveScenario(scenario.id, { hubPublished: published });
        }
      } catch (error) {
        console.warn("[hub] could not check for suggested changes:", error?.message || error);
      }
      return { rows: summaryRows(), checked: true };
    },
    "community.card": async ({ scenarioId } = {}) => {
      await refreshLibrary();
      return cardView(scenarioById(clean(scenarioId)));
    },
    "community.suggestions.refresh": async ({ scenarioId } = {}) => {
      await refreshLibrary();
      const scenario = scenarioById(clean(scenarioId));
      try {
        const published = await refreshSuggestionsFor(scenario, { force: true });
        await refreshLibrary();
        const waiting = openSuggestionsOf({ ...scenario, hubPublished: published }).length;
        const note = !published?.postIds?.length
          ? "Your post is not on the hub yet. Once you have posted it, the game finds it by itself."
          : waiting === 1 ? "1 suggestion waiting." : waiting ? `${waiting} suggestions waiting.` : "Checked just now: no suggested changes waiting.";
        return { note, card: cardView(scenarioById(clean(scenarioId))) };
      } catch (error) {
        return { note: messageOf(error), card: cardView(scenarioById(clean(scenarioId))) };
      }
    },
    "community.unlinkOrigin": async ({ scenarioId } = {}) => {
      await lib.saveScenario(clean(scenarioId), { hubOrigin: null });
      await refreshLibrary();
      return cardView(scenarioById(clean(scenarioId)));
    },
    "community.forgetPost": async ({ scenarioId } = {}) => {
      await lib.saveScenario(clean(scenarioId), { hubPublished: null });
      await refreshLibrary();
      return cardView(scenarioById(clean(scenarioId)));
    },
    "community.rejectContributor": async ({ login } = {}) => {
      await refreshLibrary();
      const name = clean(login);
      for (const scenario of scenariosNow().filter((entry) => entry.hubPublished)) {
        const next = provenance.withContributorBlocked(scenario.hubPublished, name, true);
        if (next) await lib.saveScenario(scenario.id, { hubPublished: next });
      }
      await refreshLibrary();
      return { note: `Rejected everything from @${name}.` };
    },
    "community.unblockContributor": async ({ login, scenarioId = "" } = {}) => {
      await refreshLibrary();
      const name = clean(login);
      try {
        let drawerRecord = null;
        for (const scenario of scenariosNow().filter((entry) => provenance.isBlockedContributor(entry.hubPublished, name))) {
          const details = await lib.saveScenario(scenario.id, { hubPublished: provenance.withContributorBlocked(scenario.hubPublished, name, false) });
          if (details?.scenario?.id && details.scenario.id === clean(scenarioId)) drawerRecord = details.scenario;
        }
        if (drawerRecord) await refreshSuggestionsFor(drawerRecord, { force: true });
        await refreshLibrary();
        return { note: `@${name} is unblocked.` };
      } catch (error) {
        return { note: messageOf(error) };
      }
    },
    "community.suggest.compare": async ({ scenarioId } = {}) => {
      await refreshLibrary();
      const scenario = scenarioById(clean(scenarioId));
      const origin = scenario?.hubOrigin;
      const subtitle = origin ? `To “${postTitleOf(origin)}”${origin.author ? ` by ${origin.author}` : ""}, on the community hub` : "";
      const base = { subtitle, postUrl: hub.hubPostUrl(origin?.postId), fileName: suggestionKit.suggestionFileName(scenario?.name ?? "") };
      suggestDraft = null;
      try {
        const { bundleUrl, postId, release } = origin ?? {};
        const hubIndex = await hubFiles.fetchHubIndex();
        const problem = hubFiles.hubIndexProblem(hubIndex);
        if (problem) throw new Error(problem);
        if (hub.hubOriginalGone({ bundleUrl, release }, hubIndex)) {
          const posts = await hub.fetchHubPosts();
          const hubPost = list(posts).find((post) => Number(post.id) === Number(postId)) ?? null;
          return { ...base, phase: "outdated", canUpdate: Boolean(hubPost), hubPostId: hubPost ? Number(hubPost.id) : 0 };
        }
        const [original, current] = await Promise.all([hub.downloadHubBundle(bundleUrl), lib.exportScenarioBundle(scenario.id)]);
        const found = list(changesKit.diffScenarioBundles(original, current));
        suggestDraft = { scenarioId: scenario.id, changes: found };
        const counts = changesKit.countChanges(found);
        const total = counts.details + counts.map;
        return {
          ...base,
          phase: found.length ? "ready" : "empty",
          countText: total === 1 ? "1 change" : `${total} changes`,
          details: found.filter((change) => change.area === "details").map((change) => rowView(change)),
          map: mapSummaryOf(found.filter((change) => change.area === "map")),
        };
      } catch (error) {
        return { ...base, phase: "error", error: messageOf(error) };
      }
    },
    "community.suggest.send": async ({ scenarioId, by = "", note = "", path: target = "" } = {}) => {
      const scenario = scenarioById(clean(scenarioId));
      if (!scenario || !suggestDraft || suggestDraft.scenarioId !== scenario.id) throw new Error("Compare your copy with the original again first.");
      const suggestion = suggestionKit.buildSuggestion({ changes: suggestDraft.changes, scenario, origin: scenario.hubOrigin, by, note });
      const fileName = suggestionKit.suggestionFileName(scenario.name);
      const comment = suggestionKit.buildSuggestionComment(suggestion, { fileName });
      const zipped = await suggestionKit.buildSuggestionZip(suggestion);
      fs.writeFileSync(clean(target), Buffer.from(await zipped.arrayBuffer()));
      return { fileName, comment };
    },
    "community.review.open": async ({ scenarioId, refId = "", file = "" } = {}, { signal } = {}) => {
      await refreshLibrary();
      const scenario = scenarioById(clean(scenarioId));
      if (!scenario) throw new Error("That scenario is no longer in your library.");
      let source = null;
      if (clean(file)) {
        const bytes = fs.readFileSync(clean(file));
        const suggestion = await suggestionKit.readSuggestionFile(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        source = { suggestion };
      } else {
        const ref = findRef(scenario, clean(refId));
        if (!ref) throw new Error("That suggestion is no longer on the post.");
        source = { ref };
      }
      const key = reviewKeyOf(source);
      const reviewId = `${scenario.id}\n${key}`;
      const known = reviews.get(reviewId);
      const record = scenario.hubReviews?.[key];
      const review = {
        key,
        scenarioId: scenario.id,
        source: known?.source?.suggestion ? known.source : source,
        suggestion: known?.suggestion ?? source.suggestion ?? null,
        phase: "loading",
        error: "",
        statuses: {},
        decisions: { accepted: new Set(record?.accepted ?? []), rejected: new Set(record?.rejected ?? []) },
        status: record?.status || "reviewing",
        snapshot: null,
        coverBefore: null,
        undoes: undoesOf(scenario.id, key),
      };
      reviews.set(reviewId, review);
      try {
        const next = review.suggestion ?? await suggestionKit.readSuggestionFile(await hub.downloadHubFile(review.source.ref.zipUrl, { copy: false }));
        if (signal?.aborted) throw new Error("Cancelled.");
        review.suggestion = next;
        review.source = { ...review.source, suggestion: next };
        const current = await lib.exportScenarioBundle(scenario.id);
        const snapshot = changesKit.buildScenarioSnapshot(current);
        review.snapshot = snapshot;
        review.coverBefore = snapshot.cover ? { base64: snapshot.cover.base64, contentType: snapshot.cover.contentType, hash: snapshot.cover.hash } : null;
        review.statuses = applyKit.detailStatuses(next.changes, snapshot);
        review.phase = "ready";
      } catch (error) {
        review.error = messageOf(error);
        review.phase = "error";
      }
      return reviewView(review);
    },
    "community.review.act": async ({ scenarioId, key, op, ids = [], status = "" } = {}) => {
      const review = reviews.get(`${clean(scenarioId)}\n${clean(key)}`);
      if (!review) throw new Error("Open the suggestion again.");
      await refreshLibrary();
      review.error = "";
      const changes = list(review.suggestion?.changes);
      const decided = () => new Set([...review.decisions.accepted, ...review.decisions.rejected]);
      const picked = changes.filter((change) => list(ids).includes(String(change.id)));
      try {
        if (op === "status") {
          await decideReview(review, review.decisions, clean(status));
        } else if (op === "reject") {
          const done = decided();
          const pending = picked.filter((change) => !done.has(change.id));
          if (pending.length) {
            await decideReview(review, { accepted: review.decisions.accepted, rejected: new Set([...review.decisions.rejected, ...pending.map((change) => change.id)]) });
          }
        } else if (op === "accept") {
          const done = decided();
          const pending = picked.filter((change) => !done.has(change.id) && review.statuses[change.id] !== "applied");
          if (pending.length) {
            for (const change of pending) {
              const before = change.kind === "cover" ? review.coverBefore : applyKit.detailValueIn(review.snapshot, change);
              review.undoes.set(change.id, change.kind === "cover"
                ? applyKit.inverseOf(change, before ? { hash: before.hash, contentType: before.contentType, base64: before.base64 } : null)
                : applyKit.inverseOf(change, before));
            }
            await applyReviewChanges(review, pending);
            for (const change of pending) applyKit.applyToSnapshot(review.snapshot, change);
            review.statuses = { ...review.statuses, ...Object.fromEntries(pending.map((change) => [change.id, "applied"])) };
            await decideReview(review, { accepted: new Set([...review.decisions.accepted, ...pending.map((change) => change.id)]), rejected: review.decisions.rejected })
              .catch((error) => { throw new Error(`Your scenario was changed, but the decision could not be saved: ${messageOf(error)}`); });
          }
        } else if (op === "undo") {
          const change = picked[0];
          const canUndo = change && (!review.decisions.accepted.has(change.id) || review.undoes.has(change.id));
          if (canUndo) {
            const inverse = review.decisions.accepted.has(change.id) ? review.undoes.get(change.id) : null;
            if (!(review.decisions.accepted.has(change.id) && !inverse)) {
              if (inverse) {
                await applyReviewChanges(review, [inverse]);
                applyKit.applyToSnapshot(review.snapshot, inverse);
              }
              const accepted = new Set(review.decisions.accepted);
              const rejected = new Set(review.decisions.rejected);
              accepted.delete(change.id);
              rejected.delete(change.id);
              review.statuses = { ...review.statuses, [change.id]: applyKit.detailChangeStatus(change, review.snapshot) };
              await decideReview(review, { accepted, rejected }, "reviewing")
                .catch((error) => { throw new Error(inverse ? `Your scenario was changed back, but the decision could not be saved: ${messageOf(error)}` : messageOf(error)); });
              review.undoes.delete(change.id);
            }
          }
        }
      } catch (error) {
        review.error = messageOf(error);
      }
      await refreshLibrary();
      return reviewView(review);
    },
    "community.review.close": async ({ scenarioId, key } = {}) => {
      reviews.delete(`${clean(scenarioId)}\n${clean(key)}`);
      return true;
    },
  };
};
