export const GAMEPLAY_PROMPT_DEFAULTS = {
  actions: `You plan strategic options for a turn-based grand strategy simulation.
Player polity: \${playerPolity}
Current date: \${date}
Language: \${language}
Difficulty: \${difficulty}
World briefing: \${worldBeforeRoundOne}
Simulation rules: \${simulationRules}
World snapshot: \${worldSummary}
Recent events: \${recentEvents}
Planned actions: \${plannedActions}
Chats: \${chatSummary}

Return JSON only:
{"topics":[{"title":"","description":"","actions":[{"title":"","text":"","kind":"action"}]}]}

Make 4-7 topics, each with 2-4 concrete actions. Cover diplomacy, internal stability, military posture, economics, and one medium-term objective.`,
  descriptionToAction: `You convert a raw player intent into one structured in-game command.
Player polity: \${playerPolity}
Current date: \${date}
Language: \${language}
World briefing: \${worldBeforeRoundOne}
Simulation rules: \${simulationRules}
World snapshot: \${worldSummary}
Recent events: \${recentEvents}
Other planned actions: \${plannedActions}
Raw player intent: \${actionInput}

Return JSON only:
{"kind":"action","title":"","text":"","invitees":[],"chatStarter":""}

Only output kind="chat" if the player clearly wants negotiations, outreach, or a conference. Preserve tone and intent while adding practical specificity.`,
  jumpForward: `You simulate the world between turns in a grand strategy game.
Player polity: \${playerPolity}
Origin date: \${date}
Target date: \${targetDate}
Language: \${language}
Difficulty: \${difficulty}
World briefing: \${worldBeforeRoundOne}
Simulation rules: \${simulationRules}
World snapshot: \${worldSummary}
Recent events: \${recentEvents}
Planned actions: \${plannedActions}
Chats: \${chatSummary}

Return JSON only:
{"summary":"","stopDate":"YYYY-MM-DD","clearActions":true,"events":[{"date":"YYYY-MM-DD","title":"","description":"","importance":"minor","kind":"world","playerRelated":false,"notable":false,"impacts":{"regionTransfers":[],"polityChanges":[],"createdChats":[]}}],"catalyst":{"title":"","premise":"","opening":"","choices":[]}}

Generate 3-8 meaningful events, not filler. Never invent player actions the player did not order. Make the final event notable if it deserves immediate attention.`,
  autoJumpForward: `You simulate the world between turns and stop at the first especially notable or player-relevant development.
Player polity: \${playerPolity}
Origin date: \${date}
Upper target date: \${targetDate}
Language: \${language}
Difficulty: \${difficulty}
World briefing: \${worldBeforeRoundOne}
Simulation rules: \${simulationRules}
World snapshot: \${worldSummary}
Recent events: \${recentEvents}
Planned actions: \${plannedActions}
Chats: \${chatSummary}

Return JSON only in the same shape as jumpForward.

Stop early when the next event is strategically notable, directly relevant to the player, or a natural catalyst or diplomatic opening.`,
  nextSpeaker: `You choose the next speaker in an ongoing diplomatic chat.
Player polity: \${playerPolity}
Current date: \${date}
Language: \${language}
Participants: \${chatParticipants}
Most recent speaker: \${lastSpeaker}
Chat history: \${chatHistory}

Return JSON only:
{"nextSpeaker":"exact participant name"}

Never choose the same speaker who just spoke. Prefer whoever was directly addressed or challenged most recently.`,
  eventConsolidator: `You compress campaign history for later simulation.
Player polity: \${playerPolity}
Current date: \${date}
Language: \${language}
Events: \${eventsToConsolidate}
Chats: \${chatsToConsolidate}

Return JSON only:
{"summary":""}

Keep territorial changes, major diplomacy, and continuity-critical developments.`,
  catalystCreation: `You design an immersive catalyst scene for a strategy game.
Player polity: \${playerPolity}
Current date: \${date}
Language: \${language}
World briefing: \${worldBeforeRoundOne}
Simulation rules: \${simulationRules}
Recent events: \${recentEvents}
Planned actions: \${plannedActions}

Return JSON only:
{"title":"","premise":"","opening":"","choices":[]}

Make it a vivid, specific scene tied to the most relevant recent development.`,
  catalystExecutor: `You continue an in-progress catalyst scene.
Player polity: \${playerPolity}
Current date: \${date}
Language: \${language}
Premise: \${catalystPremise}
Opening: \${catalystOpening}
Chosen action: \${catalystChoice}

Return JSON only:
{"summary":"","nextChoices":[],"resolved":false}`,
  catalystSummary: `You turn a catalyst scene into one short campaign-facing summary.
Player polity: \${playerPolity}
Current date: \${date}
Language: \${language}
Premise: \${catalystPremise}
History: \${catalystHistory}

Return JSON only:
{"title":"","description":"","importance":"major"}`,
  gameMaster: `You apply a direct GM request to the map and world state.
Player polity: \${playerPolity}
Current date: \${date}
Language: \${language}
World briefing: \${worldBeforeRoundOne}
Simulation rules: \${simulationRules}
World snapshot: \${worldSummary}
Request: \${gameMasterRequest}

Return JSON only:
{"summary":"","impacts":{"regionTransfers":[],"polityChanges":[]}}

Obey the request as closely as possible and return only the change set.`,
};
