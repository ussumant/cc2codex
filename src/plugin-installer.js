import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

export const MIGRATION_PLUGIN_NAME = 'cc2codex-migration-assistant';

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function repoRootFromModule() {
  return dirname(dirname(new URL(import.meta.url).pathname));
}

export function pluginSourceDir(repoRoot = repoRootFromModule()) {
  return join(repoRoot, 'plugins', MIGRATION_PLUGIN_NAME);
}

function defaultMarketplace() {
  return join(homedir(), '.agents', 'plugins', 'marketplace.json');
}

function defaultPluginInstallDir() {
  return join(homedir(), 'plugins', MIGRATION_PLUGIN_NAME);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

export function installMigrationPlugin(opts = {}) {
  const {
    repoRoot = repoRootFromModule(),
    targetDir = defaultPluginInstallDir(),
    marketplacePath = defaultMarketplace(),
    force = false,
  } = opts;

  const sourceDir = pluginSourceDir(repoRoot);
  if (!existsSync(sourceDir)) {
    throw new Error(`Plugin source not found at ${sourceDir}`);
  }

  if (existsSync(targetDir)) {
    if (!force) {
      throw new Error(`Plugin target already exists at ${targetDir}. Use --force to replace it.`);
    }
    rmSync(targetDir, { recursive: true, force: true });
  }

  ensureDir(dirname(targetDir));
  cpSync(sourceDir, targetDir, { recursive: true });

  ensureDir(dirname(marketplacePath));
  let marketplace;
  if (existsSync(marketplacePath)) {
    marketplace = readJson(marketplacePath);
  } else {
    marketplace = {
      name: 'cc2codex-local',
      interface: {
        displayName: 'cc2codex Local Plugins',
      },
      plugins: [],
    };
  }

  const entry = {
    name: MIGRATION_PLUGIN_NAME,
    source: {
      source: 'local',
      path: `./plugins/${MIGRATION_PLUGIN_NAME}`,
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL',
    },
    category: 'Developer Tools',
  };

  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const existingIndex = plugins.findIndex(plugin => plugin.name === MIGRATION_PLUGIN_NAME);
  if (existingIndex >= 0) {
    plugins[existingIndex] = entry;
  } else {
    plugins.push(entry);
  }
  marketplace.plugins = plugins;
  writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2), 'utf-8');

  return {
    pluginName: MIGRATION_PLUGIN_NAME,
    sourceDir,
    targetDir,
    marketplacePath,
  };
}
