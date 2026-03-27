# cc2codex

> Beta, unofficial Codex migration assistant focused on getting advanced Claude Code users moved over quickly without a blind one-shot rewrite.

An unofficial migration assistant for moving from [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to [OpenAI Codex CLI](https://github.com/openai/codex).

**What it does:** Scans your `~/.claude/` directory, inventories what can be migrated safely, generates a staged migration plan, and lets you apply high-confidence global config and skill conversions separately.

**What it does not promise:** perfect semantic conversion of every Claude-specific workflow. It is optimized for speed, safety, and getting you to a working Codex setup fast.

## Quick Start

```bash
npm install
node bin/cc2codex.js scan                     # See what you have (read-only)
node bin/cc2codex.js plan                     # Build a staged migration plan
node bin/cc2codex.js apply --global           # Apply high-confidence global migration
node bin/cc2codex.js apply --skills           # Apply skills and agent-to-skill conversion
node bin/cc2codex.js validate                 # Verify the generated Codex setup
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

### Step 2: Scan what you have
```bash
node bin/cc2codex.js scan
```
Read-only. Shows your skills count, agents, hooks by event, MCP servers, memory files, and CLAUDE.md combined size.

### Step 3: Build the migration plan
```bash
node bin/cc2codex.js plan
```
Shows the staged migration, warning counts, runtime prerequisites, and which files still need manual review. **Nothing is written.**

### Step 4: Apply the global migration
```bash
node bin/cc2codex.js apply --global
```
Creates the high-confidence global Codex setup:
- `~/.codex/config.toml` — Codex settings plus MCP server sections
- `~/.codex/hooks.json` — your hooks in Codex format
- `~/.codex/CONTEXT.md` — memory files consolidated
- `~/.codex/AGENTS.md` — global instruction file converted from Claude

### Step 5: Apply skills
```bash
node bin/cc2codex.js apply --skills
```
Creates:
- `~/.agents/skills/*/SKILL.md` — converted skills and agent-to-skill outputs

### Step 6 (optional): Bundle into plugins
```bash
node bin/cc2codex.js bundle-plugins --apply
```
Groups related skills + MCP servers into Codex plugins — versioned, distributable packages you can share across projects.

### Step 7: Validate
```bash
node bin/cc2codex.js validate
```
Checks TOML/JSON validity, AGENTS.md sizes, nested skill frontmatter, hook scripts, MCP commands, and plugin manifests/marketplace output.

### Step 8: Test in Codex
```bash
cd your-project
codex "Summarize current instructions"
```
If it reads back your project context — you're migrated.

### Step 9: Run the local test suite
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
