# The guide to the next few improbable things

This is an experiment roadmap, not a delivery promise. The first question is whether visible delegation helps people produce and assess useful work.

## First flight: v0.1 local alpha

- A local task coordinator with bounded recursive delegation.
- A deterministic simulator and a real Codex adapter, clearly distinguished.
- A map of agent nodes, activity log, inspectable results, and run receipts.
- Text deliverables under a read-only agent execution policy.
- Community documentation and reproducible tests without provider credentials.

## Implemented in v0.2: bring your own API access

- A separate hosted service for temporary visitor sessions, alongside the original local app.
- OpenAI, Claude, and Grok HTTP API adapters with user-owned credentials and model discovery.
- Per-session run/event isolation, credential expiry and disconnect, shared execution limits, and bounded receipts held in memory.
- Text-only hosted missions: no shell, browsing, filesystem writes, or account tools.
- Deterministic tests for provider request shapes, refusal/truncation, cancellation, session isolation, and credential-safe errors.

The authorized hosting target is `https://projectforty2.ai/heartofgold/`. Implementation and mocked tests do not establish deployment health or successful paid provider inference; those need separate release verification. The GitHub Pages build remains a simulator.

Model output remains unverified until someone checks it. Code tests establish tested software behavior; they do not establish the general usefulness or reliability of a swarm.

## Next: make the comparison fair

Collect a small public set of synthetic tasks and scoring rubrics. Run each with one agent and a bounded crew. Retain failed runs. Report useful output, human correction needed, elapsed time, and usage where the provider supplies it. Separate planning quality from execution quality.

Good early tasks include comparing supplied proposals, designing an onboarding guide, finding contradictory requirements, and drafting a test plan from a specification. Avoid claiming independent web research when the adapter has not actually retrieved sources.

## Next: connect external agent runtimes

Implement an ACP adapter behind the same contract. Publish a capability table and lifecycle tests. Do not mark a provider supported just because it speaks a similar JSON format. Codex app-server is another candidate when persistent conversation and steering become useful.

## Later: tools and distant ships

MCP can expose scoped tools to agents or make the coordinator callable from another client. A2A can connect independently hosted agents. Each requires explicit authentication, trust boundaries, cancellation semantics, and error mapping. These are different integrations, not synonyms for a universal agent socket.

## Later: agents that change things

Add write-enabled work only with isolated workspaces, bounded permissions, artifact ownership, an integration step, and reviewable diffs. Explore separate browser contexts before shared page control. The implemented hosted service supports bounded text inference; arbitrary code execution and persistent user workspaces remain separate future capabilities.

## Deliberately not promised

Unlimited recursion, autonomous public deployment, universal chat attachment, automatic correctness, consciousness, or an answer to life, the universe, and every flaky integration test.
