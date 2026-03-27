import { parseFrontmatter, findClaudeReferences } from '../utils.js';

/**
 * Convert Claude Code agent definitions to Codex skills.
 * Codex has no agent concept (no parallel spawning), so agents become skills
 * with migration notes about the capability gap.
 */
export function convertAgents(inventory) {
  const warnings = [];
  const skills = [];

  const allAgents = [
    ...(inventory.agents || []),
    ...(inventory.projectAgents || []),
  ];

  if (allAgents.length === 0) {
    return { skills, warnings };
  }

  warnings.push(
    'Codex has no agent concept — agents are converted to skills. ' +
    'Parallel spawning (TeamCreate) is not available; use codex exec or multi-terminal instead.'
  );

  for (const agent of allAgents) {
    const skillWarnings = [];
    const { frontmatter, body } = parseFrontmatter(agent.content || '');

    // Build content with migration header
    let content = '';

    // Preserve frontmatter
    if (Object.keys(frontmatter).length > 0) {
      content += '---\n';
      for (const [key, val] of Object.entries(frontmatter)) {
        content += `${key}: ${val}\n`;
      }
      content += '---\n';
    }

    // Add migration note
    content += '\n<!-- Migration note: This was a Claude Code agent. -->\n';
    content += '<!-- Codex has no parallel agent spawning. Use codex exec or multi-terminal for parallel work. -->\n\n';

    content += body;

    // Check for Claude-specific references
    const refs = findClaudeReferences(content);
    if (refs.length > 0) {
      skillWarnings.push(`Contains Claude-specific references: ${refs.join(', ')}`);
    }

    // Check for agent-specific patterns that won't work
    if (/TeamCreate|SendMessage|Agent\s+tool/i.test(agent.content || '')) {
      skillWarnings.push(
        'Uses agent orchestration features (TeamCreate/SendMessage) — requires manual rewrite for Codex'
      );
    }

    // Sanitize name for directory
    const safeName = agent.name
      .replace(/\//g, '-')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .toLowerCase();

    skills.push({
      name: safeName,
      outputDir: `~/.agents/skills/${safeName}/`,
      content,
      warnings: skillWarnings,
    });

    if (skillWarnings.length > 0) {
      warnings.push(`Agent "${agent.name}": ${skillWarnings.join('; ')}`);
    }
  }

  if (skills.length > 0) {
    warnings.push(
      `${allAgents.length} agent(s) converted to skills in ~/.agents/skills/`
    );
  }

  return { skills, warnings };
}
