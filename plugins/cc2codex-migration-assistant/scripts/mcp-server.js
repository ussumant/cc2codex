#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const SERVER_NAME = 'cc2codex-migration-assistant';
const SERVER_VERSION = '0.6.0';
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '..');

function detectRepoRoot() {
  const configured = process.env.CC2CODEX_REPO_ROOT;
  if (configured) {
    return resolve(configured);
  }

  const candidate = resolve(__dirname, '..', '..', '..');
  if (existsSync(join(candidate, 'package.json'))) {
    return candidate;
  }

  return null;
}

async function loadRepoModule(relativePath) {
  const repoRoot = detectRepoRoot();
  if (!repoRoot) {
    throw new Error(
      'The installed plugin no longer knows where the cc2codex repo clone lives. Reinstall it with `node bin/cc2codex.js install-plugin --force` from the repo clone.'
    );
  }

  return import(pathToFileURL(join(repoRoot, relativePath)).href);
}

function defaultClaudeHome() {
  return join(homedir(), '.claude');
}

function defaultCodexHome() {
  return join(homedir(), '.codex');
}

function marketplacePathForPlugin(targetDir = pluginRoot) {
  const codexHome = dirname(dirname(targetDir));
  return join(dirname(codexHome), '.agents', 'plugins', 'marketplace.json');
}

function defaultTrialCodexHome() {
  return join(tmpdir(), 'cc2codex-trial', '.codex');
}

function textContent(value) {
  return [
    {
      type: 'text',
      text: JSON.stringify(value, null, 2),
    },
  ];
}

function resolvePaths(args = {}) {
  return {
    claudeHome: args.claudeHome || defaultClaudeHome(),
    codexHome: args.codexHome || defaultCodexHome(),
    trialCodexHome: args.trialCodexHome || defaultTrialCodexHome(),
    project: args.project || null,
    force: args.force === true,
  };
}

function nextStepsForLiveResult(status, codexHome) {
  if (status === 'blocked') {
    return [
      `Review ${join(codexHome, 'migration-dossier.md')} and fix failed validation checks before using this Codex home.`,
      'Rerun the live import after resolving the failing checks.',
    ];
  }

  return [
    `Open ${join(codexHome, 'migration-dossier.md')} and review any warnings.`,
    'Use `codex --mcp-debug` to verify MCP servers one by one.',
  ];
}

