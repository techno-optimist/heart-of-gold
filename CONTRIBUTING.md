# Welcome aboard

Useful work, strange ideas, clear receipts. Towels optional.

We welcome small fixes, tests that expose bad assumptions, accessibility work, and adapter experiments. You do not need to add another model to help. A reproducible failure can be more useful than a successful demo.

## Your first contribution

1. Read the [README](README.md) and [architecture decision](docs/architecture.md).
2. Run `npm start`, then try a simulator flight.
3. Run `npm test`. Tests must not require provider credentials or spend model tokens.
4. Make one focused change. Include a meaningful regression test for runtime behavior or a short manual check for presentation changes.
5. Open a pull request describing the problem, resulting behavior, and checks performed. Say what remains unverified.

The project uses Node.js built-ins and browser JavaScript. Keep new dependencies justified. Prefer an adapter over provider-specific behavior in the coordinator or interface.

## Good first expeditions

| Expedition | A useful completion criterion |
| --- | --- |
| Keyboard navigation | A person can launch, inspect, cancel, and read a result without a mouse. |
| Failure fixtures | A deterministic adapter reproduces malformed output, timeout, or cancellation without a real provider. |
| Receipt clarity | A reader can distinguish a demo from a live run and find the mission, node outcomes, and failures. |
| Single-agent baseline | The same task can be compared with delegation disabled; the report retains failed runs. |
| Provider adapter | Implements the same lifecycle, documents capabilities, and passes adapter contract tests. |
| Community translation | Core controls retain clear meanings; whimsical labels have understandable explanations. |

## Rules of the ship

- Keep demo activity explicitly labelled. Do not fabricate live results or verification.
- Treat prompts, agent output, filenames, and external content as untrusted data.
- Preserve cancellation, crew/depth limits, and failure propagation.
- Do not add telemetry, public sharing, broader network exposure, or more powerful agent permissions as a side effect of another change.
- Never commit `.flight-data/`, tokens, provider credentials, private prompts, or local environment files. Use invented test fixtures.
- Credit inspiration. Bring only code and assets you have the right to contribute.

Contributions are made under the project's MIT license. There is no contributor license agreement in this initial experiment. Contributors retain their copyright; the license governs reuse.

## Proposing bigger changes

For write-enabled agents, remote execution, shared memory, or a new protocol, open a design issue first. Describe the user task, capability boundary, cancellation behavior, failure cases, and a small experiment that would tell us whether the change helps. The [roadmap](docs/roadmap.md) records proposals, not delivery promises.

Be kind to the person. Be exacting with the claim. Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
