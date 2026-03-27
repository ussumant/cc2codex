#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { scan } from '../src/scanner.js';
import { migrate } from '../src/generator.js';
import { validate } from '../src/validator.js';
import { bundlePlugins } from '../src/converters/plugin-bundler.js';
import { resolveClaudeHome, resolveCodexHome } from '../src/utils.js';

const program = new Command();

program
  .name('cc2codex')
  .description('Migrate Claude Code setups to OpenAI Codex CLI')
  .version('1.0.0');

program
  .command('scan')
  .description('Discover and inventory your Claude Code setup (read-only)')
  .option('--claude-home <path>', 'Path to .claude directory', resolveClaudeHome())
  .option('--project <path>', 'Project directory to scan for CLAUDE.md files')
  .option('--json', 'Output raw JSON inventory')
  .action(async (opts) => {
    console.log(chalk.cyan.bold('\n🔍 Scanning Claude Code setup...\n'));
    const inventory = await scan(opts.claudeHome, opts.project);

    if (opts.json) {
      console.log(JSON.stringify(inventory, null, 2));
      return;
    }

    printInventorySummary(inventory);
  });

program
  .command('migrate')
  .description('Convert Claude Code setup to Codex CLI format')
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
  console.log('');
}

function printValidationResult(results) {
  let passed = 0;
  let failed = 0;
  for (const r of results.checks) {
    if (r.passed) {
      console.log(`  ${chalk.green('✓')} ${r.label}`);
      passed++;
    } else {
      console.log(`  ${chalk.red('✗')} ${r.label}: ${r.reason}`);
      failed++;
    }
  }
  console.log(`\n  ${chalk.green(passed)} passed, ${failed ? chalk.red(failed) : '0'} failed\n`);
}

program.parse();
