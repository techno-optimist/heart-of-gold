# ADR 001: a small ship with a truthful instrument panel

Date: 2026-11-05 · Status: accepted for the initial alpha

## The question

Can a visual swarm help people understand and direct real delegated agent work?

The starting inspiration was a cursor animation. The community experiment needs an execution system, an inspectable result, and a way to distinguish activity from accomplishment. ProjectForty2's emphasis on public experiments and receipts makes that distinction part of the product.

## The debate

The build was divided between runtime, experience, and community/research reviewers, with a lead responsible for integrating and checking the result. These were design perspectives, not a measured multi-model evaluation.

| Position | Argument | Resolution |
| --- | --- | --- |
| Runtime | A small provider-neutral coordinator is easier to inspect than a large orchestration framework. Unbounded recursive spawning is difficult to reason about. | Keep scheduling in Node built-ins; impose crew, depth, concurrency, output, and time limits. |
| Experience | The compelling experience is seeing a team form around a task, then inspecting what each member contributed. | Branching map, selectable nodes, live state, ship's log, and exportable receipt. |
| Skeptic | More animated cursors can disguise worse or unverified output. Demo behavior must not be mistaken for live execution. | Separate mode labels; no live-to-demo fallback; completion is execution status; failure remains on the record. |
| Interoperability | “Bring your own agent” needs a real capability contract. A protocol does not supply scheduling or sandboxing. | Codex adapter first; ACP next; MCP tools and A2A federation are separate later concerns. |
| Open source | The upstream visual project does not show a license grant in its inspected root listing. | Create original code and assets; credit both upstream inspirations; MIT-license only our own work. |

## Decision

The coordinator creates a lead node. Its adapter returns a structured result that may include child tasks. If limits allow them, the coordinator creates and schedules those children. A node that delegated waits for its children, then receives their results in a synthesis call. A leaf returns its result directly. This is an explicit task tree, not a claim that several agents share one mind or automatically merge histories.

The runtime controls state transitions. The interface visualizes them. The demo adapter uses the same lifecycle but returns predetermined demonstration content. The live adapter uses real Codex calls and never substitutes demo content after an error.

```text
Browser UI
    │ HTTP commands / server-sent events
Local HTTP server
    │
SwarmRuntime ── atomic run snapshots
    │
Adapter contract
    ├── DemoAdapter: deterministic, no provider
    └── CodexAdapter: local CLI → configured provider
```

## Bounds

The initial runtime allows at most seven total nodes, depth two below the root, and three concurrent adapter calls. A single adapter turn has a 120-second timeout; an expedition has a 600-second deadline. Every node has one planning/execution call and each delegating node can have one synthesis call: a conservative upper bound is thirteen model calls for seven nodes. These are execution limits, not token or dollar caps.

Parents waiting on children do not hold an execution slot. Cancellation propagates to active calls. Output validation rejects malformed structured results. A failed required child prevents a successful parent synthesis from disguising the failure.

## State and recovery

`.flight-data/<run UUID>/run.json` is the persisted snapshot. It includes the task, mode, limits, node states, result or error, and bounded event history. Event history is capped at 1,000 entries. Node directories contain schema and structured answer files; a successful run also produces `report.md`.

After a process restart, unfinished runs become interrupted. They are not automatically replayed: replaying side effects or spending provider quota requires an explicit new mission. This is a recoverable record, not durable distributed execution with exactly-once guarantees.

## Capabilities and limits

Workers use separate working directories and a read-only Codex sandbox. They produce text artifacts; this alpha does not edit source repositories, create merge requests, integrate worktrees, or operate a shared browser. Read-only does not establish filesystem confidentiality. Permissions and data handling are described in [SECURITY.md](../SECURITY.md).

Each Codex call is a fresh bounded invocation. A node's task and relevant child results are passed as explicit context. The initial implementation does not attach to a pre-existing Codex desktop chat or expose arbitrary configured MCP tools.

## Alternatives and next experiments

Codex app-server offers richer persistent sessions, steering, approvals, and streamed events. It remains a useful future adapter when those capabilities become the bottleneck; the smaller CLI interface is enough to test task delegation now. ACP provides a useful common client/agent lifecycle for a second adapter. A2A addresses communication with independently hosted agents. None replaces the coordinator's task semantics or operating-system isolation.

Before expanding the crew size, compare one-agent and delegated runs on repeated tasks with human scoring, failures retained, and usage/latency recorded. Before adding write access, introduce isolated workspaces, explicit artifact contracts, an integration owner, and tests that prove cancellation and conflicts behave as advertised.
