# Bring your own improbability drive

HEART OF GOLD's hosted provider adapter supports user-owned **API access** for OpenAI, Claude, and Grok. An API connection is different from signing into a consumer chat subscription. The adapter does not collect chat cookies, scrape browser sessions, or repurpose subscription tokens.

## Connection choices

| Provider | Credential | Where to obtain it |
| --- | --- | --- |
| OpenAI | OpenAI API key | [API keys](https://platform.openai.com/api-keys) |
| Claude | Claude Console API key; workspace ID when required | [Claude Console keys](https://platform.claude.com/settings/keys) |
| Grok | xAI API key | [xAI Console](https://console.x.ai) |

Usage is charged to the credential owner's provider access. Node, depth, concurrency, and output-token limits constrain this experiment; they are not a guaranteed dollar-spend cap. Keep a provider-side spending limit where available.

Claude's policy does not permit a third-party application to offer Claude.ai subscription login or collect consumer session credentials. It separately describes users signing into an unmodified Claude Code binary; this HTTP API adapter does not implement that architecture. Eligible Claude subscriptions may include claimable Console API credits, which still use API access. [Authentication policy](https://code.claude.com/docs/en/legal-and-compliance), [subscription API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)

Grok and xAI API can share account identity while using separate billing. No general third-party Grok subscription OAuth flow is implemented here. [Account FAQ](https://docs.x.ai/console/faq/accounts)

## Where the key goes

The browser sends the API key to this application's backend over HTTPS. The backend uses it in an authorization header on a fixed provider endpoint. This is **not** a promise that the application operator cannot access a key. Hosting operators must protect their process, transport, session ownership, logs, and infrastructure.

`ProviderAdapter` holds credentials in private in-memory fields. Serializing the adapter does not serialize the key. Keys are not included in model prompts, activity messages, results, or exceptions. Provider error bodies and transport error strings are deliberately not echoed. A response that contains the exact active key is rejected. These controls reduce accidental disclosure; they do not make untrusted hosting safe.

The hosting layer owns session expiry and disconnect, per-user authorization, CSRF protection, and vault cleanup. Credentials must not be written to run snapshots, browser storage, analytics, source control, or public receipts. Do not expose this provider adapter through an unauthenticated arbitrary proxy endpoint.

## What a hosted agent can do

Each call receives its assignment and, during synthesis, bounded child reports. It produces a structured text result or requests bounded child tasks through the coordinator. **No tools are supplied:** it cannot browse the web, execute code, modify files, operate an account, or perform actions. It must identify external verification still needed. This differs from the separate local Codex CLI adapter.

OpenAI and Grok use the Responses API with `store:false`; Claude uses the Messages API. Setting `store:false` disables response storage for that API feature; it is not a claim that the provider retains no operational or abuse-monitoring data.

## Bounds and failure behavior

- Fixed HTTPS endpoints: `api.openai.com`, `api.anthropic.com`, and `api.x.ai`. Redirects are rejected.
- Maximum output budget: 4,096 tokens per call by default; the adapter allows lower budgets down to 256.
- Each provider request has a 90-second maximum window and a 1 MiB response cap.
- No automatic retry and no automatic switch to another provider or a simulator.
- Truncated, refused, malformed, unsupported, secret-echoing, or over-budget delegation results fail visibly.
- Activity may show provider-reported input/output token counts, never an invented cost estimate.

Timeout and cancellation abort the local HTTP request. They cannot retract tokens already processed or guarantee that a remote provider immediately stops billing work in progress.

## Model discovery

Discovery uses authenticated provider model endpoints and returns only model IDs and labels. Claude capability/lifecycle metadata is honored. Where explicit capability metadata is absent, conservative documented text-model families are used; obvious audio, image, embedding, search-only, and harness-specific models are excluded. The first 100 catalog entries are inspected, with at most five Claude pages. A listed model remains a candidate: actual schema support, access, quota, and completion are checked when a mission runs.

Do not advertise a model as live-tested based on model-list discovery. Provider permissions and availability can change after connection.

## Developer contract and checks

`lib/provider-adapter.mjs` exports `PROVIDERS`, `discoverModels`, `ProviderAdapter`, and `ProviderError`. The adapter implements the same `run` input/result contract as the local adapters. An optional gate must expose `acquire(signal)` and return a release function. Credentials are supplied by the hosting layer, not by the mission text.

`ProviderError.code` is safe for application branching. HTTP errors also carry a numeric `status`; 401/403 use `authentication`, 429 uses `rate_limit`, and 5xx uses `unavailable`. Messages are sanitized. Do not replace them with raw upstream response bodies in a caller.

The provider test suite uses synthetic keys and mocked HTTP responses. It checks request shapes, fixed destinations, model filtering, limits, cancellation, refusal/truncation handling, gate release, and credential-safe errors. These tests do not establish successful live access to any provider account.

## Primary implementation sources

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Claude authentication](https://platform.claude.com/docs/en/manage-claude/authentication), [model discovery](https://platform.claude.com/docs/en/api/models/list), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Grok Responses migration](https://docs.x.ai/developers/model-capabilities/text/comparison), [model discovery](https://docs.x.ai/developers/rest-api-reference/inference/models), [structured outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs)

Checked 2026-11-05. Exact API behavior should be rechecked when changing provider versions or authentication flows.
