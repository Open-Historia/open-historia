import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { ChatGPTAuth, validCallback } from "./chatgptAuth.js";
import { windowsCredentialEncryption } from "./windowsCredentialEncryption.js";
import { setTimeout as delay } from "node:timers/promises";

const meta = { issuer: "https://auth.openai.com", authorization_endpoint: "https://auth.openai.com/api/accounts/authorize",
  token_endpoint: "https://auth.openai.com/api/accounts/oauth/token", jwks_uri: "https://auth.openai.com/.well-known/jwks.json",
  revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke" };
// Fixture-only protection. The separate DPAPI test verifies OS-backed storage.
const fixtureEncryption = { encrypt: async (text) => Buffer.from(Buffer.from(text).toString("base64")), decrypt: async (bytes) => Buffer.from(bytes.toString(), "base64").toString() };
async function fixture(t, overrides = {}) {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "oh-chatgpt-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(storageDir)), path.resolve(os.tmpdir()));
    assert.match(path.basename(storageDir), /^oh-chatgpt-test-/);
    return rm(storageDir, { recursive: true, force: true });
  });
  const auth = new ChatGPTAuth({ storageDir, encryption: fixtureEncryption, ...overrides });
  t.after(() => auth.cancelLogin());
  return auth;
}

test("OAuth callback rejects forged state, duplicate fields and registration substitution", () => {
  const callback = (query) => new URL(`http://127.0.0.1:1/auth/callback?${query}`);
  assert.equal(validCallback(callback("state=wrong&code=test&client_id=oaiapp_test"), "expected"), null);
  assert.equal(validCallback(callback("state=expected&state=expected&code=test&client_id=oaiapp_test"), "expected"), null);
  assert.throws(() => validCallback(callback("state=expected&code=test&client_id=other"), "expected", "saved"));
  assert.throws(() => validCallback(callback("state=expected&code=test&client_id=dynamic_agent_client"), "expected"));
  assert.deepEqual(validCallback(callback("state=expected&code=test"), "expected", "saved"), { code: "test", clientId: "saved" });
});

test("OIDC identity validation checks signature, issuer, audience, nonce and subject", async (t) => {
  const auth = await fixture(t, { fetchImpl: async () => Response.json(meta) });
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  auth.jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "fixture" }] });
  const token = await new SignJWT({ nonce: "correct", email: "test@example.invalid" })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer(meta.issuer)
    .setAudience("oaiapp_test").setSubject("fixture-subject").setIssuedAt().setExpirationTime("1h").sign(privateKey);
  assert.equal((await auth.identity(token, "oaiapp_test", "correct")).subject, "fixture-subject");
  await assert.rejects(auth.identity(token, "wrong-client", "correct"));
  await assert.rejects(auth.identity(token, "oaiapp_test", "wrong-nonce"));
  await assert.rejects(auth.identity(`${token.slice(0, -10)}invalidxxx`, "oaiapp_test", "correct"));
});

test("model catalog preserves live reasoning metadata and excludes hidden entries and secrets", async (t) => {
  const auth = await fixture(t, { fetchImpl: async () => Response.json({ models: [
    { slug: "gpt-5.6-luna", display_name: "GPT-5.6 Luna", visibility: "list", default_reasoning_level: "medium",
      supported_reasoning_levels: [{ effort: "medium", description: "Balanced" }, { effort: "high" }], base_instructions: "not-for-browser" },
    { slug: "gpt-6-hidden", display_name: "Hidden", visibility: "hide" },
    { slug: "gpt-6-sol", display_name: "Sol", visibility: "list" },
  ] }) });
  auth.getCredential = async () => "fixture-access";
  const models = await auth.listModels();
  assert.deepEqual(models.map((m) => m.id), ["gpt-5.6-luna", "gpt-6-sol"]);
  assert.deepEqual(models[0].supportedReasoningEfforts, [
    { reasoningEffort: "medium", description: "Balanced" }, { reasoningEffort: "high", description: "" },
  ]);
  assert.equal(models[0].defaultReasoningEffort, "medium");
  assert.equal(models[1].supportedReasoningEfforts, undefined);
  assert.doesNotMatch(JSON.stringify(models), /not-for-browser|fixture-access/);
});

test("refreshes are serialized and secret fields never appear in public status", async (t) => {
  let refreshes = 0;
  const auth = await fixture(t, { fetchImpl: async (url) => {
    if (url.includes("openid-configuration")) return Response.json(meta);
    refreshes++;
    return Response.json({ access_token: "fixture-access-new", refresh_token: "fixture-refresh-new", token_type: "Bearer", expires_in: 3600 });
  } });
  await auth.transaction(async (record, save) => {
    record.activeId = "fixture";
    record.profiles.push({ id: "fixture", label: "Connection 1", clientId: "oaiapp_fixture", subject: "sub", email: "test@example.invalid", status: "connected",
      credentials: { accessToken: "fixture-access-old", refreshToken: "fixture-refresh-old", expiresAt: 1, scopes: ["chatgpt.tokens.use.direct"] } });
    await save();
  });
  const values = await Promise.all([auth.getCredential(), auth.getCredential()]);
  assert.deepEqual(values, ["fixture-access-new", "fixture-access-new"]);
  assert.equal(refreshes, 1);
  const publicStatus = await auth.getPublicStatus();
  assert.equal(publicStatus.account.planUsageEnabled, true);
  assert.equal(publicStatus.account.maskedEmail, "t***@example.invalid");
  assert.doesNotMatch(JSON.stringify(publicStatus), /fixture-access|fixture-refresh|oaiapp_fixture|test@example/);
});

