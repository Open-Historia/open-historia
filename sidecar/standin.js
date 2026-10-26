const GEMINI = "generativelanguage.googleapis.com";

const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

globalThis.__ohStandIns = globalThis.__ohStandIns ?? [];

export const addStandIn = (answer) => {
  globalThis.__ohStandIns.push(answer);
};

const textOf = (body) => [...(body.system_instruction?.parts ?? []), ...(body.contents ?? []).flatMap((entry) => entry.parts ?? [])]
  .map((part) => part.text ?? "")
  .join("\n");

export const installStandInModel = ({ expected }) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = undefined) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : String(input?.url ?? "");
    if (!url.includes(GEMINI)) return realFetch(input, init);
    let body = {};
    try {
      body = JSON.parse(String(init?.body ?? "{}"));
    } catch {
      body = {};
    }
    const tool = (body.tools?.[0]?.functionDeclarations ?? []).find((entry) => String(entry.name).startsWith("submit_"))?.name ?? "";
    const streamed = url.includes("streamGenerateContent");
    const { origin, target, country } = expected();
    let args = null;
    let text = null;
    if (tool === "submit_jump_result" && origin && target) {
      const who = country || "The government";
      args = {
        stopDate: target,
        summary: "A quiet stretch: markets steady, ministers travel, storms at sea.",
        events: [
          { date: addDays(origin, 2), title: `${who} opens a new rail line`, description: `${who} opens a long-planned rail line between two regional capitals.`, importance: "moderate", kind: "world", playerRelated: true },
          { date: addDays(origin, 5), title: "Oil prices slide further", description: "Brent falls again as producers keep pumping.", importance: "moderate", kind: "world", playerRelated: false },
          { date: addDays(origin, 9), title: "Storms batter the North Sea coast", description: "A winter storm floods ports along the North Sea.", importance: "minor", kind: "world", playerRelated: false },
          { date: target, title: `${who} hosts a regional summit`, description: `Leaders of neighbouring states meet in the capital of ${who}.`, importance: "major", kind: "world", playerRelated: true },
        ],
      };
    } else if (tool === "submit_actions") {
      args = { topics: [{ title: "Steady the budget", description: "Shore up the position at home.", actions: [{ title: "Convene the cabinet", text: "Convene the cabinet on the budget." }] }] };
    } else {
      for (const answer of globalThis.__ohStandIns) {
        const found = answer({ tool, body, text: textOf(body), url, expected: expected() });
        if (found && typeof found === "object") {
          if ("args" in found) args = found.args;
          if ("text" in found) text = found.text;
          break;
        }
      }
    }
    if (args === null && text === null) {
      return new Response(JSON.stringify({ error: { code: 400, message: "stand-in" } }), { status: 400, headers: { "content-type": "application/json" } });
    }
    const part = args !== null ? { functionCall: { name: tool, args } } : { text };
    const frame = { candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP" }] };
    return new Response(streamed ? `data: ${JSON.stringify(frame)}\n\n` : JSON.stringify(frame), {
      status: 200,
      headers: { "content-type": streamed ? "text/event-stream" : "application/json" },
    });
  };
};
