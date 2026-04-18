# Auto-Brainstorm: Automated Agent Answering for Superpowers

**Date:** 2026-04-17
**Status:** Draft

## Summary

A Claude Code plugin that intercepts `AskUserQuestion` calls during superpowers brainstorming and review workflows, and dispatches specialized AI agents to auto-answer them. The user only gets pulled in when an agent fails to satisfy the question after 3 consecutive attempts.

## Goals

- Automate the human-in-the-loop steps of superpowers brainstorming and spec review
- Use specialized agents (different models, different skills) per workflow state
- Support multiple handler types (Claude Code SDK, webhooks, local commands) for extensibility
- Layer on top of superpowers as a plugin — no modifications to superpowers itself
- Degrade gracefully — any failure falls back to the user answering normally

## Non-Goals

- Replacing superpowers — this extends it
- Automating implementation phases (writing-plans, TDD, etc.)
- Building a general-purpose agent orchestration framework

## Architecture

### Overview

Three layers:

1. **Hook** — `PostToolUse` matcher on `AskUserQuestion`, calls the orchestrator script
2. **Orchestrator** (`auto-answer.mjs`) — classifies the question, picks an agent, dispatches via handler, tracks iterations
3. **Handlers** — pluggable executors: SDK (`query()`), webhook (`fetch()`), command (`execSync()`)

### Flow

```
Superpowers brainstorming (unmodified)
       │
       ▼  AskUserQuestion(question)
       │
  PostToolUse hook fires
       │
       ▼
  auto-answer.mjs
       │
       ├─ Load config (.claude/auto-brainstorm.yml)
       ├─ Load brief (.claude/auto-brainstorm-brief.md)
       ├─ Load state (/tmp/auto-brainstorm-{pid}.json)
       │
       ├─ Classify question (Haiku, 1 turn)
       │    Input: question + agent descriptions + history
       │    Output: { agent, confidence, reasoning }
       │
       ├─ confidence < threshold → exit 0 (user answers)
       │
       ├─ Dispatch agent via handler type
       │    ├─ sdk    → query() with model/prompt from config
       │    ├─ webhook → fetch() to configured URL
       │    └─ command → execSync() configured command
       │
       ├─ Update state (sequence, history)
       │
       ├─ consecutive_rejections >= 3 → exit 0 (user answers)
       │
       └─ exit 2 + stderr = agent's answer
              → injected into Claude's context
```

### State Detection — Smart Classifier

A Haiku-based classifier routes questions to the right agent. It receives:

- The question text
- Available agent roles with descriptions and ordering
- Session history (previous questions, which agents answered, acceptance status)

This replaces brittle keyword matching. Adding a new agent role only requires adding an entry with a good `description` to the config — the classifier adapts automatically.

**Confidence threshold:** Configurable (default 0.7). Below threshold, the question escalates to the user.

### Iteration Tracking — Sequence-Based

Tracks by sequence position, not question hash (avoids reset when superpowers rephrases):

```json
{
  "session_id": "abc123",
  "total_questions": 5,
  "current_sequence": 5,
  "consecutive_rejections": 2,
  "history": [
    { "seq": 1, "agent": "answerer", "accepted": true },
    { "seq": 2, "agent": "answerer", "accepted": true },
    { "seq": 5, "agent": "design-critic", "accepted": false, "round": 1 },
    { "seq": 5, "agent": "design-critic", "accepted": false, "round": 2 }
  ]
}
```

**Rejection detection:** If the previous answer led to another question on the same topic (superpowers re-asks rather than moving forward), the state file shows the last entry wasn't followed by a phase transition — that's a rejection.

**Escalation rule:** `consecutive_rejections >= 3` → exit 0, user sees the question.

### Design Brief — User Intent + Project Context

Before brainstorming starts, the SKILL.md instructs Claude to:

1. Ask the user for a short design brief (goals, constraints, preferences)
2. Explore the codebase (CLAUDE.md, recent commits, key files)
3. Append project context to the brief
4. Save to `.claude/auto-brainstorm-brief.md`

The brief is injected into every agent prompt so agents can answer as informed proxies for the user.

### Response Format — Human-Like

Agent prompts include a shared directive (`prompts/response-format.md`) that ensures responses sound like a human answering a brainstorming question:

- If asked to choose: pick one, say why briefly
- If asked to confirm: "yes" or "no, because..."
- If given multiple choice: respond with the letter and a one-line reason
- Max 3 sentences, no headers/bullets/structured analysis

