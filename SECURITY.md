# Towel checks: security and privacy

HEART OF GOLD is an experimental local application, not a hardened multi-tenant service.

## Intended boundary

The server is intended for loopback use by a single person. Do not expose it through a public tunnel or bind it to a public interface. The web UI is a controller for local agent processes, not a place to enter provider credentials.

Live Codex uses the installed CLI's saved authentication. Its read-only sandbox restricts agent writes; it does **not** prove confidentiality or prevent every read outside the task directory. Separate task directories organize work but are not independent operating-system sandboxes. For sensitive or adversarial work, use a dedicated account or suitably isolated machine/container with carefully scoped files and provider access.

The application deliberately avoids inheriting the user's Codex configuration for workers. This reduces accidental activation of personal MCP servers or hooks; it does not turn a model or its runtime into a security boundary. Provider and operating-system behavior still matter.

## Data flow

- Simulator mode requires no model provider and uses demonstration content.
- Live mode sends task text and relevant delegated context to the configured Codex provider. Child results can be passed into parent synthesis.
- Run snapshots, events, and results are stored locally beneath `.flight-data/`. They can contain prompts, generated text, errors, and details of executed operations.
- This application adds no analytics or default telemetry. This statement does not describe telemetry or retention in Node, Codex, the provider, the browser, or the host environment.
- Exports are plain data. Review them before sharing. A receipt records execution; it is not a signature, audit certification, or proof that the result is correct.

Stop the application before removing local run data. Deleting `.flight-data/` removes the application's persisted runs; it does not delete provider-side records or independent CLI logs.

## Threats worth testing

Untrusted webpages trying to reach the local API; prompt injection; malicious agent text rendered as HTML; path traversal; process leaks after cancellation; unexpectedly inherited tools; recursive budget bypass; output floods; stale running states after restart; and private text included in exported receipts.

Limits on depth, node count, concurrency, output, and time reduce runaway execution. They are not a provider billing cap. A timeout or cancel request cannot retract a provider request that has already been sent.

## Reporting a vulnerability

Please do not post credentials, private run logs, or a working exploit against another person's machine in a public issue. If the published repository offers GitHub's **Report a vulnerability** action, use it. Otherwise open a minimal issue asking a maintainer for a private reporting channel without including exploit details. This initial package does not advertise a security email, response-time guarantee, or bug-bounty program.

Include the affected version, operating system, Node/Codex versions, expected boundary, and a reproduction using synthetic data. Maintainers should acknowledge receipt, assess exposure, fix and test the issue, and publish an advisory when appropriate.
