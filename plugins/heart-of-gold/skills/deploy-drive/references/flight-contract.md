# Persistent flight contract

`build_crew` opens one deck with resource `ui://heart-of-gold/flight-deck-v7.html`. Quiet data tools update and read its temporary server state without rendering another card. The tools do not run the crew: report only work performed by this chat or actual host workers.

## `build_crew`

| Field | Value |
| --- | --- |
| `mission` | Required nonempty text, at most 6,000 characters |
| `preset` | `balanced`, `debate`, `build`, or `research`; default `balanced` |
| `crewSize` | Integer 3–7 including the lead; default 4 |
| `deliverable` | Optional nonempty expected deliverable, at most 1,000 characters |
| `constraints` | Optional array of at most 8 nonempty strings, 500 characters each |

Returns an unstarted plan plus `flight: { id, writeToken, revision: 1, expiresAt }`. Retain these values for updates to this flight. The separate read token is delivered only to the widget in result `_meta.flight.readToken`; do not fabricate or request it for model-side polling. The preset supplies role suggestions, not completed research or actual agent processes. Specialize the tasks to the user's mission before working or revising the board.

## `show_flight`

This is a data-only update to the existing flight. It does not open a UI. Send the three access/revision fields below plus the complete current mission snapshot. Do not echo output-only `schemaVersion`, `view`, `capabilities`, `provenance`, or `project` back as inputs. Project files have their own `update_project` tool and are preserved through crew updates.

| Field | Value |
| --- | --- |
| `flightId` | The `flight.id` returned when this deck was created |
| `writeToken` | The private `flight.writeToken`; never put it in prose, evidence links, or delegated-worker prompts |
| `expectedRevision` | Latest known flight revision; use the value returned by each successful update or the widget's current context |
| `mission` | Required nonempty text, at most 6,000 characters |
| `execution` | `not_started`, `guided_passes`, or `native_agents` |
| `status` | `planned`, `working`, `complete`, or `partial` |
| `members` | Required array of 1–7 members; exactly one lead |
| `deliverable`, `constraints` | Same limits as `build_crew` |
| `summary` | Optional nonempty synthesis, at most 6,000 characters; required for a complete flight |
| `openQuestions` | Optional array of at most 8 nonempty strings, 500 characters each |

Success returns a small acknowledgement: `{ flight: { id, revision, expiresAt }, updated: true, status, execution }`. Retain its new revision. The existing widget reads the new snapshot itself. Do not call `build_crew` to display this acknowledgement or poll from the assistant.

Each member:

| Field | Value |
| --- | --- |
| `id` | Stable identifier, at most 80 characters; letters, digits, `_`, `.`, `:`, `-`; starts with a letter or digit |
| `parentId` | `null` for the lead; otherwise another member's ID |
| `name` | Required nonempty name, at most 80 characters |
| `role` | Required nonempty responsibility, at most 120 characters |
| `task` | Required nonempty assignment, at most 2,000 characters |
| `output` | Required nonempty expected output contract, at most 1,000 characters |
| `status` | `planned`, `working`, `waiting`, `complete`, `cancelled`, or `failed` |
| `result` | Concrete contribution, at most 6,000 characters; required when complete |
| `workerId` | Actual host worker ID, at most 160 characters; only for native execution |
| `evidence` | Up to 6 objects with `label` (at most 160 characters) and `url` (HTTPS, at most 2,000 characters, no embedded credentials); may be empty |

All IDs must be unique, every parent must exist, and the tree must have no cycles or more than two levels below the lead. There is no dependency field: explain prerequisites in `task` and honor them during execution. `parentId` describes delegation, not every work dependency.

For `native_agents`, every delegated child whose status is no longer `planned` requires the real `workerId`; the lead's ID is optional. If a native child was never spawned, keep it planned and explain the skipped work in the partial summary. Guided passes have no worker IDs.

`not_started` means every member is planned with no result and the flight is planned. When every member remains planned, send `execution: "not_started"` regardless of the intended future execution mode; choose guided or native execution only when work actually begins. An untouched plan with a preselected future execution mode is normalized to unstarted; a planned snapshot containing performed results or worker IDs is rejected instead of erasing that evidence. A complete flight requires actual results for all members and a final summary. A partial receipt has no working or waiting members; if workers are still active, keep the flight working and state what is unresolved. Do not forge status to satisfy the schema.

## `update_project`

This model-visible data tool replaces the full selected project file set on the same flight, without opening a card. Send `{ flightId, writeToken, expectedRevision, project }`. Use the latest shared flight revision returned by either write tool; project revision is a separate, server-generated value. First report real working execution and member status with `show_flight`. An unstarted flight or attribution to a planned member is rejected.

The `project` object contains:

