import { existsSync } from 'fs';
import { join } from 'path';

function formatCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildDetectedItems(inventory, doctorReport) {
  const items = [];

  if (doctorReport.summary.skills > 0) {
    items.push(`${formatCount(doctorReport.summary.skills, 'reusable skill')} from Claude Code`);
  }

  if (doctorReport.summary.agents > 0) {
    items.push(`${formatCount(doctorReport.summary.agents, 'agent workflow')} that can be converted into Codex skills`);
  }

  if (doctorReport.summary.mcpServers > 0) {
    items.push(`${formatCount(doctorReport.summary.mcpServers, 'connected tool')} configured through MCP`);
  }

  if ((inventory.hooks || []).length > 0) {
    items.push(`${formatCount(inventory.hooks.length, 'automation')} that may need review in Codex`);
  }

  if ((inventory.claudeMdFiles || []).length > 0) {
    items.push(`${formatCount(inventory.claudeMdFiles.length, 'instruction file')} to bring over as Codex guidance`);
  }

  return items;
}

function buildTransferItems(doctorReport) {
  const items = [];

  if (doctorReport.summary.skills > 0) {
    items.push('Your reusable skills and instructions');
  }
  if (doctorReport.summary.agents > 0) {
    items.push('Your agent workflows, simplified into reusable Codex skills');
  }
  if (doctorReport.summary.mcpServers > 0) {
    items.push('Your connected tools and MCP configuration, with any required re-authentication called out');
  }

  items.push('A migration dossier so you can review what happened before finishing setup');
  return items;
}

function simplifyEducationNote(note) {
  const byArea = {
    permissions: 'Codex asks for approval differently, using sandboxing and confirmation prompts instead of detailed Claude allowlists.',
    agents: 'Claude agents become reusable Codex skills or guided workflows, so team-style setups may feel simpler.',
    skills: 'Reusable instructions stay first-class in Codex and can be organized more cleanly.',
    mcp: 'Connected tools can usually come over, but some may need you to reconnect keys or local paths.',
    hooks: 'Some automations transfer well, but Claude-only hooks may need to be adjusted or removed.',
  };

  return byArea[note.area] || note.implication;
}

function simplifyRisk(risk) {
  const byId = {
    'unsupported-hooks': 'Some Claude-only automations do not have a direct Codex equivalent and will need manual cleanup.',
    'agent-teams': 'Team-style Claude workflows will be simplified because Codex does not use the same always-on team model.',
    'project-claude-md': 'Some project-specific instructions are separate and should be reviewed after the main import.',
    'agents-size': 'Your imported instructions may need trimming so Codex keeps them concise and readable.',
    'mcp-secrets': 'Some connected tools need you to re-enter tokens, keys, or secrets after the import.',
  };

  return byId[risk.id] || risk.detail;
}

function summarizeValidation(validation) {
  if (!validation) {
    return null;
  }

  let passed = 0;
  let warnings = 0;
  let failed = 0;

  for (const check of validation.checks || []) {
    if (check.passed && check.level === 'warning') {
      warnings += 1;
    } else if (check.passed) {
      passed += 1;
    } else {
      failed += 1;
    }
  }

  return { passed, warnings, failed };
}

function statusFromState({ readinessLevel, risks = [], resultStatus = null, validationSummary = null }) {
  if (resultStatus === 'blocked' || validationSummary?.failed > 0) {
    return 'blocked';
  }

  if (
    readinessLevel === 'low'
    || risks.some(risk => risk.severity === 'high')
    || (validationSummary && validationSummary.warnings > 0)
  ) {
    return 'needs_attention';
  }

  return 'ready';
}

function previewFiles(paths) {
  return [
    join(paths.trialCodexHome, 'migration-dossier.md'),
    join(paths.trialCodexHome, 'config.toml'),
  ];
}

function liveFiles(paths) {
  return [
    join(paths.codexHome, 'migration-dossier.md'),
    join(paths.codexHome, 'config.toml'),
  ];
}

