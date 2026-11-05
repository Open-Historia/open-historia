/*! Open Historia — the microphone, as 16 kHz mono blocks © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the on-device speech models hear (speechInput.js): the microphone as
// blocks of 16 kHz mono samples, a tenth of a second each, which is the rate
// both Parakeet and Whisper were trained on. Nothing is recorded to disk and
// nothing is sent anywhere; the blocks go to the caller and nowhere else.

export const SPEECH_SAMPLE_RATE = 16000;
export const BLOCK_SAMPLES = 1600;

// Gathers the 128-sample render quanta into tenth-of-a-second blocks before
// they cross to the page, so the page hears ten messages a second, not a
// hundred and twenty-five.
const TAP_SOURCE = `
class OhMicTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options.processorOptions.size;
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const take = Math.min(channel.length - offset, this.size - this.filled);
        this.buffer.set(channel.subarray(offset, offset + take), this.filled);
        this.filled += take;
        offset += take;
        if (this.filled === this.size) {
          this.port.postMessage(this.buffer.slice(0));
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("oh-mic-tap", OhMicTap);
`;

// Linear resampling, carried across blocks, for a browser that will not run an
// AudioContext at 16 kHz on a microphone (Firefox refuses to connect a stream
// to a context of another rate).
export const createResampler = (fromRate, toRate = SPEECH_SAMPLE_RATE) => {
  if (fromRate === toRate) return (block) => block;
  const step = fromRate / toRate;
  let position = 0;
  let previous = 0;
  return (block) => {
    const out = [];
    // position counts from the last sample of the previous block (0) through
    // this block's samples (1..length), so a step can straddle the two.
    const at = (i) => (i === 0 ? previous : block[i - 1]);
    while (position < block.length) {
      const index = Math.floor(position);
      const fraction = position - index;
      out.push(at(index) + (at(index + 1) - at(index)) * fraction);
      position += step;
    }
    position -= block.length;
    previous = block[block.length - 1] ?? previous;
    return Float32Array.from(out);
  };
};

export const microphoneAvailable = () =>
  typeof navigator !== "undefined"
  && Boolean(navigator.mediaDevices?.getUserMedia)
  && typeof AudioContext !== "undefined"
  && typeof AudioWorkletNode !== "undefined";

// Opens the microphone. onBlock gets each tenth of a second as 16 kHz samples.
// Resolves to { close() }; rejects with the getUserMedia error (NotAllowedError
// when the player or the system refused).
export const openMicrophone = async ({ onBlock }) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  let context = null;
  let source = null;
  try {
    try {
      context = new AudioContext({ sampleRate: SPEECH_SAMPLE_RATE });
      source = context.createMediaStreamSource(stream);
    } catch {
      await context?.close().catch(() => {});
      context = new AudioContext();
      source = context.createMediaStreamSource(stream);
    }
    const moduleUrl = URL.createObjectURL(new Blob([TAP_SOURCE], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    const rate = context.sampleRate;
    const tap = new AudioWorkletNode(context, "oh-mic-tap", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
      processorOptions: { size: Math.round(BLOCK_SAMPLES * (rate / SPEECH_SAMPLE_RATE)) },
    });
    const resample = createResampler(rate);
    tap.port.onmessage = (event) => onBlock(resample(event.data));
    // A node nothing pulls on is never run; a silent gain to the speakers
    // keeps the tap running without the player hearing themselves.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(tap);
    tap.connect(mute);
    mute.connect(context.destination);
    if (context.state === "suspended") await context.resume().catch(() => {});
    return {
      close() {
        tap.port.onmessage = null;
        try { source.disconnect(); tap.disconnect(); mute.disconnect(); } catch { /* already gone */ }
        for (const track of stream.getTracks()) track.stop();
        context.close().catch(() => {});
      },
    };
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    await context?.close().catch(() => {});
    throw error;
  }
};
