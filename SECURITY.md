# Towel checks: security and privacy

HEART OF GOLD v0.2 has two execution boundaries: a loopback local Codex application and a separate hosted, text-only API service. Both are experimental. Their checks do not establish production-grade isolation or independent security certification.

## Hosted API sessions

The hosted service accepts a visitor's own OpenAI, Anthropic, or xAI **API key**. It does not accept consumer chat cookies, subscription tokens, or provider passwords. Keys go over HTTPS to the application process, then to fixed provider HTTPS endpoints in authorization headers. Provider redirects are rejected. Hosted agents receive no shell, file, browser, MCP, or external-action tools.

Credentials are held separately from serializable session metadata in server memory. The application does not deliberately write keys to disk, run snapshots, browser storage, URLs, analytics, or logs. Errors are sanitized rather than forwarding raw upstream bodies; exact active-key echoes in responses are rejected. These controls reduce accidental disclosure. They do **not** prevent hosting operators from accessing process memory or guarantee secure erasure of every string copy. Operators must control infrastructure memory dumps and request logging.

Session prompts, events, and results stay in memory, retaining the latest five flights. Sessions expire after 20 minutes without API activity or one hour total. Expiry and restart remove credentials/history and cancel work. Disconnect removes the key and stops work, while history remains until expiry. Removing a key here does not revoke it at its provider or erase provider-side records. Revoke an exposed key through the provider.

An essential cookie is Secure, HttpOnly, SameSite=Strict, and scoped to `/heartofgold/`. Connections rotate session identity. Writes require a matching origin and flight token. Run lookup and streaming are session-scoped. Rate/capacity limits bound requests, connections, and work; they are not complete denial-of-service protection. Browser tabs in the same session share access.

Hosted defaults allow 32 sessions, 8 live missions across the service, and 6 concurrent provider calls. A visitor runs one mission at a time. These are implementation defaults, not availability promises. A free host may sleep or restart, losing temporary state. Hosted outages must remain visible and never silently become simulator runs.

The ProjectForty2 edge forwards only the dedicated `/heartofgold/` prefix and this app's session cookie. Optional `HOG_INGRESS_TOKEN` protection must be configured at both the Node service and trusted edge before enabling it. Only a trusted edge may inject `X-Hog-Ingress` and client-IP metadata. The initial deployment leaves this option unset and ignores forwarded IP claims; visitors share the proxy socket-IP limit. Anonymous clients can exhaust the small session pool until sessions expire. This alpha bounds resource use but does not promise resistance to deliberate availability attacks. Preserve origin checks and secure cookies. Never publish ingress secrets. The health endpoint intentionally requires no ingress token. `PUBLIC_ORIGIN` must match the public HTTPS origin; `HOSTED_DEV` is for localhost development only.

## Local Codex sessions

`server.mjs` is for loopback use by one person. Do not expose it through a public tunnel or bind it publicly. It controls local Codex processes using the CLI's saved authentication. Its UI does not collect API credentials.

The read-only sandbox restricts writes. It does **not** prove confidentiality or prevent every read outside a task directory. Separate directories organize tasks; they are not independent operating-system sandboxes. Use a dedicated account or appropriately isolated machine/container for sensitive or adversarial work.

Workers ignore the user's Codex configuration to reduce accidental activation of personal MCP servers or hooks. This does not make the model, CLI, or operating system a security boundary. Local records persist under `.flight-data/` and may contain prompts, generated content, errors, and operation details.

Stop the local app before removing `.flight-data/`. Deleting it removes app history, not provider records or independent CLI logs. Restarted local runs are marked interrupted and never automatically executed again.

## Shared data and execution limits

- Simulators use scripted content and make no model calls. The browser-only simulator stores demonstration history in local storage.
- Live prompts and delegated context go to the selected provider; child results feed parent synthesis. Provider retention/account policies still apply. OpenAI/Grok `store:false` is not a promise of zero provider retention.
- This application adds no analytics or advertising cookies. This does not describe telemetry/logs belonging to the provider, CLI, browser, or hosting infrastructure.
- Receipts are plain data. Review private content before sharing. They are not cryptographic signatures, audit certifications, or proof of correctness.
- Depth, crew count, concurrency, time, response size, and output budgets reduce runaway execution. They do not cap charges in dollars. Cancellation aborts local requests/processes but cannot retract work already processed remotely.

## Threats worth testing

Cross-session access, forged origins/tokens, session fixation, key leakage, prompt injection, untrusted generated text rendered as HTML, path traversal, inherited tools, cancellation leaks, recursive budget bypass, output floods, restarts, and private content in exports.

Model listing verifies catalog access only. It does not prove request compatibility, paid capacity, or useful output. Live paid inference has not yet been tested for the v0.2 hosted adapter.

## Reporting a vulnerability

Do not post credentials, private logs, or an exploit against another person's machine in a public issue. Use GitHub's **Report a vulnerability** action if available. Otherwise open a minimal issue requesting a private channel without exploit details. There is no advertised security email, response-time guarantee, or bug-bounty program.

Include the version, operating system, relevant Node/Codex versions, expected boundary, and a synthetic reproduction. Maintainers should assess exposure, fix and test the issue, and publish an advisory when appropriate.
