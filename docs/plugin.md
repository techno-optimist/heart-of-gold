# Heart of Gold, in the chat

A small crew for real work. One flight deck stays in the chat while the host builds: actual source files, crew contributions, checks, and synthesis arrive in that same card. ProjectForty2's MCP service holds the latest supplied state; the host's tools perform the work.

This is the `0.7.1` plugin candidate with UI revision 8.5 and resource v12. It adds an optional same-workspace saved-file bridge and independent component mounting. Source changes, deployment, account installation, and public-directory approval are distinct milestones; this document does not establish live acceptance. See [review and verification gates](plugin-review.md).

The deck stays within its 420px inline frame, leaving approximately 330px for the project. Each accepted component edit can update without resetting unrelated app state. Temporarily invalid controllers remain visible in Source while preview retains the last valid component. Complete and partial flights clear construction overlays. Hosts without a persistent shared workspace use explicitly reported source checkpoints.

## What you get

- **Deploy the drive:** a reusable skill that turns the user's task into useful workstreams, includes a skeptic, and reconciles the work into one deliverable.
- **A bounded crew:** 3–7 members including the lead, at most two delegation levels. Generic presets become task-specific output contracts.
- **One inspectable flight deck:** `build_crew` opens the card once; data-only `show_flight` calls update the same flight. The mounted card reads the latest snapshot. Evidence links and unresolved questions stay with the contributions.
- **Actual source updates:** the optional `open_artifact_stream` tool scopes the included saved-file bridge to exact component paths. It requires a persistent Node.js process beside actual host workers. The deck receives changes directly and mounts compatible components independently. Without that bridge, data-only `update_project` receives the selected files as each useful component arrives, with crew attribution and reported checks bound to the submitted content. Component anchors connect a contributor to the real rendered region. Inspect source and an isolated preview where the host supports it. This does not run a server-side build or deploy the project.
- **The ProjectForty2 canvas:** the website's shared cursor engine, dark drafting field, mission dock, and embedded Cormorant Garamond / DM Sans fonts, adapted to the chat frame. Engage drive uses native chat power; provider connection and private website history are separate.
- **A useful fallback:** if the host cannot delegate, the same assistant performs clearly labeled guided passes. If embedded UI is unavailable, the answer remains useful in text.

