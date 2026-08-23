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

const markerSchema = {
  type: "object",
  description:
    "A named structure on the map. kind is free-form lowercase - city, military base, "
    + "bunker, missile silo, embassy, port, airfield, factory, monument, or anything else.",
  properties: {
    id: textSchema("Stable marker identifier."),
    name: nonEmptyTextSchema("Display name of the structure."),
    kind: nonEmptyTextSchema("What the structure is, as a short lowercase noun phrase."),
    ownerCode: textSchema("Owning polity's FULL country name (\"Spain\") when owned, never a country code."),
    lng: {
      type: "number",
      description: "Longitude of the structure.",
      minimum: -180,
      maximum: 180,
    },
    lat: {
      type: "number",
      description: "Latitude of the structure.",
      minimum: -90,
      maximum: 90,
    },
    note: textSchema("Brief description shown when the structure is inspected."),
    foundedAt: textSchema("In-game date the structure was built or founded."),
  },
  required: ["name", "kind", "lng", "lat"],
  additionalProperties: false,
};

const markerOpSchema = {
  description: "A structure/place mutation. Use op build, remove, or rename and fill the fields that op needs.",
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
    // The same build, written flat. Models routinely put the structure's fields
    // beside `op` instead of nesting them under `marker`, and the engine has always
    // read that shape (normalizeMarkerOp falls back to the entry itself). Only this
    // schema refused it — and because a rejected op fails the WHOLE payload, one
    // flattened building threw away the entire turn and left the player with
    // fallback events. Accept what we already understand.
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["build"] },
        id: textSchema("Stable marker identifier."),
        name: nonEmptyTextSchema("Name of the structure or place."),
        kind: textSchema("What it is: city, base, bunker, silo, embassy, port."),
        ownerCode: textSchema("Owning polity's FULL country name (\"Spain\"), never a country code."),
        lng: { type: "number", description: "Longitude.", minimum: -180, maximum: 180 },
        lat: { type: "number", description: "Latitude.", minimum: -90, maximum: 90 },
        note: textSchema("Brief explanation."),
      },
      required: ["op", "name", "lng", "lat"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["remove"] },
        markerId: textSchema("Existing marker identifier, when known."),
        name: nonEmptyTextSchema("Name of the structure to remove."),
        note: textSchema("Brief explanation of the removal."),
      },
      required: ["op", "name"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["rename"] },
        markerId: textSchema("Existing marker identifier, when known."),
        name: nonEmptyTextSchema("Current name of the structure or city to rename."),
        newName: nonEmptyTextSchema("New display name."),
        note: textSchema("Brief explanation of the rename."),
      },
      required: ["op", "name", "newName"],
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
        "Structures built or destroyed on the map. Use whenever the event founds, "
        + "constructs, or destroys a named place - a city, military base, bunker, "
        + "missile silo, embassy, port - so the map shows it.",
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
  required: ["events", "stopDate", "summary", "clearActions", "storylineUpdates", "warUpdates", "relationUpdates", "agreementUpdates"],
  additionalProperties: false,
};

export const AUTO_JUMP_FORWARD_SCHEMA = JUMP_FORWARD_SCHEMA;

// Backstory events deliberately have NO impacts field: the scenario's world
// state already reflects everything that happened before round one, so a
// pre-game event is a record, never a change to apply.
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
  },
  required: ["date", "title", "description"],
  additionalProperties: false,
};

export const PREGAME_HISTORY_SCHEMA = {
  type: "object",
  description: "The pre-game backstory: the events that led up to the start of the campaign.",
  properties: {
    events: {
      type: "array",
      description: "Chronological events from before round one, oldest first.",
      minItems: 1,
      maxItems: 12,
      items: pregameEventSchema,
    },
    summary: textSchema("One-paragraph summary of the era leading into the start date."),
  },
  required: ["events", "summary"],
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

export const GAME_MASTER_SCHEMA = {
  type: "object",
  description: "A direct game-master intervention and its structured world-state changes.",
  properties: {
    summary: textSchema("Concise account of how the GM request changed the world."),
    impacts: impactsSchema,
    warUpdates: {
      type: "string",
      description:
        "Compact canonical war-state operations caused by this GM intervention. Empty string when belligerency is unchanged.",
    },
    relationUpdates: {
      type: "string",
      description:
        "Compact bilateral relation updates caused by this GM intervention. Empty string when no relation changes.",
    },
    agreementUpdates: {
      type: "string",
      description:
        "Compact formal agreement lifecycle updates caused by this GM intervention. Empty string when no agreement changes.",
    },
  },
  required: ["summary", "impacts", "warUpdates", "relationUpdates", "agreementUpdates"],
  additionalProperties: false,
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
    "Compact generation transport for a persistent national statistics sheet. Native code decodes territorialComponentsText and deterministically derives population/GDP aggregates before canonical validation.",
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
    territorialComponentsText: {
      type: "string",
      minLength: 1,
      description:
        "Compact territorial component ledger. One row per line, exactly group~geography~population~gdpPerCapita. group is core, integrated, or overseas/dependent. population is an integer; gdpPerCapita is a positive number in 2026-EUR-equivalent accounting terms. Do not use ~ inside geography names.",
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
    "territorialComponentsText",
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
      maxItems: 64,
      description:
        "One demographic/economic component for every material legal territorial geography in the supplied territorial basis. Estimate EACH component independently. Never copy metropolitan productivity to colonies/dependencies/peripheral territories.",
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
  "Submit the summary and structured map or world-state effects of a game-master request.",
  GAME_MASTER_SCHEMA,
);

export const COUNTRY_STAT_SHEET_TOOL = makeTool(
  "submit_country_stat_sheet",
  "Submit the compact national statistics generation payload. Native code decodes the territorial ledger and derives aggregate population/GDP fields before persistence.",
  COUNTRY_STAT_GENERATION_SCHEMA,
);

export const IDLE_DIPLOMACY_TOOL = makeTool(
  "submit_idle_diplomacy",
  "Submit at most one short unprompted diplomatic note to the player, or null for silence.",
  IDLE_DIPLOMACY_SCHEMA,
);

export const PREGAME_HISTORY_TOOL = makeTool(
  "submit_pregame_history",
  "Submit the pre-game backstory events that led up to the campaign's start date.",
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
