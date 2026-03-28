import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scan } from '../src/scanner.js';
import { migrate } from '../src/generator.js';
import { bundlePlugins } from '../src/converters/plugin-bundler.js';
import { validate } from '../src/validator.js';
import { buildDoctorReport } from '../src/doctor.js';
import { buildMigrationGuide } from '../src/guide.js';
import { runStartFlow } from '../src/start.js';
import { installMigrationPlugin, MIGRATION_PLUGIN_NAME, defaultPluginInstallDir } from '../src/plugin-installer.js';
import { verifyPluginInstall } from '../src/plugin-verifier.js';

const testDir = dirname(fileURLToPath(import.meta.url));

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cc2codex-'));
  const claudeHome = join(root, '.claude');
  const projectDir = join(root, 'project');
  const codexHome = join(root, '.codex');
  const agentsHome = join(root, '.agents');

  mkdirSync(claudeHome, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  const write = (filePath, content) => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
  };

  const writeJson = (filePath, data) => write(filePath, JSON.stringify(data, null, 2));

  writeJson(join(claudeHome, 'settings.json'), {
    model: 'claude-sonnet-4',
    env: {
      OPENAI_API_KEY: 'sk-test-secret-value',
    },
    permissions: {
      allow: ['Read(**)', 'Bash(node *)'],
      deny: ['Write(/etc/**)'],
    },
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: 'node --version' }] },
      ],
      PermissionRequest: [
        { hooks: [{ type: 'command', command: 'echo unsupported' }] },
      ],
    },
    mcpServers: {
      'chrome-devtools': {
        command: 'node',
        args: ['server.js'],
        env: {
          API_TOKEN: 'super-secret-token',
          EXPRESS_SERVER_URL: 'http://localhost:3000',
        },
      },
    },
  });

  write(
    join(claudeHome, 'skills', 'qa.md'),
    '---\nname: qa\ndescription: QA skill\n---\n# QA\n'
  );
  write(
    join(claudeHome, 'skills', 'browse.md'),
    '---\nname: browse\ndescription: Browse skill\n---\n# Browse\n'
  );
  write(
    join(claudeHome, 'skills', 'dirskill', 'index.md'),
    '---\nname: dirskill\ndescription: Directory skill\n---\n# Dir Skill\n'
  );
  write(join(claudeHome, 'agents', 'review.md'), '# Review\n');
  write(join(claudeHome, 'agents', 'research', 'triage.md'), '# Triage\n');
  write(join(claudeHome, 'CLAUDE.md'), 'Global Claude Code instructions\n');

  write(join(claudeHome, 'projects', 'alpha', 'memory', 'MEMORY.md'), '# Auto Memory Index\nAlpha index\n');
  write(join(claudeHome, 'projects', 'alpha', 'memory', 'project_alpha.md'), 'Alpha project memory\n');
  write(join(claudeHome, 'projects', 'beta', 'memory', 'MEMORY.md'), '# Auto Memory Index\nBeta index\n');
  write(join(claudeHome, 'projects', 'beta', 'memory', 'user_beta.md'), 'Beta user memory\n');
  writeJson(join(claudeHome, 'plugins', 'demo-plugin', '.mcp.json'), {
    mcpServers: {
      'plugin-demo': {
        command: 'bun',
        args: ['run', '--cwd', '${CLAUDE_PLUGIN_ROOT}', 'start'],
      },
    },
  });

  write(join(projectDir, 'CLAUDE.md'), 'Refer to CLAUDE.md and ~/.claude/settings.json\n');
  write(
    join(projectDir, '.claude', 'skills', 'local-skill', 'SKILL.md'),
    '---\nname: local-skill\ndescription: Local project skill\n---\n# Local Skill\n'
  );
  write(join(projectDir, '.claude', 'agents', 'research', 'agent.md'), '# Agent\n');

  return { root, claudeHome, projectDir, codexHome, agentsHome };
}

function cleanupFixture(t, fixture) {
  t.after(() => {
    rmSync(fixture.root, { recursive: true, force: true });
  });
}

