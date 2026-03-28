import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { scan } from './scanner.js';
import { migrate } from './generator.js';
import { validate } from './validator.js';
import { buildDoctorReport } from './doctor.js';
import { buildMigrationGuide } from './guide.js';

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

export function validationSummary(results) {
  const summary = {
    passed: 0,
    warnings: 0,
    failed: 0,
  };

  for (const check of results.checks) {
    if (check.passed && check.level === 'warning') {
      summary.warnings += 1;
    } else if (check.passed) {
      summary.passed += 1;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}

function nextStepsForState(result) {
  if (result.status === 'blocked') {
    return [
      'Review the trial dossier and fix the blocked validation or migration issue.',
      'Rerun `cc2codex start` after correcting the failing stage.',
    ];
  }

  if (result.status === 'stopped') {
    return [
      'Review the generated dossier and trial output before continuing.',
      'Resume manually with the next recommended command from the dossier.',
    ];
  }

  return [
    'Open the migration dossier and work through any remaining warnings.',
    'Run `codex --mcp-debug` and verify each MCP server interactively.',
  ];
}

export function generateDossier({ doctorReport, guide, result, paths }) {
  const lines = [
    '# cc2codex Migration Dossier',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Status: ${result.status}`,
    `- Claude home: ${paths.claudeHome}`,
    `- Trial Codex home: ${paths.trialCodexHome}`,
    `- Live Codex home: ${paths.codexHome}`,
    '',
    '## Readiness',
    '',
    `- Score: ${doctorReport.summary.readinessScore}/100`,
    `- Readiness: ${doctorReport.summary.readinessLevel}`,
    `- Complexity: ${doctorReport.summary.migrationComplexity}`,
    `- Skills: ${doctorReport.summary.skills}`,
    `- Agents: ${doctorReport.summary.agents}`,
    `- MCP Servers: ${doctorReport.summary.mcpServers}`,
    '',
    '## Biggest Risks',
    '',
  ];

  if (doctorReport.risks.length === 0) {
    lines.push('- No major migration risks detected.');
  } else {
    for (const risk of doctorReport.risks) {
      lines.push(`- ${risk.title}: ${risk.detail}`);
    }
  }

  lines.push('', '## What Changes In Codex', '');
  for (const note of doctorReport.education) {
    lines.push(`- ${note.title}`);
    lines.push(`  - Claude: ${note.before}`);
    lines.push(`  - Codex: ${note.after}`);
    lines.push(`  - Why it matters: ${note.implication}`);
  }

  lines.push('', '## Stage Results', '');
  for (const stage of result.stages) {
    lines.push(`### ${stage.title}`);
    lines.push(`- Status: ${stage.status}`);
    if (stage.filesCreated?.length) {
      lines.push(`- Files created: ${stage.filesCreated.length}`);
    }
    if (stage.validation) {
      lines.push(
        `- Validation: ${stage.validation.passed} passed, ${stage.validation.warnings} warnings, ${stage.validation.failed} failed`
      );
    }
    if (stage.reason) {
      lines.push(`- Reason: ${stage.reason}`);
    }
    if (stage.warnings?.length) {
      lines.push('- Warnings:');
      for (const warning of stage.warnings.slice(0, 10)) {
        lines.push(`  - ${warning}`);
      }
      if (stage.warnings.length > 10) {
        lines.push(`  - ...and ${stage.warnings.length - 10} more`);
      }
    }
    lines.push('');
  }

  lines.push('## Recommended Flow', '');
  for (const step of guide.steps) {
    lines.push(`### ${step.title}`);
    lines.push(`- Goal: ${step.goal}`);
    for (const command of step.commands) {
      lines.push(`- Command: \`${command}\``);
    }
    lines.push('');
  }

  lines.push('## Next Steps', '');
  for (const step of result.nextSteps) {
    lines.push(`- ${step}`);
  }

  return `${lines.join('\n')}\n`;
}

export function writeDossier(codexHome, data) {
  ensureDir(codexHome);
  const dossierPath = join(codexHome, 'migration-dossier.md');
  writeFileSync(dossierPath, generateDossier(data), 'utf-8');
  return dossierPath;
}

export async function runTrialFlow(opts) {
  let confirmationCount = 0;

  return runStartFlow({
    ...opts,
    yes: false,
    confirm: async () => {
      confirmationCount += 1;
      return confirmationCount < 3;
    },
  });
}

export async function runStartFlow(opts) {
  const {
    claudeHome,
    codexHome,
    trialCodexHome,
    project,
    yes = false,
    force = false,
    confirm = async () => true,
  } = opts;

  if (codexHome === trialCodexHome) {
    throw new Error('Trial Codex home must be different from the live Codex home.');
  }

  const inventory = await scan(claudeHome, project);
  const doctorReport = await buildDoctorReport(inventory, { codexHome });
  const guide = await buildMigrationGuide(inventory, {
    codexHome,
    trialCodexHome,
    project,
  });

  const result = {
    status: 'in_progress',
    stoppedAt: null,
    stages: [
      {
        id: 'assessment',
        title: 'Assessment',
        status: 'completed',
        readiness: doctorReport.summary,
      },
    ],
    nextSteps: [],
    dossierPaths: [],
  };

  result.dossierPaths.push(
    writeDossier(trialCodexHome, {
      doctorReport,
      guide,
      result: {
        ...result,
        status: 'stopped',
        nextSteps: ['Review the assessment before starting the trial migration.'],
      },
      paths: { claudeHome, trialCodexHome, codexHome },
    })
  );

  if (!yes) {
    const continueToTrial = await confirm('Assessment complete. Continue with safe trial migration?');
    if (!continueToTrial) {
      result.status = 'stopped';
      result.stoppedAt = 'assessment';
      result.nextSteps = nextStepsForState(result);
      result.dossierPaths.push(
        writeDossier(trialCodexHome, {
          doctorReport,
          guide,
          result,
          paths: { claudeHome, trialCodexHome, codexHome },
        })
      );
      result.dossierPaths = [...new Set(result.dossierPaths)];
      return { inventory, doctorReport, guide, result };
    }
  }

  const trialGlobal = await migrate(inventory, {
    dryRun: false,
    force,
    only: null,
    codexHome: trialCodexHome,
    scope: 'global',
  });
  const trialGlobalValidation = await validate(trialCodexHome);
  const trialGlobalSummary = validationSummary(trialGlobalValidation);
  result.stages.push({
    id: 'trial-global',
    title: 'Trial Global Migration',
    status: trialGlobalSummary.failed > 0 ? 'blocked' : 'completed',
    filesCreated: trialGlobal.filesCreated,
    warnings: trialGlobal.warnings,
    validation: trialGlobalSummary,
  });

  if (trialGlobalSummary.failed > 0) {
    result.status = 'blocked';
    result.stoppedAt = 'trial-global';
    result.nextSteps = nextStepsForState(result);
    result.dossierPaths.push(
      writeDossier(trialCodexHome, {
        doctorReport,
        guide,
        result,
        paths: { claudeHome, trialCodexHome, codexHome },
      })
    );
    result.dossierPaths = [...new Set(result.dossierPaths)];
    return { inventory, doctorReport, guide, result };
  }

  if (!yes) {
    const continueToSkills = await confirm('Trial global migration validated. Continue with trial skills migration?');
    if (!continueToSkills) {
      result.status = 'stopped';
      result.stoppedAt = 'trial-global';
      result.nextSteps = nextStepsForState(result);
      result.dossierPaths.push(
        writeDossier(trialCodexHome, {
          doctorReport,
          guide,
          result,
          paths: { claudeHome, trialCodexHome, codexHome },
        })
      );
      result.dossierPaths = [...new Set(result.dossierPaths)];
      return { inventory, doctorReport, guide, result };
    }
  }

  const trialSkills = await migrate(inventory, {
    dryRun: false,
    force,
    only: null,
    codexHome: trialCodexHome,
    scope: 'skills',
  });
  const trialSkillsValidation = await validate(trialCodexHome);
  const trialSkillsSummary = validationSummary(trialSkillsValidation);
  result.stages.push({
    id: 'trial-skills',
    title: 'Trial Skills Migration',
    status: trialSkillsSummary.failed > 0 ? 'blocked' : 'completed',
    filesCreated: trialSkills.filesCreated,
    warnings: trialSkills.warnings,
    validation: trialSkillsSummary,
  });

  result.dossierPaths.push(
    writeDossier(trialCodexHome, {
      doctorReport,
      guide,
      result,
      paths: { claudeHome, trialCodexHome, codexHome },
    })
  );

  if (trialSkillsSummary.failed > 0) {
    result.status = 'blocked';
    result.stoppedAt = 'trial-skills';
    result.nextSteps = nextStepsForState(result);
    result.dossierPaths.push(
      writeDossier(trialCodexHome, {
        doctorReport,
        guide,
        result,
        paths: { claudeHome, trialCodexHome, codexHome },
      })
    );
    result.dossierPaths = [...new Set(result.dossierPaths)];
    return { inventory, doctorReport, guide, result };
  }

  if (!yes) {
    const continueToLive = await confirm(`Trial migration is healthy. Continue and write to live Codex home at ${codexHome}?`);
    if (!continueToLive) {
      result.status = 'stopped';
      result.stoppedAt = 'before-live-cutover';
      result.nextSteps = nextStepsForState(result);
      result.dossierPaths.push(
        writeDossier(trialCodexHome, {
          doctorReport,
          guide,
          result,
          paths: { claudeHome, trialCodexHome, codexHome },
        })
      );
      result.dossierPaths = [...new Set(result.dossierPaths)];
      return { inventory, doctorReport, guide, result };
    }
  }

  const liveGlobal = await migrate(inventory, {
    dryRun: false,
    force,
    only: null,
    codexHome,
    scope: 'global',
  });
  const liveSkills = await migrate(inventory, {
    dryRun: false,
    force,
    only: null,
    codexHome,
    scope: 'skills',
  });
  const liveValidation = await validate(codexHome);
  const liveValidationSummary = validationSummary(liveValidation);
  result.stages.push({
    id: 'live-cutover',
    title: 'Live Cutover',
    status: liveValidationSummary.failed > 0 ? 'blocked' : 'completed',
    filesCreated: [...liveGlobal.filesCreated, ...liveSkills.filesCreated],
    warnings: [...liveGlobal.warnings, ...liveSkills.warnings],
    validation: liveValidationSummary,
  });

  result.status = liveValidationSummary.failed > 0 ? 'blocked' : 'completed';
  result.nextSteps = nextStepsForState(result);
  result.dossierPaths.push(
    writeDossier(codexHome, {
      doctorReport,
      guide,
      result,
      paths: { claudeHome, trialCodexHome, codexHome },
    })
  );
  result.dossierPaths = [...new Set(result.dossierPaths)];

  return { inventory, doctorReport, guide, result };
}
