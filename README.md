# cc2codex

Migrate your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) setup to [OpenAI Codex CLI](https://github.com/openai/codex) — automatically.

**What it does:** Scans your `~/.claude/` directory, discovers all skills, agents, hooks, MCP servers, memory files, and `CLAUDE.md` project instructions, then generates the equivalent Codex CLI configuration.

## Quick Start

```bash
npm install
node bin/cc2codex.js scan          # See what you have (read-only)
node bin/cc2codex.js migrate       # Dry-run — shows what it would create
node bin/cc2codex.js migrate --apply  # Actually write the files
```

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

### `migrate` — Convert to Codex format

```bash
cc2codex migrate [--apply] [--force] [--only <component>]
```

- **Dry-run by default** — shows what files would be created
- `--apply` — actually write the files
- `--force` — overwrite existing files (backs up first)
- `--only` — migrate a single component: `skills`, `hooks`, `mcp`, `settings`, `agents`, `memory`, `claude-md`

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
$ cc2codex migrate

🏜️  DRY RUN — no files will be written. Use --apply to execute.

Would create:
  ~ ~/.codex/config.toml
  ~ ~/.codex/hooks.json
  ~ ~/.codex/mcp-servers.toml
  ~ ~/.agents/skills/browse/SKILL.md
  ~ ~/.agents/skills/qa/SKILL.md
  ~ ~/.agents/skills/ship/SKILL.md
  ... (82 skills + 18 agents converted)

Warnings:
  ⚠️  Skill "my-skill": Contains Claude-specific references: Agent tool
  ⚠️  2 AGENTS.md files exceed 32KB limit

Manual steps required:
  → Re-authenticate MCP servers
  → Review AGENTS.md for remaining Claude-specific references
  → Run cc2codex validate
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

### Step 3: Preview the migration
```bash
node bin/cc2codex.js migrate
```
Dry-run. Shows every file it would create, every warning, every manual step. **Nothing is written.**

### Step 4: Run it for real
```bash
node bin/cc2codex.js migrate --apply
```
Creates:
- `~/.codex/config.toml` — Codex settings (model, sandbox, approval policy)
- `~/.codex/hooks.json` — your hooks in Codex format
- `~/.codex/mcp-servers.toml` — MCP server configs
- `~/.agents/skills/*/SKILL.md` — every skill as a Codex skill directory
- `~/.codex/CONTEXT.md` — memory files consolidated
- `*/AGENTS.md` — every CLAUDE.md converted with content cleanup

### Step 5 (optional): Bundle into plugins
```bash
node bin/cc2codex.js bundle-plugins --apply
```
Groups related skills + MCP servers into Codex plugins — versioned, distributable packages you can share across projects.

### Step 6: Validate
```bash
node bin/cc2codex.js validate
```
Checks TOML/JSON validity, AGENTS.md sizes, hook scripts exist, MCP commands installed.

### Step 7: Test in Codex
```bash
cd your-project
codex "Summarize current instructions"
```
If it reads back your project context — you're migrated.

### Manual cleanup (the last 10%)
The tool handles 90% automatically. The remaining manual work:

- **MCP authentication** — some servers need re-authentication in Codex
- **Claude-specific references** — the tool warns about these; search your AGENTS.md files for `CLAUDE.md`, `~/.claude/`, `Agent tool` and update
- **Parallel agent workflows** — if you used `TeamCreate`, restructure to `codex exec` or multiple terminal sessions

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
