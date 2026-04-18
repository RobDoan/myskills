import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
