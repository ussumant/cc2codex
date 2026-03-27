import { join, basename, relative, dirname } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { glob } from 'glob';
import { readJsonSafe, readFileSafe, fileSizeBytes } from './utils.js';

function findPrimaryMarkdownFile(dirPath, itemName) {
  const innerFiles = readdirSync(dirPath);
  const preferredNames = ['SKILL.md', 'AGENT.md', 'index.md', `${itemName}.md`];
  const mainFile = preferredNames.find(f => innerFiles.includes(f))
    || innerFiles.find(f => f.endsWith('.md'));

  return { innerFiles, contentPath: mainFile ? join(dirPath, mainFile) : null };
}

function scanSkillsDir(skillsDir, target, warnings, scopeLabel) {
  if (!existsSync(skillsDir)) return;

  const items = readdirSync(skillsDir);
  for (const item of items) {
    const fullPath = join(skillsDir, item);
    const stat = statSync(fullPath);
    if (stat.isFile() && item.endsWith('.md')) {
      target.push({
        name: basename(item, '.md'),
        path: fullPath,
        content: readFileSafe(fullPath),
        sizeBytes: fileSizeBytes(fullPath),
        isDirectory: false,
      });
      continue;
    }

    if (!stat.isDirectory()) continue;

    const { innerFiles, contentPath } = findPrimaryMarkdownFile(fullPath, item);
    if (!contentPath) {
      warnings.push(`${scopeLabel} skill directory "${fullPath}" has no markdown entrypoint`);
    }

    target.push({
      name: item,
      path: fullPath,
      content: contentPath ? readFileSafe(contentPath) : null,
      sizeBytes: contentPath ? fileSizeBytes(contentPath) : 0,
      isDirectory: true,
      innerFiles,
    });
  }
}

function scanAgentsDir(agentsDir, target, warnings, scopeLabel) {
  if (!existsSync(agentsDir)) return;

  const items = readdirSync(agentsDir);
  for (const item of items) {
    const fullPath = join(agentsDir, item);
    const stat = statSync(fullPath);

    if (stat.isFile() && item.endsWith('.md')) {
      target.push({
        name: basename(item, '.md'),
        path: fullPath,
        content: readFileSafe(fullPath),
        isDirectory: false,
      });
      continue;
    }

    if (!stat.isDirectory() || item === '_archived') continue;

    const inner = readdirSync(fullPath).filter(f => f.endsWith('.md'));
    if (inner.length === 0) {
      warnings.push(`${scopeLabel} agent directory "${fullPath}" has no markdown entrypoint`);
    }

    for (const innerFile of inner) {
      target.push({
        name: `${item}/${basename(innerFile, '.md')}`,
        path: join(fullPath, innerFile),
        content: readFileSafe(join(fullPath, innerFile)),
        isDirectory: true,
      });
    }
  }
}

/**
 * Scan and inventory a Claude Code setup
 * @param {string} claudeHome - Path to ~/.claude
 * @param {string} projectDir - Optional project directory to scan for CLAUDE.md files
 * @returns {object} Complete inventory of Claude Code configuration
 */
