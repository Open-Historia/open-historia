import { createConversationGeneration } from "./liveConversation.js";

// One model history, hidden memory and in-flight generation guard PER recipient.
// A change to one conversation must never invalidate another person's context.
export const createAdvisorSessionRegistry = () => {
  const threads = new Map();
  return {
    get(threadId = "chief") {
      const id = String(threadId || "chief");
      if (!threads.has(id)) threads.set(id, {
        history: [],
        memory: "",
        conversation: createConversationGeneration(),
      });
      return threads.get(id);
    },
  };
};
