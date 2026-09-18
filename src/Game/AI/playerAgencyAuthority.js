const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();


const activeCanonicalStorylineIds = (world = {}) => {
  const ids = new Set();
  for (const storyline of Array.isArray(world?.storylines) ? world.storylines : []) {
    const id = clean(storyline?.id);
    if (!id) continue;
    const status = clean(storyline?.status).toLowerCase();
    if (status === "resolved") continue;
    ids.add(id);
  }
  return ids;
};

// Native provenance repair for an already-established event <-> storyline binding.
//
// The model may correctly classify an event as a consequence of an existing
// canonical process but omit the opaque process id from agency.authorityRef.
// Once native storyline bookkeeping has established exactly one existing
// storyline as the event's process, JS can safely carry that id into the
// structural authority record. This does NOT infer causality from prose, create
// a new process, or authorize fresh sovereign discretion. Ambiguous/unbound
// cases remain untouched so the normal authority validator can reject them.
export const propagateCanonicalProcessAuthorityRefs = (candidate, {
  world = {},
  includeStorylineUpdates = true,
} = {}) => {
  if (!candidate || typeof candidate !== "object") {
    return { applied: 0, bindings: [], ambiguous: [] };
  }

  const events = Array.isArray(candidate.events) ? candidate.events : [];
  if (!events.length) return { applied: 0, bindings: [], ambiguous: [] };

  const existingStorylineIds = activeCanonicalStorylineIds(world);
  if (!existingStorylineIds.size) {
    return { applied: 0, bindings: [], ambiguous: [] };
  }

  const linkedByEventIndex = new Map();
  const addLinked = (eventIndex, storylineId) => {
    if (!Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex >= events.length) return;
    const id = clean(storylineId);
    if (!id || !existingStorylineIds.has(id)) return;
    if (!linkedByEventIndex.has(eventIndex)) linkedByEventIndex.set(eventIndex, new Set());
    linkedByEventIndex.get(eventIndex).add(id);
  };

  // Normalized storyline updates are native bookkeeping evidence. A single
  // existing update may legitimately point at several events; each event still
  // receives only that one process id.
  if (includeStorylineUpdates) {
    for (const update of Array.isArray(candidate.storylineUpdates) ? candidate.storylineUpdates : []) {
      const storylineId = clean(update?.id);
      if (!existingStorylineIds.has(storylineId)) continue;
      for (const value of Array.isArray(update?.eventIndexes) ? update.eventIndexes : []) {
        const eventIndex = Number(value);
        if (Number.isInteger(eventIndex)) addLinked(eventIndex, storylineId);
      }
    }
  }

  let applied = 0;
  const bindings = [];
  const ambiguous = [];

  candidate.events = events.map((event, eventIndex) => {
    if (!event || typeof event !== "object") return event;
    const agency = event?.agency;
    if (!agency || typeof agency !== "object" || Array.isArray(agency)) return event;
    if (clean(agency.authority).toLowerCase() !== "canonical-process") return event;
    if (clean(agency.authorityRef)) return event;

    // canonical-process is only valid for an already-authorized consequence.
    // Do not help an invalid payload that is still exercising sovereign choice;
    // the authority validator must continue to reject that case.
    if (clean(agency.sovereignPolity)) return event;
    if (Array.isArray(agency.sovereignActors) && agency.sovereignActors.length) return event;

    const candidates = new Set(linkedByEventIndex.get(eventIndex) || []);
    for (const storylineId of Array.isArray(event?.storylineIds) ? event.storylineIds : []) {
      const id = clean(storylineId);
      if (existingStorylineIds.has(id)) candidates.add(id);
    }

    if (candidates.size !== 1) {
      if (candidates.size > 1) {
        ambiguous.push({
          eventIndex,
          eventId: clean(event?.id),
          storylineIds: [...candidates].sort(),
        });
      }
      return event;
    }

    const authorityRef = [...candidates][0];
    applied += 1;
    bindings.push({
      eventIndex,
      eventId: clean(event?.id),
      authorityRef,
    });

    return {
      ...event,
      agency: {
        ...agency,
        authorityRef,
      },
    };
  });

  return { applied, bindings, ambiguous };
};

