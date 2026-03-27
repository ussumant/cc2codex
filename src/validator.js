import { join, basename } from 'path';
import { existsSync, readdirSync, readFileSync, statSync, accessSync, constants } from 'fs';
import { execFileSync } from 'child_process';
import TOML from '@iarna/toml';
import { parseFrontmatter, findClaudeReferences, readFileSafe, resolveAgentsHome } from './utils.js';

/**
 * Post-migration validation for a Codex CLI setup.
 *
 * @param {string} codexHome - Path to ~/.codex (or custom)
 * @returns {{ checks: Array<{ label: string, passed: boolean, reason?: string }> }}
 */
export async function validate(codexHome) {
  const checks = [];
  const agentsHome = resolveAgentsHome(codexHome);

  checks.push(checkConfigToml(codexHome));
  checks.push(checkHooksJson(codexHome));
  checks.push(...checkHookScriptsExist(codexHome));
  checks.push(...checkAgentsMdSize(codexHome, agentsHome));
  checks.push(...checkSkillFrontmatter(agentsHome));
  checks.push(...checkMcpCommands(codexHome));
  checks.push(...checkPluginManifests(agentsHome));
  checks.push(checkMarketplaceJson(agentsHome));
  checks.push(...checkClaudeMdReferences(codexHome, agentsHome));

  return { checks };
}

/**
 * 1. config.toml exists and is valid TOML
 */
function checkConfigToml(codexHome) {
  const configPath = join(codexHome, 'config.toml');
  if (!existsSync(configPath)) {
    return { label: 'config.toml exists', passed: false, reason: 'File not found' };
  }
  try {
    const content = readFileSync(configPath, 'utf-8');
    TOML.parse(content);
    return { label: 'config.toml is valid TOML', passed: true };
  } catch (err) {
    return { label: 'config.toml is valid TOML', passed: false, reason: err.message };
  }
}

/**
 * 2. hooks.json exists and is valid JSON
 */
function checkHooksJson(codexHome) {
  const hooksPath = join(codexHome, 'hooks.json');
  if (!existsSync(hooksPath)) {
    // hooks.json is optional — pass if it simply doesn't exist
    return { label: 'hooks.json valid (or absent)', passed: true, level: 'info', reason: 'No hooks.json found (OK if no hooks)' };
  }
  try {
    const content = readFileSync(hooksPath, 'utf-8');
    JSON.parse(content);
    return { label: 'hooks.json is valid JSON', passed: true };
  } catch (err) {
    return { label: 'hooks.json is valid JSON', passed: false, reason: err.message };
  }
}

/**
 * 3. All hook scripts referenced in hooks.json exist and are executable
 */
function checkHookScriptsExist(codexHome) {
  const checks = [];
  const hooksPath = join(codexHome, 'hooks.json');
  if (!existsSync(hooksPath)) return checks;

  let hooks;
  try {
    hooks = JSON.parse(readFileSync(hooksPath, 'utf-8'));
  } catch {
    return checks; // invalid JSON already caught by check #2
  }

  const hookList = Array.isArray(hooks) ? hooks : (hooks.hooks || []);
  for (const hook of hookList) {
    if (!hook.command) continue;

    // Extract the script/binary from the command (first token)
    const tokens = hook.command.split(/\s+/);
    const script = tokens[0];

    // Skip shell builtins and inline commands
    if (['echo', 'printf', 'test', 'true', 'false', '[', '[['].includes(script)) continue;

    // If it looks like an absolute or relative path, check existence
    if (script.startsWith('/') || script.startsWith('./') || script.startsWith('../')) {
      const resolvedScript = script.startsWith('/')
        ? script
        : join(codexHome, script);
      const exists = existsSync(resolvedScript);
      if (!exists) {
        checks.push({
          label: `Hook script "${script}" exists`,
          passed: false,
          reason: 'File not found',
        });
        continue;
      }
      // Check executable bit
      try {
        accessSync(resolvedScript, constants.X_OK);
        checks.push({ label: `Hook script "${script}" is executable`, passed: true });
      } catch {
        checks.push({
          label: `Hook script "${script}" is executable`,
          passed: false,
          reason: 'File exists but is not executable (chmod +x)',
        });
      }
    }
  }

  return checks;
}

/**
 * 4. All AGENTS.md files in common locations are < 32KB
 */
function checkAgentsMdSize(codexHome, agentsHome) {
  const checks = [];
  const searchLocations = [
    join(codexHome, 'AGENTS.md'),
    join(agentsHome, 'AGENTS.md'),
  ];

  const agentsMdFiles = [
    ...findFilesRecursive(codexHome, 'AGENTS.md'),
    ...findFilesRecursive(agentsHome, 'AGENTS.md'),
  ];
  for (const loc of [...new Set([...searchLocations, ...agentsMdFiles])]) {
    if (!existsSync(loc)) continue;
    const stat = statSync(loc);
    const sizeKB = stat.size / 1024;
    const passed = stat.size <= 32768;
    checks.push({
      label: `AGENTS.md size check: ${basename(loc)} (${sizeKB.toFixed(1)}KB)`,
      passed,
      reason: passed ? undefined : `${sizeKB.toFixed(1)}KB exceeds 32KB Codex limit`,
    });
  }

  return checks;
}

