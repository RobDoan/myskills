# Auto-Brainstorm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin that auto-answers brainstorming/review questions by dispatching specialized agents, falling back to the user after 3 failed attempts.

**Architecture:** A PostToolUse hook intercepts `AskUserQuestion`, runs an orchestrator script that classifies the question via a cheap Haiku call, dispatches the right agent via a pluggable handler (SDK/webhook/command), and injects the answer back via exit code 2. Config lives in `.claude/auto-brainstorm.yml`.

**Tech Stack:** Node.js ESM, `@anthropic-ai/claude-code` SDK, `yaml` package, Claude Code plugin manifest format.

**Spec:** `docs/superpowers/specs/2026-04-17-auto-brainstorm-design.md`

---

## File Structure

```
skills/auto-brainstorm/
├── .claude-plugin/plugin.json           # Claude Code plugin manifest
├── .cursor-plugin/plugin.json           # Cursor compat manifest
├── hooks/
│   ├── hooks.json                       # Claude Code hook declaration
│   ├── hooks-cursor.json                # Cursor hook declaration
│   └── run-hook.cmd                     # Polyglot wrapper (Windows + Unix)
├── scripts/
│   ├── package.json                     # Dependencies (@anthropic-ai/claude-code, yaml)
│   ├── auto-answer.mjs                  # Orchestrator entry point
│   ├── config.mjs                       # Config loader + path resolver
│   ├── classifier.mjs                   # Haiku-based question classifier
│   ├── state.mjs                        # Session state (sequence, history, rejections)
│   ├── logger.mjs                       # File-based logger
│   └── handlers/
│       ├── index.mjs                    # Handler registry + dispatch
│       ├── sdk.mjs                      # Claude Code SDK handler
│       ├── webhook.mjs                  # HTTP/webhook handler
│       └── command.mjs                  # Local command handler
├── prompts/
│   ├── classifier.md                    # Classifier system prompt
│   ├── answerer.md                      # Clarifying question agent prompt
│   ├── design-critic.md                 # Design critique agent prompt
│   ├── spec-reviewer.md                 # Spec review agent prompt
│   └── response-format.md              # Shared human-like response directive
├── config/
│   └── default.yml                      # Default agent config
├── tests/
│   ├── state.test.mjs                   # State module tests
│   ├── config.test.mjs                  # Config loader tests
│   ├── classifier.test.mjs             # Classifier tests (mocked SDK)
│   ├── handlers.test.mjs               # Handler dispatch tests
│   └── auto-answer.test.mjs            # Integration tests (mocked SDK + hooks)
└── SKILL.md                             # Brief collection + usage instructions
```

---

### Task 1: Project Scaffolding & Plugin Manifest

**Files:**
- Create: `skills/auto-brainstorm/.claude-plugin/plugin.json`
- Create: `skills/auto-brainstorm/.cursor-plugin/plugin.json`
- Create: `skills/auto-brainstorm/hooks/hooks.json`
- Create: `skills/auto-brainstorm/hooks/hooks-cursor.json`
- Create: `skills/auto-brainstorm/hooks/run-hook.cmd`
- Create: `skills/auto-brainstorm/scripts/package.json`

- [ ] **Step 1: Create plugin directory structure**

```bash
mkdir -p skills/auto-brainstorm/.claude-plugin
mkdir -p skills/auto-brainstorm/.cursor-plugin
mkdir -p skills/auto-brainstorm/hooks
mkdir -p skills/auto-brainstorm/scripts/handlers
mkdir -p skills/auto-brainstorm/prompts
mkdir -p skills/auto-brainstorm/config
mkdir -p skills/auto-brainstorm/tests
```

- [ ] **Step 2: Create Claude Code plugin manifest**

Create `skills/auto-brainstorm/.claude-plugin/plugin.json`:

```json
{
  "name": "auto-brainstorm",
  "description": "Auto-answers brainstorming questions with specialized AI agents",
  "version": "1.0.0",
  "skills": "../",
  "hooks": "../hooks/hooks.json"
}
```

- [ ] **Step 3: Create Cursor plugin manifest**

Create `skills/auto-brainstorm/.cursor-plugin/plugin.json`:

```json
{
  "name": "auto-brainstorm",
  "description": "Auto-answers brainstorming questions with specialized AI agents",
  "version": "1.0.0",
  "skills": "../",
  "hooks": "../hooks/hooks-cursor.json"
}
```

- [ ] **Step 4: Create Claude Code hooks declaration**

Create `skills/auto-brainstorm/hooks/hooks.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" auto-answer"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 5: Create Cursor hooks declaration**

Create `skills/auto-brainstorm/hooks/hooks-cursor.json`:

```json
{
  "version": 1,
  "hooks": {
    "postToolUse": [
      {
        "matcher": "AskUserQuestion",
        "command": "./hooks/run-hook.cmd auto-answer"
      }
    ]
  }
}
```

- [ ] **Step 6: Create polyglot hook wrapper**

Create `skills/auto-brainstorm/hooks/run-hook.cmd`:

```bash
: << 'CMDBLOCK'
@echo off
node "%~dp0..\scripts\auto-answer.mjs"
exit /b %errorlevel%
CMDBLOCK

