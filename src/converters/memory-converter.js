import { findClaudeReferences } from '../utils.js';

/**
 * Memory file type categories for grouping
 */
const TYPE_PATTERNS = {
  user: /^user_/i,
  feedback: /^feedback_/i,
  project: /^project_/i,
  reference: /^reference_/i,
};

/**
 * Classify a memory file by its name prefix
 */
function classifyMemoryFile(name) {
  for (const [type, pattern] of Object.entries(TYPE_PATTERNS)) {
    if (pattern.test(name)) return type;
  }
  return 'other';
}

/**
 * Convert Claude Code memory files (MEMORY.md + individual files) into a consolidated
 * markdown section to embed in the global AGENTS.md.
 *
 * Groups memory entries by type: user, feedback, project, reference, other.
 */
export function convertMemory(inventory) {
  const warnings = [];
  const indexes = inventory.memory.indexes || [];

  if (indexes.length === 0 && inventory.memory.files.length === 0) {
    return { contextSection: '', warnings };
  }

  let contextSection = '\n## Persistent Memory\n\n';
  contextSection += '<!-- Migrated from Claude Code auto-memory. Review and prune as needed. -->\n\n';

  // Include the index file content if present
  if (indexes.length > 0) {
    contextSection += '### Memory Index\n\n';
    for (const index of indexes) {
      const indexContent = (index.content || '')
        .replace(/^#\s+Auto Memory Index\s*\n*/i, '')
        .trim();

      if (!indexContent) continue;

      contextSection += `#### ${index.name}\n\n`;
      contextSection += indexContent + '\n\n';
    }
  }

  // Group individual memory files by type
  const groups = { user: [], feedback: [], project: [], reference: [], other: [] };

  for (const file of inventory.memory.files) {
    const type = classifyMemoryFile(file.name);
    groups[type].push(file);
  }

  const groupLabels = {
    user: 'User Profile',
    feedback: 'Feedback & Patterns',
    project: 'Project Context',
    reference: 'Technical References',
    other: 'Other Memory',
  };

  for (const [type, files] of Object.entries(groups)) {
    if (files.length === 0) continue;

    contextSection += `### ${groupLabels[type]}\n\n`;

    for (const file of files) {
      const displayName = file.name.replace(/\.md$/, '').replace(/[_-]/g, ' ');
      contextSection += `#### ${displayName}\n\n`;

      // Trim content and add it inline
      const content = (file.content || '').trim();
      if (content) {
        contextSection += content + '\n\n';
      } else {
        contextSection += '_Empty memory file._\n\n';
      }

      // Check for Claude-specific references
      const refs = findClaudeReferences(content);
      if (refs.length > 0) {
        warnings.push(
          `Memory file "${file.name}" contains Claude-specific references: ${refs.join(', ')}`
        );
      }
    }
  }

  // Size check
  const totalBytes = Buffer.byteLength(contextSection, 'utf-8');
  if (totalBytes > 32768) {
    warnings.push(
      `Consolidated memory section is ${(totalBytes / 1024).toFixed(1)}KB — consider pruning to stay under 32KB`
    );
  }

  const fileCount = inventory.memory.files.length + indexes.length;
  warnings.push(
    `${fileCount} memory file(s) consolidated into a single AGENTS.md section`
  );

  return { contextSection, warnings };
}
