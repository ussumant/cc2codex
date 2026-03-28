---
name: migrate-claude-to-codex
description: Help someone move from Claude Code to Codex with a safe preview, plain-language guidance, and optional advanced migration tools.
---

# Claude to Codex Migration Assistant

Use this skill when the user wants to bring a Claude Code setup into Codex and the bundled `cc2codex` plugin tools are available in Codex.

## Workflow

1. Default to the non-technical onboarding tools first:
   - `start_claude_import_onboarding`
   - `preview_claude_import`
   - `review_import_readiness`
   - `finish_claude_import`
2. Speak in plain language:
   - what was found
   - what will be brought over
   - what changes in Codex
   - what needs attention from the user
3. Always create a safe preview before writing to the real `~/.codex`.
4. Only use `finish_claude_import` after the user is ready to complete the move.
5. Keep the technical tools available when the user explicitly wants detail or troubleshooting:
   - `scan_claude_setup`
   - `assess_claude_migration`
   - `build_migration_guide`
   - `plan_migration`
   - `run_trial_import`
   - `run_live_import`
   - `validate_codex_home`

## Default tool flow

- Start onboarding: `start_claude_import_onboarding`
- Safe preview: `preview_claude_import`
- Review before finish: `review_import_readiness`
- Complete the import after approval: `finish_claude_import`
