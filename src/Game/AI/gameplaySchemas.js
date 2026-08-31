const textSchema = (description) => ({
  type: "string",
  description,
});

const nonEmptyTextSchema = (description) => ({
  ...textSchema(description),
  minLength: 1,
});

const stringArraySchema = (description) => ({
  type: "array",
  description,
  items: { type: "string" },
});

const actionSchema = {
  type: "object",
  description: "One concrete action the player can take.",
  properties: {
    id: textSchema("Optional stable action identifier."),
    title: textSchema("Short display title for the action."),
    text: textSchema("Concrete, executable description of the action."),
    kind: textSchema('Action kind: usually "action", or "chat" only for a diplomatic conversation.'),
    invitees: stringArraySchema("Exact polity names invited when this is a chat action."),
    chatStarter: textSchema("Opening diplomatic message when this is a chat action."),
  },
  required: ["title", "text"],
  additionalProperties: false,
};

const chatCountrySchema = {
  type: "object",
  description: "A polity participating in a generated diplomatic chat.",
  properties: {
    code: textSchema("Polity's FULL country name (\"Spain\"), never a country code."),
    name: nonEmptyTextSchema("Exact polity name."),
  },
  required: ["name"],
  additionalProperties: false,
};

const chatMessageSchema = {
  type: "object",
  description: "An opening or follow-up message in a generated diplomatic chat.",
  properties: {
    code: textSchema("Speaker polity's FULL country name (\"Spain\"), never a country code."),
    role: textSchema("Message role, such as leader or system."),
    speaker: textSchema("Exact name of the speaker."),
    text: textSchema("Message body."),
    time: textSchema("In-game date or time, when relevant."),
  },
  required: ["text"],
  additionalProperties: false,
};

const createdChatSchema = {
  type: "object",
  description:
    "A diplomatic chat opened toward the player. The initiating polity ALWAYS "
    + "speaks first: title and openingMessage are required - a blank, untitled "
    + "chat tells the player nothing about why they were contacted.",
  properties: {
    id: textSchema("Optional stable chat identifier."),
    title: nonEmptyTextSchema("Short title naming the purpose of the chat (e.g. 'French mediation offer')."),
    countries: {
      type: "array",
      description: "Participating polities.",
      minItems: 1,
      items: chatCountrySchema,
    },
    messages: {
      type: "array",
      description: "Messages with which the chat begins.",
      items: chatMessageSchema,
    },
    openingMessage: nonEmptyTextSchema(
      "The initiating polity's first message, in its leader's voice - why it "
      + "reached out and what it wants. Never written as the player.",
    ),
    speaker: nonEmptyTextSchema("Name of the polity sending the opening message. Never the player's polity."),
    linkedEventId: textSchema("Optional event identifier linking this chat to its cause."),
    source: textSchema("Optional source label."),
    status: textSchema("Optional chat status."),
  },
  required: ["countries", "title", "speaker", "openingMessage"],
  additionalProperties: false,
};

const regionTransferSchema = {
  type: "object",
  description: "A LEGAL sovereignty transfer of one map region to a new polity. Temporary wartime occupation belongs in regionControlOps.",
  properties: {
    regionId: textSchema(
      "Exact map region id/name when known. If the event is grounded in a city, fortress, translated/exonym name, "
      + "or historical area and you genuinely do not know the map region name, use that exact grounded place/area wording; "
      + "the native geography resolver may map it conservatively against fromCode's current regions.",
    ),
    regionName: textSchema("Human-readable region/place wording, when useful."),
    fromCode: textSchema(
      "Previous owner's FULL polity name. Strongly expected for every partial transfer because it bounds geographic resolution "
      + "to that polity's current regions; never use a country code.",
    ),
    toCode: textSchema("New owner's FULL polity name, never a country code such as \"ESP\"."),
    note: textSchema("Brief reason for the transfer."),
    wholeCountry: {
      type: "boolean",
      description:
        "Set true ONLY for a total LEGAL annexation, unification, cession or partition settlement in "
        + "which one polity gains sovereignty over EVERY region another still holds. Then put the losing "
        + "polity's name in regionId instead of a region name, and this single entry "
        + "transfers all of its territory. Leave unset (the normal case) to transfer "
        + "one named region.",
    },
  },
  required: ["regionId", "toCode"],
  additionalProperties: false,
};

const regionControlOpSchema = {
  description:
    "A de-facto territorial control mutation. This is NOT legal sovereignty: use contest for an active disputed front, "
    + "control for wartime capture/occupation/retaking, and clear_contest when a ceasefire/withdrawal/settlement ends an active contest.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["contest"] },
        regionId: nonEmptyTextSchema(
          "Exact map region id/name when known; otherwise the exact grounded city/historical-area wording from the event for bounded native resolution.",
        ),
        regionName: textSchema("Human-readable region/place wording, when useful."),
        fromCode: nonEmptyTextSchema("Current controller/defending polity's FULL name; used to bound geography resolution."),
        actorCode: nonEmptyTextSchema("Challenging/attacking polity's FULL name."),
        note: textSchema("Brief reason the region is actively contested."),
      },
      required: ["op", "regionId", "fromCode", "actorCode"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["control"] },
        regionId: nonEmptyTextSchema(
          "Exact map region id/name when known; otherwise the exact grounded city/historical-area wording from the event for bounded native resolution.",
        ),
        regionName: textSchema("Human-readable region/place wording, when useful."),
        fromCode: nonEmptyTextSchema("Previous de-facto controller's FULL polity name."),
        toCode: nonEmptyTextSchema("New de-facto controller's FULL polity name."),
        note: textSchema("Brief reason control changed."),
        wholeCountry: {
          type: "boolean",
          description: "True only for a total military occupation/collapse where the new controller takes every region the previous controller still holds.",
        },
      },
      required: ["op", "regionId", "fromCode", "toCode"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["clear_contest"] },
        regionId: nonEmptyTextSchema(
          "Exact map region id/name when known; otherwise the exact grounded place wording from the event.",
        ),
        regionName: textSchema("Human-readable region/place wording, when useful."),
        fromCode: textSchema("Current controller's FULL polity name, strongly preferred to bound geography resolution."),
        claimantCode: textSchema("Specific claimant/contender to remove. Omit only when clearAll=true."),
        clearAll: { type: "boolean", description: "Clear all claimants only when a final settlement explicitly resolves the territorial dispute; ordinary ceasefires should remove a specific claimantCode." },
        note: textSchema("Brief reason the contest ended."),
      },
      required: ["op", "regionId"],
      additionalProperties: false,
    },
  ],
};