Installing a plugin cannot add a host capability that the account or surface does not expose. Native delegation requires real host tools and returned worker IDs. Work mode subagents are available to eligible accounts; ordinary Chat should not be advertised as a guaranteed parallel-agent environment. Account, workspace, and surface restrictions still apply. [OpenAI subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents), [plugin availability](https://learn.chatgpt.com/docs/plugins).

No provider API key or Sign in with ChatGPT token is required for this plugin. It makes no external AI inference calls and introduces no separate model-provider bill. The host's usage limits still apply. The website's separate provider-key runner remains a different product mode; this plugin does not attach to its sessions or private history.

## Try a mission

After installation, invoke Heart of Gold in a new chat, or invoke its `deploy-drive` skill where that surface supports skill mentions:

> Deploy a small crew to create a one-page onboarding plan for six community-garden volunteers. We have one Saturday and no budget. Include a skeptic, then give me the finished plan.

> Bring in the debate team. Compare these two approaches using only the facts I supply, then recommend one and state the strongest remaining objection.

> Plan a crew for this task. Show the workstreams first and wait before doing the work.

> Build a small task-board website with add, complete, filter, and remove controls. Show the real shell first, then each worker's usable component as it arrives while the others work. Include a reviewer and test the result with available browser tools. Do not publish it publicly.

The primary action in the widget sends a follow-up request to the host. It is not an independent server job. Work starts when the host actually starts it, and worker completion appears when the host reports the result. These are meaningful milestones, not live token streams or independently observed telemetry. Follow-up work and results stay in the same deck; the final chat response can be brief.

## One card, updated in place

UI code and flight data have separate refresh paths. The deck uses `ui://heart-of-gold/flight-deck-v12.html` so newly opened cards can receive the canvas-first presentation and corrected geometry handoff after metadata refresh. Completed and partial flights hide the component overlay while keeping Crew and Source available. Earlier URIs remain readable. Updating the same URI can leave cached HTML in ChatGPT for up to one hour; refreshing tools does not prove an existing card replaced its code. For custom-server acceptance, refresh the connection, confirm the new URI, then test in a new conversation. This does not justify opening additional cards during an ongoing mission. [Official cache guidance](https://developers.openai.com/plugins/deploy/app-review#other-changes), [refresh procedure](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata).

Only `build_crew` attaches the UI resource. `show_flight` updates crew state and `update_project` updates selected files without attaching a template. Both advance the same flight revision, and the existing component uses a data-only read tool to refresh itself. This follows OpenAI's separation of render tools from data tools and its example of `app.callServerTool` updating a mounted component. [Official UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui#separate-data-processing-from-ui-rendering).

The host remains the source of work claims. The lead reports actual worker start, completion, failure, and cancellation; related events may be batched. Guided passes remain explicitly one assistant. A moving cursor does not mean the server is watching model tokens. Selection, expanded contributions, and other presentation choices belong to the mounted UI, so refreshing data need not replace the card or reset those choices.

An observed start begins a member's continuous journey through the shared field; an observed completion receives a brief handoff accent. Report age shows how recently the deck received work information. Hover, keyboard focus, and selection hold a cursor for inspection. Pause and reduced-motion preferences stop choreography while reports can still arrive. The animation does not infer new work, add agents, or provide continuous worker telemetry.

Motion also pauses when the connection or refresh fails, the flight expires, or a cached view awaits verification. A successful read permits motion again while preserving the user's pause choice. A transient internal error while reporting permits one identical update retry on the same flight and revision; conflicts require reconciliation. This never restarts workers, and a reporting failure does not mean their work failed.

Temporary state can expire or disappear on a server restart. The deck should say that its connection is unavailable and preserve any already displayed result, rather than marking unfinished work complete or silently creating another card. The chat can still carry the requested deliverable. A new card is appropriate for a new mission or an explicit request to reopen one.

## Build components where you can see them

The host creates and edits the artifact with its available tools. The lead reports real working member status, then sends the complete current selection of files through `update_project` at useful milestones. Each file names its contributing crew member; native child attribution must match the worker ID already reported by the host. An actual source revision may be supplied when known. A file list is not a workspace connection: the plugin cannot browse the user's repository or discover files itself.

For a new small web app without a requested stack, the workflow defaults to self-contained HTML, local CSS, and classic JavaScript that the isolated preview can run. It publishes the real runnable shell before dispatching component workers or waiting for their results, with a shared interface that lets each component work independently. Requested or existing stacks are preserved; if their actual build cannot fit the preview, the host explains that limit and retains the useful source/deliverable. Existing projects begin from their actual baseline. Builders own small regions and behaviors, such as task entry, task list, or filters, with agreed interfaces and stable `data-hog-component` anchors. They return an early usable checkpoint before finishing their whole assignment. The lead integrates and publishes each actual arrival while other work continues, then reports real review corrections. If the host only returns final worker results, smaller tasks provide the checkpoints. Guided passes do the same work serially and stay labeled as one assistant. A finished app must never be hidden and gradually revealed as a fictional live build.

The component manifest contains up to 12 IDs, labels, contributors, and included file-path mappings. The host declares changed component IDs; the service accepts events only when a declared component maps to an actually changed source hash. A component cursor or highlight can then point to its real rendered anchor. Shared-file changes still require honest attribution: a new hash is not independent proof that every mapped region changed. If several arrivals occur between reads, display the current state together instead of inventing intermediate steps. That describes checkpoint fallback. The continuous path observes actual saved-file changes through a running same-workspace bridge; it still does not expose model keystrokes. See the [watcher contract](project-watcher.md) and [component runtime](../plugins/heart-of-gold/skills/deploy-drive/references/flight-contract.md).

The service computes file hashes, a canonical project digest, and a change summary against the immediately preceding file set. Check records are bound to that submitted project revision and digest. Their outcomes remain host-reported: a syntax pass, source inspection, and a browser interaction are different evidence. The host should actually exercise the requested behavior and mark unexecuted checks `not_run`. A short ledger retains at most 64 component-change metadata receipts within 32 KiB, so reconnecting does not require replaying already seen activity; it contains no previous source contents.

Projects contain 1–24 supported text files, up to 64 KiB each and 256 KiB including component/event metadata. HTML, CSS, JavaScript, Markdown, JSON, and plain text are supported source types. The latest project replaces the previous temporary file set; old source versions are not a retained history. Keep the durable artifact in the host workspace or another user-controlled location. The plugin does not install dependencies, run server-side code, fetch repository links, or publish a site.

Preview runs selected supported source in an isolated browser frame where available. Nested frames require an explicit origin allowlist in ChatGPT; the embedded page also needs its own network policy. A source-only view remains useful when the current host cannot run that preview. Preview permission does not authorize public deployment. [Official iframe guidance](https://developers.openai.com/plugins/build/chatgpt-ui#content-security-policy-csp), [embedded-page security](https://developers.openai.com/plugins/guides/security-privacy#network-access).

## Install the complete package locally

Clone the repository and use its marketplace from the repository root:

```sh
git clone https://github.com/techno-optimist/heart-of-gold.git
cd heart-of-gold
codex plugin marketplace add .
```

The catalog is `.agents/plugins/marketplace.json`, named `projectforty2`. It points to `./plugins/heart-of-gold` relative to the repository root. In a desktop surface that supports local marketplaces, refresh or restart the app, choose **ProjectForty2** in the plugin directory, install **Heart of Gold**, and begin a new chat. [Official local packaging and marketplace guide](https://developers.openai.com/plugins/build/plugins).

The current local Codex CLI also exposes this installation command; check `codex plugin add --help` for your installed version:

```sh
codex plugin add heart-of-gold@projectforty2
```

These commands change the user's plugin configuration when run. They are instructions, not a claim that an installation has been performed. The complete package includes both the skill and remote MCP connection. Installing a local marketplace is different from publishing in the universal directory.

## Preview the MCP integration in ChatGPT

Where the account permits custom MCP plugins, open **Plugins → + → Add custom MCP server** and use:

| Setting | Value |
| --- | --- |
| Name | Heart of Gold |
| Server URL | `https://projectforty2.ai/heartofgold/mcp` |
| Authentication | No authentication |
| Transport | Streamable HTTP |

Review the native connection warning, create the plugin, install it, and use a new Work chat to test tool discovery and the widget. If the control is absent, check the account/workspace policy rather than assuming the connection succeeded. [Official connection steps](https://developers.openai.com/plugins/deploy/connect-chatgpt).

A custom MCP connection tests the tools and UI; it does **not** automatically install this repository's skill. To preview the combined package in ChatGPT, follow the official packaging workflow: register the custom server, obtain its real `plugin_asdk_app...` ID, and have the platform's Plugin Creator wire that registered connection into a local package. Never invent or commit another account's registered connection ID. [Combined skill and MCP testing](https://developers.openai.com/plugins/build/plugins#create-and-test-a-plugin-locally-with-an-mcp-server).

### Install a personal package in ChatGPT

The personal cloud route was demonstrated on 5 November 2026: the raw MCP package uploaded successfully but showed **Open in desktop app**; a private variant referencing the registered connection then showed **Install plugin**, installed, and loaded `deploy-drive` in its setup Work chat. That establishes installation and skill loading on the tested account, not universal account eligibility or completed task execution in ChatGPT.

Official guidance explains that imported MCP declarations can produce a Desktop-only label even for HTTPS servers. Adding an app reference while keeping that declaration does not by itself remove the label. [Desktop-only imports and registered-app mappings](https://learn.chatgpt.com/docs/enterprise/plugin-management#desktop-only-plugins).

1. Register and connect the custom MCP server above. Obtain its actual app ID from the resulting connection. A URL ID `plugin_asdk_app_…` maps to app ID `asdk_app_…`; the uploaded package's separate `plugin_…` ID is not an app ID.
2. Build an account-specific archive from the repository root, replacing the example argument with your registered app ID:

   ```sh
   node scripts/package-personal-plugin.mjs YOUR_REGISTERED_APP_ID ../heart-of-gold-personal.zip 0.7.1
   ```

3. In ChatGPT **Plugins → + → Upload archive**, upload this private ZIP, or use the existing personal plugin's update action. Inspect the imported details and select **Install plugin** when available. Start setup or a new Work chat and verify the skill and connected tools. Account/workspace policies still apply.

The script accepts `asdk_app_`, `connector_`, and `templated_apps_` IDs, and normalizes the documented `plugin_asdk_app_` URL form. It cannot establish ownership or connection access. Its optional third argument changes only the private archive's version; without it, the source version is retained. It reuses public-package validation, removes `mcp.json`, adds `.app.json`, and points `extensions.com.openai.apps` to that mapping. No public source file or version is changed. The output must stay outside the public repository, and the printed receipt omits the account-specific ID.

Keep this ZIP private. Registered-app mappings do not grant others access, and public directory submission currently rejects packages containing `apps` / `.app.json`. The public release keeps its HTTPS MCP definition and goes through the separate developer registration/review process. [App-ID rules](https://learn.chatgpt.com/docs/enterprise/plugin-management#reference-an-existing-app-with-appjson), [public submission rules](https://developers.openai.com/plugins/deploy/submission#automatically-provide-submission-and-review-information).

The public directory is the intended simpler installation path after review. There is no fabricated directory install URL in this repository. Publishing this repository on GitHub is not directory publication.

## What leaves the chat

Tool arguments contain the mission, constraints, member assignments, result summaries, and any evidence URLs the host sends. Artifact updates additionally contain selected paths and exact source text, file/component attribution, declared changed component IDs, reported checks or commands, and optional source revision/project links. ProjectForty2 keeps the latest supplied snapshot and project, with bounded component-event metadata, in temporary server memory so one mounted deck can read updates. This is server state, not a stateless transformation. It is not written to a durable flight database, and service restart loses it. The plugin does not call another model. Hosting infrastructure can still process ordinary request metadata; the chat provider also has its own retention rules. Do not describe the workflow as staying entirely inside the chat.

Access expires two hours after creation, without renewal by reads or updates. Expired entries are removed on access or the next cleanup sweep, scheduled every 60 seconds. Only the latest snapshot/source and up to 64 component metadata receipts are retained, with a maximum of 384 KiB per combined flight, 128 flights, and 8 MiB per server process. The 12 component mappings and event receipts count toward the existing project limit. Capacity rejects new/oversized work instead of evicting an active flight.

Send only scoped summaries and selected project files, not credentials or unrelated private attachments. A one-time disclosure explains source sharing before the build workflow uploads it; an already authorized project connection needs no redundant confirmation. Users who ask for no remote sharing get the host-only workflow without MCP calls. Flight access uses private capabilities returned for that flight; these are not provider credentials or a login account. Keep them out of public links, preview code, and delegated-worker prompts. The plugin cannot access private website runs. See the [plugin privacy policy](https://projectforty2.ai/heartofgold/plugin-privacy.html) for the current retention bounds.

## Package layout and maintenance

```text
.agents/plugins/marketplace.json
plugins/heart-of-gold/
  plugin.json
  mcp.json
  assets/projectforty2.svg
  skills/deploy-drive/
    SKILL.md
    agents/openai.yaml
    references/flight-contract.md
  ui/
```

The portable package uses the Agent Plugins `1.0.0` schemas, with OpenAI listing and review metadata under `extensions.com.openai`. Skills and MCP configuration are discovered at their standard paths. There are no hooks or credential headers. UI source is served by the MCP integration; copying the folder alone does not start a backend.

Create a release archive from the repository root with Node 22+ and Python 3 (standard library only):

```sh
node scripts/package-plugin.mjs ../heart-of-gold-plugin-0.7.1.zip
```

The ZIP has `plugin.json` and `mcp.json` directly at its root, alongside `LICENSE`, `skills/`, and `assets/`. It excludes the website, UI source/build output, marketplace catalog, dependencies, and local data. The packager rejects symlinks, unreviewed file types, missing referenced assets, and common credential/private-path patterns; it verifies the archive and prints its SHA-256. Identical source files produce identical ZIP bytes. These checks do not replace source review or the platform's own validation. Creating the ZIP does not install, upload, submit, or approve it.

The published portable MCP schema currently permits a streamable-HTTP server's `type`, `url`, and optional `headers`. OpenAI's packaging guide also describes provider-specific auth extensions that this schema does not presently accept. This no-auth package uses the shared schema-valid subset. Recheck both official sources before adding authentication. [Portable MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json), [OpenAI packaging guide](https://developers.openai.com/plugins/build/plugins).

Contributions that make the experiment useful: better task presets, grounded debate evaluations, accessible keyboard interactions, accurate host capability detection, and examples that produce a concrete artifact. Preserve the difference between a plan, performed work, and independently verified evidence. Names and original visual language are unofficial Hitchhiker-inspired fan references; the package includes no copied franchise artwork or upstream unlicensed implementation.