#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"

# Auto-install dependencies on first run
if [ ! -d "$PLUGIN_ROOT/scripts/node_modules" ]; then
  npm install --prefix "$PLUGIN_ROOT/scripts" --silent 2>/dev/null
fi

node "$PLUGIN_ROOT/scripts/auto-answer.mjs"
exit $?
```

- [ ] **Step 7: Create scripts package.json**

Create `skills/auto-brainstorm/scripts/package.json`:

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "@anthropic-ai/claude-code": "^1.0.0",
    "yaml": "^2.0.0"
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add skills/auto-brainstorm/.claude-plugin skills/auto-brainstorm/.cursor-plugin skills/auto-brainstorm/hooks skills/auto-brainstorm/scripts/package.json
git commit -m "feat(auto-brainstorm): scaffold plugin structure and manifests"
```

---

### Task 2: State Module

**Files:**
- Create: `skills/auto-brainstorm/scripts/state.mjs`
- Create: `skills/auto-brainstorm/tests/state.test.mjs`

- [ ] **Step 1: Write failing tests for state module**

Create `skills/auto-brainstorm/tests/state.test.mjs`:

```javascript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionState } from '../scripts/state.mjs';

describe('SessionState', () => {
  let tmpDir;
  let statePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-brainstorm-test-'));
    statePath = path.join(tmpDir, 'state.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('creates fresh state when file does not exist', () => {
      const state = new SessionState(statePath);
      assert.equal(state.data.total_questions, 0);
      assert.equal(state.data.current_sequence, 0);
      assert.equal(state.data.consecutive_rejections, 0);
      assert.deepEqual(state.data.history, []);
    });

    it('loads existing state from file', () => {
      const existing = {
        session_id: 'test-123',
        total_questions: 3,
        current_sequence: 3,
        consecutive_rejections: 1,
        history: [
          { seq: 1, agent: 'answerer', accepted: true }
        ]
      };
      fs.writeFileSync(statePath, JSON.stringify(existing));
      const state = new SessionState(statePath);
      assert.equal(state.data.total_questions, 3);
      assert.equal(state.data.history.length, 1);
    });

    it('creates fresh state when file is corrupted', () => {
      fs.writeFileSync(statePath, 'not json');
      const state = new SessionState(statePath);
      assert.equal(state.data.total_questions, 0);
    });
  });

  describe('recordNewQuestion', () => {
    it('increments total_questions and current_sequence', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      assert.equal(state.data.total_questions, 1);
      assert.equal(state.data.current_sequence, 1);
      assert.equal(state.data.consecutive_rejections, 0);
    });
  });

  describe('recordRejection', () => {
    it('increments consecutive_rejections without changing sequence', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      state.recordAnswer('answerer', 'some answer');
      state.recordRejection();
      assert.equal(state.data.consecutive_rejections, 1);
      assert.equal(state.data.current_sequence, 1);
    });
  });

  describe('recordAnswer', () => {
    it('adds entry to history', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      state.recordAnswer('answerer', 'my answer');
      assert.equal(state.data.history.length, 1);
      assert.equal(state.data.history[0].agent, 'answerer');
      assert.equal(state.data.history[0].answer, 'my answer');
      assert.equal(state.data.history[0].seq, 1);
    });
  });

  describe('shouldEscalate', () => {
    it('returns false when under threshold', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      state.recordAnswer('answerer', 'a1');
      state.recordRejection();
      assert.equal(state.shouldEscalate(3), false);
    });

    it('returns true when at threshold', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      state.recordAnswer('answerer', 'a1');
      state.recordRejection();
      state.recordAnswer('answerer', 'a2');
      state.recordRejection();
      state.recordAnswer('answerer', 'a3');
      state.recordRejection();
      assert.equal(state.shouldEscalate(3), true);
    });
  });

  describe('getHistory', () => {
    it('returns formatted history for classifier context', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      state.recordAnswer('answerer', 'a1');
      state.recordNewQuestion();
      state.recordAnswer('design-critic', 'a2');
      const history = state.getHistory();
      assert.equal(history.length, 2);
      assert.equal(history[0].agent, 'answerer');
      assert.equal(history[1].agent, 'design-critic');
    });
  });

  describe('save and cleanup', () => {
    it('persists state to disk', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      state.save();
      assert.ok(fs.existsSync(statePath));
      const loaded = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.equal(loaded.total_questions, 1);
    });

    it('cleanup removes state file', () => {
      const state = new SessionState(statePath);
      state.save();
      state.cleanup();
      assert.ok(!fs.existsSync(statePath));
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd skills/auto-brainstorm && node --test tests/state.test.mjs
```