// AI-authored updates to a country's PERSISTENT stat sheet (world.countryStats[code]).
// Only fields that CHANGED this period are sent; everything else persists. Absolute
// values, not deltas. Kept self-contained (no percentageSchema dep, which is defined
// later). LIVE via the tool schema, so it reaches existing frozen-prompt games.
const statPct = (description) => ({ type: "integer", minimum: 0, maximum: 100, description });
const statsUpdateSchema = {
  type: "object",
  description:
    "Updated PERSISTENT national statistics for this polity. Include ONLY fields materially changed by this event/period. "
    + "Economic fields are absolute values, not deltas, and should be emitted only when the simulation has a canonical baseline "
    + "for the polity and a concrete causal reason for the change. Fiscal stress constrains financing but never creates a hard action veto.",
  properties: {
    capital: textSchema("Capital, only when it changes."),
    continent: textSchema("Continent / broad region, only when it changes."),
    government: textSchema("Government system and ideology, only when it changes."),
    leader: textSchema("Head of state or government, only when it changes."),
    stability: statPct("National stability 0-100."),
    indices: {
      type: "object",
      properties: {
        sovereignty: statPct("Practical political sovereignty."),
        foodAutonomy: statPct("Domestic food autonomy."),
        energyAutonomy: statPct("Domestic energy autonomy."),
        economicIndependence: statPct("Economic independence."),
        internalSecurity: statPct("Internal security."),
        internationalReputation: statPct("International reputation / standing."),
      },
      additionalProperties: false,
    },
    economy: {
      type: "object",
      properties: {
        gdp: textSchema("Absolute whole-polity GDP only for an explicit authoritative re-baseline; ordinary world events should prefer growth/inflation/debt/budget/unemployment and omit GDP."),
        gdpGrowth: textSchema("Annual GDP growth estimate."),
        gdpPerCapita: textSchema("Absolute whole-polity GDP/capita only for an explicit authoritative re-baseline; ordinary world events should omit this derived aggregate."),
        currency: textSchema("Currency."),
        inflation: textSchema("Inflation estimate."),
        unemployment: textSchema("Unemployment estimate."),
        publicDebt: textSchema("Public debt estimate."),
        budgetBalance: textSchema("Budget balance estimate."),
      },
      additionalProperties: false,
    },
    gdpBreakdown: {
      type: "object",
      description: "Agriculture/industry/services shares — send all three together so they still sum to ~100.",
      properties: {
        agriculture: statPct("Agriculture share of GDP."),
        industry: statPct("Industry share of GDP."),
        services: statPct("Services share of GDP."),
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const polityChangeSchema = {
  type: "object",
  description:
    "One explicit polity lifecycle or metadata operation. Ordinary updates MUST target an existing polity; "
    + "new identities are authorized only by create/restore, so a stale or sloppy name cannot silently mint a country.",
  properties: {
    operation: {
      type: "string",
      description:
        "What this entry actually does. update = metadata/stats only on an existing polity; "
        + "create = establish a genuinely new current polity, including an independence/breakaway actor; "
        + "rename = reconstitute an existing polity under a new full display/current name while keeping its stable campaign identity; "
        + "restore = bring back a dormant/dissolved historical polity as a current actor; "
        + "dissolve = explicitly end a polity's current existence after its territory is separately settled.",
      enum: ["update", "create", "rename", "restore", "dissolve"],
    },
    code: textSchema(
      "Exact FULL polity name, never a country code. For update/rename/dissolve this identifies the CURRENT/source polity. "
      + "For create/restore this is the exact polity identity being established."
    ),
    name: textSchema(
      "For rename, the NEW full polity name and it must be nonblank. For create/restore it may repeat the established name. "
      + "For update omit it unless the display/current name itself intentionally changes without a lifecycle rename."
    ),
    color: textSchema("New six-digit hexadecimal color, only when it changes."),
    aliases: stringArraySchema("Alternative polity names."),
    // The prompt asks for this and gameState normalizes/clamps/writes it, but it
    // was missing here — and additionalProperties:false means a json_schema
    // provider could never emit it, so international reputation silently never
    // moved. Declaring it is what actually connects that feature.
    reputation: {
      type: "number",
      description:
        "International reputation 0-100, only when it changes. 0 is a pariah state, 100 is universally trusted.",
    },
    tags: stringArraySchema(
      "The country's defining traits after this change — ideology, alignment, posture "
      + "(e.g. socialist, authoritarian, anti-nato). Only when they change: send the "
      + "COMPLETE new list, not a delta. A revolution or a change of alignment should "
      + "rewrite these.",
    ),
    note: textSchema("Brief reason for the change."),
    stats: statsUpdateSchema,
  },
  required: ["operation", "code"],
  additionalProperties: false,
};

const unitSchema = {
  type: "object",
  description: "A military unit to create on the map.",
  properties: {
    id: textSchema("Stable unit identifier."),
    name: nonEmptyTextSchema("Display name for the unit."),
    type: {
      type: "string",
      description: "Unit type.",
      enum: ["infantry", "armor", "air", "naval", "artillery", "garrison"],
    },
    ownerCode: nonEmptyTextSchema("Owning polity's FULL country name (\"Spain\"), never a country code."),
    strength: {
      type: "integer",
      description: "Unit strength from 1 to 1000.",
      minimum: 1,
      maximum: 1000,
    },
    lng: {
      type: "number",
      description: "Longitude of the unit location.",
      minimum: -180,
      maximum: 180,
    },
    lat: {
      type: "number",
      description: "Latitude of the unit location.",
      minimum: -90,
      maximum: 90,
    },
    regionId: textSchema("Map region identifier, when known."),
    status: {
      type: "string",
      description: "Optional unit status.",
      enum: ["idle", "moving", "engaged", "pending"],
    },
    note: textSchema("Brief operational note."),
  },
  required: ["name", "type", "ownerCode", "strength", "lng", "lat"],
  additionalProperties: false,
};

const unitOpSchema = {
  description: "A unit mutation. Use op spawn, move, attack, strength, or remove and fill the fields that op needs.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["spawn"] },
        unit: unitSchema,
      },
      required: ["op", "unit"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["move"] },
        unitId: nonEmptyTextSchema("Existing unit identifier."),
        toLng: { type: "number", minimum: -180, maximum: 180 },
        toLat: { type: "number", minimum: -90, maximum: 90 },
        regionId: textSchema("Destination region identifier, when known."),
        note: textSchema("Brief explanation of the operation."),
      },
      required: ["op", "unitId", "toLng", "toLat"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["attack"] },
        unitId: nonEmptyTextSchema("Existing attacking unit identifier."),
        targetUnitId: nonEmptyTextSchema("Existing enemy unit identifier."),
        note: textSchema("Brief explanation of why these units engage."),
      },
      required: ["op", "unitId", "targetUnitId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["strength"] },
        unitId: nonEmptyTextSchema("Existing unit identifier."),
        strength: { type: "integer", minimum: 0, maximum: 1000 },
        note: textSchema("Brief explanation of the operation."),
      },
      required: ["op", "unitId", "strength"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["remove"] },
        unitId: nonEmptyTextSchema("Existing unit identifier."),
        note: textSchema("Brief explanation of the operation."),
      },
      required: ["op", "unitId"],
      additionalProperties: false,
    },
  ],
};

const markerStatusSchema = {
  type: "string",
  enum: ["planned", "under_construction", "active", "damaged", "inactive", "abandoned", "destroyed"],
  description: "Current lifecycle state of the persistent physical feature.",
};

const markerSchema = {
  type: "object",
  description:
    "A persistent named physical feature on the map. kind is free-form lowercase - city, military base, "
    + "bunker, missile silo, embassy, port, airfield, factory, laboratory, logistics hub, monument, or anything else.",
  properties: {
    id: textSchema("Stable marker identifier. Omit for a genuinely new feature; native Javascript assigns it."),
    name: nonEmptyTextSchema("Display name of the physical feature."),
    kind: nonEmptyTextSchema("What the feature is, as a short lowercase noun phrase."),
    ownerCode: textSchema("Operating/owning polity's FULL country name (\"Spain\") when owned, never a country code."),
    status: markerStatusSchema,
    lng: {
      type: "number",
      description: "Longitude of the feature.",
      minimum: -180,
      maximum: 180,
    },
    lat: {
      type: "number",
      description: "Latitude of the feature.",
      minimum: -90,
      maximum: 90,
    },
    note: textSchema("Brief current description useful for later history."),
    foundedAt: textSchema("In-game date the feature was built, founded, or first established."),
  },
  required: ["name", "kind", "lng", "lat"],
  additionalProperties: false,
};

const markerOpSchema = {
  description: "Persistent physical-world mutation. Use build for a genuinely new feature; update/rename for an existing stable object; remove only for canonical deletion/admin cleanup.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["build"] },
        marker: markerSchema,
      },
      required: ["op", "marker"],
      additionalProperties: false,
    },
    // Flat build remains accepted because older/frozen prompts and weaker models
    // sometimes place the marker fields beside `op`; runtime lifts it canonically.
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["build"] },
        id: textSchema("Stable marker identifier; normally omit for a new feature."),
        name: nonEmptyTextSchema("Name of the physical feature."),
        kind: textSchema("What it is: factory, base, bunker, silo, embassy, port, laboratory, logistics hub, etc."),
        ownerCode: textSchema("Operating/owning polity's FULL country name (\"Spain\"), never a country code."),
        status: markerStatusSchema,
        lng: { type: "number", description: "Longitude.", minimum: -180, maximum: 180 },
        lat: { type: "number", description: "Latitude.", minimum: -90, maximum: 90 },
        note: textSchema("Brief current description."),
        foundedAt: textSchema("In-game establishment date."),
      },
      required: ["op", "name", "lng", "lat"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["update"] },
        markerId: textSchema("Existing stable marker id. Prefer this whenever supplied in CURRENT MAP STRUCTURES."),
        name: textSchema("Existing feature name, only as fallback when markerId is unavailable."),
        kind: textSchema("New/current feature kind when materially changed."),
        ownerCode: textSchema("New/current operating polity's FULL country name when control/ownership changes."),
        status: markerStatusSchema,
        lng: { type: "number", description: "New longitude only when the physical feature genuinely relocates.", minimum: -180, maximum: 180 },
        lat: { type: "number", description: "New latitude only when the physical feature genuinely relocates.", minimum: -90, maximum: 90 },
        note: textSchema("Updated brief current description after this event."),
      },
      required: ["op"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["remove"] },
        markerId: textSchema("Existing stable marker identifier, preferred when known."),
        name: textSchema("Existing feature name when markerId is unavailable."),
        note: textSchema("Brief explanation of canonical deletion/correction."),
      },
      required: ["op"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["rename"] },
        markerId: textSchema("Existing stable marker identifier, preferred when known."),
        name: textSchema("Current name of the feature or city when markerId is unavailable."),
        newName: nonEmptyTextSchema("New display name."),
        note: textSchema("Brief explanation of the rename."),
      },
      required: ["op", "newName"],
      additionalProperties: false,
    },
  ],
};

const impactsSchema = {
  type: "object",
  description: "Optional structured world-state effects. Include only effect arrays that are relevant.",
  properties: {
    actionIds: stringArraySchema("Player action identifiers resolved by the event."),
    createdChats: {
      type: "array",
      description: "Diplomatic chats opened by the event.",
      items: createdChatSchema,
    },
    polityChanges: {
      type: "array",
      description: "Polity metadata changes.",
      items: polityChangeSchema,
    },
    regionTransfers: {
      type: "array",
      description:
        "LEGAL SOVEREIGNTY changes only: treaty cession, annexation/incorporation, recognized transfer, sale, unification or final settlement. "
        + "Do NOT use this for a temporary wartime capture/occupation; use regionControlOps instead.",
      items: regionTransferSchema,
    },
    regionControlOps: {
      type: "array",
      description:
        "DE-FACTO territorial control and active front disputes. Use for wartime contest, capture/occupation/retaking and clearing a contest without pretending sovereignty changed.",
      items: regionControlOpSchema,
    },
    unitOps: {
      type: "array",
      description: "Military unit operations.",
      items: unitOpSchema,
    },
    markerOps: {
      type: "array",
      description:
        "Persistent physical-world lifecycle changes. Build significant new named facilities/places; update existing ones when they are expanded, captured, damaged, converted, completed, abandoned, or destroyed; rename without replacing identity. Remove is canonical cleanup, not ordinary destruction.",
      items: markerOpSchema,
    },
  },
  additionalProperties: false,
};

const eventQuoteSchema = {
  type: "object",
  description:
    "Optional attributed quotation displayed separately from the event narrative. "
    + "Use only when a genuinely meaningful quotation improves the event.",
  properties: {
    text: nonEmptyTextSchema(
      "Quotation text only, without surrounding quotation marks. Do not duplicate it in description.",
    ),
    speaker: textSchema(
      "Person or institution to whom the quotation is attributed. Leave empty rather than guessing.",
    ),
    role: textSchema(
      "Optional office, title, or role of the speaker when it helps identify them.",
    ),
  },
  required: ["text"],
  additionalProperties: false,
};

