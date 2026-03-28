import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { defaultPluginInstallDir, MIGRATION_PLUGIN_NAME } from './plugin-installer.js';
import { resolveClaudeHome } from './utils.js';

function defaultMarketplacePath() {
  return join(homedir(), '.agents', 'plugins', 'marketplace.json');
}

function readJsonSafe(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function summarizeStatus(checks) {
  if (checks.some(check => check.status === 'blocked')) {
    return 'blocked';
  }

  if (checks.some(check => check.status === 'needs_attention')) {
    return 'needs_attention';
  }

  return 'ready';
}

function maybePush(checks, condition, entry) {
  if (condition) {
    checks.push(entry);
  }
}

function requiredRepoFiles(repoRoot) {
  return [
    join(repoRoot, 'package.json'),
    join(repoRoot, 'bin', 'cc2codex.js'),
    join(repoRoot, 'src', 'scanner.js'),
    join(repoRoot, 'src', 'doctor.js'),
    join(repoRoot, 'src', 'onboarding.js'),
  ];
}

function buildRepairSteps(flags, paths) {
  const steps = [];

  if (flags.installBroken || flags.repoBroken || flags.marketplaceBroken) {
    steps.push('Reinstall the plugin from your cc2codex repo clone: `node bin/cc2codex.js install-plugin --force`');
  }

  if (flags.noClaudeHome) {
    steps.push(`Check that Claude Code data exists at ${paths.claudeHome}, or pass a different Claude home path.`);
  }

  if (steps.length === 0) {
    steps.push('No repair steps needed.');
  }

  return steps;
}

function pluginPathFromMarketplace(marketplacePath, entryPath) {
  return resolve(dirname(marketplacePath), entryPath);
}

export function verifyPluginInstall(opts = {}) {
  const targetDir = opts.targetDir || defaultPluginInstallDir();
  const marketplacePath = opts.marketplacePath || defaultMarketplacePath();
  const claudeHome = opts.claudeHome || resolveClaudeHome();
  const checks = [];
  const flags = {
    installBroken: false,
    repoBroken: false,
    marketplaceBroken: false,
    noClaudeHome: false,
  };

  const pluginExists = existsSync(targetDir);
  maybePush(checks, !pluginExists, {
    id: 'plugin-dir-missing',
    status: 'blocked',
    label: 'Installed plugin directory exists',
    detail: `Expected plugin at ${targetDir}`,
  });
  if (!pluginExists) {
    flags.installBroken = true;
  }

  const mcpConfigPath = join(targetDir, '.mcp.json');
  const mcpConfig = pluginExists ? readJsonSafe(mcpConfigPath) : null;
  maybePush(checks, pluginExists && !mcpConfig, {
    id: 'plugin-mcp-missing',
    status: 'blocked',
    label: 'Installed plugin has a valid .mcp.json',
    detail: `Expected valid MCP config at ${mcpConfigPath}`,
  });
  if (pluginExists && !mcpConfig) {
    flags.installBroken = true;
  }

  const serverConfig = mcpConfig?.mcpServers?.[MIGRATION_PLUGIN_NAME];
  maybePush(checks, pluginExists && mcpConfig && !serverConfig, {
    id: 'plugin-mcp-entry-missing',
    status: 'blocked',
    label: 'Installed plugin exposes the migration MCP server',
    detail: `Missing mcpServers.${MIGRATION_PLUGIN_NAME} in ${mcpConfigPath}`,
  });
  if (pluginExists && mcpConfig && !serverConfig) {
    flags.installBroken = true;
  }

  const serverScript = Array.isArray(serverConfig?.args) ? serverConfig.args[0] : null;
  maybePush(checks, !!serverScript && !existsSync(serverScript), {
    id: 'server-script-missing',
    status: 'blocked',
    label: 'Installed plugin MCP server script exists',
    detail: `Expected MCP server script at ${serverScript}`,
  });
  if (serverScript && !existsSync(serverScript)) {
    flags.installBroken = true;
  }

  const repoRoot = serverConfig?.env?.CC2CODEX_REPO_ROOT ? resolve(serverConfig.env.CC2CODEX_REPO_ROOT) : null;
  maybePush(checks, !repoRoot, {
    id: 'repo-root-missing',
    status: 'blocked',
    label: 'Installed plugin knows which cc2codex repo clone to use',
    detail: 'CC2CODEX_REPO_ROOT is missing from the installed plugin MCP configuration.',
  });
  if (!repoRoot) {
    flags.repoBroken = true;
  }

  if (repoRoot) {
    const missingRepoFiles = requiredRepoFiles(repoRoot).filter(filePath => !existsSync(filePath));
    maybePush(checks, missingRepoFiles.length > 0, {
      id: 'repo-root-stale',
      status: 'blocked',
      label: 'Configured cc2codex repo clone is still available',
      detail: `Missing required repo files under ${repoRoot}`,
    });
    if (missingRepoFiles.length > 0) {
      flags.repoBroken = true;
    }
  }

  const marketplace = readJsonSafe(marketplacePath);
  maybePush(checks, !marketplace, {
    id: 'marketplace-missing',
    status: 'blocked',
    label: 'Codex marketplace file exists and is valid JSON',
    detail: `Expected marketplace at ${marketplacePath}`,
  });
  if (!marketplace) {
    flags.marketplaceBroken = true;
  }

  const marketplaceEntry = marketplace?.plugins?.find?.(plugin => plugin.name === MIGRATION_PLUGIN_NAME);
  maybePush(checks, !!marketplace && !marketplaceEntry, {
    id: 'marketplace-entry-missing',
    status: 'blocked',
    label: 'Marketplace includes the migration plugin',
    detail: `No ${MIGRATION_PLUGIN_NAME} entry found in ${marketplacePath}`,
  });
  if (marketplace && !marketplaceEntry) {
    flags.marketplaceBroken = true;
  }

  if (marketplaceEntry?.source?.path) {
    const resolvedPluginPath = pluginPathFromMarketplace(marketplacePath, marketplaceEntry.source.path);
    maybePush(checks, resolvedPluginPath !== resolve(targetDir), {
      id: 'marketplace-path-mismatch',
      status: 'blocked',
      label: 'Marketplace entry points at the installed plugin directory',
      detail: `Marketplace resolves to ${resolvedPluginPath}, expected ${resolve(targetDir)}`,
    });
    if (resolvedPluginPath !== resolve(targetDir)) {
      flags.marketplaceBroken = true;
    }
  }

  maybePush(checks, !existsSync(claudeHome), {
    id: 'claude-home-missing',
    status: 'needs_attention',
    label: 'Claude Code home exists on this machine',
    detail: `No Claude setup found at ${claudeHome}`,
  });
  if (!existsSync(claudeHome)) {
    flags.noClaudeHome = true;
  }

  if (checks.length === 0) {
    checks.push({
      id: 'plugin-install-ready',
      status: 'ready',
      label: 'Plugin install looks healthy',
      detail: 'The plugin, marketplace wiring, repo path, and Claude home are all available.',
    });
  }

  const status = summarizeStatus(checks);
  const summary = status === 'ready'
    ? 'The migration plugin looks healthy and ready to use.'
    : status === 'needs_attention'
      ? 'The plugin can start, but there is something you should fix or confirm first.'
      : 'The migration plugin needs repair before it can reliably import your Claude setup.';

  return {
    status,
    summary,
    code: flags.noClaudeHome
      ? 'no_claude_home'
      : flags.installBroken || flags.repoBroken
        ? 'stale_plugin_install'
        : flags.marketplaceBroken
          ? 'marketplace_mismatch'
          : 'plugin_ready',
    paths: {
      targetDir,
      marketplacePath,
      claudeHome,
      repoRoot,
      mcpConfigPath,
      serverScript,
    },
    checks,
    repairSteps: buildRepairSteps(flags, {
      targetDir,
      marketplacePath,
      claudeHome,
      repoRoot,
    }),
  };
}
