# Flight contract v1

The tools return a full snapshot for `ui://heart-of-gold/flight-deck-v1.html`. They do not run the crew. Report only work performed by this chat or actual host workers.

## `build_crew`

| Field | Value |
| --- | --- |
| `mission` | Required nonempty text, at most 6,000 characters |
| `preset` | `balanced`, `debate`, `build`, or `research`; default `balanced` |
| `crewSize` | Integer 3–7 including the lead; default 4 |
| `deliverable` | Optional nonempty expected deliverable, at most 1,000 characters |
| `constraints` | Optional array of at most 8 nonempty strings, 500 characters each |

Returns an unstarted plan. The preset supplies role suggestions, not completed research or actual agent processes. Specialize the tasks to the user's mission before working or revising the board.

## `show_flight`

Send only these top-level fields. Do not echo output-only `schemaVersion`, `view`, `capabilities`, or `provenance` back as inputs.

| Field | Value |
| --- | --- |
| `mission` | Required nonempty text, at most 6,000 characters |
| `execution` | `not_started`, `guided_passes`, or `native_agents` |
| `status` | `planned`, `working`, `complete`, or `partial` |
| `members` | Required array of 1–7 members; exactly one lead |
| `deliverable`, `constraints` | Same limits as `build_crew` |
| `summary` | Optional nonempty synthesis, at most 6,000 characters; required for a complete flight |
| `openQuestions` | Optional array of at most 8 nonempty strings, 500 characters each |

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

`not_started` means every member is planned with no result and the flight is planned. A complete flight requires actual results for all members and a final summary. A partial receipt has no working or waiting members; if workers are still active, keep the flight working and state what is unresolved. Do not forge status to satisfy the schema.

Returned snapshots explicitly identify their provenance as host-reported and not independently verified. The service has no saved history or ownership token: an update must contain the complete snapshot. Keep each tool call below 96 KiB. Summarize long deliverables for the board and retain the complete work in the chat or authorized artifacts.