test("does not use a plan token after the refreshed grant removes plan permission", async (t) => {
  const auth = await fixture(t, { fetchImpl: async (url) => url.includes("openid-configuration") ? Response.json(meta)
    : Response.json({ access_token: "fixture-access", refresh_token: "fixture-refresh", token_type: "Bearer", expires_in: 3600, scope: "openid profile" }) });
  await auth.transaction(async (record, save) => {
    record.activeId = "fixture";
    record.profiles.push({ id: "fixture", clientId: "oaiapp_test", status: "connected", credentials: { accessToken: "expired", refreshToken: "old", expiresAt: 1, scopes: ["chatgpt.tokens.use.direct"] } });
    await save();
  });
  await assert.rejects(auth.getCredential(), /permission/);
  assert.equal((await auth.getPublicStatus()).account.planUsageEnabled, false);
});

test("a received refresh is retained across a temporary identity verification outage", async (t) => {
  let unavailable = true;
  let refreshes = 0;
  const auth = await fixture(t, {
    fetchImpl: async (url) => {
      if (url.includes("openid-configuration")) return Response.json(meta);
      refreshes++;
      return Response.json({ access_token: "new", refresh_token: "new-refresh", id_token: "fixture-id", token_type: "Bearer", expires_in: 3600 });
    }, verifyIdentity: async () => { if (unavailable) throw new Error("fixture outage"); return { subject: "same" }; },
  });
  await auth.transaction(async (record, save) => {
    record.activeId = "fixture";
    record.profiles.push({ id: "fixture", subject: "same", clientId: "oaiapp_test", status: "connected", credentials: { accessToken: "old", refreshToken: "old-refresh", expiresAt: 1, scopes: ["chatgpt.tokens.use.direct"] } });
    await save();
  });
  await assert.rejects(auth.getCredential());
  unavailable = false;
  assert.equal(await auth.getCredential(), "new");
  assert.equal(refreshes, 1);
});

test("Windows DPAPI round-trip keeps plaintext out of persisted ciphertext", { skip: process.platform !== "win32" }, async (t) => {
  const auth = await fixture(t, { encryption: windowsCredentialEncryption() });
  await auth.transaction(async (record, save) => { record.fixture = "not-a-real-token-protection-probe"; await save(); });
  assert.equal(await auth.transaction(async (record) => record.fixture), "not-a-real-token-protection-probe");
  const bytes = await readFile(path.join(auth.storageDir, "credentials.dpapi"));
  assert.equal(bytes.includes(Buffer.from("not-a-real-token-protection-probe")), false);
});

test("first authorization uses PKCE and host id without putting retained tokens in the browser", { skip: process.platform !== "win32" }, async (t) => {
  let opened;
  const auth = await fixture(t, { browser: (url) => { opened = new URL(url); }, fetchImpl: async () => Response.json(meta) });
  await auth.beginLogin();
  assert.equal(opened.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(opened.searchParams.get("agent_name_hint"), "Open Historia");
  assert.match(opened.searchParams.get("ext_agent_host_id"), /^urn:uuid:/);
  assert.equal(opened.searchParams.get("code_challenge_method"), "S256");
  assert.match(opened.searchParams.get("redirect_uri"), /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  assert.equal(opened.searchParams.has("id_token_hint"), false);
  assert.doesNotMatch(JSON.stringify(await auth.getPublicStatus()), /code_challenge|nonce|verifier/);
});

test("loopback OAuth completes, masks credentials, acknowledges first use and reuses registration after logout", { skip: process.platform !== "win32" }, async (t) => {
  const opened = [];
  const auth = await fixture(t, { browser: (url) => { opened.push(new URL(url)); },
    verifyIdentity: async (_token, clientId, nonce) => {
      assert.equal(clientId, "oaiapp_fixture");
      assert.equal(nonce, opened[0].searchParams.get("nonce"));
      return { subject: "verified-subject", email: "test@example.invalid" };
    },
    fetchImpl: async (url, options) => {
      if (url.includes("openid-configuration")) return Response.json(meta);
      if (url.includes("revoke")) return new Response(null, { status: 500 });
      assert.equal(options.body.get("client_id"), "oaiapp_fixture");
      assert.equal(options.body.get("code"), "fixture-code");
      return Response.json({ access_token: "fixture-access", refresh_token: "fixture-refresh", id_token: "fixture-id",
        token_type: "Bearer", expires_in: 3600, scope: "openid profile offline_access chatgpt.tokens.use.direct" });
    },
  });
  await auth.beginLogin();
  const callback = new URL(opened[0].searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({ state: opened[0].searchParams.get("state"), code: "fixture-code", client_id: "oaiapp_fixture" });
  assert.equal((await fetch(callback)).status, 200);
  for (let i = 0; auth.pending && i < 100; i++) await delay(10);
  const status = await auth.getPublicStatus();
  assert.equal(status.account.loggedIn, true);
  assert.equal(status.account.planUsageEnabled, true);
  assert.equal(status.welcomeRequired, true);
  assert.doesNotMatch(JSON.stringify(status), /fixture-access|fixture-refresh|fixture-id|verified-subject/);
  await auth.acknowledgeWelcome();
  assert.equal((await auth.getPublicStatus()).welcomeRequired, false);
  assert.deepEqual(await auth.disconnect(), { revoked: false });
  assert.equal((await auth.getPublicStatus()).account.loggedIn, false);
  await auth.beginLogin();
  assert.equal(opened[1].searchParams.get("client_id"), "oaiapp_fixture");
  assert.equal(opened[1].searchParams.get("ext_agent_host_id"), opened[0].searchParams.get("ext_agent_host_id"));
  assert.notEqual(opened[1].searchParams.get("state"), opened[0].searchParams.get("state"));
  assert.equal(opened[1].searchParams.has("agent_name_hint"), false);
});
