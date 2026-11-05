# A ChatGPT boarding pass

Status: proposal and application draft, checked 2026-11-05. No application has been submitted, no OAuth client has been issued to this project, and no hosted ChatGPT sign-in is implemented.

**Yes: Sign in with ChatGPT can include permission to use a person's eligible ChatGPT plan for AI requests.** It does not grant their conversation history. OpenAI documents a direct flow for open-source, locally hosted applications and directs paid or remotely hosted applications to its interest form. Publishing our source does not make the shared ProjectForty2 website a local application. [Plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source)

## The two boarding gates

| Route | HEART OF GOLD status | Next step |
| --- | --- | --- |
| Local Codex | Implemented: the local app launches the visitor's installed CLI, which manages its own login. | Run `codex login`, complete ChatGPT sign-in, then launch the local app. |
| Direct local ChatGPT OAuth | Documented upstream; not implemented here. | Build a separate local authorization and streaming adapter if a CLI-free installation is useful. |
| Hosted ChatGPT OAuth | Requested direction; registration and approval remain outstanding. | Apply for sign-in **and plan usage**, then implement the approved hosted contract. |

Codex supports ChatGPT subscription authentication and separate API-key authentication. `codex login status` identifies the active method. The existing local integration leaves credentials with Codex; it does not upload a visitor's CLI credential files or attach the hosted site to their computer. A website-to-local companion bridge would be additional work. [Codex authentication](https://learn.chatgpt.com/docs/auth)

## Application draft: HEART OF GOLD

Use the [official interest form](https://openai.com/form/sign-in-with-chatgpt-interest/). The client-registration page currently describes a selected-partner program. This draft is ready for the project owner to review; required personal contact details are intentionally omitted from the repository. [Request a client ID](https://developers.openai.com/siwc/request-client-id)

| Form field | Proposed entry |
| --- | --- |
| Company name | ProjectForty2.ai — project name; owner should confirm the appropriate organization name. |
| Website URL | `https://projectforty2.ai/heartofgold/` |
| Capabilities | Sign in and ChatGPT plan use for AI requests |
| Work email, first name, last name | Owner supplies privately when submitting. |
| Job title | Optional; owner supplies privately. |

Product description draft:

> HEART OF GOLD is ProjectForty2.ai's MIT-licensed community experiment in visible, bounded agent delegation. A visitor supplies a task; a coordinator can create a small crew, show their progress, and synthesize their text reports. The hosted implementation limits each mission to seven agents, depth two, and three concurrent calls. It supplies no shell, browser, filesystem, or account tools. Source: https://github.com/techno-optimist/heart-of-gold. We want visitors to authorize eligible ChatGPT plan usage through Sign in with ChatGPT instead of entering an API key. We request guidance and approval for a remotely hosted, multiuser integration, including plan eligibility, permitted scopes, usage limits, and token lifecycle requirements.

This draft makes no claim about audience size, partner status, or successful hosted plan-funded inference.

## Proposed hosted rollout

1. Obtain approval for both identity and plan usage, an issued client ID, and the registered client authentication method. Proposed callback: `https://projectforty2.ai/heartofgold/auth/openai/callback`. This route is neither registered nor implemented. Register a separate exact callback for each additional environment.
2. Implement authorization-code OAuth with PKCE S256, fresh state and nonce, expiring one-use transactions, backend code exchange, and verified ID-token signature, issuer, audience, expiry, and nonce. Discover OpenAI endpoints from `https://auth.openai.com/.well-known/openid-configuration`. Use a maintained OIDC library and create our own secure application session. Keep any provisioned client secret server-side. [Website integration](https://developers.openai.com/siwc/website)
3. Implement a distinct plan-usage adapter and connection state. Check granted inference permission before enabling launch. Preserve mission bounds, cancellation, session isolation, and explicit failure states. Stop on exhausted plan usage; any move to API billing must be a separate visitor choice.
4. Test denial, callback replay, expired credentials, refresh races, disconnect during inference, cross-user isolation, and usage-limit failures. Record a consenting account's completed synthetic mission before describing hosted plan usage as verified. Show the actual sign-in control only when the integration is ready.

### Scope and inference requirements

The website identity guide uses `openid profile email`. Identity-only sign-in yields an ID token; it does not promise inference access or refresh tokens. The hosted plan-usage grant and scopes must be confirmed during approval. [Identity contract](https://developers.openai.com/siwc/website)

The **separate local OSS flow** specifies `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, with resource `https://api.openai.com/v1`. It starts registration with `dynamic_agent_client`, an application name and persistent opaque `ext_agent_host_id`, then retains the issued client ID. It requires an HTTP `127.0.0.1` loopback callback, fresh state/nonce/PKCE, and verification of the returned `chatgpt.tokens.use.direct` grant. These are local-flow instructions, not permission to substitute our hosted callback. [Local registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

The documented plan-usage catalog returns `models` with `slug`, `display_name`, and `visibility`; this differs from our API-key model parser. Inference uses the public Responses API with `store:false` and `stream:true`. Success requires `response.completed`; interrupted streams and usage-limit failures must remain failures. Our current nonstreaming API-key adapter cannot be relabeled as this integration. [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

The plan-usage preview also rejects `max_output_tokens` and explicit system-message items. A new adapter must use supported instructions/developer messages and retain local time, byte, and delegation limits without promising our API adapter's 4,096-token output cap. Confirm the approved hosted request contract before implementation. [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

For a proposed local OAuth adapter, keep credential records private to the local installation and implement rotating refresh-token updates atomically. Hosted credential retention, refresh, revocation, and disconnect behavior must follow the approved hosted contract. Never collect a ChatGPT browser cookie or ask someone to paste a subscription token into the API-key field. [Local credential lifecycle](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
