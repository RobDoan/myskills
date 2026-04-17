import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export function loadConfig(configPath, defaultPath) {
  if (!fs.existsSync(configPath) && defaultPath && fs.existsSync(defaultPath)) {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(defaultPath, configPath);
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const config = YAML.parse(raw);

  // Merge handler_defaults into each agent
  if (config.handler_defaults && config.agents) {
    for (const [name, agent] of Object.entries(config.agents)) {
      const defaults = config.handler_defaults[agent.handler];
      if (defaults) {
        config.agents[name] = { ...defaults, ...agent };
      }
    }
  }

  return config;
}

export function resolvePromptPath(promptPath, pluginRoot) {
  if (path.isAbsolute(promptPath)) return promptPath;
  return path.join(pluginRoot, promptPath);
}
