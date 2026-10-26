import fs from "node:fs";
import path from "node:path";

const asText = (value) => String(value ?? "").trim();
const fold = (value) => asText(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);
const sameCountry = (a, b) => fold(a) === fold(b);

const FOCUS_LABELS = Object.freeze({
  diplomacy: "Diplomacy",
  military: "Military",
  research: "Research and technology",
  economy: "Economic policy",
  politics: "Internal politics",
});

const OPERATION_LABELS = Object.freeze({
  sabotage: "Sabotage",
  recruit: "Recruit",
  assassinate: "Assassinate",
  operation: "Other operation",
});

const successLabel = (chance) => (chance >= 0.7 ? "Good" : chance >= 0.45 ? "Even" : chance >= 0.25 ? "Poor" : "Slim");
const captureLabel = (chance) => (chance >= 0.45 ? "High" : chance >= 0.2 ? "Moderate" : "Low");

const operationOutcomeText = (record) => {
  if (record.outcome === "foiled") return "Failed: the agent reports it could not be done";
  if (!record.caught) return record.outcome === "success" ? "Succeeded, and was never traced" : "Failed, and nobody noticed";
  if (!record.identified) {
    return record.outcome === "success"
      ? "Succeeded, but the agent was caught and died in custody without giving you away"
      : "Failed: the agent was caught and died in custody without giving you away";
  }
  return record.outcome === "success" ? "Succeeded, but the agent was caught and identified" : "Failed: the agent was caught and identified";
};

const operationTone = (record) => {
  if (record.outcome === "success" && !record.caught) return "good";
  if (record.caught) return "bad";
  return "muted";
};

const intelligenceCapabilityLabel = (value) => {
  const score = Math.max(0, Math.min(100, Number(value) || 0));
  if (score >= 85) return "Advanced";
  if (score >= 70) return "Capable";
  if (score >= 50) return "Limited";
  if (score >= 30) return "Developing";
  return "Minimal";
};

const sourceQualityLabel = (confidence, clarity, hasNetwork) => {
  const label = asText(confidence);
  if (label) return label;
  if (!hasNetwork) return "None";
  if (clarity >= 0.72) return "High";
  if (clarity >= 0.46) return "Moderate";
  return "Low";
};

const networkQualityLabel = (clarity, hasNetwork) => {
  if (!hasNetwork) return "None";
  if (clarity >= 0.72) return "Strong";
  if (clarity >= 0.46) return "Moderate";
  return "Limited";
};

const politicalKnowledgeLabel = (knowledge) => {
  if (knowledge?.level === "classified") return "Strong";
  if (knowledge?.level === "assessed") return "Limited";
  return "Public";
};

const diplomaticKnowledgeLabel = (entry, clarity, hasNetwork) => {
  if (!hasNetwork) return "Public";
  const count = Array.isArray(entry?.exchanges) ? entry.exchanges.length : 0;
  if (count >= 3 && clarity >= 0.6) return "Strong";
  return "Limited";
};

const officeholderLabel = (holder) => {
  if (!holder) return "";
  if (typeof holder === "string") return holder;
  return asText(holder?.name || holder?.id);
};

const capitalizeWords = (text) => String(text ?? "").replace(/(^|\s)(\S)/g, (_match, space, letter) => space + letter.toUpperCase());

