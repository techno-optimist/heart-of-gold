# HEART OF GOLD

**Small crews. Improbable things.**

A [ProjectForty2.ai](https://projectforty2.ai/) open-source experiment in visible agent delegation. Give a crew a mission. Watch its lead ask for help, follow the branches, inspect the results, and keep the receipt.

Don't Panic. Bring a towel. Check the work.

## What is actually here?

| Flight mode | What happens |
| --- | --- |
| **Flight simulator** | A deterministic demonstration exercises the task tree and interface. No model calls. Its output is demonstration content. |
| **Live Codex** | Your locally installed Codex CLI runs real, bounded tasks. Agents can request child tasks; the coordinator runs those tasks and passes their results back for synthesis. |
| **Static showcase** | When no local server is available, the browser offers an explicitly labelled simulation. Live execution is unavailable. |

The first version produces text results and a persistent run record. It does **not** edit your repositories, merge branches, drive arbitrary browser tabs, or attach to an already-running chat. The animated map represents task activity; it is not a screen recording of agent mouse movements. A completed run means execution completed, not that its conclusions have been independently verified.

## Board the ship

Requirements: Node.js 22 or newer. The app has no npm runtime dependencies.

Clone the source, then start the local flight deck:

```sh
git clone https://github.com/techno-optimist/heart-of-gold.git
cd heart-of-gold
npm start
```

Open [http://127.0.0.1:4242](http://127.0.0.1:4242). Try the flight simulator first. Click a crew member to inspect its task and output; open the ship's log to follow events. Download the receipt before sharing a result.

The browser showcase runs a simulator only. Run this source package locally to connect Codex. A static website does not receive your local CLI credentials or run agents on your machine.

[Source and contributions](https://github.com/techno-optimist/heart-of-gold) · [Try the browser simulator](https://techno-optimist.github.io/heart-of-gold/) · [Verification receipt](docs/verification.md). The existing ProjectForty2.ai website is unchanged.

To use a real crew, install the [Codex CLI](https://learn.chatgpt.com/docs/cli) separately and authenticate with `codex login` in your terminal. Restart the app if you installed the CLI after starting it, select **Live Codex**, and launch a mission. CLI availability is not proof that authentication, provider access, or quota will succeed. Live errors remain visible; they never silently turn into a simulated success.

No API keys go into this web interface. Your CLI manages its authentication. Live runs use your provider access and can incur usage charges or consume plan allowances. The crew limits are execution limits, not a dollar-spend guarantee.

## A useful first mission

> Draft a practical contributor onboarding guide for a small open-source project. Delegate an accessibility review and a skeptical review of the instructions, then combine their findings. Clearly identify assumptions and checks still needed.

Use public or synthetic material while exploring. A good experiment compares the crew's result with a single agent's result on the same task, including time, usage where available, and human review. More cursors are not automatically better work.

## How the improbability drive works

```text
Mission → lead agent → bounded child tasks → child results
                    ↘ further delegation ↗
                 parent synthesis → final result + receipt
```

The coordinator owns scheduling, task identity, depth and crew limits, cancellation, and persistence. An adapter performs each agent call. The UI reads the resulting state and events. Demo and live modes use the same runtime contract, but remain visibly distinct.

The local Codex adapter uses structured output and JSONL events from `codex exec`. Workers start in separate task directories with a read-only agent sandbox. The host coordinator writes run records. Read-only is **not** a confidentiality boundary: it does not establish that the process cannot read other files accessible to your account. See [security and privacy](SECURITY.md) before using sensitive inputs.

Run data stays in `.flight-data/` on your machine. This application adds no analytics or default telemetry. In live mode, prompts and supplied context are sent through your configured Codex access; provider behavior and retention are governed by that service. Do not publish run records without reviewing them for private content.

## Help build the next improbable thing

- **Babel fish:** implement a second adapter with cancellation and lifecycle tests.
- **Marvin's objections:** contribute tasks where a swarm performs worse than a single agent.
- **Towel checks:** improve keyboard access, screen-reader descriptions, and reduced-motion behavior.
- **Ship's log:** improve receipt export, provenance, and failure explanations.

Start with [CONTRIBUTING.md](CONTRIBUTING.md), the [architecture decision](docs/architecture.md), and the [roadmap](docs/roadmap.md). Run the checks with:

```sh
npm test
```

## Acknowledgements and license

The spark came from [Dhvanil Patel's swarm-cursors](https://github.com/DhvanilPatel/swarm-cursors), which credits [Joel Califa's Swarm](https://califa.github.io/swarm-site/) and its [source](https://github.com/califa/swarm-site). Their visual experiments made the question irresistible: what if the little cursors had real work to do?

This project is an original implementation. No code or assets from those projects are included. We did not find a license grant in the upstream root listings we inspected; public source visibility is not treated as a reuse license.

Our original code is [MIT licensed](LICENSE). This is an unofficial, Hitchhiker-inspired experiment, not an authorized adaptation or an affiliation with Douglas Adams's estate, publishers, or other rights holders. The software license does not grant rights in third-party names, characters, branding, or works. ProjectForty2 is a personal experimental lab; this is a community invitation, not a claim of established project governance or a production service.
