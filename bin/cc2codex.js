#!/usr/bin/env node

import { Command } from 'commander';
import readline from 'readline/promises';
import chalk from 'chalk';
import { scan } from '../src/scanner.js';
import { migrate } from '../src/generator.js';
import { validate } from '../src/validator.js';
import { bundlePlugins } from '../src/converters/plugin-bundler.js';
import { planMigration } from '../src/planner.js';
import { buildDoctorReport } from '../src/doctor.js';
import { buildMigrationGuide } from '../src/guide.js';
import { runStartFlow } from '../src/start.js';
import { installMigrationPlugin } from '../src/plugin-installer.js';
import { resolveClaudeHome, resolveCodexHome } from '../src/utils.js';

const program = new Command();

program
  .name('cc2codex')
  .description('Unofficial migration assistant for moving from Claude Code to OpenAI Codex CLI')
  .version('1.0.0');

program
  .command('start')
  .description('Run the launch-grade guided migration flow with a safe trial before live cutover')
  .option('--claude-home <path>', 'Path to .claude directory', resolveClaudeHome())
  .option('--codex-home <path>', 'Path to the live .codex directory', resolveCodexHome())
  .option('--trial-codex-home <path>', 'Path to the temporary .codex directory for the trial migration', '/tmp/cc2codex-trial/.codex')
  .option('--project <path>', 'Project directory to include in the migration flow')
  .option('--force', 'Overwrite existing Codex files during apply steps')
  .option('--yes', 'Run non-interactively and continue through live cutover')
  .option('--json', 'Output structured JSON summary')
  .action(async (opts) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const confirm = async (question) => {
      if (opts.yes) return true;
      const answer = await rl.question(`${question} [y/N] `);
      return /^y(es)?$/i.test(answer.trim());
    };

    try {
      if (!opts.json) {
        console.log(chalk.cyan.bold('\n🚀 Starting guided Claude Code → Codex migration...\n'));
      }
      const flow = await runStartFlow({
        claudeHome: opts.claudeHome,
        codexHome: opts.codexHome,
        trialCodexHome: opts.trialCodexHome,
        project: opts.project,
        force: opts.force || false,
        yes: opts.yes || false,
        confirm,
      });

      if (opts.json) {
        console.log(JSON.stringify({
          doctor: flow.doctorReport,
          guide: flow.guide,
          result: flow.result,
        }, null, 2));
        return;
      }

      printStartResult(flow);
    } finally {
      rl.close();
    }
  });

program
  .command('scan')
  .description('Discover and inventory your Claude Code setup (read-only)')
  .option('--claude-home <path>', 'Path to .claude directory', resolveClaudeHome())
  .option('--project <path>', 'Project directory to scan for CLAUDE.md files')
  .option('--json', 'Output raw JSON inventory')
  .action(async (opts) => {
    const inventory = await scan(opts.claudeHome, opts.project);

    if (opts.json) {
      console.log(JSON.stringify(inventory, null, 2));
      return;
    }

    console.log(chalk.cyan.bold('\n🔍 Scanning Claude Code setup...\n'));

    printInventorySummary(inventory);
  });

program
  .command('doctor')
  .description('Assess migration readiness and explain the biggest Claude -> Codex changes for your setup')
  .option('--claude-home <path>', 'Path to .claude directory', resolveClaudeHome())
  .option('--codex-home <path>', 'Target .codex directory used for planning', resolveCodexHome())
  .option('--project <path>', 'Project directory to include in the assessment')
  .option('--json', 'Output raw migration assessment')
  .action(async (opts) => {
    const inventory = await scan(opts.claudeHome, opts.project);
    const report = await buildDoctorReport(inventory, {
      codexHome: opts.codexHome,
    });

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(chalk.cyan.bold('\n🩺 Checking migration readiness...\n'));
    printDoctorResult(report);
  });

