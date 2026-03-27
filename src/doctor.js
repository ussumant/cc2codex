import { planMigration } from './planner.js';

function totalClaudeMdSize(inventory) {
  return (inventory.claudeMdFiles || []).reduce((sum, file) => sum + (file.sizeBytes || 0), 0);
}

function enabledPluginCount(inventory) {
  const settings = inventory.settings || {};
  return Object.values(settings.enabledPlugins || {}).filter(Boolean).length;
}

function hasAgentTeamSignals(inventory) {
  if (inventory.envVars?.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1') {
    return true;
  }

  const docs = [
    ...(inventory.skills || []),
    ...(inventory.projectSkills || []),
    ...(inventory.agents || []),
    ...(inventory.projectAgents || []),
  ];

  return docs.some(doc => /TeamCreate|SubagentStop|parallel spawn|agent team/i.test(doc.content || ''));
}

function sensitiveMcpServers(inventory) {
  return Object.entries(inventory.mcpServers || {})
    .filter(([, config]) => {
      const env = config?.env || {};
      return Object.keys(env).some(key => /key|token|secret|password|api/i.test(key));
    })
    .map(([name]) => name)
    .sort();
}

function calculateReadiness(inventory, plan) {
  let score = 100;

  const unsupportedEvents = plan.manual.unsupportedHookEvents.length;
  if (unsupportedEvents > 0) score -= 12 + Math.min(unsupportedEvents * 4, 12);
  if (hasAgentTeamSignals(inventory)) score -= 18;
  if (totalClaudeMdSize(inventory) > 32768) score -= 10;
  if (plan.manual.projectInstructionFiles.length > 0) score -= 8;
  if (sensitiveMcpServers(inventory).length > 0) score -= 8;
  if (Object.keys(inventory.mcpServers || {}).length > 0) score -= 4;

  score = Math.max(35, Math.min(100, score));

  let level = 'high';
  if (score < 85) level = 'medium';
  if (score < 70) level = 'low';

  let complexity = 'straightforward';
  if (score < 85) complexity = 'moderate';
  if (score < 70) complexity = 'advanced';

  return { score, level, complexity };
}

function buildRisks(inventory, plan) {
  const risks = [];
  const unsupportedEvents = plan.manual.unsupportedHookEvents;
  const mcpWithSecrets = sensitiveMcpServers(inventory);
  const claudeMdSize = totalClaudeMdSize(inventory);

  if (unsupportedEvents.length > 0) {
    risks.push({
      id: 'unsupported-hooks',
      severity: 'high',
      title: 'Some Claude hook events do not map directly to Codex',
      detail: `${unsupportedEvents.join(', ')} need manual redesign or removal.`,
    });
  }

  if (hasAgentTeamSignals(inventory)) {
    risks.push({
      id: 'agent-teams',
      severity: 'high',
      title: 'Your setup uses agent-team style workflows',
      detail: 'Codex can delegate, but there is no 1:1 Claude TeamCreate / team runtime model. Expect some workflow redesign.',
    });
  }

  if (plan.manual.projectInstructionFiles.length > 0) {
    risks.push({
      id: 'project-claude-md',
      severity: 'medium',
      title: 'Project-specific CLAUDE.md files need review',
      detail: `${plan.manual.projectInstructionFiles.length} project/workspace instruction file(s) are outside the safe global pass.`,
    });
  }

  if (claudeMdSize > 32768) {
    risks.push({
      id: 'agents-size',
      severity: 'medium',
      title: 'Your combined CLAUDE.md footprint exceeds Codex AGENTS.md guidance',
      detail: `${(claudeMdSize / 1024).toFixed(1)}KB detected. Condense global instructions before a real migration.`,
    });
  }

  if (mcpWithSecrets.length > 0) {
    risks.push({
      id: 'mcp-secrets',
      severity: 'medium',
      title: 'Some MCP servers require secret re-entry',
      detail: `${mcpWithSecrets.join(', ')} will migrate structurally, but credentials must be restored in the Codex environment.`,
    });
  }

  return risks;
}