export function buildOnboardingStart({ inventory, doctorReport, paths, verification = null }) {
  const status = statusFromState({
    readinessLevel: doctorReport.summary.readinessLevel,
    risks: doctorReport.risks,
  });

  return {
    status,
    title: 'We found your Claude Code setup',
    summary: `Codex can prepare a safe preview import before changing your real setup. Your current readiness is ${doctorReport.summary.readinessLevel} with ${doctorReport.summary.migrationComplexity} migration complexity.`,
    detectedSetup: {
      claudeHome: paths.claudeHome,
      items: buildDetectedItems(inventory, doctorReport),
    },
    pluginHealth: verification ? {
      status: verification.status,
      summary: verification.summary,
    } : undefined,
    whatWillBeImported: buildTransferItems(doctorReport),
    whatChangesInCodex: doctorReport.education.map(simplifyEducationNote),
    needsAttention: doctorReport.risks.map(simplifyRisk),
    nextAction: {
      label: 'Preview my Codex workspace',
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

export async function buildReadinessReview({ inventory, doctorReport, paths, validate }) {
  const previewExists = existsSync(join(paths.trialCodexHome, 'migration-dossier.md'));
  const previewValidation = previewExists ? await validate(paths.trialCodexHome) : null;
  const validation = summarizeValidation(previewValidation);
  const status = statusFromState({
    readinessLevel: doctorReport.summary.readinessLevel,
    risks: doctorReport.risks,
    validationSummary: validation,
  });

  return {
    status,
    title: previewExists ? 'Your preview import is ready for review' : 'You are ready to preview the import',
    summary: previewExists
      ? 'A safe preview has already been created. Review it before asking Codex to finish the import.'
      : 'Codex is ready to create a safe preview without touching your real setup.',
    reviewChecklist: previewExists
      ? [
          'Make sure the imported instructions still read clearly in Codex.',
          'Check whether your connected tools need keys or tokens re-entered.',
          'Look for any advanced Claude automations that need manual cleanup.',
        ]
      : [
          'Codex will create the preview in /tmp so your current setup stays untouched.',
        ],
    preview: {
      exists: previewExists,
      location: paths.trialCodexHome,
      filesToReview: previewExists ? previewFiles(paths) : [],
      validation,
    },
    detectedSetup: {
      items: buildDetectedItems(inventory, doctorReport),
    },
    needsAttention: doctorReport.risks.map(simplifyRisk),
    nextAction: previewExists
      ? {
          label: 'Finish import into my real Codex setup',
          tool: 'finish_claude_import',
          args: {
            claudeHome: paths.claudeHome,
            codexHome: paths.codexHome,
            trialCodexHome: paths.trialCodexHome,
            project: paths.project,
          },
        }
      : {
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

export function buildPreviewSummary({ inventory, doctorReport, result, paths }) {
  const previewStage = result.stages.find(stage => stage.id === 'trial-skills')
    || result.stages.find(stage => stage.id === 'trial-global');
  const status = statusFromState({
    readinessLevel: doctorReport.summary.readinessLevel,
    risks: doctorReport.risks,
    resultStatus: result.status,
    validationSummary: previewStage?.validation,
  });

  return {
    status,
    title: 'Your Codex preview is ready',
    summary: 'Codex created a safe preview import in a temporary location. Your real ~/.codex has not been changed.',
    preview: {
      location: paths.trialCodexHome,
      filesToReview: previewFiles(paths),
      validation: previewStage?.validation || null,
    },
    importedIntoPreview: buildTransferItems(doctorReport),
    detectedSetup: {
      items: buildDetectedItems(inventory, doctorReport),
    },
    needsAttention: [
      ...doctorReport.risks.map(simplifyRisk),
      ...result.nextSteps,
    ],
    nextAction: {
      label: 'Finish import into my real Codex setup',
      tool: 'finish_claude_import',
      args: {
        claudeHome: paths.claudeHome,
        codexHome: paths.codexHome,
        trialCodexHome: paths.trialCodexHome,
        project: paths.project,
      },
    },
  };
}

export function buildFinishSummary({ inventory, doctorReport, result, validation, paths }) {
  const validationSummary = summarizeValidation(validation);
  const status = statusFromState({
    readinessLevel: doctorReport.summary.readinessLevel,
    risks: doctorReport.risks,
    resultStatus: result.status,
    validationSummary,
  });

  return {
    status,
    title: status === 'blocked' ? 'Your Codex import needs attention' : 'Your Claude setup has been imported into Codex',
    summary: status === 'blocked'
      ? 'Codex wrote the import, but some checks failed and should be fixed before relying on this setup.'
      : 'Codex finished the import and validated the result. You can now use your imported setup in the Codex app.',
    codexSetup: {
      location: paths.codexHome,
      filesToReview: liveFiles(paths),
      validation: validationSummary,
    },
    importedIntoCodex: buildTransferItems(doctorReport),
    detectedSetup: {
      items: buildDetectedItems(inventory, doctorReport),
    },
    needsAttention: [
      ...doctorReport.risks.map(simplifyRisk),
      ...result.nextSteps,
    ],
    nextAction: {
      label: 'Review anything that still needs attention',
      tool: 'review_import_readiness',
      args: {
        claudeHome: paths.claudeHome,
        codexHome: paths.codexHome,
        trialCodexHome: paths.trialCodexHome,
        project: paths.project,
      },
    },
  };
}
