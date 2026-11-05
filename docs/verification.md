# Flight check — 5 November 2026

This is a working alpha, not evidence that swarms outperform single agents. Implementation, local tests, deployment, and live provider inference are separate claims.

## v0.2 hosted implementation

The code includes a separate `/heartofgold/` hosted service, session ownership, temporary in-memory credentials/history, provider model discovery, OpenAI/Claude/Grok API adapters, and the account/model interface. Its intended destination is [projectforty2.ai/heartofgold/](https://projectforty2.ai/heartofgold/).

The hosted v0.2 service was verified at **18:07 UTC on 5 November 2026** at [projectforty2.ai/heartofgold/](https://projectforty2.ai/heartofgold/). The [synthetic hosted receipt](receipts/hosted-smoke.json) records the exact app and edge commits. GitHub Pages remains a separate browser-only simulator.

The public check passed the canonical redirect, hosted page and health endpoint, secure session cookie, rejected foreign origin, sanitized invalid credential, fresh visitor's empty history, denied cross-session flight read, and a completed seven-node/39-event scripted flight. No real provider credential was used.

The first live isolation check caught the site proxy retaining an upstream session cookie. Heart of Gold was suspended while this was repaired. [Edge PR #177](https://github.com/techno-optimist/observatory/pull/177) disables upstream cookie retention and enforces the current visitor's cookie after request construction. Its two regression tests and the full **122-test edge/site suite** passed, CI was green, the corrected edge deployed, and the fresh live check above passed after service resumption. Earlier startup checks also saw temporary 503 responses; continuous availability is not claimed.

Observed locally for v0.2:

- **63 tests passed:** 14 hosted-service/session tests, 32 provider-adapter tests, 13 runtime tests, and 4 local-server tests.
- Provider checks use synthetic keys and mocked HTTP responses. They cover request shape, discovery/filtering, cancellation, response bounds, and sanitized failures. Hosted checks include session isolation, origin/token controls, expiry, connection races, and credential handling.
- A hosted browser demo completed with seven nodes. A rejected provider key produced an error and the key input was cleared.
- JavaScript syntax checks passed after the provider UI changes.
- App CI passed on Node 22 and 24. The initial edge route passed 120 tests; the cookie-isolation repair passed 122. The initial hosted app commit was `d1475d0`; the corrected edge commit is `dffdbd5`. The redesign deployment is recorded below.

**No paid OpenAI, Claude, or Grok inference has been run through the hosted adapter with real credentials.** Mocked success does not establish real account access, model compatibility, billing, latency, or output quality. Model discovery alone would establish catalog access, not task completion.

The frontend refuses simulator fallback when its hosted backend is unavailable. Pages fallback remains explicitly browser-only. Keys are cleared before connection requests and on dialog closure; they are not stored by the frontend. Expiry is rechecked because API activity can extend the idle window; provider-disconnect events refresh account state.

## Cursor playground redesign — 5 November 2026

The redesign is live at [projectforty2.ai/heartofgold/](https://projectforty2.ai/heartofgold/), deployed from `a50cfd220bcc1f49d39e60effa002a307e7b86b0`. The **18:57 UTC** [synthetic release check](receipts/redesign-smoke.json) passed all ten checks, including exact hashes for the live CSS, JavaScript, renderer, favicon, and four fonts; a seven-node/39-event scripted flight; and fresh-session isolation. The live browser displayed the new interface and enabled its mission controls. [Node 22/24 CI](https://github.com/techno-optimist/heart-of-gold/actions/runs/42088982068) and the [Pages publication](https://github.com/techno-optimist/heart-of-gold/actions/runs/42088982132) passed.

The interface was rebuilt around the reference’s open canvas and labeled cursor choreography, using ProjectForty2’s colors, wordmark, and typography. The opening scene is an explicitly labeled visual rehearsal. Real flight nodes still come from coordinator events.

Local browser checks at 1280 × 720 and 390 × 844 covered a completed seven-node simulator flight, cursor selection, crew details, ship’s log, reopening history, report download, cancellation, pause, flight settings, and the provider sheet. The mobile check found no horizontal overflow and confirmed all seven cursors clear the composer. All seven dialogs have accessible names. A synthetic unsent key was cleared when switching providers. Browser emulation does not establish physical-phone or comprehensive accessibility coverage.

The full 63-test suite passed. Module MIME regression assertions were then added to the existing local/hosted server tests; all 18 targeted server tests passed. JavaScript syntax and whitespace checks passed. Renderer checks also exercised reduced-motion scheduling, dock resizing, and cleanup with a synthetic DOM harness. No paid provider inference was performed for this redesign.

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

Public GitHub/Pages publication and the subsequent ProjectForty2 route were authorized on 5 November 2026; [publication.md](publication.md) records their scope. Hosted ChatGPT OAuth remains an unsubmitted [access request and integration proposal](chatgpt-sign-in.md).
