# HEART OF GOLD release record

This document records release scope and authorized destinations. It is not a deployment receipt or evidence of successful paid provider inference.

## v0.1 history: local alpha and simulator

The owner authorized publication on 5 November 2026 to `techno-optimist/heart-of-gold`, with a static GitHub Pages simulator. Version 0.1's live path used a local Codex installation. That release did not change the existing ProjectForty2.ai website.

## v0.2: authorized hosted target

- Source repository: `techno-optimist/heart-of-gold`.
- Hosted application: `https://projectforty2.ai/heartofgold/`.
- Static simulator: `https://techno-optimist.github.io/heart-of-gold/`.

The owner authorized adding the hosted application at this path. Its implementation supports temporary, separate visitor sessions and user-owned OpenAI, Claude, and Grok API connections. The original local Codex mode remains available. Changes outside the `/heartofgold/` application and its necessary hosting route are outside this release's scope.

Deployment status and live inference must be reported from actual release checks. Mocked provider tests establish tested application behavior, not account access, billing, or provider availability.

## Public contents

Original MIT-licensed application source, deterministic tests, community and security documents, architecture and research notes, CI/Pages workflows, and any explicitly reviewed synthetic verification receipt. The final tracked-file list is the authority for the exact package.

Local runtime data, user prompts, `.flight-data/`, provider credentials, authentication files, personal configuration, and private debugging artifacts must be excluded. Review the tracked files and exports immediately before publication.

## Hosting boundaries

The Pages artifact contains browser assets only and runs a labelled simulation. The ProjectForty2-hosted service provides real HTTP provider orchestration in isolated temporary sessions. Provider keys are handled by that backend; they are not part of the public source or static build. Hosted missions produce text without tools. Local Codex execution still requires downloading and running the local app.

See [provider access](provider-access.md) for credential handling and subscription/API distinctions. A hosted website does not automatically attach to a visitor's existing chat or local agents.

## Release copy

**HEART OF GOLD: small crews, improbable things.**

A ProjectForty2.ai experiment in making agent delegation visible. Launch a mission, inspect the branching crew, follow the ship's log, and keep the receipt. Try the simulator, connect your own provider API access to the hosted experiment, or run a bounded Codex crew locally.

This alpha produces text deliverables. It does not edit repositories, merge code, or verify its own conclusions. We are especially interested in tasks where a crew helps, tasks where it makes things worse, and better ways to tell the difference.

Bring a towel. Bring a counterexample. Help us find out.