| Field | Value |
| --- | --- |
| `title` | Required nonempty text, at most 160 characters |
| `entrypoint` | Optional path of an included HTML file |
| `sourceRevision` | Optional actual host/source revision, at most 160 characters; omit when unknown |
| `links` | Optional `{ repository?, preview? }`; only real HTTPS URLs without embedded credentials, at most 2,000 characters each |
| `files` | Required complete array of 1–24 selected text files |
| `checks` | Required array of 0–24 actual check records; `[]` is valid and old checks are not carried automatically |

Each file is `{ path, content, memberId, workerId?, summary? }`. Paths are unique including case-insensitive comparisons, at most 160 characters and eight non-hidden segments, starting each segment with a letter or digit. Use `/` between regular segments; no absolute paths, traversal, or backslashes. Supported extensions: `html`, `htm`, `css`, `js`, `mjs`, `md`, `markdown`, `json`, `txt`. Content is exact UTF-8 text, at most 64 KiB per file, with no null bytes. Optional change summaries are at most 500 characters.

Each check is `{ name, status, details, memberId, workerId?, command? }`. `status` is `passed`, `failed`, or `not_run`; name is at most 120 characters, details 2,000, and optional command 500. Describe actual commands or browser interactions performed against these files. Use `not_run` for checks that did not run. Never re-label a source inspection as a browser test.

File and check attribution must reference a member with reported work. Native child `workerId` must exactly match that member's host-reported ID. Guided passes must omit worker IDs. The lead may publish integrated work under its own member ID; do not invent an author for a worker's unobserved changes.

The server calculates file language, byte count and SHA-256, a canonical project `sourceDigest`, project revision, receipt time, and added/modified/deleted paths relative to the previous file set. Each check is bound to that project revision and digest, but its outcome remains **host-supplied, not independently verified**. Only the latest files and latest change summary are retained; this is not source history. Omitted files are removed from this temporary project, not from the user's workspace. Crew updates and edited plans preserve the current project.

Success returns `{ flight: { id, revision, expiresAt }, updated: true, projectRevision, sourceDigest, files }`. Retain `flight.revision` for the next write. Do not send server-derived hashes, revisions, change lists, or provenance back as project input. The stored project including metadata is limited to 256 KiB; the combined flight and a complete request each have a 384 KiB limit.

The tool does not execute submitted code, run checks, fetch links, install dependencies, write repository files, or deploy anything. The deck can inspect source and attempt an isolated preview of supported self-contained files; rendering depends on host support. Preserve the actual host artifact and report unavailable preview or testing capabilities truthfully. Source submission is not authorization to publish the user's code publicly.

## Widget reads, edits, and conflicts

The app-only `read_flight` tool accepts `flightId`, `readToken`, and optional `afterRevision`; it returns the latest snapshot when changed. The mounted component performs these reads. The app-only `save_plan` tool saves an edited, unstarted plan using the same write capability and expected revision. Before its brief Engage drive request (Deploy in earlier versions), the UI supplies the updated plan, capability, and revision to model context. The lead must use that current plan rather than replacing it with the original preset.

Writes use optimistic revision checks. After authenticating a valid write capability, an old revision returns `isError: true` with `FLIGHT_CONFLICT` in error metadata and `structuredContent: { flight: { id, revision, expiresAt }, currentSnapshot }`. Reconcile the returned full snapshot with the user's actual edits before submitting a new update; do not merely replace the revision number and retry. Recovery does not return a capability, so retain the one already held. Missing/expired flights and incorrect capabilities return `FLIGHT_UNAVAILABLE` without a snapshot or revision; do not infer which condition occurred or open another card automatically. Malformed or missing input fields can also fail schema validation.

A transient protocol `Internal error` (`-32603`) without a specific rejection permits one retry of the identical `show_flight` or `update_project` request with the same `expectedRevision`. This is a retry of reporting, not execution. If the first request committed despite its failed response, the retry may conflict: inspect the authenticated current snapshot, retain its revision if it already reflects the intended update, and otherwise reconcile before writing. Do not rerun workers, create another flight, or blindly retry an explicit rejection. If reporting still fails, preserve the actual results in the conversation and distinguish the failed board update from the work itself.

Flight access expires two hours after creation and activity does not extend it. Expired entries are removed on access or the next cleanup sweep, scheduled every 60 seconds. Only the latest snapshot and project are held; previous source versions are not retained. State exists only in this server process and is lost on restart or shutdown. Capacity is limited to 128 flights, 8 MiB total, and 384 KiB per flight including its project. Full capacity rejects new flights or oversized updates; it does not evict a live flight to make room. There is no list endpoint, durable history, account cookie, or capability in a URL.

Snapshots remain host-reported and not independently verified. Updates send a complete crew snapshot or complete selected project, not just the changed item. Keep each tool call below 384 KiB. Summarize long contributions for the board and retain the full deliverable in authorized artifacts or the chat when needed. Keep the final chat response short when the working deck already contains the result.
