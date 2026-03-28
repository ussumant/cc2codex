---
name: migrate-claude-to-codex
description: Guide a Claude Code to Codex migration using the local cc2codex CLI with assessment, safe trial migration, validation, and explicit confirmation before live cutover.
---

# Claude to Codex Migration Assistant

Use this skill when the user wants to migrate from Claude Code to Codex and the bundled `cc2codex` plugin tools are available in Codex.

## Workflow

1. Start with the MCP tools instead of shell commands:
   - `scan_claude_setup`
   - `assess_claude_migration`
   - `build_migration_guide`
2. Prefer `run_trial_import` before any live write.
3. Always use a temporary Codex home first unless the user explicitly asks for live cutover.
4. Only use `run_live_import` after the trial output has been reviewed and the user wants the real `~/.codex` updated.
5. Explain:
   - what changes in Codex
   - what improves
   - what needs manual redesign
6. Never write to the real `~/.codex` without clear user confirmation.

## Default tool flow

- Read-only inventory: `scan_claude_setup`
- Readiness and risks: `assess_claude_migration`
- Step-by-step plan: `build_migration_guide`
- Safe staged import: `run_trial_import`
- Live validation: `validate_codex_home`
- Real cutover after approval: `run_live_import`