export const PLAYER_AGENCY_AUTHORITY_VERSION = "5.0.0-native-provenance-owner";

export const buildPlayerAgencyAuthorityDirective = ({ playerPolity = "", includeEventContract = true } = {}) => {
  const player = clean(playerPolity) || "the player polity";
  const lines = [
    "[Player Agency — Structural Authority Boundary]",
    `${player} is human-controlled. Protect agency by decision ownership/provenance, not by guessing policy topics from prose.`,
    `The world may create pressure, proposals, delegated routine agency activity, endogenous domestic processes, independent domestic actions, external actions, shocks, constraints, and already-authorized consequences around ${player}. It may not originate a fresh sovereign choice for ${player}.`,
    "A fresh sovereign choice for the player is allowed only when its authority already exists in canon before this event: a queued player action, or a player-authored diplomatic commitment already in the chat ledger. The model identifies the semantic authority class; native code resolves the opaque canonical id.",
    "Event decision ownership/provenance is NATIVE-OWNED CANONICAL STATE. event.agency is only an optional semantic hint from generation; native code reconstructs or normalizes provenance from the event, current world, and existing authority registry. Never invent opaque authority ids or use agency labels as permission.",
    "authorityRef and impacts.actionIds are NATIVE-OWNED FOREIGN KEYS. Never invent, guess, synthesize, or copy placeholder ids such as action-1. Leave them blank/empty in generated output; native provenance resolution binds exact canonical ids when justified.",
    "Inbound/NPC-authored diplomacy is NOT player commitment authority. A request, invitation, proposal, warning, or draft sent to the player may create pressure or an open choice, but silence/non-response is never consent. Only a message actually authored by the human polity may be cited as player-commitment authority.",
    "Joint action does not dilute sovereignty. A treaty, memorandum, declaration, coalition decision, joint operation, or other multi-polity act exercises every participating government's authority. Enumerate every sovereign participant structurally even when a collective body or another country is the principal.",
    "An already-existing canonical process may produce consequences without asking the player again, but it does NOT itself grant fresh sovereign discretion. Represent a process consequence with authority canonical-process and leave sovereignPolity blank; if a new state choice is still required, stop at the pressure/proposal/choice.",
    "PLAYER CONTROL IS SOVEREIGN POLITICAL WILL, NOT MICROMANAGEMENT. A border guard, police unit, technical agency, local commander, court, opposition party, protest movement, civil service, business, accident, scandal or other domestic process may act or occur without a fresh player order when it remains inside existing law/mandate/posture and does not create new sovereign policy.",
    "delegated-routine means a subordinate public body/official executing an already-existing operational/legal mandate. It MUST leave sovereignPolity/sovereignActors empty, name jurisdictionPolity, and state mandateBasis. It cannot create a treaty/commitment, sanctions/recognition, national strategic posture, mobilization/major deployment, major budget/law change, territorial choice, war/coercive initiation, or another fresh sovereign policy. Native validation decides this from the event itself; the label is not permission.",
    "endogenous-domestic means a domestic process that is not the government exercising sovereign choice: protest/strike, scandal, court ruling, opposition maneuver, accident, bureaucratic failure, local crisis, public controversy and similar. It MUST leave sovereignPolity/sovereignActors empty and name jurisdictionPolity. If the event text actually contains a fresh government/parliament sovereign decision, native validation rejects the disguise.",
    "External polities and institutions remain fully autonomous; an action directed AT the player is not a player decision merely because the player is affected.",
  ];

  if (includeEventContract) {
    lines.push(
      "event.actors is OPTIONAL SEMANTIC evidence and is preferred when a development has identifiable active participants. List who actually acts/chooses/causes the development, using canonical polity/institution names when known; do NOT list mere targets, locations, observers, or contextual mentions. This is not authority and never contains opaque ids.",
      "event.agency is OPTIONAL provenance evidence, not canonical truth. In normal world generation OMIT event.agency by default and let native Javascript ground it from event semantics, event.actors, current canon, and existing player authority. Supply agency only when the task explicitly requires provenance detail; native Javascript remains authoritative and may reconstruct, canonicalize, or reject it:",
      "- principal: who/what caused the event.",
      "- principalKind: polity | institution | domestic-actor | domestic-process | collective-process | organization | person | exogenous-process. For delegated-routine, institution may mean a subordinate domestic state body (for example a border guard, armed-forces command, ministry agency, regulator or emergency service); canonical international/collective institutions must use their own-right institutional authority path.",
      "- sovereignPolity: the FULL polity name whose sovereign state discretion is exercised; blank when no sovereign state is making a discretionary choice. This is not the event location or target.",
      "- authority: autonomous | player-order | player-commitment | canonical-process | delegated-routine | endogenous-domestic | independent | external-consequence.",
      "- authorityRef: ALWAYS blank in model output. Native code writes the exact canonical action/message/process id after semantic binding.",
      "- jurisdictionPolity: for delegated-routine/endogenous-domestic, the polity where the subordinate/domestic process occurs; otherwise blank. This is not sovereign authority.",
      "- mandateBasis: for delegated-routine, the already-existing mandate/standing procedure being executed; otherwise blank. Native code still rejects sovereign-policy content even if this string claims a mandate.",
      "- sovereignActors: COMPLETE list of every sovereign polity whose discretion the event exercises. Each row is {polity, authority, authorityRef}. Include every co-signatory and joint state participant. Empty only when no sovereign government makes a fresh choice. The first row mirrors sovereignPolity/authority/authorityRef.",
      "For a joint treaty, declaration, alliance decision, newly established intergovernmental body, or other shared sovereign choice, event.actors should list the participating governments only. Native grounding uses that semantic participant set to reconstruct joint authority; countries merely affected or discussed are not actors.",
      "autonomous means an actor exercising its OWN discretion: a government requires sovereignActors; a canonical institution (use its exact ledger name/id), organization, domestic actor or person acting in its own right leaves sovereignPolity and sovereignActors blank/empty. independent is also valid for non-sovereign actors and bounded collective-process events that exercise no fresh sovereign discretion. Institutional membership/leadership does not mean every member government makes a fresh choice. Any fresh joint government decision MUST still enumerate all sovereign participants, including the player.",
      "Delegated routine execution is not new sovereign discretion: use delegated-routine only for bounded subordinate activity that stays inside an existing mandate/posture/budget/standing cooperation and does not create new policy. Use endogenous-domestic for domestic events/processes that are not the government choosing policy. Consequences of an already-authorized canonical order/process may still use canonical-process. Do not invent a mandate or treat institution membership as delegated permission to choose for the player. Use external-consequence only with an exogenous-process principal for non-discretionary shocks. No authority class may disguise a state choice.",
      "If you are unsure of provenance, OMIT event.agency rather than fabricating a polity, institution, mandate, authorityRef, or player authorization. Native code will resolve unambiguous ownership and may drop one independent irreparable candidate; uncertainty is safer than invented authority.",
      `For ${player}: EVERY sovereignActors row for that polity must use player-order or player-commitment. Use player-order only when the event semantically resolves a currently queued player action; use player-commitment only when it semantically enacts an already player-authored diplomatic commitment. Leave authorityRef blank and impacts.actionIds empty: native code binds the exact canonical ids and rejects ambiguous or unsupported matches. autonomous sovereign authority is invalid even when ${player} is only a co-signatory or secondary participant. canonical-process is only an already-existing process consequence with sovereignPolity blank and sovereignActors empty; native code binds its process id too.`,
    );
  }

  return lines.join("\n");
};