export async function scan(claudeHome, projectDir) {
  const inventory = {
    claudeHome,
    settings: null,
    settingsLocal: null,
    skills: [],
    agents: [],
    hooks: [],
    mcpServers: {},
    memory: { indexes: [], files: [] },
    claudeMdFiles: [],
    projectAgents: [],
    projectSkills: [],
    permissions: { allow: [], deny: [] },
    envVars: {},
    warnings: [],
  };

  // 1. Settings files
  inventory.settings = readJsonSafe(join(claudeHome, 'settings.json'));
  inventory.settingsLocal = readJsonSafe(join(claudeHome, 'settings.local.json'));

  // 2. Skills — can be .md files OR directories (containing the skill content)
  scanSkillsDir(join(claudeHome, 'skills'), inventory.skills, inventory.warnings, 'Global');

  // 3. Agents
  scanAgentsDir(join(claudeHome, 'agents'), inventory.agents, inventory.warnings, 'Global');

  // 4. Extract hooks from settings
  // Claude Code hooks format: { EventName: [{ matcher?, hooks: [{ type, command }] }] }
  const allSettings = [inventory.settings, inventory.settingsLocal].filter(Boolean);
  for (const settings of allSettings) {
    if (settings.hooks && typeof settings.hooks === 'object') {
      for (const [event, hookGroups] of Object.entries(settings.hooks)) {
        if (!Array.isArray(hookGroups)) continue;
        for (const group of hookGroups) {
          const matcher = group.matcher || null;
          if (Array.isArray(group.hooks)) {
            for (const hook of group.hooks) {
              inventory.hooks.push({
                event,
                command: hook.command || null,
                type: hook.type || 'command',
                matcher,
                timeout: hook.timeout || null,
              });
            }
          }
        }
      }
    }
  }

  // 5. Extract MCP servers from settings, .mcp.json, and desktop config
  for (const settings of allSettings) {
    if (settings.mcpServers) {
      for (const [name, config] of Object.entries(settings.mcpServers)) {
        inventory.mcpServers[name] = config;
      }
    }
  }
  // Also check .mcp.json (Claude Code's MCP config file)
  const mcpJsonPaths = [
    join(claudeHome, '.mcp.json'),
    join(claudeHome, 'claude_desktop_config.json'),
  ];
  if (projectDir) {
    mcpJsonPaths.push(join(projectDir, '.mcp.json'));
    mcpJsonPaths.push(join(projectDir, '.claude', '.mcp.json'));
  }
  for (const mcpPath of mcpJsonPaths) {
    const mcpConfig = readJsonSafe(mcpPath);
    if (mcpConfig?.mcpServers) {
      for (const [name, config] of Object.entries(mcpConfig.mcpServers)) {
        if (!inventory.mcpServers[name]) {
          inventory.mcpServers[name] = { ...config, source: mcpPath };
        }
      }
    }
  }
  // Check plugin MCP configs
  const pluginMcpFiles = await glob(join(claudeHome, 'plugins/**/.mcp.json'), { absolute: true });
  for (const mcpFile of pluginMcpFiles) {
    const mcpConfig = readJsonSafe(mcpFile);
    if (mcpConfig?.mcpServers) {
      for (const [name, config] of Object.entries(mcpConfig.mcpServers)) {
        if (!inventory.mcpServers[name]) {
          inventory.mcpServers[name] = { ...config, source: mcpFile };
        }
      }
    }
  }

  // 6. Extract permissions
  for (const settings of allSettings) {
    if (settings.permissions) {
      if (settings.permissions.allow) {
        inventory.permissions.allow.push(...settings.permissions.allow);
      }
      if (settings.permissions.deny) {
        inventory.permissions.deny.push(...settings.permissions.deny);
      }
    }
  }

  // 7. Extract env vars
  for (const settings of allSettings) {
    if (settings.env) {
      Object.assign(inventory.envVars, settings.env);
    }
  }

  // 8. Memory files
  const memoryDirs = await glob(join(claudeHome, 'projects/*/memory/'), { absolute: true });
  for (const memDir of memoryDirs) {
    const indexFile = join(memDir, 'MEMORY.md');
    if (existsSync(indexFile)) {
      inventory.memory.indexes ??= [];
      inventory.memory.indexes.push({
        name: basename(dirname(memDir)),
        path: indexFile,
        content: readFileSafe(indexFile),
      });
    }
    const memFiles = readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    for (const mf of memFiles) {
      inventory.memory.files.push({
        name: mf,
        path: join(memDir, mf),
        content: readFileSafe(join(memDir, mf)),
      });
    }
  }

  // 9. CLAUDE.md files
  const searchDirs = [claudeHome];
  if (projectDir) searchDirs.push(projectDir);

  for (const dir of searchDirs) {
    const claudeMdPaths = await glob('**/CLAUDE.md', {
      cwd: dir,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.build/**', '**/.git/**'],
    });
    for (const p of claudeMdPaths) {
      const content = readFileSafe(p);
      inventory.claudeMdFiles.push({
        path: p,
        relativePath: relative(dir, p),
        content,
        sizeBytes: content ? Buffer.byteLength(content, 'utf-8') : 0,
      });
    }
  }

  // 10. Project-level agents and skills
  if (projectDir) {
    scanAgentsDir(join(projectDir, '.claude', 'agents'), inventory.projectAgents, inventory.warnings, 'Project');
    scanSkillsDir(join(projectDir, '.claude', 'skills'), inventory.projectSkills, inventory.warnings, 'Project');
  }

  return inventory;
}