function readJsonSafe(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function buildVerificationGateResponse(verification) {
  if (verification.code === 'no_claude_home') {
    return {
      status: 'needs_attention',
      title: "We couldn't find a Claude Code setup",
      summary: 'This plugin is installed correctly, but there is no Claude Code data at the expected location yet.',
      needsAttention: verification.checks.map(check => check.detail),
      nextAction: {
        label: 'Choose another Claude home or stop here',
        tool: 'start_claude_import_onboarding',
        args: {
          codexHome: verification.paths.targetDir ? defaultCodexHome() : defaultCodexHome(),
        },
      },
      repairSteps: verification.repairSteps,
    };
  }

  return {
    status: 'blocked',
    title: 'This migration plugin needs repair first',
    summary: 'Codex found the migration assistant, but the local install is stale or incomplete and should be repaired before importing anything.',
    needsAttention: verification.checks.map(check => check.detail),
    repairSteps: verification.repairSteps,
    nextAction: {
      label: 'Reinstall the plugin from the repo clone',
      command: 'node bin/cc2codex.js install-plugin --force',
    },
  };
}

function fallbackVerification(paths) {
  const checks = [];
  const mcpConfigPath = join(pluginRoot, '.mcp.json');
  const mcpConfig = readJsonSafe(mcpConfigPath);
  const serverConfig = mcpConfig?.mcpServers?.[SERVER_NAME];
  const serverScript = Array.isArray(serverConfig?.args) ? serverConfig.args[0] : join(pluginRoot, 'scripts', 'mcp-server.js');
  const repoRoot = serverConfig?.env?.CC2CODEX_REPO_ROOT ? resolve(serverConfig.env.CC2CODEX_REPO_ROOT) : detectRepoRoot();
  const marketplacePath = marketplacePathForPlugin(pluginRoot);
  const marketplace = readJsonSafe(marketplacePath);

  if (!mcpConfig) {
    checks.push({
      id: 'plugin-mcp-missing',
      status: 'blocked',
      label: 'Installed plugin has a valid .mcp.json',
      detail: `Expected valid MCP config at ${mcpConfigPath}`,
    });
  }
  if (!existsSync(serverScript)) {
    checks.push({
      id: 'server-script-missing',
      status: 'blocked',
      label: 'Installed plugin MCP server script exists',
      detail: `Expected MCP server script at ${serverScript}`,
    });
  }
  if (!repoRoot || !existsSync(join(repoRoot, 'package.json'))) {
    checks.push({
      id: 'repo-root-stale',
      status: 'blocked',
      label: 'Configured cc2codex repo clone is still available',
      detail: `The configured repo root is missing or stale${repoRoot ? `: ${repoRoot}` : '.'}`,
    });
  }
  if (!marketplace?.plugins?.some?.(plugin => plugin.name === SERVER_NAME)) {
    checks.push({
      id: 'marketplace-entry-missing',
      status: 'blocked',
      label: 'Marketplace includes the migration plugin',
      detail: `No ${SERVER_NAME} entry found in ${marketplacePath}`,
    });
  }
  if (!existsSync(paths.claudeHome)) {
    checks.push({
      id: 'claude-home-missing',
      status: 'needs_attention',
      label: 'Claude Code home exists on this machine',
      detail: `No Claude setup found at ${paths.claudeHome}`,
    });
  }

  if (checks.length === 0) {
    checks.push({
      id: 'plugin-install-ready',
      status: 'ready',
      label: 'Plugin install looks healthy',
      detail: 'The plugin, marketplace wiring, repo path, and Claude home are all available.',
    });
  }

  const status = checks.some(check => check.status === 'blocked')
    ? 'blocked'
    : checks.some(check => check.status === 'needs_attention')
      ? 'needs_attention'
      : 'ready';

  return {
    status,
    summary: status === 'ready'
      ? 'The migration plugin looks healthy and ready to use.'
      : status === 'needs_attention'
        ? 'The plugin can start, but there is something you should fix or confirm first.'
        : 'The migration plugin needs repair before it can reliably import your Claude setup.',
    code: checks.some(check => check.id === 'claude-home-missing')
      ? 'no_claude_home'
      : 'stale_plugin_install',
    paths: {
      targetDir: pluginRoot,
      marketplacePath,
      claudeHome: paths.claudeHome,
      repoRoot,
      mcpConfigPath,
      serverScript,
    },
    checks,
    repairSteps: checks.some(check => check.id === 'claude-home-missing')
      ? [`Check that Claude Code data exists at ${paths.claudeHome}, or pass a different Claude home path.`]
      : ['Reinstall the plugin from your cc2codex repo clone: `node bin/cc2codex.js install-plugin --force`'],
  };
}

async function runPluginVerification(paths) {
  const repoRoot = detectRepoRoot();
  if (!repoRoot || !existsSync(join(repoRoot, 'src', 'plugin-verifier.js'))) {
    return fallbackVerification(paths);
  }

  try {
    const { verifyPluginInstall } = await import(pathToFileURL(join(repoRoot, 'src', 'plugin-verifier.js')).href);
    return verifyPluginInstall({
      targetDir: pluginRoot,
      marketplacePath: marketplacePathForPlugin(pluginRoot),
      claudeHome: paths.claudeHome,
    });
  } catch {
    return fallbackVerification(paths);
  }
}

const TOOL_DEFINITIONS = [
  {
    name: 'verify_plugin_install',
    description: 'Check that the migration plugin, repo connection, marketplace entry, and Claude home are ready.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        claudeHome: { type: 'string', description: 'Path to the Claude home directory. Defaults to ~/.claude.' },
      },
    },
  },
  {
    name: 'start_claude_import_onboarding',
    description: 'Plain-language starting point for importing a Claude Code setup into Codex.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        claudeHome: { type: 'string', description: 'Path to the Claude home directory. Defaults to ~/.claude.' },
        codexHome: { type: 'string', description: 'Target Codex home. Defaults to ~/.codex.' },
        trialCodexHome: { type: 'string', description: 'Temporary preview location. Defaults to /tmp/cc2codex-trial/.codex.' },
        project: { type: 'string', description: 'Optional project directory to scan for project-local Claude files.' },
      },
    },
  },
  {
    name: 'preview_claude_import',
    description: 'Create a safe preview import into /tmp without touching the real Codex setup.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        claudeHome: { type: 'string' },
        codexHome: { type: 'string' },
        trialCodexHome: { type: 'string' },
        project: { type: 'string' },
        force: { type: 'boolean', description: 'Overwrite existing preview files if they already exist.' },
      },
    },
  },
  {
    name: 'review_import_readiness',
    description: 'Explain, in plain language, whether the Claude import is ready to preview or finish.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        claudeHome: { type: 'string' },
        codexHome: { type: 'string' },
        trialCodexHome: { type: 'string' },
        project: { type: 'string' },
      },
    },
  },
  {
    name: 'finish_claude_import',
    description: 'Import the Claude setup into the real Codex home after the preview has been reviewed.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        claudeHome: { type: 'string' },
        codexHome: { type: 'string' },
        trialCodexHome: { type: 'string' },
        project: { type: 'string' },
        force: { type: 'boolean' },
      },
    },
    annotations: {
      destructiveHint: true,
    },
  },
  {
    name: 'scan_claude_setup',
    description: 'Read-only inventory of a Claude Code setup.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        claudeHome: { type: 'string', description: 'Path to the Claude home directory. Defaults to ~/.claude.' },
        project: { type: 'string', description: 'Optional project directory to scan for project-local Claude files.' },
      },
    },
  },
  {
    name: 'assess_claude_migration',
    description: 'Readiness score, risks, and setup-specific Claude to Codex behavior changes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        claudeHome: { type: 'string' },
        codexHome: { type: 'string', description: 'Target Codex home for planning. Defaults to ~/.codex.' },
        project: { type: 'string' },
      },
    },
  },
  {
    name: 'build_migration_guide',
    description: 'Step-by-step migration guide with exact commands and checkpoints.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        claudeHome: { type: 'string' },
        codexHome: { type: 'string' },
        trialCodexHome: { type: 'string' },
        project: { type: 'string' },
      },
    },
  },
  {
    name: 'plan_migration',
    description: 'Generate a staged migration plan without writing files.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        claudeHome: { type: 'string' },
        codexHome: { type: 'string' },
        project: { type: 'string' },
      },
    },
  },
  {
    name: 'run_trial_import',
    description: 'Run a safe trial import into a temporary Codex home. Stops before live cutover and writes a dossier.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        claudeHome: { type: 'string' },
        codexHome: { type: 'string', description: 'Live Codex home used only for planning context.' },
        trialCodexHome: { type: 'string' },
        project: { type: 'string' },
        force: { type: 'boolean', description: 'Overwrite trial files if they already exist.' },
      },
    },
  },
  {
    name: 'run_live_import',
    description: 'Write migrated global config and skills into the real Codex home, validate it, and write a dossier.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        claudeHome: { type: 'string' },
        codexHome: { type: 'string' },
        trialCodexHome: { type: 'string', description: 'Optional trial path to include in the generated dossier.' },
        project: { type: 'string' },
        force: { type: 'boolean' },
      },
    },
    annotations: {
      destructiveHint: true,
    },
  },
  {
    name: 'validate_codex_home',
    description: 'Run migration validation checks against a Codex home.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        codexHome: { type: 'string', description: 'Codex home to validate. Defaults to ~/.codex.' },
      },
    },
  },
];