program
  .command('guide')
  .description('Print a personalized step-by-step migration playbook')
  .option('--claude-home <path>', 'Path to .claude directory', resolveClaudeHome())
  .option('--codex-home <path>', 'Real .codex target directory', resolveCodexHome())
  .option('--trial-codex-home <path>', 'Temporary .codex target for a safe trial run')
  .option('--project <path>', 'Project directory to include in the guide')
  .option('--json', 'Output raw migration guide')
  .action(async (opts) => {
    const inventory = await scan(opts.claudeHome, opts.project);
    const guide = await buildMigrationGuide(inventory, {
      codexHome: opts.codexHome,
      trialCodexHome: opts.trialCodexHome,
      project: opts.project,
    });

    if (opts.json) {
      console.log(JSON.stringify(guide, null, 2));
      return;
    }

    console.log(chalk.cyan.bold('\n🧭 Building migration playbook...\n'));
    printGuideResult(guide);
  });

program
  .command('plan')
  .description('Generate a staged migration plan without writing files')
  .option('--claude-home <path>', 'Path to .claude directory', resolveClaudeHome())
  .option('--codex-home <path>', 'Path to .codex output directory', resolveCodexHome())
  .option('--project <path>', 'Project directory to include in the plan')
  .option('--json', 'Output raw JSON migration plan')
  .action(async (opts) => {
    const inventory = await scan(opts.claudeHome, opts.project);
    const plan = await planMigration(inventory, {
      codexHome: opts.codexHome,
    });

    if (opts.json) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }

    console.log(chalk.cyan.bold('\n🧭 Building migration plan...\n'));
    printPlanResult(plan);
  });

program
  .command('migrate')
  .description('Legacy one-shot migration flow (prefer plan + apply)')
  .option('--apply', 'Actually write files (default is dry-run)')
  .option('--force', 'Overwrite existing Codex files')
  .option('--only <component>', 'Migrate specific component: skills|hooks|mcp|claude-md|memory|plugins|settings')
  .option('--claude-home <path>', 'Path to .claude directory', resolveClaudeHome())
  .option('--codex-home <path>', 'Path to .codex output directory', resolveCodexHome())
  .option('--project <path>', 'Project directory for CLAUDE.md conversion')
  .action(async (opts) => {
    const dryRun = !opts.apply;

    if (dryRun) {
      console.log(chalk.yellow.bold('\n🏜️  DRY RUN — no files will be written. Use --apply to execute.\n'));
    } else {
      console.log(chalk.green.bold('\n🚀 Migrating Claude Code → Codex CLI...\n'));
    }

    const inventory = await scan(opts.claudeHome, opts.project);
    const result = await migrate(inventory, {
      dryRun,
      force: opts.force || false,
      only: opts.only || null,
      codexHome: opts.codexHome,
    });

    printMigrationResult(result, dryRun);
  });

program
  .command('apply')
  .description('Apply a staged migration scope')
  .option('--global', 'Apply high-confidence global config and context')
  .option('--skills', 'Apply skills and agent-to-skill conversions')
  .option('--force', 'Overwrite existing Codex files')
  .option('--claude-home <path>', 'Path to .claude directory', resolveClaudeHome())
  .option('--codex-home <path>', 'Path to .codex output directory', resolveCodexHome())
  .option('--project <path>', 'Project directory to scan for plan context only')
  .action(async (opts) => {
    if (!opts.global && !opts.skills) {
      console.error(chalk.red('Select at least one scope: --global and/or --skills'));
      process.exitCode = 1;
      return;
    }

    console.log(chalk.green.bold('\n🚀 Applying staged migration...\n'));

    const inventory = await scan(opts.claudeHome, opts.project);
    const scopes = [];
    if (opts.global) scopes.push('global');
    if (opts.skills) scopes.push('skills');

    for (const scope of scopes) {
      const result = await migrate(inventory, {
        dryRun: false,
        force: opts.force || false,
        only: null,
        codexHome: opts.codexHome,
        scope,
      });

      console.log(chalk.bold(`\n${scope === 'global' ? 'Global' : 'Skills'} scope:`));
      printMigrationResult(result, false);
    }
  });

program
  .command('bundle-plugins')
  .description('Group related skills and MCP servers into Codex plugins')
  .option('--claude-home <path>', 'Path to .claude directory', resolveClaudeHome())
  .option('--codex-home <path>', 'Path to .codex output directory', resolveCodexHome())
  .option('--apply', 'Actually write plugin directories')
  .action(async (opts) => {
    const dryRun = !opts.apply;
    console.log(chalk.cyan.bold('\n📦 Bundling skills into Codex plugins...\n'));

    const inventory = await scan(opts.claudeHome);
    const result = await bundlePlugins(inventory, {
      dryRun,
      codexHome: opts.codexHome,
    });

    printPluginResult(result, dryRun);
  });

