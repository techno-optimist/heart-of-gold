# Babel fish: the adapter boundary

An adapter translates an agent runtime into HEART OF GOLD's small execution contract. A connector name is not a capability guarantee. Document exactly which operations work.

Version 0.2 has three execution paths:

| Adapter | Runs where | Capability |
| --- | --- | --- |
| `DemoAdapter` | Local or hosted server | Scripted demonstration; no provider calls. |
| `CodexAdapter` | Local app only | Your installed Codex CLI with read-only agent permissions. |
| `ProviderAdapter` | Hosted service | User-owned OpenAI, Claude, or Grok API access; structured text generation with no tools. |

Local adapters are in `lib/adapters.mjs`; HTTP providers are in `lib/provider-adapter.mjs`. Both use the shared schema and validator in `lib/result-schema.mjs`.

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
  cwd               // local task directory; undefined in hosted memory-only runs
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

## Hosted provider adapter

The hosted service keeps each temporary visitor session's credentials, runs, and events separate. It supplies a user-selected provider/model to `ProviderAdapter`; the adapter calls fixed HTTPS endpoints and passes the same structured result back to the coordinator. The coordinator owns delegation. No browser, shell, file, or account tools are supplied to hosted models.

OpenAI and Grok use Responses; Claude uses Messages. API access is not a universal consumer-subscription login. Model discovery is a capability candidate check, not evidence that a paid inference call succeeded. See [provider access](provider-access.md) for authentication, data flow, bounds, and testing limits.

## Every new adapter should prove

- A task can complete with a validated result.
- Progress is observable without exposing hidden reasoning or secrets.
- Cancellation stops local work and does not return a false success.
- Provider failure, malformed output, and timeout propagate clearly.
- Limits cannot be bypassed through the provider's own recursive workers.
- Declared filesystem, tool, network, and authentication behavior matches reality.
- Tests use deterministic fixtures and need no live credentials.

ACP remains a future protocol adapter for external agent runtimes. The three HTTP provider integrations do not imply ACP, MCP, A2A, or arbitrary-chat compatibility. See [research](research.md) for primary sources.