const eventSchema = {
  type: "object",
  description: "One dated campaign event produced by a timeline simulation.",
  properties: {
    id: textSchema("Optional stable event identifier."),
    date: textSchema("In-game date on which the event occurs."),
    title: textSchema("Concise event headline."),
    description: textSchema("Specific narrative description and consequences."),
    quote: eventQuoteSchema,
    importance: textSchema("Importance label, normally minor or major."),
    kind: textSchema("Event category, such as world, player, diplomacy, or military."),
    notable: {
      type: "boolean",
      description: "Whether this event is important enough to stop an automatic jump.",
    },
    playerRelated: {
      type: "boolean",
      description: "Whether the event directly concerns the player polity.",
    },
    warId: textSchema(
      "Canonical world.wars id for this event when it declares/joins/ends a war or depicts actual combat. Blank for non-war events.",
    ),
    combatants: {
      type: "array",
      description:
        "For actual battlefield combat, the polity names directly fighting in this event. Must include belligerents from both sides of warId.",
      maxItems: 8,
      items: nonEmptyTextSchema("One canonical belligerent polity name."),
    },
    impacts: impactsSchema,
  },
  required: ["date", "title", "description"],
  additionalProperties: false,
};

const catalystSchema = {
  type: "object",
  description: "An interactive catalyst scene offered to the player.",
  properties: {
    title: textSchema("Short catalyst title."),
    premise: textSchema("Stable premise and stakes of the scene."),
    opening: textSchema("Immersive opening state requiring player input."),
    choices: {
      type: "array",
      description: "Two to five distinct choices available to the player.",
      minItems: 2,
      maxItems: 5,
      items: nonEmptyTextSchema("One player choice."),
    },
  },
  required: ["title", "premise", "opening", "choices"],
  additionalProperties: false,
};

const nullableCatalystSchema = {
  anyOf: [catalystSchema, { type: "null" }],
};

export const ACTIONS_SCHEMA = {
  type: "object",
  description: "Strategic topics of concern and concrete actions available under each topic.",
  properties: {
    topics: {
      type: "array",
      description: "Current strategic topics of concern.",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: textSchema("Optional stable topic identifier."),
          title: textSchema("Short title naming the concern."),
          description: textSchema("Why the concern matters now."),
          actions: {
            type: "array",
            description: "Concrete actions addressing this concern.",
            minItems: 1,
            items: actionSchema,
          },
        },
        required: ["title", "description", "actions"],
        additionalProperties: false,
      },
    },
  },
  required: ["topics"],
  additionalProperties: false,
};


// ---------------------------------------------------------------------------
// Structured canonical ledger transport
// ---------------------------------------------------------------------------
// The model decides semantic state. Javascript owns serialization, relation-status
// derivation, canonical identity resolution, causal event binding, clamping,
// deduplication and persistence. These arrays deliberately expose NO positional
// mini-language and NO pass-local event-number fields to the model.
const storylineUpdateSchema = {
  type: "object",
  description:
    "One semantic persistent-storyline update. Do not provide event indexes/ids; native Javascript binds causal events.",
  properties: {
    id: nonEmptyTextSchema("Stable storyline id. Reuse an existing id when advancing an existing process."),
    status: {
      type: "string",
      enum: ["active", "dormant", "resolved"],
      description: "Current process status.",
    },
    pressure: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Current structural pressure, 0-100.",
    },
    momentum: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Current tendency to keep developing without a new external shove, 0-100.",
    },
    startedDate: textSchema("YYYY-MM-DD date when the process began, when known."),
    kind: nonEmptyTextSchema("Short process category such as war, crisis, revolution, diplomacy, politics, or economy."),
    title: nonEmptyTextSchema("Concise persistent process title."),
    participants: {
      type: "array",
      maxItems: 12,
      description: "Current canonical polity participants. Use exact current polity identities.",
      items: nonEmptyTextSchema("One current canonical polity."),
    },
    state: nonEmptyTextSchema("Semantic state through the current stop date: what is true now and why the process remains active/dormant/resolved."),
  },
  required: ["id", "status", "pressure", "momentum", "kind", "title", "participants", "state"],
  additionalProperties: false,
};

const warUpdateSchema = {
  type: "object",
  description:
    "One semantic canonical belligerency lifecycle operation. Do not provide event indexes/ids; native Javascript binds it to the causal event, primarily through event.warId and transition semantics.",
  properties: {
    id: nonEmptyTextSchema("Stable canonical war id. Reuse the same id for later operations on the same conflict."),
    op: {
      type: "string",
      enum: ["start", "join-a", "join-b", "leave", "ceasefire", "resume", "end"],
      description: "Belligerency lifecycle operation.",
    },
    actors: {
      type: "array",
      maxItems: 12,
      description: "Polities performing the operation. For start, these are Side A.",
      items: nonEmptyTextSchema("One current canonical polity."),
    },
    opponents: {
      type: "array",
      maxItems: 12,
      description: "For start, Side B. Otherwise include opponents only when semantically useful; an empty array is valid.",
      items: nonEmptyTextSchema("One current canonical polity."),
    },
    note: textSchema("Brief semantic reason/current meaning of the operation."),
  },
  required: ["id", "op", "actors", "opponents"],
  additionalProperties: false,
};

const relationUpdateSchema = {
  type: "object",
  description:
    "One material bilateral political-climate update. The model chooses the absolute score and reason; native Javascript derives the status band and binds the causal event.",
  properties: {
    a: nonEmptyTextSchema("First current canonical polity."),
    b: nonEmptyTextSchema("Second current canonical polity."),
    score: {
      type: "integer",
      minimum: -100,
      maximum: 100,
      description: "Absolute bilateral political-climate score after the causal development.",
    },
    summary: nonEmptyTextSchema("Why this bilateral climate has this value now."),
  },
  required: ["a", "b", "score", "summary"],
  additionalProperties: false,
};

const agreementUpdateSchema = {
  type: "object",
  description:
    "One semantic formal-agreement lifecycle operation. Do not provide event indexes/ids; native Javascript binds the causal event.",
  properties: {
    id: nonEmptyTextSchema("Stable agreement id. Reuse an existing id for later lifecycle operations."),
    op: {
      type: "string",
      enum: ["start", "update", "suspend", "resume", "end", "expire"],
      description: "Formal agreement lifecycle operation.",
    },
    type: {
      type: "string",
      enum: [
        "alliance",
        "mutual_defense",
        "guarantee",
        "non_aggression",
        "friendship_consultation",
        "trade_economic",
        "military_cooperation",
        "military_access",
        "neutrality",
        "peace_settlement",
        "other",
      ],
      description: "Agreement category when known. For a new start, choose the best matching category.",
    },
    parties: {
      type: "array",
      maxItems: 12,
      description: "Current canonical parties. For guarantees, guarantor first and beneficiary second.",
      items: nonEmptyTextSchema("One current canonical polity."),
    },
    title: textSchema("Formal agreement title. Required semantically for a new start; may repeat the current title on later lifecycle changes."),
    terms: textSchema("Concise material terms/current change. Do not invent legal detail solely to fill this field."),
  },
  required: ["id", "op", "type", "parties", "title"],
  additionalProperties: false,
};



// ---------------------------------------------------------------------------
// Gemini-safe canonical update envelope
// ---------------------------------------------------------------------------
// Function-calling ANY mode is sensitive to schema complexity. Keep this transport
// intentionally flat and all-required: the model supplies semantic values, while
// Javascript ignores irrelevant fields for each kind and owns every bookkeeping step.
const canonicalUpdateSchema = {
  type: "object",
  description:
    "One semantic canonical-state update. Every field is required for provider reliability; use empty string, empty array, or 0 for fields irrelevant to this kind.",
  properties: {
    kind: {
      type: "string",
      description:
        "Semantic kind code. Use relation; storyline:active; storyline:dormant; storyline:resolved; war:start; war:join-a; war:join-b; war:leave; war:ceasefire; war:resume; war:end; agreement:start; agreement:update; agreement:suspend; agreement:resume; agreement:end; agreement:expire.",
    },
    id: { type: "string", description: "Stable storyline/war/agreement id, or empty for relation." },
    polities: {
      type: "array",
      description:
        "Primary polities. Relation: exactly [A,B]. Storyline: participants. War: actors/Side A. Agreement: parties.",
      items: { type: "string" },
    },
    opponents: {
      type: "array",
      description: "War opponents/Side B; empty for non-war updates.",
      items: { type: "string" },
    },
    score: {
      type: "integer",
      description: "Relation absolute score -100..100; 0 for non-relation updates. Javascript clamps and derives status.",
    },
    pressure: {
      type: "integer",
      description: "Storyline pressure 0..100; 0 for non-storyline updates.",
    },
    momentum: {
      type: "integer",
      description: "Storyline momentum 0..100; 0 for non-storyline updates.",
    },
    date: { type: "string", description: "Storyline startedDate when known; otherwise empty." },
    category: {
      type: "string",
      description: "Storyline process kind or agreement type; otherwise empty.",
    },
    title: {
      type: "string",
      description: "Storyline/agreement title when relevant; otherwise empty.",
    },
    detail: {
      type: "string",
      description: "Relation summary, storyline state, war note, or agreement terms.",
    },
  },
  required: [
    "kind",
    "id",
    "polities",
    "opponents",
    "score",
    "pressure",
    "momentum",
    "date",
    "category",
    "title",
    "detail",
  ],
  additionalProperties: false,
};


export const JUMP_FORWARD_SCHEMA = {
  type: "object",
  description: "A simulated timeline jump containing dated events and the resulting campaign state.",
  properties: {
    events: {
      type: "array",
      description: "Events occurring during the simulated period.",
      items: eventSchema,
    },
    stopDate: textSchema("Date at which the simulation stops."),
    summary: textSchema("Concise summary of the period and its strategic consequences."),
    clearActions: {
      type: "boolean",
      description: "Whether planned player actions were resolved by this jump.",
    },
    catalyst: nullableCatalystSchema,
    diplomaticOutreach: {
      type: "array",
      description:
        "Polities reaching out to the player ON THEIR OWN initiative - treaty "
        + "feelers, trade proposals, warnings, summit invitations - not tied to "
        + "any single event. One-on-one or group. Empty when nobody would "
        + "plausibly reach out this period.",
      items: createdChatSchema,
    },
    storylineUpdates: {
      type: "string",
      description:
        "Compact newline-separated storyline records. Empty string when none. Record format is documented in the live prompt.",
    },
    warUpdates: {
      type: "string",
      description:
        "Compact newline-separated canonical war-state operations. Empty string when no belligerency changes. Record format is documented in the live prompt.",
    },
    relationUpdates: {
      type: "string",
      description:
        "Compact newline-separated bilateral relation updates. Empty string when no material bilateral political relation changes. Record format is documented in the live prompt.",
    },
    agreementUpdates: {
      type: "string",
      description:
        "Compact newline-separated formal treaty/agreement lifecycle updates. Empty string when no formal commitment starts, changes, suspends, resumes, ends, or expires. Record format is documented in the live prompt.",
    },
  },
  required: [
    "events",
    "stopDate",
    "summary",
    "clearActions",
    "storylineUpdates",
    "warUpdates",
    "relationUpdates",
    "agreementUpdates",
  ],
  additionalProperties: false,
};

