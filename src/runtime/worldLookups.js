// A world cannot change during one synchronous read of it, yet building an AI prompt asks it the same whole-world
// questions thousands of times: every region's owner for each name looked up, every polity for each government.
// On the modern world that froze the page for half a second on a fast computer, and for seconds on a phone.
//
// readingWorld marks such a read, and inside it lookedUp keeps each answer. Outside one, nothing is kept: a world
// may be edited in place between reads (gameState.js), so an answer must never outlive the read that asked.
// `read` must be synchronous, and must not change the world.

let reading = null;

export const readingWorld = (world, read) => {
  if (reading || !world || typeof world !== "object") return read();
  reading = { world, answers: new Map() };
  try {
    return read();
  } finally {
    reading = null;
  }
};

// One answer per question, or per question and key where one is given (`undefined` is a key like any other).
export const lookedUp = (world, question, work, key) => {
  if (!reading || reading.world !== world) return work();
  let answers = reading.answers.get(question);
  if (!answers) {
    answers = new Map();
    reading.answers.set(question, answers);
  }
  if (answers.has(key)) return answers.get(key);
  const answer = work();
  answers.set(key, answer);
  return answer;
};
