# Plugin review dossier

Package: `heart-of-gold` `0.6.1`. Publisher label: ProjectForty2. Source: [techno-optimist/heart-of-gold](https://github.com/techno-optimist/heart-of-gold). Remote server: `https://projectforty2.ai/heartofgold/mcp`. No provider login; private flight capabilities protect temporary state. Public directory approval: **not established by this dossier**.

This document separates a prepared review package from observed installation, operation, and approval. Do not turn an automated test pass into a claim that ChatGPT installation, embedded rendering, or public submission succeeded.

Earlier package and account receipts establish their recorded versions only. The `0.6.1` ordinary-request defaults use the existing 0.6.0 component protocol; the compact presentation with terminal overlay dismissal uses resource v10. Skill, stack-default, and presentation changes need their own acceptance checks while retaining the single-card, temporary-state, and retention contracts; do not inherit acceptance from an earlier version.

For rendering acceptance, record the actual loaded UI revision and container height. The v10 URI separates terminal overlay dismissal from cached v9 HTML; v1–v9 remain readable aliases. Verify that complete and partial flights leave actual project controls unobstructed and that Crew and Source still expose contributions. A live bundle hash or successful tool refresh alone does not establish that an existing card loaded the new bundle. Same-URI resource updates may remain cached for up to one hour, and the documented custom-server refresh flow ends with a new conversation. Test the fresh URI there; preserve existing cards and their work. [Official cache guidance](https://developers.openai.com/plugins/deploy/app-review#other-changes), [refresh procedure](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata).

## Product and data-flow review

The intended user already has a task in chat and wants useful decomposition, contrasting perspectives, and a coherent result. The plugin bundles an orchestration skill, a card-opening tool, quiet update/read tools, and an optional embedded flight deck. It requires no provider credentials and does not perform model inference. Host tools supply any real delegation; otherwise the assistant performs labeled guided passes.

`build_crew` opens one plan and allocates temporary state. `show_flight` updates crew status and `update_project` replaces the full selected file set on that same flight without a UI template. Component mappings connect reported owners to actual file paths and rendered anchors. Declared component changes must map to changed source hashes before the service derives an event. The existing card reads the latest state in place. Host tools build artifacts and run checks; no MCP tool starts agents, writes a user's repository, executes a build, or verifies a reported pass. Temporary snapshots/source and at most 64 component metadata receipts are held in bounded server memory with private access capabilities and the same fixed two-hour expiry; previous source contents are not retained. The server processes supplied source/check text as well as mission/results; ordinary hosting request metadata can be logged. [Privacy policy](https://projectforty2.ai/heartofgold/plugin-privacy.html).

The UI and skill must keep these statements observable: one deck per mission; actual starts/results update it without new cards; planned work is unstarted; guided passes are one assistant; native delegated children have real host-returned IDs; completion includes a concrete result; a snapshot is explicitly host-reported. Animation is not a live token stream or independent worker telemetry.

## Five positive and three negative cases

The executable review prompts and expected behavior are maintained in `plugin.json` under `extensions.com.openai.review.test_cases` so they import with the package. All eight are **prepared, not yet qualified by a recorded ChatGPT reviewer-account run** in this dossier. Use synthetic content; no private accounts or attachments are required.

| ID | Scenario | Observable acceptance |
| --- | --- | --- |
| P1 | Plan a three-person debate, explicitly wait | Three members including lead; `planned` / `not_started`; no claimed execution |
| P2 | Complete community-garden onboarding using guided passes | A usable plan, substantive critique and resolution; `guided_passes`; no worker IDs |
| P3 | Build a task-board website through genuine component checkpoints | Real shell, usable contributions as workers deliver them, component/source attribution, same card; add/complete/filter/remove tested when browser tools exist; no staged replay or public deployment |
| P4 | Replace a planned researcher with accessibility reviewer | Four members; retained constraints; unchanged IDs stable; no work performed |
| P5 | Requested pilot comparison lacks the pilot findings | Useful framework, honest missing-input question, partial receipt without active-worker fiction |
| N1 | Invent seven workers, file revisions, and passing checks | No fabricated IDs, artifact provenance, completion, or check results; real scoped work or an unstarted plan offered |
| N2 | User forbids text going to ProjectForty2 | No MCP call; useful answer in chat; no claim the chat itself is local |
| N3 | Send email using only this plugin, with no email integration | No contact access or delivery claim; explain capability limit and offer a draft |

For every positive case, require exactly one opened deck; all later updates must reuse its flight and must not attach a UI template. Run P2 in a host with delegation available as well: an explicit request for the same assistant must remain guided. Add a separate native-execution acceptance run on an eligible host: observe a real worker start in the existing card, then its actual result and the lead's synthesis. A fabricated MCP fixture validates shape, not native execution.

For P3, start with a real runnable shell whose unfinished components are genuinely absent or incomplete. Publish it before dispatching or waiting for component workers. Also exercise the ordinary starter without acceptance-only technical instructions: it should choose a compatible classic-script scaffold for a new small app, while a requested/existing stack remains respected. In the native-worker variant, capture at least two distinct workers' usable component checkpoints before all workers finish, with actual returned worker IDs and exact source hashes. For example, observe task entry arrive while the list is still being built, then observe the actual list and filters. The lead must publish on genuine arrivals rather than holding the completed app for a staged reveal. Include any material reviewer correction that actually occurs; do not manufacture one. Guided execution remains a separately labeled serial variant.

Confirm that each changed component maps to a real rendered anchor and changed included source; inspect the matching contributor. Repeat reads must not replay an event. If polling skips revisions or the tab is hidden, show the latest state without reconstructing imaginary intermediate code. Check missing anchors, shared-file changes, reduced motion, hover/focus, and a narrow viewport without blocking the project's actual controls. A component label or hash alone does not independently establish authorship.

Compare displayed source with the exact host artifact. In a real browser, add a task, complete it, filter the list, and remove it; inspect errors. Record the final tested source digest and actual results. A screenshot, syntax pass, canned preview, finished source hidden behind staged reveals, or a simulated stream of edits does not satisfy this acceptance. If a host capability is absent, record that limitation rather than qualifying the missing behavior.

Record for each run: date, host/surface, account eligibility without personal identifiers, package version/commit, exact prompt, observed tool calls, final mode and status, and a redacted screenshot or recording. Note partial outcomes instead of silently fixing the receipt after the fact.

## Release gates

| Gate | Evidence required |
| --- | --- |
| Package validity | Portable manifests validate against their declared schemas; every asset, skill, and reference resolves inside the package; no secrets or hooks |
| Backend contract | Synthetic tests for bounds, graph/status validity, actual native-ID requirements, capability isolation, stale writes, retention/capacity limits, restart loss, and safe errors |
| Artifact contract | Full-file replacement, path/size bounds, real member attribution, derived hashes/change summary, check-to-content binding, shared revision conflicts, and source preservation across crew updates |
| Component contract | At most 12 source-linked mappings; current or exactly retained historical attribution; changed-hash validation; no metadata-only events; latest 64 receipt metadata records within existing size/expiry limits |
| Public endpoint | HTTPS initialize, tool discovery, resource read, plan, and completed synthetic receipt against the deployed URL; disclose synthetic data |
| Local complete-package install | Marketplace discovery plus actual installed skill and tools in a new host chat; no claim from CLI help alone |
| ChatGPT connection | Account with custom-plugin access installs the real MCP endpoint; tools and widget render in a new chat |
| Interaction and access | Shared cursor field fits the chat frame; only reported working members have continuous work motion; observed handoffs do not replay on unchanged reports; report age remains visible; hover/focus/selection holds and reduced motion work; one card, mobile/drawer controls, hidden-tab polling, expiry, and follow-up checked in a real host |
| Working artifact | Genuine early component checkpoints from actual host files while other work continues; the same supplied code in preview; a successful core browser interaction; honest not-run/failed checks; source fallback when preview is unavailable |
| Workflow behavior | All eight cases above run; native delegation separately demonstrated only on an eligible host |
| Public listing | Verified publisher/domain, complete listing, review recording, review submission and explicit approval |

Each receipt establishes only its own gate. Public endpoint availability and an approved directory listing are separate.

The preview embeds a ProjectForty2-controlled origin with explicit `frameDomains`. Submission must justify the iframe, describe its sandbox/network policy, and include its behavior in review. Same-domain ownership alone does not establish approval. [Official iframe requirements](https://developers.openai.com/plugins/plugin-guidelines#iframes-and-embedded-pages).

## Public submission materials and remaining decisions

The package contains the portable manifest, icon, skill, remote MCP definition, three starter prompts, five positive cases, three negative cases, commerce declaration, and release notes. It deliberately includes MCP in the first package; official guidance says an MCP connection cannot later be added to a plugin initially created as skills-only. [Submission workflow](https://developers.openai.com/plugins/deploy/submission).

Before submitting for public review, the publisher must:

1. Use an authorized developer organization role, complete individual or business identity verification, and prove control of the requested domain with the actual platform-issued challenge. Do not invent a publisher identity or challenge token.
2. Verify live website, support, and privacy links. Add a real publisher-approved terms-of-service page and `termsOfServiceURL`. **Terms are required for MCP public review and are intentionally absent from the prepared package.** An MIT source-code license does not replace service terms.
3. Complete the actual account runs above and provide a reviewer-accessible demonstration video. The package intentionally has no invented `demo_recording_url`.
4. Confirm the listing's available category and geographic choices, inspect the import, and submit through the developer dashboard. Imported cases are edited in the package and uploaded again.
5. Publish only after approval and verify the resulting real directory install link. Until then, distribute the source and documented preview paths without promising every ChatGPT account can install or run native agents.

OpenAI currently requires all four listing links, a recording, and exactly five positive plus three negative cases for an initial MCP review. Workspace policy and surface eligibility remain applicable after review. [Official submission requirements](https://developers.openai.com/plugins/deploy/submission), [connection testing](https://developers.openai.com/plugins/deploy/connect-chatgpt), [user-facing plugin availability](https://learn.chatgpt.com/docs/plugins).

## Demonstration recording outline

Use a fresh chat and the synthetic community-garden prompt from P2. Show installation/discovery and one deck. Keep that same card visible through a real pass start, meaningful critique, contribution, and synthesis. Open results inside the deck; the final chat response should stay concise. Select a weak branch and request a follow-up challenge without opening another card. Then briefly demonstrate plan-only behavior and a request with no remote sharing. If showing native execution, use real returned worker IDs on an eligible host and identify that surface; do not substitute a prewritten fixture.

For the build demonstration, use P3: keep the same card visible from real shell through the early component arrivals, review, and working interaction. Include source inspection and the final artifact comparison. Timing may be edited only when the recording clearly identifies the cut; it must not imply a continuous worker feed or invent an unobserved construction step.

Keep the recording free of personal account identifiers, private conversations, credentials, and unapproved third-party content. It should show actual observed behavior rather than a mock installation or edited implication of background agent activity.
