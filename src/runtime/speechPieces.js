/*! Open Historia — a spoken turn read in pieces © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// How Whisper on the device (speechOnDevice.js) keeps the wait after the
// player stops short. Whisper reads every call as a 30-second window, so a
// reading costs the same few seconds on one thread (the game is not
// cross-origin isolated, so no more) whether it holds two seconds of speech or
// twenty-five. So:
//   - a turn is cut into pieces at the pauses in it, and each piece goes to be
//     read as soon as it is cut: by the time the three seconds of silence have
//     passed, the last piece has been reading for more than two of them;
//   - pieces that were cut while the model was busy wait and are read together
//     in one call (up to the window's length), so a player who pauses often
//     does not leave a queue of readings behind at the end.
//
// Pure apart from the read function it is handed, so the tests drive it with
// made-up blocks.

// Blocks are a tenth of a second (speechCapture.js).
export const PAUSE_BLOCKS = 7; // a pause this long ends a piece
export const LEAD_IN_BLOCKS = 10; // kept before the first word of a piece
export const TAIL_BLOCKS = 4; // kept after its last word
// Whisper's window is 30 seconds; a piece with no pause in it is cut before
// that, and readings put together stay under it.
export const LONGEST_PIECE_BLOCKS = 280;
export const LONGEST_READING_SAMPLES = 28 * 16000;

const joinBlocks = (list) => {
  let length = 0;
  for (const block of list) length += block.length;
  const audio = new Float32Array(length);
  let offset = 0;
  for (const block of list) {
    audio.set(block, offset);
    offset += block.length;
  }
  return audio;
};

// Cuts the microphone's blocks into pieces of speech. hear(block, speech) for
// every block, with the voice-activity verdict on it; onPiece(audio) for every
// piece; flush() cuts what is left.
export const createPieceCutter = ({ onPiece }) => {
  let blocks = []; // the piece being spoken, with its lead-in
  let spoke = false;
  let lastSpeech = -1;

  const cut = () => {
    if (!spoke) return;
    const audio = joinBlocks(blocks.slice(0, lastSpeech + 1 + TAIL_BLOCKS));
    blocks = blocks.slice(lastSpeech + 1);
    spoke = false;
    lastSpeech = -1;
    onPiece(audio);
  };

  return {
    hear(block, speech) {
      blocks.push(block);
      if (speech) {
        spoke = true;
        lastSpeech = blocks.length - 1;
      } else if (!spoke && blocks.length > LEAD_IN_BLOCKS) {
        blocks.shift();
      }
      if (spoke && (blocks.length - 1 - lastSpeech >= PAUSE_BLOCKS || blocks.length >= LONGEST_PIECE_BLOCKS)) cut();
    },
    flush: cut,
  };
};

// Reads pieces one call at a time, in order. read(audio) → Promise of its text;
// onText(text) with everything read so far, each time a reading comes back.
// add(audio) hands over a piece; done() → Promise of the whole turn's text once
// every piece is read.
export const createPieceReader = ({ read, onText, longest = LONGEST_READING_SAMPLES }) => {
  const waiting = [];
  const texts = [];
  let reading = false;
  let drained = [];

  const shown = () => texts.filter(Boolean).join(" ").trim();

  const settle = () => {
    if (reading || waiting.length) return;
    const resolvers = drained;
    drained = [];
    for (const resolve of resolvers) resolve(shown());
  };

  const next = () => {
    if (reading || !waiting.length) {
      settle();
      return;
    }
    const batch = [waiting.shift()];
    let length = batch[0].length;
    while (waiting.length && length + waiting[0].length <= longest) {
      length += waiting[0].length;
      batch.push(waiting.shift());
    }
    reading = true;
    Promise.resolve()
      .then(() => read(batch.length === 1 ? batch[0] : joinBlocks(batch)))
      .catch(() => "")
      .then((text) => {
        reading = false;
        const clean = String(text || "").trim();
        texts.push(clean);
        if (clean) onText?.(shown());
        next();
      });
  };

  return {
    add(audio) {
      if (!audio?.length) return;
      waiting.push(audio);
      next();
    },
    done: () => new Promise((resolve) => {
      drained.push(resolve);
      settle();
    }),
    get text() {
      return shown();
    },
  };
};
