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
  description: "A transfer of one map region to a new polity owner.",
  properties: {
    regionId: textSchema(
      "Exact map region identifier when known; otherwise the region's plain name "
      + "(the engine resolves names to ids).",
    ),
    regionName: textSchema("Human-readable region name, when known."),
    fromCode: textSchema("Previous owner's FULL country name (\"Spain\"), never a country code."),
    toCode: textSchema("New owner's FULL country name (\"Spain\"), never a country code such as \"ESP\"."),
    note: textSchema("Brief reason for the transfer."),
    wholeCountry: {
      type: "boolean",
      description:
        "Set true ONLY for a total conquest, annexation, unification or partition in "
        + "which one polity takes EVERY region another still holds. Then put the losing "
        + "polity's name in regionId instead of a region name, and this single entry "
        + "transfers all of its territory. Leave unset (the normal case) to transfer "
        + "one named region.",
    },
  },
  required: ["regionId", "toCode"],
  additionalProperties: false,
};

const regionClaimSchema = {
  type: "object",
  description:
    "One polity asserting a claim over a region it does not hold and has not been "
    + "given. The region renders as DISPUTED on the map - striped in every "
    + "claimant's colour - without its ownership changing, and stays that way until "
    + "the claim is settled by a regionTransfers entry (someone won or conceded it) "
    + "or dropped.",
  properties: {
    regionId: textSchema(
      "Exact map region identifier when known; otherwise the region's plain name "
      + "(the engine resolves names to ids).",
    ),
    regionName: textSchema("Human-readable region name, when known."),
    claimantCode: textSchema("Claiming polity's FULL country name (\"Spain\"), never a country code."),
    drop: {
      type: "boolean",
      description:
        "True to WITHDRAW this polity's claim - it was renounced, traded away, or "
        + "the claimant was defeated and has given it up. Clears their stripe. Leave "
        + "unset to assert a claim.",
    },
    note: textSchema("Brief reason for the claim or its withdrawal."),
  },
  required: ["regionId", "claimantCode"],
  additionalProperties: false,
};

// AI-authored updates to a country's PERSISTENT stat sheet (world.countryStats[code]).
// Only fields that CHANGED this period are sent; everything else persists. Absolute
// values, not deltas. Kept self-contained (no percentageSchema dep, which is defined
// later). LIVE via the tool schema, so it reaches existing frozen-prompt games.
const statPct = (description) => ({ type: "integer", minimum: 0, maximum: 100, description });
const statsUpdateSchema = {
  type: "object",
  description:
    "Updated national statistics for this polity. Include ONLY the fields that changed this period "
    + "(a coup changes leader/government/stability; a war changes reputation/economy) — every field you "
    + "omit keeps its previous value. Values are absolute, not deltas.",
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
        gdp: textSchema("GDP estimate."),
        gdpGrowth: textSchema("Annual GDP growth estimate."),
        gdpPerCapita: textSchema("GDP per capita estimate."),
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
  description: "A creation, rename, recolor, or metadata change for a polity.",
  properties: {
    code: textSchema("Polity's exact FULL country name (\"Spain\"), never a country code."),
    name: textSchema("New polity name, only when it changes."),
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
  required: ["code"],
  additionalProperties: false,
};

// `composition` and `posture` below belong to the beta unit system, and are
// DELIBERATELY left in the schema when the classic system is running.
//
// Stripping them looks tidier and is a trap. Every op object here is
// additionalProperties: false, so a provider that does not enforce the tool
// schema server-side (not all of the supported ones do) would have a stray
// `posture` rejected by validateGameplayPayload — and that fails the WHOLE turn's
// structured output into a fallback simulation, which is exactly the failure the
// note field on the spawn op was added to prevent (see its comment below).
// Trading a guaranteed-safe default mode for a few dozen tokens of schema is a
// bad deal.
//
// Nothing acts on them in classic: applyUnitOpBatch's betaEngine gate ignores
// posture, and promptContext stops describing either field, so the model is not
// invited to use them. If one arrives anyway it is stored verbatim and simply
// waits — which is what makes switching to beta later lossless.
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
      description:
        "How much of its ESTABLISHED strength this formation actually has, as a "
        + "percentage. 100 is a fresh full-strength formation; 60 is worn down; 20 is "
        + "a shell. This is not a power score - put the formation's real size in "
        + "`composition`.",
      minimum: 1,
      maximum: 100,
    },
    composition: nonEmptyTextSchema(
      "What the formation is actually made of, in a few words - \"1 aircraft carrier, "
      + "2 frigates\", \"3 tank regiments\", \"two rifle divisions\". A counter with no "
      + "composition tells the player nothing.",
    ),
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
    posture: {
      type: "string",
      description:
        "What this formation is DOING, which is how the player reads intent off the "
        + "map. \"patrol\" is special: the engine keeps a patrolling unit working its "
        + "station on its own, turn after turn, so state it once and leave it.",
      enum: ["holding", "massing", "patrol", "transit", "exercise", "blockade", "withdrawing"],
    },
    note: textSchema(
      "One short present-tense sentence on what this formation is doing and where - "
      + "\"Patrolling the North Atlantic approaches\". Shown to the player verbatim.",
    ),
  },
  required: ["name", "type", "ownerCode", "strength", "composition", "lng", "lat"],
  additionalProperties: false,
};

