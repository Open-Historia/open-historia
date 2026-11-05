import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rename, lstat } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { windowsCredentialEncryption } from "./windowsCredentialEncryption.js";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";
const random = () => randomBytes(32).toString("base64url");
const maskedEmail = (email) => typeof email === "string" && email.includes("@")
  ? `${email[0]}***@${email.split("@")[1]}` : null;
const empty = () => ({ version: 1, profiles: [], activeId: null, hostId: `urn:uuid:${randomUUID()}` });

export function validCallback(url, expectedState, savedClientId) {
  const state = Buffer.from(url.searchParams.get("state") ?? "");
  const expected = Buffer.from(expectedState);
  if (url.searchParams.getAll("state").length !== 1 || state.length !== expected.length || !timingSafeEqual(state, expected)) return null;
  if (url.searchParams.has("error")) return { denied: true };
  const code = url.searchParams.get("code");
  const issued = url.searchParams.get("client_id");
  const clientId = issued ?? savedClientId;
  if (!code || url.searchParams.getAll("code").length !== 1 || url.searchParams.getAll("client_id").length > 1
    || !clientId || !/^[a-zA-Z0-9_-]{1,200}$/.test(clientId) || clientId === "dynamic_agent_client"
    || (savedClientId && issued && issued !== savedClientId)) throw new Error("Cannot validate the ChatGPT client registration. Sign in again.");
  return { code, clientId };
}

function tokenRecord(tokens, previousScopes = []) {
  const scopes = typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : previousScopes;
  if (!tokens.access_token || tokens.token_type?.toLowerCase() !== "bearer" || !tokens.refresh_token
    || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || !scopes.length) {
    throw new Error("Incomplete ChatGPT authentication response. Sign in again.");
  }
  return {
    accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000, scopes,
    earliestRefreshAt: tokens.earliest_refresh_at ?? null,
  };
}

async function openBrowser(url) {
  await new Promise((resolve, reject) => {
    const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { windowsHide: true, stdio: "ignore" });
    child.once("error", () => reject(new Error("Cannot open the system browser.")));
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Cannot open the system browser.")));
  });
}

// Implements the documented OSS public-client flow. This record is never sent
// to a renderer. Codex credentials are neither read nor modified.
export class ChatGPTAuth {
  constructor({ storageDir, encryption = windowsCredentialEncryption(), fetchImpl = fetch, browser = openBrowser, verifyIdentity } = {}) {
    this.storageDir = storageDir;
    this.encryption = encryption;
    this.fetch = fetchImpl;
    this.browser = browser;
    this.verifyIdentity = verifyIdentity;
    this.pending = null;
    this.loginError = null;
    this.discovery = null;
  }

  async transaction(action) {
    await mkdir(this.storageDir, { recursive: true, mode: 0o700 });
    if ((await lstat(this.storageDir)).isSymbolicLink()) throw new Error("Credential storage cannot use a symbolic link.");
    const release = await lockfile.lock(this.storageDir, { realpath: false, retries: { retries: 15, minTimeout: 100, maxTimeout: 1000 } });
    try {
      const filename = path.join(this.storageDir, "credentials.dpapi");
      let record;
      try { record = JSON.parse(await this.encryption.decrypt(await readFile(filename))); }
      catch (error) {
        if (error.code !== "ENOENT") throw new Error("Cannot read saved ChatGPT credentials. Use the same Windows user.");
        record = empty();
      }
      if (record.version !== 1 || !Array.isArray(record.profiles) || !record.hostId) throw new Error("Invalid saved ChatGPT credential record.");
      const save = async () => {
        const temp = `${filename}.${randomUUID()}.tmp`;
        await writeFile(temp, await this.encryption.encrypt(JSON.stringify(record)), { mode: 0o600, flag: "wx" });
        await rename(temp, filename);
      };
      return await action(record, save);
    } finally { await release(); }
  }