export const AUTO_JUMP_FORWARD_SCHEMA = JUMP_FORWARD_SCHEMA;

// Backstory events deliberately have NO impacts field: the scenario's map/world
// already reflects pre-round-one territorial and polity state. Pregame generation
// may, however, carry a canonical warId so the SAME one-time response can bootstrap
// already-existing wars into world.wars without replaying historical impacts.
const pregameEventSchema = {
  type: "object",
  description: "One dated historical event from BEFORE the game's start date.",
  properties: {
    date: textSchema("Date the event occurred, strictly before the game start date."),
    title: textSchema("Concise event headline."),
    description: textSchema("Specific narrative description and its consequences."),
    quote: eventQuoteSchema,
    importance: textSchema("Importance label, normally minor or major."),
    kind: textSchema("Event category, such as world, player, diplomacy, or military."),
    warId: textSchema(
      "Canonical war id when this event establishes or materially concerns a conflict that is still active or in ceasefire at Round One; omit/blank otherwise.",
    ),
  },
  required: ["date", "title", "description"],
  additionalProperties: false,
};

export const PREGAME_HISTORY_SCHEMA = {
  type: "object",
  description:
    "The pre-game backstory plus the canonical Round-One bootstrap for unresolved processes and already-existing diplomatic/war state.",
  properties: {
    events: {
      type: "array",
      description: "Chronological events from before round one, oldest first.",
      minItems: 1,
      maxItems: 12,
      items: pregameEventSchema,
    },
    summary: textSchema("One-paragraph summary of the era leading into the start date."),
    canonicalUpdates: {
      type: "array",
      description:
        "Semantic Day-1 storyline/war/relation/agreement state. Empty array only when no qualifying canonical state exists. Javascript dispatches and binds it.",
      maxItems: 32,
      items: canonicalUpdateSchema,
    },
  },
  required: [
    "events",
    "summary",
    "canonicalUpdates",
  ],
  additionalProperties: false,
};

// The idle-time diplomatic drip: while the player sits between jumps, a polity
// may send a short note to their inbox. `chat: null` means nobody plausibly
// would right now - silence is the common, correct answer.
export const IDLE_DIPLOMACY_SCHEMA = {
  type: "object",
  description: "At most one short unprompted diplomatic note to the player, or null for silence.",
  properties: {
    chat: {
      anyOf: [
        { type: "null", description: "No polity would plausibly reach out right now." },
        createdChatSchema,
      ],
    },
  },
  required: ["chat"],
  additionalProperties: false,
};

export const DESCRIPTION_TO_ACTION_SCHEMA = {
  type: "object",
  description: "One structured game command converted from the player's freeform intent.",
  properties: {
    title: textSchema("Short display title for the command."),
    text: textSchema("Expanded command with enough detail for timeline simulation."),
    kind: textSchema('Command kind: "action" unless the player explicitly asked to open a diplomatic chat.'),
    invitees: stringArraySchema("Exact polity names invited to a chat; empty for a normal action."),
    chatStarter: textSchema("Opening message for a chat; empty for a normal action."),
  },
  required: ["title", "text", "kind"],
  additionalProperties: false,
};

export const NEXT_SPEAKER_SCHEMA = {
  type: "object",
  description: "The exact participant who should speak next in a group diplomatic chat, or null when the floor should return to the player.",
  properties: {
    nextSpeaker: {
      anyOf: [
        { type: "null", description: "Nobody has a distinct useful response right now; return the floor to the player." },
        textSchema("Exact name of one eligible chat participant who should speak next."),
      ],
    },
  },
  required: ["nextSpeaker"],
  additionalProperties: false,
};

export const EVENT_CONSOLIDATOR_SCHEMA = {
  type: "object",
  description: "A continuity-safe summary of the supplied events and diplomatic chats.",
  properties: {
    summary: textSchema("Concise campaign history preserving major events, map changes, and diplomatic commitments."),
  },
  required: ["summary"],
  additionalProperties: false,
};

export const CATALYST_CREATION_SCHEMA = catalystSchema;

export const CATALYST_EXECUTOR_SCHEMA = {
  type: "object",
  description: "The next stage of an active catalyst after applying the player's choice.",
  properties: {
    summary: textSchema("Narration of the player's action, reactions, and resulting situation."),
    resolved: {
      type: "boolean",
      description: "Whether the catalyst has reached a definite conclusion.",
    },
    nextChoices: {
      type: "array",
      description: "Two to five choices for an unresolved next stage; empty when resolved.",
      maxItems: 5,
      items: nonEmptyTextSchema("One player choice."),
    },
  },
  required: ["summary", "resolved", "nextChoices"],
  additionalProperties: false,
};

export const CATALYST_SUMMARY_SCHEMA = {
  type: "object",
  description: "A resolved catalyst condensed into one campaign timeline event.",
  properties: {
    title: textSchema("Concise event headline."),
    description: textSchema("Complete but concise account of the catalyst outcome."),
    importance: textSchema("Event importance, normally major."),
  },
  required: ["title", "description", "importance"],
  additionalProperties: false,
};

const gmEventIndexesSchema = {
  type: "array",
  description: "0-based indexes into this GM transaction's events array.",
  maxItems: 8,
  items: { type: "integer", minimum: 0 },
};

const gmWarUpdateSchema = {
  type: "object",
  description: "One authoritative world.wars lifecycle operation.",
  properties: {
    id: nonEmptyTextSchema("Stable canonical war id. Reuse the existing id for an existing conflict."),
    op: {
      type: "string",
      enum: ["start", "join-a", "join-b", "leave", "ceasefire", "resume", "end"],
    },
    actors: stringArraySchema("Polities acted on by this operation. Full polity names only."),
    opponents: stringArraySchema("Opposing side for a new war or when otherwise useful. Full polity names only."),
    eventIndexes: gmEventIndexesSchema,
    note: textSchema("Brief canonical reason for the belligerency change."),
  },
  required: ["id", "op", "actors", "opponents", "eventIndexes", "note"],
  additionalProperties: false,
};

const gmRelationUpdateSchema = {
  type: "object",
  description: "One absolute bilateral political-climate update for world.relations.",
  properties: {
    a: nonEmptyTextSchema("First polity, using its full canonical name."),
    b: nonEmptyTextSchema("Second polity, using its full canonical name."),
    score: { type: "integer", minimum: -100, maximum: 100 },
    status: {
      type: "string",
      enum: ["friendly", "cordial", "neutral", "cautious", "strained", "hostile", "rival"],
    },
    eventIndexes: gmEventIndexesSchema,
    summary: textSchema("Concise reason/current meaning of the relation state."),
  },
  required: ["a", "b", "score", "status", "eventIndexes", "summary"],
  additionalProperties: false,
};

const gmAgreementUpdateSchema = {
  type: "object",
  description: "One formal agreement lifecycle operation for world.agreements.",
  properties: {
    id: nonEmptyTextSchema("Stable agreement id. Reuse an existing id for later lifecycle operations."),
    op: {
      type: "string",
      enum: ["start", "update", "suspend", "resume", "end", "expire"],
    },
    type: {
      type: "string",
      enum: [
        "alliance",
        "mutual_defense",
        "guarantee",
        "non_aggression",
        "friendship_consultation",
        "trade_economic",
        "military_cooperation",
        "military_access",
        "neutrality",
        "peace_settlement",
        "other",
      ],
    },
    parties: stringArraySchema("Formal parties, using full canonical polity names."),
    eventIndexes: gmEventIndexesSchema,
    title: textSchema("Canonical agreement title; required when starting a new agreement."),
    terms: textSchema("Compact durable terms or lifecycle note."),
  },
  required: ["id", "op", "type", "parties", "eventIndexes", "title", "terms"],
  additionalProperties: false,
};