program
  .command('install-plugin')
  .description('Install the bundled Codex migration plugin into a local plugin directory and marketplace')
  .option('--target-dir <path>', 'Target plugin directory (default: ~/plugins/cc2codex-migration-assistant)')
  .option('--marketplace-path <path>', 'Marketplace file to create or update (default: ~/.agents/plugins/marketplace.json)')
  .option('--force', 'Replace an existing installed plugin')
  .action(async (opts) => {
    console.log(chalk.cyan.bold('\n🧩 Installing Codex migration plugin...\n'));
    const result = installMigrationPlugin({
      targetDir: opts.targetDir,
      marketplacePath: opts.marketplacePath,
      force: opts.force || false,
    });
    printPluginInstallResult(result);
  });

program
  .command('validate')
  .description('Verify a completed migration')
  .option('--codex-home <path>', 'Path to .codex directory', resolveCodexHome())
  .action(async (opts) => {
    console.log(chalk.cyan.bold('\n✅ Validating Codex migration...\n'));
    const results = await validate(opts.codexHome);
    printValidationResult(results);
  });

function printInventorySummary(inv) {
  console.log(chalk.bold('Claude Code Inventory:'));
  console.log(`  Settings:      ${inv.settings ? chalk.green('found') : chalk.red('not found')}`);
  console.log(`  Skills:        ${chalk.cyan(inv.skills.length)} files`);
  console.log(`  Agents:        ${chalk.cyan(inv.agents.length)} files`);
  console.log(`  Hooks:         ${chalk.cyan(inv.hooks.length)} hooks`);
  console.log(`  MCP Servers:   ${chalk.cyan(Object.keys(inv.mcpServers).length)} servers`);
  console.log(`  Memory Files:  ${chalk.cyan(inv.memory.files.length)} files`);
  console.log(`  CLAUDE.md:     ${chalk.cyan(inv.claudeMdFiles.length)} files`);
  console.log(`  Env Vars:      ${chalk.cyan(Object.keys(inv.envVars).length)} vars`);

  const totalSize = inv.claudeMdFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
  if (totalSize > 32768) {
    console.log(chalk.yellow(`\n  ⚠️  Combined CLAUDE.md size: ${(totalSize / 1024).toFixed(1)}KB (exceeds 32KB Codex limit)`));
  }

  console.log(chalk.bold('\n  MCP Servers:'));
  for (const [name] of Object.entries(inv.mcpServers)) {
    console.log(`    - ${name}`);
  }

  console.log(chalk.bold('\n  Hooks by event:'));
  const byEvent = {};
  for (const h of inv.hooks) {
    byEvent[h.event] = (byEvent[h.event] || 0) + 1;
  }
  for (const [event, count] of Object.entries(byEvent)) {
    console.log(`    ${event}: ${count}`);
  }

  if (inv.warnings?.length) {
    console.log(chalk.yellow.bold('\n  Scan warnings:'));
    for (const warning of inv.warnings) {
      console.log(`    ⚠️  ${warning}`);
    }
  }

  console.log('');
}

function printMigrationResult(result, dryRun) {
  const verb = dryRun ? 'Would create' : 'Created';
  console.log(chalk.bold(`\n${verb}:`));
  for (const file of result.filesCreated) {
    console.log(`  ${dryRun ? chalk.yellow('~') : chalk.green('✓')} ${file}`);
  }
  if (result.warnings.length) {
    console.log(chalk.yellow.bold('\nWarnings:'));
    for (const w of result.warnings) {
      console.log(`  ⚠️  ${w}`);
    }
  }
  if (result.manualSteps.length) {
    console.log(chalk.cyan.bold('\nManual steps required:'));
    for (const s of result.manualSteps) {
      console.log(`  → ${s}`);
    }
  }
  console.log('');
}