function startPluginMcpServer(t, options = {}) {
  const repoRoot = join(testDir, '..');
  const installRoot = mkdtempSync(join(tmpdir(), 'cc2codex-mcp-'));
  const pluginTarget = join(installRoot, '.codex', 'plugins', MIGRATION_PLUGIN_NAME);
  const marketplacePath = join(installRoot, '.agents', 'plugins', 'marketplace.json');

  installMigrationPlugin({
    repoRoot,
    targetDir: pluginTarget,
    marketplacePath,
  });

  if (options.repoRootOverrideInMcp) {
    const mcpConfigPath = join(pluginTarget, '.mcp.json');
    const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'));
    mcpConfig.mcpServers['cc2codex-migration-assistant'].env.CC2CODEX_REPO_ROOT = options.repoRootOverrideInMcp;
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
  }

  if (options.marketplacePathOverride) {
    const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf-8'));
    marketplace.plugins[0].source.path = options.marketplacePathOverride;
    writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2));
  }

  const serverPath = join(pluginTarget, 'scripts', 'mcp-server.js');
  const installedMcpConfig = JSON.parse(readFileSync(join(pluginTarget, '.mcp.json'), 'utf-8'));
  const installedEnv = installedMcpConfig.mcpServers['cc2codex-migration-assistant'].env || {};
  const child = spawn('node', [serverPath], {
    cwd: options.cwd || installRoot,
    env: {
      ...process.env,
      ...installedEnv,
      ...(options.env || {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  t.after(() => {
    child.kill();
    rmSync(installRoot, { recursive: true, force: true });
  });

  let stdout = Buffer.alloc(0);
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout = Buffer.concat([stdout, chunk]);
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf-8');
  });

  const readMessage = async () => {
    const timeout = Date.now() + 5000;
    while (Date.now() < timeout) {
      const headerEnd = stdout.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const headerText = stdout.slice(0, headerEnd).toString('utf-8');
        const lengthLine = headerText
          .split('\r\n')
          .find(line => line.toLowerCase().startsWith('content-length:'));
        if (lengthLine) {
          const contentLength = Number.parseInt(lengthLine.split(':')[1].trim(), 10);
          const messageEnd = headerEnd + 4 + contentLength;
          if (stdout.length >= messageEnd) {
            const body = stdout.slice(headerEnd + 4, messageEnd).toString('utf-8');
            stdout = stdout.slice(messageEnd);
            return JSON.parse(body);
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 25));
    }

    throw new Error(`Timed out waiting for MCP server response. stderr=${stderr}`);
  };

  const sendMessage = (message) => {
    const payload = Buffer.from(JSON.stringify(message), 'utf-8');
    child.stdin.write(`Content-Length: ${payload.length}\r\n\r\n`);
    child.stdin.write(payload);
  };

  return { sendMessage, readMessage };
}

test('scan captures directory-based project assets and multiple memory indexes', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const inventory = await scan(fixture.claudeHome, fixture.projectDir);

  assert.equal(inventory.projectSkills.some(skill => skill.name === 'local-skill'), true);
  assert.equal(inventory.projectAgents.some(agent => agent.name === 'research/agent'), true);
  assert.equal(inventory.memory.indexes.length, 2);
  assert.deepEqual(
    inventory.memory.indexes.map(index => index.name).sort(),
    ['alpha', 'beta']
  );
});

test('migrate writes merged config.toml and sibling .agents output', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const inventory = await scan(fixture.claudeHome, fixture.projectDir);
  await migrate(inventory, {
    dryRun: false,
    force: false,
    only: null,
    codexHome: fixture.codexHome,
  });

  const configToml = readFileSync(join(fixture.codexHome, 'config.toml'), 'utf-8');
  assert.match(configToml, /model = "gpt-5\.4"/);
  assert.match(configToml, /\[mcp_servers\.chrome-devtools\]/);
  assert.match(configToml, /\[mcp_servers\.plugin-demo\]/);
  assert.doesNotMatch(configToml, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.match(configToml, /demo-plugin/);
  assert.match(configToml, /OPENAI_API_KEY="<set in shell>"/);
  assert.doesNotMatch(configToml, /sk-test-secret-value/);
  assert.match(configToml, /API_TOKEN = "<set in shell>"/);
  assert.doesNotMatch(configToml, /super-secret-token/);
  assert.match(configToml, /EXPRESS_SERVER_URL = "http:\/\/localhost:3000"/);
  assert.equal(existsSync(join(fixture.codexHome, 'mcp-servers.toml')), false);
  const hooksJson = JSON.parse(readFileSync(join(fixture.codexHome, 'hooks.json'), 'utf-8'));
  assert.equal(hooksJson.some(hook => hook.event === 'PermissionRequest'), false);
  assert.equal(existsSync(join(fixture.agentsHome, 'skills', 'qa', 'SKILL.md')), true);
  const reviewSkill = readFileSync(join(fixture.agentsHome, 'skills', 'review', 'SKILL.md'), 'utf-8');
  assert.match(reviewSkill, /name: review/);
  assert.match(reviewSkill, /description: Migrated Claude Code agent converted to a Codex skill/);
  assert.equal(existsSync(join(fixture.codexHome, 'AGENTS.md')), true);
  assert.equal(existsSync(join(fixture.projectDir, 'AGENTS.md')), true);
});

test('bundle-plugins --apply writes plugin files using the generated plugin layout', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const inventory = await scan(fixture.claudeHome, fixture.projectDir);
  const result = await bundlePlugins(inventory, {
    dryRun: false,
    codexHome: fixture.codexHome,
  });

  assert.ok(result.plugins.some(plugin => plugin.name === 'qa-toolkit'));
  assert.equal(
    existsSync(join(fixture.agentsHome, 'plugins', 'qa-toolkit', '.codex-plugin', 'plugin.json')),
    true
  );
  const mcpJson = JSON.parse(
    readFileSync(join(fixture.agentsHome, 'plugins', 'qa-toolkit', '.mcp.json'), 'utf-8')
  );
  assert.ok(mcpJson.mcpServers['chrome-devtools']);
  const marketplace = JSON.parse(
    readFileSync(join(fixture.agentsHome, 'plugins', 'marketplace.json'), 'utf-8')
  );
  assert.ok(marketplace.plugins.some(plugin => plugin.dir === 'qa-toolkit'));
});

