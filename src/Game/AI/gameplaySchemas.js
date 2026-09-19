import { EVENT_TAG_ENUM, MAX_EVENT_TAGS } from "../../runtime/eventTags.js";
import {
  TERRITORY_BASIS_DESCRIPTION,
  TERRITORY_BASIS_DESCRIPTION_SHORT,
  TERRITORY_BASIS_ENUM,
} from "../../runtime/territoryBasis.js";
import { extractJsonArray } from "./jsonSalvage.js";
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

// A chat's participants are polity NAMES — what the actions reference has always
// shown ({"countries":["..."]}) and what resolveInvitees (gameplay.js) has always
// read. The schema used to demand {code, name} objects, so a model that followed
// the prose failed the schema; normalizeChatShape below still folds an object
// to its name for a campaign whose frozen prompt shows the old shape. The
// message list, source and status the schema once carried were never taught
// and are the engine's to fill (buildGeneratedChat); they rode on every jump.
const createdChatSchema = {
  type: "object",
  description: "A chat opened toward the player. The initiating polity speaks first, so title and openingMessage are required.",
  properties: {
    title: nonEmptyTextSchema("Short title naming the purpose (e.g. 'French mediation offer')."),
    countries: {
      type: "array",
      description: "The other side: one or more polities' FULL names, never the player's.",
      minItems: 1,
      items: nonEmptyTextSchema("A polity's FULL name (\"Spain\"), never a code."),
    },
    openingMessage: nonEmptyTextSchema("The initiator's first message, in its leader's voice. Never written as the player."),
    speaker: nonEmptyTextSchema("The polity sending the opening message. Never the player's."),
    linkedEventId: textSchema("The event that caused it, when one did."),
  },
  required: ["countries", "title", "speaker", "openingMessage"],
  additionalProperties: false,
};

// Field descriptions are kept to a line. The jump's schema rides on every
// request and a test holds it to a size (projectOpSchema.test.js); the long form
// of every lever is in the actions reference and the directives the jump is
// always given, so a description here only has to say what the field IS.
const regionIdSchema = textSchema("The region's id, or its plain name.");
const regionNameSchema = textSchema("Region name, when known.");

const regionTransferSchema = {
  type: "object",
  description: "Legal sovereignty of one region passes to a polity. Wartime occupation is regionControlOps.",
  properties: {
    regionId: regionIdSchema,
    regionName: regionNameSchema,
    fromCode: textSchema("Previous owner's FULL name (\"Spain\"), never a code."),
    toCode: textSchema("New owner's FULL name (\"Spain\"), never a code."),
    note: textSchema("Brief reason."),
    // Optional in the contract so an older payload still validates; the actions
    // reference asks for it on every entry. See runtime/territoryBasis.js.
    basis: { type: "string", enum: [...TERRITORY_BASIS_ENUM], description: TERRITORY_BASIS_DESCRIPTION },
    wholeCountry: {
      type: "boolean",
      description:
        "True ONLY when one polity takes EVERY region another still holds (total conquest, "
        + "annexation, unification, partition): fromCode is the losing polity's full name and "
        + "regionId repeats it; the engine expands this to every region it holds. Unset transfers one region.",
    },
  },
  required: ["regionId", "toCode"],
  additionalProperties: false,
};

const regionClaimSchema = {
  type: "object",
  description: "One polity's claim on a region it neither holds nor was given.",
  properties: {
    regionId: regionIdSchema,
    regionName: regionNameSchema,
    claimantCode: textSchema("Claiming polity's FULL name (\"Spain\"), never a code."),
    drop: {
      type: "boolean",
      description: "True to WITHDRAW the claim (renounced, traded away, given up in defeat). Unset asserts it.",
    },
    note: textSchema("Brief reason."),
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
  description: "Only the fields that changed this period; every omitted field keeps its value. Absolute values, not deltas.",
  properties: {
    capital: textSchema("Capital, only when it changes."),
    continent: textSchema("Continent / broad region, only when it changes."),
    government: textSchema("Government system and ideology, only when it changes."),
    leader: textSchema("Head of state or government, only when it changes."),
    stability: statPct("National stability 0-100."),
    indices: {
      type: "object",
      description: "Strategic indices for the standard Stats sheet. Custom full-sheet scenarios use customStats instead.",
      properties: {
        sovereignty: statPct("Practical political sovereignty."),
        foodAutonomy: statPct("Domestic food autonomy."),
        energyAutonomy: statPct("Domestic energy autonomy."),
        economicIndependence: statPct("Economic independence."),
        internalSecurity: statPct("Internal security."),
        internationalReputation: statPct("International reputation / standing."),
      },
      maxProperties: 12,
      additionalProperties: statPct("A scenario-defined strategic index, 0-100."),
    },
    customStats: {
      type: "object",
      description: "Scenario-defined full-sheet numeric Stats updates. The live tool declaration supplies the exact allowed keys and ranges.",
      maxProperties: 60,
      additionalProperties: { type: "number" },
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

const controlRegionIdSchema = nonEmptyTextSchema("The region's id or name, or the exact place the event names.");
const regionControlOpSchema = {
  description: "One de-facto control operation.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["contest"] },
        regionId: controlRegionIdSchema,
        regionName: regionNameSchema,
        fromCode: nonEmptyTextSchema("Defending controller's FULL name."),
        actorCode: nonEmptyTextSchema("Attacking polity's FULL name."),
        note: textSchema("Brief reason."),
      },
      required: ["op", "regionId", "fromCode", "actorCode"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["control"] },
        regionId: controlRegionIdSchema,
        regionName: regionNameSchema,
        fromCode: nonEmptyTextSchema("Previous controller's FULL name."),
        toCode: nonEmptyTextSchema("New controller's FULL name."),
        note: textSchema("Brief reason."),
        basis: { type: "string", enum: [...TERRITORY_BASIS_ENUM], description: TERRITORY_BASIS_DESCRIPTION_SHORT },
        wholeCountry: {
          type: "boolean",
          description: "True only when the new controller takes EVERY region the previous one still holds; regionId repeats that polity's name.",
        },
      },
      required: ["op", "regionId", "fromCode", "toCode"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["clear_contest"] },
        regionId: controlRegionIdSchema,
        regionName: regionNameSchema,
        fromCode: textSchema("Current controller's FULL name, preferred."),
        claimantCode: textSchema("The contender to remove. Omit only with clearAll."),
        clearAll: { type: "boolean", description: "Remove every contender — only for a final settlement; a ceasefire removes one claimantCode." },
        note: textSchema("Brief reason."),
      },
      required: ["op", "regionId"],
      additionalProperties: false,
    },
  ],
};

const polityChangeSchema = {
  type: "object",
  description: "One polity operation. update targets an EXISTING polity; only create and restore may introduce one.",
  properties: {
    operation: {
      type: "string",
      description:
        "update = metadata or stats of an existing polity; create = a genuinely new polity (a breakaway, an independence); "
        + "rename = a new full name, same polity; restore = a dormant or dissolved polity returns; "
        + "dissolve = a polity ends, once its territory is settled.",
      enum: ["update", "create", "rename", "restore", "dissolve"],
    },
    code: textSchema("The polity's exact FULL current name, never a code — the one changed, renamed or dissolved; for create/restore, the identity established."),
    name: textSchema("rename: the NEW full name (required). create/restore: may repeat code. update: only when the display name itself changes."),
    color: textSchema("New six-digit hex colour, only when it changes."),
    aliases: stringArraySchema("Alternative names."),
    // The prompt asks for this and gameState normalizes/clamps/writes it, but it
    // was missing here — and additionalProperties:false means a json_schema
    // provider could never emit it, so international reputation silently never
    // moved. Declaring it is what actually connects that feature.
    reputation: {
      type: "number",
      description: "International reputation 0-100, only when it changes: 0 a pariah, 100 universally trusted.",
    },
    intelligence: {
      type: "number",
      description:
        "Intelligence service capability 0-100, only when it changes (a purge, a defector, a new bureau, funding). "
        + "Decides how much of others' diplomacy it reads and how much of its own it keeps secret.",
    },
    tags: stringArraySchema(
      "Defining traits after this change — ideology, alignment, posture (socialist, authoritarian, anti-nato). "
      + "Only when they change, and then the COMPLETE list, not a delta.",
    ),
    note: textSchema("Brief reason."),
    stats: statsUpdateSchema,
  },
  required: ["operation", "code"],
  additionalProperties: false,
};

// `composition` and `posture` below are the unit system's own fields. Every op
// object here is additionalProperties: false, so a provider that does not
// enforce the tool schema server-side (not all of the supported ones do) would
// have a stray value rejected by validateGameplayPayload — and that fails the
// WHOLE turn's structured output into a fallback simulation, which is exactly
// the failure the note field on the spawn op was added to prevent (see its
// comment below).
// WHERE, in words (AI/placement.js): "Kharkiv", "near Kharkiv", "eastern Ukraine",
// "coast of Crimea", "off Sevastopol", "Donetsk Oblast facing Russia". The engine
// finds the point. Stated once here and explained once in the call-time
// directive ([Placing Things]) — the jump's schema has a size budget
// (projectOpSchema.test.js) and five copies of a grammar would spend it.
const atSchema = { type: "string", description: "Where, in words — see [Placing Things]. Preferred to lng/lat." };

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
      description: "Percentage of ESTABLISHED strength: 100 fresh, 60 worn down, 20 a shell. Not a power score — the real size goes in composition.",
      minimum: 1,
      maximum: 100,
    },
    composition: nonEmptyTextSchema("What it is made of, in a few words: \"1 carrier, 2 frigates\", \"3 tank regiments\"."),
    at: atSchema,
    lng: { type: "number", description: "Only with no `at`.", minimum: -180, maximum: 180 },
    lat: { type: "number", description: "Only with no `at`.", minimum: -90, maximum: 90 },
    regionId: textSchema("Region id, when known."),
    status: {
      type: "string",
      description: "Optional unit status.",
      enum: ["idle", "moving", "engaged", "pending"],
    },
    posture: {
      type: "string",
      description: "What it is DOING. patrol is special: the engine keeps a patrolling unit on station turn after turn, so say it once.",
      enum: ["holding", "massing", "patrol", "transit", "exercise", "blockade", "withdrawing", "assaulting"],
    },
    note: textSchema("One present-tense sentence on what it is doing and where; shown to the player."),
  },
  required: ["name", "type", "ownerCode", "strength", "composition"],
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
        at: atSchema,
        toLng: { type: "number", minimum: -180, maximum: 180 },
        toLat: { type: "number", minimum: -90, maximum: 90 },
        regionId: textSchema("Destination region id, when known."),
        posture: {
          type: "string",
          description: "Only when the move changes what it is doing.",
          enum: ["holding", "massing", "patrol", "transit", "exercise", "blockade", "withdrawing", "assaulting"],
        },
        note: textSchema("Brief explanation."),
      },
      required: ["op", "unitId"],
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

