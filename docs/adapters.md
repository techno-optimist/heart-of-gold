# Babel fish: the adapter boundary

An adapter translates an agent runtime into HEART OF GOLD's small execution contract. A connector name is not a capability guarantee. Document exactly which operations work.

The current implementation is in `lib/adapters.mjs`. It exports `createAdapter(mode)`, `availability()`, `DemoAdapter`, `CodexAdapter`, and `validateResult`.

## One call

An adapter implements an asynchronous `run` method accepting:

```js
{
  node,
  task,
  phase,            // 'plan' or 'synthesize'
  children,         // completed child results for synthesis
  canDelegate,
  remainingAgents,
  signal,           // AbortSignal
  onActivity,       // progress callback
  cwd               // task working directory
}
```

The result has this shape:

```js
{
  summary: 'A short account of the work.',
  result: 'The text deliverable, with assumptions and limitations.',
  children: [
    {
      name: 'Reviewer',
      role: 'skeptic',
      task: 'Review the proposed plan for missing assumptions.'
    }
  ]
}
```

Return an empty `children` array for a leaf or synthesis result. The coordinator, not the provider, decides which requested children fit the remaining limits. Adapter output is validated and must remain bounded.

## Codex adapter

The adapter launches `codex exec` without a shell, sends the prompt over stdin, consumes JSONL activity, and reads a schema-constrained final result. It requests a read-only sandbox, ignores user configuration, disables native multi-agent behavior so the coordinator owns branching, and uses ephemeral CLI sessions. Saved CLI authentication is used without copying its credential files into this project.

Availability checks establish whether the executable is present. They do not establish authentication, rate-limit headroom, current model availability, or a successful end-to-end run.

## A second adapter should prove

- A task can complete with a validated result.
- Progress is observable without exposing hidden reasoning or secrets.
- Cancellation stops local work and does not return a false success.
- Provider failure, malformed output, and timeout propagate clearly.
- Limits cannot be bypassed through the provider's own recursive workers.
- Declared filesystem, tool, network, and authentication behavior matches reality.
- Tests use deterministic fixtures and need no live credentials.

ACP is the next protocol candidate because its lifecycle includes setup, prompting, progress, permissions, and cancellation. ACP compatibility is a roadmap item, not a feature of this release. See [research](research.md) for primary sources.