test('force backups preserve distinct skill paths instead of colliding on SKILL.md', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const inventory = await scan(fixture.claudeHome, fixture.projectDir);
  await migrate(inventory, {
    dryRun: false,
    force: false,
    only: null,
    codexHome: fixture.codexHome,
  });
  await migrate(inventory, {
    dryRun: false,
    force: true,
    only: 'skills',
    codexHome: fixture.codexHome,
  });

  assert.equal(
    existsSync(join(fixture.codexHome, 'backup', '.agents', 'skills', 'qa', 'SKILL.md')),
    true
  );
  assert.equal(
    existsSync(join(fixture.codexHome, 'backup', '.agents', 'skills', 'browse', 'SKILL.md')),
    true
  );
});

test('validate inspects nested skills, plugins, and marketplace in the migrated layout', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const inventory = await scan(fixture.claudeHome, fixture.projectDir);
  await migrate(inventory, {
    dryRun: false,
    force: false,
    only: null,
    codexHome: fixture.codexHome,
  });
  await bundlePlugins(inventory, {
    dryRun: false,
    codexHome: fixture.codexHome,
  });

  const results = await validate(fixture.codexHome);
  const labels = results.checks.map(check => check.label);

  assert.ok(labels.some(label => label.includes('Skill "SKILL.md" has name + description')));
  assert.ok(labels.some(label => label.includes('Plugin "qa-toolkit" manifest is valid JSON')));
  assert.ok(results.checks.some(check => check.label === 'marketplace.json is valid' && check.passed));
});

