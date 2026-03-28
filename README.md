# cc2codex

Bring a Claude Code setup into Codex with a safe preview first.

`cc2codex` is a migration assistant for people moving from Claude Code to Codex. The most reliable way to use it today is through the Codex CLI plugin flow, with the Codex app UI as a secondary path if local plugins appear there on your machine.

## What Imports Well

- reusable Claude instructions and `CLAUDE.md` guidance
- skills that map cleanly into Codex skill directories
- agent workflows that can be simplified into Codex skills
- high-confidence hooks
- MCP server structure and local command configuration

## What Still Needs Review

- MCP tokens, API keys, and other secrets still need to be re-entered
- Claude-only hook events may need cleanup or removal
- team-style Claude agent workflows may need redesign
- large or very Claude-specific instruction sets may need trimming after import

## Quick Start

If you only copy one section, copy this one.

### Recommended: Codex CLI Plugin Flow

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/ussumant/cc2codex.git
cd cc2codex
npm install
```

2. Install the Codex plugin:

```bash
node bin/cc2codex.js install-plugin --force
```

3. Check that the install is healthy:

```bash
node bin/cc2codex.js verify-plugin-install
```

4. Start Codex in Terminal:

```bash
codex
```

5. Inside Codex, open the plugin manager:

```text
/plugins
```

6. Enable `Claude to Codex Migration Assistant`.
7. Start a new thread and paste this:

```text
Help me bring my Claude Code setup into Codex.
```

That starts the non-technical flow:
- Codex finds your old Claude setup automatically
- Codex creates a safe preview in `/tmp/cc2codex-trial/.codex`
- Codex explains what was imported and what still needs attention
- Codex only updates your real `~/.codex` after you approve it

Recommended follow-up prompts:

```text
Show me what was imported and what still needs my attention.
```

```text
Finish importing my Claude setup into Codex.
```

If Codex says the plugin install is stale or broken, run:

```bash
node bin/cc2codex.js install-plugin --force
```

### Optional: Codex App UI

If local plugins show up in the Codex app on your machine, you can also:

1. Restart the Codex app.
2. Open the Plugins page in the UI.
3. Look for `Claude to Codex Migration Assistant`.
4. Enable it and use the same prompts shown above.

If the plugin does not appear there, use the Codex CLI flow above instead.

### CLI Fallback

```bash
node bin/cc2codex.js start --claude-home ~/.claude --codex-home ~/.codex
```

Run that from inside the `cc2codex` folder. If you want a global command, run `npm link` once and then use `cc2codex start ...`.

## Troubleshooting

### Plugin install looks stale or broken

```bash
node bin/cc2codex.js install-plugin --force
```

### Check whether the plugin install is healthy

```bash
node bin/cc2codex.js verify-plugin-install
```

### Plugin does not appear in the Codex app

Use the Codex CLI route instead:

```bash
node bin/cc2codex.js verify-plugin-install
codex
```

Then inside Codex CLI:

```text
/plugins
```

### Codex says it cannot find your Claude setup

Make sure Claude Code data exists at `~/.claude`, or use a custom Claude home path in advanced mode.

### Error: `Cannot find module '.../bin/cc2codex.js'`

That means you ran:

```bash
node bin/cc2codex.js ...
```

from the wrong directory. Fix it by `cd`-ing into the repo folder first, or by running `npm link` and then using `cc2codex`.

## Advanced Commands

Use these only if you want more control than the standard Codex CLI plugin flow provides.

### `start`

```bash
cc2codex start [--claude-home ~/.claude] [--codex-home ~/.codex] [--trial-codex-home /tmp/cc2codex-trial/.codex] [--project ./my-project] [--yes] [--json]
```

Runs the guided migration flow with a safe preview before live cutover.

### `install-plugin`

```bash
cc2codex install-plugin [--target-dir ~/.codex/plugins/cc2codex-migration-assistant] [--marketplace-path ~/.agents/plugins/marketplace.json] [--force]
```

Installs the bundled Codex migration plugin.

### `verify-plugin-install`

```bash
cc2codex verify-plugin-install [--target-dir ~/.codex/plugins/cc2codex-migration-assistant] [--marketplace-path ~/.agents/plugins/marketplace.json] [--claude-home ~/.claude] [--json]
```

Checks plugin wiring, repo path, marketplace entry, and Claude home availability.

### `scan`

```bash
cc2codex scan [--claude-home ~/.claude] [--project ./my-project] [--json]
```

Read-only inventory of a Claude Code setup.

### `doctor`

```bash
cc2codex doctor [--claude-home ~/.claude] [--project ./my-project] [--codex-home ~/.codex] [--json]
```

Readiness report with risks and migration guidance.

### `guide`

```bash
cc2codex guide [--claude-home ~/.claude] [--project ./my-project] [--codex-home ~/.codex] [--trial-codex-home /tmp/cc2codex-trial/.codex] [--json]
```

Step-by-step migration playbook.

### `plan`

```bash
cc2codex plan [--claude-home ~/.claude] [--project ./my-project] [--codex-home ~/.codex] [--json]
```

Staged migration plan without writing files.

### `apply`

```bash
cc2codex apply --global [--force]
cc2codex apply --skills [--force]
cc2codex apply --global --skills [--force]
```

Applies staged migration scopes.

### `validate`

```bash
cc2codex validate [--codex-home ~/.codex]
```

Validates a migrated Codex setup.
