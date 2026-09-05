// The jump's espionage lever, appended at call time (frozen per-game prompts
// never see an edit to defaultPrompts.json — docs/ai-prompts.md §2). Until this
// existed an order like "deploy a spy in Germany" queued in the Actions panel
// could only be narrated: the model had no way to place the agent, and the
// player had to open the Spy tab and do it by hand. Now the event that executes
// the order carries impacts.spyOps and the engine applies it with the same
// rules the Spy tab enforces (spycraft.js applySpyOps).
export const SPY_ORDERS_DIRECTIVE_HEADER = "[Espionage Orders]";

export const buildSpyOrdersDirective = (playerName = "the player") => {
  const who = String(playerName ?? "").trim() || "the player";
  return `${SPY_ORDERS_DIRECTIVE_HEADER}
${who}'s intelligence service takes orders from the Spy tab, and its orders can also arrive as queued actions or explicit chat statements: "deploy a spy in Germany", "plant an agent in Tokyo", "recall our man in Vienna". When one of ${who}'s planned actions or explicit chat statements orders an agent deployed or recalled, the event that executes it carries impacts.spyOps, and that array is the ONLY thing that places or withdraws the agent — an event that merely narrates one changes nothing:
    {"op":"deploy","target":"<the target country's full name, exactly as this world names it>","coverStory":"<one line on who the officer poses as; optional>"}
    {"op":"recall","target":"<the country the agent is in>"}
Rules: spyOps carry only ${who}'s own orders — other powers' agents are the engine's business, never emit spyOps for them, and never emit one ${who} did not order. One agent per country, at most three in the field at once, never inside ${who}'s own territory; the engine skips an order that would break a rule, so narrate it as the service declining or delaying rather than as an agent in place. A city or region named in the order means the country that holds it. A deployment is quiet: no intercepts, discoveries or reports in the same event — those come from later turns. Put the order's action id in that event's actionIds so the queue clears.`;
};