const unitOpSchema = {
  description: "A unit mutation. Use op spawn, move, strength, or remove and fill the fields that op needs.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["spawn"] },
        unit: unitSchema,
        // unitSchema already carries its own `note`; this is here only because a
        // model that has just written move/strength/remove — which DO take a
        // top-level note — reaches for the same field out of habit on a spawn.
        // Previously rejected outright (additionalProperties: false with no
        // "note" here), which failed the WHOLE turn's structured output and
        // forced a fallback simulation over one stray field on one op.
        note: textSchema("Optional operational note (prefer unit.note instead)."),
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
        posture: {
          type: "string",
          description:
            "Re-state what the formation is doing if the move changes it - a force "
            + "that was in transit and is now massing on a border, say.",
          enum: ["holding", "massing", "patrol", "transit", "exercise", "blockade", "withdrawing"],
        },
        note: textSchema("Brief explanation of the operation."),
      },
      required: ["op", "unitId", "toLng", "toLat"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["strength"] },
        unitId: nonEmptyTextSchema("Existing unit identifier."),
        strength: {
          type: "integer",
          description: "The formation's remaining percentage of established strength. 0 destroys it.",
          minimum: 0,
          maximum: 100,
        },
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
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["population"] },
        markerId: textSchema("Existing marker identifier, when known."),
        name: nonEmptyTextSchema("Name of the city whose population changed."),
        population: {
          type: "integer",
          description: "The city's new total population, as a whole number of people.",
          minimum: 0,
        },
        note: textSchema("Why it changed: siege, famine, industrial boom, refugees."),
      },
      required: ["op", "name", "population"],
      additionalProperties: false,
    },
  ],
};

const projectMilestoneSchema = {
  type: "object",
  description: "One dated checkpoint on the way to a project's completion.",
  properties: {
    id: textSchema("Stable milestone identifier, when updating an existing one."),
    title: nonEmptyTextSchema("Short description of the checkpoint, e.g. \"Sea trials begin\"."),
    date: textSchema("In-game date the checkpoint is expected or was reached (YYYY-MM-DD)."),
    status: {
      type: "string",
      description:
        "pending until reached; done once achieved; missed if its date passed unmet. "
        + "For a recurring checkpoint, send done each time it is performed - the engine "
        + "rolls it to the next occurrence and sets it pending again by itself.",
      enum: ["pending", "done", "missed"],
    },
    repeat: {
      type: "string",
      description:
        "Set for a standing commitment that comes round again - an annual drill, a "
        + "quarterly review, a monthly rotation. Marking it done does NOT retire it: the "
        + "engine advances the date by one interval (keeping the same day of the year) and "
        + "sets it pending, so the board always shows the next one. Give a recurring "
        + "checkpoint a date, so it keeps the slot it is meant to fall on; without one the "
        + "engine can only count forward from whenever it was last performed. Leave empty "
        + "for a one-off checkpoint that happens once and is finished.",
      enum: ["weekly", "monthly", "quarterly", "annual", "biennial"],
    },
    note: textSchema("Brief detail about the checkpoint."),
  },
  required: ["title"],
  additionalProperties: false,
};

