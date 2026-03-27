import { join } from 'path';
import { resolveAgentsHome } from '../utils.js';

/**
 * Default bundle definitions mapping skill names and MCP servers
 * to logical plugin packages.
 */
const DEFAULT_BUNDLES = {
  'jarvis-productivity': {
    description: 'Personal productivity system with JARVIS protocol',
    skills: ['personal-os', 'streak', 'quote', 'focus', 'familiar', 'recall', 'session', 'limit'],
    mcp: ['granola', 'google-calendar', 'gmail', 'notion'],
    category: 'Productivity',
  },
  'lingotune-growth': {
    description: 'Lingotune growth analytics and experimentation',
    skills: ['analytics-skill', 'growth-analytics', 'experiment-design', 'new-analytics-events', 'build-analytics'],
    mcp: ['amplitude', 'posthog', 'n8n'],
    category: 'Analytics',
  },
  'qa-toolkit': {
    description: 'QA testing, browser automation, and visual validation',
    skills: ['qa', 'qa-only', 'browse', 'canary', 'benchmark', 'visual-check', 'responsive-test'],
    mcp: ['chrome-devtools'],
    category: 'Testing',
  },
  'ship-suite': {
    description: 'Code review, deployment, and release management',
    skills: ['ship', 'review', 'land-and-deploy', 'document-release', 'retro'],
    mcp: [],
    category: 'DevOps',
  },
  'design-system': {
    description: 'Frontend design, consultation, and review',
    skills: ['frontend-design', 'design-consultation', 'plan-design-review', 'design-review', 'superdesign'],
    mcp: ['pencil'],
    category: 'Design',
  },
  'content-engine': {
    description: 'Content marketing and social media growth',
    skills: ['content-marketing', 'seo', 'meta-ads', 'twitter-x', 'reddit', 'youtube', 'tiktok', 'linkedin', 'email-outbound', 'google-ads', 'product-hunt', 'partnerships', 'community', 'referral-viral'],
    mcp: [],
    category: 'Marketing',
  },
  'devops-safety': {
    description: 'Debugging, security, and safety guards',
    skills: ['investigate', 'cso', 'careful', 'freeze', 'guard', 'unfreeze'],
    mcp: [],
    category: 'DevOps',
  },
  'monetization': {
    description: 'Pricing, revenue models, and monetization strategy',
    skills: ['value-metric', 'price-optimization', 'model-subscription', 'model-transaction', 'model-ads', 'timing-freemium', 'timing-free-trial', 'timing-upfront'],
    mcp: [],
    category: 'Strategy',
  },
  'engagement': {
    description: 'User engagement, activation, and habit formation',
    skills: ['engagement-loops', 'feature-adoption', 'notifications', 'aha-moment', 'habit-moment', 'setup-moment'],
    mcp: [],
    category: 'Growth',
  },
  'resurrection': {
    description: 'Churn analysis, reactivation, and win-back campaigns',
    skills: ['churn-analysis', 'reactivation', 'win-back'],
    mcp: [],
    category: 'Growth',
  },
};

/**
 * Build a set of all skill names claimed by any bundle.
 */
function buildBundledSkillSet(bundles) {
  const set = new Set();
  for (const bundle of Object.values(bundles)) {
    for (const skill of bundle.skills) {
      set.add(skill);
    }
  }
  return set;
}

/**
 * Build a lookup map from inventory skills array: name -> skill object.
 */
function buildSkillMap(inventory) {
  const map = new Map();
  for (const skill of inventory.skills) {
    map.set(skill.name, skill);
  }
  // Also include project-level skills
  if (inventory.projectSkills) {
    for (const skill of inventory.projectSkills) {
      if (!map.has(skill.name)) {
        map.set(skill.name, skill);
      }
    }
  }
  return map;
}

/**
 * Convert a bundle name like "jarvis-productivity" to a display name
 * like "Jarvis Productivity".
 */
