import { join } from 'path';
import { parseFrontmatter, findClaudeReferences, resolveAgentsHome } from '../utils.js';

function ensureSkillFrontmatter(frontmatter, fallbackName, kind) {
  const normalized = { ...frontmatter };

  if (!normalized.name) {
    normalized.name = fallbackName;
  }

  if (!normalized.description) {
    normalized.description = `Migrated ${kind} from Claude Code`;
  }

  return normalized;
}

/**
 * Convert Claude Code skill files (single .md) to Codex skill directories (dir/SKILL.md).
 * Claude skills: ~/.claude/skills/{name}.md
 * Codex skills: ~/.agents/skills/{name}/SKILL.md
 */
export function convertSkills(inventory, opts = {}) {
  const agentsHome = opts.agentsHome || resolveAgentsHome();
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
    const normalizedFrontmatter = ensureSkillFrontmatter(frontmatter, skill.name, 'skill');

    // Reconstruct content with frontmatter preserved
    let content = '';
    content += '---\n';
    for (const [key, val] of Object.entries(normalizedFrontmatter)) {
      content += `${key}: ${val}\n`;
    }
    content += '---\n';
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
      outputDir: join(agentsHome, 'skills', safeName),
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
