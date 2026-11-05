// When Enter in a composer sends what was typed: the advisor, a diplomacy
// thread, the Actions composer and the standing-goal editor all ask here.
//
// Enter sends and Shift+Enter starts a new line, except:
//   - on a touch screen (mobileUi.js useTouchPrimary), whose keyboard has no
//     Shift+Enter: Enter is a new line there, and the send button sends;
//   - while an input method is composing (Chinese, Japanese, Korean): that
//     Enter confirms the word being written. `isComposing` is on the native
//     event; Safari reports the key as 229 instead.
// A message sent by accident spends a request, and most players are on a
// free-tier quota.
//
// Import-free, so its tests run in a bare checkout.
export const isComposerSendKey = (event, { touch = false } = {}) => {
  if (!event || event.key !== "Enter" || event.shiftKey || touch) return false;
  const native = event.nativeEvent ?? event;
  return !(native.isComposing || event.isComposing || native.keyCode === 229 || event.keyCode === 229);
};
