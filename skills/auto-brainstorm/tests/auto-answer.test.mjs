import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { orchestrate } from '../scripts/auto-answer.mjs';

describe('orchestrate', () => {
  let tmpDir;
  let configPath;
  let briefPath;
  let stateDir;
  let promptsDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-brainstorm-orch-'));
    configPath = path.join(tmpDir, 'config.yml');
    briefPath = path.join(tmpDir, 'brief.md');
    stateDir = tmpDir;
    promptsDir = path.join(tmpDir, 'prompts');
    fs.mkdirSync(promptsDir);

    // Write minimal config
    fs.writeFileSync(configPath, `
classifier:
  model: haiku
  confidence_threshold: 0.7
  max_consecutive_rejections: 3
session:
  brief_path: ${briefPath}
  state_dir: ${stateDir}
  cleanup_on_end: true
agents:
  answerer:
    description: "Answers clarifying questions"
    order: 1
    handler: sdk
    model: opus
    prompt: prompts/answerer.md
    max_turns: 1
handler_defaults:
  sdk:
    max_turns: 1
`);

    // Write brief
    fs.writeFileSync(briefPath, '## User Intent\nBuild a caching layer.\n');

    // Write prompt files
    fs.writeFileSync(path.join(promptsDir, 'answerer.md'), 'You are an answerer.');
    fs.writeFileSync(path.join(promptsDir, 'classifier.md'), 'You are a classifier.');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns escalate when brief file is missing', async () => {
    fs.unlinkSync(briefPath);
    const result = await orchestrate({
      question: 'What is the goal?',
      configPath,
      pluginRoot: tmpDir,
      sessionPid: '12345',
    });
    assert.equal(result.action, 'escalate');
    assert.ok(result.reason.includes('brief'));
  });

  it('returns escalate when consecutive rejections exceed threshold', async () => {
    const statePath = path.join(stateDir, 'auto-brainstorm-12345.json');
    fs.writeFileSync(statePath, JSON.stringify({
      session_id: '12345',
      total_questions: 1,
      current_sequence: 1,
      consecutive_rejections: 3,
      history: [],
    }));

    const result = await orchestrate({
      question: 'What is the goal?',
      configPath,
      pluginRoot: tmpDir,
      sessionPid: '12345',
    });
    assert.equal(result.action, 'escalate');
    assert.ok(result.reason.includes('3'));
  });
});

describe('auto-answer CLI — hook response format', () => {
  let tmpDir;
  let briefPath;
  let configPath;
  let promptsDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-brainstorm-cli-'));
    briefPath = path.join(tmpDir, 'brief.md');
    configPath = path.join(tmpDir, 'config.yml');
    promptsDir = path.join(tmpDir, 'prompts');
    fs.mkdirSync(promptsDir);
    fs.writeFileSync(briefPath, '## Intent\nTest brief.\n');
    fs.writeFileSync(configPath, `
classifier:
  model: haiku
  confidence_threshold: 0.7
  max_consecutive_rejections: 3
session:
  brief_path: ${briefPath}
  state_dir: ${tmpDir}
agents:
  answerer:
    description: "clarifying questions"
    order: 1
    handler: sdk
    model: haiku
    prompt: prompts/answerer.md
    max_turns: 1
handler_defaults:
  sdk:
    max_turns: 1
`);
    fs.writeFileSync(path.join(promptsDir, 'answerer.md'), 'answerer');
    fs.writeFileSync(path.join(promptsDir, 'classifier.md'), 'classifier');
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('on escalate (no brief), writes reason to stderr and exits 0', () => {
    fs.unlinkSync(briefPath);
    const scriptPath = path.resolve('scripts/auto-answer.mjs');
    const payload = {
      tool_input: {
        questions: [{ question: 'Q?', options: [{ label: 'A' }, { label: 'B' }] }],
      },
    };
    const res = spawnSync(process.execPath, [scriptPath], {
      input: JSON.stringify(payload),
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: tmpDir, CLAUDE_PROJECT_DIR: tmpDir },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0);
    assert.ok(res.stderr.length > 0, 'expected a reason on stderr');
    assert.equal(res.stdout.trim(), '', 'expected no stdout on escalate');
  });
});
