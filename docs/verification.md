# Flight check — 5 November 2026

This is a working alpha, not evidence that swarms outperform single agents.

## Observed

- A live Codex CLI run completed a synthetic onboarding task: one lead delegated to two helpers, both returned, and the lead synthesized a six-item checklist. Three task nodes, four model invocations. The sanitized [run receipt](receipts/live-smoke.json) records the execution. It contains no credentials or private task input.
- `npm run check` passed JavaScript syntax checks.
- `npm test` passed 17 tests: recursion and joins, concurrency and slot reservation, budget and depth enforcement, cancellation, failure, timeouts, restart interruption, malformed responses, subprocess transport and process-group cleanup, loopback HTTP boundaries, creation/cancellation, and SSE.
- Browser checks on the local app completed a seven-node scripted flight, opened an agent inspector, reopened history, cancelled another flight, and downloaded a valid JSON receipt with seven nodes and 39 events.
- Desktop (1280 CSS pixels) and narrow (390 CSS pixels) viewport checks found no horizontal document overflow. The guide dialog opened on the narrow viewport. This is not a full accessibility audit or physical phone test.

The live check ran on macOS with Node 26.8.1 and Codex CLI 0.166.0. The automated adapter tests use a fake executable to test transport failure behavior without spending model usage. POSIX process-group cleanup is implemented; live Windows process-tree cancellation is unverified.

## Not established

- Better answers, lower cost, or faster completion than a single-agent baseline.
- Independently verified correctness of model-written text.
- Arbitrary provider compatibility, remote execution, repository editing/merging, or browser control.
- Production isolation or a confidentiality sandbox.
- CI qualification on GitHub before the repository is published and those jobs finish.

Public GitHub and Pages publication was authorized on 5 November 2026; see [publication.md](publication.md). The ProjectForty2.ai production site has not been modified.
