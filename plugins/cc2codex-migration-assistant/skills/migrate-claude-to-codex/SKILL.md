---
name: migrate-claude-to-codex
description: Guide a Claude Code to Codex migration using the local cc2codex CLI with assessment, safe trial migration, validation, and explicit confirmation before live cutover.
---

# Claude to Codex Migration Assistant

Use this skill when the user wants to migrate from Claude Code to Codex and the `cc2codex` CLI is available locally.

## Workflow

1. Start with read-only understanding:
   - run `cc2codex scan`
   - run `cc2codex doctor`
   - run `cc2codex guide`
2. Prefer `cc2codex start` for the guided launch flow.
3. Always use a temporary Codex home first unless the user explicitly asks for live cutover.
4. Explain:
   - what changes in Codex
   - what improves
   - what needs manual redesign
5. Never write to the real `~/.codex` without clear user confirmation.

## Default commands

```bash
cc2codex start --claude-home ~/.claude --codex-home ~/.codex --trial-codex-home /tmp/cc2codex-trial/.codex
```

If the user wants a lighter read-only path:

```bash
cc2codex guide --claude-home ~/.claude --codex-home ~/.codex --trial-codex-home /tmp/cc2codex-trial/.codex
```
