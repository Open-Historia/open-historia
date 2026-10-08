/*! Open Historia — one WebRTC connection between a player and the host © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The host holds one of these per player, and each player one to the host:
// the game is a star around the host, and players never connect to each other.
//
// ICE candidates ride inside the offer and the answer (we wait for gathering
// to finish, up to a limit, instead of trickling them one by one over
// signaling), so a connection costs one signaling message each way.
//
// Until the game has its own relay, only STUN servers are offered: they tell a
// device its public address and nothing passes through them. The connection is
// then direct, so the host and each player can see each other's IP address, and
// some strict networks (mobile carrier NAT, some offices) will not connect at
// all. With a TURN relay configured, `relayOnly` forces every connection through
// it and neither side sees the other's address.

export const DEFAULT_ICE_SERVERS = Object.freeze([
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
]);

// "sha-256 AB:CD:…" from an SDP's first a=fingerprint line, or "". The
// fingerprint names the DTLS certificate the connection is encrypted with, so
// signing it binds a device's (or the host's) key to this very connection.
export const sdpFingerprint = (sdp) => {
  const match = /^a=fingerprint:(\S+)\s+([0-9A-Fa-f:]+)\s*$/m.exec(String(sdp ?? ""));
  return match ? `${match[1].toLowerCase()} ${match[2].toUpperCase()}` : "";
};

export const createPeer = ({
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
  iceServers = DEFAULT_ICE_SERVERS,
  relayOnly = false,
  gatherTimeoutMs = 5000,
  disconnectGraceMs = 8000,
  onOpen = () => {},
  onMessage = () => {},
  onClose = () => {},
  timers = globalThis,
} = {}) => {
  if (typeof RTCPeerConnectionImpl !== "function") throw new Error("This device cannot make WebRTC connections.");
  const connection = new RTCPeerConnectionImpl({
    iceServers,
    ...(relayOnly ? { iceTransportPolicy: "relay" } : {}),
  });
  let channel = null;
  let closed = false;
  let graceTimer = null;
  const drainWaiters = new Set();

  const finish = (reason) => {
    if (closed) return;
    closed = true;
    timers.clearTimeout(graceTimer);
    for (const wake of drainWaiters) wake();
    drainWaiters.clear();
    try {
      channel?.close();
    } catch {
      // already closed
    }
    try {
      connection.close();
    } catch {
      // already closed
    }
    onClose(reason);
  };

  const wire = (dataChannel) => {
    channel = dataChannel;
    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.onopen = () => {
      if (!closed) onOpen();
    };
    channel.onmessage = (event) => {
      // Text frames only: binary has no place in this protocol.
      if (!closed && typeof event?.data === "string") onMessage(event.data);
    };
    channel.onclose = () => finish("closed");
    channel.onerror = () => {};
    channel.onbufferedamountlow = () => {
      for (const wake of drainWaiters) wake();
      drainWaiters.clear();
    };
  };

  connection.onconnectionstatechange = () => {
    const state = connection.connectionState;
    if (state === "failed" || state === "closed") finish(state);
    else if (state === "disconnected") {
      // Often a moment's loss of the network; give it a chance to come back.
      timers.clearTimeout(graceTimer);
      graceTimer = timers.setTimeout(() => {
        if (connection.connectionState === "disconnected") finish("disconnected");
      }, disconnectGraceMs);
    } else if (state === "connected") timers.clearTimeout(graceTimer);
  };

  const gathered = () => new Promise((resolve) => {
    if (connection.iceGatheringState === "complete") return resolve();
    const timer = timers.setTimeout(resolve, gatherTimeoutMs);
    const check = () => {
      if (connection.iceGatheringState !== "complete") return;
      timers.clearTimeout(timer);
      connection.removeEventListener?.("icegatheringstatechange", check);
      resolve();
    };
    connection.addEventListener("icegatheringstatechange", check);
  });

  return {
    // The player's side: the offer to publish.
    async createOffer() {
      wire(connection.createDataChannel("oh", { ordered: true }));
      await connection.setLocalDescription(await connection.createOffer());
      await gathered();
      return connection.localDescription.sdp;
    },
    async acceptAnswer(sdp) {
      await connection.setRemoteDescription({ type: "answer", sdp });
    },
    // The host's side: the answer to a player's offer.
    async answerOffer(sdp) {
      connection.ondatachannel = (event) => {
        if (!channel && event.channel?.label === "oh") wire(event.channel);
        else event.channel?.close();
      };
      await connection.setRemoteDescription({ type: "offer", sdp });
      await connection.setLocalDescription(await connection.createAnswer());
      await gathered();
      return connection.localDescription.sdp;
    },
    send(frame) {
      if (closed || channel?.readyState !== "open") return false;
      channel.send(frame);
      return true;
    },
    // Many frames (one large message), paced by what the channel has buffered
    // so a multi-megabyte view of the world does not sit in memory twice.
    async sendAll(frames, { highWater = 1024 * 1024 } = {}) {
      for (const frame of frames) {
        while (!closed && channel?.bufferedAmount > highWater) {
          await new Promise((resolve) => {
            drainWaiters.add(resolve);
            timers.setTimeout(resolve, 1000);
          });
        }
        if (!this.send(frame)) return false;
      }
      return true;
    },
    fingerprints: () => ({
      local: sdpFingerprint(connection.localDescription?.sdp),
      remote: sdpFingerprint(connection.remoteDescription?.sdp),
    }),
    get open() {
      return !closed && channel?.readyState === "open";
    },
    close: () => finish("closed here"),
  };
};