const projectSchema = {
  type: "object",
  description:
    "A long-running effort that spans multiple rounds: a research or industrial "
    + "programme, a construction project, a military operation, a covert operation, "
    + "or a sustained political or diplomatic campaign. Distinct from a queued "
    + "action, which is one thing done this round and resolved by the next jump.",
  properties: {
    id: textSchema("Stable project identifier. Copy it EXACTLY from the running-projects list when updating one; omit it when starting something new."),
    name: nonEmptyTextSchema("The name the project is known by, e.g. \"Project Leviathan\" or \"Operation Kingfisher\"."),
    kind: {
      type: "string",
      description: "operation for a military, intelligence or covert undertaking; project for a programme, build or civil effort.",
      enum: ["project", "operation"],
    },
    ownerCode: textSchema(
      "Running polity's FULL country name (\"Spain\"), never a country code. Leave empty "
      + "for the player's own - and this field decides who controls the entry, so getting "
      + "it wrong matters: an entry with an owner other than the player's is THEIRS, the "
      + "player can only watch it, and neither they nor you may set its priority or call it "
      + "off. Set it for a foreign power's programme the player's services have learned of; "
      + "leave it empty for anything the player is actually running, including an operation "
      + "of theirs aimed AT a foreign programme.",
    ),
    summary: nonEmptyTextSchema("One or two sentences on what this is and what it is meant to achieve."),
    status: {
      type: "string",
      description:
        "proposed (agreed but not begun), active (under way), stalled (blocked or "
        + "starved of resources), paused (deliberately suspended), complete, failed, "
        + "or cancelled.",
      enum: ["proposed", "active", "stalled", "paused", "complete", "failed", "cancelled"],
    },
    priority: {
      type: "string",
      description:
        "How much attention the PLAYER wants this to get. They set it themselves "
        + "on the board - leave it out entirely unless they have told you in this "
        + "conversation to raise or drop something's priority. It is never your own "
        + "judgement of how important a programme is, and overwriting it discards an "
        + "instruction they gave. It exists only on the player's OWN work: a foreign "
        + "power's programme has no priority, they cannot give it one, and asking for "
        + "one on their behalf is refused.",
      enum: ["high", "normal", "low"],
    },
    progress: {
      type: "integer",
      description: "How far along it is, 0-100. Move this whenever the narrative advances or sets it back.",
      minimum: 0,
      maximum: 100,
    },
    tags: stringArraySchema(
      "Short lowercase categories the player can filter by - military, political, "
      + "naval, economic, research, intelligence, infrastructure, nuclear, space. "
      + "Invent what fits this campaign; reuse the same spelling across projects.",
    ),
    secrecy: {
      type: "string",
      description: "public if openly known, restricted if known only inside government, covert if deniable and secret.",
      enum: ["public", "restricted", "covert"],
    },
    startedAt: textSchema("In-game date work began (YYYY-MM-DD)."),
    ongoing: {
      type: "boolean",
      description:
        "True for a standing effort with no planned end - a permanent patrol, a "
        + "continuous intelligence or security programme, an alliance kept in good "
        + "repair. Leave targetDate empty when this is true, and never invent an end "
        + "date for something that is simply meant to continue.",
    },
    targetDate: textSchema("In-game date it is expected to complete (YYYY-MM-DD). Omit entirely for an ongoing effort. This is what the board measures overdue against."),
    milestones: {
      type: "array",
      description: "Checkpoints along the way, earliest first. The soonest pending one is shown as the project's next milestone.",
      items: projectMilestoneSchema,
    },
    lastUpdate: textSchema("One present-tense sentence on what most recently changed. Shown to the player verbatim."),
    linkedUnitIds: stringArraySchema("Ids of units carrying this out, copied exactly from the unit list."),
    linkedMarkerIds: stringArraySchema("Ids of structures this is built around, copied exactly from the structure list."),
    focus: {
      type: "object",
      description: "Where on the map this is happening, so the player can jump the camera to it.",
      properties: {
        lng: { type: "number", description: "Longitude.", minimum: -180, maximum: 180 },
        lat: { type: "number", description: "Latitude.", minimum: -90, maximum: 90 },
      },
      required: ["lng", "lat"],
      additionalProperties: false,
    },
    note: textSchema("Anything else worth keeping: estimated cost, blockers, who is running it."),
    onComplete: {
      type: "object",
      description:
        "What finishing this project DOES to the world, applied automatically the "
        + "moment it is completed and never applied twice - and never at all if it "
        + "is cancelled or fails. Use it whenever the project's whole point is a "
        + "concrete change: a campaign to annex a province (regionTransfers), a "
        + "unification or regime change that renames or recolours a polity "
        + "(polityChanges), a claim the effort would drop if it collapsed "
        + "(regionClaims with drop true). Without this a finished project is only a "
        + "progress bar that reached 100 while the map stayed exactly as it was. "
        + "MOST PROJECTS HAVE NO onComplete: a research programme, a construction "
        + "project or a campaign of influence finishes narratively and takes none. "
        + "Attach one only when completion causes a specific, nameable change of "
        + "territory or of a polity's identity.",
      // Described by reference rather than re-embedded. These three schemas are
      // already spelled out in full under impacts in the very same payload, and
      // repeating them here cost ~6.3 KB of every jump prompt to say the same
      // thing a second time. normalizeProjectOnComplete (runtime/gameState.js)
      // normalizes whatever arrives, so the loose shape costs nothing at the
      // ingest end either.
      properties: {
        polityChanges: {
          type: "array",
          description: "Polity identity changes enacted on completion. Same entry shape as impacts.polityChanges.",
          items: { type: "object" },
        },
        regionTransfers: {
          type: "array",
          description: "Map ownership changes enacted on completion. Same entry shape as impacts.regionTransfers.",
          items: { type: "object" },
        },
        regionClaims: {
          type: "array",
          description: "Claims asserted or dropped on completion. Same entry shape as impacts.regionClaims.",
          items: { type: "object" },
        },
      },
      additionalProperties: false,
    },
  },
  required: ["name", "summary"],
  additionalProperties: false,
};