const gmCountryStatPatchSchema = {
  type: "object",
  description:
    "One authoritative current-baseline Stats edit. This is for exact GM/admin correction, not ordinary simulated economic drift.",
  properties: {
    country: nonEmptyTextSchema("Existing target polity's full canonical name."),
    patch: {
      type: "object",
      properties: {
        capital: textSchema("Capital, when explicitly changed."),
        continent: textSchema("Continent/broad region label, when explicitly changed."),
        government: textSchema("Government system/ideology, when explicitly changed."),
        leader: textSchema("Current leader, when explicitly changed."),
        stability: { type: "number", minimum: 0, maximum: 100 },
        population: {
          type: "object",
          properties: {
            total: { type: "integer", minimum: 1 },
          },
          required: ["total"],
          additionalProperties: false,
        },
        indices: {
          type: "object",
          properties: {
            sovereignty: { type: "number", minimum: 0, maximum: 100 },
            foodAutonomy: { type: "number", minimum: 0, maximum: 100 },
            energyAutonomy: { type: "number", minimum: 0, maximum: 100 },
            economicIndependence: { type: "number", minimum: 0, maximum: 100 },
            internalSecurity: { type: "number", minimum: 0, maximum: 100 },
            internationalReputation: { type: "number", minimum: 0, maximum: 100 },
          },
          additionalProperties: false,
        },
        economy: {
          type: "object",
          properties: {
            gdp: { type: "number", minimum: 1 },
            gdpGrowth: { type: "number", minimum: -1000, maximum: 1000 },
            currency: textSchema("Current currency."),
            inflation: { type: "number", minimum: -1000, maximum: 1000 },
            unemployment: { type: "number", minimum: 0, maximum: 100 },
            publicDebt: { type: "number", minimum: 0, maximum: 1000 },
            budgetBalance: { type: "number", minimum: -1000, maximum: 1000 },
          },
          additionalProperties: false,
        },
        gdpBreakdown: {
          type: "object",
          properties: {
            agriculture: { type: "integer", minimum: 0, maximum: 100 },
            industry: { type: "integer", minimum: 0, maximum: 100 },
            services: { type: "integer", minimum: 0, maximum: 100 },
          },
          required: ["agriculture", "industry", "services"],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    eventIndexes: gmEventIndexesSchema,
    reason: textSchema("Why the authoritative baseline is being changed."),
  },
  required: ["country", "patch", "eventIndexes", "reason"],
  additionalProperties: false,
};

export const GAME_MASTER_SCHEMA = {
  type: "object",
  description:
    "A previewable native GM transaction. The AI plans structured canonical operations; this payload is not itself permission to persist them.",
  properties: {
    mode: {
      type: "string",
      enum: ["direct", "exact-event", "world-intervention"],
      description: "GM mode selected by the administrator.",
    },
    summary: textSchema("Concise explanation of what this transaction would change if applied."),
    events: {
      type: "array",
      description: "Canonical timeline events authored by this transaction. Direct corrections may legitimately contain none.",
      maxItems: 8,
      items: eventSchema,
    },
    countryStatPatches: {
      type: "array",
      description: "Authoritative whole-polity/current-baseline Stats corrections.",
      maxItems: 12,
      items: gmCountryStatPatchSchema,
    },
    warUpdates: {
      type: "array",
      description: "Structured canonical belligerency changes. Never encode these as strings.",
      maxItems: 12,
      items: gmWarUpdateSchema,
    },
    relationUpdates: {
      type: "array",
      description: "Structured canonical bilateral political-climate changes.",
      maxItems: 16,
      items: gmRelationUpdateSchema,
    },
    agreementUpdates: {
      type: "array",
      description: "Structured formal agreement lifecycle changes.",
      maxItems: 12,
      items: gmAgreementUpdateSchema,
    },
    diplomaticOutreach: {
      type: "array",
      description: "Direct NPC-to-player chats not attached to one specific authored event.",
      maxItems: 3,
      items: createdChatSchema,
    },
  },
  required: [
    "mode",
    "summary",
    "events",
    "countryStatPatches",
    "warUpdates",
    "relationUpdates",
    "agreementUpdates",
    "diplomaticOutreach",
  ],
  additionalProperties: false,
};


// Phase 8B.1 provider transport: Gemini rejects very large/deep function
// declaration schemas with HTTP 400 "Request contains an invalid argument."
// Keep the native GM transaction fully structured *inside the app*, but send
// it through a deliberately shallow tool contract. Each subsystem is JSON array
// text, decoded immediately and then validated against GAME_MASTER_SCHEMA before
// any preview is accepted. This avoids the old bespoke `~` mini-language without
// asking the provider to ingest the entire nested world-mutation schema.
export const GAME_MASTER_TRANSPORT_SCHEMA = {
  type: "object",
  description: "Compact provider transport for a previewable native GM transaction.",
  properties: {
    mode: {
      type: "string",
      enum: ["direct", "exact-event", "world-intervention"],
    },
    summary: textSchema("Concise explanation of what the transaction would change if applied."),
    eventsJson: textSchema("JSON array text for canonical event objects. Use [] when none."),
    countryStatPatchesJson: textSchema("JSON array text for authoritative country Stats patches. Use [] when none."),
    warUpdatesJson: textSchema("JSON array text for structured world.wars lifecycle operations. Use [] when none."),
    relationUpdatesJson: textSchema("JSON array text for structured world.relations operations. Use [] when none."),
    agreementUpdatesJson: textSchema("JSON array text for structured world.agreements lifecycle operations. Use [] when none."),
    diplomaticOutreachJson: textSchema("JSON array text for direct NPC-to-player diplomatic outreach. Use [] when none."),
  },
  required: [
    "mode",
    "summary",
    "eventsJson",
    "countryStatPatchesJson",
    "warUpdatesJson",
    "relationUpdatesJson",
    "agreementUpdatesJson",
    "diplomaticOutreachJson",
  ],
  additionalProperties: false,
};

const parseGameMasterTransportArray = (value, field) => {
  if (Array.isArray(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`$.${field} must contain valid JSON array text: ${error?.message || error}.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`$.${field} must decode to a JSON array.`);
  }
  return parsed;
};

export const decodeGameMasterTransportPayload = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { payload: value, error: "" };
  }

  const transportFields = [
    "eventsJson",
    "countryStatPatchesJson",
    "warUpdatesJson",
    "relationUpdatesJson",
    "agreementUpdatesJson",
    "diplomaticOutreachJson",
  ];
  const isTransport = transportFields.some((field) => Object.prototype.hasOwnProperty.call(value, field));
  if (!isTransport) {
    // Raw/local providers may already return the internal structured transaction.
    return { payload: value, error: "" };
  }

  try {
    return {
      payload: {
        mode: String(value.mode ?? "").trim(),
        summary: String(value.summary ?? "").trim(),
        events: parseGameMasterTransportArray(value.eventsJson, "eventsJson"),
        countryStatPatches: parseGameMasterTransportArray(value.countryStatPatchesJson, "countryStatPatchesJson"),
        warUpdates: parseGameMasterTransportArray(value.warUpdatesJson, "warUpdatesJson"),
        relationUpdates: parseGameMasterTransportArray(value.relationUpdatesJson, "relationUpdatesJson"),
        agreementUpdates: parseGameMasterTransportArray(value.agreementUpdatesJson, "agreementUpdatesJson"),
        diplomaticOutreach: parseGameMasterTransportArray(value.diplomaticOutreachJson, "diplomaticOutreachJson"),
      },
      error: "",
    };
  } catch (error) {
    return { payload: null, error: String(error?.message || error || "Invalid GM transport payload.") };
  }
};

const percentageSchema = (description) => ({
  type: "integer",
  description,
  minimum: 0,
  maximum: 100,
});

const statNumberSchema = (description, { minimum, maximum } = {}) => ({
  type: "number",
  description,
  ...(Number.isFinite(minimum) ? { minimum } : {}),
  ...(Number.isFinite(maximum) ? { maximum } : {}),
});

export const COUNTRY_STAT_GENERATION_SCHEMA = {
  type: "object",
  description:
    "Compact generation transport for a persistent national statistics sheet. Native code expands a bounded regional macro estimate into the exact live-map territorial ledger and deterministically derives population/GDP aggregates before canonical validation.",
  properties: {
    capital: nonEmptyTextSchema("Capital or primary seat of government."),
    continent: nonEmptyTextSchema("Continent or broad geographic region."),
    government: nonEmptyTextSchema("Government system and ideology."),
    leader: nonEmptyTextSchema("Head of state or government."),
    stability: percentageSchema("National stability from 0 to 100."),
    indices: {
      type: "object",
      properties: {
        sovereignty: percentageSchema("Practical political sovereignty."),
        foodAutonomy: percentageSchema("Domestic food autonomy."),
        energyAutonomy: percentageSchema("Domestic energy autonomy."),
        economicIndependence: percentageSchema("Economic independence."),
        internalSecurity: percentageSchema("Internal security."),
        internationalReputation: percentageSchema("International reputation / standing (0-100)."),
      },
      required: ["sovereignty", "foodAutonomy", "energyAutonomy", "economicIndependence", "internalSecurity", "internationalReputation"],
      additionalProperties: false,
    },
    populationCalibration: {
      type: "object",
      description:
        "Scenario-causality provenance for a native regional bootstrap/reconstruction. Return this ONLY when the live Stats prompt says CAUSAL CALIBRATION REQUIRED. It identifies the history authority frontier but does not impose a whole-polity numeric target.",
      properties: {
        mode: {
          type: "string",
          enum: ["historical_start", "counterfactual_start", "campaign_reconstruction"],
          description:
            "historical_start only when scenario history is still materially shared through the start date; counterfactual_start when pre-start canon diverged; campaign_reconstruction for a later hard audit reconstructed from campaign canon.",
        },
        historyAuthorityCutoff: nonEmptyTextSchema(
          "Latest date/era through which real-world history is still causally shared enough to use as demographic evidence. After this frontier, scenario/campaign canon wins.",
        ),
        basis: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          description:
            "One concise evidence summary for the regional calibration: identify the shared historical/regional baseline and relevant post-cutoff scenario canon. Do not provide hidden reasoning; state only the usable basis.",
        },
      },
      required: ["mode", "historyAuthorityCutoff", "basis"],
      additionalProperties: false,
    },
    territorialMacroComponentsText: {
      type: "string",
      minLength: 1,
      description:
        "Bounded regional territorial estimate. With a native macro plan, return exactly one row per [M#] macro bucket as index~group~population~gdpPerCapita. Native code expands each macro row back across every exact live-map component. Compatibility fallback without a native macro plan may use group~geography~population~gdpPerCapita. group is core, integrated, or overseas/dependent; population is an integer; gdpPerCapita is a positive number in 2026-EUR-equivalent accounting terms.",
    },
    economy: {
      type: "object",
      properties: {
        gdpGrowth: statNumberSchema("Annual real GDP growth estimate in percent.", { minimum: -100, maximum: 100 }),
        currency: nonEmptyTextSchema("Current domestic currency or dominant medium of exchange."),
        inflation: statNumberSchema("Annual inflation estimate in percent.", { minimum: 0, maximum: 1000 }),
        unemployment: statNumberSchema("Unemployment estimate in percent.", { minimum: 0, maximum: 100 }),
        publicDebt: statNumberSchema("Public debt as percent of GDP.", { minimum: 0, maximum: 1000 }),
        budgetBalance: statNumberSchema("Budget balance as percent of GDP; negative is deficit, positive is surplus.", { minimum: -1000, maximum: 1000 }),
      },
      required: ["gdpGrowth", "currency", "inflation", "unemployment", "publicDebt", "budgetBalance"],
      additionalProperties: false,
    },
    gdpBreakdown: {
      type: "object",
      properties: {
        agriculture: percentageSchema("Agriculture share of GDP."),
        industry: percentageSchema("Industry share of GDP."),
        services: percentageSchema("Services share of GDP."),
      },
      required: ["agriculture", "industry", "services"],
      additionalProperties: false,
    },
  },
  required: [
    "capital",
    "continent",
    "government",
    "leader",
    "stability",
    "indices",
    "territorialMacroComponentsText",
    "economy",
    "gdpBreakdown",
  ],
  additionalProperties: false,
};

export const COUNTRY_STAT_SHEET_SCHEMA = {
  type: "object",
  description:
    "A complete persistent national statistics sheet. Territorial components are the arithmetic authority for population and GDP; derived aggregate fields may be omitted because native JavaScript recomputes them before validation/persistence.",
  properties: {
    statsSchemaVersion: {
      type: "integer",
      minimum: 1,
      description: "Native country-stat schema version. Current version is 1; the runtime fills this when omitted.",
    },
    continuity: {
      type: "object",
      description: "Native-only continuity/accounting metadata. The country-stat generation tool does not author this; runtime may attach it after validation.",
      properties: {
        assessedDate: nonEmptyTextSchema("Simulation date of the last full country-stat reassessment."),
        assessedRound: { type: "integer", minimum: 0 },
        stateFingerprint: nonEmptyTextSchema("Native fingerprint of the assessed simulation/economic state."),
        territorialFingerprint: nonEmptyTextSchema("Native fingerprint of the assessed legal territorial basis."),
        populationCalibrationVersion: {
          type: "integer",
          minimum: 1,
          description: "Native population-calibration generation version. Presence means the component ledger has passed the bounded regional causal-calibration path.",
        },
        accountedEventIds: {
          type: "array",
          maxItems: 64,
          items: nonEmptyTextSchema("Canonical economic event id already incorporated into this stat baseline."),
        },
      },
      additionalProperties: false,
    },
    capital: nonEmptyTextSchema("Capital or primary seat of government."),
    continent: nonEmptyTextSchema("Continent or broad geographic region."),
    government: nonEmptyTextSchema("Government system and ideology."),
    leader: nonEmptyTextSchema("Head of state or government."),
    stability: percentageSchema("National stability from 0 to 100."),
    indices: {
      type: "object",
      properties: {
        sovereignty: percentageSchema("Practical political sovereignty."),
        foodAutonomy: percentageSchema("Domestic food autonomy."),
        energyAutonomy: percentageSchema("Domestic energy autonomy."),
        economicIndependence: percentageSchema("Economic independence."),
        internalSecurity: percentageSchema("Internal security."),
        internationalReputation: percentageSchema("International reputation / standing (0-100)."),
      },
      required: ["sovereignty", "foodAutonomy", "energyAutonomy", "economicIndependence", "internalSecurity", "internationalReputation"],
      additionalProperties: false,
    },
    population: {
      type: "object",
      description: "Derived population aggregates. The runtime recomputes these from territorialComponents.",
      properties: {
        total: { type: "integer", minimum: 0 },
        coreIntegrated: { type: "integer", minimum: 0 },
        otherTerritories: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    territorialComponents: {
      type: "array",
      minItems: 1,
      description:
        "One demographic/economic component for every authoritative territorial geography in the live-map basis. There is deliberately no fixed component cap: map granularity must never delete population/GDP. Generation expands bounded regional macro estimates into this exact canonical ledger natively; the model does not author these rows one-by-one.",
      items: {
        type: "object",
        properties: {
          geography: nonEmptyTextSchema("Human-readable controlled/legal geography matching the supplied territorial basis."),
          group: {
            type: "string",
            enum: ["core", "integrated", "overseas/dependent"],
            description: "Economic aggregation/display group only; not a sovereignty or constitutional judgment.",
          },
          population: { type: "integer", minimum: 0, description: "Current inhabitants in THIS geography only." },
          gdpPerCapita: statNumberSchema(
            "THIS component's GDP per capita in 2026-EUR-equivalent purchasing-value terms. This is an accounting unit only; do not import 2026 technology/productivity.",
            { minimum: 1 },
          ),
        },
        required: ["geography", "group", "population", "gdpPerCapita"],
        additionalProperties: false,
      },
    },
    economy: {
      type: "object",
      properties: {
        gdp: statNumberSchema("Derived whole-polity GDP in 2026-EUR-equivalent terms.", { minimum: 1 }),
        gdpGrowth: statNumberSchema("Annual real GDP growth estimate in percent.", { minimum: -100, maximum: 100 }),
        gdpPerCapita: statNumberSchema("Derived whole-polity GDP per capita in 2026-EUR-equivalent terms.", { minimum: 1 }),
        coreGdpPerCapita: statNumberSchema("Derived core/integrated GDP per capita in 2026-EUR-equivalent terms.", { minimum: 1 }),
        otherGdpPerCapita: statNumberSchema("Derived overseas/dependent GDP per capita in 2026-EUR-equivalent terms.", { minimum: 1 }),
        currency: nonEmptyTextSchema("Current domestic currency or dominant medium of exchange."),
        inflation: statNumberSchema("Annual inflation estimate in percent.", { minimum: 0, maximum: 1000 }),
        unemployment: statNumberSchema("Unemployment estimate in percent.", { minimum: 0, maximum: 100 }),
        publicDebt: statNumberSchema("Public debt as percent of GDP.", { minimum: 0, maximum: 1000 }),
        budgetBalance: statNumberSchema("Budget balance as percent of GDP; negative is deficit, positive is surplus.", { minimum: -1000, maximum: 1000 }),
      },
      required: ["gdpGrowth", "currency", "inflation", "unemployment", "publicDebt", "budgetBalance"],
      additionalProperties: false,
    },
    gdpBreakdown: {
      type: "object",
      properties: {
        agriculture: percentageSchema("Agriculture share of GDP."),
        industry: percentageSchema("Industry share of GDP."),
        services: percentageSchema("Services share of GDP."),
      },
      required: ["agriculture", "industry", "services"],
      additionalProperties: false,
    },
  },
  required: [
    "capital",
    "continent",
    "government",
    "leader",
    "stability",
    "indices",
    "territorialComponents",
    "economy",
    "gdpBreakdown",
  ],
  additionalProperties: false,
};
// ---- native timeline curator -----------------------------------------------
// yes, this is a separate ai task. no, we are not making the main world model
// judge its own homework and hoping for the fucking best.

const curatorJudgmentSchema = {
  type: "object",
  description: "One conservative judgment of a newly generated timeline event.",
  properties: {
    index: {
      type: "integer",
      description: "Zero-based index of the candidate event.",
      minimum: 0,
    },

    verdict: {
      type: "string",
      description: "Semantic classification of the candidate.",
      enum: ["KEEP", "REDUNDANT", "UNSUPPORTED_REVERSAL"],
    },

    confidence: {
      type: "number",
      description: "Confidence in the judgment from 0 to 1.",
      minimum: 0,
      maximum: 1,
    },

    materialStateChange: textSchema(
      "Short description of the concrete state or fact established by the event.",
    ),

    matchedPriorIndexes: {
      type: "array",
      description: "Indexes of specific prior canonical events supporting the judgment.",
      items: {
        type: "integer",
        minimum: 0,
      },
    },

    materiallyNewDimensions: stringArraySchema(
      "Materially new dimensions introduced by this event.",
    ),

    recurrenceMatters: {
      type: "boolean",
      description: "Whether repetition itself creates meaningful pressure or consequence.",
    },

    newTriggerAfterPriorPosture: textSchema(
      "New trigger explaining an apparent reversal, or 'none'.",
    ),

    worthwhile: {
      type: "boolean",
      description: "Whether this event deserves space in the persistent timeline.",
    },

    substantive: {
      type: "boolean",
      description: "Whether the event establishes a concrete fact or result.",
    },

    personalityTexture: {
      type: "boolean",
      description: "Whether the event adds useful human, social, or cultural texture.",
    },

    storyline: textSchema(
      "Short stable label for the broad recurring storyline.",
    ),

    qualitativeAdvance: {
      type: "boolean",
      description: "Whether the storyline changes in kind rather than merely degree or paperwork.",
    },

    incrementalProcess: {
      type: "boolean",
      description: "Whether this is mainly another routine step inside an established process.",
    },

    processFramePresent: {
      type: "boolean",
      description: "Whether the event is principally framed as a meeting, review, inspection, consultation, or similar process.",
    },

    observableOutcomeEvidence: textSchema(
      "Exact short clause from the candidate proving a completed observable outcome, or empty.",
    ),

    pureProcessFiller: {
      type: "boolean",
      description: "Whether the event is process without a completed observable outcome.",
    },

    reason: textSchema(
      "Short explanation of the judgment.",
    ),
  },

  required: [
    "index",
    "verdict",
    "confidence",
    "materialStateChange",
    "matchedPriorIndexes",
    "materiallyNewDimensions",
    "recurrenceMatters",
    "newTriggerAfterPriorPosture",
    "worthwhile",
    "substantive",
    "personalityTexture",
    "storyline",
    "qualitativeAdvance",
    "incrementalProcess",
    "processFramePresent",
    "observableOutcomeEvidence",
    "pureProcessFiller",
    "reason",
  ],

  additionalProperties: false,
};

const curatorSaturationSchema = {
  type: "object",
  description: "Recent saturation state for one broad storyline.",
  properties: {
    storyline: nonEmptyTextSchema(
      "Stable storyline label.",
    ),

    count: {
      type: "integer",
      minimum: 0,
      description: "Number of relevant recent canonical events.",
    },

    priorIndexes: {
      type: "array",
      items: {
        type: "integer",
        minimum: 0,
      },
    },

    saturation: {
      type: "string",
      enum: ["low", "busy", "saturated"],
    },

    description: textSchema(
      "Short explanation of the saturation assessment.",
    ),
  },

  required: [
    "storyline",
    "count",
    "priorIndexes",
    "saturation",
    "description",
  ],

  additionalProperties: false,
};


const geographyResolutionSchema = {
  type: "object",
  description:
    "One conservative mapping from an unresolved human place/area label to the current map's real region ids. "
    + "This is geography only: it never decides conquest, ownership, sovereignty, or whether the transfer should happen.",
  properties: {
    index: {
      type: "integer",
      minimum: 0,
      description: "Index of the supplied unresolved geography item.",
    },
    status: {
      type: "string",
      enum: ["RESOLVED", "UNRESOLVED"],
      description: "RESOLVED only when the supplied candidate region list supports a high-confidence geographic mapping.",
    },
    relation: {
      type: "string",
      enum: [
        "REGION_ALIAS",
        "CITY_CONTAINING_REGION",
        "HISTORICAL_AREA",
        "TRANSLATED_AREA",
        "UNRESOLVED",
      ],
      description:
        "Why the source label maps to the selected region ids. REGION_ALIAS and CITY_CONTAINING_REGION normally select one id; "
        + "HISTORICAL_AREA or TRANSLATED_AREA may select several when the named area genuinely spans several supplied regions.",
    },
    regionIds: {
      type: "array",
      description:
        "Exact region ids copied ONLY from the supplied candidateRegions list. Empty when status is UNRESOLVED.",
      items: { type: "string" },
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Confidence that the source label and selected region ids refer to the same geography.",
    },
    reason: textSchema("Brief geography-only reason. Do not discuss who should own or control the territory."),
  },
  required: ["index", "status", "relation", "regionIds", "confidence", "reason"],
  additionalProperties: false,
};

export const GEOGRAPHY_RESOLVER_SCHEMA = {
  type: "object",
  description:
    "Conservative geography-only resolution for regionTransfers that failed exact map-name matching.",
  properties: {
    resolutions: {
      type: "array",
      description: "Exactly one resolution for each supplied unresolved item index.",
      items: geographyResolutionSchema,
    },
  },
  required: ["resolutions"],
  additionalProperties: false,
};

export const TIMELINE_CURATOR_SCHEMA = {
  type: "object",
  description:
    "Conservative semantic analysis of newly generated timeline events.",

  properties: {
    judgments: {
      type: "array",
      description: "One judgment for every supplied candidate event.",
      items: curatorJudgmentSchema,
    },

    recentHistoryMechanical: {
      type: "boolean",
      description: "Whether recent history is dominated by mechanical or administrative progression.",
    },

    storylineSaturation: {
      type: "array",
      description: "Broad recurring storylines detected in recent canonical history.",
      items: curatorSaturationSchema,
    },

    underrepresentedDomains: stringArraySchema(
      "Broad historical domains currently underrepresented in recent events.",
    ),
  },

  required: [
    "judgments",
    "recentHistoryMechanical",
    "storylineSaturation",
    "underrepresentedDomains",
  ],

  additionalProperties: false,
};

const UNIT_DIRECTOR_SCHEMA = {
  type: "object",
  description:
    "A conservative post-simulation military orchestration pass. It reuses persistent units, "
    + "moves them when events require it, and requests deterministic unit-vs-unit attacks rather than inventing casualties.",
  properties: {
    eventOrders: {
      type: "array",
      description: "Unit operations to attach to military events, keyed by the supplied eventIndex.",
      items: {
        type: "object",
        properties: {
          eventIndex: { type: "integer", minimum: 0 },
          unitOps: {
            type: "array",
            items: unitOpSchema,
          },
          reason: textSchema("Short reason these operations are needed for map/state continuity."),
        },
        required: ["eventIndex", "unitOps"],
        additionalProperties: false,
      },
    },
    summary: textSchema("Short summary of how the existing order of battle was advanced this turn."),
  },
  required: ["eventOrders", "summary"],
  additionalProperties: false,
};

const TERRITORY_DIRECTOR_SCHEMA = {
  type: "object",
  description:
    "A conservative post-simulation territorial-front repair pass. It may add de-facto regionControlOps but may not invent legal sovereignty changes.",
  properties: {
    eventOrders: {
      type: "array",
      description: "De-facto control operations to attach to supplied event indexes.",
      items: {
        type: "object",
        properties: {
          eventIndex: { type: "integer", minimum: 0 },
          regionControlOps: {
            type: "array",
            items: regionControlOpSchema,
          },
          reason: textSchema("Short reason these control-state changes are required for map continuity."),
        },
        required: ["eventIndex", "regionControlOps"],
        additionalProperties: false,
      },
    },
    summary: textSchema("Short summary of territorial-front state reconciliation."),
  },
  required: ["eventOrders", "summary"],
  additionalProperties: false,
};

export const GAMEPLAY_SCHEMAS = Object.freeze({
  geographyResolver: GEOGRAPHY_RESOLVER_SCHEMA,
  timelineCurator: TIMELINE_CURATOR_SCHEMA,
  unitDirector: UNIT_DIRECTOR_SCHEMA,
  territoryDirector: TERRITORY_DIRECTOR_SCHEMA,
  actions: ACTIONS_SCHEMA,
  jumpForward: JUMP_FORWARD_SCHEMA,
  autoJumpForward: AUTO_JUMP_FORWARD_SCHEMA,
  descriptionToAction: DESCRIPTION_TO_ACTION_SCHEMA,
  nextSpeaker: NEXT_SPEAKER_SCHEMA,
  eventConsolidator: EVENT_CONSOLIDATOR_SCHEMA,
  catalystCreation: CATALYST_CREATION_SCHEMA,
  catalystExecutor: CATALYST_EXECUTOR_SCHEMA,
  catalystSummary: CATALYST_SUMMARY_SCHEMA,
  gameMaster: GAME_MASTER_SCHEMA,
  countryStatSheet: COUNTRY_STAT_SHEET_SCHEMA,
  idleDiplomacy: IDLE_DIPLOMACY_SCHEMA,
  pregameHistory: PREGAME_HISTORY_SCHEMA,
});

const makeTool = (name, description, schema) => Object.freeze({ name, description, schema });


export const GEOGRAPHY_RESOLVER_TOOL = makeTool(
  "submit_geography_resolution",
  "Resolve unresolved human place or historical-area labels to exact supplied map region ids without deciding territorial outcomes.",
  GEOGRAPHY_RESOLVER_SCHEMA,
);

export const TIMELINE_CURATOR_TOOL = makeTool(
  "submit_timeline_curator",
  "Submit conservative semantic judgments for newly generated timeline events.",
  TIMELINE_CURATOR_SCHEMA,
);

export const UNIT_DIRECTOR_TOOL = makeTool(
  "submit_unit_director",
  "Submit conservative persistent-unit operations for supplied military events.",
  UNIT_DIRECTOR_SCHEMA,
);

export const TERRITORY_DIRECTOR_TOOL = makeTool(
  "submit_territory_director",
  "Submit conservative de-facto territorial control operations for supplied military/front events.",
  TERRITORY_DIRECTOR_SCHEMA,
);

export const ACTIONS_TOOL = makeTool(
  "submit_actions",
  "Submit strategic topics of concern and their suggested player actions.",
  ACTIONS_SCHEMA,
);

export const JUMP_FORWARD_TOOL = makeTool(
  "submit_jump_result",
  "Submit the events, stop date, summary, resolved-action state, and optional catalyst from a timeline jump.",
  JUMP_FORWARD_SCHEMA,
);

export const AUTO_JUMP_FORWARD_TOOL = makeTool(
  "submit_jump_result",
  "Submit the events and result of an automatic timeline jump that stops at the next notable moment.",
  AUTO_JUMP_FORWARD_SCHEMA,
);

export const DESCRIPTION_TO_ACTION_TOOL = makeTool(
  "submit_description_to_action",
  "Submit the structured action or diplomatic chat command derived from the player's freeform intent.",
  DESCRIPTION_TO_ACTION_SCHEMA,
);

export const NEXT_SPEAKER_TOOL = makeTool(
  "submit_next_speaker",
  "Submit the exact group-chat participant who should speak next, or null when nobody needs the floor.",
  NEXT_SPEAKER_SCHEMA,
);

export const EVENT_CONSOLIDATOR_TOOL = makeTool(
  "submit_event_consolidation",
  "Submit a concise continuity summary of the supplied campaign events and chats.",
  EVENT_CONSOLIDATOR_SCHEMA,
);

export const CATALYST_CREATION_TOOL = makeTool(
  "submit_catalyst_creation",
  "Submit a new interactive catalyst scene and the choices available to the player.",
  CATALYST_CREATION_SCHEMA,
);

export const CATALYST_EXECUTOR_TOOL = makeTool(
  "submit_catalyst_execution",
  "Submit the result of the player's catalyst choice and either new choices or a resolved state.",
  CATALYST_EXECUTOR_SCHEMA,
);

export const CATALYST_SUMMARY_TOOL = makeTool(
  "submit_catalyst_summary",
  "Submit the final campaign event produced by a resolved catalyst.",
  CATALYST_SUMMARY_SCHEMA,
);

export const GAME_MASTER_TOOL = makeTool(
  "submit_game_master",
  "Submit the compact provider transport for a previewable native GM transaction. Native code immediately decodes and validates the structured transaction.",
  GAME_MASTER_TRANSPORT_SCHEMA,
);

export const COUNTRY_STAT_SHEET_TOOL = makeTool(
  "submit_country_stat_sheet",
  "Submit the bounded regional national-statistics payload. Native code expands regional macro estimates into the exact live-map territorial ledger and derives aggregate population/GDP fields before persistence.",
  COUNTRY_STAT_GENERATION_SCHEMA,
);

export const IDLE_DIPLOMACY_TOOL = makeTool(
  "submit_idle_diplomacy",
  "Submit at most one short unprompted diplomatic note to the player, or null for silence.",
  IDLE_DIPLOMACY_SCHEMA,
);

export const PREGAME_HISTORY_TOOL = makeTool(
  "submit_pregame_history",
  "Submit the pre-game backstory plus the canonical Round-One bootstrap for unresolved storylines, active wars, material relations, and active formal agreements.",
  PREGAME_HISTORY_SCHEMA,
);

export const GAMEPLAY_TOOLS = Object.freeze({
  geographyResolver: GEOGRAPHY_RESOLVER_TOOL,
  timelineCurator: TIMELINE_CURATOR_TOOL,
  unitDirector: UNIT_DIRECTOR_TOOL,
  territoryDirector: TERRITORY_DIRECTOR_TOOL,
  actions: ACTIONS_TOOL,
  jumpForward: JUMP_FORWARD_TOOL,
  autoJumpForward: AUTO_JUMP_FORWARD_TOOL,
  descriptionToAction: DESCRIPTION_TO_ACTION_TOOL,
  nextSpeaker: NEXT_SPEAKER_TOOL,
  eventConsolidator: EVENT_CONSOLIDATOR_TOOL,
  catalystCreation: CATALYST_CREATION_TOOL,
  catalystExecutor: CATALYST_EXECUTOR_TOOL,
  catalystSummary: CATALYST_SUMMARY_TOOL,
  gameMaster: GAME_MASTER_TOOL,
  countryStatSheet: COUNTRY_STAT_SHEET_TOOL,
  idleDiplomacy: IDLE_DIPLOMACY_TOOL,
  pregameHistory: PREGAME_HISTORY_TOOL,
});

export const getGameplayTool = (taskKey) => GAMEPLAY_TOOLS[taskKey] ?? null;

const valueType = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const propertyPath = (path, key) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

const validateAgainstSchema = (schema, value, path) => {
  if (Array.isArray(schema.anyOf)) {
    const errors = schema.anyOf.map((candidate) => validateAgainstSchema(candidate, value, path));
    if (errors.some((error) => !error)) return "";
    return `${path} did not match any allowed schema: ${errors.join(" ")}`;
  }

  const actualType = valueType(value);
  const typeMatches = schema.type === "integer"
    ? actualType === "number" && Number.isInteger(value)
    : !schema.type || actualType === schema.type;
  if (!typeMatches) {
    return `${path} must be ${schema.type}; received ${valueType(value)}.`;
  }

  if ((schema.type === "number" || schema.type === "integer") && !Number.isFinite(value)) {
    return `${path} must be a finite number.`;
  }

  if ((schema.type === "number" || schema.type === "integer") && Number.isFinite(schema.minimum) && value < schema.minimum) {
    return `${path} must be at least ${schema.minimum}.`;
  }

  if ((schema.type === "number" || schema.type === "integer") && Number.isFinite(schema.maximum) && value > schema.maximum) {
    return `${path} must be at most ${schema.maximum}.`;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `${path} must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}.`;
  }

  if (schema.type === "string" && Number.isFinite(schema.minLength) && value.length < schema.minLength) {
    return `${path} must contain at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}.`;
  }

  if (schema.type === "array") {
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) {
      return `${path} must contain at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}.`;
    }
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) {
      return `${path} must contain at most ${schema.maxItems} items.`;
    }

    for (let index = 0; index < value.length; index += 1) {
      const error = validateAgainstSchema(schema.items ?? {}, value[index], `${path}[${index}]`);
      if (error) return error;
    }
  }

  if (schema.type === "object") {
    const properties = schema.properties ?? {};

    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        return `${propertyPath(path, key)} is required.`;
      }
    }

    for (const [key, entry] of Object.entries(value)) {
      const childSchema = properties[key];
      if (!childSchema) {
        if (schema.additionalProperties === false) {
          return `${propertyPath(path, key)} is not allowed.`;
        }
        continue;
      }

      const error = validateAgainstSchema(childSchema, entry, propertyPath(path, key));
      if (error) return error;
    }
  }

  return "";
};

const hasMeaningfulCatalyst = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  ([value.title, value.premise, value.opening].some(
    (entry) => typeof entry === "string" && entry.trim().length > 0,
  ) ||
    (Array.isArray(value.choices) && value.choices.length > 0));

const validateDistinctChoices = (choices, path) => {
  const normalized = choices.map((choice) => choice.trim().toLocaleLowerCase());
  const blankIndex = normalized.findIndex((choice) => !choice);
  if (blankIndex >= 0) return `${path}[${blankIndex}] must not be blank.`;
  if (new Set(normalized).size !== normalized.length) return `${path} must contain distinct choices.`;
  return "";
};

const findBlankString = (value, path = "$") => {
  if (typeof value === "string") return value.trim() ? "" : `${path} must not be blank.`;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const error = findBlankString(value[index], `${path}[${index}]`);
      if (error) return error;
    }
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const error = findBlankString(entry, propertyPath(path, key));
      if (error) return error;
    }
  }
  return "";
};

export const validateGameplayPayload = (taskKey, value) => {
  const schema = GAMEPLAY_SCHEMAS[taskKey];
  if (!schema) {
    return {
      valid: false,
      error: `Unknown gameplay task key: ${String(taskKey)}.`,
    };
  }

  const error = validateAgainstSchema(schema, value, "$");
  if (error) {
    return { valid: false, error };
  }

  if (taskKey === "jumpForward" || taskKey === "autoJumpForward") {
    if (!value.stopDate.trim()) {
      return { valid: false, error: "$.stopDate must not be empty." };
    }
    for (let index = 0; index < value.events.length; index += 1) {
      const event = value.events[index];
      for (const field of ["date", "title", "description"]) {
        if (!event[field].trim()) {
          return { valid: false, error: `$.events[${index}].${field} must not be empty.` };
        }
      }
    }
    const hasEvents = value.events.length > 0;
    const hasSummary = value.summary.trim().length > 0;
    if (!hasEvents && !hasSummary && !hasMeaningfulCatalyst(value.catalyst)) {
      return {
        valid: false,
        error: "Jump payload must contain at least one event, a nonempty summary, or a meaningful catalyst.",
      };
    }
    if (value.catalyst) {
      const catalystError = validateDistinctChoices(value.catalyst.choices, "$.catalyst.choices");
      if (catalystError) return { valid: false, error: catalystError };
    }
  }

  if (taskKey === "pregameHistory") {
    for (let index = 0; index < value.events.length; index += 1) {
      const event = value.events[index];
      for (const field of ["date", "title", "description"]) {
        if (!event[field].trim()) {
          return { valid: false, error: `$.events[${index}].${field} must not be empty.` };
        }
      }
    }
    if (!value.summary.trim()) {
      return { valid: false, error: "$.summary must not be empty." };
    }
  }


  if (taskKey === "geographyResolver") {
    const seenIndexes = new Set();
    for (let index = 0; index < value.resolutions.length; index += 1) {
      const resolution = value.resolutions[index];
      if (seenIndexes.has(resolution.index)) {
        return { valid: false, error: `$.resolutions contains duplicate index ${resolution.index}.` };
      }
      seenIndexes.add(resolution.index);

      if (resolution.status === "RESOLVED" && resolution.regionIds.length === 0) {
        return {
          valid: false,
          error: `$.resolutions[${index}].regionIds must contain at least one id when status is RESOLVED.`,
        };
      }

      if (resolution.status === "UNRESOLVED" && resolution.regionIds.length !== 0) {
        return {
          valid: false,
          error: `$.resolutions[${index}].regionIds must be empty when status is UNRESOLVED.`,
        };
      }

      if (
        ["REGION_ALIAS", "CITY_CONTAINING_REGION"].includes(resolution.relation) &&
        resolution.regionIds.length > 1
      ) {
        return {
          valid: false,
          error: `$.resolutions[${index}] relation ${resolution.relation} may select only one region id.`,
        };
      }
    }
  }

  const requiredTextByTask = {
    descriptionToAction: ["title", "text", "kind"],
    eventConsolidator: ["summary"],
    catalystCreation: ["title", "premise", "opening"],
    catalystExecutor: ["summary"],
    catalystSummary: ["title", "description", "importance"],
    gameMaster: ["summary"],
  };
  for (const field of requiredTextByTask[taskKey] ?? []) {
    if (!value[field].trim()) {
      return { valid: false, error: `$.${field} must not be empty.` };
    }
  }

  if (taskKey === "catalystCreation") {
    const choiceError = validateDistinctChoices(value.choices, "$.choices");
    if (choiceError) return { valid: false, error: choiceError };
  }

  if (taskKey === "catalystExecutor") {
    if (value.resolved && value.nextChoices.length !== 0) {
      return { valid: false, error: "$.nextChoices must be empty when $.resolved is true." };
    }
    if (!value.resolved && value.nextChoices.length < 2) {
      return { valid: false, error: "$.nextChoices must contain between 2 and 5 choices while unresolved." };
    }
    const choiceError = validateDistinctChoices(value.nextChoices, "$.nextChoices");
    if (choiceError) return { valid: false, error: choiceError };
  }

  if (taskKey === "countryStatSheet") {
    const blankError = findBlankString(value);
    if (blankError) return { valid: false, error: blankError };
    const breakdown = value.gdpBreakdown;
    if (breakdown.agriculture + breakdown.industry + breakdown.services !== 100) {
      return { valid: false, error: "$.gdpBreakdown percentages must sum to 100." };
    }
    const names = new Set();
    for (let index = 0; index < value.territorialComponents.length; index += 1) {
      const key = value.territorialComponents[index].geography.trim().toLowerCase();
      if (names.has(key)) {
        return { valid: false, error: `$.territorialComponents[${index}].geography duplicates another component.` };
      }
      names.add(key);
    }
  }

  if (taskKey === "actions") {
    for (let topicIndex = 0; topicIndex < value.topics.length; topicIndex += 1) {
      const topic = value.topics[topicIndex];
      if (!topic.title.trim()) return { valid: false, error: `$.topics[${topicIndex}].title must not be empty.` };
      for (let actionIndex = 0; actionIndex < topic.actions.length; actionIndex += 1) {
        const action = topic.actions[actionIndex];
        if (!action.title.trim() || !action.text.trim()) {
          return { valid: false, error: `$.topics[${topicIndex}].actions[${actionIndex}] must have nonempty title and text.` };
        }
      }
    }
  }

  return { valid: true, error: "" };
};
