# Claude Code: Agent Communication Patterns & Auto-Brainstorming

A comprehensive guide to building agents, skills, hooks, and plugins in Claude Code that can communicate with each other — with a focus on automating human-in-the-loop steps (like those in `obra/superpowers`).

---

## Table of Contents

1. [The Goal](#the-goal)
2. [Extension Points in Claude Code](#extension-points-in-claude-code)
3. [Agent-to-Agent Communication Options](#agent-to-agent-communication-options)
4. [Structured Debate Loop (Two Agents Converging)](#structured-debate-loop-two-agents-converging)
5. [Sending Answers to External Systems](#sending-answers-to-external-systems)
6. [Getting External Answers Back into Claude Code](#getting-external-answers-back-into-claude-code)
7. [Running Code Inside the Session (Zero-Config Plugins)](#running-code-inside-the-session-zero-config-plugins)
8. [Using the SDK from Inside a Hook](#using-the-sdk-from-inside-a-hook)
9. [Case Study: How `obra/superpowers` Works](#case-study-how-obrasuperpowers-works)
10. [The Superpowers Visual Companion Server](#the-superpowers-visual-companion-server)
11. [Design Recommendations for Auto-Brainstorming](#design-recommendations-for-auto-brainstorming)

---

## The Goal

Build an automated brainstorming loop where:
- **Agent A** proposes an idea
- **Agent B** reviews, critiques, and asks questions
- **Agent A** gets feedback and produces a refined version
- Loop continues until both agents agree on a solution

Additionally, replace human input steps (like those in `obra/superpowers`) with automated agent research and review.

---

## Extension Points in Claude Code

Claude Code has six distinct extension points, each solving a different problem:

| Extension | Released | What It Does |
|---|---|---|
| **MCP** | Nov 2024 | External tool integrations via Model Context Protocol |
| **Subagents** | Jul 2025 | Isolated parallel workers that report back to the main agent |
| **Hooks** | Sep 2025 | Shell scripts triggered at lifecycle events (PreToolUse, PostToolUse, Stop, etc.) |
| **Plugins** | Oct 2025 | Packaged bundles of hooks, commands, and skills |
| **Skills** | Oct 2025 | `SKILL.md` files invoked as workflows (like macros) |
| **Agent Teams** | Feb 2026 | Multiple Claude sessions that coordinate and message each other |

---

## Agent-to-Agent Communication Options

### 1. Agent Teams (True Peer Communication)

Experimental feature where multiple Claude Code instances coordinate as a team. One acts as lead, others work independently in their own context windows, and they communicate directly with each other.

**Enable:**
```json
// settings.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Requires Claude Code v2.1.32+.

**Communication mechanisms:**
- Automatic message delivery
- Idle notifications
- Shared task list
- Direct messages (to one teammate)
- Broadcasts (to all teammates — expensive, used sparingly)

**Hooks available:**
- `TeammateIdle` — runs when a teammate goes idle
- `TaskCreated` — fires on task creation
- `TaskCompleted` — fires on task completion
- Exit code 2 blocks the lifecycle event and sends feedback

### 2. Subagents (Isolated Workers)

Separate Claude instances spawned via the `Task` tool. Each has its own system prompt, tool permissions, and can even use a different model. They work in isolation and return results — they **cannot** communicate with each other.

**File location:** `.claude/agents/*.md`

```markdown
---
name: code-reviewer
description: Reviews code for style and bugs.
---
You are an assistant that reads code diffs and reports issues.
Focus on maintainability.
```

### 3. The `Task` Tool (The Hidden Gem)

The `Task` tool is **synchronous**. The parent agent calls it like a function, the subagent runs, and its output is returned directly into the parent's context. This is how `obra/superpowers` implements its review loops.

**Pseudocode:**
```
result = Task(
  description="Review spec document",
  prompt=SPEC_REVIEWER_PROMPT + spec_content,
  subagent_type="general-purpose"
)
# Parent blocks here until subagent finishes
# result is now available in parent's context
```

### 4. Hook-Based Communication (Community)

**HCOM (Hook Comms)** — a community tool that layers real-time, @-mention-targeted messaging on top of Claude Code hooks. Agents register with short names and exchange messages through a shared event bus, with delivery confirmed automatically.

**Key capabilities:**
- **@-mention routing** — `hcom send @luna --intent request -- "review this"` delivers directly to the named agent
- **Intent tags** — `request` (expects reply), `inform` (FYI), `ack` (receipt confirmation) so agents know whether to respond
- **Spawning** — launch agents from any supported runtime: `hcom 1 claude`, `hcom 1 gemini`, `hcom 1 opencode`
- **Event subscriptions** — `hcom events sub --idle sofa` to get notified on agent state changes
- **Screen access** — `hcom term <name>` to view an agent's terminal; `hcom term inject <name> 'text' --enter` to send keystrokes
- **Transcript replay** — `hcom transcript <name> --last 20` to read another agent's conversation history

**When to use:** Multi-agent workflows where agents need lightweight, asynchronous messaging without the overhead of Agent Teams' full coordination protocol — e.g., dispatching review tasks, collecting results from heterogeneous agents (Claude + Gemini + Codex), or monitoring agent progress from a lead agent.

### Choosing Between Them

| Need | Use |
|---|---|
| Agents need to talk to each other | **Agent Teams** |
| Enforce lifecycle rules | **Hooks** |
| Isolated parallel workers | **Subagents** |
| Shared workflow knowledge | **Skills** |
| Synchronous agent call | **Task tool** |
| Async inter-agent messaging (cross-runtime) | **HCOM** |

---

## Structured Debate Loop (Two Agents Converging)

### Pattern

```
Lead spawns both agents
        │
        ▼
Proposer → write("reviewer", "PROPOSAL v1: ...")
        │
        ▼
Reviewer → write("proposer", "CRITIQUE: missing X, Y...")
        │
        ▼
Proposer → write("reviewer", "PROPOSAL v2: ...")
        │
        ▼
Reviewer → write("proposer", "APPROVED: solid, covers X and Y")
        │
        ▼
Proposer → CONSENSUS_REACHED: <final>
        │
        ▼
TaskCompleted hook → confirms both agreed → exits cleanly
```

### Agent Definitions

**`.claude/agents/proposer.md`**
```markdown
---
name: proposer
description: Generates ideas and iterates based on reviewer feedback
---

You are a creative Proposer agent in a structured brainstorming loop.

## Your workflow
1. Generate an initial idea or proposal on the given topic
2. After each critique from the reviewer, produce a refined version
3. Clearly label each version: "PROPOSAL v1", "PROPOSAL v2", etc.
4. When you believe the proposal is strong and the reviewer has approved,
   signal convergence with: CONSENSUS_REACHED: <final summary>

## Communication rules
- Always write() to "reviewer" with your proposal
- Wait for reviewer's response before next iteration
- Max 5 iterations — if no consensus by v5, summarize the best version
- Be concise: proposal + key rationale only
```

**`.claude/agents/reviewer.md`**
```markdown
---
name: reviewer
description: Reviews proposals, asks questions, and approves when satisfied
---

You are a critical Reviewer agent in a structured brainstorming loop.

## Your workflow
1. Read each proposal from the proposer carefully
2. Respond with either:
   - CRITIQUE: specific issues + questions (if not satisfied)
   - APPROVED: <reason> (if the proposal meets the bar)
3. Be constructive — explain *why* something doesn't work

## Communication rules
- Always write() back to "proposer" with your response
- If you see CONSENSUS_REACHED from proposer, confirm with APPROVED
- Focus on: clarity, feasibility, completeness, edge cases
```

### Hook Gatekeeper

Each task completion only contains **one agent's output**, so the hook tracks signals from proposer and reviewer separately via a state file.

**`.claude/hooks/task-completed.sh`**
```bash
#!/bin/bash
# Tracks consensus signals from both agents independently.
# Each task-completed event carries a single agent's output.

STATE_FILE="/tmp/brainstorm-consensus.json"
PAYLOAD=$(cat)
TASK_OUTPUT=$(echo "$PAYLOAD" | jq -r '.task.output // ""')
TASK_NAME=$(echo "$PAYLOAD" | jq -r '.task.name // "unknown"')

# Initialize state file if missing
[ -f "$STATE_FILE" ] || echo '{}' > "$STATE_FILE"

# Record whichever signal this agent produced
if echo "$TASK_OUTPUT" | grep -q "CONSENSUS_REACHED"; then
  jq --arg t "$TASK_NAME" '. + {proposer: true}' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
fi
if echo "$TASK_OUTPUT" | grep -q "APPROVED"; then
  jq --arg t "$TASK_NAME" '. + {reviewer: true}' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
fi

# Check if both sides have signaled
PROPOSER=$(jq -r '.proposer // false' "$STATE_FILE")
REVIEWER=$(jq -r '.reviewer // false' "$STATE_FILE")

if [ "$PROPOSER" = "true" ] && [ "$REVIEWER" = "true" ]; then
  rm -f "$STATE_FILE"
  echo "✅ Both agents reached consensus. Brainstorm complete."
  exit 0
else
  echo "Waiting for both signals (proposer=$PROPOSER, reviewer=$REVIEWER)" >&2
  exit 2  # blocks task completion, keeps agents working
fi

exit 0
```

---

## Sending Answers to External Systems

Four patterns for routing Claude Code output to external agents/systems:

### Option 1: Hook → External HTTP Call

```bash
# .claude/hooks/teammate-idle.sh
#!/bin/bash
PAYLOAD=$(cat)
OUTPUT=$(echo "$PAYLOAD" | jq -r '.output // ""')

if echo "$OUTPUT" | grep -q "CONSENSUS_REACHED"; then
  FINAL=$(echo "$OUTPUT" | grep "CONSENSUS_REACHED" | sed 's/CONSENSUS_REACHED: //')
  curl -X POST https://your-external-agent.com/webhook \
    -H "Content-Type: application/json" \
    -d "{\"brainstorm_result\": \"$FINAL\", \"source\": \"claude-code\"}"
fi
```

### Option 2: MCP Server as the Bridge

```
Claude Code → MCP tool: write_brainstorm_result()
                  │
            [shared store: Notion / Supabase / Redis]
                  │
External Agent ← MCP tool: read_brainstorm_result()
```

Most decoupled architecture. Neither side needs to know about the other directly.

### Option 3: File-Based Handoff + Watcher

```bash
# Claude writes result to a file
# External watcher picks it up:
fswatch /tmp/brainstorm-output.json | while read event; do
  RESULT=$(cat /tmp/brainstorm-output.json)
  curl -X POST https://your-agent/ingest -d "$RESULT"
done
```

Simple for local dev. Not suitable for remote/production environments.

### Option 4: Claude Code SDK (Programmatic)

```typescript
import { query } from "@anthropic-ai/claude-code";

const result = await query({
  prompt: "Run a brainstorm loop between proposer and reviewer on: [topic]",
  options: { maxTurns: 20 }
});

const consensus = extractConsensus(result);
await yourExternalAgent.process(consensus);
```

Full programmatic control — best for production pipelines.

### Pattern Selection

| Scenario | Best Option |
|---|---|
| Simple local dev / prototyping | File watcher |
| Production pipeline, event-driven | Hook → Webhook |
| Shared state across many agents/tools | MCP shared store |
| Full code control over orchestration | Claude Code SDK |

---

## Getting External Answers Back into Claude Code

The **return path** is trickier because hooks are fire-and-forget. Options:

### Option 1: Hook Blocks + Writes to File → Claude Reads It

```bash
# .claude/hooks/task-completed.sh
#!/bin/bash
PAYLOAD=$(cat)
OUTPUT=$(echo "$PAYLOAD" | jq -r '.output // ""')

if echo "$OUTPUT" | grep -q "CONSENSUS_REACHED"; then
  FINAL=$(echo "$OUTPUT" | grep "CONSENSUS_REACHED")

  # Call external agent and WAIT for response
  EXTERNAL_RESPONSE=$(curl -s -X POST https://your-agent.com/review \
    -H "Content-Type: application/json" \
    -d "{\"input\": \"$FINAL\"}")

  # Write response where Claude can read it
  echo "$EXTERNAL_RESPONSE" > .claude/external-feedback.json

  # Exit 2 = block + send stderr back to Claude
  echo "External agent responded. Read .claude/external-feedback.json and incorporate." >&2
  exit 2
fi
```

**Key insight: Exit code 2 sends stderr content back into Claude's context as if the user typed it.**

### Option 2: Claude Code SDK — Full Bidirectional Control

```typescript
import { query } from "@anthropic-ai/claude-code";

async function brainstormLoop(topic: string) {
  let context = topic;

  for (let round = 0; round < 5; round++) {
    const claudeResult = await query({
      prompt: `Continue the brainstorm. Current context: ${context}`,
      options: { maxTurns: 10 }
    });

    const consensus = extractConsensus(claudeResult);
    if (!consensus) break;

    const externalFeedback = await fetch("https://your-agent.com/review", {
      method: "POST",
      body: JSON.stringify({ proposal: consensus })
    }).then(r => r.json());

    if (externalFeedback.approved) {
      console.log("✅ Final answer:", consensus);
      break;
    }

    context = `
      Previous proposal: ${consensus}
      External agent feedback: ${externalFeedback.critique}
      Refine the proposal based on this feedback.
    `;
  }
}
```

### Option 3: MCP Tool as Two-Way Channel

```
┌─────────────────────────────────────────┐
│           Your MCP Server               │
│                                         │
│  write_proposal(text)  ←── Claude Code  │
│  read_feedback()       ──→ Claude Code  │
│                                         │
│  [Supabase / Redis / SQLite]            │
│                                         │
│  read_proposal()       ──→ External AI  │
│  write_feedback(text)  ←── External AI  │
└─────────────────────────────────────────┘
```

Most production-grade pattern. Maps naturally to Supabase-based stacks.

---

## Running Code Inside the Session (Zero-Config Plugins)

### The Key Insight

The Claude Code SDK (`@anthropic-ai/claude-code`) is for **launching** Claude Code from external code. It's not designed to be "called from inside" a running session.

**But** — you can still run code inside the session via hooks, and that code can reuse the user's existing Claude Code auth to make additional AI calls.

### Pattern 1: Spawn `claude` CLI as a Subprocess

```javascript
// ~/.claude/plugins/auto-reviewer.js
const { execSync } = require('child_process');

function askSecondaryAgent(question) {
  // Reuses whatever auth the user already configured
  const answer = execSync(
    `claude -p "${question.replace(/"/g, '\\"')}" --output-format json`,
    { encoding: 'utf8' }
  );
  return JSON.parse(answer).result;
}

const review = askSecondaryAgent(`Review this proposal: ${proposal}`);
console.error(review);
process.exit(2); // send review back to main Claude
```

**Benefits:**
- ✅ No API key needed in your plugin
- ✅ User's existing Claude Code auth is reused
- ✅ Works for Pro/Max/API/Bedrock/Vertex users uniformly
- ✅ Install plugin → it just works

**Tradeoff:** Spawns a fresh `claude` process each time (slower).

---

## Using the SDK from Inside a Hook

### Yes — This Reuses User's Auth Automatically

When you call `query()` from `@anthropic-ai/claude-code` inside a hook, it inherits the same authentication the parent Claude Code session is using. **Zero separate API key config needed.**

### Auth Resolution Chain

The SDK walks the same credential chain as the `claude` CLI:

1. `ANTHROPIC_API_KEY` environment variable
2. Stored OAuth token (Pro/Max subscription users)
3. AWS Bedrock credentials (`CLAUDE_CODE_USE_BEDROCK=1`)
4. Google Vertex credentials (`CLAUDE_CODE_USE_VERTEX=1`)
5. Anthropic Console API key file

Your hook runs as a child process of Claude Code, so it inherits all environment variables and access to credential files.

### Who Pays for the Tokens

| User's auth method | Who pays for your plugin's API calls |
|---|---|
| Claude Pro/Max subscription | Counts against their subscription quota |
| Anthropic API key | Charged to their API account |
| Bedrock | Charged to their AWS account |
| Vertex | Charged to their GCP account |

### Minimal Working Example

**`~/.claude/plugins/auto-reviewer.js`**
```javascript
const { query } = require('@anthropic-ai/claude-code');

async function reviewProposal(proposal) {
  // No API key passed. SDK uses whatever auth Claude Code uses.
  const result = await query({
    prompt: `Review this proposal critically and respond with either APPROVED or CRITIQUE:\n\n${proposal}`,
    options: {
      maxTurns: 1,
      model: 'claude-haiku-4-5'  // optionally use cheaper model
    }
  });

  let response = '';
  for await (const message of result) {
    if (message.type === 'assistant') {
      response += message.message.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
    }
  }
  return response;
}

const payload = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const output = payload.tool_response?.output || '';

if (output.includes('PROPOSAL')) {
  reviewProposal(output).then(review => {
    console.error(`Reviewer says:\n${review}`);
    process.exit(2); // Send review back into Claude's context
  });
}
```

**`.claude/hooks/post-tool-use.sh`**
```bash
#!/bin/bash
node ~/.claude/plugins/auto-reviewer.js
```

**`.claude/settings.json`**
```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": ".claude/hooks/post-tool-use.sh" }] }
    ]
  }
}
```

### User Experience

```bash
# Install your plugin
npx install-brainstorm-plugin

# Use Claude Code normally
claude

# Plugin works automatically — no API key prompt, no config
```

### Caveats

1. **Token cost transparency** — plugin silently consumes user's tokens. Mention this in your README.
2. **Rate limits** — Subscription users have rate limits. Add a max-iterations cap.

---

## Case Study: How `obra/superpowers` Works

### The Skills Architecture

Superpowers is a **skills framework** — each skill is a `SKILL.md` file with instructions. When Claude Code starts, a session-start hook injects:

```
<session-start-hook>
<EXTREMELY_IMPORTANT>
You have Superpowers. RIGHT NOW, go read:
@/Users/jesse/.claude/plugins/cache/Superpowers/skills/getting-started/SKILL.md
</EXTREMELY_IMPORTANT>
</session-start-hook>
```

This bootstraps the whole system. Skills trigger automatically based on context.

### The Core Workflow

1. **brainstorming** → Refines idea through questions, explores alternatives, saves design doc
2. **using-git-worktrees** → Creates isolated workspace
3. **writing-plans** → Breaks work into 2-5 min tasks
4. **subagent-driven-development** → Dispatches fresh subagent per task with two-stage review
5. **test-driven-development** → RED-GREEN-REFACTOR cycle
6. **requesting-code-review** → Reviews against plan
7. **finishing-a-development-branch** → Merge/PR workflow

### How the Review Loop Actually Communicates

**There is no server for this.** The "other agent" that reviews is a subagent dispatched via Claude Code's built-in `Task` tool.

**`spec-document-reviewer-prompt.md`:**
```yaml
Task tool (general-purpose):
  description: "Review spec document"
  prompt: |
    You are a spec document reviewer.
    Verify this spec is complete and ready for planning.
    ...
```

### The Loop in Pseudocode

```
Main Claude (brainstorming skill):
  1. Write spec to docs/superpowers/specs/YYYY-MM-DD-feature.md

  2. iteration = 0
  3. while iteration < 5:
       result = Task(
         description="Review spec document",
         prompt=SPEC_REVIEWER_PROMPT + spec_file_content,
         subagent_type="general-purpose"
       )
       # ← Main Claude blocks here until subagent returns

       if "Approved" in result:
         break
       else:
         apply_fixes(result.issues)
         iteration += 1

  4. If loop exceeded 5 → escalate to human
  5. Proceed to writing-plans skill
```

### Why This Works Elegantly

| Aspect | Mechanism |
|---|---|
| **How agents communicate** | `Task` tool — synchronous function call |
| **Return path** | Task tool's return value goes directly into main Claude's context |
| **Auth** | Subagent inherits parent session's auth automatically |
| **Session scope** | Subagent runs in isolated context but within the same Claude Code session |
| **Shared state** | The spec file on disk — both agents read/write it |
| **Loop control** | Main Claude's own reasoning decides when to stop (with max=5 guard) |

---

## The Superpowers Visual Companion Server

`skills/brainstorming/scripts/server.cjs` is **not an agent server**. It's a **display/input bridge** — a local browser UI that lets Claude show rich content to the user and receive their clicks back.

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   Claude Code session                                    │
│         │                                                │
│         │ writes HTML file                               │
│         ▼                                                │
│   /tmp/brainstorm/screen.html  ←── shared directory      │
│         │                                                │
│         │ fs.watch() detects change                      │
│         ▼                                                │
│   server.cjs (Node.js, zero-dep)                         │
│         │                                                │
│         │ broadcasts "reload" over WebSocket             │
│         ▼                                                │
│   Browser (http://localhost:49xxx)                       │
│         │                                                │
│         │ User clicks option A / B / C                   │
│         ▼                                                │
│   WebSocket → server.cjs                                 │
│         │                                                │
│         │ appends to /tmp/brainstorm/.events             │
│         ▼                                                │
│   Claude reads .events file to see what user chose       │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Filesystem as Message Bus

The server is stateless glue. Real communication happens through **two files in a shared directory**:

| File | Written by | Read by | Purpose |
|---|---|---|---|
| `screen.html` | Claude | Server → Browser | Claude shows a design option |
| `.events` | Server | Claude | User's click gets queued here |

Claude never talks to the server directly. Claude just reads and writes files. The server is a dumb middleman that converts filesystem changes into browser updates via `fs.watch` + WebSocket reload.

### The Loop Flow

```
1. Skill tells Claude: "Start the companion server"
   → Claude runs: node server.cjs &
   → Server logs: { url: "http://localhost:49xxx" }
   → Claude tells user: "Open this URL"

2. Claude writes an HTML screen with 3 design options:
   → fs.writeFile("/tmp/brainstorm/design-options.html", html)
   → Server's fs.watch fires
   → Server broadcasts { type: "reload" } via WebSocket
   → Browser refreshes, user sees the 3 options

3. User clicks "Option B":
   → helper.js captures click, sends WebSocket message
   → Server writes: { choice: "B", screen: "design-options" } to .events

4. Claude reads the .events file:
   → Claude knows: user picked B
   → Claude continues brainstorm with that context
```

### Design Principles (Why It's Brilliant)

1. **Zero dependencies, zero setup** — from-scratch WebSocket implementation using only Node built-ins (`http`, `crypto`, `fs`). No `npm install`.

2. **No new auth / API keys** — the server doesn't call any AI. All AI intelligence still runs in the main Claude session using existing auth.

3. **Filesystem as IPC** — files are a universal message bus. Claude already has `Read`/`Write` tools.

4. **Self-cleanup via OWNER_PID**
   ```javascript
   const OWNER_PID = process.env.BRAINSTORM_OWNER_PID;
   if (!ownerAlive()) shutdown('owner process exited');
   ```
   When Claude Code closes, the server dies automatically.

5. **Port randomization**
   ```javascript
   const PORT = 49152 + Math.floor(Math.random() * 16383);
   ```
   Random high port, localhost-only. No conflicts, no network exposure.

---

## Design Recommendations for Auto-Brainstorming

### The Opportunity

Superpowers has some steps that require **human input** (e.g., user picks between design options in the Visual Companion). To automate these, replace the human-input step with an **AI reviewer subagent** that does the research and answers.

### The Four Communication Patterns — When to Use Each

| Pattern | Use when |
|---|---|
| `Task` tool → subagent | You need another **AI agent** to review/critique |
| Hook (exit 2) | You need to **block + inject** feedback into Claude's turn |
| SDK / `claude -p` subprocess | You want **programmatic control** of a separate Claude session |
| **File + local server** (Superpowers pattern) | You need **human input in a rich UI** mid-session |

### Recommended Architecture for Auto-Brainstorm

Combine patterns:

```
Agent A (main Claude)
    ↓
    Task tool → Reviewer subagent (the other "AI agent")
    ↓
    If human input needed → write HTML → companion server shows it
                          → OR skip UI: another subagent auto-answers
    ↓
    Read feedback (from Task return value or .events file)
    ↓
    Loop until consensus
```

### Implementation Sketch as a Skill

**`.claude/skills/auto-brainstorm/SKILL.md`**
```markdown
---
name: auto-brainstorm
description: Iterative brainstorm with adversarial AI review loop (fully automated)
---

## Process

1. Generate initial proposal. Write to `docs/brainstorm/current-proposal.md`

2. Dispatch research subagent via Task tool to gather context:

   Task(
     description="Research context",
     prompt=research-prompt.md + topic,
     subagent_type="general-purpose"
   )

3. Dispatch reviewer subagent via Task tool:

   Task(
     description="Critique proposal",
     prompt=reviewer-prompt.md + proposal + research,
     subagent_type="general-purpose"
   )

4. Read the reviewer's response.

5. If APPROVED → done. Save final spec.
   If CRITIQUE → refine proposal, go to step 3.

6. Max 5 iterations. If still not approved after 5 rounds,
   escalate to the human user.
```

**`.claude/skills/auto-brainstorm/reviewer-prompt.md`**
```markdown
You are an adversarial reviewer in a brainstorming loop.

Your job: prevent weak proposals from being approved.
Read the proposal below carefully.

Respond with EXACTLY one of:
- APPROVED: <one-line reason why this is solid>
- CRITIQUE: <bulleted list of specific, actionable issues>

Focus on:
- Clarity: is the idea well-defined?
- Feasibility: can this actually be built?
- Edge cases: what's been missed?
- YAGNI: is anything unnecessary?
- Risks: what could go wrong?

Do NOT approve unless the proposal is genuinely strong.
Be tough but constructive.

---
[Proposal content inserted here]
```

**`.claude/skills/auto-brainstorm/research-prompt.md`**
```markdown
You are a research subagent. Given a brainstorm topic,
gather relevant context that would help produce a strong proposal:

- Prior art (similar solutions, patterns, libraries)
- Known pitfalls and edge cases
- Best practices for this domain
- Constraints or requirements the user may not have articulated

Use web search, read local files, check git history as needed.

Return a concise brief (max 500 words) of key findings.

---
Topic: [topic inserted here]
```

### Why This Pattern Wins

- ✅ **Zero user setup** — just install the skill
- ✅ **No API keys needed** — reuses Claude Code's auth via Task tool
- ✅ **No external server** — everything runs inside the session
- ✅ **Loop termination is safe** — max iterations + human escalation
- ✅ **Same pattern as Superpowers** — proven to work at scale (152k+ stars)
- ✅ **Fully automated** — replaces human-input steps with AI research/review

### What to Build on Top of Superpowers

Instead of replacing Superpowers, **extend it**:

1. **Add an `auto-review-companion` skill** that dispatches a reviewer subagent whenever Superpowers would normally wait for user input.

2. **Override specific Superpowers prompts** via your own `CLAUDE.md` — Superpowers explicitly respects user-level instructions over its internal ones.

3. **Use the same `Task` tool pattern** Superpowers uses for its spec-document-reviewer, but point it at whatever automation you want.

4. **Combine with research subagents** — before the reviewer critiques, another subagent gathers context (web search, codebase inspection, docs).

---

## Summary: The Key Takeaways

1. **Claude Code has 6 extension points** — Skills, Hooks, Subagents, Plugins, MCP, Agent Teams. Each solves a different problem.

2. **For agent-to-agent communication**, the simplest and most portable mechanism is the **`Task` tool** — synchronous, no setup, reuses auth automatically.

3. **For zero-config plugins**, reuse the user's existing Claude Code auth via:
   - SDK (`query()`) from inside a hook
   - Spawning `claude -p` subprocess
   - The `Task` tool for spawning subagents

4. **The Superpowers review loop is just the `Task` tool + markdown prompts + a max-iteration guard.** No server, no webhook, no external service.

5. **The Superpowers Visual Companion server is a filesystem-based I/O bridge**, not an agent communication channel. It demonstrates how to add rich UI capability without asking users to install anything.

6. **For auto-brainstorming, combine**:
   - `Task` tool for AI reviewer/researcher subagents
   - Files on disk as shared state
   - Iteration caps with human escalation
   - Optional hook-based injection for turn-level control

7. **Install experience should be**: one command, no config, no API keys. Model your plugin after how Superpowers is installed and bootstrapped.

---

*Generated from a conversation about building automated agent communication in Claude Code, April 2026.*