# Stream actual saved component files

The artifact watcher runs beside the host's real file-writing workers. It observes changes to an explicit source allowlist and sends exact saved text to the existing flight independently of the lead's next chat turn. It does not spawn workers, scrape tokens, simulate typing, manufacture intermediate source, or run the submitted code.

Use a dedicated directory containing only the public or synthetic artifact authorized for this flight. A laptop watcher cannot see a separate ChatGPT cloud filesystem. The host must provide a persistent Node 22+ process, the workers' shared filesystem, and outbound access to the artifact endpoint. If those capabilities are absent, keep using genuine lead-reported checkpoints and explain that automatic file streaming is unavailable.

## Start from the lead

1. Create the actual shell and component runtime contract. Publish the shell on the existing flight. Give workers disjoint owned paths and stable component IDs; preserve the user's scope.
2. Initialize workers with a bounded interface/ownership confirmation before substantive component edits. Register their actual returned IDs and observed status, then call `open_artifact_stream` as the lead with the approved bindings. Use the same bindings in a lead-owned manifest **outside** the watched directory. Keep all capabilities away from workers.
3. Start the watcher with the minted connection on standard input and wait for its authenticated connection receipt. Then dispatch/resume the component builders together and let real incremental saves flow. Atomic temp-file-and-rename saves are preferred. Temporary files are not uploaded unless explicitly allowed.
4. Observe an accepted file hash/revision before its worker returns. This establishes independent file observation in that particular host. Actual author identity still comes from the lead's ownership assignment; a filesystem watcher cannot establish which model or process authored bytes.
5. Stop workers or finish their writes, flush the bridge, then report completion and run actual checks against the resulting source digest. The bridge never invents a passing check.

The dependency-free command is:

```sh
node scripts/watch-project.mjs --root /absolute/dedicated-artifacts --manifest /absolute/lead-owned-bindings.json
```

The CLI honors an existing HTTP(S) proxy using Node's built-in proxy support when available (Node 22.21+ or 24+), without changing the host configuration or printing proxy values. Explicit proxy opt-outs remain respected. A proxy-requiring host with an unsupported Node version receives an upgrade error. Library callers must configure their own fetch transport or launch Node with the appropriate proxy support. See [Node proxy configuration](https://nodejs.org/en/learn/http/enterprise-network-configuration).

Startup connection success establishes endpoint reachability and the scoped capability, not source delivery. Only an `artifact.accepted` receipt for an actual changed file establishes that a save arrived. Never create or replay a fake edit to manufacture that evidence.

In the plugin archive, the same command lives at `skills/deploy-drive/scripts/watch-project.mjs`; its import resolves to `../lib/project-watcher.mjs` within that skill. The manifest contains only bindings:

```json
{
  "bindings": [
    {
      "componentId": "entry",
      "label": "Task entry",
      "memberId": "crew-1",
      "workerId": "REPLACE_WITH_ACTUAL_HOST_WORKER_ID",
      "filePaths": ["entry.html", "entry.css", "entry.js"]
    }
  ]
}
```

Use the exact member and worker IDs already reported to the backend. Guided execution omits `workerId`. Each path belongs to one binding: at most 12 components and 24 distinct files. The manifest is read once; changing it does not silently broaden a running connection. To change ownership or scope, reconcile and mint a replacement connection.

Standard input contains one JSON object followed by EOF: `{ flightId, artifactToken, ingestUrl, projectRevision, scopedFiles }`. `scopedFiles` is the mint response's complete allowed-path baseline, each `{ path, sha256 }`, with `null` for a missing file. `currentProjectRevision` is also accepted. At initial revision zero, an omitted baseline means all allowed paths are absent. Nonzero revisions require their actual baseline.

Pass the minted result from the lead's process memory, without writing tokens to disk or shell arguments. For example, a host controller that already holds `mint` can launch the child this way:

```js
const child = spawn(process.execPath, [runnerPath,
  '--root', artifactDirectory, '--manifest', manifestPath],
  { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.end(JSON.stringify({
  flightId: mint.flight.id,
  artifactToken: mint.artifactToken,
  ingestUrl: mint.ingestUrl,
  projectRevision: mint.projectRevision,
  scopedFiles: mint.scopedFiles,
}));
```

The accepted production endpoint is `https://projectforty2.ai/heartofgold/artifacts/write`; HTTP loopback equivalents on the same path support local testing. Redirects, other hosts/paths, embedded credentials, and URL parameters are rejected. The runner does not receive or need the lead's full flight write capability.

## What it sends

Filesystem notifications wake the scanner, with a one-second rescan of only allowed paths as a fallback. Reads must remain stable for roughly 150 ms; updates coalesce for 250 ms, with at most two request attempts per second and one request in flight. New changes replace pending older states instead of accumulating a fictional playback queue. A missing path must remain absent for 750 ms before deletion is sent.

Each POST contains `{ flightId, artifactToken, expectedProjectRevision, batchId, upserts: [{ path, content }], deletePaths: [] }`. An upsert is the full exact text of a genuinely changed file, rather than a fabricated character stream. Invalid JavaScript or JSON syntax is still uploaded exactly: the component renderer decides whether to retain its previous runnable component and display a draft error. The watcher does not reinterpret or rewrite the source.

Paths must be safe, non-hidden, supported relative text-file paths. Symbolic links, hard links, nonregular files, invalid UTF-8, null bytes, files above 64 KiB, source above 256 KiB, and encoded requests above 384 KiB are rejected. It never discovers or recursively uploads a repository. These checks and agreed file ownership are not an operating-system sandbox against other processes running as the same user.

## Reconnect, conflicts, and shutdown

The server scopes the token to artifact writes and uses a project revision independent of crew-status revisions. Network failures, rate limits, and server failures receive bounded retries of the identical batch. The same accepted batch is idempotent. Responses and exceptions are never echoed with their raw contents.

A revision conflict is retried only when the authenticated scoped hashes still match the last acknowledged baseline: another change outside the scope can advance the project revision safely. If any allowed path changed externally, the bridge stops so the lead can reconcile the actual source. It does not overwrite a user's edit or merely increment a revision until a write succeeds. Expired/revoked connections, scope violations, invalid input, and unresolved errors stop with a concise code.

SIGINT and SIGTERM request a final flush, bounded to ten seconds, then release watchers and abort pending transport. Library callers can use `watchProject(...)`, `flush({ timeoutMs })`, `stop({ flush, timeoutMs })`, and the returned `done` promise. Stopping without flushing reports no fabricated success for unsent changes.

Stdout is JSON-line metadata: observed path, byte count, modification/observation times, hashes, accepted project revision, and bounded error codes. It contains no source, capability, or raw response. A receipt timestamp records local observation or backend acknowledgement, not a worker's keystrokes. The backend retains the latest source and bounded metadata under the existing fixed two-hour flight expiry; updates do not extend it. Keep the durable artifact in the user's workspace.