export const register = ({ engine, emit, plain, repo, addStandIn, standIn }) => {
  const S = () => engine.spycraft;
  let pendingChange = null;
  const changed = (reason) => {
    if (pendingChange) return;
    pendingChange = setTimeout(() => {
      pendingChange = null;
      emit("intelligence.changed", { reason });
    }, 150);
  };
  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("oh:runtime-json-updated", (event) => {
      const url = event?.detail?.url;
      if (url === engine.JSON_URLS.world || url === engine.JSON_URLS.intercepts) changed("write");
    });
    if (engine.unseenEvents?.UNSEEN_EVENTS_CHANGED) globalThis.addEventListener(engine.unseenEvents.UNSEEN_EVENTS_CHANGED, () => changed("reveal"));
    globalThis.addEventListener("oh:active-game-changed", () => changed("game"));
  }
  const standInState = { targets: [], date: "" };
  if (standIn && typeof addStandIn === "function") {
    addStandIn(({ tool, text }) => {
      if (tool !== "submit_spy_intercept") return null;
      const target = standInState.targets.find((name) => String(text ?? "").includes(name)) || standInState.targets[0] || "";
      if (!target) return null;
      const counterpart = target === "Poland" ? "Italy" : "Poland";
      return {
        args: {
          exchanges: [{
            counterpart,
            date: standInState.date || "2016-01-01",
            subject: "Gas transit terms for the winter",
            messages: [
              { speaker: target, text: `We will not sign the transit terms until ${counterpart} drops the new fee. Keep this away from Paris until the vote.` },
              { speaker: counterpart, text: "Then the fee stays, and you can explain the shortfall to your industry in January. Our offer expires on Friday." },
              { speaker: target, text: "Halve it and we back your candidate for the energy commission. That is our last word." },
            ],
          }],
          politicalAssessment: {
            summary: `${target}'s cabinet is split on energy policy and wary of concessions before the coalition vote.`,
            findings: [
              { topic: "Leadership risk appetite", assessment: "Cautious: ministers avoid open confrontation while the coalition is fragile." },
              { topic: "Elite pressure", assessment: "Industry lobbies press hard for cheaper gas before winter." },
            ],
          },
        },
      };
    });
  }
  const seal = () => engine.spySeal;
  const found = new Map();
  const exported = (name) => {
    if (found.has(name)) return found.get(name);
    let hit = null;
    for (const value of Object.values(engine)) {
      if (value && typeof value === "object" && typeof value[name] === "function") {
        hit = value[name];
        break;
      }
    }
    if (hit) found.set(name, hit);
    return hit;
  };
  const need = (space, fn) => {
    const target = engine[space]?.[fn] || exported(fn);
    if (typeof target !== "function") throw new Error(`The engine bundle does not export ${space}.${fn}.`);
    return target;
  };
  const readable = (reports, player) => need("reportDelivery", "documentsReadableBy")(reports, player);
  const documentExchange = (exchange) => need("reportDelivery", "isDocumentExchange")(exchange);

  const flagsDir = path.join(repo, "public", "flags");
  const flagFileFor = (code) => {
    const value = asText(code);
    if (!value) return "";
    const url = engine.flagImageUrlFromGid(value);
    const alpha2 = /\/([a-z]{2}(?:-[a-z]{2,3})?)\.svg$/i.exec(String(url ?? ""))?.[1]?.toLowerCase();
    if (!alpha2) return "";
    const file = path.join(flagsDir, `${alpha2}.svg`);
    return fs.existsSync(file) ? file : "";
  };

  const assess = (target, reason) => {
    const name = asText(target);
    if (!name) return;
    try {
      Promise.resolve(engine.gameplay.ensureCountryAssessed(name, { reason })).catch(() => {});
    } catch {
      return;
    }
  };

  const readState = async () => {
    const [world, rawIntercepts, game] = await Promise.all([
      engine.gameState.readWorldState({ force: true }),
      engine.gameState.readInterceptsState({ force: true }),
      engine.gameState.readGameData({ force: true }),
    ]);
    const filed = S().normalizeIntercepts(rawIntercepts);
    const unseenApi = engine.unseenEvents;
    const unseen = unseenApi?.unseenEvents?.unseenInTurn
      ? unseenApi.unseenEvents.unseenInTurn(unseenApi.latestTurnEventIds(world))
      : new Set();
    const intercepts = unseenApi?.withoutUnseenIntercepts ? (unseenApi.withoutUnseenIntercepts(filed, unseen) || {}) : filed;
    return { world: world || {}, intercepts, player: asText(game?.country), gameDate: asText(game?.gameDate) };
  };

  const openAssessments = async (world, intercepts) => {
    const next = {};
    for (const [target, entry] of Object.entries(intercepts || {})) {
      let politicalAssessment = entry?.politicalAssessment || null;
      if (politicalAssessment && seal().isSeal(world?.spySeal)) {
        politicalAssessment = await seal().openPoliticalAssessment(world.spySeal, entry.reportId, politicalAssessment);
      }
      next[target] = { ...entry, ...(politicalAssessment ? { politicalAssessment } : {}) };
    }
    return next;
  };

  const loadCountries = async () => {
    try {
      return asArray(await engine.assets.loadCountryNames());
    } catch {
      return [];
    }
  };

  const publicPicture = (profile) => {
    if (!profile) return null;
    const government = profile.government || {};
    const leader = officeholderLabel(profile.leader || government.headOfState || government.headOfGovernment);
    const descriptors = [profile.politicalSystem?.label || profile.politicalSystem?.type, government.form, government.ideology, ...asArray(profile.tags)].filter(Boolean).map(String);
    const headOfGovernment = government.headOfGovernment && officeholderLabel(government.headOfGovernment) !== leader ? officeholderLabel(government.headOfGovernment) : "";
    const goals = asArray(profile.goals).slice(0, 4).map(String);
    return { descriptors: descriptors.join(", "), leader, headOfGovernment, goals };
  };

  const assessmentView = (assessment) => {
    if (!assessment) return null;
    return {
      summary: asText(assessment.summary),
      meta: [assessment.confidence && `${assessment.confidence} confidence`, assessment.source, assessment.gatheredAt].filter(Boolean).join(" · "),
      findings: asArray(assessment.findings).slice(0, 6).map((finding) => ({ topic: asText(finding?.topic), text: asText(finding?.text) })),
    };
  };

  const dossier = (world, intercepts, openedAssessments, spies, myIntel, player, record) => {
    const name = asText(record?.name);
    const selectedSpy = spies.find((spy) => sameCountry(spy.target, name));
    const rawEntry = intercepts[name] || Object.entries(intercepts).find(([target]) => sameCountry(target, name))?.[1] || null;
    const clarity = selectedSpy ? S().signalClarity(myIntel, S().intelligenceOf(world, selectedSpy.target)) : 0;
    const buildKnowledge = exported("buildPlayerPoliticalKnowledgeView");
    const knowledge = name && typeof buildKnowledge === "function"
      ? buildKnowledge(world, name, { viewerPolity: player, intercepts: openedAssessments })
      : null;
    const assessment = knowledge?.intelligence || null;
    const portfolioFor = exported("institutionPortfolioForPolity");
    const portfolio = name && portfolioFor ? portfolioFor(world, name, { viewerPolity: player }) : [];
    const sourceLabel = sourceQualityLabel(assessment?.confidence, clarity, Boolean(selectedSpy));
    return {
      name: name || "Unknown polity",
      flag: flagFileFor(record?.code),
      subtitle: selectedSpy ? `Active network · since ${selectedSpy.deployedAt || "an earlier date"}` : "No active network · public sources only",
      network: networkQualityLabel(clarity, Boolean(selectedSpy)),
      political: politicalKnowledgeLabel(knowledge),
      diplomatic: diplomaticKnowledgeLabel(rawEntry, clarity, Boolean(selectedSpy)),
      source: sourceLabel,
      sourceTone: sourceLabel === "Low" ? "amber" : sourceLabel === "None" ? "neutral" : "green",
      publicPicture: publicPicture(knowledge?.public),
      institutions: portfolio.slice(0, 10).map(({ institution, member, history, cases }) => ({
        id: asText(institution?.id),
        name: asText(institution?.name),
        role: capitalizeWords(member ? (member.role || member.status || "member") : "former / historical"),
        isMember: Boolean(member),
        pending: asArray(cases).length ? `${asArray(cases).length} pending` : "",
        history: !member && asArray(history).length ? asText(asArray(history).at(-1)?.action || "history") : "",
      })),
      assessment: assessmentView(assessment),
      knowledgeMissing: typeof buildKnowledge !== "function",
    };
  };

  const view = async ({ selected = "" } = {}) => {
    const { world, intercepts, player, gameDate } = await readState();
    const openedAssessments = await openAssessments(world, intercepts);
    const countries = await loadCountries();
    const myIntel = S().intelligenceOf(world, player);
    const clarityFor = (target) => S().signalClarity(myIntel, S().intelligenceOf(world, target));
    const spies = S().activeSpies(world).filter((spy) => !spy.owner || spy.owner === player);
    const foreign = S().foreignSpies(world, player);
    const visibleForeign = foreign.filter((spy) => spy.status !== "active");
    const everySpy = S().normalizeSpies(world?.spies);
    const history = everySpy.filter((spy) => (!spy.owner || spy.owner === player) && (spy.status === "exposed" || spy.status === "dead")).slice(-3);
    const caughtUnknown = everySpy.filter((spy) => sameCountry(spy.target, player) && spy.status === "dead").slice(-3);
    const operationLog = everySpy
      .filter((spy) => !spy.owner || spy.owner === player)
      .flatMap((spy) => asArray(spy.operations).map((record) => ({ ...record, target: spy.target, spyId: spy.id })))
      .sort((a, b) => (b.round - a.round) || String(b.date).localeCompare(String(a.date)))
      .slice(0, 8);
    const readableReports = readable(world?.reports, player).slice(0, 36);
    const MAX = S().MAX_ACTIVE_SPIES;
    standInState.targets = spies.map((spy) => spy.target);
    standInState.date = gameDate;

    const countryRows = countries
      .filter((country) => !sameCountry(country?.name, player))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const countryByName = (name) => countryRows.find((country) => sameCountry(country.name, name)) || countries.find((country) => sameCountry(country.name, name)) || { name };
    let chosen = asText(selected);
    if (!(chosen && countryRows.some((country) => sameCountry(country.name, chosen)))) {
      chosen = spies[0]?.target || Object.keys(intercepts || {})[0] || countryRows[0]?.name || "";
    }

    const assessedEntries = Object.entries(openedAssessments).filter(([, entry]) => entry?.politicalAssessment);
    const interceptedDocuments = readableReports.filter((report) => asArray(report.interceptedBy).some((name) => sameCountry(name, player)));
    const warnings = [
      ...visibleForeign.map((spy) => `${spy.owner} has a ${spy.status === "turned" ? "turned" : "detected"} agent inside ${player}.`),
      ...spies.filter((spy) => spy.suspected).map((spy) => `Source integrity concerns affect the network in ${spy.target}.`),
    ];

    const recentItems = [];
    for (const [target, entry] of assessedEntries) {
      recentItems.push({ kind: "assessment", target, title: `Political assessment: ${target}`, meta: entry.politicalAssessment?.gatheredAt || entry.gatheredAt || "", text: entry.politicalAssessment?.summary || "Political assessment updated." });
    }
    for (const [target, entry] of Object.entries(intercepts || {})) {
      for (const exchange of asArray(entry?.exchanges).slice(-1)) {
        recentItems.push({ kind: "intercept", target, exchangeId: exchange.id, counterpart: exchange.counterpart, sub: `${exchange.subject}${exchange.date ? ` · ${exchange.date}` : ""}`, clarity: clarityFor(target), title: `${target} ↔ ${exchange.counterpart}`, meta: exchange.date || "", text: exchange.subject || "Intercepted diplomatic traffic" });
      }
    }
    readableReports.slice(0, 4).forEach((report) => recentItems.push({ kind: "document", reportId: asText(report.id), title: asText(report.title), meta: report.dateline || report.createdDate || "", text: report.from ? `Document from ${report.from}` : "Document on file" }));
    operationLog.slice(0, 3).forEach((record) => recentItems.push({ kind: "operation", title: `${OPERATION_LABELS[record.kind]} · ${record.target}`, meta: record.date || "", text: operationOutcomeText(record) }));
    recentItems.sort((a, b) => String(b.meta || "").localeCompare(String(a.meta || "")));

    const odds = (spy) => {
      const assets = spy.assets?.length ?? 0;
      const targetIntel = S().intelligenceOf(world, spy.target);
      return Object.fromEntries(S().OPERATION_KINDS.map((kind) => [kind, {
        success: successLabel(S().operationSuccessChance(kind, myIntel, targetIntel, { assets })),
        capture: captureLabel(S().operationCaptureChance(kind, myIntel, targetIntel, { succeeded: true, assets })),
      }]));
    };

    const interceptRows = Object.entries(intercepts).flatMap(([target, entry]) => asArray(entry.exchanges)
      .filter((exchange) => !documentExchange(exchange))
      .map((exchange) => ({ target, exchangeId: exchange.id, counterpart: exchange.counterpart, clarity: clarityFor(target), title: `${target} ↔ ${exchange.counterpart}`, sub: `${exchange.subject}${exchange.date ? ` · ${exchange.date}` : ""}` })));

    return plain({
      player,
      gameDate,
      capability: intelligenceCapabilityLabel(myIntel),
      activeNetworks: spies.length,
      slotsHint: `${MAX - spies.length} field slots available`,
      currentReports: assessedEntries.length + interceptedDocuments.length,
      counterintelAlerts: visibleForeign.length,
      warnings: warnings.slice(0, 6),
      recent: recentItems.slice(0, 4),
      countries: countryRows.map((country) => ({ name: asText(country.name), network: spies.some((spy) => sameCountry(spy.target, country.name)) })),
      countriesLoaded: countries.length > 0,
      selected: chosen,
      dossier: dossier(world, intercepts, openedAssessments, spies, myIntel, player, countryByName(chosen)),
      max: MAX,
      full: spies.length >= MAX,
      networks: spies.map((spy) => ({
        id: spy.id,
        target: spy.target,
        meta: `since ${spy.deployedAt || "an earlier date"} · network ${networkQualityLabel(S().signalClarity(myIntel, S().intelligenceOf(world, spy.target)), true).toLowerCase()}${spy.suspected ? " · source integrity concern" : ""}`,
        focus: spy.focus || "diplomacy",
        assets: asArray(spy.assets).map((asset) => asset.who).join(" · "),
        mission: spy.mission ? { kind: spy.mission.kind, label: OPERATION_LABELS[spy.mission.kind] || "", instructions: spy.mission.instructions } : null,
        odds: odds(spy),
      })),
      foci: S().COLLECTION_FOCI.map((focus) => ({ value: focus, label: FOCUS_LABELS[focus] })),
      operationKinds: S().OPERATION_KINDS.map((kind) => ({ value: kind, label: OPERATION_LABELS[kind] })),
      instructionsMax: S().OPERATION_INSTRUCTIONS_MAX,
      history: history.map((spy) => (spy.status === "dead"
        ? `Agent lost in ${spy.target}${spy.exposedAt ? ` on ${spy.exposedAt}` : ""}: caught, and died in custody without giving you away`
        : `Agent expelled by ${spy.target}${spy.exposedAt ? ` on ${spy.exposedAt}` : ""}`)),
      operationLog: operationLog.map((record) => ({
        title: `${OPERATION_LABELS[record.kind]} · ${record.target}`,
        date: record.date || "",
        instructions: record.instructions || "",
        outcome: operationOutcomeText(record),
        tone: operationTone(record),
      })),
      cases: visibleForeign.map((spy) => ({
        id: spy.id,
        owner: spy.owner,
        status: spy.status,
        coverStory: spy.coverStory || "",
        line: spy.status === "discovered" ? "agent in custody — decide what to do" : `double agent since ${spy.turnedAt || "capture"} — ${spy.owner} still trusts them`,
        placeholder: spy.status === "discovered" ? "Cover story to feed them if turned (optional)" : `What your double agent tells ${spy.owner}`,
      })),
      caughtUnknown: caughtUnknown.map((spy) => `A foreign agent caught${spy.exposedAt ? ` on ${spy.exposedAt}` : ""} died under interrogation. Who sent them was never learned.`),
      assessments: assessedEntries.map(([target, entry]) => ({ target, meta: entry.politicalAssessment?.gatheredAt || entry.gatheredAt || "", summary: entry.politicalAssessment?.summary || "Political assessment on file" })),
      intercepts: interceptRows,
      documents: readableReports.map((report) => ({
        id: asText(report.id),
        title: asText(report.title),
        meta: report.dateline || report.createdDate || "",
        line: `${report.from ? `From ${report.from} · ` : ""}${report.visibleTo === null ? "published" : asArray(report.interceptedBy).some((name) => sameCountry(name, player)) && !asArray(report.visibleTo).some((name) => sameCountry(name, player)) ? "intercepted copy" : "held by your government"}`,
        body: String(report.body ?? ""),
      })),
    });
  };

  const commitSpies = async (compute) => {
    need("simulationStatus", "assertNoTurnRunning")();
    const game = await engine.gameState.readGameData({ force: true });
    const player = asText(game?.country);
    const gameDate = asText(game?.gameDate);
    const fresh = await engine.gameState.readWorldState({ force: true });
    const next = compute(fresh, { player, gameDate });
    const committed = { ...fresh, spies: next, spySeal: seal().isSeal(fresh?.spySeal) ? fresh.spySeal : seal().newSeal() };
    const ops = engine.projects.spyOperationOps(next, committed.projects, { date: gameDate, playerPolity: player });
    const toWrite = ops.length
      ? engine.gameState.applyProjectOpsToWorld({ date: gameDate, ops, playerCountry: player, world: committed }).world
      : committed;
    await engine.gameState.writeWorldState(toWrite);
    return { player, gameDate, world: fresh };
  };

  const spyById = (world, id) => S().normalizeSpies(world?.spies).find((spy) => spy.id === id) || null;

  return {
    "intelligence.mount": async () => {
      const game = await engine.gameState.readGameData({ force: true });
      assess(asText(game?.country), "intelligence workspace");
      return true;
    },
    "intelligence.view": async (args = {}) => view(args),
    "intelligence.candidates": async () => {
      const { world, player } = await readState();
      const countries = await loadCountries();
      const spies = S().activeSpies(world).filter((spy) => !spy.owner || spy.owner === player);
      const countryRows = countries
        .filter((country) => !sameCountry(country?.name, player))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      let holders = { holders: null, world: null };
      try {
        const [regions, worldView] = await Promise.all([engine.assets.loadRegionCatalog(), engine.gameState.readWorldStateView()]);
        holders = { holders: engine.countryList.landHolderNames(regions, worldView), world: worldView };
      } catch {
        holders = { holders: null, world: null };
      }
      const candidates = engine.countryList.pickableCountries(countryRows, holders)
        .filter((country) => !spies.some((spy) => sameCountry(spy.target, country.name)));
      return plain(engine.countryList.dedupeByName(candidates).map((country) => ({ name: asText(country.name), code: asText(country.code), flag: flagFileFor(country.code) })));
    },
    "intelligence.intercept": async ({ target = "", exchangeId = "", read = false } = {}) => {
      const { world, intercepts, player } = await readState();
      const entry = intercepts[target] || Object.entries(intercepts).find(([name]) => sameCountry(name, target))?.[1];
      const exchange = asArray(entry?.exchanges).find((item) => asText(item.id) === asText(exchangeId));
      if (!exchange) throw new Error("That intercept is no longer on file.");
      if (read) assess(target, "intercept read");
      let opened = null;
      try {
        opened = seal().isSeal(world?.spySeal) ? await seal().openExchange(world.spySeal, exchange) : exchange;
      } catch {
        opened = exchange;
      }
      const clarity = S().signalClarity(S().intelligenceOf(world, player), S().intelligenceOf(world, target));
      const shown = S().redactExchange(opened ?? { ...exchange, messages: [] }, clarity);
      return plain({
        target,
        counterpart: asText(exchange.counterpart),
        sub: `${asText(exchange.subject)}${exchange.date ? ` · ${exchange.date}` : ""}`,
        clarity,
        messages: asArray(shown.messages).map((message) => ({ speaker: asText(message.speaker), text: String(message.text ?? ""), mine: message.speaker === target })),
      });
    },
    "intelligence.deploy": async ({ target = "" } = {}) => {
      const { player } = await commitSpies((world, { player: owner, gameDate }) => S().deploySpy(world, target, { date: gameDate, playerPolity: owner }));
      assess(target, "agent deployed");
      return { target, player };
    },
    "intelligence.recall": async ({ spyId = "" } = {}) => {
      await commitSpies((world) => S().recallSpy(world, spyId));
      return true;
    },
    "intelligence.focus": async ({ spyId = "", focus = "" } = {}) => {
      await commitSpies((world) => S().setSpyFocus(world, spyId, focus));
      return true;
    },
    "intelligence.order": async ({ spyId = "", kind = "sabotage", instructions = "" } = {}) => {
      const text = String(instructions ?? "").trim().slice(0, S().OPERATION_INSTRUCTIONS_MAX);
      await commitSpies((world, { gameDate }) => S().orderOperation(world, spyId, { kind: kind || "sabotage", instructions: text, date: gameDate }));
      return true;
    },
    "intelligence.cancelOrder": async ({ spyId = "" } = {}) => {
      await commitSpies((world) => S().cancelOperation(world, spyId));
      return true;
    },
    "intelligence.expel": async ({ spyId = "" } = {}) => {
      let owner = "";
      await commitSpies((world, { gameDate }) => {
        owner = spyById(world, spyId)?.owner || "";
        return S().expelSpy(world, spyId, { date: gameDate });
      });
      assess(owner, "foreign agent expelled");
      return true;
    },
    "intelligence.turn": async ({ spyId = "", story = "" } = {}) => {
      let owner = "";
      await commitSpies((world, { gameDate }) => {
        owner = spyById(world, spyId)?.owner || "";
        return S().turnSpy(world, spyId, { date: gameDate, coverStory: story || "" });
      });
      assess(owner, "foreign agent turned");
      return true;
    },
    "intelligence.story": async ({ spyId = "", story = null } = {}) => {
      await commitSpies((world) => S().setCoverStory(world, spyId, story ?? spyById(world, spyId)?.coverStory));
      return true;
    },
  };
};