const markerStatusSchema = {
  type: "string",
  enum: ["planned", "under_construction", "active", "damaged", "inactive", "abandoned", "destroyed"],
  description: "Current lifecycle state of the persistent physical feature.",
};

const markerSchema = {
  type: "object",
  description: "A named structure. kind is free-form lowercase: city, military base, silo, embassy, port, airfield…",
  properties: {
    id: textSchema("Stable marker identifier."),
    name: nonEmptyTextSchema("Display name."),
    kind: nonEmptyTextSchema("What it is, as a short lowercase noun phrase."),
    ownerCode: textSchema("Owning polity's FULL name (\"Spain\") when owned, never a code."),
    status: markerStatusSchema,
    at: atSchema,
    lng: { type: "number", description: "Only with no `at`.", minimum: -180, maximum: 180 },
    lat: { type: "number", description: "Only with no `at`.", minimum: -90, maximum: 90 },
    note: textSchema("Brief description, shown when inspected."),
    foundedAt: textSchema("In-game date it was built or founded."),
  },
  required: ["name", "kind"],
  additionalProperties: false,
};

// The player's espionage orders, executed by the event that carries them: an
// agent deployed to a country or recalled from it. Only the player's own
// service — foreign agents are the engine's (spycraft.js resolveEspionage).
const spyOpSchema = {
  type: "object",
  properties: {
    op: { type: "string", enum: ["deploy", "recall"] },
    target: nonEmptyTextSchema("The target country's FULL name as this world names it, never a code."),
    coverStory: textSchema("One line on who the officer poses as. Optional; deploy only."),
    note: textSchema("Why, in a few words. Optional."),
  },
  required: ["op", "target"],
  additionalProperties: false,
};

// A document held by the governments it was addressed to (runtime/reports.js).
// It rides in the jump's own answer — a report costs no request of its own —
// and it never carries impacts: what moved the map is public.
const reportOpSchema = {
  description: "create a document, or share an existing one with more polities.",
  anyOf: [
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["create"] },
        reportId: textSchema("A short stable id you choose, to share it later."),
        title: nonEmptyTextSchema("The document's own heading."),
        body: nonEmptyTextSchema("The document itself, in its own voice — see [Reports]. Markdown."),
        visibleTo: stringArraySchema("The polities that hold it, by FULL name. Empty only for a document published to all."),
        from: textSchema("The polity whose document it is — who wrote or sent it — by FULL name."),
        dateline: textSchema("Its date (YYYY-MM-DD), when it carries one."),
      },
      required: ["op", "title", "body", "visibleTo"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["share"] },
        reportId: nonEmptyTextSchema("The existing report's id, or its exact title."),
        visibleTo: stringArraySchema("The polities that now hold it too, by FULL name."),
        from: textSchema("The holder who passed it on, when one did."),
      },
      required: ["op", "reportId", "visibleTo"],
      additionalProperties: false,
    },
  ],
};

