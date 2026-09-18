/*! Open Historia — player-facing political presentation helpers */

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const asList = (value, limit = 12) => {
  const source = Array.isArray(value) ? value : (clean(value) ? [value] : []);
  const out = [];
  const seen = new Set();
  for (const entry of source) {
    const text = clean(entry);
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
};

const clampSupport = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number * 10) / 10));
};

const approximateBasis = (value) => /estimate|approximate/i.test(clean(value));

const partyKey = (party, index = 0) => clean(party?.id || party?.name) || `party-${index}`;

const officeholderName = (value) => {
  if (typeof value === "string") return clean(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return clean(value.name || value.id);
};

const publicPartyRow = (party, index) => {
  if (!party || typeof party !== "object" || Array.isArray(party)) return null;
  const name = clean(party.name);
  if (!name) return null;
  const support = clampSupport(party?.support?.percent);
  const supportBasis = clean(party?.support?.basis);
  const influence = clampSupport(party?.influence?.percent);
  const influenceBasis = clean(party?.influence?.basis);
  const influenceLabel = clean(party?.influence?.label);
  return {
    id: partyKey(party, index),
    name,
    shortName: clean(party.shortName || party.abbreviation),
    support,
    supportBasis,
    supportApproximate: approximateBasis(supportBasis),
    influence,
    influenceBasis,
    influenceApproximate: approximateBasis(influenceBasis),
    influenceLabel,
    ideology: asList(party.ideology, 5),
    goals: asList(party.goals, 6),
    publicPriorities: asList(party.publicPriorities, 6),
    publicForeignPolicy: asList(party.publicForeignPolicy, 6),
    publicDescription: clean(party.publicDescription),
    leader: officeholderName(party.leader),
    ruling: party.ruling === true,
    coalition: party.coalition === true,
    color: clean(party.color),
  };
};

const samePartyToken = (left, right) => {
  const a = clean(left).toLocaleLowerCase();
  const b = clean(right).toLocaleLowerCase();
  return Boolean(a && b && a === b);
};

const governmentPartyTokens = (government) => [
  ...asList(government?.rulingPartyIds, 12),
  ...asList(government?.rulingParties, 12),
  ...asList(government?.coalitionPartyIds, 12),
  ...asList(government?.coalition, 12),
  clean(government?.rulingParty),
].filter(Boolean);

const rulingPartyTokens = (government) => [
  ...asList(government?.rulingPartyIds, 12),
  ...asList(government?.rulingParties, 12),
  clean(government?.rulingParty),
].filter(Boolean);

const coalitionPartyTokens = (government) => [
  ...asList(government?.coalitionPartyIds, 12),
  ...asList(government?.coalition, 12),
].filter(Boolean);

const tokenMatchesParty = (token, party) =>
  samePartyToken(token, party.id) ||
  samePartyToken(token, party.name) ||
  samePartyToken(token, party.shortName);

const markGovernmentParties = (parties, government) => {
  const tokens = governmentPartyTokens(government);
  if (!tokens.length) return parties;
  const rulingTokens = rulingPartyTokens(government);
  const coalitionTokens = coalitionPartyTokens(government);
  return parties.map((party) => {
    const governing = tokens.some((token) => tokenMatchesParty(token, party));
    if (!governing) return party;
    return {
      ...party,
      ruling: party.ruling || rulingTokens.some((token) => tokenMatchesParty(token, party)),
      coalition: party.coalition || coalitionTokens.some((token) => tokenMatchesParty(token, party)),
    };
  });
};

export const buildGovernmentPartyPresentation = (publicPoliticalProfile) => {
  const government = publicPoliticalProfile?.government || {};
  const parties = (Array.isArray(publicPoliticalProfile?.parties) ? publicPoliticalProfile.parties : [])
    .map(publicPartyRow)
    .filter(Boolean);
  const tokens = governmentPartyTokens(government);
  const names = [];
  const ids = [];
  const seen = new Set();

  for (const token of tokens) {
    const party = parties.find((candidate) => tokenMatchesParty(token, candidate));
    const id = clean(party?.id || token);
    const name = clean(party?.name || token);
    const key = samePartyToken(id, name) ? id.toLocaleLowerCase() : `${id.toLocaleLowerCase()}:${name.toLocaleLowerCase()}`;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
    names.push(name);
  }

  return {
    ids,
    names,
    label: names.length > 1 ? "Governing coalition" : (names.length === 1 ? "Government" : ""),
  };
};

// Build a bounded, presentation-only party landscape from an already public
// Political Knowledge projection. The result never includes arbitrary canonical
// Party fields: callers can safely render every property returned here.
export const buildPoliticalPartyLandscape = (
  publicPoliticalProfile,
  { minSlicePercent = 4, maxNamedSlices = 6 } = {},
) => {
  const source = Array.isArray(publicPoliticalProfile?.parties) ? publicPoliticalProfile.parties : [];
  const government = publicPoliticalProfile?.government || {};
  const rows = markGovernmentParties(
    source.map(publicPartyRow).filter(Boolean),
    government,
  ).sort((left, right) => (Number(right.support) || 0) - (Number(left.support) || 0) || left.name.localeCompare(right.name));

  const supported = rows.filter((party) => Number.isFinite(party.support) && party.support > 0);
  if (!supported.length) return { parties: rows, slices: [], totalKnownSupport: 0, isApproximate: false };

  const explicitOther = supported.find((party) => /^(other|others|other parties|independent|independents)$/i.test(party.name));
  const namedCandidates = supported.filter((party) => party !== explicitOther);
  const keep = [];
  const grouped = [];
  const softSliceLimit = Math.max(1, maxNamedSlices);
  for (const party of namedCandidates) {
    // PWV2-007: governing significance outranks presentation compactness. A
    // two-percent formal coalition partner is a real modeled political actor,
    // not anonymous residual support, so it must remain directly inspectable.
    const roleSignificant = party.ruling === true || party.coalition === true;
    if (roleSignificant || (keep.length < softSliceLimit && (party.support >= minSlicePercent || keep.length < 3))) keep.push(party);
    else grouped.push(party);
  }

  const knownSupport = supported.reduce((sum, party) => sum + (party.support || 0), 0);
  const remainder = Math.max(0, Math.round((100 - knownSupport) * 10) / 10);
  const groupedSupport = grouped.reduce((sum, party) => sum + (party.support || 0), 0);
  const explicitOtherSupport = explicitOther?.support || 0;
  const otherSupport = Math.round((groupedSupport + explicitOtherSupport + remainder) * 10) / 10;

  const slices = keep.map((party) => ({ ...party, isOther: false, members: [] }));
  if (otherSupport > 0.05) {
    const members = [
      ...(explicitOther ? [explicitOther] : []),
      ...grouped,
    ];
    slices.push({
      id: "__other__",
      name: "Other",
      shortName: "Other",
      support: otherSupport,
      ideology: [],
      goals: [],
      publicPriorities: [],
      publicForeignPolicy: [],
      publicDescription: remainder > 0.05 ? "Includes parties or voters not individually represented in the current public political profile." : "",
      leader: "",
      ruling: members.some((party) => party.ruling),
      coalition: members.some((party) => party.coalition),
      color: "",
      isOther: true,
      members,
      unlistedSupport: remainder,
    });
  }

  // If authored support somehow exceeds 100, retain the authored percentages for
  // labels/details but give the chart bounded proportional weights.
  const chartTotal = slices.reduce((sum, party) => sum + (party.support || 0), 0) || 1;
  const boundedSlices = slices.map((party) => ({
    ...party,
    chartPercent: Math.max(0, (party.support / chartTotal) * 100),
  }));

  return {
    parties: rows,
    slices: boundedSlices,
    totalKnownSupport: Math.round(Math.min(100, knownSupport) * 10) / 10,
    isApproximate: supported.some((party) => party.supportApproximate),
  };
};

const POLITICAL_LANDSCAPE_META = Object.freeze({
  electoral: {
    mode: "party",
    title: "Political landscape",
    subtitle: "Click a party to inspect public information",
    metricLabel: "support",
    mappedLabel: "support mapped",
    centerLabel: "Political",
    centerSubLabel: "landscape",
  },
  court_factions: {
    mode: "power",
    title: "Power structure",
    subtitle: "Court, dynastic, institutional and elite influence",
    metricLabel: "influence",
    mappedLabel: "influence mapped",
    centerLabel: "Power",
    centerSubLabel: "structure",
  },
  party_state: {
    mode: "power",
    title: "Power structure",
    subtitle: "Influence inside the ruling party and state apparatus",
    metricLabel: "influence",
    mappedLabel: "influence mapped",
    centerLabel: "Power",
    centerSubLabel: "structure",
  },
  elite_factions: {
    mode: "power",
    title: "Power structure",
    subtitle: "Elite blocs and institutions shaping the regime",
    metricLabel: "influence",
    mappedLabel: "influence mapped",
    centerLabel: "Power",
    centerSubLabel: "structure",
  },
  military_factions: {
    mode: "power",
    title: "Power structure",
    subtitle: "Military, security and civilian blocs shaping the regime",
    metricLabel: "influence",
    mappedLabel: "influence mapped",
    centerLabel: "Power",
    centerSubLabel: "structure",
  },
  revolutionary_factions: {
    mode: "power",
    title: "Political landscape",
    subtitle: "Movements, councils and factions competing for influence",
    metricLabel: "influence",
    mappedLabel: "influence mapped",
    centerLabel: "Political",
    centerSubLabel: "landscape",
  },
  colonial: {
    mode: "power",
    title: "Power structure",
    subtitle: "Administration, local elites and political movements",
    metricLabel: "influence",
    mappedLabel: "influence mapped",
    centerLabel: "Power",
    centerSubLabel: "structure",
  },
  none: {
    mode: "none",
    title: "Political landscape",
    subtitle: "No public political power structure is currently mapped",
    metricLabel: "influence",
    mappedLabel: "influence mapped",
    centerLabel: "Political",
    centerSubLabel: "landscape",
  },
});

export const getPoliticalLandscapeMeta = (publicPoliticalProfile) => {
  const representation = clean(publicPoliticalProfile?.politicalSystem?.representation) ||
    (Array.isArray(publicPoliticalProfile?.parties) && publicPoliticalProfile.parties.length ? "electoral" : "none");
  if (representation === "none" && Array.isArray(publicPoliticalProfile?.powerBlocs) && publicPoliticalProfile.powerBlocs.length) {
    return {
      representation,
      ...POLITICAL_LANDSCAPE_META.elite_factions,
      subtitle: "Political actors and institutions shaping the regime",
    };
  }
  const meta = POLITICAL_LANDSCAPE_META[representation] || POLITICAL_LANDSCAPE_META.elite_factions;
  return { representation, ...meta };
};

const publicPowerBlocRow = (bloc, index) => {
  if (!bloc || typeof bloc !== "object" || Array.isArray(bloc)) return null;
  const name = clean(bloc.name);
  if (!name) return null;
  const influence = clampSupport(bloc?.influence?.percent);
  const influenceLabel = clean(bloc?.influence?.label);
  const influenceBasis = clean(bloc?.influence?.basis);
  return {
    id: clean(bloc.id || name) || `bloc-${index}`,
    name,
    shortName: clean(bloc.shortName || bloc.abbreviation),
    kind: clean(bloc.kind),
    status: clean(bloc.status),
    influence,
    influenceLabel,
    influenceBasis,
    influenceApproximate: approximateBasis(influenceBasis),
    displayValue: influence != null
      ? (Number.isInteger(influence) ? `${influence}%` : `${influence.toFixed(1)}%`)
      : influenceLabel,
    ideology: asList(bloc.ideology, 5),
    goals: asList(bloc.goals, 6),
    publicPriorities: asList(bloc.publicPriorities, 6),
    publicForeignPolicy: asList(bloc.publicForeignPolicy, 6),
    publicDescription: clean(bloc.publicDescription),
    leader: officeholderName(bloc.leader),
    color: clean(bloc.color),
    sourceIndex: index,
  };
};

export const buildPoliticalPowerStructure = (publicPoliticalProfile) => {
  const rows = (Array.isArray(publicPoliticalProfile?.powerBlocs) ? publicPoliticalProfile.powerBlocs : [])
    .map(publicPowerBlocRow)
    .filter(Boolean)
    .sort((left, right) => {
      const leftKnown = Number.isFinite(left.influence);
      const rightKnown = Number.isFinite(right.influence);
      if (leftKnown && rightKnown && left.influence !== right.influence) return right.influence - left.influence;
      if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
      const rank = { dominant: 5, very_strong: 4, strong: 3, moderate: 2, weak: 1, marginal: 0 };
      const labelKey = (value) => clean(value).toLocaleLowerCase().replace(/[ -]+/g, "_");
      const leftRank = rank[labelKey(left.influenceLabel)] ?? -1;
      const rightRank = rank[labelKey(right.influenceLabel)] ?? -1;
      if (leftRank !== rightRank) return rightRank - leftRank;
      return left.sourceIndex - right.sourceIndex;
    });

  const visibleRows = rows.map(({ sourceIndex, ...bloc }) => bloc);
  const numeric = visibleRows.filter((bloc) => Number.isFinite(bloc.influence) && bloc.influence >= 0);
  const knownInfluence = numeric.reduce((sum, bloc) => sum + bloc.influence, 0);
  const remainder = numeric.length ? Math.max(0, Math.round((100 - knownInfluence) * 10) / 10) : 0;
  const slices = numeric.map((bloc) => ({ ...bloc, isOther: false }));
  if (remainder > 0.05) {
    slices.push({
      id: "__other_power__",
      name: "Other",
      shortName: "Other",
      influence: remainder,
      influenceLabel: "",
      displayValue: Number.isInteger(remainder) ? `${remainder}%` : `${remainder.toFixed(1)}%`,
      ideology: [],
      goals: [],
      publicPriorities: [],
      publicForeignPolicy: [],
      publicDescription: "Includes political influence not individually represented in the current public profile.",
      leader: "",
      color: "",
      isOther: true,
    });
  }

  const chartTotal = slices.reduce((sum, bloc) => sum + (bloc.influence || 0), 0) || 1;
  const boundedSlices = slices.map((bloc) => ({
    ...bloc,
    chartPercent: Math.max(0, (bloc.influence / chartTotal) * 100),
  }));
  const entries = [...visibleRows];
  const other = boundedSlices.find((bloc) => bloc.isOther);
  if (other) entries.push(other);

  return {
    blocs: visibleRows,
    entries,
    slices: boundedSlices,
    totalKnownInfluence: Math.round(Math.min(100, knownInfluence) * 10) / 10,
    hasQuantitativeInfluence: numeric.length > 0,
    isApproximate: numeric.some((bloc) => bloc.influenceApproximate),
  };
};

const buildPartyStatePartyPowerStructure = (publicPoliticalProfile) => {
  const rows = (Array.isArray(publicPoliticalProfile?.parties) ? publicPoliticalProfile.parties : [])
    .map(publicPartyRow)
    .filter(Boolean)
    .map((party) => ({
      ...party,
      influence: party.influence,
      influenceLabel: party.influenceLabel,
      displayValue: party.influence != null
        ? (Number.isInteger(party.influence) ? `${party.influence}%` : `${party.influence.toFixed(1)}%`)
        : party.influenceLabel,
    }))
    .sort((left, right) => (Number(right.influence) || 0) - (Number(left.influence) || 0) || left.name.localeCompare(right.name));

  const numeric = rows.filter((party) => Number.isFinite(party.influence) && party.influence >= 0);
  const knownInfluence = numeric.reduce((sum, party) => sum + party.influence, 0);
  const remainder = numeric.length ? Math.max(0, Math.round((100 - knownInfluence) * 10) / 10) : 0;
  const slices = numeric.map((party) => ({ ...party, isOther: false }));
  if (remainder > 0.05) {
    slices.push({
      id: "__other_party_state__",
      name: "Other",
      shortName: "Other",
      influence: remainder,
      influenceLabel: "",
      influenceBasis: numeric.some((party) => party.influenceApproximate) ? "generated-estimate" : "",
      influenceApproximate: numeric.some((party) => party.influenceApproximate),
      displayValue: Number.isInteger(remainder) ? `${remainder}%` : `${remainder.toFixed(1)}%`,
      ideology: [],
      goals: [],
      publicPriorities: [],
      publicForeignPolicy: [],
      publicDescription: "Includes political influence not individually represented in the current public profile.",
      leader: "",
      color: "",
      isOther: true,
    });
  }
  const chartTotal = slices.reduce((sum, party) => sum + (party.influence || 0), 0) || 1;
  const boundedSlices = slices.map((party) => ({
    ...party,
    chartPercent: Math.max(0, (party.influence / chartTotal) * 100),
  }));
  return {
    blocs: rows,
    entries: boundedSlices.length ? boundedSlices : rows,
    slices: boundedSlices,
    totalKnownInfluence: Math.round(Math.min(100, knownInfluence) * 10) / 10,
    hasQuantitativeInfluence: numeric.length > 0,
    isApproximate: numeric.some((party) => party.influenceApproximate),
  };
};

export const buildPoliticalLandscape = (publicPoliticalProfile, options = {}) => {
  const meta = getPoliticalLandscapeMeta(publicPoliticalProfile);
  if (meta.mode === "party") {
    const landscape = buildPoliticalPartyLandscape(publicPoliticalProfile, options);
    return {
      ...meta,
      ...landscape,
      entries: landscape.slices.length ? landscape.slices : landscape.parties,
      totalKnownPercent: landscape.totalKnownSupport,
      hasQuantitativeValues: landscape.slices.length > 0,
    };
  }
  if (meta.mode === "power") {
    const usePartyStateParties = meta.representation === "party_state"
      && (!Array.isArray(publicPoliticalProfile?.powerBlocs) || publicPoliticalProfile.powerBlocs.length === 0)
      && Array.isArray(publicPoliticalProfile?.parties)
      && publicPoliticalProfile.parties.length > 0;
    const landscape = usePartyStateParties
      ? buildPartyStatePartyPowerStructure(publicPoliticalProfile)
      : buildPoliticalPowerStructure(publicPoliticalProfile);
    return {
      ...meta,
      ...landscape,
      totalKnownPercent: landscape.totalKnownInfluence,
      hasQuantitativeValues: landscape.hasQuantitativeInfluence,
    };
  }
  return {
    ...meta,
    entries: [],
    slices: [],
    totalKnownPercent: 0,
    hasQuantitativeValues: false,
  };
};
