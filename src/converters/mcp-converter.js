import {
  mcpServerToToml,
  findClaudeReferences,
  normalizeMcpConfig,
  isSensitiveEnvKey,
} from '../utils.js';

/**
 * Convert MCP server configs from Claude Code JSON format to Codex TOML format.
 */
export function convertMcpServers(inventory) {
  const warnings = [];
  let toml = '';
  let serverCount = 0;

  if (!inventory.mcpServers || Object.keys(inventory.mcpServers).length === 0) {
    return { toml, serverCount, warnings };
  }

  toml += '# MCP Server Configuration\n';
  toml += '# Converted from Claude Code settings.json\n\n';

  for (const [name, config] of Object.entries(inventory.mcpServers)) {
    const normalizedConfig = normalizeMcpConfig(config);

    // Check if the server is disabled
    if (normalizedConfig.disabled === true || normalizedConfig.enabled === false) {
      toml += `# Disabled server: ${name}\n`;
      toml += `# ${mcpServerToToml(name, normalizedConfig).replace(/\n/g, '\n# ')}\n`;
      warnings.push(`MCP server "${name}" was disabled — commented out in output`);
      continue;
    }

    // Validate required fields
    if (!normalizedConfig.command) {
      warnings.push(`MCP server "${name}" has no command — skipped`);
      continue;
    }

    toml += mcpServerToToml(name, normalizedConfig);
    toml += '\n';
    serverCount++;

    // Check for Claude-specific references in server config
    const configStr = JSON.stringify(normalizedConfig);
    const refs = findClaudeReferences(configStr);
    if (refs.length > 0) {
      warnings.push(
        `MCP server "${name}" contains Claude-specific references: ${refs.join(', ')}`
      );
    }

    // Warn about env vars that might contain API keys
    if (normalizedConfig.env) {
      const sensitiveKeys = Object.keys(normalizedConfig.env).filter(
        k => isSensitiveEnvKey(k)
      );
      if (sensitiveKeys.length > 0) {
        warnings.push(
          `MCP server "${name}" has sensitive env vars (${sensitiveKeys.join(', ')}) — values were redacted; set them in the Codex environment`
        );
      }
    }
  }

  return { toml, serverCount, warnings };
}
