# Heart of Gold, in the chat

A small crew for big questions. The plugin brings a bounded plan, contributions, critique, and synthesis into a chat, with an inline constellation you can inspect. The chat host performs the work. ProjectForty2's MCP service renders the plan and reported results; it does not run an external model.

This is the `0.1.0` plugin package, separate from the website's `0.2.x` release. A source package, a working MCP endpoint, a successful account installation, and an approved public-directory listing are distinct milestones. This document provides installation paths; it does not claim public directory approval or universal account availability. See [review and verification gates](plugin-review.md).

## What you get

- **Deploy the drive:** a reusable skill that turns the user's task into useful workstreams, includes a skeptic, and reconciles the work into one deliverable.
- **A bounded crew:** 3–7 members including the lead, at most two delegation levels. Generic presets become task-specific output contracts.
- **An inspectable flight deck:** `build_crew` creates a plan; `show_flight` shows a complete host-reported snapshot. Evidence links and unresolved questions travel with the contributions.
- **A useful fallback:** if the host cannot delegate, the same assistant performs clearly labeled guided passes. If embedded UI is unavailable, the answer remains useful in text.

Installing a plugin cannot add a host capability that the account or surface does not expose. Native delegation requires real host tools and returned worker IDs. Work mode subagents are available to eligible accounts; ordinary Chat should not be advertised as a guaranteed parallel-agent environment. Account, workspace, and surface restrictions still apply. [OpenAI subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents), [plugin availability](https://learn.chatgpt.com/docs/plugins).

No provider API key or Sign in with ChatGPT token is required for this plugin. It makes no external AI inference calls and introduces no separate model-provider bill. The host's usage limits still apply. The website's separate provider-key runner remains a different product mode; this plugin does not attach to its sessions or private history.

## Try a mission

After installation, invoke Heart of Gold in a new chat, or invoke its `deploy-drive` skill where that surface supports skill mentions:

> Deploy a small crew to create a one-page onboarding plan for six community-garden volunteers. We have one Saturday and no budget. Include a skeptic, then give me the finished plan.

> Bring in the debate team. Compare these two approaches using only the facts I supply, then recommend one and state the strongest remaining objection.

> Plan a crew for this task. Show the workstreams first and wait before doing the work.

The primary action in the widget sends a follow-up request to the host. It is not an independent server job or a promise that agents are running in the background. Updates are a few meaningful snapshots, not continuous telemetry. Final results remain host-reported, not independently certified.

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
   node scripts/package-personal-plugin.mjs YOUR_REGISTERED_APP_ID ../heart-of-gold-personal.zip 0.1.1
   ```

3. In ChatGPT **Plugins → + → Upload archive**, upload this private ZIP, or use the existing personal plugin's update action. Inspect the imported details and select **Install plugin** when available. Start setup or a new Work chat and verify the skill and connected tools. Account/workspace policies still apply.

The script accepts `asdk_app_`, `connector_`, and `templated_apps_` IDs, and normalizes the documented `plugin_asdk_app_` URL form. It cannot establish ownership or connection access. Its optional third argument changes only the private archive's version; without it, the source version is retained. It reuses public-package validation, removes `mcp.json`, adds `.app.json`, and points `extensions.com.openai.apps` to that mapping. No public source file or version is changed. The output must stay outside the public repository, and the printed receipt omits the account-specific ID.

Keep this ZIP private. Registered-app mappings do not grant others access, and public directory submission currently rejects packages containing `apps` / `.app.json`. The public release keeps its HTTPS MCP definition and goes through the separate developer registration/review process. [App-ID rules](https://learn.chatgpt.com/docs/enterprise/plugin-management#reference-an-existing-app-with-appjson), [public submission rules](https://developers.openai.com/plugins/deploy/submission#automatically-provide-submission-and-review-information).

The public directory is the intended simpler installation path after review. There is no fabricated directory install URL in this repository. Publishing this repository on GitHub is not directory publication.

## What leaves the chat

Tool arguments contain the mission, constraints, member assignments, result summaries, and any evidence URLs the host sends. ProjectForty2 processes this text to validate and render a snapshot. The plugin application keeps no flight database, user account, cookies, or server session and does not call another model. Hosting infrastructure can still process ordinary request metadata; the chat provider also has its own retention rules. Do not describe the workflow as staying entirely inside the chat.

Send concise necessary summaries, not credentials or entire private attachments. Users who ask for no remote sharing get the text workflow without MCP calls. See the [plugin privacy policy](https://projectforty2.ai/heartofgold/plugin-privacy.html). The endpoint's absence of authentication reflects its stateless rendering role; it does not grant access to private website runs.

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
node scripts/package-plugin.mjs ../heart-of-gold-plugin-0.1.0.zip
```

The ZIP has `plugin.json` and `mcp.json` directly at its root, alongside `LICENSE`, `skills/`, and `assets/`. It excludes the website, UI source/build output, marketplace catalog, dependencies, and local data. The packager rejects symlinks, unreviewed file types, missing referenced assets, and common credential/private-path patterns; it verifies the archive and prints its SHA-256. Identical source files produce identical ZIP bytes. These checks do not replace source review or the platform's own validation. Creating the ZIP does not install, upload, submit, or approve it.

The published portable MCP schema currently permits a streamable-HTTP server's `type`, `url`, and optional `headers`. OpenAI's packaging guide also describes provider-specific auth extensions that this schema does not presently accept. This no-auth package uses the shared schema-valid subset. Recheck both official sources before adding authentication. [Portable MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json), [OpenAI packaging guide](https://developers.openai.com/plugins/build/plugins).

Contributions that make the experiment useful: better task presets, grounded debate evaluations, accessible keyboard interactions, accurate host capability detection, and examples that produce a concrete artifact. Preserve the difference between a plan, performed work, and independently verified evidence. Names and original visual language are unofficial Hitchhiker-inspired fan references; the package includes no copied franchise artwork or upstream unlicensed implementation.