async function handleToolCall(name, args = {}) {
  const paths = resolvePaths(args);

  switch (name) {
    case 'verify_plugin_install':
      return runPluginVerification(paths);

    case 'start_claude_import_onboarding': {
      const verification = await runPluginVerification(paths);
      if (verification.status === 'blocked' || verification.code === 'no_claude_home') {
        return buildVerificationGateResponse(verification);
      }

      const [{ scan }, { buildDoctorReport }, { buildOnboardingStart }] = await Promise.all([
        loadRepoModule('src/scanner.js'),
        loadRepoModule('src/doctor.js'),
        loadRepoModule('src/onboarding.js'),
      ]);
      const inventory = await scan(paths.claudeHome, paths.project);
      const doctorReport = await buildDoctorReport(inventory, { codexHome: paths.codexHome });
      return buildOnboardingStart({
        inventory,
        doctorReport,
        paths,
        verification,
      });
    }

    case 'preview_claude_import': {
      const verification = await runPluginVerification(paths);
      if (verification.status === 'blocked' || verification.code === 'no_claude_home') {
        return buildVerificationGateResponse(verification);
      }

      const [{ scan }, { runTrialFlow }, { buildPreviewSummary }] = await Promise.all([
        loadRepoModule('src/scanner.js'),
        loadRepoModule('src/start.js'),
        loadRepoModule('src/onboarding.js'),
      ]);
      const inventory = await scan(paths.claudeHome, paths.project);
      const flow = await runTrialFlow({
        claudeHome: paths.claudeHome,
        codexHome: paths.codexHome,
        trialCodexHome: paths.trialCodexHome,
        project: paths.project,
        force: paths.force,
      });

      return buildPreviewSummary({
        inventory,
        doctorReport: flow.doctorReport,
        result: flow.result,
        paths,
      });
    }

    case 'review_import_readiness': {
      const verification = await runPluginVerification(paths);
      if (verification.status === 'blocked' || verification.code === 'no_claude_home') {
        return buildVerificationGateResponse(verification);
      }

      const [{ scan }, { buildDoctorReport }, { validate }, { buildReadinessReview }] = await Promise.all([
        loadRepoModule('src/scanner.js'),
        loadRepoModule('src/doctor.js'),
        loadRepoModule('src/validator.js'),
        loadRepoModule('src/onboarding.js'),
      ]);
      const inventory = await scan(paths.claudeHome, paths.project);
      const doctorReport = await buildDoctorReport(inventory, { codexHome: paths.codexHome });

      return buildReadinessReview({
        inventory,
        doctorReport,
        paths,
        validate,
      });
    }

    case 'finish_claude_import': {
      const verification = await runPluginVerification(paths);
      if (verification.status === 'blocked' || verification.code === 'no_claude_home') {
        return buildVerificationGateResponse(verification);
      }

      const previewDossierPath = join(paths.trialCodexHome, 'migration-dossier.md');
      if (!existsSync(previewDossierPath)) {
        return {
          status: 'needs_attention',
          title: 'Preview the import first',
          summary: 'Before changing your real Codex setup, Codex needs to create a safe preview import.',
          needsAttention: [
            `No preview import was found at ${paths.trialCodexHome}.`,
          ],
          nextAction: {
            label: 'Create a safe preview import',
            tool: 'preview_claude_import',
            args: {
              claudeHome: paths.claudeHome,
              codexHome: paths.codexHome,
              trialCodexHome: paths.trialCodexHome,
              project: paths.project,
            },
          },
        };
      }

      const [{ scan }, { buildDoctorReport }, { buildMigrationGuide }, { migrate }, { validate }, { validationSummary, writeDossier }, { buildFinishSummary }] = await Promise.all([
        loadRepoModule('src/scanner.js'),
        loadRepoModule('src/doctor.js'),
        loadRepoModule('src/guide.js'),
        loadRepoModule('src/generator.js'),
        loadRepoModule('src/validator.js'),
        loadRepoModule('src/start.js'),
        loadRepoModule('src/onboarding.js'),
      ]);

      const inventory = await scan(paths.claudeHome, paths.project);
      const doctorReport = await buildDoctorReport(inventory, { codexHome: paths.codexHome });
      const guide = await buildMigrationGuide(inventory, {
        codexHome: paths.codexHome,
        trialCodexHome: paths.trialCodexHome,
        project: paths.project,
      });

      const liveGlobal = await migrate(inventory, {
        dryRun: false,
        force: paths.force,
        only: null,
        codexHome: paths.codexHome,
        scope: 'global',
      });
      const liveSkills = await migrate(inventory, {
        dryRun: false,
        force: paths.force,
        only: null,
        codexHome: paths.codexHome,
        scope: 'skills',
      });
      const liveValidation = await validate(paths.codexHome);
      const liveValidationSummary = validationSummary(liveValidation);

      const result = {
        status: liveValidationSummary.failed > 0 ? 'blocked' : 'completed',
        stoppedAt: null,
        stages: [
          {
            id: 'assessment',
            title: 'Assessment',
            status: 'completed',
            readiness: doctorReport.summary,
          },
          {
            id: 'live-cutover',
            title: 'Live Cutover',
            status: liveValidationSummary.failed > 0 ? 'blocked' : 'completed',
            filesCreated: [...liveGlobal.filesCreated, ...liveSkills.filesCreated],
            warnings: [...liveGlobal.warnings, ...liveSkills.warnings],
            validation: liveValidationSummary,
          },
        ],
        nextSteps: nextStepsForLiveResult(
          liveValidationSummary.failed > 0 ? 'blocked' : 'completed',
          paths.codexHome
        ),
        dossierPaths: [],
      };

      const dossierPath = writeDossier(paths.codexHome, {
        doctorReport,
        guide,
        result,
        paths: {
          claudeHome: paths.claudeHome,
          trialCodexHome: paths.trialCodexHome,
          codexHome: paths.codexHome,
        },
      });
      result.dossierPaths.push(dossierPath);

      return buildFinishSummary({
        inventory,
        doctorReport,
        result,
        validation: liveValidation,
        paths,
      });
    }

    case 'scan_claude_setup': {
      const { scan } = await loadRepoModule('src/scanner.js');
      return scan(paths.claudeHome, paths.project);
    }

    case 'assess_claude_migration': {
      const [{ scan }, { buildDoctorReport }] = await Promise.all([
        loadRepoModule('src/scanner.js'),
        loadRepoModule('src/doctor.js'),
      ]);
      const inventory = await scan(paths.claudeHome, paths.project);
      return buildDoctorReport(inventory, { codexHome: paths.codexHome });
    }

    case 'build_migration_guide': {
      const [{ scan }, { buildMigrationGuide }] = await Promise.all([
        loadRepoModule('src/scanner.js'),
        loadRepoModule('src/guide.js'),
      ]);
      const inventory = await scan(paths.claudeHome, paths.project);
      return buildMigrationGuide(inventory, {
        codexHome: paths.codexHome,
        trialCodexHome: paths.trialCodexHome,
        project: paths.project,
      });
    }

    case 'plan_migration': {
      const [{ scan }, { planMigration }] = await Promise.all([
        loadRepoModule('src/scanner.js'),
        loadRepoModule('src/planner.js'),
      ]);
      const inventory = await scan(paths.claudeHome, paths.project);
      return planMigration(inventory, { codexHome: paths.codexHome });
    }

    case 'run_trial_import': {
      const { runTrialFlow } = await loadRepoModule('src/start.js');
      const flow = await runTrialFlow({
        claudeHome: paths.claudeHome,
        codexHome: paths.codexHome,
        trialCodexHome: paths.trialCodexHome,
        project: paths.project,
        force: paths.force,
      });

      return {
        doctor: flow.doctorReport,
        guide: flow.guide,
        result: flow.result,
      };
    }

    case 'run_live_import': {
      const [{ scan }, { buildDoctorReport }, { buildMigrationGuide }, { migrate }, { validate }, { validationSummary, writeDossier }] = await Promise.all([
        loadRepoModule('src/scanner.js'),
        loadRepoModule('src/doctor.js'),
        loadRepoModule('src/guide.js'),
        loadRepoModule('src/generator.js'),
        loadRepoModule('src/validator.js'),
        loadRepoModule('src/start.js'),
      ]);

      const inventory = await scan(paths.claudeHome, paths.project);
      const doctorReport = await buildDoctorReport(inventory, { codexHome: paths.codexHome });
      const guide = await buildMigrationGuide(inventory, {
        codexHome: paths.codexHome,
        trialCodexHome: paths.trialCodexHome,
        project: paths.project,
      });

      const liveGlobal = await migrate(inventory, {
        dryRun: false,
        force: paths.force,
        only: null,
        codexHome: paths.codexHome,
        scope: 'global',
      });
      const liveSkills = await migrate(inventory, {
        dryRun: false,
        force: paths.force,
        only: null,
        codexHome: paths.codexHome,
        scope: 'skills',
      });
      const liveValidation = await validate(paths.codexHome);
      const liveValidationSummary = validationSummary(liveValidation);

      const result = {
        status: liveValidationSummary.failed > 0 ? 'blocked' : 'completed',
        stoppedAt: null,
        stages: [
          {
            id: 'assessment',
            title: 'Assessment',
            status: 'completed',
            readiness: doctorReport.summary,
          },
          {
            id: 'live-cutover',
            title: 'Live Cutover',
            status: liveValidationSummary.failed > 0 ? 'blocked' : 'completed',
            filesCreated: [...liveGlobal.filesCreated, ...liveSkills.filesCreated],
            warnings: [...liveGlobal.warnings, ...liveSkills.warnings],
            validation: liveValidationSummary,
          },
        ],
        nextSteps: nextStepsForLiveResult(
          liveValidationSummary.failed > 0 ? 'blocked' : 'completed',
          paths.codexHome
        ),
        dossierPaths: [],
      };

      const dossierPath = writeDossier(paths.codexHome, {
        doctorReport,
        guide,
        result,
        paths: {
          claudeHome: paths.claudeHome,
          trialCodexHome: paths.trialCodexHome,
          codexHome: paths.codexHome,
        },
      });
      result.dossierPaths.push(dossierPath);

      return {
        doctor: doctorReport,
        guide,
        result,
        validation: liveValidation,
      };
    }

    case 'validate_codex_home': {
      const { validate } = await loadRepoModule('src/validator.js');
      return validate(paths.codexHome);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function createErrorResponse(id, error) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32000,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function createSuccessResponse(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function writeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf-8');
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

async function handleRequest(request) {
  const { id, method, params = {} } = request;

  if (method === 'initialize') {
    return createSuccessResponse(id, {
      protocolVersion: params.protocolVersion || DEFAULT_PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
    });
  }

  if (method === 'ping') {
    return createSuccessResponse(id, {});
  }

  if (method === 'tools/list') {
    return createSuccessResponse(id, {
      tools: TOOL_DEFINITIONS,
    });
  }

  if (method === 'tools/call') {
    try {
      const result = await handleToolCall(params.name, params.arguments || {});
      return createSuccessResponse(id, {
        content: textContent(result),
        structuredContent: result,
      });
    } catch (error) {
      return createSuccessResponse(id, {
        content: textContent({ error: error.message }),
        isError: true,
      });
    }
  }

  if (method === 'notifications/initialized') {
    return null;
  }

  return createErrorResponse(id, new Error(`Unsupported method: ${method}`));
}

let pending = Buffer.alloc(0);

process.stdin.on('data', async (chunk) => {
  pending = Buffer.concat([pending, chunk]);

  while (true) {
    const headerEnd = pending.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const headerText = pending.slice(0, headerEnd).toString('utf-8');
    const contentLengthHeader = headerText
      .split('\r\n')
      .find((line) => line.toLowerCase().startsWith('content-length:'));

    if (!contentLengthHeader) {
      pending = pending.slice(headerEnd + 4);
      continue;
    }

    const contentLength = Number.parseInt(contentLengthHeader.split(':')[1].trim(), 10);
    const messageEnd = headerEnd + 4 + contentLength;
    if (Number.isNaN(contentLength) || pending.length < messageEnd) {
      break;
    }

    const body = pending.slice(headerEnd + 4, messageEnd).toString('utf-8');
    pending = pending.slice(messageEnd);

    let request;
    try {
      request = JSON.parse(body);
    } catch (error) {
      writeMessage(createErrorResponse(null, error));
      continue;
    }

    try {
      const response = await handleRequest(request);
      if (response) {
        writeMessage(response);
      }
    } catch (error) {
      if (request.id !== undefined) {
        writeMessage(createErrorResponse(request.id, error));
      }
    }
  }
});

process.stdin.resume();