test('scan --json emits machine-readable JSON without banner noise', (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const output = execFileSync(
    'node',
    ['bin/cc2codex.js', 'scan', '--claude-home', fixture.claudeHome, '--project', fixture.projectDir, '--json'],
    {
      cwd: join(testDir, '..'),
      encoding: 'utf-8',
    }
  );

  const parsed = JSON.parse(output);
  assert.equal(parsed.claudeHome, fixture.claudeHome);
  assert.equal(Array.isArray(parsed.memory.indexes), true);
});

test('plan --json emits staged migration data with manual review items', (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const output = execFileSync(
    'node',
    ['bin/cc2codex.js', 'plan', '--claude-home', fixture.claudeHome, '--project', fixture.projectDir, '--codex-home', fixture.codexHome, '--json'],
    {
      cwd: join(testDir, '..'),
      encoding: 'utf-8',
    }
  );

  const parsed = JSON.parse(output);
  assert.equal(parsed.stages.length, 2);
  assert.equal(parsed.stages[0].id, 'global');
  assert.equal(parsed.stages[1].id, 'skills');
  assert.ok(parsed.manual.projectInstructionFiles.some(path => path.endsWith('project/CLAUDE.md')));
});

test('doctor report explains readiness, risks, and recommended flow', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const inventory = await scan(fixture.claudeHome, fixture.projectDir);
  const report = await buildDoctorReport(inventory, {
    codexHome: fixture.codexHome,
  });

  assert.equal(typeof report.summary.readinessScore, 'number');
  assert.ok(report.risks.some(risk => risk.id === 'unsupported-hooks'));
  assert.ok(report.education.some(note => note.area === 'permissions'));
  assert.ok(report.education.some(note => note.area === 'agents'));
  assert.equal(report.recommendedFlow[0].title, 'Read-only assessment');
  assert.ok(report.recommendedFlow.some(step => step.title.includes('Trial global migration')));
});

test('guide builds a personalized step-by-step migration playbook', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const inventory = await scan(fixture.claudeHome, fixture.projectDir);
  const guide = await buildMigrationGuide(inventory, {
    codexHome: fixture.codexHome,
    trialCodexHome: join(fixture.root, 'trial', '.codex'),
    project: fixture.projectDir,
  });

  assert.equal(guide.steps[0].id, 'assess');
  assert.equal(guide.steps[1].id, 'trial-global');
  assert.ok(guide.steps.some(step => step.id === 'cutover'));
  assert.ok(guide.steps[0].commands.some(command => command.includes('cc2codex doctor')));
  assert.ok(guide.steps[1].commands.some(command => command.includes('--codex-home')));
});

test('start flow runs trial and live migration with dossier output in --yes mode', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const flow = await runStartFlow({
    claudeHome: fixture.claudeHome,
    codexHome: fixture.codexHome,
    trialCodexHome: join(fixture.root, 'trial', '.codex'),
    project: fixture.projectDir,
    yes: true,
    confirm: async () => true,
  });

  assert.equal(flow.result.status, 'completed');
  assert.ok(flow.result.stages.some(stage => stage.id === 'trial-global' && stage.status === 'completed'));
  assert.ok(flow.result.stages.some(stage => stage.id === 'live-cutover' && stage.status === 'completed'));
  assert.equal(existsSync(join(fixture.root, 'trial', '.codex', 'migration-dossier.md')), true);
  assert.equal(existsSync(join(fixture.codexHome, 'migration-dossier.md')), true);
});

test('install-plugin copies the bundled plugin and updates marketplace', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const pluginTarget = join(fixture.root, 'plugins', MIGRATION_PLUGIN_NAME);
  const marketplacePath = join(fixture.root, '.agents', 'plugins', 'marketplace.json');

  const result = installMigrationPlugin({
    repoRoot: join(testDir, '..'),
    targetDir: pluginTarget,
    marketplacePath,
  });

  assert.equal(result.pluginName, MIGRATION_PLUGIN_NAME);
  assert.equal(existsSync(join(pluginTarget, '.codex-plugin', 'plugin.json')), true);
  assert.equal(existsSync(join(pluginTarget, '.mcp.json')), true);
  const mcpConfig = JSON.parse(readFileSync(join(pluginTarget, '.mcp.json'), 'utf-8'));
  assert.equal(
    mcpConfig.mcpServers['cc2codex-migration-assistant'].env.CC2CODEX_REPO_ROOT,
    join(testDir, '..')
  );
  const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf-8'));
  const pluginEntry = marketplace.plugins.find(plugin => plugin.name === MIGRATION_PLUGIN_NAME);
  assert.ok(pluginEntry);
  assert.equal(pluginEntry.source.path, '../../plugins/cc2codex-migration-assistant');
});