  async metadata() {
    if (this.discovery) return this.discovery;
    const response = await this.fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) });
    const data = await response.json();
    if (!response.ok || data.issuer !== ISSUER) throw new Error("Cannot fetch ChatGPT authentication metadata.");
    for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri", "revocation_endpoint"]) {
      if (!data[key] || new URL(data[key]).origin !== ISSUER) throw new Error("Cannot validate ChatGPT authentication metadata.");
    }
    this.discovery = data;
    return data;
  }

  async identity(token, clientId, nonce, receivedAt) {
    if (this.verifyIdentity) return this.verifyIdentity(token, clientId, nonce, receivedAt);
    const meta = await this.metadata();
    this.jwks ??= createRemoteJWKSet(new URL(meta.jwks_uri));
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: ISSUER, audience: clientId, algorithms: ["RS256"],
      requiredClaims: ["iss", "aud", "exp", "iat", "sub"], clockTolerance: 5,
      ...(receivedAt ? { currentDate: new Date(receivedAt) } : {}),
    });
    if (!payload.sub || (nonce && payload.nonce !== nonce) || (payload.azp && payload.azp !== clientId)
      || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) {
      throw new Error("Cannot validate the ChatGPT identity.");
    }
    return { subject: payload.sub, email: payload.email ?? null };
  }

  async exchange(body) {
    const meta = await this.metadata();
    const response = await this.fetch(meta.token_endpoint, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(response.status === 400 || response.status === 401
      ? "ChatGPT authorization expired or was revoked. Sign in again."
      : "Cannot reach ChatGPT authentication. Retry later.");
    return response.json();
  }

  async beginLogin({ profileId, newProfile = false, reconsent = false } = {}) {
    if (process.platform !== "win32") throw new Error("Sign in with ChatGPT is currently supported on Windows only.");
    if (this.pending) throw new Error("Sign-in is in progress. Complete it in the browser or cancel it.");
    const attempt = { state: random(), nonce: random(), verifier: random(), consumed: false };
    this.pending = attempt;
    this.loginError = null;
    try {
      const previous = await this.transaction(async (record, save) => {
        await save(); // Persist host identity before even a cancelled first sign-in.
        const selected = newProfile ? null : record.profiles.find((p) => p.id === (profileId ?? record.activeId));
        if (profileId && !selected) throw new Error("Saved connection not found.");
        return { profile: selected, hostId: record.hostId };
      });
      const meta = await this.metadata();
      const server = createServer((request, response) => {
        const callback = new URL(request.url ?? "/", attempt.redirectUri);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
        const script = "history.replaceState(null,'','/auth/complete');";
        const hash = createHash("sha256").update(script).digest("base64");
        response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'`);
        if (request.method !== "GET" || request.headers.host !== new URL(attempt.redirectUri).host || callback.origin !== new URL(attempt.redirectUri).origin
          || callback.pathname !== "/auth/callback" || attempt.consumed) { response.writeHead(404).end(); return; }
        let result;
        try { result = validCallback(callback, attempt.state, previous.profile?.clientId); }
        catch { result = { denied: true }; }
        if (!result) { response.writeHead(400).end("Invalid state"); return; }
        attempt.consumed = true;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Return to Open Historia</title><body><h1>Return to Open Historia</h1><p>Check the connection result in the app. You can close this tab.</p><script>${script}</script></body></html>`);
        void this.finishLogin(result, previous.profile, attempt).catch(() => {
          if (this.pending === attempt) this.loginError = "ChatGPT connection failed. Check the account and permissions and retry.";
        }).finally(() => { if (this.pending === attempt) this.cancelLogin(); });
      });
      attempt.server = server;
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      attempt.redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
      attempt.timer = setTimeout(() => { this.loginError = "Sign-in timed out. Try again."; this.cancelLogin(); }, 10 * 60_000);
      const authorize = new URL(meta.authorization_endpoint);
      authorize.search = new URLSearchParams({
        client_id: previous.profile?.clientId ?? "dynamic_agent_client", ext_agent_host_id: previous.hostId,
        response_type: "code", redirect_uri: attempt.redirectUri, resource: RESOURCE, scope: SCOPES,
        state: attempt.state, nonce: attempt.nonce, code_challenge_method: "S256",
        code_challenge: createHash("sha256").update(attempt.verifier).digest("base64url"),
        ...(!previous.profile ? { agent_name_hint: "Open Historia" } : {}),
        ...(reconsent ? { prompt: "consent" } : {}),
      }).toString();
      // Deliberately omit id_token_hint: retained tokens never go to browser URLs.
      await this.browser(authorize.toString());
      return { pending: true };
    } catch (error) { this.cancelLogin(); throw error; }
  }

  async finishLogin(result, previous, attempt) {
    if (result.denied) throw new Error("Sign-in was declined.");
    const profileId = previous?.id ?? randomUUID();
    // Retain the issued registration even if the one-time code later expires.
    await this.transaction(async (record, save) => {
      if (!record.profiles.some((p) => p.id === profileId)) {
        record.profiles.push({ id: profileId, clientId: result.clientId, label: `Connection ${record.profiles.length + 1}`, status: "disconnected", subject: null });
        await save();
      }
    });
    const tokens = await this.exchange({ grant_type: "authorization_code", client_id: result.clientId,
      code: result.code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE });
    const identity = await this.identity(tokens.id_token, result.clientId, attempt.nonce);
    if (previous?.subject && previous.subject !== identity.subject) throw new Error("A different account was returned.");
    const credentials = tokenRecord(tokens);
    if (this.pending !== attempt) throw new Error("Sign-in was cancelled.");
    await this.transaction(async (record, save) => {
      const profile = record.profiles.find((p) => p.id === profileId);
      Object.assign(profile, identity, { credentials, status: "connected" });
      record.activeId = profileId;
      await save();
    });
  }

  cancelLogin() {
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    this.pending?.server?.close();
    this.pending?.server?.closeAllConnections();
    this.pending = null;
  }

  async getPublicStatus() {
    return this.transaction(async (record) => {
      const active = record.profiles.find((p) => p.id === record.activeId);
      const clean = (p) => ({ id: p.id, label: p.label, loggedIn: p.status === "connected", maskedEmail: maskedEmail(p.email) });
      return { account: {
        loggedIn: active?.status === "connected", planUsageEnabled: active?.status === "connected" && Boolean(active.credentials?.scopes.includes(PLAN_SCOPE)),
        activeId: record.activeId, maskedEmail: maskedEmail(active?.email),
      }, profiles: record.profiles.map(clean), pendingLogin: Boolean(this.pending), loginError: this.loginError,
      welcomeRequired: Boolean(active?.credentials?.scopes.includes(PLAN_SCOPE) && !active.welcomeSeen), manageUsageUrl: CHATGPT_USAGE_URL };
    });
  }

  async getCredential() {
    return this.transaction(async (record, save) => {
      const profile = record.profiles.find((p) => p.id === record.activeId);
      if (profile?.status !== "connected" || !profile.credentials) throw new Error("Sign in with ChatGPT in Open Historia settings.");
      if (!profile.credentials.scopes.includes(PLAN_SCOPE)) throw new Error("ChatGPT plan usage permission is required.");
      if (profile.pendingRefresh || profile.credentials.expiresAt <= Date.now() + 60_000) {
        if (!profile.pendingRefresh) {
          const earliest = profile.credentials.earliestRefreshAt;
          const earliestMs = typeof earliest === "number" ? earliest * 1000 : Date.parse(earliest ?? "");
          if (earliestMs > Date.now()) {
            if (profile.credentials.expiresAt <= Date.now()) throw new Error("Wait briefly for ChatGPT authorization renewal.");
            return profile.credentials.accessToken;
          }
          const tokens = await this.exchange({ grant_type: "refresh_token", client_id: profile.clientId,
            refresh_token: profile.credentials.refreshToken, resource: RESOURCE });
          profile.pendingRefresh = { credentials: tokenRecord(tokens, profile.credentials.scopes), idToken: tokens.id_token, receivedAt: Date.now() };
          await save(); // Rotation survives key-service outages and process interruption.
        }
        if (profile.pendingRefresh.idToken) {
          const verified = await this.identity(profile.pendingRefresh.idToken, profile.clientId, undefined, profile.pendingRefresh.receivedAt);
          if (verified.subject !== profile.subject) throw new Error("Cannot validate the refreshed ChatGPT account. Sign in again.");
        }
        profile.credentials = profile.pendingRefresh.credentials;
        delete profile.pendingRefresh;
        await save();
      }
      if (!profile.credentials.scopes.includes(PLAN_SCOPE) || profile.credentials.expiresAt <= Date.now()) throw new Error("Check ChatGPT plan permission and token expiry.");
      return profile.credentials.accessToken;
    });
  }

  // Full metadata stays server-side for the isolated Codex runtime.
  async getModelCatalog() {
    const token = await this.getCredential();
    const response = await this.fetch(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Cannot fetch ChatGPT models (${response.status}). Check plan permission.`);
    const data = await response.json();
    if (!Array.isArray(data.models)) throw new Error("Invalid ChatGPT model catalog.");
    return data;
  }

  async listModels() {
    const data = await this.getModelCatalog();
    return data.models.filter((m) => m.visibility === "list" && typeof m.slug === "string" && typeof m.display_name === "string")
      .map((m) => ({
        id: m.slug, model: m.slug, displayName: m.display_name,
        ...(Array.isArray(m.supported_reasoning_levels) ? {
          supportedReasoningEfforts: m.supported_reasoning_levels
            .filter((option) => typeof option.effort === "string")
            .map((option) => ({ reasoningEffort: option.effort, description: option.description ?? "" })),
        } : {}),
        ...(typeof m.default_reasoning_level === "string" ? { defaultReasoningEffort: m.default_reasoning_level } : {}),
      }));
  }

  async selectAccount(id) {
    if (this.pending) throw new Error("Complete or cancel sign-in first.");
    return this.transaction(async (record, save) => {
      if (!record.profiles.some((p) => p.id === id)) throw new Error("Selected connection not found.");
      record.activeId = id;
      await save();
    });
  }

  async acknowledgeWelcome() {
    await this.transaction(async (record, save) => {
      const active = record.profiles.find((p) => p.id === record.activeId);
      if (active) active.welcomeSeen = true;
      await save();
    });
  }

  async disconnect() {
    this.cancelLogin();
    return this.transaction(async (record, save) => {
      const profile = record.profiles.find((p) => p.id === record.activeId);
      let revoked = !profile?.credentials;
      if (profile?.credentials) {
        try {
          const meta = await this.metadata();
          const response = await this.fetch(meta.revocation_endpoint, { method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15_000),
            body: new URLSearchParams({ client_id: profile.clientId, token: profile.pendingRefresh?.credentials.refreshToken ?? profile.credentials.refreshToken, token_type_hint: "refresh_token" }) });
          revoked = response.status === 200;
          await response.body?.cancel();
        } catch { /* Clear locally, report remote revocation accurately. */ }
        delete profile.credentials;
        delete profile.pendingRefresh;
        profile.status = "disconnected";
        await save();
      }
      return { revoked };
    });
  }
}
