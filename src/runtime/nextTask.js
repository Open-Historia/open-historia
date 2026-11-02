// An await on something already settled does not: the browser draws only between tasks.
// A message, not a timer: timers in a window in the background run once a second at most.
export const nextTask = () => new Promise((resolve) => {
  if (typeof MessageChannel !== "function") {
    setTimeout(resolve, 0);
    return;
  }
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => {
    port1.close();
    resolve();
  };
  port2.postMessage(null);
});