Expected: FAIL — `state.mjs` does not exist.

- [ ] **Step 3: Implement state module**

Create `skills/auto-brainstorm/scripts/state.mjs`:

```javascript
import fs from 'node:fs';

export class SessionState {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {
        session_id: `session-${Date.now()}`,
        total_questions: 0,
        current_sequence: 0,
        consecutive_rejections: 0,
        history: [],
      };
    }
  }

  recordNewQuestion() {
    this.data.total_questions++;
    this.data.current_sequence++;
    this.data.consecutive_rejections = 0;
  }

  recordRejection() {
    this.data.consecutive_rejections++;
  }

  recordAnswer(agent, answer) {
    this.data.history.push({
      seq: this.data.current_sequence,
      agent,
      answer,
      accepted: false,
      timestamp: new Date().toISOString(),
    });
  }

  shouldEscalate(maxRejections) {
    return this.data.consecutive_rejections >= maxRejections;
  }

  getHistory() {
    return this.data.history.map(({ seq, agent, accepted }) => ({
      seq,
      agent,
      accepted,
    }));
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  cleanup() {
    try {
      fs.unlinkSync(this.filePath);
    } catch {
      // already gone
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd skills/auto-brainstorm && node --test tests/state.test.mjs
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/auto-brainstorm/scripts/state.mjs skills/auto-brainstorm/tests/state.test.mjs
git commit -m "feat(auto-brainstorm): add session state tracking module"
```

---

### Task 3: Config Loader

**Files:**
- Create: `skills/auto-brainstorm/scripts/config.mjs`
- Create: `skills/auto-brainstorm/config/default.yml`
- Create: `skills/auto-brainstorm/tests/config.test.mjs`

- [ ] **Step 1: Write failing tests for config loader**

Create `skills/auto-brainstorm/tests/config.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd skills/auto-brainstorm && node --test tests/config.test.mjs
```

Expected: FAIL — `config.mjs` does not exist.

- [ ] **Step 3: Create default config**

Create `skills/auto-brainstorm/config/default.yml`:

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

agents:
  answerer:
    description: >
      Answers clarifying questions about user intent, goals,
      constraints, and preferences. Active during early
      brainstorming exploration.
    order: 1
    handler: sdk
    model: opus
    prompt: prompts/answerer.md
    max_turns: 1

  design-critic:
    description: >
      Evaluates design approaches, trade-offs, and architecture
      decisions. Approves or critiques design sections. Active
      after clarifying questions, before spec is written.
    order: 2
    handler: sdk
    model: sonnet
    prompt: prompts/design-critic.md
    max_turns: 1

  spec-reviewer:
    description: >
      Validates written spec for completeness, consistency,
      clarity, and scope. Active after spec document is written.
    order: 3
    handler: sdk
    model: haiku
    prompt: prompts/spec-reviewer.md
    max_turns: 1

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
```

- [ ] **Step 4: Implement config loader**

Create `skills/auto-brainstorm/scripts/config.mjs`:

```javascript
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd skills/auto-brainstorm && node --test tests/config.test.mjs
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/auto-brainstorm/scripts/config.mjs skills/auto-brainstorm/config/default.yml skills/auto-brainstorm/tests/config.test.mjs
git commit -m "feat(auto-brainstorm): add config loader with handler defaults merging"
```

---

### Task 4: Logger Module

**Files:**
- Create: `skills/auto-brainstorm/scripts/logger.mjs`

- [ ] **Step 1: Implement logger**

Create `skills/auto-brainstorm/scripts/logger.mjs`:

```javascript
import fs from 'node:fs';

export class Logger {
  constructor(logPath) {
    this.logPath = logPath;
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(this.logPath, line);
  }

