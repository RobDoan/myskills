---
name: auto-brainstorm
description: Auto-answers brainstorming and review questions with specialized AI agents. Intercepts AskUserQuestion calls and dispatches agents to answer on your behalf. Use when starting a brainstorming session you want to run hands-off.
---

# Auto-Brainstorm

Automates the human-in-the-loop steps of superpowers brainstorming by dispatching specialized AI agents to answer questions on your behalf.

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

The plugin hooks into `AskUserQuestion` (PreToolUse). When superpowers asks a question:

1. A cheap classifier (Haiku) picks which agent should answer
2. The selected agent generates a reply (via hcom → Gemini by default, or Claude SDK)
3. The reply is mapped to an option label and emitted as `hookSpecificOutput` JSON so Claude sees the tool as succeeded
4. If the reply is unparseable or any failure occurs 3 times, you get asked directly

## Configuration

Edit `.claude/auto-brainstorm.yml` to customize agents, models, and handlers.

## Token Cost

Each auto-answered question costs 1 classifier call (Haiku) + 1 agent call (model varies). Up to 3x per question if rejected. Tokens are charged to your existing Claude Code auth method.
