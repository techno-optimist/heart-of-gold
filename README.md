# HEART OF GOLD

**Small crews. Improbable things.**

A [ProjectForty2.ai](https://projectforty2.ai/) open-source experiment in visible agent delegation. Give a crew a mission. Watch its lead ask for help, follow the branches, inspect the results, and keep the receipt.

Don't Panic. Bring a towel. Check the work.

## Choose your drive

| Flight mode | What happens |
| --- | --- |
| **Chat plugin — preview** | Build with the host’s available tools and watch genuine component checkpoints arrive, with source, crew attribution, and reported checks in one deck. Native workers when available; labeled passes otherwise. No provider key required. |
| **Hosted API crew — v0.2** | Connect your own OpenAI, Anthropic, or xAI API key, choose an account-listed model, and run a bounded text mission. The server coordinates real provider calls. |
| **Local Codex** | Your installed Codex CLI runs bounded tasks in read-only sessions. The CLI manages its authentication. |
| **Flight simulator** | A scripted demonstration exercises delegation and the interface. No model calls; output is demonstration content. |
| **GitHub Pages showcase** | A browser-only simulator. It has no execution backend and cannot access your local Codex. |

The v0.2 hosted app is live at [projectforty2.ai/heartofgold/](https://projectforty2.ai/heartofgold/). See the dated [flight check](docs/verification.md) for deployment and verification status. Hosted paid inference has **not** been tested with real provider credentials.

[Source and contributions](https://github.com/techno-optimist/heart-of-gold) · [Browser simulator](https://techno-optimist.github.io/heart-of-gold/) · [Provider access guide](docs/provider-access.md)

The standalone alpha produces text deliverables. The chat plugin uses the tools and permissions actually available in its host. Neither map is a recording of agent mouse movements. A completed flight means reported work completed; its conclusions still need review.

## Deploy the drive in chat

The [Heart of Gold plugin](docs/plugin.md) keeps one flight deck in the chat while the crew builds. The host publishes a real shell, assigns small components, and integrates each usable contribution as it arrives while other work continues. Selected source files, component ownership, and actual check results update that same deck; component anchors connect contributors to the rendered work. Inspect the files and isolated preview where supported. Updates follow real checkpoints, with host and polling latency. ProjectForty2 holds the latest flight/source and at most 64 component metadata receipts temporarily in server memory. Access expires after two hours, with no durable source history or automatic public deployment. Host file, browser, and delegation capabilities still apply. See the [plugin privacy notice](https://projectforty2.ai/heartofgold/plugin-privacy.html).

[Try the visual builder](https://projectforty2.ai/heartofgold/plugin-preview/) · [Install and use](docs/plugin.md) · [Public review checklist](docs/plugin-review.md)

The public ChatGPT directory listing is not approved yet. Custom-plugin access, embedded UI, and native delegation depend on the host and account. Installing this package does not unlock sub-agents or bypass plan limits.

## Hosted flight deck

Choose **Power the drive**, select OpenAI, Claude, or Grok, and supply your own API key. The backend checks the provider's model listing and returns candidate text models. Open **Flight settings** to choose a model and **Live agents**, then launch a small mission. Model-list access is not proof that every returned model will complete a mission: permissions, request compatibility, quota, and billing are checked during actual requests.

API access is separate from consumer chat access. A ChatGPT, Claude, or Grok subscription does not automatically supply an API key or API credit; eligible credit offers still need provider API setup. This version implements API-key access, **not** consumer-account OAuth or imported chat cookies. See [provider access](docs/provider-access.md) for official account links and current distinctions.

We want **Sign in with ChatGPT** to become the preferred OpenAI boarding pass. OpenAI supports eligible plan usage through OAuth, with separate approval for remotely hosted apps. The [hosted-access application](docs/chatgpt-sign-in.md) has been submitted and receipt confirmed. Access has not been granted and no OAuth button is active.

Your key travels over HTTPS to ProjectForty2 and stays in server memory for your temporary session. It is not written to browser storage, receipts, application logs, or the application's filesystem. A hosting operator can potentially access process memory; this is not an end-to-end secret vault. Prompts and results go to the chosen provider. Read [SECURITY.md](SECURITY.md) before entering sensitive material.

Sessions expire after **20 minutes without API activity**, or **one hour total**, whichever comes first. The latest five flights remain in that session. Expiry, restart, or a free-host shutdown loses the session, its key, and its history. **Disconnect** removes the key and cancels active work; history lasts until session expiry. Download results and receipts you want to keep.

Free hosting can sleep and take time to wake. An unavailable hosted backend is shown as a connection failure; it never silently becomes a simulated success. This is a small community alpha with capacity limits, not an always-on production service.

## Run locally

Requirements: Node.js 22 or newer.

```sh
git clone https://github.com/techno-optimist/heart-of-gold.git
cd heart-of-gold
npm ci
npm run build:plugin
npm start
```

Open [http://127.0.0.1:4242](http://127.0.0.1:4242). Try the simulator first. Click a crew member to inspect its task and full contribution, follow the ship's log, and save a receipt.

To use local agents, install the [Codex CLI](https://learn.chatgpt.com/docs/cli) and run `codex login` in your terminal. Restart after installing Codex, open **Flight settings**, select **Live agents**, and launch. “Codex installed” does not establish authentication, model access, or quota. Your CLI login stays with Codex; the local interface does not collect API keys.

The local server is for loopback use by one person. Do not expose `server.mjs` through a public tunnel. It persists records under `.flight-data/`; unlike hosted sessions, local history survives restarts. Interrupted work is marked interrupted and never automatically resumed.

## A useful first mission

> Draft a practical contributor onboarding guide for a small open-source project. Delegate an accessibility review and a skeptical review of the instructions, then combine their findings. Clearly identify assumptions and checks still needed.

Use public or synthetic material while exploring. Hosted agents have **no tools**: they cannot browse, execute commands, inspect files, or perform account actions. Frame research tasks as analysis and proposed checks, not verified internet research.

Compare the crew with one agent on the same task: result quality, time, usage where available, and human review. More cursors are not automatically better work.

## How the improbability drive works

```text
Mission → lead agent → bounded child tasks → child results
                    ↘ further delegation ↗
                 parent synthesis → final result + receipt
```

The coordinator owns scheduling, task identity, delegation, cancellation, and history. An adapter performs each call. Demo and live modes share the runtime contract and remain visibly distinct.

Per-flight ceilings: **7 agents, depth 2, 3 concurrent calls, 10 minutes**. Waiting parents release their execution slot before children run. Hosted provider calls have a 90-second deadline, bounded responses, and a 4,096-token maximum output budget per call. These are execution limits, **not a dollar-spend cap**. Cancellation cannot retract work already processed by a provider.

The local Codex adapter uses `codex exec` structured output and JSONL events. Workers start in separate directories with a read-only sandbox and without the user's Codex configuration. This controls writes; it is not a confidentiality boundary against reading files accessible to your account.

This application adds no analytics. Hosted mode uses an essential HttpOnly session cookie. Providers, Codex, browsers, and hosting infrastructure have their own behavior and retention policies. Review receipts before sharing.

## Host your own experiment

`hosted-server.mjs` is the hosted entry point, separate from the local CLI executor. It serves `/heartofgold/`, isolates browser sessions, and supports BYO API keys. Set `PUBLIC_ORIGIN` to the exact HTTPS origin visitors use. The [Render Blueprint](render.yaml) describes one free Node service; it does not configure a custom domain or alter the existing ProjectForty2 edge.

Preserve the `/heartofgold/` prefix, cookies, origin, flight-token header, and streaming responses behind a proxy. Optional ingress authentication uses a private `HOG_INGRESS_TOKEN` on the Node service and a matching `X-Hog-Ingress` header injected by the trusted edge. Configure both ends together; never publish the token. The initial ProjectForty2 deployment uses session/origin/token protection without this optional ingress secret. It ignores forwarded client-IP claims, so visitors behind the proxy share the socket-IP rate limit. `/heartofgold/api/health` is public for health checks.

The Blueprint disables automatic deploys. A restart clears all in-memory sessions. Keep `HOSTED_DEV` unset in production; development HTTP is limited to localhost.

## Help build the next improbable thing

- **Babel fish:** improve provider compatibility and model discovery with receipts.
- **Marvin's objections:** contribute tasks where a crew performs worse than one agent.
- **Towel checks:** improve accessibility, session isolation, and cancellation.
- **Ship's log:** improve exports, provenance, and honest failure explanations.

Start with [CONTRIBUTING.md](CONTRIBUTING.md), [provider access](docs/provider-access.md), and the [roadmap](docs/roadmap.md). Run the checks:

```sh
npm run build:plugin
npm run check
npm test
```

## Acknowledgements and license

The spark came from [Dhvanil Patel's swarm-cursors](https://github.com/DhvanilPatel/swarm-cursors), which credits [Joel Califa's Swarm](https://califa.github.io/swarm-site/) and its [source](https://github.com/califa/swarm-site). Their visual experiments made the question irresistible: what if the little cursors had real work to do?

This is an original implementation. No code or assets from those projects are included. We did not find a license grant in the upstream root listings inspected; public visibility is not treated as a reuse license.

The interface uses ProjectForty2’s midnight, ivory, and gold palette, self-hosted typography, and an original cursor renderer. See the [design notes](docs/design.md) and bundled [font licenses](docs/font-licenses.md).

Our original code is [MIT licensed](LICENSE). This is an unofficial, Hitchhiker-inspired experiment, not an authorized adaptation or affiliation with Douglas Adams's estate, publishers, or other rights holders. The software license grants no rights in third-party names, characters, branding, or works. ProjectForty2 is a personal experimental lab; this is a community invitation, not a claim of established governance or production readiness.
