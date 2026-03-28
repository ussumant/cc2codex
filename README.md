# cc2codex

> Beta, unofficial Codex migration assistant focused on getting advanced Claude Code users moved over quickly without a blind one-shot rewrite.

An unofficial migration assistant for moving from [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to [OpenAI Codex CLI](https://github.com/openai/codex).

**What it does:** Scans your `~/.claude/` directory, inventories what can be migrated safely, generates a staged migration plan, and lets you apply high-confidence global config and skill conversions separately.

**What it does not promise:** perfect semantic conversion of every Claude-specific workflow. It is optimized for speed, safety, and getting you to a working Codex setup fast.

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

### Recommended For Codex App Users

If you are already using the Codex app and just want help bringing over your Claude Code setup, use this path.

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

3. Restart the Codex app.
4. Open `/plugins`.
5. Enable `Claude to Codex Migration Assistant`.
6. In Codex, paste this:

```text
Help me bring my Claude Code setup into Codex.
```

That starts the non-technical flow:
- Codex finds your old Claude setup automatically
- Codex creates a safe preview in `/tmp/cc2codex-trial/.codex`
- Codex explains what was imported and what still needs attention
- Codex only updates your real `~/.codex` after you approve it

If Codex says the plugin install is stale or broken, run:

```bash
node bin/cc2codex.js install-plugin --force
```

After the preview, the two most useful follow-up prompts are:

```text
Show me what was imported and what still needs my attention.
```

```text
Finish importing my Claude setup into Codex.
```

### Option A — Run from the repo folder

```bash
git clone https://github.com/ussumant/cc2codex.git
cd cc2codex
npm install
node bin/cc2codex.js start --claude-home ~/.claude --codex-home ~/.codex
```

Important:
- Run `node bin/cc2codex.js ...` **from inside the `cc2codex` folder**
- If you run that command from some other directory, Node will look for the wrong `bin/cc2codex.js`

### Option B — Install the command once, then use `cc2codex`

```bash
git clone https://github.com/ussumant/cc2codex.git
cd cc2codex
npm install
npm link
cc2codex start --claude-home ~/.claude --codex-home ~/.codex
```

This is the easiest option if you are not comfortable remembering the repo path.

### What happens when you run `start`

- `cc2codex` looks at your Claude Code setup in `~/.claude`
- it explains what will change in Codex
- it creates a **safe trial migration** in `/tmp/cc2codex-trial/.codex`
- it validates that trial output
- it stops and asks before touching your real `~/.codex`
- it writes a `migration-dossier.md` so you can review what happened

```bash
npm install
node bin/cc2codex.js start --claude-home ~/.claude --codex-home ~/.codex
```

`start` is the launch-grade guided flow:
- assesses readiness
- explains what changes in Codex for this setup
- runs a safe trial migration into `/tmp/cc2codex-trial/.codex`
- pauses before live cutover unless you pass `--yes`
- writes a `migration-dossier.md` for review

## If You Get An Error

### Error: `Cannot find module '.../bin/cc2codex.js'`

That means you are running:

```bash
node bin/cc2codex.js ...
```

from the wrong directory.

Fix it by either:

```bash
cd /full/path/to/cc2codex
node bin/cc2codex.js start --claude-home ~/.claude --codex-home ~/.codex
```

or:

```bash
npm link
cc2codex start --claude-home ~/.claude --codex-home ~/.codex
```

### `npm audit` warnings

Those are unrelated to the `Cannot find module` error.
They do **not** mean the migration command itself is broken.

## Non-Technical Walkthrough

If you do not use the terminal much, follow these exact steps:

1. Open Terminal.
2. Copy and paste this:

```bash
git clone https://github.com/ussumant/cc2codex.git
```

3. Then copy and paste this:

```bash
cd cc2codex
```

4. Then copy and paste this:

```bash
npm install
```

5. Then copy and paste this:

```bash
node bin/cc2codex.js start --claude-home ~/.claude --codex-home ~/.codex
```

6. Read the output.
   - It will first create a safe trial migration.
   - It should **not** change your real Codex setup until it asks.

7. If you want a simpler command for the future, run:

```bash
npm link
```

After that, you can use:

```bash
cc2codex start --claude-home ~/.claude --codex-home ~/.codex
```

## Release Status

`cc2codex` is currently a beta migration assistant. The supported promise is:
- fast inventory of an existing Claude Code setup
- selective application of high-confidence Codex-compatible outputs
- explicit reporting of follow-up items instead of silently guessing

If you want a no-surprises migration, use `plan` first, then `apply --global`, then `apply --skills`, then `validate`.

## What Gets Migrated

| Claude Code | Codex CLI | How |
|---|---|---|
| `CLAUDE.md` | `AGENTS.md` | Rename + content cleanup + 32KB size check |
| `settings.json` | `config.toml` | JSON → TOML with semantic mapping |
| Skills (`.md` files) | Skills (`SKILL.md` dirs) | File → directory restructuring |
| Agents (`.md` files) | Skills | Converted to skills (no parallel spawn in Codex) |
| Hooks | `hooks.json` | Same events, different config format |
| MCP Servers | `config.toml` sections | JSON → TOML |
| Memory (`MEMORY.md`) | `CONTEXT.md` | Consolidated into single context file |

## Commands

### `start` — Run the guided migration launch flow

```bash
cc2codex start [--claude-home ~/.claude] [--codex-home ~/.codex] [--trial-codex-home /tmp/cc2codex-trial/.codex] [--project ./my-project] [--yes] [--json]
```

This is the primary command for new users. It:
- runs assessment and readiness scoring
- generates a staged migration guide
- performs a safe trial migration before touching the live Codex home
- validates the trial output
- asks for confirmation before live cutover
- writes `migration-dossier.md` to the trial and live Codex homes

### `scan` — Discover your Claude Code setup

```bash
cc2codex scan [--claude-home ~/.claude] [--project ./my-project] [--json]
```

Outputs an inventory: skills count, agents, hooks by event, MCP servers, memory files, CLAUDE.md files with combined size check.

### `plan` — Build a staged migration plan

```bash
cc2codex plan [--claude-home ~/.claude] [--project ./my-project] [--codex-home ~/.codex] [--json]
```

Outputs a two-stage migration plan:
- **Global** — high-confidence Codex config, hooks, MCP, memory/context, global instructions
- **Skills** — skill conversion and agent-to-skill conversion

It also highlights manual follow-up items like unsupported hook events and project `CLAUDE.md` files.

### `doctor` — Get a personalized migration assessment

```bash
cc2codex doctor [--claude-home ~/.claude] [--project ./my-project] [--codex-home ~/.codex] [--json]
```

Outputs a read-only readiness report with:
- migration readiness score and complexity
- biggest risks based on your actual setup
- what changes in Codex for permissions, hooks, agents, MCP, and skills
- what likely improves after the move
- a recommended staged flow for trial migration and real cutover

### `guide` — Get a personalized step-by-step migration playbook

```bash
cc2codex guide [--claude-home ~/.claude] [--project ./my-project] [--codex-home ~/.codex] [--trial-codex-home /tmp/cc2codex-trial/.codex] [--json]
```

Outputs a read-only playbook with:
- exact commands for assessment, trial migration, review, and live cutover
- a temporary trial Codex home so you can validate before touching your real config
- setup-specific review checkpoints for hooks, MCP auth, instructions, and agent workflows
- a final post-cutover checklist

### `install-plugin` — Install the bundled Codex migration plugin

```bash
cc2codex install-plugin [--target-dir ~/.codex/plugins/cc2codex-migration-assistant] [--marketplace-path ~/.agents/plugins/marketplace.json] [--force]
```

Installs the repo’s bundled Codex plugin into the official local Codex plugin path and updates the local plugin marketplace entry so the migration assistant can be surfaced inside Codex.

Important:
- this plugin now includes a bundled MCP server, so Codex can call real migration tools from inside the app
- you do **not** need `npm link` just to use the plugin
- the installer writes the current repo path into the installed plugin so it can call this clone directly
- if you move or delete the repo later, run `cc2codex install-plugin --force` again from the new repo location

To check whether the plugin install is still healthy:

```bash
cc2codex verify-plugin-install
```

### Use It Inside the Codex App

After installing the plugin:

1. Restart the Codex app.
2. Open `/plugins`.
3. Enable `Claude to Codex Migration Assistant`.
4. Then ask Codex something simple like:

```text
Help me bring my Claude Code setup into Codex.
```

Recommended follow-up prompts:

```text
Show me what was imported and what still needs my attention.
```

```text
Finish importing my Claude setup into Codex.
```

For non-technical users, the intended flow inside Codex is:
- Codex finds your old Claude setup automatically
- Codex explains what it found in plain language
- Codex creates a safe preview import in `/tmp/cc2codex-trial/.codex`
- Codex tells you what still needs attention
- Codex only updates your real `~/.codex` after you approve it

If you want a more explicit prompt:

```text
Use the Claude to Codex Migration Assistant to preview my Codex setup before changing anything real.
```

If you want a more explicit review prompt:

```text
Use the Claude to Codex Migration Assistant to review my preview import and tell me what still needs attention.
```

The plugin now supports two layers:
- non-technical onboarding tools for “bring my Claude setup into Codex”
- technical migration tools for power users who want detailed control

### `verify-plugin-install` — Check plugin health before using it in Codex

```bash
cc2codex verify-plugin-install [--target-dir ~/.codex/plugins/cc2codex-migration-assistant] [--marketplace-path ~/.agents/plugins/marketplace.json] [--claude-home ~/.claude] [--json]
```

Use this when:
- the plugin does not appear in Codex
- the repo was moved to another folder
- Codex says the migration assistant needs repair
- you want to confirm the plugin can still find your Claude setup

It checks:
- the installed plugin directory
- the plugin `.mcp.json`
- the MCP server script path
- the connected repo root
- the marketplace entry
- whether a Claude setup exists at the expected location

### `apply` — Apply a staged migration scope

```bash
cc2codex apply --global [--force]
cc2codex apply --skills [--force]
cc2codex apply --global --skills [--force]
```

- `--global` — writes high-confidence global config and context
- `--skills` — writes skills and agent conversions into the target `.agents` tree
- `--force` — overwrite existing files (backs up first)

### `migrate` — Legacy one-shot flow

```bash
cc2codex migrate [--apply] [--force] [--only <component>]
```

Still available for power users and backwards compatibility. For public use, prefer `plan` + `apply`.

### `bundle-plugins` — Group skills into Codex plugins

```bash
cc2codex bundle-plugins [--apply]
```

Groups related skills + MCP servers into distributable Codex plugins. The bundler auto-groups your skills by category. For example, if you have QA-related skills, it might produce:

```
~/.agents/plugins/qa-toolkit/
├── .codex-plugin/
│   └── plugin.json
├── skills/
│   ├── qa/SKILL.md
│   ├── browse/SKILL.md
│   └── canary/SKILL.md
└── .mcp.json              # bundled MCP servers
```

The default bundle definitions live in `src/converters/plugin-bundler.js` — edit `DEFAULT_BUNDLES` to customize groupings for your setup.

### `validate` — Verify migration

```bash
cc2codex validate [--codex-home ~/.codex]
```

Checks: TOML/JSON validity, AGENTS.md size limits, hook script existence, MCP command availability, Claude-specific reference detection.

## Example Output

```
$ cc2codex start --claude-home ~/.claude --codex-home ~/.codex

🚀 Starting guided Claude Code → Codex migration...

Launch Summary:
  Readiness:     50/100 (low)
  Complexity:    advanced
  Trial target:  /tmp/cc2codex-trial/.codex
  Live target:   /Users/name/.codex

Top risks:
  • Some Claude hook events do not map directly to Codex
  • Your setup uses agent-team style workflows
  • Some MCP servers require secret re-entry
```

```
$ cc2codex scan

🔍 Scanning Claude Code setup...

Claude Code Inventory:
  Settings:      found
  Skills:        82 files
  Agents:        18 files
  Hooks:         20 hooks
  MCP Servers:   7 servers
  Memory Files:  12 files
  CLAUDE.md:     38 files
  Env Vars:      3 vars

  ⚠️  Combined CLAUDE.md size: 552.1KB (exceeds 32KB Codex limit)

  Hooks by event:
    SessionStart: 3
    UserPromptSubmit: 4
    PreToolUse: 8
    PostToolUse: 1
    Stop: 1
```

```
$ cc2codex plan

🧭 Building migration plan...

Migration Summary:
  Global files:   4
  Skill files:    103
  Skills:         82
  Agents:         21
  MCP Servers:    7
  Runtime cmds:   bun, node, npx

  Unsupported hook events: PermissionRequest, SubagentStop
  Project CLAUDE.md files needing manual review: 37

Apply high-confidence global migration
  Confidence: safe_with_review
  Files:      4
  Warnings:   8

Apply converted skills and agent-to-skill outputs
  Confidence: safe_with_review
  Files:      103
  Warnings:   26
```

## Feature Mapping

### What maps cleanly
- **Hooks** — identical events (SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, Stop)
- **MCP Servers** — full support, just config format change
- **Plan Mode** — Codex has native Plan Mode (`/plan`, `Shift+Tab`)
- **Skills** — same concept, directory structure instead of single files

### What needs manual work
- **Agent Teams / Parallel Agents** — no Codex equivalent. Use `codex exec` or multi-terminal
- **Auto-Memory** — no Codex equivalent. Context baked into AGENTS.md
- **Granular Permissions** — Codex uses OS-level sandboxing, not tool-level allow lists

### What's better in Codex
- **Plugin System** — bundle skills + MCP + apps into distributable, versioned packages
- **Plan Mode** — native Plan → Pair → Execute workflow
- **OS-level Sandboxing** — Seatbelt (macOS) / bubblewrap (Linux)

## Why Migrate Now

**Your Claude Code setup isn't portable.** Every `CLAUDE.md`, every skill referencing `EnterPlanMode` or `TeamCreate`, every hook in `settings.json` — it's all proprietary format. If you've invested weeks building skills, agents, and workflows, that investment is currently locked to one vendor.

**Three reasons to switch:**

1. **Conversation limits** — Power users hit the wall mid-session. You start rationing prompts instead of working freely. Codex has a different throttling model.

2. **Vendor lock-in** — Your 50+ skills, your hooks, your MCP configs, your project instructions — none of it transfers without a tool like this. cc2codex converts it in minutes.

3. **Codex caught up** — Native Plan Mode (no plugin needed), a Plugin system that bundles skills + MCP + apps into versioned packages, OS-level sandboxing, open source (Apache-2.0, 68k stars).

## Full Migration Guide

### Prerequisites
- Node.js 18+
- An existing Claude Code setup (`~/.claude/` directory)
- OpenAI Codex CLI installed: `npm i -g @openai/codex`

### Step 1: Clone and install
```bash
git clone https://github.com/ussumant/cc2codex.git
cd cc2codex
npm install
```

### Step 2: Run the guided flow
```bash
node bin/cc2codex.js start --claude-home ~/.claude --codex-home ~/.codex
```

This is the recommended path for almost everyone.

### Step 3 (optional): Install the command globally on your machine
```bash
npm link
```

Then you can use:

```bash
cc2codex start --claude-home ~/.claude --codex-home ~/.codex
```

### Step 4 (advanced): Scan what you have
```bash
node bin/cc2codex.js scan
```
Read-only. Shows your skills count, agents, hooks by event, MCP servers, memory files, and CLAUDE.md combined size.

### Step 5 (advanced): Build the migration plan
```bash
node bin/cc2codex.js plan
```
Shows the staged migration, warning counts, runtime prerequisites, and which files still need manual review. **Nothing is written.**

### Step 6 (advanced): Apply the global migration
```bash
node bin/cc2codex.js apply --global
```
Creates the high-confidence global Codex setup:
- `~/.codex/config.toml` — Codex settings plus MCP server sections
- `~/.codex/hooks.json` — your hooks in Codex format
- `~/.codex/CONTEXT.md` — memory files consolidated
- `~/.codex/AGENTS.md` — global instruction file converted from Claude

### Step 7 (advanced): Apply skills
```bash
node bin/cc2codex.js apply --skills
```
Creates:
- `~/.agents/skills/*/SKILL.md` — converted skills and agent-to-skill outputs

### Step 8 (optional): Bundle into plugins
```bash
node bin/cc2codex.js bundle-plugins --apply
```
Groups related skills + MCP servers into Codex plugins — versioned, distributable packages you can share across projects.

### Step 9: Validate
```bash
node bin/cc2codex.js validate
```
Checks TOML/JSON validity, AGENTS.md sizes, nested skill frontmatter, hook scripts, MCP commands, and plugin manifests/marketplace output.

### Step 10: Test in Codex
```bash
cd your-project
codex "Summarize current instructions"
```
If it reads back your project context — you're migrated.

### Step 11: Run the local test suite
```bash
npm test
```
Exercises fixture-based scan, migrate, bundle, backup, and validate flows.

### Manual cleanup (the last 10%)
The tool handles 90% automatically. The remaining manual work:

- **MCP authentication** — some servers need re-authentication in Codex
- **Claude-specific references** — the assistant warns about these; search your AGENTS.md and migrated skills for `CLAUDE.md`, `~/.claude/`, `Agent tool` and update
- **Parallel agent workflows** — if you used `TeamCreate`, restructure to `codex exec` or multiple terminal sessions
- **Project `CLAUDE.md` files** — v1 reports these for manual follow-up instead of auto-applying them by default

### Quick Reference: Claude Code → Codex

| Action | Claude Code | Codex CLI |
|--------|-------------|-----------|
| Start a session | `claude` | `codex` |
| Invoke a skill | `/skill-name` | `$skill-name` or `/skills` |
| Plan mode | Plugin-based | `Shift+Tab` or `/plan` (native) |
| Switch to execution | Exit plan mode | `Shift+Tab` to Pair/Execute |
| Code review | `/review` skill | `/review` (built-in) |
| Run shell command | `! command` | `! command` |
| Full auto mode | `--dangerouslySkipPermissions` | `--full-auto` |
| Project instructions | `CLAUDE.md` | `AGENTS.md` |
| Settings | `~/.claude/settings.json` | `~/.codex/config.toml` |
| Skills location | `~/.claude/skills/*.md` | `~/.agents/skills/*/SKILL.md` |

## Safety

- **Dry-run by default** — nothing written without `--apply`
- **Never overwrites** without `--force`
- **Backs up** existing files before overwriting
- **Warns** about Claude-specific references, size limits, sensitive env vars

## License

MIT
