import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('auto-answer CLI — answer path emits hookSpecificOutput JSON', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-brainstorm-int-'));
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  function scaffold({ classifierAgent = 'answerer', classifierConf = 0.95, answer = 'B' } = {}) {
    const briefPath = path.join(tmpDir, 'brief.md');
    // auto-answer resolves config as: CLAUDE_PROJECT_DIR/.claude/auto-brainstorm.yml
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const configPath = path.join(claudeDir, 'auto-brainstorm.yml');
    const promptsDir = path.join(tmpDir, 'prompts');
    fs.mkdirSync(promptsDir);

    fs.writeFileSync(path.join(promptsDir, 'classifier.md'), 'classifier');
    fs.writeFileSync(path.join(promptsDir, 'answerer.md'), 'answerer');
    fs.writeFileSync(briefPath, '## Intent\nTest\n');

    const commandHandlerScript = path.join(tmpDir, 'answer.sh');
    fs.writeFileSync(commandHandlerScript, `#!/usr/bin/env bash\necho -n "${answer}"\n`);
    fs.chmodSync(commandHandlerScript, 0o755);

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
    handler: command
    command: "${commandHandlerScript}"
    timeout: 5000
handler_defaults:
  command:
    timeout: 10000
`);

    return {
      briefPath,
      configPath,
      pluginRoot: tmpDir,
      classifierStub: JSON.stringify({ agent: classifierAgent, confidence: classifierConf }),
    };
  }

  it('emits permissionDecision=allow with answers map when the handler succeeds', () => {
    const { pluginRoot, classifierStub } = scaffold({ answer: 'B' });

    const payload = {
      tool_input: {
        questions: [
          { question: 'Which approach?', options: [
            { label: 'A', description: 'simple' },
            { label: 'B', description: 'complex' },
            { label: 'Other', description: 'free' },
          ] },
        ],
      },
    };

    const scriptPath = path.resolve('scripts/auto-answer.mjs');
    const res = spawnSync(process.execPath, [scriptPath], {
      input: JSON.stringify(payload),
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        CLAUDE_PROJECT_DIR: pluginRoot,
        AUTO_BRAINSTORM_TEST_CLASSIFIER: classifierStub,
      },
      encoding: 'utf8',
    });

    assert.equal(res.status, 0, `stderr was: ${res.stderr}`);
    assert.ok(res.stdout.trim().length > 0, `expected stdout JSON, got stderr: ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
    assert.deepEqual(out.hookSpecificOutput.updatedInput.answers, {
      'Which approach?': 'B',
    });
    assert.equal(out.hookSpecificOutput.updatedInput.questions.length, 1);
  });
});