/**
 * 5. All SKILL.md files in ~/.agents/skills/ have name and description in frontmatter
 */
function checkSkillFrontmatter(agentsHome) {
  const checks = [];
  const skillsDir = join(agentsHome, 'skills');
  if (!existsSync(skillsDir)) return checks;

  const files = findFilesRecursive(skillsDir, 'SKILL.md');
  for (const filePath of files) {
    const content = readFileSafe(filePath);
    if (!content) continue;
    const { frontmatter } = parseFrontmatter(content);
    const hasName = !!frontmatter.name;
    const hasDesc = !!frontmatter.description;
    const label = `Skill "${basename(filePath)}" has name + description`;

    if (hasName && hasDesc) {
      checks.push({ label, passed: true });
    } else {
      const missing = [];
      if (!hasName) missing.push('name');
      if (!hasDesc) missing.push('description');
      checks.push({
        label,
        passed: false,
        reason: `Missing frontmatter: ${missing.join(', ')}`,
      });
    }
  }

  return checks;
}

/**
 * 6. All MCP server commands from config.toml are installed
 */
function checkMcpCommands(codexHome) {
  const checks = [];
  const configPath = join(codexHome, 'config.toml');
  if (!existsSync(configPath)) return checks;

  let config;
  try {
    config = TOML.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return checks; // invalid TOML already caught by check #1
  }

  const mcpServers = config.mcp_servers || {};
  for (const [name, serverConfig] of Object.entries(mcpServers)) {
    const command = serverConfig.command;
    if (!command) continue;

    try {
      execFileSync('which', [command], { stdio: 'pipe' });
      checks.push({ label: `MCP "${name}" command "${command}" is installed`, passed: true });
    } catch {
      checks.push({
        label: `MCP "${name}" command "${command}" is installed`,
        passed: false,
        reason: `"${command}" not found in PATH`,
      });
    }
  }

  return checks;
}

/**
 * 7. Plugin manifests (if any) are valid JSON
 */
function checkPluginManifests(agentsHome) {
  const checks = [];
  const pluginsDir = join(agentsHome, 'plugins');
  if (!existsSync(pluginsDir)) return checks;

  const entries = readdirSync(pluginsDir);
  for (const entry of entries) {
    const manifestPath = join(pluginsDir, entry, '.codex-plugin', 'plugin.json');
    if (!existsSync(manifestPath)) continue;
    try {
      JSON.parse(readFileSync(manifestPath, 'utf-8'));
      checks.push({ label: `Plugin "${entry}" manifest is valid JSON`, passed: true });
    } catch (err) {
      checks.push({
        label: `Plugin "${entry}" manifest is valid JSON`,
        passed: false,
        reason: err.message,
      });
    }
  }

  return checks;
}

/**
 * 8. marketplace.json (if exists) references valid paths
 */
function checkMarketplaceJson(agentsHome) {
  const pluginsDir = join(agentsHome, 'plugins');
  const mpPath = join(pluginsDir, 'marketplace.json');
  if (!existsSync(mpPath)) {
    return { label: 'marketplace.json valid (or absent)', passed: true, level: 'info', reason: 'No marketplace.json (OK)' };
  }

  let mp;
  try {
    mp = JSON.parse(readFileSync(mpPath, 'utf-8'));
  } catch (err) {
    return { label: 'marketplace.json is valid JSON', passed: false, reason: err.message };
  }

  // Check that referenced paths exist
  const entries = Array.isArray(mp) ? mp : (mp.plugins || []);
  for (const entry of entries) {
    const refPath = entry.path || entry.dir || entry.name;
    if (refPath && !existsSync(join(pluginsDir, refPath))) {
      return {
        label: 'marketplace.json paths are valid',
        passed: false,
        reason: `Referenced path "${refPath}" does not exist`,
      };
    }
  }

  return { label: 'marketplace.json is valid', passed: true };
}

/**
 * 9. No CLAUDE.md references remain in AGENTS.md files (warn, don't fail)
 */
function checkClaudeMdReferences(codexHome, agentsHome) {
  const checks = [];
  const agentsMdFiles = [
    ...findFilesRecursive(codexHome, 'AGENTS.md'),
    ...findFilesRecursive(agentsHome, 'AGENTS.md'),
  ];

  for (const filePath of agentsMdFiles) {
    const content = readFileSafe(filePath);
    if (!content) continue;
    const refs = findClaudeReferences(content);
    if (refs.length > 0) {
      checks.push({
        label: `No Claude references in ${basename(filePath)}`,
        passed: true, // warn, don't fail
        level: 'warning',
        reason: `Warning: found ${refs.length} Claude-specific reference(s): ${refs.slice(0, 3).join('; ')}${refs.length > 3 ? '...' : ''}`,
      });
    } else {
      checks.push({ label: `No Claude references in ${basename(filePath)}`, passed: true });
    }
  }

  return checks;
}

// --- helpers ---

/**
 * Recursively find files with a given name under a directory.
 */
function findFilesRecursive(dir, fileName) {
  const results = [];
  if (!existsSync(dir)) return results;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'backup') {
      results.push(...findFilesRecursive(fullPath, fileName));
    } else if (entry.isFile() && entry.name === fileName) {
      results.push(fullPath);
    }
  }

  return results;
}
