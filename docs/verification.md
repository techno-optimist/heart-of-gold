# Flight check — 5 November 2026

This is a working alpha, not evidence that swarms outperform single agents. Implementation, local tests, deployment, and live provider inference are separate claims.

## v0.2 hosted implementation

The code includes a separate `/heartofgold/` hosted service, session ownership, temporary in-memory credentials/history, provider model discovery, OpenAI/Claude/Grok API adapters, and the account/model interface. Its intended destination is [projectforty2.ai/heartofgold/](https://projectforty2.ai/heartofgold/).

At this documentation checkpoint, **production deployment of v0.2 is not yet verified**. A prepared change or manifest is not a live-release receipt. GitHub Pages remains a separate browser-only simulator.

Observed locally for v0.2:

- **63 tests passed:** 14 hosted-service/session tests, 32 provider-adapter tests, 13 runtime tests, and 4 local-server tests.
- Provider checks use synthetic keys and mocked HTTP responses. They cover request shape, discovery/filtering, cancellation, response bounds, and sanitized failures. Hosted checks include session isolation, origin/token controls, expiry, connection races, and credential handling.
- A hosted browser demo completed with seven nodes. A rejected provider key produced an error and the key input was cleared.
- JavaScript syntax checks passed after the provider UI changes.
- The separate ProjectForty2 edge change passed 120 local tests. Its CI and deployment remain separate release steps.

**No paid OpenAI, Claude, or Grok inference has been run through the hosted adapter with real credentials.** Mocked success does not establish real account access, model compatibility, billing, latency, or output quality. Model discovery alone would establish catalog access, not task completion.

The frontend refuses simulator fallback when its hosted backend is unavailable. Pages fallback remains explicitly browser-only. Keys are cleared before connection requests and on dialog closure; they are not stored by the frontend. Expiry is rechecked because API activity can extend the idle window; provider-disconnect events refresh account state.

## Previously observed local behavior

- A live Codex CLI run completed a synthetic onboarding task: a lead delegated to two helpers, both returned, and the lead synthesized a six-item checklist. Three task nodes, four model invocations. The sanitized [receipt](receipts/live-smoke.json) contains no credentials or private task input.
- The initial local package passed syntax checks and 17 tests covering recursion/joins, concurrency, budget/depth enforcement, cancellation/failure, timeouts, restart interruption, malformed responses, subprocess transport/cleanup, loopback HTTP boundaries, creation/cancellation, and SSE.
- Browser checks completed a seven-node scripted flight, inspected an agent, reopened history, cancelled another flight, and downloaded a valid JSON receipt with seven nodes and 39 events.
- Desktop (1280 CSS pixels) and narrow (390 CSS pixels) checks found no horizontal overflow. The guide opened on the narrow viewport. This was not a full accessibility audit or physical phone test.

The live local check used macOS, Node 26.8.1, and Codex CLI 0.166.0. CLI transport tests use a fake executable without model spend. POSIX process-group cleanup is implemented; live Windows process-tree cancellation is unverified.

## Not established

- Better answers, lower cost, or faster completion than a single-agent baseline.
- Independent correctness or external verification of generated text.
- Consumer subscription OAuth, arbitrary providers, repository editing/merging, or browser control.
- Production-grade isolation, confidentiality, or comprehensive denial-of-service resistance.
- Continuous hosted availability, session continuity across restarts, or real paid provider inference.

Public GitHub/Pages publication was authorized on 5 November 2026; [publication.md](publication.md) records the initial v0.1 scope. The subsequent v0.2 ProjectForty2 route is a separate release and requires its own live verification.
