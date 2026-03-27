# Changelog

## 0.2.0

- Repositioned `cc2codex` as an unofficial beta Codex migration assistant.
- Added staged workflow: `scan`, `plan`, `apply --global`, `apply --skills`, `validate`.
- Kept `migrate` as a legacy one-shot flow for power users.
- Unified MCP migration and validation around `config.toml`.
- Made `bundle-plugins --apply` write real plugin output.
- Improved migration safety with backup collision fixes and selective apply behavior.
- Added planner/report support, cleaner JSON output, and better warning handling.
- Expanded test coverage for staged migration flows and validation.
