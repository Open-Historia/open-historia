# OpenCode Zen: first-time setup

OpenCode Zen gives Open Historia access to free and paid AI models. **Start with free models.** You do not need to enable paid models in the game to try them. Free offers, account requirements and rate limits are controlled by OpenCode and can change.

## 1. Create a key

1. Open **[OpenCode](https://opencode.ai/auth)** and sign in, or create an account.
2. In your OpenCode workspace, open **API Keys** and choose **Create API Key**. The exact button wording may change.
3. Name the key **Open Historia**, create it, and copy the **entire secret value**. The key's name, your account password and a Go subscription receipt are not API keys.
4. Keep the key private. Do not include it in screenshots, messages, bug reports or Git commits. If you accidentally share it, revoke it in OpenCode and create another.

## 2. Paste it into the game

1. Use the **Open Historia desktop app** or run the game on **your own local server**.
2. Open the game menu → **Settings → AI** and choose **OpenCode Zen**.
3. Paste the secret into **OpenCode Zen API Key**.
4. Leave **Enable paid Zen models** switched **off**.
5. Click **Load models**, then choose a model in **Free tier**. Alternatively, leave **Model** empty: the game looks up the current catalogue and selects a supported free model. It will not fall back to a paid model.
6. Settings save automatically in this browser/app profile. Return to the game, open the advisor and send a short message such as “Hello”. This tests actual generation. **Loading the catalogue does not validate your key or balance.**

The address is built in: `https://opencode.ai/zen/v1`. Do not substitute the Go address (`/zen/go/v1`). Keys remain in the same browser-local settings storage used by the other providers. Requests go directly to OpenCode, with the existing relay on **your local game server** used if necessary. No new hosted proxy is involved.

**Website limitation:** at the time of integration, Zen does not supply the CORS headers required for cross-origin browser requests. The hosted game website therefore may fail with “Failed to fetch” or a CORS error. Use the desktop app/local server instead. Do not disable browser security or give a public proxy your key.

## 3. Go vs. Zen — avoid unexpected charges

- **Go** is an OpenCode subscription with its own endpoint and allowance.
- **Zen** has its own free offers and pay-as-you-go billing. A key used with Go may also access Zen free models, but **a Go subscription does not pay for Zen paid-model requests**.
- Paid Zen models are blocked in the game by default, including per-task model overrides and a `model` override in custom JSON.
- To deliberately use a paid model: check **Zen Billing** in your OpenCode workspace, add credit if needed, set a spending limit, turn on **Enable paid Zen models**, and explicitly choose the desired model.
- Even after enabling paid models, leaving **Model** blank still auto-selects only a free model. An unavailable free model is never silently replaced with a paid one.
- The free label comes from Zen's published free model IDs/offers; it is **not a live price quote** or a promise of unlimited access. Check [current pricing](https://opencode.ai/docs/zen/#pricing).

## Supported models

This connection currently supports Zen's **Chat Completions** families: Big Pickle, MiMo, Ling, Nemotron, DeepSeek, GLM, Kimi and MiniMax. Available IDs are loaded from `/models`, with supported free models shown first. You can also paste an exact model ID; an `opencode/` prefix is accepted.

Zen's catalogue also contains models requiring other protocols: GPT/Grok/Muse use Responses, Claude and the documented Qwen Plus/Max models use Messages, and Gemini uses its native API. These are **not supported by this connection yet**, and are not offered in the selector. See Zen's [endpoint table](https://opencode.ai/docs/zen/#endpoints). Listing a model does not guarantee that your workspace/key has access to it.

For advanced use, the provider supports per-task models, custom request parameters, streaming and the game's existing structured-output fallback ladder. Model changes reset the structured-output preference to Auto, just as for the other gateways.

## Quick fixes

| Message / symptom | What to do |
|---|---|
| Invalid API key | Copy the full secret again. Make sure you did not paste its name/password. Create a replacement if the old key was revoked. |
| Insufficient balance | Choose a free model or check **Zen** Billing. Go credit/allowance is separate. |
| Rate limit / busy / 429 | Wait and retry, or choose another free model. Repeated retries do not remove a free-tier limit. |
| Model not found / access denied | Reload the model list; check workspace model permissions. Free offers may have ended. |
| Paid models disabled | Choose a free model, or deliberately enable paid models after checking billing. Check per-task overrides and custom JSON too. |
| Failed to fetch / CORS | Use the desktop app or your own local server. Do not use a public key-handling proxy. |
| No supported free model listed | Wait for an available free offer, enter a known supported free ID manually, or deliberately configure paid access. Nothing paid was selected automatically. |

**Privacy:** some free models may collect prompts/replies for model improvement; NVIDIA trial endpoints warn against personal or confidential data. Read [Zen's privacy terms](https://opencode.ai/docs/zen/#privacy) before sending anything sensitive.

---

## Короткая инструкция по-русски

1. Откройте [OpenCode](https://opencode.ai/auth), войдите или зарегистрируйтесь.
2. В рабочем пространстве откройте **API Keys → Create API Key**, назовите ключ **Open Historia** и создайте его. Скопируйте весь секретный ключ, а не его название и не пароль от аккаунта.
3. В **настольной игре** откройте **Settings → AI → OpenCode Zen** и вставьте ключ в **OpenCode Zen API Key**. Настройки сохраняются автоматически.
4. Переключатель **Enable paid Zen models** оставьте **выключенным**. Нажмите **Load models** и выберите модель из **Free tier**. Можно оставить поле **Model** пустым — игра попробует выбрать доступную бесплатную модель сама. На платную она сама не переключится.
5. Вернитесь в игру и отправьте советнику короткое «Привет». Загрузка списка моделей сама по себе **не проверяет** ключ и баланс.

**Подписка Go и баланс Zen — разные вещи.** Ключ аккаунта с Go может работать на бесплатных моделях Zen, но подписка не оплачивает платные запросы Zen. Для платных моделей отдельно проверьте **Zen Billing**, пополните баланс при необходимости, установите лимит расходов и только затем включайте платные модели в игре.

Если написано **Invalid API key** — скопируйте ключ заново или создайте новый. **Insufficient balance** — выберите бесплатную модель либо проверьте баланс Zen. **429 / Rate limit** — подождите или выберите другую бесплатную модель. **Failed to fetch / CORS** на сайте — используйте настольную игру или свой локальный сервер: сейчас Zen не разрешает прямые запросы из чужого браузерного сайта.

Никому не отправляйте ключ, не показывайте его на скриншотах и не вставляйте в публичные прокси. Если раскрыли — отзовите его в OpenCode и создайте новый. Не отправляйте бесплатным моделям личные или секретные данные: у некоторых есть условия об использовании запросов для улучшения моделей. Бесплатные предложения и ограничения могут меняться.