test('install-plugin default target path uses the Codex plugin directory', () => {
  assert.match(defaultPluginInstallDir(), /\.codex\/plugins\/cc2codex-migration-assistant$/);
});

test('verify-plugin-install passes for a healthy install', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const pluginTarget = join(fixture.root, '.codex', 'plugins', MIGRATION_PLUGIN_NAME);
  const marketplacePath = join(fixture.root, '.agents', 'plugins', 'marketplace.json');

  installMigrationPlugin({
    repoRoot: join(testDir, '..'),
    targetDir: pluginTarget,
    marketplacePath,
  });

  const result = verifyPluginInstall({
    targetDir: pluginTarget,
    marketplacePath,
    claudeHome: fixture.claudeHome,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.code, 'plugin_ready');
});

test('verify-plugin-install flags stale repo roots clearly', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const pluginTarget = join(fixture.root, '.codex', 'plugins', MIGRATION_PLUGIN_NAME);
  const marketplacePath = join(fixture.root, '.agents', 'plugins', 'marketplace.json');

  installMigrationPlugin({
    repoRoot: join(testDir, '..'),
    targetDir: pluginTarget,
    marketplacePath,
  });

  const mcpConfigPath = join(pluginTarget, '.mcp.json');
  const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'));
  mcpConfig.mcpServers['cc2codex-migration-assistant'].env.CC2CODEX_REPO_ROOT = join(fixture.root, 'missing-repo');
  writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

  const result = verifyPluginInstall({
    targetDir: pluginTarget,
    marketplacePath,
    claudeHome: fixture.claudeHome,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'stale_plugin_install');
  assert.ok(result.repairSteps.some(step => step.includes('install-plugin --force')));
});

test('verify-plugin-install reports missing Claude home without blocking the plugin', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const pluginTarget = join(fixture.root, '.codex', 'plugins', MIGRATION_PLUGIN_NAME);
  const marketplacePath = join(fixture.root, '.agents', 'plugins', 'marketplace.json');

  installMigrationPlugin({
    repoRoot: join(testDir, '..'),
    targetDir: pluginTarget,
    marketplacePath,
  });

  const result = verifyPluginInstall({
    targetDir: pluginTarget,
    marketplacePath,
    claudeHome: join(fixture.root, 'does-not-exist'),
  });

  assert.equal(result.status, 'needs_attention');
  assert.equal(result.code, 'no_claude_home');
});

test('verify-plugin-install catches marketplace path mismatches', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const pluginTarget = join(fixture.root, '.codex', 'plugins', MIGRATION_PLUGIN_NAME);
  const marketplacePath = join(fixture.root, '.agents', 'plugins', 'marketplace.json');

  installMigrationPlugin({
    repoRoot: join(testDir, '..'),
    targetDir: pluginTarget,
    marketplacePath,
  });

  const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf-8'));
  marketplace.plugins[0].source.path = './plugins/wrong-plugin-path';
  writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2));

  const result = verifyPluginInstall({
    targetDir: pluginTarget,
    marketplacePath,
    claudeHome: fixture.claudeHome,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'marketplace_mismatch');
});