function printPluginResult(result, dryRun) {
  const verb = dryRun ? 'Would create' : 'Created';
  console.log(chalk.bold(`${verb} ${result.plugins.length} plugins:`));
  for (const p of result.plugins) {
    console.log(`  📦 ${chalk.cyan(p.name)} — ${p.skillCount} skills, ${p.mcpCount} MCP servers`);
  }
  if (result.unbundledSkills.length) {
    console.log(chalk.yellow(`\n  Unbundled skills: ${result.unbundledSkills.join(', ')}`));
  }
  if (result.warnings.length) {
    console.log(chalk.yellow.bold('\nWarnings:'));
    for (const warning of result.warnings) {
      console.log(`  ⚠️  ${warning}`);
    }
  }
  console.log('');
}

function printPlanResult(plan) {
  console.log(chalk.bold('Migration Summary:'));
  console.log(`  Global files:   ${chalk.cyan(plan.summary.globalFiles)}`);
  console.log(`  Skill files:    ${chalk.cyan(plan.summary.skillFiles)}`);
  console.log(`  Skills:         ${chalk.cyan(plan.summary.skills)}`);
  console.log(`  Agents:         ${chalk.cyan(plan.summary.agents)}`);
  console.log(`  MCP Servers:    ${chalk.cyan(plan.summary.mcpServers)}`);
  console.log(`  Runtime cmds:   ${chalk.cyan(plan.summary.runtimeCommands.join(', ') || 'none')}`);

  if (plan.manual.unsupportedHookEvents.length) {
    console.log(chalk.yellow(`\n  Unsupported hook events: ${plan.manual.unsupportedHookEvents.join(', ')}`));
  }
  if (plan.manual.projectInstructionFiles.length) {
    console.log(chalk.yellow(`  Project CLAUDE.md files needing manual review: ${plan.manual.projectInstructionFiles.length}`));
  }

  for (const stage of plan.stages) {
    console.log(chalk.bold(`\n${stage.title}`));
    console.log(`  Confidence: ${stage.confidence}`);
    console.log(`  Files:      ${stage.files.length}`);
    if (stage.warnings.length) {
      console.log(`  Warnings:   ${stage.warnings.length}`);
    }
  }

  console.log(chalk.cyan('\nSuggested flow: cc2codex plan -> cc2codex apply --global -> cc2codex apply --skills -> cc2codex validate\n'));
}

function printDoctorResult(report) {
  console.log(chalk.bold('Migration Readiness:'));
  console.log(`  Score:         ${chalk.cyan(`${report.summary.readinessScore}/100`)}`);
  console.log(`  Readiness:     ${chalk.cyan(report.summary.readinessLevel)}`);
  console.log(`  Complexity:    ${chalk.cyan(report.summary.migrationComplexity)}`);
  console.log(`  Skills:        ${chalk.cyan(report.summary.skills)}`);
  console.log(`  Agents:        ${chalk.cyan(report.summary.agents)}`);
  console.log(`  MCP Servers:   ${chalk.cyan(report.summary.mcpServers)}`);
  console.log(`  Plugins:       ${chalk.cyan(report.summary.enabledPlugins)}`);
  console.log(`  CLAUDE.md KB:  ${chalk.cyan(report.summary.totalClaudeMdKB)}`);

  if (report.risks.length) {
    console.log(chalk.yellow.bold('\nBiggest migration risks:'));
    for (const risk of report.risks) {
      console.log(`  ${risk.severity === 'high' ? '⚠️' : '•'} ${risk.title}`);
      console.log(`    ${risk.detail}`);
    }
  }

  if (report.education.length) {
    console.log(chalk.bold('\nWhat changes in Codex for your setup:'));
    for (const note of report.education) {
      console.log(`  • ${note.title}`);
      console.log(`    Claude: ${note.before}`);
      console.log(`    Codex:  ${note.after}`);
      console.log(`    Why it matters: ${note.implication}`);
    }
  }

  if (report.improvements.length) {
    console.log(chalk.green.bold('\nWhat likely improves:'));
    for (const improvement of report.improvements) {
      console.log(`  ✓ ${improvement.title} — ${improvement.detail}`);
    }
  }

  console.log(chalk.bold('\nRecommended migration flow:'));
  for (const step of report.recommendedFlow) {
    console.log(`  ${step.step}. ${step.title}`);
    console.log(`     ${step.goal}`);
    for (const command of step.commands) {
      console.log(`     $ ${command}`);
    }
  }

  console.log('');
}