function buildEducation(inventory, plan) {
  const notes = [];
  const settings = inventory.settings || {};
  const permissionsCount = (inventory.permissions.allow || []).length + (inventory.permissions.deny || []).length;
  const agentCount = (inventory.agents || []).length + (inventory.projectAgents || []).length;
  const skillCount = (inventory.skills || []).length + (inventory.projectSkills || []).length;
  const mcpCount = Object.keys(inventory.mcpServers || {}).length;
  const pluginCount = enabledPluginCount(inventory);

  if (permissionsCount > 0) {
    notes.push({
      area: 'permissions',
      title: 'Permissions move from allow/deny lists to sandbox + approval policy',
      before: `Claude has ${permissionsCount} explicit permission rule(s).`,
      after: 'Codex centers on sandbox mode plus approval requests instead of tool-level allowlists.',
      implication: 'You will review trust boundaries at the environment level, not per individual tool verb.',
    });
  }

  if (agentCount > 0) {
    notes.push({
      area: 'agents',
      title: 'Agents become skills or delegated workflows',
      before: `Claude setup contains ${agentCount} agent file(s).`,
      after: 'Codex can delegate, but migration converts agents into reusable skills because there is no direct Claude agent-team runtime.',
      implication: 'Anything relying on always-on teams or team orchestration should be rewritten as explicit delegation patterns.',
    });
  }

  if (skillCount > 0 || pluginCount > 0) {
    notes.push({
      area: 'skills',
      title: 'Skills stay first-class and can be bundled more cleanly',
      before: `${skillCount} skill(s) and ${pluginCount} enabled Claude plugin(s) detected.`,
      after: 'Codex skills live in directories and can be bundled with MCP servers into plugins.',
      implication: 'This is the main upgrade path for making your setup portable and easier to share.',
    });
  }

  if (mcpCount > 0) {
    notes.push({
      area: 'mcp',
      title: 'MCP mostly transfers, but auth and paths matter',
      before: `${mcpCount} MCP server(s) detected across ${plan.summary.runtimeCommands.join(', ') || 'no'} runtimes.`,
      after: 'Codex can run the same MCP servers once commands, env vars, and local paths are valid.',
      implication: 'Expect the best results when you migrate config first, then verify each server with mcp debugging one by one.',
    });
  }

  if ((inventory.hooks || []).length > 0) {
    notes.push({
      area: 'hooks',
      title: 'Hooks are close, but not identical',
      before: `${(inventory.hooks || []).length} hook(s) found in Claude.`,
      after: 'Common lifecycle hooks migrate well; Claude-only events are flagged for manual review.',
      implication: 'Use the migration report to prune notifications and workflows that only made sense in Claude.',
    });
  }

  return notes;
}

function buildImprovements(inventory) {
  const improvements = [
    {
      title: 'Native Plan mode',
      detail: 'Codex has built-in planning and execution flow instead of relying on a custom plan-mode plugin.',
    },
    {
      title: 'Portable plugin packaging',
      detail: 'Skills and MCP servers can be bundled into versioned plugins instead of staying embedded in one local setup.',
    },
    {
      title: 'OS-level sandboxing',
      detail: 'Security posture moves closer to the machine boundary, which is simpler to reason about than large allowlists.',
    },
  ];

  if (((inventory.skills || []).length + (inventory.projectSkills || []).length) >= 20) {
    improvements.push({
      title: 'Cleaner skill organization',
      detail: 'A large skill library benefits from Codex’s directory-based skill layout and plugin grouping.',
    });
  }

  return improvements;
}

function buildRecommendedFlow(plan, inventory, codexHome) {
  const flow = [];
  const baseCommands = {
    scan: `cc2codex scan --claude-home "${inventory.claudeHome}"`,
    doctor: `cc2codex doctor --claude-home "${inventory.claudeHome}" --codex-home "${codexHome}"`,
    plan: `cc2codex plan --claude-home "${inventory.claudeHome}" --codex-home "${codexHome}"`,
    applyGlobal: `cc2codex apply --global --claude-home "${inventory.claudeHome}" --codex-home "${codexHome}"`,
    applySkills: `cc2codex apply --skills --claude-home "${inventory.claudeHome}" --codex-home "${codexHome}"`,
    validate: `cc2codex validate --codex-home "${codexHome}"`,
    bundle: `cc2codex bundle-plugins --apply --claude-home "${inventory.claudeHome}" --codex-home "${codexHome}"`,
  };

  flow.push({
    step: 1,
    title: 'Read-only assessment',
    goal: 'Understand migration complexity before any writes.',
    commands: [baseCommands.scan, baseCommands.doctor, baseCommands.plan],
  });
  flow.push({
    step: 2,
    title: 'Trial global migration into a sandboxed Codex home',
    goal: 'Verify config, hooks, context, and AGENTS output separately from your live Codex setup.',
    commands: [baseCommands.applyGlobal, baseCommands.validate],
  });
  flow.push({
    step: 3,
    title: 'Review the behavioral changes',
    goal: 'Read warnings about hooks, permissions, agent workflows, and CLAUDE-specific references before migrating skills.',
    commands: [],
  });
  flow.push({
    step: 4,
    title: 'Migrate skills and converted agents',
    goal: 'Bring over reusable workflows only after the global runtime is stable.',
    commands: [baseCommands.applySkills, baseCommands.validate],
  });

  if ((inventory.skills || []).length + (inventory.projectSkills || []).length >= 10) {
    flow.push({
      step: 5,
      title: 'Bundle plugins for long-term maintainability',
      goal: 'Group related skills and MCP servers into portable plugin packages.',
      commands: [baseCommands.bundle],
    });
  }

  flow.push({
    step: flow.length + 1,
    title: 'Cut over intentionally',
    goal: 'Move from trial output to your real Codex home only after MCP auth, hooks, and instruction files are reviewed.',
    commands: [],
  });

  return flow;
}

export async function buildDoctorReport(inventory, opts) {
  const { codexHome } = opts;
  const plan = await planMigration(inventory, { codexHome });
  const readiness = calculateReadiness(inventory, plan);

  return {
    summary: {
      ...plan.summary,
      readinessScore: readiness.score,
      readinessLevel: readiness.level,
      migrationComplexity: readiness.complexity,
      enabledPlugins: enabledPluginCount(inventory),
      totalClaudeMdKB: Number((totalClaudeMdSize(inventory) / 1024).toFixed(1)),
    },
    risks: buildRisks(inventory, plan),
    education: buildEducation(inventory, plan),
    improvements: buildImprovements(inventory),
    recommendedFlow: buildRecommendedFlow(plan, inventory, codexHome),
    plan,
  };
}
