import { migrate } from './generator.js';
import { VALID_EVENTS } from './converters/hooks-converter.js';

function uniqueRuntimeCommands(inventory) {
  return [...new Set(
    Object.values(inventory.mcpServers || {})
      .map(config => config.command)
      .filter(Boolean)
  )].sort();
}

function projectClaudeFiles(inventory) {
  return (inventory.claudeMdFiles || []).filter(file => !file.path.startsWith(inventory.claudeHome));
}

function unsupportedHookEvents(inventory) {
  return [...new Set(
    (inventory.hooks || [])
      .map(hook => hook.event)
      .filter(event => !VALID_EVENTS.includes(event))
  )].sort();
}

export async function planMigration(inventory, opts) {
  const { codexHome } = opts;
  const globalResult = await migrate(inventory, {
    dryRun: true,
    force: false,
    codexHome,
    scope: 'global',
  });
  const skillsResult = await migrate(inventory, {
    dryRun: true,
    force: false,
    codexHome,
    scope: 'skills',
  });

  return {
    summary: {
      claudeHome: inventory.claudeHome,
      globalFiles: globalResult.filesCreated.length,
      skillFiles: skillsResult.filesCreated.length,
      skills: (inventory.skills || []).length + (inventory.projectSkills || []).length,
      agents: (inventory.agents || []).length + (inventory.projectAgents || []).length,
      mcpServers: Object.keys(inventory.mcpServers || {}).length,
      unsupportedHookEvents: unsupportedHookEvents(inventory),
      runtimeCommands: uniqueRuntimeCommands(inventory),
      projectInstructionFiles: projectClaudeFiles(inventory).map(file => file.path),
    },
    stages: [
      {
        id: 'global',
        title: 'Apply high-confidence global migration',
        confidence: 'safe_with_review',
        files: globalResult.filesCreated,
        warnings: globalResult.warnings,
        manualSteps: globalResult.manualSteps,
      },
      {
        id: 'skills',
        title: 'Apply converted skills and agent-to-skill outputs',
        confidence: 'safe_with_review',
        files: skillsResult.filesCreated,
        warnings: skillsResult.warnings,
        manualSteps: skillsResult.manualSteps,
      },
    ],
    manual: {
      unsupportedHookEvents: unsupportedHookEvents(inventory),
      projectInstructionFiles: projectClaudeFiles(inventory).map(file => file.path),
      runtimeCommands: uniqueRuntimeCommands(inventory),
    },
  };
}