// ONE flat op, discriminated by `op`, rather than six overlapping anyOf variants.
//
// Why: the six-variant version was 41.5 KB serialized — 66% of the ENTIRE jump
// tool schema, three times what every other impact branch cost put together —
// because three of its variants (nested create, flat create, update) each
// restated projectSchema's twenty properties in full. It was ~10k tokens sent on
// every jump, and on a segmented jump, once per segment.
//
// Collapsing it is not only cheaper, it is more reliable. A six-branch anyOf is
// one of the worst constructs for Gemini's OpenAPI subset (see geminiSchema.js)
// and for small local models, which routinely pick the wrong branch or emit a
// blend of two. One object with an op enum is what they handle well.
//
// Nothing is lost at the ingest end: normalizeProjectOp (runtime/gameState.js)
// already resolves every op name and alias, already reads a create written flat
// OR nested (`operation.project ?? operation`), and already merges a create that
// names an existing project into an update of only the fields it carried. The
// old schema was describing tolerance the reducer had all along.
const projectOpSchema = {
  type: "object",
  description:
    "A change to the player's Projects & Operations board. Set op, name the project, "
    + "and send ONLY the fields that op needs — everything omitted keeps its current value. "
    + "op create opens a new effort (give it a summary too); update moves an existing one; "
    + "milestone records a checkpoint; complete, cancel or fail close it while keeping it on "
    + "the board; remove erases an entry that should never have been opened, which is NOT how "
    + "a project ends.",
  properties: {
    op: {
      type: "string",
      description: "Which change this is.",
      enum: ["create", "update", "milestone", "complete", "cancel", "fail", "remove"],
    },
    projectId: textSchema("Existing project id, copied EXACTLY from the running-projects list. Omit when opening something new."),
    name: nonEmptyTextSchema(
      "The project's name — the new name when opening one, otherwise its CURRENT name copied "
      + "exactly from the running-projects list, which is how it is found when no id is given.",
    ),
    newName: textSchema("A new name, only when the project is being renamed."),
    milestone: projectMilestoneSchema,
    // Every descriptive field a project has, all optional. `name` is redefined
    // above (a create names a new project, an update identifies an existing
    // one), and `id` is spelled projectId here.
    kind: projectSchema.properties.kind,
    ownerCode: projectSchema.properties.ownerCode,
    summary: textSchema("What this is and what it is meant to achieve. Required when opening one; on an update send it only if it changed."),
    status: projectSchema.properties.status,
    priority: projectSchema.properties.priority,
    progress: projectSchema.properties.progress,
    tags: projectSchema.properties.tags,
    secrecy: projectSchema.properties.secrecy,
    startedAt: projectSchema.properties.startedAt,
    ongoing: projectSchema.properties.ongoing,
    targetDate: projectSchema.properties.targetDate,
    milestones: projectSchema.properties.milestones,
    lastUpdate: projectSchema.properties.lastUpdate,
    linkedUnitIds: projectSchema.properties.linkedUnitIds,
    linkedMarkerIds: projectSchema.properties.linkedMarkerIds,
    focus: projectSchema.properties.focus,
    note: textSchema("Anything else worth keeping, or — when closing one — a sentence on how it ended."),
    onComplete: projectSchema.properties.onComplete,
    // The nested spelling of a create, kept permissive rather than re-embedding
    // projectSchema for the third time. The model is no longer TOLD to nest, so
    // this is pure tolerance for one that does anyway: additionalProperties is
    // false, so without this key a nested create would fail schema validation and
    // cost the whole turn, which is exactly the failure the flat variant was
    // added to prevent. normalizeProjectOp reads it either way.
    project: {
      type: "object",
      description: "Legacy nested form of a create. Prefer the flat fields above.",
    },
  },
  required: ["op", "name"],
  additionalProperties: false,
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
        "Map ownership changes. REQUIRED whenever the event text says territory was "
        + "captured, occupied, annexed, ceded, liberated, or otherwise changed hands - "
        + "one entry per affected region, or the map will not match the story.",
      items: regionTransferSchema,
    },
    unitOps: {
      type: "array",
      description: "Military unit operations.",
      items: unitOpSchema,
    },
    markerOps: {
      type: "array",
      description:
        "Structures built, destroyed, renamed or resized on the map. Use whenever "
        + "the event founds, constructs, or destroys a named place - a city, military "
        + "base, bunker, missile silo, embassy, port - so the map shows it, and "
        + "whenever a city's POPULATION changes.",
      items: markerOpSchema,
    },
    regionClaims: {
      type: "array",
      description:
        "Territory CLAIMED but not held. Use whenever a polity asserts a right to "
        + "land it does not control and has not been given it - an irredentist "
        + "declaration, a proclaimed union, a contested border, a government-in-"
        + "exile's title. Marks the region disputed on the map WITHOUT moving the "
        + "border; use regionTransfers for land that actually changed hands.",
      items: regionClaimSchema,
    },
    projectOps: {
      type: "array",
      description:
        "Changes to the Projects & Operations board. Use whenever the event starts, "
        + "advances, sets back, completes or ends a multi-round effort - a research "
        + "or industrial programme, a construction project, a military or covert "
        + "operation, a sustained political campaign - so the board matches the "
        + "story. Prefer updating a running project over starting a duplicate.",
      items: projectOpSchema,
    },
  },
  additionalProperties: false,
};

