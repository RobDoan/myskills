# Auto-Brainstorm

A Claude Code plugin that automates the human-in-the-loop steps of [superpowers](https://github.com/obra/superpowers) brainstorming and spec review. Instead of you answering every clarifying question and reviewing every design section, specialized AI agents answer on your behalf — each tuned with the right model and skills for their role.

You only get asked directly if an agent fails to satisfy a question after 3 attempts.

## How It Works

```
Superpowers asks a question (AskUserQuestion)
       │
       ▼
PostToolUse hook fires → auto-answer.mjs
       │
       ├─ Classifies question (Haiku, cheap/fast)
       ├─ Routes to the right agent (answerer / design-critic / spec-reviewer)
       ├─ Agent generates a human-like response using your design brief
       ├─ Answer injected back into Claude's context (exit code 2)
       │
       └─ If rejected 3 times → you get asked directly (exit code 0)
```

## Install

```bash
npx skills add RobDoan/myskills
```

Or manually: clone this repo and symlink `skills/auto-brainstorm/` into your Claude Code plugins directory.

## Usage

1. Start a brainstorming session with superpowers
2. When prompted, provide a **design brief** — your goals, constraints, and preferences
3. The plugin saves the brief to `.claude/auto-brainstorm-brief.md`
4. From that point, agents auto-answer questions on your behalf
5. You only see questions the agents can't handle

## Default Agents

| Agent | Model | Role |
|-------|-------|------|
| **answerer** | Opus | Clarifying questions — goals, constraints, preferences |
| **design-critic** | Sonnet | Design approaches, trade-offs, section approval |
| **spec-reviewer** | Haiku | Spec completeness, consistency, clarity |

A Haiku-based **classifier** routes each question to the right agent based on context and session history.

## Configuration

Copy `config/default.yml` to `.claude/auto-brainstorm.yml` to customize (auto-copied on first run):

```yaml
classifier:
  model: haiku
  confidence_threshold: 0.7       # below this → you answer
  max_consecutive_rejections: 3    # per question before escalating

agents:
  answerer:
    description: "Answers clarifying questions about user intent..."
    order: 1
    handler: sdk
    model: opus
    prompt: prompts/answerer.md
    max_turns: 1
```

### Adding a New Agent

Add an entry under `agents:` with a good `description` — the classifier picks it up automatically:

```yaml
agents:
  security-reviewer:
    description: "Reviews for security concerns and threat modeling"
    order: 4
    handler: sdk
    model: sonnet
    prompt: prompts/security-reviewer.md
    max_turns: 1
```

### Using External Services (n8n, webhooks)

Swap the handler to `webhook` and point to your endpoint:

```yaml
agents:
  design-critic:
    description: "Evaluates design approaches..."
    order: 2
    handler: webhook
    url: https://your-n8n.com/webhook/design-review
    headers:
      Authorization: "Bearer ${N8N_TOKEN}"
    timeout: 30000
```

### Using Local Commands

```yaml
agents:
  compliance-checker:
    description: "Checks against internal compliance rules"
    order: 5
    handler: command
    command: "node ./scripts/compliance-check.mjs"
    timeout: 10000
```

The command receives the question and brief via `AUTO_BRAINSTORM_QUESTION` and `AUTO_BRAINSTORM_BRIEF` environment variables.

## Handler Types

| Handler | Use When | How It Works |
|---------|----------|--------------|
| `sdk` | AI agent answering | Calls Claude Code SDK `query()`, inherits your auth |
| `webhook` | External service (n8n, Make, custom API) | POSTs `{question, brief}` to a URL |
| `command` | Local script | Runs a shell command, reads stdout |

## How Escalation Works

The plugin tracks questions by **sequence position** (not by content hash, which would break on rephrasing):

1. Each new question increments the sequence counter
2. If superpowers re-asks (rephrases after a bad answer), the rejection counter increments
3. After 3 consecutive rejections on the same question → you answer directly
4. Moving to a new question resets the counter

All failures (SDK errors, webhook timeouts, low classifier confidence) also escalate to you. The plugin is purely additive — if anything breaks, the experience degrades to normal superpowers, never worse.

## Logging

Session logs are written to `/tmp/auto-brainstorm-{pid}.log`:

```
[2026-04-17T10:23:01] classifier → answerer (0.95)
[2026-04-17T10:23:03] answerer (opus) → 47 chars, 1.8s
[2026-04-17T10:24:15] classifier → design-critic (0.88)
[2026-04-17T10:24:16] sdk error: rate_limit_exceeded
[2026-04-17T10:24:16] escalating to user
```

## Token Cost

Each auto-answered question costs:

- 1 Haiku call (classifier) — minimal
- 1 agent call (model varies) — depends on agent config
- Up to 3x per question if rejected

Tokens are charged to your existing Claude Code auth method (Pro/Max subscription, API key, Bedrock, or Vertex).

## Plugin Structure

```
skills/auto-brainstorm/
├── .claude-plugin/plugin.json       # Claude Code plugin manifest
├── .cursor-plugin/plugin.json       # Cursor compat
├── hooks/
│   ├── hooks.json                   # PostToolUse → AskUserQuestion
│   ├── hooks-cursor.json            # Cursor format
│   └── run-hook.cmd                 # Polyglot wrapper (Windows + Unix)
├── scripts/
│   ├── auto-answer.mjs              # Orchestrator entry point
│   ├── classifier.mjs               # Haiku question classifier
│   ├── config.mjs                   # Config loader
│   ├── state.mjs                    # Session state tracking
│   ├── logger.mjs                   # File logger
│   └── handlers/
│       ├── index.mjs                # Handler registry
│       ├── sdk.mjs                  # Claude Code SDK
│       ├── webhook.mjs              # HTTP/webhook
│       └── command.mjs              # Local command
├── prompts/
│   ├── classifier.md                # Question classification prompt
│   ├── answerer.md                  # Clarifying question agent
│   ├── design-critic.md             # Design critique agent
│   ├── spec-reviewer.md             # Spec review agent
│   └── response-format.md           # Shared "respond like a human" directive
├── config/
│   └── default.yml                  # Default configuration
├── tests/                           # Unit tests (29 tests)
├── SKILL.md                         # Skill definition
└── README.md
```

## Requirements

- Claude Code with superpowers installed
- Node.js 18+
- Dependencies auto-installed on first run (`@anthropic-ai/claude-code`, `yaml`)

## License

MIT