test('migration plugin MCP server lists migration tools over stdio', async (t) => {
  const { sendMessage, readMessage } = startPluginMcpServer(t);

  sendMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });
  const initResponse = await readMessage();
  assert.equal(initResponse.result.serverInfo.name, 'cc2codex-migration-assistant');

  sendMessage({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  });

  sendMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });
  const toolsResponse = await readMessage();
  const toolNames = toolsResponse.result.tools.map(tool => tool.name);
  assert.ok(toolNames.includes('verify_plugin_install'));
  assert.ok(toolNames.includes('start_claude_import_onboarding'));
  assert.ok(toolNames.includes('preview_claude_import'));
  assert.ok(toolNames.includes('review_import_readiness'));
  assert.ok(toolNames.includes('finish_claude_import'));
  assert.ok(toolNames.includes('scan_claude_setup'));
  assert.ok(toolNames.includes('run_trial_import'));
  assert.ok(toolNames.includes('run_live_import'));
});

test('onboarding tool returns plain-language preview-first guidance', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const { sendMessage, readMessage } = startPluginMcpServer(t);

  sendMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });
  await readMessage();

  sendMessage({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  });

  sendMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'start_claude_import_onboarding',
      arguments: {
        claudeHome: fixture.claudeHome,
        codexHome: fixture.codexHome,
        trialCodexHome: join(fixture.root, 'trial', '.codex'),
        project: fixture.projectDir,
      },
    },
  });

  const response = await readMessage();
  const payload = response.result.structuredContent;

  assert.equal(payload.title, 'We found your Claude Code setup');
  assert.match(payload.summary, /safe preview/i);
  assert.equal(payload.nextAction.tool, 'preview_claude_import');
  assert.ok(payload.whatChangesInCodex.some(line => /approval|sandbox/i.test(line)));
});

test('verify_plugin_install reports stale repo wiring through MCP without crashing', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const { sendMessage, readMessage } = startPluginMcpServer(t, {
    repoRootOverrideInMcp: join(fixture.root, 'missing-repo'),
  });

  sendMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });
  await readMessage();

  sendMessage({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  });

  sendMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'verify_plugin_install',
      arguments: {
        claudeHome: fixture.claudeHome,
      },
    },
  });

  const response = await readMessage();
  const payload = response.result.structuredContent;

  assert.equal(payload.status, 'blocked');
  assert.equal(payload.code, 'stale_plugin_install');
});

test('finish onboarding tool refuses live import until a preview exists', async (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  const { sendMessage, readMessage } = startPluginMcpServer(t);

  sendMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });
  await readMessage();

  sendMessage({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  });

  sendMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'finish_claude_import',
      arguments: {
        claudeHome: fixture.claudeHome,
        codexHome: fixture.codexHome,
        trialCodexHome: join(fixture.root, 'trial', '.codex'),
        project: fixture.projectDir,
      },
    },
  });

  const response = await readMessage();
  const payload = response.result.structuredContent;

  assert.equal(payload.title, 'Preview the import first');
  assert.equal(payload.nextAction.tool, 'preview_claude_import');
});

test('apply --global writes only global outputs and leaves project instructions untouched', (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  execFileSync(
    'node',
    ['bin/cc2codex.js', 'apply', '--global', '--claude-home', fixture.claudeHome, '--project', fixture.projectDir, '--codex-home', fixture.codexHome],
    {
      cwd: join(testDir, '..'),
      encoding: 'utf-8',
    }
  );

  assert.equal(existsSync(join(fixture.codexHome, 'config.toml')), true);
  assert.equal(existsSync(join(fixture.agentsHome, 'skills', 'qa', 'SKILL.md')), false);
  assert.equal(existsSync(join(fixture.projectDir, 'AGENTS.md')), false);
});

test('apply --skills writes skills without forcing global config generation', (t) => {
  const fixture = createFixture();
  cleanupFixture(t, fixture);

  execFileSync(
    'node',
    ['bin/cc2codex.js', 'apply', '--skills', '--claude-home', fixture.claudeHome, '--project', fixture.projectDir, '--codex-home', fixture.codexHome],
    {
      cwd: join(testDir, '..'),
      encoding: 'utf-8',
    }
  );

  assert.equal(existsSync(join(fixture.codexHome, 'config.toml')), false);
  assert.equal(existsSync(join(fixture.agentsHome, 'skills', 'qa', 'SKILL.md')), true);
});