// The same impacts, minus the board. A jump no longer moves projects inline: it
// writes the story, and the separate `projects` task reads that story and moves
// the board to match (PROJECTS_SCHEMA), attaching its ops back onto these very
// events before anything is written.
//
// So this only narrows what the MODEL is asked to produce in a jump. The data
// path is unchanged — applyEventImpactsToWorld still reads impacts.projectOps,
// which is exactly how the attached ops get applied. The game master keeps the
// full impacts object, since a direct "make this happen" command is one call
// with no separate pass to hand the work to.
const jumpImpactsSchema = {
  ...impactsSchema,
  properties: Object.fromEntries(
    Object.entries(impactsSchema.properties).filter(([key]) => key !== "projectOps"),
  ),
};

const eventSchema = {
  type: "object",
  description: "One dated campaign event produced by a timeline simulation.",
  properties: {
    id: textSchema("Optional stable event identifier."),
    date: textSchema("In-game date on which the event occurs."),
    title: textSchema("Concise event headline."),
    description: textSchema("Specific narrative description and consequences."),
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
    impacts: jumpImpactsSchema,
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
      description: "Whether planned player actions were resolved by this jump. Defaults to true (resolved) when omitted.",
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
  },
  // clearActions is deliberately NOT required: simulateTimelineJump already
  // reads it as `payload?.clearActions !== false`, so a missing value already
  // means "resolved" everywhere it's consumed. Some models (field report: an
  // openai-compatible endpoint) reliably omit it even after being told
  // exactly which field is missing on the one retry this task gets — with it
  // required, that omission failed validation and threw away an otherwise
  // complete, correct turn (real events, a real summary) to the fallback for
  // a boolean nothing downstream needed present in the first place.
  required: ["events", "stopDate", "summary"],
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
// The between-rounds world pulse. Still named idleDiplomacy because the task KEY
// is stored in every game's frozen prompt pack and every scenario's prompts.json —
// renaming it would orphan the player's own edits under a key nothing reads.
export const IDLE_DIPLOMACY_SCHEMA = {
  type: "object",
  description:
    "A quiet moment between rounds: at most one short unprompted diplomatic note, "
    + "and at most two small unit movements that follow from the world as it already "
    + "stands. All of it is optional, and silence is a normal answer.",
  properties: {
    chat: {
      anyOf: [
        { type: "null", description: "No polity would plausibly reach out right now." },
        createdChatSchema,
      ],
    },
    unitOps: {
      type: "array",
      description:
        "At most two unit operations. Prefer moving or re-posturing an EXISTING unit "
        + "over spawning a new one. An empty array is the normal answer.",
      maxItems: 2,
      items: unitOpSchema,
    },
    sighting: {
      anyOf: [
        { type: "null", description: "Nothing worth reporting to the player." },
        {
          type: "object",
          description:
            "One short intelligence report, ONLY when the movement is inside or near "
            + "the player's sphere and their services would plausibly have seen it.",
          properties: {
            title: nonEmptyTextSchema("Short headline, e.g. \"Naval build-up off Murmansk\"."),
            description: nonEmptyTextSchema("One or two sentences in the voice of an intelligence report."),
          },
          required: ["title", "description"],
          additionalProperties: false,
        },
      ],
    },
  },
  // Only chat is required, so an answer in the old shape still validates.
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
  description: "The exact participant who should speak next in the diplomatic chat.",
  properties: {
    nextSpeaker: textSchema("Exact name of one chat participant other than the most recent speaker."),
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
  },
  required: ["summary", "impacts"],
  additionalProperties: false,
};

// The Projects & Operations board, moved OUT of the jump and into its own call.
//
// Why: projectOps was the single largest thing in the jump contract by a wide
// margin, and the board dominated what the model spent its attention on. A field
// run caught a model narrating its plan for three minutes — enumerating stalled
// programmes one by one — and never reaching the events it was actually asked
// for. The board is bookkeeping: it follows from the events rather than
// competing with them for the same budget.
//
// So the jump writes the story, and this call reads that story and moves the
// board to match. It sees the finished events and the board, and nothing else —
// no world summary, no city coordinates, no unit list, no chat history.
export const PROJECTS_SCHEMA = {
  type: "object",
  description:
    "Changes to the Projects & Operations board that follow from the events just simulated.",
  properties: {
    projectOps: {
      type: "array",
      description:
        "One entry per change. Return an empty array when nothing on the board moved this "
        + "period — that is a normal and correct answer, and inventing progress is worse "
        + "than reporting none.",
      items: {
        ...projectOpSchema,
        properties: {
          ...projectOpSchema.properties,
          // Which event caused this. The ops are attached back onto that event
          // before the world is written, so the board change is recorded as part
          // of the event that caused it — which is what lets the staged reveal
          // show them together and what keeps a rollback consistent.
          eventIndex: {
            type: "integer",
            description:
              "Zero-based index of the event in the list above that causes this change. "
              + "Use the event that actually moved the effort; omit only when no single "
              + "event is responsible.",
            minimum: 0,
          },
        },
      },
    },
  },
  required: ["projectOps"],
  additionalProperties: false,
};

const percentageSchema = (description) => ({
  type: "integer",
  description,
  minimum: 0,
  maximum: 100,
});

export const COUNTRY_STAT_SHEET_SCHEMA = {
  type: "object",
  description: "A complete national statistics sheet for the selected polity.",
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
    economy: {
      type: "object",
      properties: {
        gdp: nonEmptyTextSchema("Era-appropriate gross domestic product estimate."),
        gdpGrowth: nonEmptyTextSchema("Annual GDP growth estimate."),
        gdpPerCapita: nonEmptyTextSchema("Era-appropriate GDP per capita estimate."),
        currency: nonEmptyTextSchema("Currency or dominant medium of exchange."),
        inflation: nonEmptyTextSchema("Inflation estimate."),
        unemployment: nonEmptyTextSchema("Unemployment estimate."),
        publicDebt: nonEmptyTextSchema("Public debt estimate."),
        budgetBalance: nonEmptyTextSchema("Budget surplus or deficit estimate."),
      },
      required: ["gdp", "gdpGrowth", "gdpPerCapita", "currency", "inflation", "unemployment", "publicDebt", "budgetBalance"],
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
  required: ["capital", "continent", "government", "leader", "stability", "indices", "economy", "gdpBreakdown"],
  additionalProperties: false,
};

export const GAMEPLAY_SCHEMAS = Object.freeze({
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
  projects: PROJECTS_SCHEMA,
});

const makeTool = (name, description, schema) => Object.freeze({ name, description, schema });

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
  "Submit the exact diplomatic chat participant who should speak next.",
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

export const PROJECTS_TOOL = makeTool(
  "submit_project_ops",
  "Submit the Projects & Operations board changes that follow from the events just simulated.",
  PROJECTS_SCHEMA,
);

export const GAME_MASTER_TOOL = makeTool(
  "submit_game_master",
  "Submit the summary and structured map or world-state effects of a game-master request.",
  GAME_MASTER_SCHEMA,
);

export const COUNTRY_STAT_SHEET_TOOL = makeTool(
  "submit_country_stat_sheet",
  "Submit the complete validated national statistics sheet.",
  COUNTRY_STAT_SHEET_SCHEMA,
);

export const IDLE_DIPLOMACY_TOOL = makeTool(
  "submit_idle_diplomacy",
  "Submit the quiet-moment world pulse: at most one short unprompted diplomatic note, "
  + "at most two small unit movements, and at most one intelligence sighting. Every part "
  + "is optional and silence is a normal answer.",
  IDLE_DIPLOMACY_SCHEMA,
);

export const PREGAME_HISTORY_TOOL = makeTool(
  "submit_pregame_history",
  "Submit the pre-game backstory events that led up to the campaign's start date.",
  PREGAME_HISTORY_SCHEMA,
);

export const GAMEPLAY_TOOLS = Object.freeze({
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
  projects: PROJECTS_TOOL,
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

  const requiredTextByTask = {
    descriptionToAction: ["title", "text", "kind"],
    nextSpeaker: ["nextSpeaker"],
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
