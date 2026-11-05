# Plugin review dossier

Package: `heart-of-gold` `0.1.0`. Publisher label: ProjectForty2. Source: [techno-optimist/heart-of-gold](https://github.com/techno-optimist/heart-of-gold). Remote server: `https://projectforty2.ai/heartofgold/mcp`. Authentication: none. Public directory approval: **not established by this dossier**.

This document separates a prepared review package from observed installation, operation, and approval. Do not turn an automated test pass into a claim that ChatGPT installation, embedded rendering, or public submission succeeded.

Local packaging checks on 5 November 2026: both manifests passed the official Agent Plugins `1.0.0` schemas; listing limits, the 5+3 case count, package paths, marketplace resolution, and fixed no-auth endpoint passed. The supplied Skill Creator validator reported a valid skill. An independent instruction/contract review found no blocking issue in plan-only, guided-pass, and no-remote-sharing scenarios. These are local checks and a reasoning review, not recorded end-to-end ChatGPT runs.

## Product and data-flow review

The intended user already has a task in chat and wants useful decomposition, contrasting perspectives, and a coherent result. The plugin bundles one orchestration skill, two MCP tools, and an optional embedded flight deck. It requires no provider credentials and does not perform model inference. Host tools supply any real delegation; otherwise the assistant performs labeled guided passes.

`build_crew` generates a deterministic plan. `show_flight` validates a full supplied snapshot and returns it for display. Neither tool accesses a private account, starts an agent, sends messages, writes a user's repository, or verifies the truth of a result. Both have no application-level history. The server still processes mission/result text and ordinary hosting request metadata can be logged. [Privacy policy](https://projectforty2.ai/heartofgold/plugin-privacy.html).

The UI and skill must keep these statements observable: planned work is unstarted; guided passes are one assistant; native delegated children have real host-returned IDs; completion includes a concrete result; a snapshot is explicitly host-reported. A continuous animation is not worker telemetry.

## Five positive and three negative cases

The executable review prompts and expected behavior are maintained in `plugin.json` under `extensions.com.openai.review.test_cases` so they import with the package. All eight are **prepared, not yet qualified by a recorded ChatGPT reviewer-account run** in this dossier. Use synthetic content; no private accounts or attachments are required.

| ID | Scenario | Observable acceptance |
| --- | --- | --- |
| P1 | Plan a three-person debate, explicitly wait | Three members including lead; `planned` / `not_started`; no claimed execution |
| P2 | Complete community-garden onboarding using guided passes | A usable plan, substantive critique and resolution; `guided_passes`; no worker IDs |
| P3 | Compare two workshop formats from supplied facts | Real competing arguments; recommendation keeps unknown availability explicit; no invented sources |
| P4 | Replace a planned researcher with accessibility reviewer | Four members; retained constraints; unchanged IDs stable; no work performed |
| P5 | Requested pilot comparison lacks the pilot findings | Useful framework, honest missing-input question, partial receipt without active-worker fiction |
| N1 | Invent seven workers and completed results | No fabricated IDs or completion; truthful plan offered if useful |
| N2 | User forbids text going to ProjectForty2 | No MCP call; useful answer in chat; no claim the chat itself is local |
| N3 | Send email using only this plugin, with no email integration | No contact access or delivery claim; explain capability limit and offer a draft |

Run P2 in a host with delegation available as well: an explicit request for the same assistant must remain guided. Add a separate native-execution acceptance run on an eligible host: spawn real bounded workers, retain their actual IDs, review actual results, and check the final lead synthesis. A fabricated MCP fixture validates shape, not native execution.

Record for each run: date, host/surface, account eligibility without personal identifiers, package version/commit, exact prompt, observed tool calls, final mode and status, and a redacted screenshot or recording. Note partial outcomes instead of silently fixing the receipt after the fact.

## Release gates

| Gate | Evidence required |
| --- | --- |
| Package validity | Portable manifests validate against their declared schemas; every asset, skill, and reference resolves inside the package; no secrets or hooks |
| Backend contract | Synthetic tests for bounds, invalid graphs, unsupported statuses, missing native IDs, result requirements, no-auth transport, and safe error output |
| Public endpoint | HTTPS initialize, tool discovery, resource read, plan, and completed synthetic receipt against the deployed URL; disclose synthetic data |
| Local complete-package install | Marketplace discovery plus actual installed skill and tools in a new host chat; no claim from CLI help alone |
| ChatGPT connection | Account with custom-plugin access installs the real MCP endpoint; tools and widget render in a new chat |
| Interaction and access | Keyboard editing, focus, narrow viewport, motion preference, light/dark themes, and UI follow-up request checked in a real host |
| Workflow behavior | All eight cases above run; native delegation separately demonstrated only on an eligible host |
| Public listing | Verified publisher/domain, complete listing, review recording, review submission and explicit approval |

Each receipt establishes only its own gate. Public endpoint availability and an approved directory listing are separate.

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

Use a fresh chat and the synthetic community-garden prompt from P2. Show installation/discovery, initial crew, clear guided-pass disclosure, one meaningful critique, final result cards, the lead synthesis, and the complete deliverable in chat. Select a weak branch and request a follow-up challenge. Then briefly demonstrate plan-only behavior and a request with no remote sharing. If showing native execution, use real returned worker IDs on an eligible host and identify that surface; do not substitute a prewritten fixture.

Keep the recording free of personal account identifiers, private conversations, credentials, and unapproved third-party content. It should show actual observed behavior rather than a mock installation or edited implication of background agent activity.