const markerOpSchema = {
  description: "build a genuinely new structure; update or rename an existing one; remove only when it ceases to exist; population when a city's population changes.",
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
        ownerCode: textSchema("Owning polity's FULL name (\"Spain\"), never a code."),
        status: markerStatusSchema,
        at: atSchema,
        lng: { type: "number", description: "Only with no `at`.", minimum: -180, maximum: 180 },
        lat: { type: "number", description: "Only with no `at`.", minimum: -90, maximum: 90 },
        note: textSchema("Brief explanation."),
      },
      required: ["op", "name"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["update"] },
        markerId: textSchema("Existing marker id, preferred when the structures list shows one."),
        name: textSchema("Existing name, only when markerId is unavailable."),
        kind: textSchema("New kind, when it materially changed."),
        ownerCode: textSchema("New operating polity's FULL name, when control changes."),
        status: markerStatusSchema,
        at: { type: "string", description: "New place, only when it genuinely relocates." },
        lng: { type: "number", description: "New longitude, only with no `at`.", minimum: -180, maximum: 180 },
        lat: { type: "number", description: "New latitude, only with no `at`.", minimum: -90, maximum: 90 },
        note: textSchema("Updated brief description."),
      },
      required: ["op"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["remove"] },
        markerId: textSchema("Existing marker id, preferred when known."),
        name: textSchema("Existing name, when markerId is unavailable."),
        note: textSchema("Brief explanation."),
      },
      required: ["op"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["rename"] },
        markerId: textSchema("Existing marker id, when known."),
        name: nonEmptyTextSchema("Current name of the structure or city."),
        newName: nonEmptyTextSchema("New display name."),
        note: textSchema("Brief explanation."),
      },
      required: ["op", "name", "newName"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { type: "string", enum: ["population"] },
        markerId: textSchema("Existing marker id, when known."),
        name: nonEmptyTextSchema("The city."),
        population: {
          type: "integer",
          description: "New total population, a whole number of people.",
          minimum: 0,
        },
        note: textSchema("Why: siege, famine, industrial boom, refugees."),
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
    // Only the two VERDICTS are offered. "doubted" is stamped by the engine when
    // the agent an entry came from turns out to be compromised, and is absent from
    // this enum on purpose: a model must never be able to cast doubt on the board
    // itself, only to settle a doubt already cast — and only from a fresh source.
    verification: {
      type: "string",
      description:
        "Only for an entry the board shows as doubted, and only once a fresh source is in place: "
        + "confirmed if the new material shows the effort is real, refuted if it shows there was never "
        + "anything there (pair refuted with failing the entry). Leave it out otherwise.",
      enum: ["confirmed", "refuted"],
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
  description: "World-state effects; include only the arrays that apply.",
  properties: {
    actionIds: stringArraySchema("Player action ids this event resolves."),
    createdChats: {
      type: "array",
      description: "Chats this event opens toward the player.",
      items: createdChatSchema,
    },
    polityChanges: {
      type: "array",
      description: "Polity changes.",
      items: polityChangeSchema,
    },
    regionTransfers: {
      type: "array",
      description:
        "Ownership changes — REQUIRED whenever the text says territory changed hands (captured, "
        + "annexed, ceded, liberated), one entry per region, or the map will not match the story.",
      items: regionTransferSchema,
    },
    regionControlOps: {
      type: "array",
      description:
        "DE-FACTO control, not sovereignty: contest = an active disputed front; control = capture, occupation "
        + "or retaking; clear_contest = a ceasefire, withdrawal or settlement ends the contest. A border that "
        + "legally moves is regionTransfers; a claim is regionClaims.",
      items: regionControlOpSchema,
    },
    unitOps: {
      type: "array",
      description: "Military unit operations.",
      items: unitOpSchema,
    },
    markerOps: {
      type: "array",
      description: "Structures built, destroyed, renamed or resized: whenever the event founds, builds or destroys a named place, or a city's population changes.",
      items: markerOpSchema,
    },
    spyOps: {
      type: "array",
      description: "The player's own espionage orders this event executes (deploy or recall an agent), only when their queued actions or chat ordered it; never for other powers.",
      items: spyOpSchema,
    },
    reports: {
      type: "array",
      description:
        "Documents this event produces — a secret protocol, a private letter, an intelligence assessment, a treaty's articles — held only by the polities named in each one. See [Reports]. "
        + "Most events have none; never restate the public event as a report.",
      items: reportOpSchema,
    },
    regionClaims: {
      type: "array",
      description:
        "Territory CLAIMED but not held — an irredentist declaration, a proclaimed union, a contested border, "
        + "a government-in-exile's title. The region shows as disputed WITHOUT the border moving; land that "
        + "changed hands is regionTransfers.",
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

// Category tags (runtime/eventTags.js): the timeline's filter chips.
const eventTagsSchema = {
  type: "array",
  description: "Categorization tags for the timeline's filter chips: Military, Diplomacy, Economy, Politics, Culture or Disaster (up to three).",
  items: { type: "string", enum: [...EVENT_TAG_ENUM] },
  maxItems: MAX_EVENT_TAGS,
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
    tags: eventTagsSchema,
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
    impacts: jumpImpactsSchema,
  },
  required: ["date", "title", "description"],
  additionalProperties: false,
};

const interactiveSchema = {
  type: "object",
  description: "The opening of an interactive event the player is about to play.",
  properties: {
    title: textSchema("Short title of the interactive event."),
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
    // No scene (the `catalyst` a skip used to write): a scene is played only
    // from an interactive event a skip offers, which costs the skip nothing
    // (runtime/interactiveOffer.js). A skip used to propose one every time,
    // into a save nothing showed it from.
    diplomaticOutreach: {
      type: "array",
      description:
        "Polities reaching out to the player on their OWN initiative (feelers, proposals, warnings, "
        + "invitations), not tied to one event. Empty when nobody plausibly would.",
      items: createdChatSchema,
    },
    // The canonical ledgers (nativeWarLedger.js, nativeDiplomaticDirector.js)
    // travel as compact text lines rather than nested objects: a large nested
    // schema is exactly what Gemini function calling and strict tool modes
    // choke on, and the line formats are taught in the live prompt.
    storylineUpdates: {
      type: "string",
      description: "Newline-separated storyline records, format in the prompt; unresolved multi-turn crises persist here. Empty string when none.",
    },
    warUpdates: {
      type: "string",
      description: "Newline-separated war-state records, format in the prompt. Empty string when belligerency did not change.",
    },
    relationUpdates: {
      type: "string",
      description: "Newline-separated bilateral relation records, format in the prompt. Empty string when none changed materially.",
    },
    agreementUpdates: {
      type: "string",
      description: "Newline-separated treaty/agreement lifecycle records, format in the prompt. Empty string when none started, changed or ended.",
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

// The bounded semantic geography pass: place wording that exact matching could
// not resolve, mapped onto the losing side's real regions, or UNRESOLVED.
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

// The native territory director's answer: de-facto control operations to attach
// to the turn's events. It may never invent a legal transfer.
export const TERRITORY_DIRECTOR_SCHEMA = {
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

// Persistent storylines (nativeWorldDirector.js). On a jump they travel as
// compact text lines like the other ledgers; this object form is the
// worldMotionRepair tool's answer for exactly one existing storyline.
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
      description: "Canonical polity participants involved in this persistent process. This list is cumulative on update: include newly involved actors; omission does not remove existing participants. Use exact current polity names.",
      items: nonEmptyTextSchema("One current canonical polity."),
    },
    state: nonEmptyTextSchema("Semantic state through the current stop date: what is true now and why the process remains active/dormant/resolved."),
  },
  required: ["id", "status", "pressure", "momentum", "kind", "title", "participants", "state"],
  additionalProperties: false,
};

export const WORLD_MOTION_REPAIR_SCHEMA = {
  type: "object",
  description:
    "One narrow semantic repair for exactly one already-existing persistent storyline. "
    + "No events, wars, relations, agreements, territory, units, chats, interactive events, or other world changes are allowed.",
  properties: {
    stopDate: nonEmptyTextSchema("Exact simulation stop date in YYYY-MM-DD form."),
    storyline: storylineUpdateSchema,
    summary: textSchema("Optional concise note explaining the repaired semantic movement."),
  },
  required: ["stopDate", "storyline", "summary"],
  additionalProperties: false,
};

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
    tags: eventTagsSchema,
    warId: textSchema(
      "Canonical war id when this pre-game event is the one that started, joined, paused or ended a war listed in canonicalUpdates. Blank otherwise.",
    ),
  },
  required: ["date", "title", "description"],
  additionalProperties: false,
};

// The pre-game bootstrap answers with ONE flat envelope for every canonical
// ledger it seeds (wars, relations, agreements) instead of three mini-languages:
// function-calling in "any" mode is sensitive to schema depth, so the transport
// is deliberately flat and all-required - the model supplies the semantic values
// and gameplay.js (expandCanonicalUpdateEnvelope) dispatches each item to the
// ledger its "kind" names, ignoring the fields that kind does not use.
const canonicalUpdateSchema = {
  type: "object",
  description:
    "One canonical-state fact already true on the start date. Every field is required for provider reliability; use an empty string, empty array, or 0 for fields irrelevant to this kind.",
  properties: {
    kind: {
      type: "string",
      description:
        "Semantic kind code. Use relation; storyline:active; storyline:dormant; war:start; war:join-a; war:join-b; war:leave; war:ceasefire; war:resume; war:end; agreement:start.",
    },
    id: { type: "string", description: "Stable storyline/war/agreement id, or empty for a relation." },
    polities: {
      type: "array",
      description:
        "Primary polities. Relation: exactly [A,B]. Storyline: participants. War: actors / side A. Agreement: parties.",
      items: { type: "string" },
    },
    opponents: {
      type: "array",
      description: "War opponents / side B; empty for non-war items.",
      items: { type: "string" },
    },
    score: {
      type: "integer",
      description: "Relation absolute score -100..100; 0 for non-relation items. The engine clamps it and derives the status.",
    },
    pressure: {
      type: "integer",
      description: "Storyline pressure 0-100 (unresolved stakes); 0 for other kinds.",
    },
    momentum: {
      type: "integer",
      description: "Storyline momentum 0-100 (current rate of change); 0 for other kinds.",
    },
    date: {
      type: "string",
      description: "Storyline start date YYYY-MM-DD when known; empty for other kinds.",
    },
    category: {
      type: "string",
      description: "Storyline process kind (war, crisis, revolution, diplomacy, politics, economy) or agreement type (alliance, mutual_defense, guarantee, non_aggression, friendship_consultation, trade_economic, military_cooperation, military_access, neutrality, peace_settlement, other); otherwise empty.",
    },
    title: {
      type: "string",
      description: "Agreement or storyline title when relevant; otherwise empty.",
    },
    detail: {
      type: "string",
      description: "Relation summary, war note, agreement terms, or storyline state (what is true now and why the process is unresolved).",
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
    canonicalUpdates: {
      type: "array",
      description:
        "Wars, bilateral relations and formal agreements ALREADY TRUE on the start date. Empty array only when no such Day-1 state exists. The engine dispatches and binds every item.",
      maxItems: 32,
      items: canonicalUpdateSchema,
    },
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

// One turn of a diplomatic thread, acting for EVERY AI participant at once
// (AI/chatActions.js). A four-way chat used to cost four requests for one
// player message — one to pick the speaker, one per leader who answered — and
// this is all of it in a single answer.
//
// Actors are named by their exact display name: an id would have to be shown
// and copied, and the model already has the names in front of it. `pollRef` and
// `optionRef` are the batch's OWN labels for a poll it invents, so it can be
// created and voted in the same answer; the engine mints the real ids.
// ONE object with a `type` enum and all-optional fields, exactly as
// projectOpSchema is, and for a harder reason: Gemini refuses a function
// declaration whose anyOf has more than six branches outright (400 "Request
// contains an invalid argument", bisected against the live API — six branches
// passed, seven did not), and this vocabulary has eight. Nothing is lost:
// what each type actually needs is enforced by normalizeChatAction
// (AI/chatActions.js) before a single action is applied, and a malformed one
// costs only itself.
const chatActionSchema = {
  type: "object",
  description: "One action by one AI participant. Fill the fields that type needs and leave the rest out.",
  properties: {
    type: {
      type: "string",
      description:
        "send_message = speak. add_reaction = react to a message instead of speaking. rename_chat = the conversation has become about something else. "
        + "add_member / remove_member = bring a polity in, or put one out. create_poll = call a binding vote. add_poll_option = add a choice to one. poll_vote = cast a vote.",
      enum: ["send_message", "add_reaction", "rename_chat", "add_member", "remove_member", "create_poll", "add_poll_option", "poll_vote"],
    },
    actorName: nonEmptyTextSchema("The AI participant acting, by exact display name. NEVER a human-controlled one."),
    content: textSchema("send_message: what it says, in its leader's voice. Match the length and tone of what it answers."),
    targetEntryId: textSchema("add_reaction: the id of the message reacted to, copied from the transcript."),
    emoji: textSchema("add_reaction: one emoji."),
    title: textSchema("rename_chat: the new title."),
    targetName: textSchema("add_member / remove_member: the polity, by exact FULL name. Never a human-controlled participant."),
    pollRef: textSchema("create_poll: your own short label for the poll, so you can vote on it in this same answer. add_poll_option / poll_vote: that label, or the id of a poll already open."),
    question: textSchema("create_poll: the binding question — a treaty, an armistice, war credits, a conference resolution. Never a mood check."),
    options: {
      type: "array",
      description: "create_poll: two or more choices to vote on.",
      items: {
        type: "object",
        properties: {
          optionRef: nonEmptyTextSchema("Your own short label for this option."),
          label: nonEmptyTextSchema("What it says on the ballot."),
        },
        required: ["optionRef", "label"],
        additionalProperties: false,
      },
    },
    optionRef: textSchema("add_poll_option: your own label for the new choice. poll_vote: the option's ref, or the exact label of an option already open."),
    label: textSchema("add_poll_option: what the new choice says on the ballot."),
    allowCustom: { type: "boolean", description: "create_poll: whether a participant may add a choice of its own." },
  },
  required: ["type", "actorName"],
  additionalProperties: false,
};

export const CHAT_ACTIONS_SCHEMA = {
  type: "object",
  description: "One turn of a diplomatic conversation, acting for every AI-controlled participant at once, in the order it happens.",
  properties: {
    actions: {
      type: "array",
      description: "The actions, in order. An empty list is a valid answer: silence is an answer.",
      maxItems: 16,
      items: chatActionSchema,
    },
    memorySummary: textSchema("The thread's rolling memory, rewritten: what has been agreed, threatened, offered and left unresolved. Two or three sentences."),
  },
  required: ["actions"],
  additionalProperties: false,
};

export const EVENT_CONSOLIDATOR_SCHEMA = {
  type: "object",
  description: "A continuity-safe summary of the supplied events and diplomatic chats, and the campaign's living history document revised to include them.",
  properties: {
    summary: textSchema("Concise history of the supplied period preserving major events, map changes, and diplomatic commitments."),
    document: textSchema("The WHOLE history document as it should read from now on: the current document with this period folded in, condensed or pruned of unimportant older material where needed to stay within the stated word budget."),
  },
  required: ["summary"],
  additionalProperties: false,
};

export const INTERACTIVE_CREATION_SCHEMA = interactiveSchema;

export const INTERACTIVE_EXECUTOR_SCHEMA = {
  type: "object",
  description: "The next stage of an interactive event after applying the player's choice.",
  properties: {
    summary: textSchema("Narration of the player's action, reactions, and resulting situation."),
    resolved: {
      type: "boolean",
      description: "Whether the interactive event has reached a definite conclusion.",
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

export const INTERACTIVE_SUMMARY_SCHEMA = {
  type: "object",
  description: "A finished interactive event condensed into one campaign timeline event.",
  properties: {
    title: textSchema("Concise event headline."),
    description: textSchema("Complete but concise account of the interactive event's outcome."),
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

const gmStorylineUpdateSchema = {
  type: "object",
  description: "One authoritative persistent world.storylines semantic update.",
  properties: {
    id: nonEmptyTextSchema("Stable storyline id. Reuse the existing id when advancing an existing process."),
    status: { type: "string", enum: ["active", "dormant", "resolved"] },
    pressure: { type: "integer", minimum: 0, maximum: 100 },
    momentum: { type: "integer", minimum: 0, maximum: 100 },
    startedDate: textSchema("YYYY-MM-DD date when the process began, when known."),
    kind: nonEmptyTextSchema("Short process category such as crisis, politics, economy, war, revolution, or diplomacy."),
    title: nonEmptyTextSchema("Concise persistent process title."),
    participants: stringArraySchema("Canonical polity participants. Cumulative on update: include new actors; omitted prior actors remain. Full polity names only."),
    eventIndexes: gmEventIndexesSchema,
    state: nonEmptyTextSchema("What is true now and why the process remains active/dormant/resolved through the current game date."),
  },
  required: ["id", "status", "pressure", "momentum", "kind", "title", "participants", "eventIndexes", "state"],
  additionalProperties: false,
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
        customStats: {
          type: "object",
          description: "Scenario-defined full-sheet numeric Stats corrections. Live tool declaration supplies the exact allowed keys and ranges.",
          maxProperties: 60,
          additionalProperties: { type: "number" },
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

// A GM-authored event carries the FULL impacts contract: unlike the jump, which
// hands the Projects & Operations board to its own second call, the GM has no
// second pass, so its events keep projectOps.
const gameMasterEventSchema = {
  ...eventSchema,
  properties: {
    ...eventSchema.properties,
    impacts: impactsSchema,
  },
};

// The GM transaction the app validates and previews. The AI plans structured
// canonical operations; the payload is not itself permission to persist them —
// only the administrator's Apply of the exact preview is.
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
      items: gameMasterEventSchema,
    },
    countryStatPatches: {
      type: "array",
      description: "Authoritative whole-polity/current-baseline Stats corrections.",
      maxItems: 12,
      items: gmCountryStatPatchSchema,
    },
    storylineUpdates: {
      type: "array",
      description: "Persistent unresolved world-process updates using the canonical world.storylines owner.",
      maxItems: 16,
      items: gmStorylineUpdateSchema,
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
    "storylineUpdates",
    "warUpdates",
    "relationUpdates",
    "agreementUpdates",
    "diplomaticOutreach",
  ],
  additionalProperties: false,
};

// Provider transport: Gemini rejects very large/deep function declaration
// schemas with HTTP 400 "Request contains an invalid argument." Keep the GM
// transaction fully structured inside the app, but send it through a
// deliberately shallow tool contract. Each subsystem is JSON array text, decoded
// immediately and then validated against GAME_MASTER_SCHEMA before any preview
// is accepted.
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
    storylineUpdatesJson: textSchema("JSON array text for persistent canonical world.storylines updates. Use [] when none."),
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
    "storylineUpdatesJson",
    "warUpdatesJson",
    "relationUpdatesJson",
    "agreementUpdatesJson",
    "diplomaticOutreachJson",
  ],
  additionalProperties: false,
};

const GAME_MASTER_TRANSPORT_FIELDS = Object.freeze([
  ["eventsJson", "events"],
  ["countryStatPatchesJson", "countryStatPatches"],
  ["storylineUpdatesJson", "storylineUpdates"],
  ["warUpdatesJson", "warUpdates"],
  ["relationUpdatesJson", "relationUpdates"],
  ["agreementUpdatesJson", "agreementUpdates"],
  ["diplomaticOutreachJson", "diplomaticOutreach"],
]);

const parseGameMasterTransportArray = (value, field) => {
  if (Array.isArray(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return [];
  let parsed;
  let strictError = null;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    strictError = error;
    // The same salvage the task runner gives a whole answer (jsonSalvage.js):
    // a trailing remark after the array, a smart quote, a trailing comma or a
    // second array must not cost the whole transaction. Only after the strict
    // parse failed, so well-formed text is never touched.
    parsed = extractJsonArray(text);
    if (parsed === null) {
      throw new Error(`$.${field} must contain valid JSON array text: ${strictError?.message || strictError}.`);
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`$.${field} must decode to a JSON array.`);
  }
  return parsed;
};

// The transport shows the GM no schema for a chat, so its countries arrive as
// names or as {name} objects; the schema it is validated against takes names.
const normalizeGameMasterChats = (payload) => {
  if (!isPlainRecord(payload)) return payload;
  const next = { ...payload };
  if (Array.isArray(next.events)) {
    next.events = next.events.map((event) => (
      isPlainRecord(event) && isPlainRecord(event.impacts) && Array.isArray(event.impacts.createdChats)
        ? { ...event, impacts: { ...event.impacts, createdChats: normalizeChatList(event.impacts.createdChats) } }
        : event
    ));
  }
  if (Array.isArray(next.diplomaticOutreach)) next.diplomaticOutreach = normalizeChatList(next.diplomaticOutreach);
  return next;
};

export const decodeGameMasterTransportPayload = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { payload: value, error: "" };
  }

  const isTransport = GAME_MASTER_TRANSPORT_FIELDS.some(([field]) => Object.prototype.hasOwnProperty.call(value, field));
  if (!isTransport) {
    // Raw/local providers may already return the internal structured transaction.
    return { payload: normalizeGameMasterChats(value), error: "" };
  }

  try {
    const payload = {
      mode: String(value.mode ?? "").trim(),
      summary: String(value.summary ?? "").trim(),
    };
    for (const [field, key] of GAME_MASTER_TRANSPORT_FIELDS) {
      payload[key] = parseGameMasterTransportArray(value[field], field);
    }
    return { payload: normalizeGameMasterChats(payload), error: "" };
  } catch (error) {
    return { payload: null, error: String(error?.message || error || "Invalid GM transport payload.") };
  }
};

// The curator's answer: one conservative judgment per candidate event plus a
// reading of recent history. Native gates in nativeTimelineCurator.js decide
// what the judgments may actually remove.
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

// The unit director's answer: unit operations to attach to the military events
// the jump already wrote, keyed by the supplied event index. Native code
// sanitizes every op before it reaches an event.
export const UNIT_DIRECTOR_SCHEMA = {
  type: "object",
  description:
    "A conservative post-simulation military orchestration pass. It reuses persistent units and moves, "
    + "reinforces or removes them only where the supplied events require it.",
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

// The structure director's answer: new structures the supplied events built,
// keyed by event index (nativeStructureDirector.js). Builds only, and native
// code decides which of them reach the map.
export const STRUCTURE_DIRECTOR_SCHEMA = {
  type: "object",
  description:
    "A conservative post-simulation pass that puts on the map the physical structures the supplied events "
    + "built, opened or completed.",
  properties: {
    eventOrders: {
      type: "array",
      description: "New structures, keyed by the supplied eventIndex of the event that built them.",
      items: {
        type: "object",
        properties: {
          eventIndex: { type: "integer", minimum: 0 },
          structures: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: nonEmptyTextSchema("Its specific name."),
                kind: nonEmptyTextSchema("What it is, as a short lowercase noun phrase: data centre, ground station, shipyard."),
                ownerCode: nonEmptyTextSchema("The owning polity's FULL name, never a code."),
                status: {
                  type: "string",
                  enum: ["planned", "under_construction", "active"],
                  description: "planned when only announced, under_construction when work has begun, active when working.",
                },
                at: atSchema,
                lng: { type: "number", description: "Only with no `at`.", minimum: -180, maximum: 180 },
                lat: { type: "number", description: "Only with no `at`.", minimum: -90, maximum: 90 },
                note: textSchema("One line on what it is for, shown when inspected."),
                projectId: textSchema("The id of the board project it belongs to, copied exactly. Omit when it belongs to none."),
              },
              required: ["name", "kind", "ownerCode", "status"],
              additionalProperties: false,
            },
          },
        },
        required: ["eventIndex", "structures"],
        additionalProperties: false,
      },
    },
    summary: textSchema("Short summary of what was put on the map this turn."),
  },
  required: ["eventOrders", "summary"],
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
      description: "Complete strategic index sheet. A scenario may replace the stock keys with its own live Stats definition; values remain integers from 0 to 100.",
      properties: {
        sovereignty: percentageSchema("Practical political sovereignty."),
        foodAutonomy: percentageSchema("Domestic food autonomy."),
        energyAutonomy: percentageSchema("Domestic energy autonomy."),
        economicIndependence: percentageSchema("Economic independence."),
        internalSecurity: percentageSchema("Internal security."),
        internationalReputation: percentageSchema("International reputation / standing (0-100)."),
      },
      minProperties: 1,
      maxProperties: 12,
      additionalProperties: percentageSchema("A scenario-defined strategic index value (0-100)."),
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
    economicCalibration: {
      type: "object",
      description:
        "Audit provenance for a fresh/hard-audit NOMINAL economic baseline. Return this ONLY when the live Stats prompt says ECONOMIC CALIBRATION REQUIRED. This explicitly forbids PPP/international-dollar substitution in the canonical GDP ledger.",
      properties: {
        mode: {
          type: "string",
          enum: ["historical_start", "counterfactual_start", "campaign_reconstruction"],
          description:
            "Use the same scenario-causality mode as the population baseline when both are present.",
        },
        historyAuthorityCutoff: nonEmptyTextSchema(
          "Latest date/era through which real-world economic history is causally shared enough to anchor nominal output. Later real-world outcomes are forbidden after divergence.",
        ),
        basis: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          description:
            "Concise audit basis naming the nominal GDP/GDP-per-capita scale and scenario evidence used. Do not provide hidden reasoning.",
        },
        anchorYear: {
          type: "integer",
          minimum: 1,
          maximum: 9999,
          description: "Year of the contemporaneous nominal GDP anchor; it must not lie beyond the shared-history frontier.",
        },
        anchorCurrency: {
          type: "string",
          enum: ["USD", "EUR"],
          description:
            "Currency unit of the contemporaneous nominal anchor. Use current USD or current EUR only; do not use PPP/international dollars or local-currency amounts here.",
        },
        nominalGdpBillions: statNumberSchema(
          "Whole-polity NOMINAL GDP at anchorYear in billions of anchorCurrency, for the same territorial scope as nominalGdpPerCapita. Never use PPP GDP.",
          { minimum: 0.000001 },
        ),
        nominalGdpPerCapita: statNumberSchema(
          "Contemporaneous NOMINAL GDP per capita at anchorYear in anchorCurrency. Never use PPP/international-dollar GDP per capita.",
          { minimum: 1 },
        ),
        rebasedGdpPerCapita2026Eur: statNumberSchema(
          "The same nominal GDP-per-capita anchor expressed in constant 2026 EUR using monetary inflation/FX rebasing only. This is NOT PPP, purchasing power, or a productivity/living-standard adjustment.",
          { minimum: 1 },
        ),
        divergenceEventIds: {
          type: "array",
          maxItems: 12,
          description:
            "Canonical IDs from the bounded fresh economic evidence that causally justify a large current departure from the rebased nominal anchor. Empty when no supplied event supports such a departure.",
          items: nonEmptyTextSchema("Canonical economic event id supplied by the live Stats prompt."),
        },
      },
      required: [
        "mode",
        "historyAuthorityCutoff",
        "basis",
        "anchorYear",
        "anchorCurrency",
        "nominalGdpBillions",
        "nominalGdpPerCapita",
        "rebasedGdpPerCapita2026Eur",
        "divergenceEventIds",
      ],
      additionalProperties: false,
    },
    territorialMacroComponentsText: {
      type: "string",
      minLength: 1,
      description:
        "Bounded regional territorial estimate. With a native macro plan, return exactly one row per [M#] macro bucket as index~group~population~gdpPerCapita. Native code expands each macro row back across every exact live-map component. For an explicitly NON-TERRITORIAL basis, compatibility rows may use group~geography~population~gdpPerCapita when campaign canon supports a real distributed people/organization/economy; return the literal NONE when no defensible quantitative scope exists. group is core, integrated, or overseas/dependent; population is an integer; gdpPerCapita is a positive NOMINAL output-per-capita number in constant 2026-EUR accounting terms; never PPP/international dollars.",
    },
    territorialComponentSplitText: {
      type: "string",
      description:
        "Only when the prompt requires a PER-COMPONENT SPLIT: one row per listed component as componentId~sharePercent~group~gdpPerCapita, where sharePercent is the component's share of its own macro bucket's population (each bucket's rows sum to 100), and group/gdpPerCapita are that component's own. Omit it otherwise.",
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
        semanticSplitComponents: {
          type: "array",
          maxItems: 64,
          description: "Components whose share of their macro bucket was set by a per-component split rather than native weights.",
          items: {
            type: "object",
            properties: {
              geography: nonEmptyTextSchema("Component geography."),
              regions: { type: "integer", minimum: 0, description: "Map regions the component held when it was split." },
            },
            required: ["geography", "regions"],
            additionalProperties: false,
          },
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
      description: "Persistent strategic indices. Scenario-defined keys are validated against the live Stats definition before this sheet is accepted.",
      properties: {
        sovereignty: percentageSchema("Practical political sovereignty."),
        foodAutonomy: percentageSchema("Domestic food autonomy."),
        energyAutonomy: percentageSchema("Domestic energy autonomy."),
        economicIndependence: percentageSchema("Economic independence."),
        internalSecurity: percentageSchema("Internal security."),
        internationalReputation: percentageSchema("International reputation / standing (0-100)."),
      },
      minProperties: 1,
      maxProperties: 12,
      additionalProperties: percentageSchema("A scenario-defined strategic index value (0-100)."),
    },
    territorialScope: {
      type: "string",
      enum: ["mapped", "nonterritorial"],
      description:
        "Native accounting scope. mapped means territorialComponents must contain the authoritative live-map ledger. nonterritorial means this valid polity has no mapped national territorial basis; compatibility components may still represent a campaign-supported distributed people/organization/economy, or the array may be empty when no defensible quantitative scope exists.",
    },
    population: {
      type: "object",
      description: "Derived population aggregates. The runtime recomputes these from territorialComponents when a quantitative component ledger exists.",
      properties: {
        total: { type: "integer", minimum: 0 },
        coreIntegrated: { type: "integer", minimum: 0 },
        otherTerritories: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    territorialComponents: {
      type: "array",
      minItems: 0,
      description:
        "For mapped scope, one demographic/economic component for every authoritative territorial geography in the live-map basis. There is deliberately no fixed component cap: map granularity must never delete population/GDP. For explicit nonterritorial scope, this may contain campaign-supported distributed/non-map quantitative components or be empty when no defensible population/GDP basis exists.",
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
            "THIS component's NOMINAL GDP per capita expressed in constant 2026-EUR accounting terms. This is not PPP/international-dollar purchasing power and does not import 2026 technology/productivity.",
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
        gdp: statNumberSchema("Derived whole-polity NOMINAL GDP in constant 2026-EUR accounting terms.", { minimum: 1 }),
        gdpGrowth: statNumberSchema("Annual real GDP growth estimate in percent.", { minimum: -100, maximum: 100 }),
        gdpPerCapita: statNumberSchema("Derived whole-polity NOMINAL GDP per capita in constant 2026-EUR accounting terms.", { minimum: 1 }),
        coreGdpPerCapita: statNumberSchema("Derived core/integrated NOMINAL GDP per capita in constant 2026-EUR accounting terms.", { minimum: 1 }),
        otherGdpPerCapita: statNumberSchema("Derived overseas/dependent NOMINAL GDP per capita in constant 2026-EUR accounting terms.", { minimum: 1 }),
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

// What a deployed spy reports: the target's diplomatic traffic with THIRD parties.
// Redaction happens on the player's side, by their intelligence stat — the model
// writes the whole exchange, the game decides how much of it the player can read.
const SPY_INTERCEPT_SCHEMA = {
  type: "object",
  description: "Intercepted diplomatic exchanges between the target polity and other polities.",
  properties: {
    exchanges: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          counterpart: nonEmptyTextSchema("The OTHER polity in this exchange. Never the target itself, never the player's polity."),
          date: nonEmptyTextSchema("When the exchange took place, YYYY-MM-DD, within the last period."),
          subject: nonEmptyTextSchema("What the exchange is about, in a few words."),
          messages: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                speaker: nonEmptyTextSchema("The polity speaking — the target or the counterpart."),
                text: nonEmptyTextSchema("What was said, in that leader's voice: intentions and terms, not public statements."),
              },
              required: ["speaker", "text"],
              additionalProperties: false,
            },
          },
        },
        required: ["counterpart", "date", "subject", "messages"],
        additionalProperties: false,
      },
    },
  },
  required: ["exchanges"],
  additionalProperties: false,
};

// A first reading of one polity's intelligence service, asked the moment that
// service matters (gameplay.js assessIntelligenceService). It replaces
// spycraft.js DEFAULT_INTELLIGENCE for that polity, once; the turn moves the
// number after that through polityChanges.intelligence.
const INTELLIGENCE_ASSESSMENT_SCHEMA = {
  type: "object",
  description: "An assessment of one polity's intelligence service as it stands on the current date.",
  properties: {
    intelligence: {
      type: "number",
      description:
        "Intelligence service capability 0-100 for this polity right now. 0-34 weak: no real foreign "
        + "service, porous, easily read. 35-54 ordinary: a working service of no particular note. "
        + "55-74 capable: a professional service with real reach abroad and sound counter-intelligence. "
        + "75-100 formidable: a first-rank service with global reach, deep penetration of its rivals and "
        + "secrets that are very hard to read. Judge from the era, the state's size and wealth, its regime, "
        + "its tradition of espionage and the events so far: a great power of the period is rarely below "
        + "55, a small or newly founded state rarely above 50.",
    },
    service: textSchema("The service's actual name where one is known or plausible for this era and regime (KGB, MI6, Okhrana, Abwehr), else blank."),
    rationale: nonEmptyTextSchema("One or two sentences on what the rating rests on."),
  },
  required: ["intelligence", "rationale"],
  additionalProperties: false,
};

export const GAMEPLAY_SCHEMAS = Object.freeze({
  spyIntercept: SPY_INTERCEPT_SCHEMA,
  intelligenceAssessment: INTELLIGENCE_ASSESSMENT_SCHEMA,
  actions: ACTIONS_SCHEMA,
  jumpForward: JUMP_FORWARD_SCHEMA,
  autoJumpForward: AUTO_JUMP_FORWARD_SCHEMA,
  descriptionToAction: DESCRIPTION_TO_ACTION_SCHEMA,
  nextSpeaker: NEXT_SPEAKER_SCHEMA,
  chatActions: CHAT_ACTIONS_SCHEMA,
  eventConsolidator: EVENT_CONSOLIDATOR_SCHEMA,
  interactiveCreation: INTERACTIVE_CREATION_SCHEMA,
  interactiveExecutor: INTERACTIVE_EXECUTOR_SCHEMA,
  interactiveSummary: INTERACTIVE_SUMMARY_SCHEMA,
  gameMaster: GAME_MASTER_SCHEMA,
  unitDirector: UNIT_DIRECTOR_SCHEMA,
  structureDirector: STRUCTURE_DIRECTOR_SCHEMA,
  timelineCurator: TIMELINE_CURATOR_SCHEMA,
  worldMotionRepair: WORLD_MOTION_REPAIR_SCHEMA,
  territoryDirector: TERRITORY_DIRECTOR_SCHEMA,
  geographyResolver: GEOGRAPHY_RESOLVER_SCHEMA,
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
  "Submit the events, stop date, summary and resolved-action state from a timeline jump.",
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

export const CHAT_ACTIONS_TOOL = makeTool(
  "submit_chat_actions",
  "Submit this turn of the conversation: every AI-controlled participant's actions, in order.",
  CHAT_ACTIONS_SCHEMA,
);

export const NEXT_SPEAKER_TOOL = makeTool(
  "submit_next_speaker",
  "Submit the exact diplomatic chat participant who should speak next.",
  NEXT_SPEAKER_SCHEMA,
);

export const EVENT_CONSOLIDATOR_TOOL = makeTool(
  "submit_event_consolidation",
  "Submit a concise continuity summary of the supplied campaign events and chats, and the campaign's history document revised to include them.",
  EVENT_CONSOLIDATOR_SCHEMA,
);

export const INTERACTIVE_CREATION_TOOL = makeTool(
  "submit_interactive_creation",
  "Submit the opening of a new interactive event and the choices available to the player.",
  INTERACTIVE_CREATION_SCHEMA,
);

export const INTERACTIVE_EXECUTOR_TOOL = makeTool(
  "submit_interactive_execution",
  "Submit the result of the player's choice in the interactive event and either new choices or a resolved state.",
  INTERACTIVE_EXECUTOR_SCHEMA,
);

export const INTERACTIVE_SUMMARY_TOOL = makeTool(
  "submit_interactive_summary",
  "Submit the final campaign event produced by a finished interactive event.",
  INTERACTIVE_SUMMARY_SCHEMA,
);

export const PROJECTS_TOOL = makeTool(
  "submit_project_ops",
  "Submit the Projects & Operations board changes that follow from the events just simulated.",
  PROJECTS_SCHEMA,
);

export const GAME_MASTER_TOOL = makeTool(
  "submit_game_master",
  "Submit the compact provider transport for a previewable native GM transaction. Native code decodes and validates the structured transaction; nothing is applied by this call.",
  GAME_MASTER_TRANSPORT_SCHEMA,
);

export const TIMELINE_CURATOR_TOOL = makeTool(
  "submit_timeline_curator",
  "Submit conservative semantic judgments for newly generated timeline events.",
  TIMELINE_CURATOR_SCHEMA,
);

export const UNIT_DIRECTOR_TOOL = makeTool(
  "submit_unit_director",
  "Submit conservative persistent-unit operations for the supplied military events.",
  UNIT_DIRECTOR_SCHEMA,
);

export const STRUCTURE_DIRECTOR_TOOL = makeTool(
  "submit_structure_director",
  "Submit the new structures the supplied events built, opened or completed.",
  STRUCTURE_DIRECTOR_SCHEMA,
);

export const WORLD_MOTION_REPAIR_TOOL = makeTool(
  "submit_world_motion_repair",
  "Submit exactly one semantic update for one existing persistent storyline. This tool cannot create events or mutate any other canonical ledger.",
  WORLD_MOTION_REPAIR_SCHEMA,
);

export const TERRITORY_DIRECTOR_TOOL = makeTool(
  "submit_territory_director",
  "Submit conservative de-facto territorial control operations for the supplied events.",
  TERRITORY_DIRECTOR_SCHEMA,
);

export const GEOGRAPHY_RESOLVER_TOOL = makeTool(
  "submit_geography_resolution",
  "Resolve unresolved human place or historical-area labels to exact supplied map region ids without deciding territorial outcomes.",
  GEOGRAPHY_RESOLVER_SCHEMA,
);

export const COUNTRY_STAT_SHEET_TOOL = makeTool(
  "submit_country_stat_sheet",
  "Submit the bounded regional national-statistics payload. Native code expands regional macro estimates into the exact live-map territorial ledger and derives aggregate population/GDP fields before persistence.",
  COUNTRY_STAT_GENERATION_SCHEMA,
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

export const SPY_INTERCEPT_TOOL = makeTool(
  "submit_spy_intercept",
  "Submit the diplomatic exchanges a planted spy intercepted between the target polity and others.",
  SPY_INTERCEPT_SCHEMA,
);

export const INTELLIGENCE_ASSESSMENT_TOOL = makeTool(
  "submit_intelligence_assessment",
  "Submit the assessment of the target polity's intelligence service.",
  INTELLIGENCE_ASSESSMENT_SCHEMA,
);

export const GAMEPLAY_TOOLS = Object.freeze({
  spyIntercept: SPY_INTERCEPT_TOOL,
  intelligenceAssessment: INTELLIGENCE_ASSESSMENT_TOOL,
  actions: ACTIONS_TOOL,
  jumpForward: JUMP_FORWARD_TOOL,
  autoJumpForward: AUTO_JUMP_FORWARD_TOOL,
  descriptionToAction: DESCRIPTION_TO_ACTION_TOOL,
  nextSpeaker: NEXT_SPEAKER_TOOL,
  chatActions: CHAT_ACTIONS_TOOL,
  eventConsolidator: EVENT_CONSOLIDATOR_TOOL,
  interactiveCreation: INTERACTIVE_CREATION_TOOL,
  interactiveExecutor: INTERACTIVE_EXECUTOR_TOOL,
  interactiveSummary: INTERACTIVE_SUMMARY_TOOL,
  gameMaster: GAME_MASTER_TOOL,
  unitDirector: UNIT_DIRECTOR_TOOL,
  structureDirector: STRUCTURE_DIRECTOR_TOOL,
  timelineCurator: TIMELINE_CURATOR_TOOL,
  worldMotionRepair: WORLD_MOTION_REPAIR_TOOL,
  territoryDirector: TERRITORY_DIRECTOR_TOOL,
  geographyResolver: GEOGRAPHY_RESOLVER_TOOL,
  countryStatSheet: COUNTRY_STAT_SHEET_TOOL,
  idleDiplomacy: IDLE_DIPLOMACY_TOOL,
  pregameHistory: PREGAME_HISTORY_TOOL,
  projects: PROJECTS_TOOL,
});

export const getGameplayTool = (taskKey) => GAMEPLAY_TOOLS[taskKey] ?? null;

const STOCK_STAT_INDEX_KEYS = new Set([
  "sovereignty",
  "foodAutonomy",
  "energyAutonomy",
  "economicIndependence",
  "internalSecurity",
  "internationalReputation",
]);

const looksLikeStatIndicesSchema = (schema) => {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || schema.type !== "object") return false;
  const propertyKeys = Object.keys(schema.properties || {});
  return propertyKeys.some((key) => STOCK_STAT_INDEX_KEYS.has(key)) || /strategic index/i.test(String(schema.description || ""));
};

// Gemini strips JSON Schema's additionalProperties because its function declaration
// dialect does not support it. For a custom scenario, therefore, an "open" indices
// object is not enough: Gemini would only see the stock six. This produces a
// per-call tool clone whose declared properties are the scenario's exact keys.
// The static schema remains open for provider-agnostic validation; this helper is
// transport guidance, not a second source of truth.
export const getGameplayToolForStatIndices = (taskKey, rows, { custom = false } = {}) => {
  const tool = getGameplayTool(taskKey);
  if (!tool || !custom || !Array.isArray(rows) || !rows.length) return tool;

  const statProperties = Object.fromEntries(rows.map((row) => [String(row?.key || "").trim(), {
    type: "integer",
    minimum: 0,
    maximum: 100,
    description: String(row?.description || row?.label || "Scenario-defined strategic index").trim(),
  }]).filter(([key]) => key));
  const statKeys = Object.keys(statProperties);
  if (!statKeys.length) return tool;
  const complete = taskKey === "countryStatSheet";

  const rewrite = (value, parentKey = "") => {
    if (Array.isArray(value)) return value.map((entry) => rewrite(entry));
    if (!value || typeof value !== "object") return value;

    if (parentKey === "indices" && looksLikeStatIndicesSchema(value)) {
      return {
        ...value,
        properties: statProperties,
        ...(complete ? { required: statKeys } : { required: undefined }),
        additionalProperties: false,
        minProperties: complete ? statKeys.length : value.minProperties,
        maxProperties: statKeys.length,
      };
    }

    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry, key)]));
  };

  const schema = rewrite(tool.schema);
  return { ...tool, schema };
};

const statSchemaForDefinition = (row) => {
  const kind = String(row?.kind || "number").trim().toLowerCase();
  const schema = {
    type: kind === "index" && Number(row?.decimals || 0) === 0 ? "integer" : "number",
    description: String(row?.description || row?.label || "Scenario-defined statistic").trim(),
  };
  if (Number.isFinite(Number(row?.minimum))) schema.minimum = Number(row.minimum);
  if (Number.isFinite(Number(row?.maximum))) schema.maximum = Number(row.maximum);
  if (kind === "index") {
    schema.minimum = 0;
    schema.maximum = 100;
  }
  return schema;
};

const customStatsProperties = (rows) => Object.fromEntries(
  (Array.isArray(rows) ? rows : [])
    .map((row) => [String(row?.key || "").trim(), statSchemaForDefinition(row)])
    .filter(([key]) => key),
);

const looksLikeStatsUpdateSchema = (schema) => Boolean(
  schema && typeof schema === "object" && !Array.isArray(schema) && schema.type === "object"
  && schema.properties && (schema.properties.indices || schema.properties.economy || schema.properties.stability)
);

// Full custom sheets are intentionally distinct from the standard modern Stats
// schema. They expose only generic numeric values defined by the scenario, so a
// medieval/custom setting is not forced to generate GDP, unemployment, debt, or
// any other modern field merely because those exist in the stock UI.
export const getGameplayToolForCustomStatSheet = (taskKey, rows, { custom = false } = {}) => {
  const tool = getGameplayTool(taskKey);
  if (!tool || !custom || !Array.isArray(rows) || !rows.length) return tool;

  const properties = customStatsProperties(rows);
  const keys = Object.keys(properties);
  if (!keys.length) return tool;

  if (taskKey === "countryStatSheet") {
    return {
      ...tool,
      description: "Submit the complete scenario-defined National Stats sheet. These are generic persistent numeric values; the scenario, not the modern economy schema, defines what they mean.",
      schema: {
        type: "object",
        properties: {
          customStats: {
            type: "object",
            description: "Complete scenario-defined Stats values using exactly the supplied machine keys.",
            properties,
            required: keys,
            minProperties: keys.length,
            maxProperties: keys.length,
            additionalProperties: false,
          },
        },
        required: ["customStats"],
        additionalProperties: false,
      },
    };
  }

  // The GM uses a deliberately shallow provider transport: countryStatPatchesJson
  // and eventsJson are JSON ARRAY TEXT rather than nested tool objects. The generic
  // schema rewrite below therefore cannot reach patch.customStats or
  // impacts.polityChanges[].stats. Put the live scenario contract on those string
  // fields themselves so providers see the exact custom machine keys before they
  // author the JSON text. Native validation still owns the decoded transaction.
  if (taskKey === "gameMaster") {
    const keyList = keys.join(", ");
    const sampleKey = keys[0];
    const patchDescription =
      `JSON array text for authoritative country Stats patches in this custom-sheet scenario. `
      + `Numeric Stats MUST be written only as patch.customStats using these exact machine keys: ${keyList}. `
      + `Do not use population, economy, indices, stability, or gdpBreakdown. `
      + `Example: [{"country":"Full Polity Name","patch":{"customStats":{"${sampleKey}":1}},"eventIndexes":[],"reason":""}]. `
      + "Use only the requested customStats keys; values are absolute, not deltas.";
    const eventDescription =
      `JSON array text for canonical event objects. This scenario uses a custom National Stats sheet. `
      + `If an event changes Stats through impacts.polityChanges[].stats, numeric Stats MUST be under customStats `
      + `using only these exact machine keys: ${keyList}. Do not use population, economy, indices, stability, or gdpBreakdown. `
      + "Use [] when there are no events.";

    return {
      ...tool,
      description:
        `${tool.description} This scenario has a custom National Stats sheet; any Stats mutation must use the exact live customStats machine keys.`,
      schema: {
        ...tool.schema,
        properties: {
          ...tool.schema.properties,
          eventsJson: {
            ...tool.schema.properties?.eventsJson,
            description: eventDescription,
          },
          countryStatPatchesJson: {
            ...tool.schema.properties?.countryStatPatchesJson,
            description: patchDescription,
          },
        },
      },
    };
  }

  const rewrite = (value, parentKey = "") => {
    if (Array.isArray(value)) return value.map((entry) => rewrite(entry));
    if (!value || typeof value !== "object") return value;

    if (parentKey === "customStats") {
      return {
        ...value,
        properties,
        additionalProperties: false,
        maxProperties: keys.length,
      };
    }

    // Ordinary turn/event Stats patches on a custom sheet retain only identity
    // metadata plus customStats. This keeps hidden modern economy/index fields
    // out of the model's tool vocabulary instead of generating unused state.
    if (parentKey === "stats" && looksLikeStatsUpdateSchema(value)) {
      const keep = {};
      for (const key of ["capital", "continent", "government", "leader"]) {
        if (value.properties?.[key]) keep[key] = rewrite(value.properties[key], key);
      }
      keep.customStats = {
        type: "object",
        description: "Only scenario-defined values that actually changed this period. Values are absolute, not deltas.",
        properties,
        additionalProperties: false,
        maxProperties: keys.length,
      };
      return { ...value, properties: keep, additionalProperties: false };
    }

    if (parentKey === "patch" && looksLikeStatsUpdateSchema(value)) {
      const keep = {};
      for (const key of ["capital", "continent", "government", "leader"]) {
        if (value.properties?.[key]) keep[key] = rewrite(value.properties[key], key);
      }
      keep.customStats = {
        type: "object",
        description: "Scenario-defined Stats corrections using only exact live keys.",
        properties,
        additionalProperties: false,
        maxProperties: keys.length,
      };
      return { ...value, properties: keep, additionalProperties: false };
    }

    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry, key)]));
  };

  return { ...tool, schema: rewrite(tool.schema) };
};

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
    const propertyCount = Object.keys(value).length;
    if (Number.isFinite(schema.minProperties) && propertyCount < schema.minProperties) {
      return `${path} must contain at least ${schema.minProperties} propert${schema.minProperties === 1 ? "y" : "ies"}.`;
    }
    if (Number.isFinite(schema.maxProperties) && propertyCount > schema.maxProperties) {
      return `${path} must contain at most ${schema.maxProperties} properties.`;
    }

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
        if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
          const error = validateAgainstSchema(schema.additionalProperties, entry, propertyPath(path, key));
          if (error) return error;
        }
        continue;
      }

      const error = validateAgainstSchema(childSchema, entry, propertyPath(path, key));
      if (error) return error;
    }
  }

  return "";
};

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

