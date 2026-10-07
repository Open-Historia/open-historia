/*! Open Historia — an in-memory RTCPeerConnection for multiplayer tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Tests only. Enough of RTCPeerConnection for transport/peer.js: an offer and
// an answer whose SDP names the connection that made it and carries a
// fingerprint unique to it, and a data channel that links the two once the
// offerer accepts the answer. drop() cuts a link the way a lost network does.

const later = (fn) => setTimeout(fn, 0);

export const createFakeRtcNetwork = () => {
  const connections = new Map();
  let counter = 0;
  const fingerprint = (id) => Array.from({ length: 32 }, (_, index) => ((id * 31 + index * 7) % 256).toString(16).padStart(2, "0").toUpperCase()).join(":");

  class FakeChannel {
    constructor(label) {
      this.label = label;
      this.readyState = "connecting";
      this.bufferedAmount = 0;
      this.other = null;
    }

    send(text) {
      if (this.readyState !== "open") throw new Error("channel not open");
      const target = this.other;
      later(() => {
        if (target?.readyState === "open") target.onmessage?.({ data: text });
      });
    }

    close() {
      if (this.readyState === "closed") return;
      this.readyState = "closed";
      later(() => this.onclose?.({}));
      if (this.other && this.other.readyState !== "closed") this.other.close();
    }
  }

  class FakeRTCPeerConnection {
    constructor(config) {
      this.config = config;
      this.id = ++counter;
      this.iceGatheringState = "new";
      this.connectionState = "new";
      this.listeners = new Map();
      this.channel = null;
      connections.set(this.id, this);
    }

    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }

    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn);
    }

    createDataChannel(label) {
      this.channel = new FakeChannel(label);
      return this.channel;
    }

    async createOffer() {
      return { type: "offer", sdp: `v=0\r\na=fake-connection:${this.id}\r\na=fingerprint:sha-256 ${fingerprint(this.id)}\r\n` };
    }

    async createAnswer() {
      return { type: "answer", sdp: `v=0\r\na=fake-connection:${this.id}\r\na=fingerprint:sha-256 ${fingerprint(this.id)}\r\n` };
    }

    async setLocalDescription(description) {
      this.localDescription = description;
      this.iceGatheringState = "complete";
    }

    async setRemoteDescription(description) {
      const match = /a=fake-connection:(\d+)/.exec(description.sdp);
      if (!match) throw new Error("not an SDP this network made");
      this.remoteDescription = description;
      if (description.type === "answer") {
        const answerer = connections.get(Number(match[1]));
        if (!answerer) throw new Error("no such connection");
        link(this, answerer);
      }
    }

    close() {
      if (this.connectionState === "closed") return;
      this.connectionState = "closed";
      this.channel?.close();
    }
  }

  const link = (offerer, answerer) => {
    const remote = new FakeChannel(offerer.channel.label);
    answerer.channel = remote;
    offerer.channel.other = remote;
    remote.other = offerer.channel;
    later(() => {
      offerer.connectionState = "connected";
      answerer.connectionState = "connected";
      offerer.onconnectionstatechange?.();
      answerer.onconnectionstatechange?.();
      answerer.ondatachannel?.({ channel: remote });
      offerer.channel.readyState = "open";
      remote.readyState = "open";
      remote.onopen?.({});
      offerer.channel.onopen?.({});
    });
  };

  return {
    RTCPeerConnection: FakeRTCPeerConnection,
    connections,
    // Cut every open connection (or one), as a lost network would.
    drop: (id) => {
      for (const connection of connections.values()) {
        if (id !== undefined && connection.id !== id) continue;
        if (connection.connectionState !== "connected") continue;
        connection.connectionState = "failed";
        connection.onconnectionstatechange?.();
      }
    },
  };
};
