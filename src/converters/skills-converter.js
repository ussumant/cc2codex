import { parseFrontmatter, findClaudeReferences } from '../utils.js';

/**
 * Convert Claude Code skill files (single .md) to Codex skill directories (dir/SKILL.md).
 * Claude skills: ~/.claude/skills/{name}.md
 * Codex skills: ~/.agents/skills/{name}/SKILL.md
 */
export function convertSkills(inventory) {
  const warnings = [];
  const skills = [];

  const allSkills = [
    ...(inventory.skills || []),
    ...(inventory.projectSkills || []),
  ];

  if (allSkills.length === 0) {
    return { skills, warnings };
  }

  for (const skill of allSkills) {
    const skillWarnings = [];
    const { frontmatter, body } = parseFrontmatter(skill.content || '');

    // Reconstruct content with frontmatter preserved
    let content = '';
    if (Object.keys(frontmatter).length > 0) {
      content += '---\n';
      for (const [key, val] of Object.entries(frontmatter)) {
        content += `${key}: ${val}\n`;
      }
      content += '---\n';
    }
    content += body;

    // Check for Claude-specific references
    const refs = findClaudeReferences(content);
    if (refs.length > 0) {
      skillWarnings.push(`Contains Claude-specific references: ${refs.join(', ')}`);
    }

    // Warn about size
    const sizeBytes = Buffer.byteLength(content, 'utf-8');
    if (sizeBytes > 32768) {
      skillWarnings.push(
        `Skill content is ${(sizeBytes / 1024).toFixed(1)}KB — may exceed Codex context limits`
      );
    }

    // Sanitize name for directory
    const safeName = skill.name
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
      warnings.push(`Skill "${skill.name}": ${skillWarnings.join('; ')}`);
    }
  }

  if (skills.length > 0) {
    warnings.push(
      `${skills.length} skill(s) converted — each becomes a directory with SKILL.md in ~/.agents/skills/`
    );
  }

  return { skills, warnings };
}
