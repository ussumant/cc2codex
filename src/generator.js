import { join, dirname } from 'path';
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs';
import { resolveAgentsHome } from './utils.js';
import { convertSettings } from './converters/settings-to-toml.js';
import { convertHooks } from './converters/hooks-converter.js';
import { convertMcpServers } from './converters/mcp-converter.js';
import { convertSkills } from './converters/skills-converter.js';
import { convertAgents } from './converters/agents-converter.js';
import { convertMemory } from './converters/memory-converter.js';
import { convertClaudeMd } from './converters/claude-md-converter.js';

/**
 * Normalize each converter's unique return shape into { files: [{ path, content }], warnings }
 */
function normalizeResult(component, raw, opts) {
  const { codexHome, agentsHome } = opts;
  const files = [];
  const warnings = raw.warnings || [];

  switch (component) {
    case 'settings':
      // { toml, warnings }
      if (raw.toml) files.push({ path: join(codexHome, 'config.toml'), content: raw.toml });
      break;

    case 'hooks':
      // { hooksJson, warnings }
      if (Array.isArray(raw.hooksJson) && raw.hooksJson.length > 0) {
        files.push({ path: join(codexHome, 'hooks.json'), content: JSON.stringify(raw.hooksJson, null, 2) });
      }
      break;

    case 'mcp':
      // { toml, serverCount, warnings }
      if (raw.toml) files.push({ path: join(codexHome, 'config.toml'), content: raw.toml });
      break;

    case 'skills':
    case 'agents':
      // { skills: [{ name, outputDir, content, warnings }], warnings }
      if (raw.skills) {
        for (const skill of raw.skills) {
          const dir = skill.outputDir || join(agentsHome, 'skills', skill.name);
          files.push({ path: join(dir, 'SKILL.md'), content: skill.content });
        }
      }
      break;

    case 'memory':
      // { contextSection, warnings }
      if (raw.contextSection) files.push({ path: join(codexHome, 'CONTEXT.md'), content: raw.contextSection });
      break;

    case 'claude-md':
      // { files: [{ sourcePath, outputPath, content }], warnings }
      if (raw.files) {
        for (const f of raw.files) {
          files.push({ path: f.outputPath, content: f.content });
        }
      }
      break;
  }

  return { files, warnings };
}

const CONVERTERS = {
  settings: convertSettings,
  hooks: convertHooks,
  mcp: convertMcpServers,
  skills: convertSkills,
  agents: convertAgents,
  memory: convertMemory,
  'claude-md': convertClaudeMd,
};

const SCOPE_COMPONENTS = {
  all: ['settings', 'hooks', 'mcp', 'skills', 'agents', 'memory', 'claude-md'],
  global: ['settings', 'hooks', 'mcp', 'memory', 'claude-md'],
  skills: ['skills', 'agents'],
};

/**
 * Ensure a directory exists, creating parents as needed.
 */
function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Back up an existing file to {codexHome}/backup/ preserving relative path structure.
 */
function backupFile(filePath, codexHome) {
  const backupDir = join(codexHome, 'backup');
  // Derive a relative name from codexHome for the backup
  let relativeName;
  if (filePath.startsWith(codexHome)) {
    relativeName = filePath.slice(codexHome.length + 1);
  } else {
    const agentsHome = resolveAgentsHome(codexHome);
    if (filePath.startsWith(agentsHome)) {
      relativeName = join('.agents', filePath.slice(agentsHome.length + 1));
    } else {
      relativeName = filePath.replace(/^[/\\]+/, '').replace(/[:\\]/g, '-');
    }
  }
  const backupPath = join(backupDir, relativeName);
  ensureDir(dirname(backupPath));
  copyFileSync(filePath, backupPath);
  return backupPath;
}

function mergeFileContent(filePath, currentContent, nextContent) {
  if (!currentContent) return nextContent;
  if (!nextContent) return currentContent;

  if (filePath.endsWith('config.toml')) {
    return `${currentContent.trimEnd()}\n\n${nextContent.trim()}\n`;
  }

  return nextContent;
}

/**
 * Orchestrate migration from Claude Code to Codex CLI.
 *
 * @param {object} inventory - Output from scanner.scan()
 * @param {object} opts - { dryRun, force, only, codexHome }
 * @returns {{ filesCreated: string[], warnings: string[], manualSteps: string[] }}
 */
