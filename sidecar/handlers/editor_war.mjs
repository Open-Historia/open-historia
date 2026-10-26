const HEAVY_DATA = ["actions", "advisor", "chat", "events", "intercepts", "snapshots"];

const standInNames = (text) => {
  const block = /CURRENT ROUND-ONE POLITIES[^\n]*\n([\s\S]*?)(?:\n\s*\n|$)/.exec(String(text))?.[1] ?? "";
  return [...block.matchAll(/^- (.+)$/gm)].map((match) => match[1].trim()).filter(Boolean);
};

const standInStart = (text) => {
  const found = /baseline for (-?\d{1,6})-(\d{2})-(\d{2}) as JSON only/.exec(String(text));
  return found ? { year: Number(found[1]), month: Number(found[2]), day: Number(found[3]) } : { year: 2016, month: 1, day: 1 };
};

const standInDate = (start, yearsBack, month, day) => {
  let year = start.year - yearsBack;
  if (start.year > 0 && year <= 0) year -= 1;
  const sign = year < 0 ? "-" : "";
  return `${sign}${String(Math.abs(year)).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const pregameStandIn = (text) => {
  const names = standInNames(text);
  const pick = (wanted, fallback) => names.find((name) => name === wanted) ?? fallback;
  const first = pick("France", names[0] ?? "France");
  const second = pick("Germany", names.find((name) => name !== first) ?? "Germany");
  const third = pick("Ukraine", names.find((name) => name !== first && name !== second) ?? "Ukraine");
  const fourth = pick("Russia", names.find((name) => ![first, second, third].includes(name)) ?? "Russia");
  const start = standInStart(text);
  const events = [
    { ref: "e1", date: standInDate(start, 2, 3, 18), title: `${fourth} takes the peninsula from ${third}`, description: `${fourth} moves troops onto a peninsula held by ${third} and declares it annexed after a hurried vote.`, importance: "major", kind: "military", tags: ["Military", "Politics"] },
    { ref: "e2", date: standInDate(start, 2, 4, 6), title: `Fighting breaks out in eastern ${third}`, description: `Armed separatists seize government buildings in the east of ${third}, and the army moves against them.`, importance: "major", kind: "military", tags: ["Military"] },
    { ref: "e3", date: standInDate(start, 1, 2, 12), title: "A ceasefire is signed and broken", description: `${first} and ${second} broker a ceasefire between ${third} and ${fourth}; the shelling resumes within weeks.`, importance: "minor", kind: "diplomacy", tags: ["Diplomacy"] },
    { ref: "e4", date: standInDate(start, 1, 11, 13), title: `Attacks strike the capital of ${first}`, description: `Coordinated attacks kill scores of people in the capital of ${first}, which declares a state of emergency.`, importance: "major", kind: "domestic", tags: ["Politics"] },
  ];
  const facts = [
    { ref: "f1", kind: "war", title: `War in eastern ${third}`, status: "active", sideA: [third], sideB: [fourth], startedDate: standInDate(start, 2, 4, 6), note: "Positional fighting along a long line of contact.", sourceEventRefs: ["e2"] },
    { ref: "f2", kind: "relation", a: first, b: second, score: 70, summary: "Close partners at the heart of their continent's union." },
  ];
  return {
    eventsJson: JSON.stringify(events),
    summary: `Two years of crisis lead into the start date: war in eastern ${third}, a broken ceasefire, and attacks on ${first} that harden its government.`,
    canonicalUpdatesJson: JSON.stringify(facts),
  };
};

const hashOf = (text) => {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
};

const militaryStandIn = (text) => {
  const message = String(text);
  const marks = ["RATE THESE", "RATE THIS ONE", "THE WORLD'S POLITIES"];
  const at = Math.max(...marks.map((mark) => message.lastIndexOf(mark)));
  if (at < 0) return null;
  const block = message.slice(at);
  const picking = block.startsWith("THE WORLD'S POLITIES");
  const names = [...block.matchAll(/^- ([^;\n]+)/gm)].map((match) => match[1].trim()).filter(Boolean);
  const chosen = picking ? names.slice(0, 20) : names;
  const polities = chosen.map((name) => {
    const seed = hashOf(name);
    const figure = (shift, least, span) => least + ((seed >>> shift) % span);
    return {
      polity: name,
      population: 1000000 + (seed % 90000000),
      military: {
        quality: figure(0, 35, 50),
        technology: figure(3, 30, 55),
        land: figure(6, 30, 60),
        sea: figure(9, 10, 70),
        air: figure(12, 10, 70),
        spending: figure(15, 25, 60),
        manpowerShare: 12,
        cavalryShare: 0.15,
        siegeShare: 0.1,
      },
    };
  });
  return { text: JSON.stringify({ polities }) };
};

export const register = (ctx) => {
  const { engine, emit, plain, clean, list } = ctx;
  const lib = engine.library;

  if (ctx.standIn && typeof ctx.addStandIn === "function") {
    ctx.addStandIn(({ tool, text }) => {
      if (tool === "submit_pregame_history") return { args: pregameStandIn(text) };
      if (!tool && String(text).includes("You are Open Historia's military assessor")) return militaryStandIn(text);
      return null;
    });
  }

  const detailsView = (details) => {
    const view = plain(details);
    if (view?.data && typeof view.data === "object") {
      for (const key of HEAVY_DATA) delete view.data[key];
    }
    return view;
  };

  const militaryStatus = (world) => {
    const roster = engine.warScenarioMilitary.scenarioMilitaryRoster(world ?? {});
    const rated = roster.filter((entry) => !engine.warScenarioMilitary.wantsMilitaryRating(entry)).length;
    return { rated, total: roster.length };
  };

  const frontCountries = (world = {}) => engine.warPolities.collectScenarioPoliticalPolities(world)
    .filter((entry) => entry.hasTerritory && entry.active !== false)
    .map((entry) => ({ key: entry.polityKey, label: String(world.polityOverrides?.[entry.polityKey]?.name || entry.polityKey) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const generatedRecords = new Map();

  const stableKey = (value) => JSON.stringify(value ?? null, (_key, entry) => (
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
      : entry
  ));

  const withOriginalUpdates = (draft, records) => {
    const families = engine.scenarioPrehistory.PREHISTORY_UPDATE_FAMILIES;
    const originals = new Map();
    for (const record of records) {
      for (const family of families) {
        for (const update of list(record?.updates?.[family])) originals.set(`${family}:${stableKey(update)}`, update);
      }
    }
    const updates = {};
    for (const family of families) {
      updates[family] = list(draft?.updates?.[family]).map((update) => originals.get(`${family}:${stableKey(update)}`) ?? update);
    }
    return { ...draft, updates };
  };

  const scenarioIdOf = (value) => {
    const id = clean(value);
    if (!id) throw new Error("No scenario is open in the editor.");
    return id;
  };

  return {
    "editor.history.generate": async ({ scenarioId, prompt = "" }, { signal }) => {
      const id = scenarioIdOf(scenarioId);
      const details = await lib.loadScenarioDetails(id);
      const [regionsGeojson, citiesGeojson, tags] = await Promise.all(["regionsGeojson", "citiesGeojson", "tags"]
        .map((key) => lib.downloadScenarioJsonAsset(id, key).catch(() => null)));
      const generated = await engine.gameplay.generateScenarioPrehistory({
        details,
        prompt: String(prompt ?? ""),
        assets: { regionsGeojson, citiesGeojson, tags },
        signal,
      });
      generatedRecords.set(id, generated);
      return { record: plain(engine.scenarioPrehistory.normalizeScenarioPrehistory(generated, { draft: true })) };
    },
    "editor.history.save": async ({ scenarioId, draft = null, prompt = "" }) => {
      const id = scenarioIdOf(scenarioId);
      const prehistory = engine.scenarioPrehistory;
      const current = await lib.loadScenarioDetails(id).catch(() => null);
      const given = withOriginalUpdates(draft && typeof draft === "object" ? draft : {}, [current?.data?.world?.prehistory, generatedRecords.get(id)]);
      const record = prehistory.normalizeScenarioPrehistory({ ...given, prompt: String(prompt ?? "") });
      const nextDetails = await lib.saveScenario(id, { worldPatch: { prehistory: record } });
      return { details: detailsView(nextDetails), draft: plain(prehistory.normalizeScenarioPrehistory(record, { draft: true })) };
    },
    "editor.war.militaryStatus": async ({ scenarioId }) => {
      const details = await lib.loadScenarioDetails(scenarioIdOf(scenarioId));
      return militaryStatus(details?.data?.world ?? {});
    },
    "editor.war.rate": async ({ scenarioId, again = false, gameDate = "", warSettings = null }, { signal, id: call }) => {
      const id = scenarioIdOf(scenarioId);
      const military = engine.warScenarioMilitary;
      const settings = engine.warRules.normalizeWarSettings(warSettings);
      const tried = new Set();
      let current = await lib.loadScenarioDetails(id);
      let done = 0;
      try {
        for (;;) {
          if (signal.aborted) return { message: "Stopped. What was rated is saved with the scenario." };
          const world = current?.data?.world ?? {};
          const roster = military.scenarioMilitaryRoster(world);
          const request = military.nextMilitaryRequest(roster, { tried, again: again === true });
          if (!request) return { message: "Every country has its figures." };
          const from = done + 1;
          const to = done + (request.polities?.length ?? 0);
          emit("editor.war.progress", { call, text: request.pickFrom ? "Rating the strongest twenty first…" : `Rating ${from} to ${to} of ${roster.length}…` });
          const ratings = await engine.warMilitaryRating.rateMilitaryBatch({
            ...(request.pickFrom ? { pickFrom: request.pickFrom } : { polities: request.polities }),
            rated: request.rated,
            date: String(gameDate ?? ""),
            era: engine.warMotion.eraOf(String(gameDate ?? ""), settings?.era ?? null),
            rules: world.simulationRules ?? "",
          });
          for (const key of request.pickFrom ? military.ratedKeys(roster, ratings) : request.wanted.map((entry) => entry.key)) tried.add(key);
          const { world: next, written } = military.withMilitaryRatings(world, roster, ratings, { again: again === true });
          done += written.length;
          if (written.length > 0) {
            const saved = await lib.saveScenario(id, { world: next });
            current = saved;
            emit("editor.war.saved", { call, details: detailsView(saved), status: militaryStatus(saved?.data?.world ?? {}) });
          }
        }
      } catch (failure) {
        return { error: `The AI could not rate them: ${String(failure?.message ?? failure)}` };
      }
    },
    "editor.war.fronts": async ({ scenarioId }) => {
      const details = await lib.loadScenarioDetails(scenarioIdOf(scenarioId));
      const world = details?.data?.world ?? {};
      return {
        countries: frontCountries(world),
        fronts: plain(engine.warScenarioFronts.normalizeScenarioFronts(world.scenarioFronts, { draft: true })),
      };
    },
    "editor.war.saveFronts": async ({ scenarioId, fronts = [] }) => {
      const id = scenarioIdOf(scenarioId);
      const scenarioFronts = engine.warScenarioFronts.normalizeScenarioFronts(list(fronts));
      const nextDetails = await lib.saveScenario(id, { worldPatch: { scenarioFronts } });
      return {
        details: detailsView(nextDetails),
        fronts: plain(engine.warScenarioFronts.normalizeScenarioFronts(scenarioFronts, { draft: true })),
        countries: frontCountries(nextDetails?.data?.world ?? {}),
      };
    },
  };
};
