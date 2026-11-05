# Heart of Gold, in the chat

A small crew for big questions. One flight deck stays in the chat while the crew works: the plan becomes actual starts, contributions, critique, and synthesis in that same card. The chat host performs the work. ProjectForty2's MCP service holds the latest reported state for the deck; it does not run an external model.

This is the `0.2.1` plugin package, separate from the website's release numbering. Its one-card protocol replaces the `0.1.x` repeated-rendering design. Source changes, deployment, a successful account installation, and an approved public-directory listing are distinct milestones. This document does not establish deployment or account acceptance of a new version. See [review and verification gates](plugin-review.md).

## What you get

- **Deploy the drive:** a reusable skill that turns the user's task into useful workstreams, includes a skeptic, and reconciles the work into one deliverable.
- **A bounded crew:** 3–7 members including the lead, at most two delegation levels. Generic presets become task-specific output contracts.
- **One inspectable flight deck:** `build_crew` opens the card once; data-only `show_flight` calls update the same flight. The mounted card reads the latest snapshot. Evidence links and unresolved questions stay with the contributions.
- **A useful fallback:** if the host cannot delegate, the same assistant performs clearly labeled guided passes. If embedded UI is unavailable, the answer remains useful in text.

Installing a plugin cannot add a host capability that the account or surface does not expose. Native delegation requires real host tools and returned worker IDs. Work mode subagents are available to eligible accounts; ordinary Chat should not be advertised as a guaranteed parallel-agent environment. Account, workspace, and surface restrictions still apply. [OpenAI subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents), [plugin availability](https://learn.chatgpt.com/docs/plugins).

No provider API key or Sign in with ChatGPT token is required for this plugin. It makes no external AI inference calls and introduces no separate model-provider bill. The host's usage limits still apply. The website's separate provider-key runner remains a different product mode; this plugin does not attach to its sessions or private history.

## Try a mission

After installation, invoke Heart of Gold in a new chat, or invoke its `deploy-drive` skill where that surface supports skill mentions:

> Deploy a small crew to create a one-page onboarding plan for six community-garden volunteers. We have one Saturday and no budget. Include a skeptic, then give me the finished plan.

> Bring in the debate team. Compare these two approaches using only the facts I supply, then recommend one and state the strongest remaining objection.

> Plan a crew for this task. Show the workstreams first and wait before doing the work.

The primary action in the widget sends a follow-up request to the host. It is not an independent server job. Work starts when the host actually starts it, and worker completion appears when the host reports the result. These are meaningful milestones, not live token streams or independently observed telemetry. Follow-up work and results stay in the same deck; the final chat response can be brief.

## One card, updated in place

Only `build_crew` attaches the UI resource. `show_flight` updates temporary server state without attaching a template, and the existing component uses a data-only read tool to refresh itself. This follows OpenAI's separation of render tools from data tools and its example of `app.callServerTool` updating a mounted component. [Official UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui#separate-data-processing-from-ui-rendering).

The host remains the source of work claims. The lead reports actual worker start, completion, failure, and cancellation; related events may be batched. Guided passes remain explicitly one assistant. A moving cursor does not mean the server is watching model tokens. Selection, expanded contributions, and other presentation choices belong to the mounted UI, so refreshing data need not replace the card or reset those choices.

Temporary state can expire or disappear on a server restart. The deck should say that its connection is unavailable and preserve any already displayed result, rather than marking unfinished work complete or silently creating another card. The chat can still carry the requested deliverable. A new card is appropriate for a new mission or an explicit request to reopen one.

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
   node scripts/package-personal-plugin.mjs YOUR_REGISTERED_APP_ID ../heart-of-gold-personal.zip 0.2.1
   ```

3. In ChatGPT **Plugins → + → Upload archive**, upload this private ZIP, or use the existing personal plugin's update action. Inspect the imported details and select **Install plugin** when available. Start setup or a new Work chat and verify the skill and connected tools. Account/workspace policies still apply.

The script accepts `asdk_app_`, `connector_`, and `templated_apps_` IDs, and normalizes the documented `plugin_asdk_app_` URL form. It cannot establish ownership or connection access. Its optional third argument changes only the private archive's version; without it, the source version is retained. It reuses public-package validation, removes `mcp.json`, adds `.app.json`, and points `extensions.com.openai.apps` to that mapping. No public source file or version is changed. The output must stay outside the public repository, and the printed receipt omits the account-specific ID.

Keep this ZIP private. Registered-app mappings do not grant others access, and public directory submission currently rejects packages containing `apps` / `.app.json`. The public release keeps its HTTPS MCP definition and goes through the separate developer registration/review process. [App-ID rules](https://learn.chatgpt.com/docs/enterprise/plugin-management#reference-an-existing-app-with-appjson), [public submission rules](https://developers.openai.com/plugins/deploy/submission#automatically-provide-submission-and-review-information).

The public directory is the intended simpler installation path after review. There is no fabricated directory install URL in this repository. Publishing this repository on GitHub is not directory publication.

## What leaves the chat

Tool arguments contain the mission, constraints, member assignments, result summaries, and any evidence URLs the host sends. ProjectForty2 keeps the latest supplied snapshot in bounded temporary server memory so one mounted deck can read updates. This is server state, not a stateless transformation. It is not written to a durable flight database, and service restart loses it. The plugin does not call another model. Hosting infrastructure can still process ordinary request metadata; the chat provider also has its own retention rules. Do not describe the workflow as staying entirely inside the chat.

Access expires two hours after creation, without renewal by reads or updates. Expired entries are removed on access or the next cleanup sweep, scheduled every 60 seconds. Only the latest snapshot is retained, with a maximum of 96 KiB per flight, 128 flights, and 8 MiB per server process. Capacity rejects new/oversized work instead of evicting an active flight.

Send concise necessary summaries, not credentials or entire private attachments. Users who ask for no remote sharing get the text workflow without MCP calls. Flight access uses private capabilities returned for that flight; these are not provider credentials or a login account. Keep them out of public links and delegated worker prompts. The plugin cannot access private website runs. See the [plugin privacy policy](https://projectforty2.ai/heartofgold/plugin-privacy.html) for the current retention bounds.

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
node scripts/package-plugin.mjs ../heart-of-gold-plugin-0.2.1.zip
```

The ZIP has `plugin.json` and `mcp.json` directly at its root, alongside `LICENSE`, `skills/`, and `assets/`. It excludes the website, UI source/build output, marketplace catalog, dependencies, and local data. The packager rejects symlinks, unreviewed file types, missing referenced assets, and common credential/private-path patterns; it verifies the archive and prints its SHA-256. Identical source files produce identical ZIP bytes. These checks do not replace source review or the platform's own validation. Creating the ZIP does not install, upload, submit, or approve it.

The published portable MCP schema currently permits a streamable-HTTP server's `type`, `url`, and optional `headers`. OpenAI's packaging guide also describes provider-specific auth extensions that this schema does not presently accept. This no-auth package uses the shared schema-valid subset. Recheck both official sources before adding authentication. [Portable MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json), [OpenAI packaging guide](https://developers.openai.com/plugins/build/plugins).

Contributions that make the experiment useful: better task presets, grounded debate evaluations, accessible keyboard interactions, accurate host capability detection, and examples that produce a concrete artifact. Preserve the difference between a plan, performed work, and independently verified evidence. Names and original visual language are unofficial Hitchhiker-inspired fan references; the package includes no copied franchise artwork or upstream unlicensed implementation.
