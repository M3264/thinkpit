# Provider connections

ThinkPit starts with free models and keeps provider choice explicit. There is no automatic substitution when a provider fails.

## Available now

- OpenAI-compatible chat completion endpoints: streaming text plus a validated conversational control record.
- Anthropic Messages API: native request headers and streaming event/usage normalization.
- Reachable local endpoints: configure their OpenAI-compatible base URL and leave the key empty when they need no authentication.
- Provider API keys: server-side AES-GCM encryption in the web backend; environment variable references in the headless runner.

The [Pollinations API documentation](https://github.com/pollinations/pollinations/blob/master/APIDOCS.md) describes an anonymous text endpoint. The live catalog and generation were tested on September 30, 2026; the example selects `openai-fast`, currently described as GPT-OSS 20B. Both participants use the same underlying model with distinct identities. This establishes live interaction, not model diversity.

OpenRouter's [free model documentation](https://openrouter.ai/docs/guides/routing/routers/free-router) supports explicitly choosing `:free` models with an API key. `examples/openrouter.json` includes two IDs confirmed in the live model catalog on September 30, 2026. They can become unavailable or rate limited. Generation through this provider has not been tested without a user-supplied key. The random `openrouter/free` route is not a default because it changes the underlying model.

## Planned account connections

Connecting a user's OpenAI/ChatGPT or Claude account is a requested product direction. Implement each through supported provider mechanisms; an account subscription is not interchangeable with an inference API key.

OpenAI documents ChatGPT-managed login in the [Codex app-server account API](https://developers.openai.com/codex/app-server). A future local Codex adapter can investigate that supported bridge, its model selection, usage limits, and cancellation semantics. It needs an isolated provider module with tool execution disabled unless ThinkPit explicitly grants it. This is a planned integration, not a login flow implemented in this backend.

Anthropic states that [Claude subscriptions and API access are separate](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-do-i-have-to-pay-separately-to-use-the-claude-api-and-console). Claude Console API-key connection works through the current Anthropic adapter. A Claude subscription connection needs a separately verified, supported integration path before implementation; the backend does not import browser sessions or reuse unrelated OAuth tokens.

An account adapter must preserve participant identity, reveal the provider before sending context, keep auth tokens server-side, cancel on interruption, and expose expiration and rate limits clearly. Provider-managed login and logout belong to that adapter rather than the conversation engine.