export async function migrate(inventory, opts) {
  const { dryRun, force, only, codexHome, scope = 'all' } = opts;
  const agentsHome = resolveAgentsHome(codexHome);

  const result = {
    filesCreated: [],
    warnings: [],
    manualSteps: [],
  };
  const pendingFiles = new Map();

  if (inventory.warnings?.length) {
    result.warnings.push(...inventory.warnings);
  }

  // Determine which components to run
  const components = only
    ? [only]
    : (SCOPE_COMPONENTS[scope] || SCOPE_COMPONENTS.all);
  const scopedInventory = scope === 'global'
    ? {
        ...inventory,
        claudeMdFiles: inventory.claudeMdFiles.filter(file => file.path.startsWith(inventory.claudeHome)),
      }
    : inventory;

  for (const component of components) {
    const converter = CONVERTERS[component];
    if (!converter) {
      result.warnings.push(`Unknown component "${component}" — skipping.`);
      continue;
    }

    let rawResult;
    try {
      rawResult = await converter(scopedInventory, { codexHome, agentsHome });
    } catch (err) {
      result.warnings.push(`Converter "${component}" threw: ${err.message}`);
      continue;
    }

    if (!rawResult) continue;

    // Normalize the converter's unique return shape
    const converted = normalizeResult(component, rawResult, { codexHome, agentsHome });

    // Collect warnings
    if (converted.warnings) result.warnings.push(...converted.warnings);

    // Collect each output file and merge where multiple converters target the same file
    for (const file of converted.files) {
      const targetPath = file.path;
      const existing = pendingFiles.get(targetPath);
      if (existing) {
        existing.content = mergeFileContent(targetPath, existing.content, file.content);
      } else {
        pendingFiles.set(targetPath, { path: targetPath, content: file.content });
      }
    }
  }

  for (const file of pendingFiles.values()) {
    const targetPath = file.path;

    if (dryRun) {
      result.filesCreated.push(targetPath);
      continue;
    }

    if (existsSync(targetPath) && !force) {
      result.warnings.push(`Skipped ${targetPath} — already exists. Use --force to overwrite.`);
      continue;
    }

    if (existsSync(targetPath) && force) {
      const backupPath = backupFile(targetPath, codexHome);
      result.warnings.push(`Backed up ${targetPath} → ${backupPath}`);
    }

    ensureDir(dirname(targetPath));
    writeFileSync(targetPath, file.content, 'utf-8');
    result.filesCreated.push(targetPath);
  }

  // Add standard manual steps that always apply
  result.manualSteps.push(
    'Re-authenticate MCP servers that require API keys or OAuth tokens.',
    'Review AGENTS.md files for any remaining Claude-specific references (CLAUDE.md, ~/.claude/, Agent tool, etc.).',
    'Test each MCP server with `codex --mcp-debug` to verify connectivity.',
    'Run `cc2codex validate` to check the generated files.',
  );
  if (scope === 'global') {
    const projectClaudeCount = inventory.claudeMdFiles.filter(file => !file.path.startsWith(inventory.claudeHome)).length;
    if (projectClaudeCount > 0) {
      result.manualSteps.push(
        `${projectClaudeCount} project/workspace CLAUDE.md file(s) were not auto-applied. Review them manually or migrate them in a separate workflow.`
      );
    }
  }

  // Generate migration report (unless dry-run)
  if (!dryRun) {
    const reportPath = join(codexHome, 'migration-report.md');
    const report = generateReport(result, components);
    ensureDir(codexHome);
    writeFileSync(reportPath, report, 'utf-8');
    result.filesCreated.push(reportPath);
  }

  return result;
}

/**
 * Build a markdown migration report.
 */
function generateReport(result, components) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let md = `# cc2codex Migration Report\n\n`;
  md += `**Generated:** ${now}\n`;
  md += `**Components migrated:** ${components.join(', ')}\n\n`;

  md += `## Files Created (${result.filesCreated.length})\n\n`;
  for (const f of result.filesCreated) {
    md += `- \`${f}\`\n`;
  }

  if (result.warnings.length) {
    md += `\n## Warnings (${result.warnings.length})\n\n`;
    for (const w of result.warnings) {
      md += `- ${w}\n`;
    }
  }

  if (result.manualSteps.length) {
    md += `\n## Manual Steps Required\n\n`;
    for (const s of result.manualSteps) {
      md += `- [ ] ${s}\n`;
    }
  }

  md += `\n---\n*Generated by [cc2codex](https://github.com/ussumant/cc2codex)*\n`;
  return md;
}
