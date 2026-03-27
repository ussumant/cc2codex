import { findClaudeReferences } from '../utils.js';

/**
 * Valid hook events shared between Claude Code and Codex
 */
export const VALID_EVENTS = [
  'SessionStart',
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Stop',
];

/**
 * Convert hooks from Claude Code settings.json format to Codex hooks.json format.
 * Both systems use the same event names and similar structure.
 */
export function convertHooks(inventory) {
  const warnings = [];
  const hooksJson = [];

  if (!inventory.hooks || inventory.hooks.length === 0) {
    return { hooksJson, warnings };
  }

  for (const hook of inventory.hooks) {
    // Validate event name
    if (!VALID_EVENTS.includes(hook.event)) {
      warnings.push(`Unknown hook event "${hook.event}" — may not be supported in Codex`);
      continue;
    }

    const codexHook = {
      event: hook.event,
      command: hook.command,
    };

    // Preserve matcher if present
    if (hook.matcher) {
      codexHook.matcher = hook.matcher;
    }

    // Preserve timeout if present
    if (hook.timeout) {
      codexHook.timeout = hook.timeout;
    }

    // Check command for Claude-specific references
    const refs = findClaudeReferences(hook.command || '');
    if (refs.length > 0) {
      warnings.push(
        `Hook "${hook.name || hook.event}" command references Claude-specific content: ${refs.join(', ')}`
      );
    }

    // Check matcher for Claude-specific tool names
    if (hook.matcher) {
      const matcherStr = typeof hook.matcher === 'string' ? hook.matcher : JSON.stringify(hook.matcher);
      const matcherRefs = findClaudeReferences(matcherStr);
      if (matcherRefs.length > 0) {
        warnings.push(
          `Hook "${hook.name || hook.event}" matcher references Claude-specific content: ${matcherRefs.join(', ')}`
        );
      }
    }

    hooksJson.push(codexHook);
  }

  if (hooksJson.length > 0) {
    warnings.push(
      `${hooksJson.length} hook(s) converted — verify commands work in Codex environment`
    );
  }

  return { hooksJson, warnings };
}
