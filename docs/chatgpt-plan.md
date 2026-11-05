# ChatGPT plan connections (local preview)

This adds two optional connections to Settings > AI:

- **ChatGPT (Sign in)**: the documented OpenAI open-source Sign in with ChatGPT
  flow. This preview protects credentials with Windows DPAPI and is currently
  Windows-only.
- **ChatGPT Codex**: an existing Codex CLI ChatGPT login, without importing its
  credentials into the game or changing its login.

Neither connection requires an OpenAI API key. Existing API providers keep their
own settings and behavior. These connections are hidden in browser-only builds;
they require the local Express backend and a locally installed Codex executable.

## Setup on Windows

1. Install Codex CLI or Codex Desktop from OpenAI. If automatic discovery cannot
   find the executable, set `OH_CODEX_PATH` to the absolute path of `codex.exe`
   before starting Open Historia.
2. Build and start Open Historia using the normal README instructions
   (`npm install`, `npm run build`, `node server/server.js`), or use a desktop
   build containing this feature.
3. In Settings > AI, add a Connection and a Fallback entry for **ChatGPT (Sign in)**.
   Click **Continue with ChatGPT** on the host PC and authorize the desired account
   and ChatGPT plan permissions in the system browser.
4. Acknowledge the plan-usage notice. Choose a model and reasoning effort.
5. Use **Manage ChatGPT usage** to manage permissions, app limits and credits.
   This app does not invent usage percentages or reset times for official plan
   connections; OpenAI does not document a numeric usage endpoint for this flow.

Alternatively, run `codex login` and choose **ChatGPT Codex**. API-key Codex logins
are rejected by this adapter.

## Models and reasoning

The official connection obtains the selected account's catalog from
`GET https://api.openai.com/v1/models`, displays entries with
`visibility: "list"`, and uses their slugs for inference. It preserves server
ordering and imposes **no model-generation or family allowlist**: older models
remain selectable whenever the account's catalog includes them. It refreshes
the catalog after account changes.

Codex CLI connections use `model/list` and display all non-hidden entries. A
catalog is not proof of entitlement; OpenAI may still reject a particular model
when generating. Reasoning options come from current model metadata, with the
app-server catalog as a fallback. Medium is preferred only when supported.
An explicit selection is honored when present; an empty model uses the catalog
default, or its first visible entry.

## Security and execution

Official OAuth uses public dynamic-client registration, PKCE, state and nonce,
issuer/audience/signature validation, a loopback callback, and validated plan
permission scopes. Each account has its own registration and credentials.
Rotating refreshes are serialized and checkpointed before identity validation.

Credentials are encrypted for the current Windows user under the local data
directory's `chatgpt-auth/credentials.dpapi`. Tokens, client IDs and subjects are
not returned to the renderer. The browser receives only opaque profile IDs,
stable labels and masked account information. Authorization URLs are opened
locally, not returned to tablets. Runtime data is ignored by Git and excluded
from both desktop packaging configurations.

Generation runs through Codex app-server over stdio and the official
`https://api.openai.com/v1` Responses endpoint. The official child uses a separate
`CODEX_HOME`, receives its access token only in its process environment, and has
`OPENAI_API_KEY` removed. Tokens are refreshed by the host; a changed token
restarts the child. No private ChatGPT backend endpoint is used by the official
connection.

Codex can use live web search and local tools, subject to model/account policy.
The isolated official runtime loads the current account catalog with
`model_catalog_json`. It adapts only `supports_search_tool` to false because
subscription sharing currently rejects Codex's built-in `tool_search` discovery
tool. This does not disable `web_search`, shell, files or developer-defined tools,
and does not change model IDs or reasoning options. The CLI-login path is unchanged.
Its disposable workspace is under the game's data directory, with
`workspace-write` sandboxing and network access. Approval is non-interactive:
**only use trusted scenarios/prompts and a trusted local machine**. This is an
agent runtime, not a text-only API transport.

Routes are loopback-only by default, reject unrelated origins and DNS-rebinding
hostnames, and never return tokens. Authentication/account changes remain
host-only. For trusted private-LAN play, explicitly set
`OH_CODEX_ALLOW_PRIVATE_LAN=1` before launch and enable the game's normal LAN
sharing. This does not authenticate other LAN users; anyone with access to that
shared server can use its generation allowance. Do not expose it to an
untrusted/public network or reverse proxy.

## Limitations and validation boundaries

- Official credential storage/browser launching is Windows-only. Secure macOS,
  Linux and Android storage requires separate implementations.
- Standalone hosted-web and Android builds do not gain local Codex support.
- OpenAI's ChatGPT plan route remains a preview with different supported request
  fields/tools from the normal API. Usage/credit permissions stay under the
  user's control in ChatGPT.
- Sign-in denied, expired or revoked, catalog failures and generation failures
  are surfaced without forwarding raw authentication service responses.
- Tests cover OAuth callback validation, identity, profiles, encrypted storage,
  refresh recovery, catalog visibility and reasoning, schema normalization,
  progress parsing and local/LAN origin guards. Tests do not assume that a model
  listed in a bundled catalog is usable by every account.

## References

- [OpenAI OSS plan usage](https://developers.openai.com/siwc/token-sharing-open-source)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Codex app-server configuration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