function toDisplayName(bundleName) {
  return bundleName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Build a plugin.json object for a bundle.
 */
function buildPluginJson(bundleName, bundleDef, hasMcp) {
  const plugin = {
    name: bundleName,
    version: '1.0.0',
    description: bundleDef.description,
    skills: './skills/',
    interface: {
      displayName: toDisplayName(bundleName),
      category: bundleDef.category,
    },
  };
  if (hasMcp) {
    plugin.mcpServers = './.mcp.json';
  }
  return plugin;
}

/**
 * Build .mcp.json content from inventory MCP server configs.
 */
function buildMcpJson(mcpNames, inventoryMcpServers) {
  const servers = {};
  for (const name of mcpNames) {
    const config = inventoryMcpServers[name];
    if (!config) continue;
    servers[name] = {
      command: config.command || '',
      args: config.args || [],
    };
    if (config.env && Object.keys(config.env).length > 0) {
      servers[name].env = config.env;
    }
  }
  return { servers };
}

/**
 * Generate all plugin files as an array of { path, content } objects.
 * Does not write to disk -- caller handles that.
 *
 * @param {object} inventory - The scanned Claude Code inventory
 * @returns {Array<{ path: string, content: string }>}
 */
export function generatePluginFiles(inventory) {
  const agentsHome = resolveAgentsHome();
  const pluginsRoot = join(agentsHome, 'plugins');
  const skillMap = buildSkillMap(inventory);
  const bundles = DEFAULT_BUNDLES;
  const files = [];
  const pluginSummaries = [];

  for (const [bundleName, bundleDef] of Object.entries(bundles)) {
    const bundleDir = join(pluginsRoot, bundleName);

    // Resolve which skills from this bundle actually exist in inventory
    const resolvedSkills = [];
    for (const skillName of bundleDef.skills) {
      const skill = skillMap.get(skillName);
      if (skill) {
        resolvedSkills.push(skill);
      }
    }

    // Skip bundles that have zero matching skills and zero matching MCP servers
    const matchedMcp = bundleDef.mcp.filter(name => inventory.mcpServers[name]);
    if (resolvedSkills.length === 0 && matchedMcp.length === 0) {
      continue;
    }

    // plugin.json
    const hasMcp = matchedMcp.length > 0;
    const pluginJson = buildPluginJson(bundleName, bundleDef, hasMcp);
    files.push({
      path: join(bundleDir, '.codex-plugin', 'plugin.json'),
      content: JSON.stringify(pluginJson, null, 2) + '\n',
    });

    // SKILL.md files for each matched skill
    for (const skill of resolvedSkills) {
      const skillContent = skill.content || `# ${skill.name}\n\nSkill migrated from Claude Code.\n`;
      files.push({
        path: join(bundleDir, 'skills', skill.name, 'SKILL.md'),
        content: skillContent,
      });
    }

    // .mcp.json if the bundle has MCP servers present in inventory
    if (hasMcp) {
      const mcpJson = buildMcpJson(matchedMcp, inventory.mcpServers);
      files.push({
        path: join(bundleDir, '.mcp.json'),
        content: JSON.stringify(mcpJson, null, 2) + '\n',
      });
    }

    // Track for marketplace
    pluginSummaries.push({
      name: bundleName,
      description: bundleDef.description,
      category: bundleDef.category,
      displayName: toDisplayName(bundleName),
      skillCount: resolvedSkills.length,
      mcpCount: matchedMcp.length,
    });
  }

  // marketplace.json listing all generated plugins
  if (pluginSummaries.length > 0) {
    const marketplace = {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      plugins: pluginSummaries,
    };
    files.push({
      path: join(pluginsRoot, 'marketplace.json'),
      content: JSON.stringify(marketplace, null, 2) + '\n',
    });
  }

  return files;
}

/**
 * Main function called by CLI bundle-plugins command.
 * Analyzes inventory, generates plugin bundles, and returns a report.
 *
 * @param {object} inventory - The scanned Claude Code inventory
 * @param {object} [opts={}] - Options (reserved for future use)
 * @returns {{ plugins: Array<{ name: string, skillCount: number, mcpCount: number, files: string[] }>, unbundledSkills: string[], warnings: string[] }}
 */
export async function bundlePlugins(inventory, opts = {}) {
  const warnings = [];
  const skillMap = buildSkillMap(inventory);
  const bundledSkillSet = buildBundledSkillSet(DEFAULT_BUNDLES);

  // Identify unbundled skills: present in inventory but not claimed by any bundle
  const inventorySkillNames = new Set(skillMap.keys());
  const unbundledSkills = [...inventorySkillNames].filter(name => !bundledSkillSet.has(name)).sort();

  // Check for MCP servers referenced by bundles but missing from inventory
  for (const [bundleName, bundleDef] of Object.entries(DEFAULT_BUNDLES)) {
    for (const mcpName of bundleDef.mcp) {
      if (!inventory.mcpServers[mcpName]) {
        warnings.push(`Bundle "${bundleName}" references MCP server "${mcpName}" which is not in inventory`);
      }
    }
  }

  // Check for skill names in bundles that don't exist in inventory
  for (const [bundleName, bundleDef] of Object.entries(DEFAULT_BUNDLES)) {
    for (const skillName of bundleDef.skills) {
      if (!skillMap.has(skillName)) {
        warnings.push(`Bundle "${bundleName}" references skill "${skillName}" which is not in inventory — skipped`);
      }
    }
  }

  // Generate files
  const files = generatePluginFiles(inventory);

  // Build per-plugin summaries from the generated files
  const pluginMap = new Map();
  for (const file of files) {
    // Extract plugin name from path: .../plugins/{name}/...
    const parts = file.path.split('/');
    const pluginsIdx = parts.indexOf('plugins');
    if (pluginsIdx === -1 || pluginsIdx + 1 >= parts.length) continue;
    const pluginName = parts[pluginsIdx + 1];
    // Skip marketplace.json (it's at the plugins root level)
    if (pluginName === 'marketplace.json') continue;

    if (!pluginMap.has(pluginName)) {
      pluginMap.set(pluginName, { name: pluginName, skillCount: 0, mcpCount: 0, files: [] });
    }
    const entry = pluginMap.get(pluginName);
    entry.files.push(file.path);

    // Count skills by looking for SKILL.md files
    if (file.path.endsWith('SKILL.md')) {
      entry.skillCount++;
    }
    // Count MCP by checking for .mcp.json
    if (file.path.endsWith('.mcp.json')) {
      try {
        const parsed = JSON.parse(file.content);
        entry.mcpCount = Object.keys(parsed.servers || {}).length;
      } catch {
        // ignore parse errors
      }
    }
  }

  const plugins = [...pluginMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  return { plugins, unbundledSkills, warnings };
}