This prevents superpowers from receiving AI-formatted output it can't handle naturally.

## Default Agents

| Role | Model | Handler | Purpose |
|------|-------|---------|---------|
| answerer | opus | sdk | Clarifying questions — goals, constraints, preferences |
| design-critic | sonnet | sdk | Design approaches, trade-offs, section approval |
| spec-reviewer | haiku | sdk | Spec completeness, consistency, clarity |

All configurable via `.claude/auto-brainstorm.yml`. Models, handlers, and prompts can be swapped per agent.

## Plugin Structure

```
skills/auto-brainstorm/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── .cursor-plugin/
│   └── plugin.json              # Cursor compat manifest
├── hooks/
│   ├── hooks.json               # Claude Code hooks (PascalCase)
│   ├── hooks-cursor.json        # Cursor hooks (camelCase)
│   └── run-hook.cmd             # Polyglot wrapper (Windows + Unix)
├── scripts/
│   ├── auto-answer.mjs          # Orchestrator entry point
│   ├── classifier.mjs           # Haiku state classifier
│   ├── state.mjs                # Session state tracking
│   └── handlers/
│       ├── sdk.mjs              # Claude Code SDK handler
│       ├── webhook.mjs          # HTTP/webhook handler
│       └── command.mjs          # Local command handler
├── prompts/
│   ├── classifier.md            # Classifier system prompt
│   ├── answerer.md              # Clarifying question agent
│   ├── design-critic.md         # Design critique agent
│   ├── spec-reviewer.md         # Spec review agent
│   └── response-format.md       # Shared human-like response directive
├── config/
│   └── default.yml              # Default agent config
└── SKILL.md                     # Brief collection + usage instructions
```

### Hook Registration

**`hooks/hooks.json`:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [{
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/auto-answer.mjs\""
        }]
      }
    ]
  }
}
```

**`plugin.json`:**
```json
{
  "name": "auto-brainstorm",
  "description": "Auto-answers brainstorming questions with specialized AI agents",
  "version": "1.0.0",
  "skills": "./",
  "hooks": "./hooks/hooks.json"
}
```

## Configuration

Config lives at `.claude/auto-brainstorm.yml` (copied from `config/default.yml` on first run).

```yaml
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

### Extensibility

- **Add agent:** Add entry under `agents:` with description, handler, config
- **Swap handler:** Change `handler: sdk` to `handler: webhook` + add `url:`
- **External call (n8n, etc.):** Use `handler: webhook` with target URL
- **Local script:** Use `handler: command` with shell command
- **Change model:** Update `model:` field per agent
- **Adjust routing:** Tune `confidence_threshold`
- **Adjust patience:** Change `max_consecutive_rejections`

## Error Handling

Every failure mode falls back to exit 0 — the user sees the question normally.

| Scenario | Behavior |
|---|---|
| SDK query() fails (rate limit, auth) | Log error, exit 0 |
| Webhook timeout / non-200 | Log error, exit 0 |
| Classifier unknown role | Use fallback agent (default: answerer) |
| Classifier confidence < threshold | Exit 0 |
| Brief file missing | Exit 0 with warning |
| Config file missing | Copy defaults, proceed |
| State file corrupted | Create fresh state |
| 3 consecutive rejections | Exit 0 with note |

### Logging

Written to `/tmp/auto-brainstorm-{pid}.log`:
```
[timestamp] classifier → agent_role (confidence)
[timestamp] agent_role (model) → token_count, duration
[timestamp] exit code → outcome
```

Cleaned up with state file at session end if `cleanup_on_end: true`.

## Path Resolution

All `prompt` paths in the config are resolved relative to the **plugin root** (`${CLAUDE_PLUGIN_ROOT}`). For example, `prompts/answerer.md` resolves to `${CLAUDE_PLUGIN_ROOT}/prompts/answerer.md`. Absolute paths are used as-is.

## Dependencies

The plugin ships a `package.json` at `scripts/package.json` with:

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

On first invocation, `auto-answer.mjs` checks for `node_modules/` and runs `npm install --prefix ${CLAUDE_PLUGIN_ROOT}/scripts` if missing. This is a one-time setup that reuses the user's existing auth — no API key needed.

## Token Cost Considerations

Each intercepted question costs:
- 1 Haiku call (classifier) — minimal
- 1 agent call (model varies) — depends on agent config
- Up to 3x per question if rejected

The plugin silently consumes tokens from the user's auth method. This must be documented in README and SKILL.md.
