import { join, dirname } from 'path';
import { findClaudeReferences, resolveCodexHome } from '../utils.js';

/**
 * Path mapping rules for CLAUDE.md → AGENTS.md conversion
 */
const PATH_MAPPINGS = [
  { match: /^~\/\.claude\/CLAUDE\.md$/, output: '~/.codex/AGENTS.md' },
  { match: /\.claude\/CLAUDE\.md$/, output: (p) => p.replace(/\.claude\/CLAUDE\.md$/, '.codex/AGENTS.md') },
  { match: /CLAUDE\.md$/, output: (p) => p.replace(/CLAUDE\.md$/, 'AGENTS.md') },
];

/**
 * Claude-specific terms and their Codex replacements
 */
const CONTENT_REPLACEMENTS = [
  { pattern: /CLAUDE\.md/g, replacement: 'AGENTS.md' },
  { pattern: /~\/\.claude\//g, replacement: '~/.codex/' },
  { pattern: /\.claude\//g, replacement: '.codex/' },
  { pattern: /settings\.json/g, replacement: 'config.toml' },
  { pattern: /settings\.local\.json/g, replacement: 'config.toml' },
  { pattern: /Claude Code/g, replacement: 'Codex CLI' },
];

/**
 * Map a source CLAUDE.md path to its Codex AGENTS.md output path
 */
function mapOutputPath(sourcePath, codexHome) {
  const defaultCodexHome = resolveCodexHome();
  const defaultGlobalClaudePath = defaultCodexHome.replace(/\/\.codex$/, '/.claude/CLAUDE.md');

  if (sourcePath === defaultGlobalClaudePath) {
    return join(codexHome, 'AGENTS.md');
  }

  for (const { match, output } of PATH_MAPPINGS) {
    if (match.test(sourcePath)) {
      return typeof output === 'function' ? output(sourcePath) : output;
    }
  }
  // Fallback: replace filename
  return sourcePath.replace(/CLAUDE\.md$/i, 'AGENTS.md');
}

/**
 * Clean up Claude-specific references in content
 */
function cleanContent(content) {
  let cleaned = content;
  for (const { pattern, replacement } of CONTENT_REPLACEMENTS) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  return cleaned;
}

/**
 * Convert CLAUDE.md files to AGENTS.md format.
 * Handles content cleanup, size checking, and path mapping.
 */
export function convertClaudeMd(inventory, opts = {}) {
  const warnings = [];
  const files = [];
  const codexHome = opts.codexHome || resolveCodexHome();

  if (!inventory.claudeMdFiles || inventory.claudeMdFiles.length === 0) {
    return { files, warnings };
  }

  for (const claudeMd of inventory.claudeMdFiles) {
    const fileWarnings = [];
    const rawContent = claudeMd.content || '';

    // Clean up Claude-specific references
    const content = cleanContent(rawContent);

    // Determine output path
    const outputPath = mapOutputPath(claudeMd.path, codexHome);

    // Size check
    const sizeBytes = Buffer.byteLength(content, 'utf-8');
    if (sizeBytes > 32768) {
      fileWarnings.push(
        `File is ${(sizeBytes / 1024).toFixed(1)}KB — exceeds recommended 32KB limit for Codex AGENTS.md`
      );
    }

    // Check for remaining Claude-specific references after cleanup
    const refs = findClaudeReferences(content);
    if (refs.length > 0) {
      fileWarnings.push(
        `Still contains Claude-specific references after cleanup: ${refs.join(', ')}`
      );
    }

    files.push({
      sourcePath: claudeMd.path,
      outputPath,
      content,
      sizeBytes,
      warnings: fileWarnings,
    });

    if (fileWarnings.length > 0) {
      warnings.push(`${claudeMd.path}: ${fileWarnings.join('; ')}`);
    }
  }

  warnings.push(
    `${files.length} CLAUDE.md file(s) converted to AGENTS.md format`
  );

  return { files, warnings };
}
