# Multi-Agent hcom Brainstorming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `skills/auto-brainstorm` so brainstorming questions can be answered by a long-lived Gemini peer over `hcom`, and fix the hook response so Claude Code treats auto-answers as successful tool results.

**Architecture:** Add a new `hcom` handler alongside existing `sdk`/`webhook`/`command`. Swap the `AskUserQuestion` hook response from exit-2/stderr to exit-0 with `hookSpecificOutput.permissionDecision=allow` + `updatedInput.answers`. Introduce a pure `answer-mapper` to translate Gemini's free-text reply into `AskUserQuestion` option labels. Three persona prompts (user-stand-in, critic, spec-reviewer). Gemini is pre-launched by the user via `hcom gemini --name gemini`.

**Tech Stack:** Node.js 18+ ESM, `node:test`, `node:assert/strict`, `yaml`, `@anthropic-ai/claude-code`, `hcom` CLI.

**Spec:** `docs/superpowers/specs/2026-04-22-multi-agent-hcom-brainstorming-design.md`

**All paths are relative to the repo root** `/Users/quydoan/Projects/ai-agents/myskills/`. The plugin lives at `skills/auto-brainstorm/`. Node tests are run from the **plugin root** (`skills/auto-brainstorm/`) using `node --test`.

---

## Task 0: Baseline — verify existing tests pass

Before changing anything, establish a known-good baseline so regressions are obvious.

**Files:** none modified.

- [ ] **Step 1: Run the existing test suite**

Run:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm
node --test tests/
```

Expected: all tests pass (auto-answer, classifier, config, handlers, state).

If any fail on a clean tree, stop and investigate before proceeding. The plan assumes a green baseline.

---

## Task 1: `answer-mapper.mjs` — translate Gemini reply into `AskUserQuestion` answers

Pure function, no IO. Unit-tested in isolation. Converts Gemini's free-text reply into an `answers` map keyed by question text with values that are either an existing option `label`, or the string `"Other: <free-form text>"`.

**Files:**

- Create: `skills/auto-brainstorm/scripts/answer-mapper.mjs`
- Create: `skills/auto-brainstorm/tests/answer-mapper.test.mjs`

**Behaviour contract:**

- Input: `questions` (array of `{question, options, multiSelect?}`) and `reply` (string from Gemini).
- Output: `{ answers: Record<questionText, string>, unmatched: string[] }`.
- For each question, scan the reply for a label match (case-insensitive, trimmed). Accepts `"B"`, `"B."`, `"B. explanation"`, `"Option B"`.
- If reply starts with `Other:`, use `"Other: " + trailing-text` as the answer when the question has an `"Other"` option; otherwise record in `unmatched`.
- For replies covering multiple questions, split on `\n---\n`, `^\d+\.\s`, or apply the whole reply to question[0] and mark the rest unmatched.
- If no match found, add the question text to `unmatched`.

- [ ] **Step 1: Write the failing test file**

Create `skills/auto-brainstorm/tests/answer-mapper.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswersMap } from '../scripts/answer-mapper.mjs';

const Q1 = {
  question: 'Which approach?',
  options: [
    { label: 'A', description: 'Simple' },
    { label: 'B', description: 'Complex' },
    { label: 'Other', description: 'Free-form' },
  ],
};

describe('buildAnswersMap — single question', () => {
  it('matches exact label', () => {
    const out = buildAnswersMap([Q1], 'B');
    assert.deepEqual(out.answers, { 'Which approach?': 'B' });
    assert.deepEqual(out.unmatched, []);
  });

  it('matches label with trailing explanation', () => {
    const out = buildAnswersMap([Q1], 'B. Because it matches the brief');
    assert.equal(out.answers['Which approach?'], 'B');
  });

  it('matches "Option X" prefix form', () => {
    const out = buildAnswersMap([Q1], 'Option A');
    assert.equal(out.answers['Which approach?'], 'A');
  });

  it('is case-insensitive', () => {
    const out = buildAnswersMap([Q1], 'b');
    assert.equal(out.answers['Which approach?'], 'B');
  });

  it('tolerates leading/trailing whitespace', () => {
    const out = buildAnswersMap([Q1], '   A   \n');
    assert.equal(out.answers['Which approach?'], 'A');
  });

  it('uses Other when reply starts with "Other:" and Other option exists', () => {
    const out = buildAnswersMap([Q1], 'Other: use SQLite instead');
    assert.equal(out.answers['Which approach?'], 'Other: use SQLite instead');
  });

  it('records unmatched when reply has no label and no Other option exists', () => {
    const q = { question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] };
    const out = buildAnswersMap([q], 'something unrelated');
    assert.equal(out.answers['Pick one'], undefined);
    assert.deepEqual(out.unmatched, ['Pick one']);
  });

  it('falls back to Other when no label matches but Other exists', () => {
    const out = buildAnswersMap([Q1], 'something unrelated');
    assert.equal(out.answers['Which approach?'], 'Other: something unrelated');
  });
});