// --- Lenient payload shapes (ported from the abdulrahman-2005 fork) ----------
// Local and gateway models answer a jump in shapes the schema never asked for:
// the result wrapped in an envelope, a singular "event", snake_case or synonym
// keys, impacts doubled inside an "impacts"/"effects" wrapper, marker builds
// written flat with latitude/longitude. One rejected key fails the WHOLE
// payload and costs the turn, so the shapes are rewritten to the canonical
// ones before validation. Nothing is ever invented: an answer without events
// stays without events and fails validation as it should.

const isPlainRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

const firstDefinedKey = (target, keys) => {
  if (!isPlainRecord(target) || !Array.isArray(keys)) return undefined;
  for (const key of keys) {
    if (target[key] !== undefined) return target[key];
  }
  return undefined;
};

const coordinateNumber = (value) => {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().replace(",", ".").replace(/[°º]\s*[NSEW]?$/i, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : value;
};

const normalizeMarkerOperationShape = (entry) => {
  if (!isPlainRecord(entry)) return entry;
  const rawOp = String(entry.op ?? entry.action ?? "").trim().toLowerCase();
  const op = rawOp === "found" || rawOp === "create" || rawOp === "add"
    ? "build"
    : rawOp === "destroy" || rawOp === "delete"
      ? "remove"
      : rawOp;

  if (op === "build" || (!op && isPlainRecord(entry.marker))) {
    const source = isPlainRecord(entry.marker) ? entry.marker : entry;
    // Where it goes: in words (`at`, or the words a model reaches for instead),
    // or as coordinates. A coordinate that was never given is left OUT rather
    // than written as undefined — the schema reads an undefined `lng` as "not a
    // number" and would fail the op, and a build placed in words has none.
    const where = firstDefinedKey(source, ["at", "place", "where", "location"]);
    const lng = coordinateNumber(firstDefinedKey(source, ["lng", "lon", "longitude"]));
    const lat = coordinateNumber(firstDefinedKey(source, ["lat", "latitude"]));
    const marker = {
      ...(firstDefinedKey(source, ["id", "markerId"]) ? { id: firstDefinedKey(source, ["id", "markerId"]) } : {}),
      name: firstDefinedKey(source, ["name", "title"]),
      kind: firstDefinedKey(source, ["kind", "type"]) || "landmark",
      ...(firstDefinedKey(source, ["ownerCode", "owner", "code"]) !== undefined
        ? { ownerCode: firstDefinedKey(source, ["ownerCode", "owner", "code"]) }
        : {}),
      ...(typeof where === "string" && where.trim() ? { at: where } : {}),
      ...(lng !== undefined ? { lng } : {}),
      ...(lat !== undefined ? { lat } : {}),
      ...(firstDefinedKey(source, ["note", "description"]) !== undefined
        ? { note: firstDefinedKey(source, ["note", "description"]) }
        : entry.note !== undefined ? { note: entry.note } : {}),
      ...(firstDefinedKey(source, ["foundedAt", "date"]) !== undefined
        ? { foundedAt: firstDefinedKey(source, ["foundedAt", "date"]) }
        : {}),
    };
    return { op: "build", marker };
  }

  if (op === "remove") {
    const source = isPlainRecord(entry.marker) ? entry.marker : entry;
    return {
      op,
      ...(firstDefinedKey(source, ["id", "markerId"]) ? { markerId: firstDefinedKey(source, ["id", "markerId"]) } : {}),
      ...(firstDefinedKey(source, ["name", "title"]) ? { name: firstDefinedKey(source, ["name", "title"]) } : {}),
      ...(entry.note !== undefined ? { note: entry.note } : {}),
    };
  }

  if (op === "rename") {
    const source = isPlainRecord(entry.marker) ? entry.marker : entry;
    return {
      op,
      ...(firstDefinedKey(source, ["id", "markerId"]) ? { markerId: firstDefinedKey(source, ["id", "markerId"]) } : {}),
      ...(firstDefinedKey(source, ["name", "from", "oldName"]) ? { name: firstDefinedKey(source, ["name", "from", "oldName"]) } : {}),
      newName: firstDefinedKey(source, ["newName", "to"]),
      ...(entry.note !== undefined ? { note: entry.note } : {}),
    };
  }

  return { ...entry, ...(op ? { op } : {}) };
};

// A spawned unit's `status` is a four-word enum, and its `posture` an eight-word
// one, and models mix them up: a field report's DeepSeek jump spawned a carrier
// with status "holding" — a posture — and that one word failed the whole month
// to the canned fallback. A posture word written as a status moves across (when
// no posture was given); any other unknown status is dropped, since the field is
// optional and the engine assigns one anyway.
const UNIT_STATUSES = new Set(unitSchema.properties.status.enum);
const UNIT_POSTURES = new Set(unitSchema.properties.posture.enum);

const normalizeUnitOperationShape = (entry) => {
  if (!isPlainRecord(entry) || !isPlainRecord(entry.unit) || entry.unit.status === undefined) return entry;
  const status = String(entry.unit.status ?? "").trim().toLowerCase();
  if (UNIT_STATUSES.has(status)) return { ...entry, unit: { ...entry.unit, status } };
  const { status: _status, ...unit } = entry.unit;
  if (UNIT_POSTURES.has(status) && unit.posture === undefined) unit.posture = status;
  return { ...entry, unit };
};

// A chat's countries are names. A model working from an older prompt copy (or
// the one older schema) writes {"name": "France"} or {"code": "France"}; both
// read as "France". Anything else in the entry is left as it is.
const normalizeChatShape = (entry) => {
  if (!isPlainRecord(entry) || !Array.isArray(entry.countries)) return entry;
  const countries = entry.countries
    .map((country) => (isPlainRecord(country) ? String(country.name ?? country.code ?? "").trim() : country))
    .filter((country) => typeof country !== "string" || country);
  return { ...entry, countries };
};
const normalizeChatList = (value) => (Array.isArray(value) ? value.map(normalizeChatShape) : value);

const PAYLOAD_IMPACT_ARRAYS = [
  "actionIds",
  "createdChats",
  "polityChanges",
  "regionTransfers",
  "regionControlOps",
  "regionClaims",
  "unitOps",
  "markerOps",
  "projectOps",
];

const flattenImpactWrappers = (value) => {
  let impacts = { ...value };
  for (let depth = 0; depth < 4; depth += 1) {
    const nested = [impacts.impacts, impacts.effects, impacts.changes].find(isPlainRecord);
    delete impacts.impacts;
    delete impacts.effects;
    delete impacts.changes;
    if (!nested) break;

    const merged = { ...nested, ...impacts };
    for (const field of PAYLOAD_IMPACT_ARRAYS) {
      const nestedItems = Array.isArray(nested[field]) ? nested[field] : [];
      const outerItems = Array.isArray(impacts[field]) ? impacts[field] : [];
      if (nestedItems.length || outerItems.length) merged[field] = [...nestedItems, ...outerItems];
    }
    impacts = merged;
  }
  return impacts;
};

const normalizeEventShape = (entry) => {
  if (!isPlainRecord(entry)) return entry;
  const event = { ...entry };
  const aliases = {
    date: ["occurredAt", "eventDate", "when"],
    title: ["headline", "name"],
    description: ["details", "narrative", "summary"],
    impacts: ["effects", "changes"],
  };
  for (const [field, fieldAliases] of Object.entries(aliases)) {
    const aliasValue = firstDefinedKey(event, fieldAliases);
    if (event[field] === undefined && aliasValue !== undefined) event[field] = aliasValue;
    for (const alias of fieldAliases) delete event[alias];
  }

  if (isPlainRecord(event.impacts)) {
    const impacts = flattenImpactWrappers(event.impacts);
    const impactAliases = {
      regionTransfers: ["transfers", "territoryChanges"],
      regionControlOps: ["controlOps", "controlChanges"],
      regionClaims: ["claims"],
      polityChanges: ["polities", "countryChanges"],
      unitOps: ["units", "unitOperations"],
      markerOps: ["markers", "markerOperations"],
      spyOps: ["spies", "spyOperations", "espionageOps", "agentOps"],
      createdChats: ["chats", "diplomaticChats"],
      projectOps: ["projects", "projectOperations"],
    };
    for (const [field, fieldAliases] of Object.entries(impactAliases)) {
      const aliasValue = firstDefinedKey(impacts, fieldAliases);
      if (impacts[field] === undefined && aliasValue !== undefined) impacts[field] = aliasValue;
      for (const alias of fieldAliases) delete impacts[alias];
    }
    if (Array.isArray(impacts.markerOps)) {
      impacts.markerOps = impacts.markerOps.map(normalizeMarkerOperationShape);
    }
    if (Array.isArray(impacts.unitOps)) {
      impacts.unitOps = impacts.unitOps.map(normalizeUnitOperationShape);
    }
    if (Array.isArray(impacts.createdChats)) impacts.createdChats = normalizeChatList(impacts.createdChats);
    event.impacts = impacts;
  }
  return event;
};

// The between-rounds pulse. `chat` is an object or null, and some models say
// "nobody writes" in words instead — "Quiet pulse — submitting no contact." — which
// failed both attempts of the pulse on nothing but the spelling of silence. A
// sentence there is never a usable note (it has no speaker and no countries), so
// it reads as the null it means.
const normalizeIdleDiplomacyShape = (value) => {
  if (!isPlainRecord(value)) return value;
  const candidate = { ...value };
  if (typeof candidate.chat === "string") candidate.chat = null;
  if (isPlainRecord(candidate.chat)) candidate.chat = normalizeChatShape(candidate.chat);
  if (Array.isArray(candidate.unitOps)) candidate.unitOps = candidate.unitOps.map(normalizeUnitOperationShape);
  return candidate;
};

// The board prompt lists every running effort as `Operation "Name" [id proj-1]`,
// and a model reads that label as the field's name: a field report's DeepSeek
// wrote `"id"` instead of `projectId`, which held the whole turn. The reducer has
// always read `projectId || id` (gameState.js normalizeProjectOp); only the
// schema refused it.
const normalizeProjectsShape = (value) => {
  if (!isPlainRecord(value) || !Array.isArray(value.projectOps)) return value;
  return {
    ...value,
    projectOps: value.projectOps.map((entry) => {
      if (!isPlainRecord(entry) || entry.id === undefined) return entry;
      const { id, ...op } = entry;
      return op.projectId === undefined ? { ...op, projectId: id } : op;
    }),
  };
};

// The stat sheet's version field is the runtime's to fill ("the runtime fills
// this when omitted", says its description) — so a missing, null or zero value
// from the model is filled here, before the schema sees it, rather than
// costing the sheet its attempt.
const normalizeCountryStatSheetShape = (value) => {
  if (!isPlainRecord(value)) return value;
  const version = Number(value.statsSchemaVersion);
  if (Number.isInteger(version) && version >= 1) return value;
  return { ...value, statsSchemaVersion: 1 };
};

export const normalizeGameplayPayload = (taskKey, value) => {
  if (taskKey === "idleDiplomacy") return normalizeIdleDiplomacyShape(value);
  if (taskKey === "projects") return normalizeProjectsShape(value);
  if (taskKey === "countryStatSheet") return normalizeCountryStatSheetShape(value);
  if (taskKey !== "jumpForward" && taskKey !== "autoJumpForward") return value;
  if (!isPlainRecord(value)) return value;

  let source = value;
  for (const wrapper of ["result", "output", "payload", "data"]) {
    const nested = value[wrapper];
    if (isPlainRecord(nested) && ["events", "event", "timeline", "stopDate", "stop_date"].some((key) => nested[key] !== undefined)) {
      source = nested;
      break;
    }
  }

  const candidate = { ...source };
  const eventAlias = firstDefinedKey(candidate, ["timeline", "newEvents", "generatedEvents"]);
  if (!Array.isArray(candidate.events) && Array.isArray(eventAlias)) candidate.events = eventAlias;
  if (!Array.isArray(candidate.events) && isPlainRecord(candidate.event)) candidate.events = [candidate.event];
  delete candidate.event;
  delete candidate.timeline;
  delete candidate.newEvents;
  delete candidate.generatedEvents;
  // A time skip no longer writes a scene: a scene is played only from an
  // interactive event a skip offers (runtime/interactiveOffer.js), and the jump
  // schema has no `catalyst`, the field skips used to fill. A model still
  // answering in that shape — an edited prompt passage, a habit — has the field
  // dropped here rather than costing the turn a retry over something nothing
  // reads.
  delete candidate.catalyst;

  const stopDateAlias = firstDefinedKey(candidate, ["stop_date", "endDate", "targetDate"]);
  const summaryAlias = firstDefinedKey(candidate, ["overview", "periodSummary"]);
  const clearActionsAlias = firstDefinedKey(candidate, ["clear_actions", "actionsResolved"]);
  if (candidate.stopDate === undefined && stopDateAlias !== undefined) candidate.stopDate = stopDateAlias;
  if (candidate.summary === undefined && summaryAlias !== undefined) candidate.summary = summaryAlias;
  if (candidate.clearActions === undefined && clearActionsAlias !== undefined) candidate.clearActions = clearActionsAlias;
  delete candidate.stop_date;
  delete candidate.endDate;
  delete candidate.targetDate;
  delete candidate.overview;
  delete candidate.periodSummary;
  delete candidate.clear_actions;
  delete candidate.actionsResolved;

  if (Array.isArray(candidate.events)) candidate.events = candidate.events.map(normalizeEventShape);
  if (Array.isArray(candidate.diplomaticOutreach)) candidate.diplomaticOutreach = normalizeChatList(candidate.diplomaticOutreach);
  return candidate;
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
    if (!hasEvents && !hasSummary) {
      return {
        valid: false,
        error: "Jump payload must contain at least one event or a nonempty summary.",
      };
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
    interactiveCreation: ["title", "premise", "opening"],
    interactiveExecutor: ["summary"],
    interactiveSummary: ["title", "description", "importance"],
    gameMaster: ["summary"],
  };
  for (const field of requiredTextByTask[taskKey] ?? []) {
    if (!value[field].trim()) {
      return { valid: false, error: `$.${field} must not be empty.` };
    }
  }

  if (taskKey === "interactiveCreation") {
    const choiceError = validateDistinctChoices(value.choices, "$.choices");
    if (choiceError) return { valid: false, error: choiceError };
  }

  if (taskKey === "interactiveExecutor") {
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
    if (value.territorialComponents.length === 0 && value.territorialScope !== "nonterritorial") {
      return { valid: false, error: "$.territorialComponents may be empty only when $.territorialScope is nonterritorial." };
    }
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
