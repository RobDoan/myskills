import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, resolvePromptPath } from '../scripts/config.mjs';

describe('loadConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-brainstorm-config-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads config from specified path', () => {
    const configPath = path.join(tmpDir, 'config.yml');
    fs.writeFileSync(configPath, `
classifier:
  model: haiku
  confidence_threshold: 0.7
  max_consecutive_rejections: 3
agents:
  answerer:
    description: "Answers questions"
    order: 1
    handler: sdk
    model: opus
    prompt: prompts/answerer.md
    max_turns: 1
`);
    const config = loadConfig(configPath);
    assert.equal(config.classifier.model, 'haiku');
    assert.equal(config.classifier.confidence_threshold, 0.7);
    assert.equal(config.agents.answerer.handler, 'sdk');
    assert.equal(config.agents.answerer.model, 'opus');
  });

  it('copies default config when user config missing', () => {
    const configPath = path.join(tmpDir, 'missing.yml');
    const defaultPath = path.join(tmpDir, 'default.yml');
    fs.writeFileSync(defaultPath, `
classifier:
  model: haiku
  confidence_threshold: 0.7
  max_consecutive_rejections: 3
agents: {}
`);
    const config = loadConfig(configPath, defaultPath);
    assert.equal(config.classifier.model, 'haiku');
    assert.ok(fs.existsSync(configPath));
  });

  it('merges handler_defaults into agent configs', () => {
    const configPath = path.join(tmpDir, 'config.yml');
    fs.writeFileSync(configPath, `
classifier:
  model: haiku
  confidence_threshold: 0.7
  max_consecutive_rejections: 3
agents:
  answerer:
    description: "Answers questions"
    order: 1
    handler: sdk
    model: opus
    prompt: prompts/answerer.md
handler_defaults:
  sdk:
    max_turns: 1
`);
    const config = loadConfig(configPath);
    assert.equal(config.agents.answerer.max_turns, 1);
  });
});

describe('resolvePromptPath', () => {
  it('resolves relative path against plugin root', () => {
    const result = resolvePromptPath('prompts/answerer.md', '/usr/local/plugin');
    assert.equal(result, '/usr/local/plugin/prompts/answerer.md');
  });

  it('preserves absolute paths', () => {
    const result = resolvePromptPath('/absolute/path.md', '/usr/local/plugin');
    assert.equal(result, '/absolute/path.md');
  });
});