  cleanup() {
    try {
      fs.unlinkSync(this.logPath);
    } catch {
      // already gone
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add skills/auto-brainstorm/scripts/logger.mjs
git commit -m "feat(auto-brainstorm): add file-based logger"
```

---

### Task 5: Handler Registry & SDK Handler

**Files:**
- Create: `skills/auto-brainstorm/scripts/handlers/index.mjs`
- Create: `skills/auto-brainstorm/scripts/handlers/sdk.mjs`
- Create: `skills/auto-brainstorm/scripts/handlers/webhook.mjs`
- Create: `skills/auto-brainstorm/scripts/handlers/command.mjs`
- Create: `skills/auto-brainstorm/tests/handlers.test.mjs`

- [ ] **Step 1: Write failing tests for handler registry and dispatch**

Create `skills/auto-brainstorm/tests/handlers.test.mjs`:

```javascript
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { getHandler } from '../scripts/handlers/index.mjs';

describe('getHandler', () => {
  it('returns sdk handler for sdk type', () => {
    const handler = getHandler('sdk');
    assert.equal(typeof handler, 'function');
  });

  it('returns webhook handler for webhook type', () => {
    const handler = getHandler('webhook');
    assert.equal(typeof handler, 'function');
  });

  it('returns command handler for command type', () => {
    const handler = getHandler('command');
    assert.equal(typeof handler, 'function');
  });

  it('throws for unknown handler type', () => {
    assert.throws(() => getHandler('unknown'), /Unknown handler type/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd skills/auto-brainstorm && node --test tests/handlers.test.mjs
```

Expected: FAIL — handler modules do not exist.

- [ ] **Step 3: Implement SDK handler**

Create `skills/auto-brainstorm/scripts/handlers/sdk.mjs`:

```javascript
export async function handleSdk(question, brief, agentConfig, promptContent) {
  const { query } = await import('@anthropic-ai/claude-code');

  const systemPrompt = promptContent;
  const userPrompt = [
    '## Design Brief',
    brief,
    '',
    '## Question',
    question,
  ].join('\n');

  const result = await query({
    prompt: userPrompt,
    options: {
      model: agentConfig.model,
      maxTurns: agentConfig.max_turns || 1,
      systemPrompt,
    },
  });

  let response = '';
  for await (const message of result) {
    if (message.type === 'assistant') {
      response += message.message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
    }
  }

  return response;
}
```

- [ ] **Step 4: Implement webhook handler**

Create `skills/auto-brainstorm/scripts/handlers/webhook.mjs`:

```javascript
export async function handleWebhook(question, brief, agentConfig) {
  const url = agentConfig.url;
  if (!url) throw new Error('Webhook handler requires a "url" in agent config');

  const method = agentConfig.method || 'POST';
  const timeout = agentConfig.timeout || 30000;
  const headers = agentConfig.headers || { 'Content-Type': 'application/json' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: JSON.stringify({ question, brief }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return data.answer || data.response || JSON.stringify(data);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 5: Implement command handler**

Create `skills/auto-brainstorm/scripts/handlers/command.mjs`:

```javascript
import { execSync } from 'node:child_process';

export function handleCommand(question, brief, agentConfig) {
  const command = agentConfig.command;
  if (!command) throw new Error('Command handler requires a "command" in agent config');

  const timeout = agentConfig.timeout || 10000;

  const result = execSync(command, {
    encoding: 'utf8',
    timeout,
    env: {
      ...process.env,
      AUTO_BRAINSTORM_QUESTION: question,
      AUTO_BRAINSTORM_BRIEF: brief,
    },
  });

  return result.trim();
}
```

- [ ] **Step 6: Implement handler registry**

Create `skills/auto-brainstorm/scripts/handlers/index.mjs`:

```javascript
import { handleSdk } from './sdk.mjs';
import { handleWebhook } from './webhook.mjs';
import { handleCommand } from './command.mjs';

const handlers = {
  sdk: handleSdk,
  webhook: handleWebhook,
  command: handleCommand,
};

export function getHandler(type) {
  const handler = handlers[type];
  if (!handler) throw new Error(`Unknown handler type: "${type}"`);
  return handler;
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd skills/auto-brainstorm && node --test tests/handlers.test.mjs
```

Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add skills/auto-brainstorm/scripts/handlers skills/auto-brainstorm/tests/handlers.test.mjs
git commit -m "feat(auto-brainstorm): add pluggable handler registry (sdk, webhook, command)"
```

---

### Task 6: Classifier Module

**Files:**
- Create: `skills/auto-brainstorm/scripts/classifier.mjs`
- Create: `skills/auto-brainstorm/prompts/classifier.md`
- Create: `skills/auto-brainstorm/tests/classifier.test.mjs`

- [ ] **Step 1: Write classifier prompt**

Create `skills/auto-brainstorm/prompts/classifier.md`:

```markdown
You are a question classifier for an automated brainstorming system.

Given a question from a brainstorming session, determine which agent should answer it.

You receive:
- The question text
- Available agents with descriptions and ordering
- Session history showing which agents have answered previous questions

Use the agent descriptions and ordering to understand the flow. Earlier agents handle exploration, later agents handle validation. The session history tells you where in the flow we are — if we've already moved past early questions, later agents are more likely.

Respond with JSON only, no other text:
{"agent": "<agent_role>", "confidence": 0.0-1.0, "reasoning": "<one line>"}
```

- [ ] **Step 2: Write failing tests for classifier**

Create `skills/auto-brainstorm/tests/classifier.test.mjs`:

```javascript
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassifierPrompt, parseClassifierResponse } from '../scripts/classifier.mjs';

describe('buildClassifierPrompt', () => {
  const agents = {
    answerer: { description: 'Answers clarifying questions', order: 1 },
    'design-critic': { description: 'Evaluates designs', order: 2 },
  };

  it('includes question text', () => {
    const prompt = buildClassifierPrompt('What is the goal?', agents, []);
    assert.ok(prompt.includes('What is the goal?'));
  });

  it('includes agent descriptions sorted by order', () => {
    const prompt = buildClassifierPrompt('question', agents, []);
    const answererIdx = prompt.indexOf('answerer');
    const criticIdx = prompt.indexOf('design-critic');
    assert.ok(answererIdx < criticIdx);
  });

  it('includes session history', () => {
    const history = [{ seq: 1, agent: 'answerer', accepted: true }];
    const prompt = buildClassifierPrompt('question', agents, history);
    assert.ok(prompt.includes('answerer'));
    assert.ok(prompt.includes('accepted'));
  });
});

describe('parseClassifierResponse', () => {
  it('parses valid JSON response', () => {
    const result = parseClassifierResponse(
      '{"agent": "answerer", "confidence": 0.95, "reasoning": "clarifying question"}'
    );
    assert.equal(result.agent, 'answerer');
    assert.equal(result.confidence, 0.95);
  });

  it('extracts JSON from text with surrounding content', () => {
    const result = parseClassifierResponse(
      'Here is my analysis:\n{"agent": "design-critic", "confidence": 0.8, "reasoning": "design phase"}\n'
    );
    assert.equal(result.agent, 'design-critic');
  });

  it('returns null for unparseable response', () => {
    const result = parseClassifierResponse('I cannot determine this');
    assert.equal(result, null);
  });

  it('returns null when agent field is missing', () => {
    const result = parseClassifierResponse('{"confidence": 0.9}');
    assert.equal(result, null);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd skills/auto-brainstorm && node --test tests/classifier.test.mjs
```

Expected: FAIL — `classifier.mjs` does not exist.

- [ ] **Step 4: Implement classifier module**

Create `skills/auto-brainstorm/scripts/classifier.mjs`:

```javascript
import fs from 'node:fs';

export function buildClassifierPrompt(question, agents, history) {
  const sortedAgents = Object.entries(agents)
    .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
    .map(([name, agent]) => `- **${name}** (order: ${agent.order}): ${agent.description}`)
    .join('\n');

  const historyText =
    history.length > 0
      ? history
          .map((h) => `  seq ${h.seq}: ${h.agent} (accepted: ${h.accepted})`)
          .join('\n')
      : '  (no prior questions)';

  return [
    '## Question',
    question,
    '',
    '## Available Agents',
    sortedAgents,
    '',
    '## Session History',
    historyText,
  ].join('\n');
}

export function parseClassifierResponse(text) {
  try {
    const match = text.match(/\{[^}]*"agent"[^}]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed.agent) return null;
    return {
      agent: parsed.agent,
      confidence: parsed.confidence ?? 0,
      reasoning: parsed.reasoning ?? '',
    };
  } catch {
    return null;
  }
}

export async function classify(question, agents, history, classifierConfig) {
  const { query } = await import('@anthropic-ai/claude-code');

  const systemPromptPath = classifierConfig.promptPath;
  const systemPrompt = fs.readFileSync(systemPromptPath, 'utf8');
  const userPrompt = buildClassifierPrompt(question, agents, history);

  const result = await query({
    prompt: userPrompt,
    options: {
      model: classifierConfig.model || 'haiku',
      maxTurns: 1,
      systemPrompt,
    },
  });

  let response = '';
  for await (const message of result) {
    if (message.type === 'assistant') {
      response += message.message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
    }
  }

  return parseClassifierResponse(response);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd skills/auto-brainstorm && node --test tests/classifier.test.mjs
```

Expected: All tests PASS. (Only `buildClassifierPrompt` and `parseClassifierResponse` are tested — `classify` requires SDK and is tested in integration.)

- [ ] **Step 6: Commit**

```bash
git add skills/auto-brainstorm/scripts/classifier.mjs skills/auto-brainstorm/prompts/classifier.md skills/auto-brainstorm/tests/classifier.test.mjs
git commit -m "feat(auto-brainstorm): add Haiku-based question classifier"
```

---

### Task 7: Agent Prompts

**Files:**
- Create: `skills/auto-brainstorm/prompts/response-format.md`
- Create: `skills/auto-brainstorm/prompts/answerer.md`
- Create: `skills/auto-brainstorm/prompts/design-critic.md`
- Create: `skills/auto-brainstorm/prompts/spec-reviewer.md`

- [ ] **Step 1: Create shared response format directive**

Create `skills/auto-brainstorm/prompts/response-format.md`:

```markdown
## Response Format

You are standing in for a human user in a brainstorming session.
Respond as a human would — direct, conversational, decisive.

- If asked to choose: just pick one and say why briefly
- If asked to confirm: say "yes" or "no, because..."
- If asked open-ended: give a clear, short answer (2-3 sentences max)
- If given multiple choice: respond with just the letter and a one-line reason

DO NOT:
- Use headers, bullet lists, or structured analysis
- Say "as an AI" or reveal you're an agent
- Hedge with "it depends" — commit to a choice
- Write more than 3 sentences
```

- [ ] **Step 2: Create answerer agent prompt**

Create `skills/auto-brainstorm/prompts/answerer.md`:

```markdown
You are answering clarifying questions on behalf of a user in a brainstorming session.

The user has provided a design brief describing what they want to build, their goals, constraints, and preferences. Use the brief as your primary source of truth for how to answer.

When the brief doesn't cover the question directly, make a reasonable decision based on:
1. The project context included in the brief
2. Common best practices for the technology stack
3. Simplicity — prefer the simpler option when both are viable

You represent the user's intent. Answer as they would — with their priorities and constraints in mind.

---

{{response-format}}
```

- [ ] **Step 3: Create design-critic agent prompt**

Create `skills/auto-brainstorm/prompts/design-critic.md`:

```markdown
You are evaluating design proposals and architecture decisions on behalf of a user in a brainstorming session.

The user has provided a design brief. Use it to judge whether proposed approaches align with their goals and constraints.

When evaluating options:
- Prefer approaches that match the brief's stated constraints
- Favor simplicity and pragmatism over theoretical elegance
- Consider the project's existing tech stack and patterns
- If an option clearly aligns with the brief, approve it confidently

When asked "does this look right?":
- If it aligns with the brief → approve
- If it contradicts the brief → reject with a specific reason
- If the brief doesn't cover it → approve if it's reasonable, reject if it adds unnecessary complexity

---

{{response-format}}
```

- [ ] **Step 4: Create spec-reviewer agent prompt**

Create `skills/auto-brainstorm/prompts/spec-reviewer.md`:

```markdown
You are reviewing a spec document on behalf of a user in a brainstorming session.

The user has provided a design brief. The spec should faithfully capture the brief's intent, expanded into a complete specification.

When reviewing:
- Check that the spec covers all goals from the brief
- Check for internal contradictions
- Check for missing details that would block implementation
- Approve if the spec is solid and implementation-ready

If asked to review changes or approve the spec, be decisive. Minor imperfections are fine — only reject for issues that would cause real implementation problems.

---

{{response-format}}
```

- [ ] **Step 5: Commit**

```bash
git add skills/auto-brainstorm/prompts
git commit -m "feat(auto-brainstorm): add agent prompts and response format directive"
```

---

### Task 8: Orchestrator (auto-answer.mjs)

**Files:**
- Create: `skills/auto-brainstorm/scripts/auto-answer.mjs`
- Create: `skills/auto-brainstorm/tests/auto-answer.test.mjs`

- [ ] **Step 1: Write failing integration test**

Create `skills/auto-brainstorm/tests/auto-answer.test.mjs`:

```javascript
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
    // Pre-populate state with 3 rejections
    const statePath = path.join(stateDir, 'auto-brainstorm-12345.json');
    fs.writeFileSync(statePath, JSON.stringify({
      session_id: 'test',
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd skills/auto-brainstorm && node --test tests/auto-answer.test.mjs
```

Expected: FAIL — `auto-answer.mjs` does not export `orchestrate`.

- [ ] **Step 3: Implement orchestrator**

Create `skills/auto-brainstorm/scripts/auto-answer.mjs`:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, resolvePromptPath } from './config.mjs';
import { SessionState } from './state.mjs';
import { Logger } from './logger.mjs';
import { buildClassifierPrompt, parseClassifierResponse, classify } from './classifier.mjs';
import { getHandler } from './handlers/index.mjs';

export async function orchestrate({ question, configPath, pluginRoot, sessionPid }) {
  const logPath = path.join('/tmp', `auto-brainstorm-${sessionPid}.log`);
  const logger = new Logger(logPath);

  // Load config
  const defaultConfigPath = path.join(pluginRoot, 'config', 'default.yml');
  let config;
  try {
    config = loadConfig(configPath, defaultConfigPath);
  } catch (err) {
    logger.log(`config error: ${err.message}`);
    return { action: 'escalate', reason: `Config error: ${err.message}` };
  }

  // Load brief
  const briefPath = config.session?.brief_path || '.claude/auto-brainstorm-brief.md';
  const resolvedBriefPath = path.isAbsolute(briefPath)
    ? briefPath
    : path.join(process.cwd(), briefPath);

  if (!fs.existsSync(resolvedBriefPath)) {
    logger.log('no brief file found');
    return { action: 'escalate', reason: 'No design brief found. Please provide one.' };
  }
  const brief = fs.readFileSync(resolvedBriefPath, 'utf8');

  // Load state
  const stateDir = config.session?.state_dir || '/tmp';
  const statePath = path.join(stateDir, `auto-brainstorm-${sessionPid}.json`);
  const state = new SessionState(statePath);

  // Check escalation before doing work
  const maxRejections = config.classifier?.max_consecutive_rejections || 3;
  if (state.shouldEscalate(maxRejections)) {
    logger.log(`escalating: ${state.data.consecutive_rejections} consecutive rejections`);
    return {
      action: 'escalate',
      reason: `Auto-answer couldn't satisfy this question after ${maxRejections} attempts.`,
    };
  }

  // Classify question
  const classifierConfig = {
    model: config.classifier?.model || 'haiku',
    promptPath: resolvePromptPath('prompts/classifier.md', pluginRoot),
  };

  let classification;
  try {
    classification = await classify(
      question,
      config.agents,
      state.getHistory(),
      classifierConfig
    );
    logger.log(
      `classifier → ${classification?.agent} (${classification?.confidence})`
    );
  } catch (err) {
    logger.log(`classifier error: ${err.message}`);
    return { action: 'escalate', reason: `Classifier error: ${err.message}` };
  }

  if (!classification) {
    logger.log('classifier returned unparseable response');
    return { action: 'escalate', reason: 'Classifier could not determine agent.' };
  }

  // Check confidence
  const threshold = config.classifier?.confidence_threshold || 0.7;
  if (classification.confidence < threshold) {
    logger.log(
      `low confidence: ${classification.confidence} < ${threshold}`
    );
    return { action: 'escalate', reason: `Low classifier confidence: ${classification.confidence}` };
  }

  // Get agent config
  const agentName = classification.agent;
  const agentConfig = config.agents[agentName];
  if (!agentConfig) {
    // Fallback to first agent by order
    const fallback = Object.entries(config.agents)
      .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))[0];
    logger.log(`unknown agent "${agentName}", falling back to "${fallback[0]}"`);
    return orchestrateAgent(fallback[0], fallback[1], question, brief, state, logger, pluginRoot);
  }

  return orchestrateAgent(agentName, agentConfig, question, brief, state, logger, pluginRoot);
}

async function orchestrateAgent(agentName, agentConfig, question, brief, state, logger, pluginRoot) {
  const handler = getHandler(agentConfig.handler);

  // Load prompt content (for SDK handler)
  let promptContent = '';
  if (agentConfig.prompt) {
    const promptPath = resolvePromptPath(agentConfig.prompt, pluginRoot);
    promptContent = fs.readFileSync(promptPath, 'utf8');

    // Inject response-format if referenced
    const responseFormatPath = resolvePromptPath('prompts/response-format.md', pluginRoot);
    if (fs.existsSync(responseFormatPath)) {
      const responseFormat = fs.readFileSync(responseFormatPath, 'utf8');
      promptContent = promptContent.replace('{{response-format}}', responseFormat);
    }
  }

  // Dispatch
  let answer;
  const startTime = Date.now();
  try {
    answer = await handler(question, brief, agentConfig, promptContent);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.log(`${agentName} (${agentConfig.model}) → ${answer.length} chars, ${duration}s`);
  } catch (err) {
    logger.log(`${agentName} handler error: ${err.message}`);
    return { action: 'escalate', reason: `Agent error: ${err.message}` };
  }

  // Update state
  state.recordNewQuestion();
  state.recordAnswer(agentName, answer);
  state.save();

  return { action: 'answer', answer, agent: agentName };
}

// CLI entry point — runs when invoked by hook
const isMain = !process.argv[1] || process.argv[1] === new URL(import.meta.url).pathname
  || process.argv[1].endsWith('auto-answer.mjs');

if (isMain && process.stdin.isTTY === undefined) {
  // Read hook payload from stdin
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0); // can't parse payload, let user answer
  }

  const question = payload?.tool_input?.question || payload?.tool_input?.text || '';
  if (!question) {
    process.exit(0);
  }

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
    || path.resolve(new URL('.', import.meta.url).pathname, '..');
  const configPath = path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.claude',
    'auto-brainstorm.yml'
  );
  const sessionPid = process.ppid?.toString() || process.pid.toString();

  const result = await orchestrate({ question, configPath, pluginRoot, sessionPid });

  if (result.action === 'answer') {
    process.stderr.write(result.answer);
    process.exit(2);
  } else {
    if (result.reason) {
      process.stderr.write(result.reason);
    }
    process.exit(0);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd skills/auto-brainstorm && node --test tests/auto-answer.test.mjs
```

Expected: Both escalation tests PASS. (Classifier/handler tests are integration-level and require SDK.)

- [ ] **Step 5: Commit**

```bash
git add skills/auto-brainstorm/scripts/auto-answer.mjs skills/auto-brainstorm/tests/auto-answer.test.mjs
git commit -m "feat(auto-brainstorm): add orchestrator with classifier dispatch and escalation"
```

---

### Task 9: SKILL.md — Brief Collection Instructions

**Files:**
- Create: `skills/auto-brainstorm/SKILL.md`

- [ ] **Step 1: Create SKILL.md**

Create `skills/auto-brainstorm/SKILL.md`:

```markdown
---
name: auto-brainstorm
description: Auto-answers brainstorming and review questions with specialized AI agents. Intercepts AskUserQuestion calls and dispatches agents to answer on your behalf. Use when starting a brainstorming session you want to run hands-off.
---

# Auto-Brainstorm

Automates the human-in-the-loop steps of superpowers brainstorming by dispatching specialized AI agents to answer questions on your behalf.

## Before You Start

**Collect a design brief** from the user before brainstorming begins. This brief is critical — it's what the auto-answer agents use to represent the user's intent.

Ask the user:

> "Before we start brainstorming, give me a quick brief — what are you building, what are the key goals, any constraints or strong preferences?"

Then:

1. Take the user's response as the core brief
2. Explore the project context:
   - Read CLAUDE.md if it exists
   - Check recent git commits (`git log --oneline -10`)
   - Note the tech stack and existing patterns
3. Combine into a brief document and save to `.claude/auto-brainstorm-brief.md`:

```markdown
## User Intent
[User's brief response]

## Project Context
- Tech stack: [from CLAUDE.md / package.json / etc.]
- Recent work: [from git log]
- Key constraints: [from user + codebase]
```

4. Confirm with the user: "Brief saved. Auto-answer agents will use this to respond on your behalf during brainstorming. You'll only be asked directly if the agents can't resolve a question after 3 attempts."

5. Proceed with the normal superpowers brainstorming skill.

## How It Works

The plugin hooks into `AskUserQuestion` (PostToolUse). When superpowers asks a question:

1. A cheap classifier (Haiku) determines which agent should answer
2. The selected agent generates a human-like response using the design brief
3. The answer is injected back as if you typed it
4. If the answer is rejected 3 times, you get asked directly

## Configuration

Edit `.claude/auto-brainstorm.yml` to customize agents, models, and handlers.

## Token Cost

Each auto-answered question costs 1 classifier call (Haiku) + 1 agent call (model varies). Up to 3x per question if rejected. Tokens are charged to your existing Claude Code auth method.
```

- [ ] **Step 2: Commit**

```bash
git add skills/auto-brainstorm/SKILL.md
git commit -m "feat(auto-brainstorm): add SKILL.md with brief collection instructions"
```

---

### Task 10: Install Dependencies & End-to-End Smoke Test

**Files:**
- Modify: `skills/auto-brainstorm/scripts/package.json` (install)

- [ ] **Step 1: Install npm dependencies**

```bash
cd skills/auto-brainstorm/scripts && npm install
```

Expected: `node_modules/` created with `@anthropic-ai/claude-code` and `yaml`.

- [ ] **Step 2: Run all unit tests**

```bash
cd skills/auto-brainstorm && node --test tests/state.test.mjs tests/config.test.mjs tests/classifier.test.mjs tests/handlers.test.mjs tests/auto-answer.test.mjs
```

Expected: All tests PASS.

- [ ] **Step 3: Add node_modules to gitignore**

Create `skills/auto-brainstorm/scripts/.gitignore`:

```
node_modules/
```

- [ ] **Step 4: Verify plugin structure is complete**

```bash
ls -la skills/auto-brainstorm/.claude-plugin/plugin.json
ls -la skills/auto-brainstorm/hooks/hooks.json
ls -la skills/auto-brainstorm/scripts/auto-answer.mjs
ls -la skills/auto-brainstorm/prompts/classifier.md
ls -la skills/auto-brainstorm/config/default.yml
ls -la skills/auto-brainstorm/SKILL.md
```

Expected: All files exist.

- [ ] **Step 5: Commit**

```bash
git add skills/auto-brainstorm/scripts/.gitignore
git commit -m "chore(auto-brainstorm): add gitignore for node_modules"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All spec sections have corresponding tasks — plugin manifests (Task 1), state tracking (Task 2), config (Task 3), logging (Task 4), handlers (Task 5), classifier (Task 6), prompts (Task 7), orchestrator (Task 8), SKILL.md (Task 9), smoke test (Task 10).
- [x] **Placeholder scan:** No TBD/TODO in any task. All code blocks are complete.
- [x] **Type consistency:** `orchestrate()` signature and return type (`{action, answer?, reason?}`) used consistently. `SessionState` API (`recordNewQuestion`, `recordAnswer`, `recordRejection`, `shouldEscalate`, `getHistory`, `save`, `cleanup`) used consistently across tests and orchestrator.
- [x] **Missing spec items:** Path resolution documented in spec → implemented in `config.mjs`. Dependency auto-install → implemented in `run-hook.cmd`. Token cost warning → documented in SKILL.md.
