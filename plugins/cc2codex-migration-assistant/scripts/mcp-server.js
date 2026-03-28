#!/usr/bin/env node

import { existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const SERVER_NAME = 'cc2codex-migration-assistant';
const SERVER_VERSION = '0.4.0';
const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
const __dirname = dirname(fileURLToPath(import.meta.url));

function detectRepoRoot() {
  const configured = process.env.CC2CODEX_REPO_ROOT;
  if (configured) {
    return resolve(configured);
  }

  const candidate = resolve(__dirname, '..', '..', '..');
  if (existsSync(join(candidate, 'package.json'))) {
    return candidate;
  }

  throw new Error(
    'CC2CODEX_REPO_ROOT is not configured. Reinstall the plugin with `cc2codex install-plugin --force` from the repo clone.'
  );
}

const repoRoot = detectRepoRoot();

async function loadRepoModule(relativePath) {
  return import(pathToFileURL(join(repoRoot, relativePath)).href);
}

function defaultClaudeHome() {
  return join(homedir(), '.claude');
}

function defaultCodexHome() {
  return join(homedir(), '.codex');
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

const TOOL_DEFINITIONS = [
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
