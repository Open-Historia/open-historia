import fs from "node:fs";
import path from "node:path";
import { isMainThread } from "node:worker_threads";
import { pathToFileURL } from "node:url";

const file = process.env.OH_PROBE_LOG;
const role = process.env.OH_PROBE_ROLE || "?";
const kind = process.env.OH_SHARED_GAME_ENGINE ? "engine" : "sidecar";
const write = (entry) => {
  if (!file) return;
  try {
    fs.appendFileSync(file, `${JSON.stringify({ t: Date.now(), role, kind, pid: process.pid, ...entry })}\n`);
  } catch {}
};
const relayOf = (url) => {
  try {
    const parsed = new URL(String(url));
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "?";
  }
};
const familyOf = (address) => (String(address ?? "").includes(":") ? "v6" : String(address ?? "").endsWith(".local") ? "mdns" : "v4");
const candidateTypes = (sdp) => {
  const types = {};
  for (const line of String(sdp ?? "").split(/\r?\n/)) {
    const match = /^a=candidate:\S+ \d+ (\S+) \d+ (\S+) \d+ typ (\S+)/.exec(line);
    if (match) {
      const key = `${match[3]}/${match[1].toLowerCase()}/${familyOf(match[2])}`;
      types[key] = (types[key] ?? 0) + 1;
    }
  }
  return types;
};
const side = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  return { type: String(entry.type ?? entry.candidateType ?? ""), transport: String(entry.transportType ?? entry.protocol ?? ""), family: familyOf(entry.address ?? entry.ip) };
};

if (isMainThread) {
  write({ what: "start" });

  const Native = globalThis.WebSocket;
  if (typeof Native === "function") {
    class ProbeSocket extends Native {
      constructor(url, ...rest) {
        super(url, ...rest);
        const born = Date.now();
        const relay = relayOf(url);
        const counts = {};
        write({ what: "ws.connect", url: relay });
        this.addEventListener("open", () => write({ what: "ws.open", url: relay, ms: Date.now() - born }));
        this.addEventListener("error", () => write({ what: "ws.error", url: relay, ms: Date.now() - born }));
        this.addEventListener("close", (event) => write({ what: "ws.close", url: relay, ms: Date.now() - born, code: event?.code, counts }));
        this.addEventListener("message", (event) => {
          let message;
          try {
            message = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (!Array.isArray(message)) return;
          const type = String(message[0]);
          counts[type] = (counts[type] ?? 0) + 1;
          if (type === "OK") {
            if (message[2] !== true) write({ what: "ws.refused", url: relay, said: String(message[3] ?? "").slice(0, 160) });
            else if (counts.OK === 1) write({ what: "ws.firstOk", url: relay, ms: Date.now() - born });
          } else if (type === "EVENT" && counts.EVENT === 1) write({ what: "ws.firstEvent", url: relay, ms: Date.now() - born });
          else if (type === "NOTICE" || type === "CLOSED") write({ what: `ws.${type.toLowerCase()}`, url: relay, said: String(message.at(-1) ?? "").slice(0, 160) });
        });
      }
    }
    globalThis.WebSocket = ProbeSocket;
  }

  const sidecar = process.env.OH_PROBE_SIDECAR || path.resolve(process.cwd());
  try {
    const rtc = await import(pathToFileURL(path.join(sidecar, "node_modules", "node-datachannel", "dist", "esm", "polyfill", "index.mjs")).href);
    const Base = rtc.RTCPeerConnection;
    class ProbePeer extends Base {
      constructor(config, ...rest) {
        super(config, ...rest);
        const born = Date.now();
        const id = Math.random().toString(36).slice(2, 8);
        const added = {};
        this._ohProbeAdded = added;
        write({ what: "rtc.new", id, iceServers: (config?.iceServers ?? []).map((server) => [].concat(server?.urls ?? []).map(String)).flat(), policy: config?.iceTransportPolicy ?? "all" });
        this.addEventListener("icegatheringstatechange", () => {
          if (this.iceGatheringState === "complete") write({ what: "rtc.gathered", id, ms: Date.now() - born, local: candidateTypes(this.localDescription?.sdp) });
        });
        this.addEventListener("iceconnectionstatechange", () => write({ what: "rtc.ice", id, state: this.iceConnectionState, ms: Date.now() - born }));
        this.addEventListener("connectionstatechange", () => {
          const state = this.connectionState;
          const entry = { what: "rtc.state", id, state, ms: Date.now() - born };
          if (state === "connected" || state === "failed") {
            entry.remoteInSdp = candidateTypes(this.remoteDescription?.sdp);
            entry.remoteAdded = { ...added };
          }
          if (state === "connected") {
            try {
              const pair = this.selectedCandidatePair();
              entry.pair = { local: side(pair?.local), remote: side(pair?.remote) };
            } catch (error) {
              entry.pairError = String(error?.message ?? error).slice(0, 160);
            }
          }
          write(entry);
        });
      }

      addIceCandidate(candidate, ...rest) {
        const text = typeof candidate === "string" ? candidate : String(candidate?.candidate ?? "");
        const match = /candidate:\S+ \d+ (\S+) \d+ (\S+) \d+ typ (\S+)/.exec(text);
        if (match && this._ohProbeAdded) {
          const key = `${match[3]}/${match[1].toLowerCase()}/${familyOf(match[2])}`;
          this._ohProbeAdded[key] = (this._ohProbeAdded[key] ?? 0) + 1;
        }
        return super.addIceCandidate(candidate, ...rest);
      }
    }
    globalThis.RTCPeerConnection = ProbePeer;
    for (const name of ["RTCSessionDescription", "RTCIceCandidate", "RTCDataChannel"]) globalThis[name] = rtc[name];
  } catch (error) {
    write({ what: "rtc.unavailable", said: String(error?.message ?? error).slice(0, 200) });
  }
}