function printGuideResult(guide) {
  console.log(chalk.bold('Migration Playbook:'));
  console.log(`  Readiness:      ${chalk.cyan(`${guide.summary.readinessScore}/100 (${guide.summary.readinessLevel})`)}`);
  console.log(`  Complexity:     ${chalk.cyan(guide.summary.migrationComplexity)}`);
  console.log(`  Trial target:   ${chalk.cyan(guide.trialCodexHome)}`);
  console.log(`  Live target:    ${chalk.cyan(guide.liveCodexHome)}`);

  if (guide.risks.length) {
    console.log(chalk.yellow.bold('\nPay attention to these before cutover:'));
    for (const risk of guide.risks) {
      console.log(`  • ${risk.title}`);
      console.log(`    ${risk.detail}`);
    }
  }

  console.log(chalk.bold('\nStep-by-step flow:'));
  guide.steps.forEach((step, index) => {
    console.log(`\n${chalk.bold(`${index + 1}. ${step.title}`)}`);
    console.log(`  ${step.goal}`);
    for (const command of step.commands) {
      console.log(`  $ ${command}`);
    }
    for (const check of step.checks) {
      console.log(`  - ${check}`);
    }
  });

  console.log('');
}

function printStartResult(flow) {
  const { doctorReport, guide, result } = flow;
  console.log(chalk.bold('Launch Summary:'));
  console.log(`  Readiness:     ${chalk.cyan(`${doctorReport.summary.readinessScore}/100 (${doctorReport.summary.readinessLevel})`)}`);
  console.log(`  Complexity:    ${chalk.cyan(doctorReport.summary.migrationComplexity)}`);
  console.log(`  Trial target:  ${chalk.cyan(guide.trialCodexHome)}`);
  console.log(`  Live target:   ${chalk.cyan(guide.liveCodexHome)}`);

  if (doctorReport.risks.length) {
    console.log(chalk.yellow.bold('\nTop risks:'));
    for (const risk of doctorReport.risks.slice(0, 3)) {
      console.log(`  • ${risk.title}`);
      console.log(`    ${risk.detail}`);
    }
  }

  console.log(chalk.bold('\nStage status:'));
  for (const stage of result.stages) {
    const symbol = stage.status === 'completed'
      ? chalk.green('✓')
      : stage.status === 'blocked'
        ? chalk.red('✗')
        : chalk.yellow('!');
    let suffix = '';
    if (stage.validation) {
      suffix = ` (${stage.validation.passed} passed, ${stage.validation.warnings} warnings, ${stage.validation.failed} failed)`;
    }
    console.log(`  ${symbol} ${stage.title}${suffix}`);
  }

  console.log(chalk.bold('\nDossiers:'));
  for (const path of [...new Set(result.dossierPaths)]) {
    console.log(`  • ${path}`);
  }

  console.log(chalk.bold('\nNext steps:'));
  for (const step of result.nextSteps) {
    console.log(`  • ${step}`);
  }

  console.log('');
}

function printPluginInstallResult(result) {
  console.log(chalk.bold('Installed plugin:'));
  console.log(`  Name:        ${chalk.cyan(result.pluginName)}`);
  console.log(`  Source:      ${chalk.cyan(result.sourceDir)}`);
  console.log(`  Target:      ${chalk.cyan(result.targetDir)}`);
  console.log(`  Marketplace: ${chalk.cyan(result.marketplacePath)}`);
  console.log('');
}

function printValidationResult(results) {
  let passed = 0;
  let warnings = 0;
  let failed = 0;
  for (const r of results.checks) {
    if (r.passed && r.level === 'warning') {
      console.log(`  ${chalk.yellow('!')} ${r.label}: ${r.reason}`);
      warnings++;
    } else if (r.passed && r.reason) {
      console.log(`  ${chalk.green('✓')} ${r.label} (${r.reason})`);
      passed++;
    } else if (r.passed) {
      console.log(`  ${chalk.green('✓')} ${r.label}`);
      passed++;
    } else {
      console.log(`  ${chalk.red('✗')} ${r.label}: ${r.reason}`);
      failed++;
    }
  }
  const warningSummary = warnings ? chalk.yellow(`${warnings} warning${warnings === 1 ? '' : 's'}`) : '0 warnings';
  console.log(`\n  ${chalk.green(passed)} passed, ${warningSummary}, ${failed ? chalk.red(failed) : '0'} failed\n`);
}

program.parse();
