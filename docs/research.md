# Research log: useful things elsewhere in the galaxy

Checked 2026-11-05. These are primary sources and implementation inputs, not endorsements or claims that every integration is implemented.

| Source | Finding | Decision for this experiment |
| --- | --- | --- |
| [ProjectForty2](https://projectforty2.ai/) | The lab presents experimental work, limitations, and underlying receipts. | Keep failures visible and make run records inspectable. Do not present model output as verified research. |
| [Swarm Cursors](https://github.com/DhvanilPatel/swarm-cursors) | A Chrome extension snapshots a page and visually rebuilds it; its README credits Joel Califa's engine and choreography. No license file was visible in the inspected root listing. | Credit the idea; use original code and assets. Do not treat visibility as permission to relicense it. |
| [Joel Califa's Swarm](https://califa.github.io/swarm-site/) · [source](https://github.com/califa/swarm-site) | The earlier visual inspiration is a website that builds itself while scrolling. | Acknowledge the origin of the visual idea. |
| [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) | `codex exec` provides JSONL events, schema-constrained final output, saved CLI authentication, and sandbox controls. | Use a bounded local CLI adapter for the first live implementation. |
| [Codex app-server](https://learn.chatgpt.com/docs/app-server) | A richer application interface supports thread and turn lifecycle, event streams, approvals, and history forks. | Consider for persistent conversations and steering; no claim of attaching arbitrary running desktop chats. |
| [ACP overview](https://agentclientprotocol.com/protocol/v1/overview) | Agent/client communication includes session setup, prompts, updates, permissions, and cancellation. | The next candidate for broader local agent compatibility. |
| [ACP security considerations](https://agentclientprotocol.com/protocol/v1/security) | Protocol communication does not itself sandbox the agent process; agent-authored content must be treated as untrusted. | Keep execution permissions separate from transport compatibility. |
| [A2A protocol](https://a2a-protocol.org/latest/) | A standard for communication between independently implemented agent applications. | Later remote-agent integration, after identity and trust boundaries are designed. |
| [MCP introduction](https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro) | MCP connects AI applications to external data and tools. | A tool interface, not a replacement for an agent lifecycle or swarm scheduler. |

The architectural choices in the final column are our inferences from these sources. Protocol versions and CLI flags can change; contributors should verify the version they actually test.
