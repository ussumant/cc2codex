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

## Safety

- **Dry-run by default** — nothing written without `--apply`
- **Never overwrites** without `--force`
- **Backs up** existing files before overwriting
- **Warns** about Claude-specific references, size limits, sensitive env vars

## License

MIT
