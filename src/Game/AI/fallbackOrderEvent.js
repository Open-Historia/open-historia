// A fallback turn has no model-validated outcome for a normal queued order.
// Do not counterfeit an actionIds receipt: settleOrders treats it as fulfilled.
import { actionNeedsEvent } from "./playerFocus.js";
import { fallbackTurnText } from "../../runtime/fallbackTurnText.js";

export const fallbackOrderEventFields = (action, country) => {
  const unresolved = actionNeedsEvent(action);
  const type = action?.kind === "chat" ? "chat" : "order";
  const params = { country, order: String(action?.title ?? "") };
  const id = String(action?.id ?? "").trim();
  return {
    title: fallbackTurnText(unresolved ? "pendingOrderTitle" :
      type === "chat" ? "chatEventTitle" : "orderEventTitle", params),
    description: fallbackTurnText(unresolved ? "pendingOrderDescription" :
      type === "chat" ? "chatEventDescription" : "orderEventDescription", params),
    actionIds: unresolved || !id ? [] : [id],
  };
};
