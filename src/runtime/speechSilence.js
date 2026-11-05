/*! Open Historia — when the Advisor's microphone stops listening © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The owner's rule: the message sends once the player has stopped speaking for
// three seconds. Silence before the first word does not count: a player who
// presses the microphone and then thinks is not done. A press that never hears
// a word gives up after a while rather than holding the microphone open, and a
// very long turn is cut off and sent, since the on-device model slows down with
// every second it has to read.
//
// Pure apart from the clock and the interval it is handed, so the tests step a
// mocked clock through it.

export const SILENCE_TO_SEND_MS = 3000;
export const NO_SPEECH_GIVE_UP_MS = 20000;
export const LONGEST_TURN_MS = 60000;

// "send", "give-up" or null (keep listening).
export const silenceVerdict = ({
  startedAt,
  lastSpeechAt = null,
  now,
  silenceMs = SILENCE_TO_SEND_MS,
  noSpeechMs = NO_SPEECH_GIVE_UP_MS,
  longestMs = LONGEST_TURN_MS,
}) => {
  if (lastSpeechAt == null) return now - startedAt >= noSpeechMs ? "give-up" : null;
  if (now - lastSpeechAt >= silenceMs) return "send";
  if (now - startedAt >= longestMs) return "send";
  return null;
};

// Watches one listening turn. heard() is called whenever speech is detected
// (a voice-activity frame, or a recogniser's result); onVerdict fires once.
export const createSilenceWatch = ({
  onVerdict,
  now = () => Date.now(),
  every = 200,
  silenceMs = SILENCE_TO_SEND_MS,
  noSpeechMs = NO_SPEECH_GIVE_UP_MS,
  longestMs = LONGEST_TURN_MS,
} = {}) => {
  const startedAt = now();
  let lastSpeechAt = null;
  let done = false;
  const stop = () => {
    done = true;
    clearInterval(timer);
  };
  const check = () => {
    if (done) return;
    const verdict = silenceVerdict({ startedAt, lastSpeechAt, now: now(), silenceMs, noSpeechMs, longestMs });
    if (!verdict) return;
    stop();
    onVerdict?.(verdict);
  };
  const timer = setInterval(check, every);
  return {
    heard(at = now()) {
      if (!done) lastSpeechAt = at;
    },
    get spoke() {
      return lastSpeechAt != null;
    },
    check,
    stop,
  };
};

// The root-mean-square level of a block of samples (-1..1).
export const rmsLevel = (samples) => {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
};

// Energy-based voice activity for the on-device engines, which hear the raw
// microphone and have no end-of-speech event of their own. A block is speech
// when it is well above the room's noise, taken as the quietest of the last
// few seconds of blocks: speech always has gaps between words, so that minimum
// is the room, and a fan or a hum that never stops raises the bar instead of
// passing for a voice that never stops. The floor keeps a dead-quiet room from
// calling breath speech.
export const createEnergyVad = ({ ratio = 3, floor = 0.012, window = 30 } = {}) => {
  const recent = [];
  return (level) => {
    const value = Number(level) || 0;
    recent.push(value);
    if (recent.length > window) recent.shift();
    const noise = Math.min(...recent);
    return value > Math.max(floor, noise * ratio);
  };
};