describe('buildAnswersMap — multiple questions', () => {
  const q1 = { question: 'Q1?', options: [{ label: 'A' }, { label: 'B' }, { label: 'Other' }] };
  const q2 = { question: 'Q2?', options: [{ label: 'Yes' }, { label: 'No' }, { label: 'Other' }] };

  it('splits reply on --- separator', () => {
    const out = buildAnswersMap([q1, q2], 'A\n---\nYes');
    assert.deepEqual(out.answers, { 'Q1?': 'A', 'Q2?': 'Yes' });
  });

  it('splits reply on numbered list', () => {
    const out = buildAnswersMap([q1, q2], '1. B\n2. No');
    assert.deepEqual(out.answers, { 'Q1?': 'B', 'Q2?': 'No' });
  });

  it('applies whole reply to first question when no split found', () => {
    const out = buildAnswersMap([q1, q2], 'A');
    assert.equal(out.answers['Q1?'], 'A');
    assert.deepEqual(out.unmatched, ['Q2?']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm
node --test tests/answer-mapper.test.mjs
```

Expected: FAIL — `Cannot find module '../scripts/answer-mapper.mjs'`.

- [ ] **Step 3: Create the implementation**

Create `skills/auto-brainstorm/scripts/answer-mapper.mjs`:

```js
// Pure, IO-free. Maps a free-text agent reply into AskUserQuestion answers.
// See: docs/superpowers/specs/2026-04-22-multi-agent-hcom-brainstorming-design.md
// section "answer-mapper.mjs".

const LABEL_PATTERNS = [
  // "B", "B.", "B)" possibly trailing punctuation/whitespace
  /^\s*(?:option\s+)?([a-z0-9]+)\s*[.)]?\s*(?:[:\-–—]|\n|$)/i,
  // "Option B" anywhere on the first non-empty line
  /\boption\s+([a-z0-9]+)\b/i,
];

const OTHER_PATTERN = /^\s*other\s*:\s*(.+)$/is;
const SPLIT_DASH = /\n\s*-{3,}\s*\n/;
const SPLIT_NUMBERED = /\n?\s*\d+\.\s+/;

function findLabel(text, options) {
  const firstLine = text.split('\n')[0] || '';
  for (const p of LABEL_PATTERNS) {
    const m = firstLine.match(p);
    if (!m) continue;
    const candidate = m[1].trim().toLowerCase();
    const hit = options.find((o) => o.label.toLowerCase() === candidate);
    if (hit) return hit.label;
  }
  return null;
}

function hasOther(options) {
  return options.some((o) => o.label.toLowerCase() === 'other');
}

function resolveOne(question, reply) {
  const trimmed = reply.trim();
  if (!trimmed) return { answer: null };

  const otherMatch = trimmed.match(OTHER_PATTERN);
  if (otherMatch && hasOther(question.options)) {
    return { answer: `Other: ${otherMatch[1].trim()}` };
  }

  const label = findLabel(trimmed, question.options);
  if (label) return { answer: label };

  if (hasOther(question.options)) {
    return { answer: `Other: ${trimmed}` };
  }

  return { answer: null };
}

function splitReply(reply, count) {
  if (count <= 1) return [reply];
  if (SPLIT_DASH.test(reply)) return reply.split(SPLIT_DASH).map((s) => s.trim());
  const numbered = reply.split(SPLIT_NUMBERED).map((s) => s.trim()).filter(Boolean);
  if (numbered.length === count) return numbered;
  return [reply]; // no reliable split; caller applies to first only
}

export function buildAnswersMap(questions, reply) {
  const answers = {};
  const unmatched = [];

  const parts = splitReply(reply, questions.length);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const part = parts[i];
    if (part === undefined) {
      unmatched.push(q.question);
      continue;
    }
    const { answer } = resolveOne(q, part);
    if (answer === null) {
      unmatched.push(q.question);
    } else {
      answers[q.question] = answer;
    }
  }

  return { answers, unmatched };
}
```

- [ ] **Step 4: Run tests — expect all pass**

Run:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm
node --test tests/answer-mapper.test.mjs
```

Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/quydoan/Projects/ai-agents/myskills
git add skills/auto-brainstorm/scripts/answer-mapper.mjs \
        skills/auto-brainstorm/tests/answer-mapper.test.mjs
git commit -m "feat(auto-brainstorm): add answer-mapper for AskUserQuestion label resolution"
```

---

## Task 2: `hcom` handler — send question to Gemini, listen for reply

Shell out to the `hcom` CLI using `execFileSync`. Exposed via `handlers/hcom.mjs`, same `(question, brief, agentConfig, promptContent) → string` signature as the other handlers.

**Files:**

- Create: `skills/auto-brainstorm/scripts/handlers/hcom.mjs`
- Create: `skills/auto-brainstorm/tests/handlers/hcom.test.mjs`

**Dependency-injection approach:** the handler imports a tiny `_deps` object (exported by the module) that tests can override via import mocking. The real implementation uses `execFileSync`.

- [ ] **Step 1: Write the failing test**

Create `skills/auto-brainstorm/tests/handlers/hcom.test.mjs`:

```js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleHcom, _setDeps } from '../../scripts/handlers/hcom.mjs';

function stubDeps(overrides = {}) {
  const calls = { list: [], send: [], listen: [] };
  const deps = {
    listAgents: () => [{ name: 'gemini', status: 'active' }],
    sendMessage: (target, body, opts) => {
      calls.send.push({ target, body, opts });
      return 'msg-42';
    },
    listen: (opts) => {
      calls.listen.push(opts);
      return { text: 'B' };
    },
    ...overrides,
  };
  _setDeps(deps);
  return { deps, calls };
}

const baseAgentConfig = { target: 'gemini', persona: 'user-stand-in', timeout_ms: 60000 };

describe('handleHcom', () => {
  beforeEach(() => _setDeps(null)); // reset to real deps between tests

  it('sends envelope with persona, brief, question and returns gemini reply', async () => {
    const { calls } = stubDeps();
    const result = await handleHcom(
      'Which approach?',
      'brief-content',
      baseAgentConfig,
      'persona-prompt-content'
    );
    assert.equal(result, 'B');
    assert.equal(calls.send.length, 1);
    const body = calls.send[0].body;
    assert.match(body, /## PERSONA/);
    assert.match(body, /persona-prompt-content/);
    assert.match(body, /## DESIGN BRIEF/);
    assert.match(body, /brief-content/);
    assert.match(body, /## QUESTION/);
    assert.match(body, /Which approach\?/);
    assert.equal(calls.send[0].target, 'gemini');
    assert.equal(calls.send[0].opts.intent, 'request');
  });

  it('listens with matching reply-to id and correct timeout', async () => {
    const { calls } = stubDeps({
      sendMessage: () => 'msg-99',
      listen: (opts) => {
        assert.equal(opts.replyTo, 'msg-99');
        assert.equal(opts.timeoutSec, 60);
        assert.equal(opts.from, 'gemini');
        return { text: 'A' };
      },
    });
    const out = await handleHcom('Q', '', baseAgentConfig, '');
    assert.equal(out, 'A');
    assert.equal(calls.listen.length, 1);
  });

  it('throws when target agent is not running', async () => {
    stubDeps({ listAgents: () => [] });
    await assert.rejects(
      () => handleHcom('Q', '', baseAgentConfig, ''),
      /not running/i
    );
  });

  it('throws when target is stopped', async () => {
    stubDeps({
      listAgents: () => [{ name: 'gemini', status: 'stopped' }],
    });
    await assert.rejects(
      () => handleHcom('Q', '', baseAgentConfig, ''),
      /stopped/i
    );
  });

  it('propagates send errors with readable message', async () => {
    stubDeps({
      sendMessage: () => {
        throw new Error('hcom exit 1: bad target');
      },
    });
    await assert.rejects(
      () => handleHcom('Q', '', baseAgentConfig, ''),
      /bad target/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm
mkdir -p tests/handlers
node --test tests/handlers/hcom.test.mjs
```

Expected: FAIL — `Cannot find module '../../scripts/handlers/hcom.mjs'`.

- [ ] **Step 3: Create the handler**

Create `skills/auto-brainstorm/scripts/handlers/hcom.mjs`:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function realListAgents() {
  const out = execFileSync('hcom', ['list', '--json'], { encoding: 'utf8' });
  try {
    const parsed = JSON.parse(out);
    // hcom list --json shape: { agents: [{name, status, ...}] } (best-effort)
    return parsed.agents || [];
  } catch {
    return [];
  }
}

function realSendMessage(target, body, opts) {
  const tmp = path.join(os.tmpdir(), `hcom-envelope-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(tmp, body);
  try {
    const args = [
      'send', `@${target}`,
      '--intent', opts.intent || 'request',
      '--from', 'auto-brainstorm',
      '--file', tmp,
      '--json',
    ];
    const out = execFileSync('hcom', args, { encoding: 'utf8' });
    try {
      const parsed = JSON.parse(out);
      return parsed.id || parsed.event_id || '';
    } catch {
      return out.trim();
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
  }
}

function realListen({ from, replyTo, timeoutSec }) {
  const args = ['listen', String(timeoutSec), '--from', from, '--json'];
  if (replyTo) args.push('--reply-to', replyTo);
  const out = execFileSync('hcom', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  try {
    const parsed = JSON.parse(out);
    const body = parsed.text ?? parsed.body ?? parsed.message ?? '';
    return { text: String(body) };
  } catch {
    return { text: out.trim() };
  }
}

// Dependency injection seam for tests.
let _deps = null;
export function _setDeps(deps) { _deps = deps; }
function deps() {
  return _deps || {
    listAgents: realListAgents,
    sendMessage: realSendMessage,
    listen: realListen,
  };
}

function assertTargetRunning(target) {
  const agents = deps().listAgents();
  const found = agents.find((a) => a.name === target);
  if (!found) {
    throw new Error(`hcom target "${target}" is not running. Start it with: hcom gemini --name ${target}`);
  }
  if (String(found.status).toLowerCase() === 'stopped') {
    throw new Error(`hcom target "${target}" is stopped. Resume with: hcom r ${target}`);
  }
}

function formatEnvelope({ persona, brief, question, promptContent }) {
  return [
    '## PERSONA',
    `(role: ${persona})`,
    '',
    promptContent || '',
    '',
    '## DESIGN BRIEF',
    brief || '(none provided)',
    '',
    '## QUESTION',
    question,
    '',
    '## RESPONSE FORMAT',
    'Reply with one line: the label you pick (e.g., "B"), optionally followed by a brief',
    'explanation on the next line. For free-form answers, write: "Other: <your answer>"',
    '',
  ].join('\n');
}

export async function handleHcom(question, brief, agentConfig, promptContent) {
  const target = agentConfig.target || 'gemini';
  const timeoutMs = agentConfig.timeout_ms || 60000;
  const persona = agentConfig.persona || 'default';

  assertTargetRunning(target);

  const body = formatEnvelope({ persona, brief, question, promptContent });
  const msgId = deps().sendMessage(target, body, { intent: 'request' });
  const reply = deps().listen({
    from: target,
    replyTo: msgId,
    timeoutSec: Math.ceil(timeoutMs / 1000),
  });

  return reply.text;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm
node --test tests/handlers/hcom.test.mjs
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/quydoan/Projects/ai-agents/myskills
git add skills/auto-brainstorm/scripts/handlers/hcom.mjs \
        skills/auto-brainstorm/tests/handlers/hcom.test.mjs
git commit -m "feat(auto-brainstorm): add hcom handler for multi-agent brainstorming"
```

---

## Task 3: Register `hcom` in handler registry

**Files:**

- Modify: `skills/auto-brainstorm/scripts/handlers/index.mjs`
- Modify: `skills/auto-brainstorm/tests/handlers.test.mjs`

- [ ] **Step 1: Extend the existing handler-registry test**

Edit `skills/auto-brainstorm/tests/handlers.test.mjs` — add one new `it(...)` block inside the existing `describe('getHandler', ...)`:

```js
  it('returns hcom handler for hcom type', () => {
    const handler = getHandler('hcom');
    assert.equal(typeof handler, 'function');
  });
```

Place it immediately after the existing `'returns command handler for command type'` block.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm
node --test tests/handlers.test.mjs
```

Expected: FAIL — `Unknown handler type: "hcom"`.

- [ ] **Step 3: Register hcom in the registry**

Edit `skills/auto-brainstorm/scripts/handlers/index.mjs` — replace the entire file with:

```js
import { handleSdk } from './sdk.mjs';
import { handleWebhook } from './webhook.mjs';
import { handleCommand } from './command.mjs';
import { handleHcom } from './hcom.mjs';

const handlers = {
  sdk: handleSdk,
  webhook: handleWebhook,
  command: handleCommand,
  hcom: handleHcom,
};

export function getHandler(type) {
  const handler = handlers[type];
  if (!handler) throw new Error(`Unknown handler type: "${type}"`);
  return handler;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm
node --test tests/handlers.test.mjs
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/quydoan/Projects/ai-agents/myskills
git add skills/auto-brainstorm/scripts/handlers/index.mjs \
        skills/auto-brainstorm/tests/handlers.test.mjs
git commit -m "feat(auto-brainstorm): register hcom handler in registry"
```

---

## Task 4: Fix hook response — emit `hookSpecificOutput` JSON, exit 0

The core fix. Replace the stderr+exit-2 "answer" branch with stdout JSON + exit 0. Keep the escalate branch stderr-only (still exit 0 — existing bug: currently exits 0 but with a different code path that's fine).

**Files:**

- Modify: `skills/auto-brainstorm/scripts/auto-answer.mjs`
- Modify: `skills/auto-brainstorm/tests/auto-answer.test.mjs`

**Important:** the existing `orchestrate()` function returns `{ action, answer, agent, reason }` and is what's currently covered by tests. We'll keep that function's contract identical so existing tests don't break. Only the CLI entrypoint block (lines 157–201 in the current file) changes.

- [ ] **Step 1: Add a new test exercising the CLI entrypoint's stdout**

Two edits to `skills/auto-brainstorm/tests/auto-answer.test.mjs`:

**1a.** Add one new import at the **top** of the file, with the existing imports:

```js
import { spawnSync } from 'node:child_process';
```

**1b.** Append a new `describe` block at the end of the file, after the existing `describe('orchestrate', ...)` block:

```js
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
```

*Note:* we don't yet test the "answer" branch end-to-end because that requires stubbing the classifier and handler across process boundaries. We'll cover the answer branch via the integration test in Task 7.

- [ ] **Step 2: Run the new test — expect the escalate behaviour to match the current file already (both write stderr + exit 0 today)**

Run:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm
node --test tests/auto-answer.test.mjs
```

Expected: all tests pass (the escalate path already exits 0 today).

- [ ] **Step 3: Replace the CLI entrypoint block in `auto-answer.mjs`**

Edit `skills/auto-brainstorm/scripts/auto-answer.mjs`. Add the import near the top, next to the existing imports:

```js
import { buildAnswersMap } from './answer-mapper.mjs';
```

Then replace the entire block starting at `// CLI entry point — runs when invoked by hook` (line 157 in the current file) through end-of-file with:

```js
// CLI entry point — runs when invoked by hook
const isMain = process.argv[1] === new URL(import.meta.url).pathname;

if (isMain && process.stdin.isTTY === undefined) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0); // unparseable payload: let tool run normally
  }

  // AskUserQuestion payload shape: tool_input.questions = [{question, options, ...}]
  // Older/alternate shapes fall back to tool_input.question / tool_input.text as a string.
  const questions = payload?.tool_input?.questions;
  const questionText = Array.isArray(questions) && questions.length > 0
    ? questions.map((q) => q.question).join('\n---\n')
    : (payload?.tool_input?.question || payload?.tool_input?.text || '');

  if (!questionText) {
    process.exit(0);
  }

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
    || path.resolve(new URL('.', import.meta.url).pathname, '..');
  const projectDir = resolveProjectDir();
  const configPath = path.join(projectDir, '.claude', 'auto-brainstorm.yml');
  const sessionPid = process.env.CLAUDE_SESSION_ID
    || process.ppid?.toString()
    || process.pid.toString();

  let result;
  try {
    result = await orchestrate({
      question: questionText,
      configPath,
      pluginRoot,
      sessionPid,
    });
  } catch (err) {
    // Defensive: never make things worse than vanilla. Let tool run.
    process.stderr.write(`auto-brainstorm unexpected error: ${err.message}\n`);
    process.exit(0);
  }

  if (result.action === 'answer' && Array.isArray(questions) && questions.length > 0) {
    const { answers, unmatched } = buildAnswersMap(questions, result.answer);

    if (unmatched.length > 0) {
      process.stderr.write(
        `auto-brainstorm: could not map answer for: ${unmatched.join(', ')}\n`
      );
      // Let the tool run — user answers directly.
      process.exit(0);
    }

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { questions, answers },
      },
    }));
    process.exit(0);
  }

  if (result.action === 'answer') {
    // Non-AskUserQuestion shape (legacy text): we can't synthesize a typed tool result
    // reliably, so escalate cleanly.
    process.stderr.write(
      `auto-brainstorm: ${result.agent} suggested: ${result.answer}\n` +
      `Tool call will run normally.\n`
    );
    process.exit(0);
  }

  // escalate
  if (result.reason) process.stderr.write(result.reason);
  process.exit(0);
}
```

- [ ] **Step 4: Run the full test suite — everything still passes**

Run:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm
node --test tests/
```

Expected: all tests pass (auto-answer, classifier, config, handlers, state, answer-mapper, handlers/hcom).

- [ ] **Step 5: Commit**

```bash
cd /Users/quydoan/Projects/ai-agents/myskills
git add skills/auto-brainstorm/scripts/auto-answer.mjs \
        skills/auto-brainstorm/tests/auto-answer.test.mjs
git commit -m "fix(auto-brainstorm): emit hookSpecificOutput JSON so auto-answers are treated as tool success"
```

---

## Task 5: Persona prompts for Gemini

**Files:**

- Create: `skills/auto-brainstorm/prompts/gemini-user.md`
- Create: `skills/auto-brainstorm/prompts/gemini-critic.md`
- Create: `skills/auto-brainstorm/prompts/gemini-spec-reviewer.md`

No tests — these are prompt content consumed by Gemini.

- [ ] **Step 1: Create `gemini-user.md`**

Create `skills/auto-brainstorm/prompts/gemini-user.md` with the full content:

```markdown
You are acting as the user who is brainstorming this project with Claude.

Your job: answer clarifying questions as the user would. You are represented by
the DESIGN BRIEF. Stay faithful to it.

Rules:

- Use only the brief to answer. If the brief doesn't cover something, pick the
  option that best matches the brief's spirit.
- If none of the provided options fit, reply with `Other: <concise free-form answer>`.
- Do NOT invent requirements that aren't in the brief.
- Do NOT rewrite the question. Answer the question as asked.
- Prefer the simplest option that satisfies the brief. YAGNI.
- Be terse. One label, optional short explanation on the next line.

Output format (strict):

```

<LABEL>
<optional short reason, max 1 sentence>

```

Or, for free-form:

```

Other: <your short answer>

```
```

- [ ] **Step 2: Create `gemini-critic.md`**

Create `skills/auto-brainstorm/prompts/gemini-critic.md` with the full content:

```markdown
You are reviewing a proposed design, approach, or design-section during
brainstorming. You are NOT the user — you are a critical reviewer whose job is
to catch problems.

Rules:

- Pick the option most aligned with the DESIGN BRIEF.
- Name the biggest risk you see in one short sentence on the next line.
- If there is a serious flaw in every option, reply `Other: <concrete alternative>`.
- Do NOT rubber-stamp. If the options are all fine, still name the biggest risk.
- Be terse. Don't explain the options back at Claude.

Output format (strict):

```

<LABEL>
Risk: <one short sentence>

```

Or, for free-form:

```

Other: <your short concrete alternative>

```
```

- [ ] **Step 3: Create `gemini-spec-reviewer.md`**

Create `skills/auto-brainstorm/prompts/gemini-spec-reviewer.md` with the full content:

```markdown
You are reviewing a written spec section. Your job is a fast quality pass.

Check each section for:

1. Placeholders / TODOs (fail — nothing should ship with placeholders).
2. Internal contradictions (fail — sections must agree).
3. Ambiguity (fail — requirements must be interpretable one way).
4. Scope creep (fail — spec should be for a single implementation plan).

Rules:

- Pick the option that matches your honest read.
- If something is broken, reply `Other: <specific issue>`.
- Keep response terse. One label, one short reason.

Output format (strict):

```

<LABEL>
<one short reason>

```

Or, for free-form:

```

Other: <specific issue>

```
```

- [ ] **Step 4: Verify files exist**

Run:

```bash
ls -la /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm/prompts/gemini-*.md
```

Expected: three files listed.

- [ ] **Step 5: Commit**

```bash
cd /Users/quydoan/Projects/ai-agents/myskills
git add skills/auto-brainstorm/prompts/gemini-user.md \
        skills/auto-brainstorm/prompts/gemini-critic.md \
        skills/auto-brainstorm/prompts/gemini-spec-reviewer.md
git commit -m "feat(auto-brainstorm): add Gemini persona prompts"
```

---

## Task 6: Update `config/default.yml` to wire Gemini personas via hcom

**Files:**

- Modify: `skills/auto-brainstorm/config/default.yml`

- [ ] **Step 1: Replace the entire contents of `default.yml`**

Write `skills/auto-brainstorm/config/default.yml`:

```yaml
# Auto-Brainstorm Agent Configuration
# Copy to .claude/auto-brainstorm.yml to customize

classifier:
  model: haiku
  confidence_threshold: 0.7
  max_consecutive_rejections: 3

session:
  brief_path: .claude/auto-brainstorm-brief.md
  state_dir: /tmp
  cleanup_on_end: true

# hcom-backed agents send/receive via hcom CLI. Requires `hcom <tool> --name <target>`
# to be running before the brainstorming session starts.
hcom:
  target: gemini
  timeout_ms: 60000

agents:
  answerer:
    description: >
      Answers clarifying questions about user intent, goals,
      constraints, and preferences. Active during early
      brainstorming exploration.
    order: 1
    handler: hcom
    persona: user-stand-in
    prompt: prompts/gemini-user.md

  design-critic:
    description: >
      Evaluates design approaches, trade-offs, and architecture
      decisions. Approves or critiques design sections. Active
      after clarifying questions, before spec is written.
    order: 2
    handler: hcom
    persona: critic
    prompt: prompts/gemini-critic.md

  spec-reviewer:
    description: >
      Validates written spec for completeness, consistency,
      clarity, and scope. Active after spec document is written.
    order: 3
    handler: hcom
    persona: spec-reviewer
    prompt: prompts/gemini-spec-reviewer.md

handler_defaults:
  sdk:
    max_turns: 1
  webhook:
    method: POST
    timeout: 30000
    headers:
      Content-Type: application/json
  command:
    timeout: 10000
  hcom:
    timeout_ms: 60000
```

- [ ] **Step 2: Verify config parses**

Run:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm
node -e "import('yaml').then(({default: YAML}) => { const fs = require('fs'); const cfg = YAML.parse(fs.readFileSync('config/default.yml','utf8')); console.log(JSON.stringify(cfg.agents, null, 2)); })"
```

Expected: prints all three agents with `handler: hcom` and persona fields.

- [ ] **Step 3: Run the full test suite to make sure config tests still pass**

Run:

```bash
node --test tests/
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/quydoan/Projects/ai-agents/myskills
git add skills/auto-brainstorm/config/default.yml
git commit -m "feat(auto-brainstorm): switch default agents to hcom/Gemini personas"
```

---

## Task 7: Integration test — end-to-end hook shape

Verify that when the orchestrator returns an answer, the CLI entrypoint emits JSON matching Claude Code's documented `hookSpecificOutput` schema for `PreToolUse`.

This test stubs the handler via an injected command handler, which lets us avoid actually calling Claude SDK / hcom.

**Files:**

- Create: `skills/auto-brainstorm/tests/integration/hook-shape.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `skills/auto-brainstorm/tests/integration/hook-shape.test.mjs`:

```js
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
    const configPath = path.join(tmpDir, 'config.yml');
    const promptsDir = path.join(tmpDir, 'prompts');
    fs.mkdirSync(promptsDir);

    // "classifier" prompt file (contents ignored because we stub its output via a shim below).
    fs.writeFileSync(path.join(promptsDir, 'classifier.md'), 'classifier');
    fs.writeFileSync(path.join(promptsDir, 'answerer.md'), 'answerer');
    fs.writeFileSync(briefPath, '## Intent\nTest\n');

    // The `command` handler runs an arbitrary shell command and returns its stdout.
    // We use a tiny shell command to emit the pre-canned answer.
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

    // Stub classifier via env var (auto-answer.mjs → classifier.mjs reads AUTO_BRAINSTORM_TEST_CLASSIFIER).
    // See Task 7 Step 2 for where we add this hook.
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
```

- [ ] **Step 2: Add the classifier stub env var hook**

The test above uses `AUTO_BRAINSTORM_TEST_CLASSIFIER`. Wire it into `classifier.mjs`.

Read the current file:

Run:

```bash
cat /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm/scripts/classifier.mjs
```

Near the top of the exported `classify()` function (immediately after any argument destructuring and before the network call to Haiku), add:

```js
  if (process.env.AUTO_BRAINSTORM_TEST_CLASSIFIER) {
    try { return JSON.parse(process.env.AUTO_BRAINSTORM_TEST_CLASSIFIER); }
    catch { /* fall through to real classifier */ }
  }
```

This short-circuits the classifier in tests only; when the env var is unset, behaviour is unchanged.

- [ ] **Step 3: Run the integration test**

Run:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm
node --test tests/integration/hook-shape.test.mjs
```

Expected: the single integration test passes, asserting that `stdout` is the exact JSON envelope Claude Code consumes.

- [ ] **Step 4: Run the full suite**

Run:

```bash
node --test tests/
```

Expected: all tests green, including the new integration test.

- [ ] **Step 5: Commit**

```bash
cd /Users/quydoan/Projects/ai-agents/myskills
git add skills/auto-brainstorm/tests/integration/hook-shape.test.mjs \
        skills/auto-brainstorm/scripts/classifier.mjs
git commit -m "test(auto-brainstorm): integration test for hookSpecificOutput JSON shape"
```

---

## Task 8: Update `SKILL.md` with hcom prerequisite

**Files:**

- Modify: `skills/auto-brainstorm/SKILL.md`

- [ ] **Step 1: Read the current SKILL.md to find the right place**

Run:

```bash
cat /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm/SKILL.md
```

Expected sections: `Before You Start`, `How It Works`, `Configuration`, `Token Cost`.

- [ ] **Step 2: Add an hcom prereq note right before "Before You Start"**

Using an `Edit` operation on `SKILL.md`, insert this block **immediately after** the line `## Before You Start`:

Replace:

```markdown
## Before You Start

**Collect a design brief** from the user before brainstorming begins.
```

With:

```markdown
## Before You Start

### Prerequisite: start Gemini on hcom

The default configuration routes all brainstorming questions to Gemini via
[hcom](https://github.com/hcom-dev/hcom). Before starting:

```bash
hcom gemini --name gemini
```

Leave that terminal running. The plugin checks on the first question and
escalates to you if `gemini` is not running. To use Claude SDK (Opus/Sonnet)
instead, edit `.claude/auto-brainstorm.yml` and change each `handler: hcom`
to `handler: sdk` (see Configuration).

**Collect a design brief** from the user before brainstorming begins.
```

- [ ] **Step 3: Verify the file**

Run:

```bash
grep -n "hcom gemini" /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm/SKILL.md
```

Expected: at least one hit showing the new prereq line.

- [ ] **Step 4: Commit**

```bash
cd /Users/quydoan/Projects/ai-agents/myskills
git add skills/auto-brainstorm/SKILL.md
git commit -m "docs(auto-brainstorm): document hcom Gemini prereq in SKILL.md"
```

---

## Task 9: Update `README.md` to document the hcom handler

**Files:**

- Modify: `skills/auto-brainstorm/README.md`

- [ ] **Step 1: Update the Default Agents table**

Using `Edit`, replace the existing Default Agents block in `skills/auto-brainstorm/README.md`:

Replace:

```markdown
## Default Agents

| Agent | Model | Role |
|-------|-------|------|
| **answerer** | Opus | Clarifying questions — goals, constraints, preferences |
| **design-critic** | Sonnet | Design approaches, trade-offs, section approval |
| **spec-reviewer** | Haiku | Spec completeness, consistency, clarity |

A Haiku-based **classifier** routes each question to the right agent based on context and session history.
```

With:

```markdown
## Default Agents

| Agent | Backend | Persona | Role |
|-------|---------|---------|------|
| **answerer** | hcom → Gemini | user-stand-in | Clarifying questions — goals, constraints, preferences |
| **design-critic** | hcom → Gemini | critic | Design approaches, trade-offs, section approval |
| **spec-reviewer** | hcom → Gemini | spec-reviewer | Spec completeness, consistency, clarity |

A Haiku-based **classifier** routes each question to the right agent based on context and session history. All three roles are served by a single long-lived Gemini agent over [hcom](https://github.com/hcom-dev/hcom); persona is tagged per message. To fall back to local Claude SDK, switch `handler: hcom` → `handler: sdk` in `.claude/auto-brainstorm.yml`.
```

- [ ] **Step 2: Add an "Using hcom" subsection under "Configuration"**

Using `Edit`, insert this block immediately **before** the line `### Adding a New Agent`:

```markdown
### Using hcom (multi-agent via Gemini)

The default backend. Start a Gemini instance on hcom in a separate terminal before running brainstorming:

```bash
hcom gemini --name gemini
```

Config options:

```yaml
hcom:
  target: gemini        # hcom agent name
  timeout_ms: 60000     # listen timeout per question

agents:
  answerer:
    handler: hcom
    persona: user-stand-in
    prompt: prompts/gemini-user.md
```

The `persona` field selects which prompt file is loaded; the handler sends an envelope with the persona prompt, the design brief, and the question over hcom, then blocks on a reply up to `timeout_ms`.

```

- [ ] **Step 3: Update the Handler Types table**

Using `Edit`, replace the existing Handler Types block:

Replace:

```markdown
## Handler Types

| Handler | Use When | How It Works |
|---------|----------|--------------|
| `sdk` | AI agent answering | Calls Claude Code SDK `query()`, inherits your auth |
| `webhook` | External service (n8n, Make, custom API) | POSTs `{question, brief}` to a URL |
| `command` | Local script | Runs a shell command, reads stdout |
```

With:

```markdown
## Handler Types

| Handler | Use When | How It Works |
|---------|----------|--------------|
| `hcom` | Multi-agent via Gemini (default) | Shells out to `hcom send` / `hcom listen` against a pre-launched target |
| `sdk` | AI agent answering via Claude SDK | Calls Claude Code SDK `query()`, inherits your auth |
| `webhook` | External service (n8n, Make, custom API) | POSTs `{question, brief}` to a URL |
| `command` | Local script | Runs a shell command, reads stdout |
```

- [ ] **Step 4: Verify file parses as valid markdown (smoke check)**

Run:

```bash
wc -l /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm/README.md
grep -n "hcom" /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm/README.md | head -10
```

Expected: grep shows multiple hits in the new sections.

- [ ] **Step 5: Commit**

```bash
cd /Users/quydoan/Projects/ai-agents/myskills
git add skills/auto-brainstorm/README.md
git commit -m "docs(auto-brainstorm): document hcom handler and default Gemini personas"
```

---

## Task 10: Manual smoke-test checklist

**Files:**

- Create: `skills/auto-brainstorm/tests/MANUAL.md`

- [ ] **Step 1: Create the manual test checklist**

Create `skills/auto-brainstorm/tests/MANUAL.md`:

```markdown
# Manual Smoke Tests

These tests require a running Gemini over hcom and real interaction with Claude Code. Run after any change that touches the hook response shape or the hcom handler.

## Prerequisites

- `hcom` CLI installed and on `PATH`
- Claude Code + superpowers installed with the auto-brainstorm plugin enabled
- Gemini credentials configured for hcom

## Smoke test 1 — happy path

1. In one terminal: `hcom gemini --name gemini`
2. In your repo, create `.claude/auto-brainstorm-brief.md` with a short brief.
3. Start a Claude Code session and invoke `/brainstorm <topic>`.
4. Observe that each clarifying question is answered **without appearing as a prompt in your terminal** — Claude moves to the next step smoothly.
5. When the spec is written, verify the final review gate **does** prompt you (this is intentional).

**Pass criteria:** session completes, spec file is written, you were asked exactly once at the end.

## Smoke test 2 — missing gemini escalates cleanly

1. Ensure `hcom gemini` is NOT running.
2. Provide a brief and start brainstorming.
3. First question: the plugin should escalate with a message like `Target "gemini" is not running. Start it with: hcom gemini --name gemini`.
4. Start gemini in another terminal.
5. Answer that one question yourself; subsequent questions should now auto-answer normally.

**Pass criteria:** no stuck session, no silent failure.

## Smoke test 3 — kill gemini mid-session

1. Start brainstorming with gemini running.
2. Partway through (e.g., after 2-3 questions), kill the gemini pane.
3. Next question should escalate with the "not running" message.
4. Restart gemini; subsequent questions resume auto-answering.

**Pass criteria:** graceful degradation, no lost work.

## Smoke test 4 — free-form ("Other") answers

1. Start brainstorming with a brief that doesn't cleanly match any offered multi-choice option for a specific question.
2. Verify Gemini replies with `Other: <free-form>` and that the answer is passed through.
3. Verify Claude continues the next step instead of re-asking the same question.

**Pass criteria:** Other answers survive round-trip.

## Smoke test 5 — fallback to sdk handler

1. Edit `.claude/auto-brainstorm.yml` → set all `handler: hcom` to `handler: sdk`.
2. Run brainstorming without gemini.
3. Verify questions are still auto-answered (via Claude SDK).

**Pass criteria:** the plugin remains usable without hcom.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/quydoan/Projects/ai-agents/myskills
git add skills/auto-brainstorm/tests/MANUAL.md
git commit -m "docs(auto-brainstorm): add manual smoke-test checklist"
```

---

## Task 11: Final verification

- [ ] **Step 1: Run the full test suite**

Run:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills/skills/auto-brainstorm
node --test tests/
```

Expected: every test green. Capture the test count before/after to confirm the new tests ran.

- [ ] **Step 2: Validate skills via the project validator**

Run:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills
npm run validate
```

Expected: PASS on `auto-brainstorm`.

- [ ] **Step 3: Walk through the Manual smoke tests from Task 10**

Execute Smoke Test 1 at minimum. Only claim success after observing a real brainstorming session answer a question through Gemini without prompting the user.

- [ ] **Step 4: Document what was verified**

Leave a final git commit annotation referring back to this plan and the spec:

```bash
cd /Users/quydoan/Projects/ai-agents/myskills
git log --oneline | head -15
```

Expected: a clean commit trail matching the tasks above.

---

## Summary

| Task | Files touched | Commit |
| --- | --- | --- |
| 0 | — | baseline |
| 1 | `scripts/answer-mapper.mjs`, test | `feat(...)` |
| 2 | `scripts/handlers/hcom.mjs`, test | `feat(...)` |
| 3 | `scripts/handlers/index.mjs`, test | `feat(...)` |
| 4 | `scripts/auto-answer.mjs`, test | `fix(...)` |
| 5 | 3 prompt files | `feat(...)` |
| 6 | `config/default.yml` | `feat(...)` |
| 7 | integration test + classifier stub | `test(...)` |
| 8 | `SKILL.md` | `docs(...)` |
| 9 | `README.md` | `docs(...)` |
| 10 | `tests/MANUAL.md` | `docs(...)` |
| 11 | — | verification |

All changes are additive or back-compat: switching `handler: hcom` → `handler: sdk` restores previous behaviour on a per-agent basis.
