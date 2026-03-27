import { join } from 'path';
import { tmpdir } from 'os';
import { buildDoctorReport } from './doctor.js';

function quote(value) {
  return `"${value}"`;
}

function withProject(command, project) {
  return project ? `${command} --project ${quote(project)}` : command;
}

function buildCommands({ claudeHome, project, trialCodexHome, codexHome }) {
  const scan = withProject(`cc2codex scan --claude-home ${quote(claudeHome)}`, project);
  const doctor = withProject(
    `cc2codex doctor --claude-home ${quote(claudeHome)} --codex-home ${quote(codexHome)}`,
    project
  );
  const plan = withProject(
    `cc2codex plan --claude-home ${quote(claudeHome)} --codex-home ${quote(codexHome)}`,
    project
  );
  const trialGlobal = withProject(
    `cc2codex apply --global --claude-home ${quote(claudeHome)} --codex-home ${quote(trialCodexHome)}`,
    project
  );
  const trialSkills = withProject(
    `cc2codex apply --skills --claude-home ${quote(claudeHome)} --codex-home ${quote(trialCodexHome)}`,
    project
  );
  const liveGlobal = withProject(
    `cc2codex apply --global --claude-home ${quote(claudeHome)} --codex-home ${quote(codexHome)}`,
    project
  );
  const liveSkills = withProject(
    `cc2codex apply --skills --claude-home ${quote(claudeHome)} --codex-home ${quote(codexHome)}`,
    project
  );
  const bundleTrial = `cc2codex bundle-plugins --apply --claude-home ${quote(claudeHome)} --codex-home ${quote(trialCodexHome)}`;
  const validateTrial = `cc2codex validate --codex-home ${quote(trialCodexHome)}`;
  const validateLive = `cc2codex validate --codex-home ${quote(codexHome)}`;

  return {
    scan,
    doctor,
    plan,
    trialGlobal,
    trialSkills,
    liveGlobal,
    liveSkills,
    bundleTrial,
    validateTrial,
    validateLive,
  };
}

function buildReviewChecklist(report, trialCodexHome) {
  const checklist = [
    `Open ${join(trialCodexHome, 'config.toml')} and confirm model, sandbox_mode, approval_policy, and MCP sections look right.`,
    `Open ${join(trialCodexHome, 'hooks.json')} and verify each remaining hook still makes sense in Codex.`,
    `Open ${join(trialCodexHome, 'AGENTS.md')} and confirm the instructions are concise enough to keep.`,
    `Open ${join(trialCodexHome, 'migration-report.md')} and work through the warnings before touching your live Codex home.`,
  ];

  for (const risk of report.risks) {
    checklist.push(`${risk.title}: ${risk.detail}`);
  }

  return checklist;
}

export async function buildMigrationGuide(inventory, opts) {
  const codexHome = opts.codexHome;
  const trialCodexHome = opts.trialCodexHome || join(tmpdir(), 'cc2codex-trial', '.codex');
  const project = opts.project || null;
  const doctorReport = await buildDoctorReport(inventory, { codexHome });
  const commands = buildCommands({
    claudeHome: inventory.claudeHome,
    project,
    trialCodexHome,
    codexHome,
  });

  const steps = [
    {
      id: 'assess',
      title: 'Assess the current Claude setup',
      goal: 'Get a read-only inventory, readiness score, and staged migration plan before writing anything.',
      commands: [commands.scan, commands.doctor, commands.plan],
      checks: [
        `Readiness score: ${doctorReport.summary.readinessScore}/100 (${doctorReport.summary.readinessLevel})`,
        `Complexity: ${doctorReport.summary.migrationComplexity}`,
      ],
    },
    {
      id: 'trial-global',
      title: 'Create a safe trial migration for global Codex config',
      goal: 'Write only the global config, hooks, context, and AGENTS output into a temporary Codex home.',
      commands: [commands.trialGlobal, commands.validateTrial],
      checks: [
        `Trial Codex home: ${trialCodexHome}`,
        'Do not use your real ~/.codex until this trial output looks correct.',
      ],
    },
    {
      id: 'review',
      title: 'Review the behavioral changes before migrating skills',
      goal: 'Compare what Codex changes about permissions, hooks, agents, and MCP auth for this setup.',
      commands: [],
      checks: buildReviewChecklist(doctorReport, trialCodexHome),
    },
    {
      id: 'trial-skills',
      title: 'Migrate skills and converted agents into the trial environment',
      goal: 'Bring over reusable workflows only after the global runtime is validated.',
      commands: [commands.trialSkills, commands.validateTrial],
      checks: [
        `${doctorReport.summary.skills} skill(s) and ${doctorReport.summary.agents} agent-derived workflow(s) will land under the sibling .agents directory.`,
      ],
    },
  ];

  if (doctorReport.summary.skills >= 10) {
    steps.push({
      id: 'bundle',
      title: 'Bundle plugins for long-term maintainability',
      goal: 'Group related skills and MCP servers into reusable Codex plugins after the trial migration is stable.',
      commands: [commands.bundleTrial],
      checks: ['Useful once the migrated skill library feels correct and worth keeping.'],
    });
  }

  steps.push(
    {
      id: 'cutover',
      title: 'Cut over to the real Codex home',
      goal: 'Repeat the proven trial steps against the real target only after MCP auth and hooks are reviewed.',
      commands: [commands.liveGlobal, commands.liveSkills, commands.validateLive],
      checks: [
        `Real Codex home: ${codexHome}`,
        'Only do this after the temporary migration output is acceptable.',
      ],
    },
    {
      id: 'post-cutover',
      title: 'Run post-cutover checks',
      goal: 'Confirm the migrated setup behaves correctly in Codex, not just that the files parse.',
      commands: ['codex --mcp-debug'],
      checks: [
        'Re-enter any redacted MCP secrets in the shell or environment manager.',
        'Test the MCP servers one by one.',
        'Prune leftover Claude-only references and unsupported hooks.',
      ],
    }
  );

  return {
    summary: doctorReport.summary,
    risks: doctorReport.risks,
    education: doctorReport.education,
    improvements: doctorReport.improvements,
    trialCodexHome,
    liveCodexHome: codexHome,
    steps,
  };
}
