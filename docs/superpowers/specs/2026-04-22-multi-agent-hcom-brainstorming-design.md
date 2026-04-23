# Multi-Agent Brainstorming via hcom — Design

**Date:** 2026-04-22
**Status:** Approved, ready for implementation plan
**Scope:** Extend the `auto-brainstorm` plugin so that brainstorming questions can be answered by Gemini (via `hcom`) instead of by local Claude SDK calls.

## Problem

The existing `auto-brainstorm` plugin intercepts `AskUserQuestion` calls during superpowers brainstorming and auto-answers them using one-shot Claude SDK calls (`sdk` handler). Two issues:

1. **The hook doesn't actually work smoothly.** The current hook exits with code 2 and writes the answer to stderr. Claude Code treats that as "tool was denied with this reason," so Claude may retry, rewrite, or otherwise not smoothly continue. The user experienced this as brittle hand-off rather than clean auto-answering.
2. **Locked to one backend.** Every answering agent is a fresh Claude SDK call. No way to get a different model's perspective, no way to use a long-running collaborator agent.

## Goals

- Fix the hook response so Claude treats the synthesized answer as a successful tool result.
- Add an `hcom` handler that routes questions to a long-lived Gemini process over hcom (hook-comms), enabling Gemini to act as multiple personas across the brainstorming flow.
- Keep the existing `sdk` / `webhook` / `command` handlers working — this is an additive change.
- Preserve escalation-to-human as the failure mode for every error path.

## Non-Goals

- Auto-launching or lifecycle-managing the Gemini process. User pre-launches `hcom gemini` themselves.
- Genuine multi-turn Claude↔Gemini dialogue in v1. All personas answer one-shot; we'll revisit if monologuing feels insufficient in practice.
- Forking or modifying the upstream `superpowers:brainstorming` skill. All changes live inside `auto-brainstorm`.
- Replacing the human-in-the-loop for the final spec review. That gate remains human.

## Decisions locked in during brainstorming

| Axis | Decision |
| --- | --- |
| Shape | New multi-agent brainstorming via hcom (not a plain SDK backend swap) |
| Persona | Multiple personas, different per brainstorming step |
| Gemini instances | One long-lived Gemini, persona switched per message via envelope |
| Human role during Q&A | Fully hands-off (brief-only, like current auto-brainstorm) |
| Turn-taking | One-shot per question in v1 (multi-turn for peer-architect deferred) |
| Final spec review | Remains human — gemini never approves its own co-authored spec |
| Approach | Infrastructure-only extension to auto-brainstorm: add hcom handler + fix hook response format |

## Architecture

```text
auto-brainstorm/
├── SKILL.md                              [modified — add hcom prereq line]
├── README.md                             [modified — document hcom handler]
├── hooks/hooks.json                      [unchanged]
├── scripts/
│   ├── auto-answer.mjs                   [modified — emit correct hook JSON, use answer-mapper]
│   ├── answer-mapper.mjs                 [new — map free-text → option label]
│   └── handlers/
│       ├── sdk.mjs                       [unchanged]
│       ├── webhook.mjs                   [unchanged]
│       ├── command.mjs                   [unchanged]
│       └── hcom.mjs                      [new]
├── config/default.yml                    [modified — gemini personas via hcom]
├── prompts/
│   ├── gemini-user.md                    [new — user-stand-in persona]
│   ├── gemini-critic.md                  [new — critic persona]
│   └── gemini-spec-reviewer.md           [new — spec-reviewer persona]
└── tests/
    ├── answer-mapper.test.js             [new]
    ├── handlers/hcom.test.js             [new]
    ├── auto-answer.test.js               [modified — new hook response format]
    ├── integration/hook-shape.test.js    [new]
    └── MANUAL.md                         [new — smoke test checklist]
```

**Data flow per question:**

1. Claude emits `AskUserQuestion`.
2. `PreToolUse` hook fires; `auto-answer.mjs` runs.
3. Existing orchestration: load brief → load state → check escalation → classify question → pick persona-matched agent config.
4. Handler dispatch: `hcom.mjs` is invoked.
5. Handler sends an envelope to `@gemini` via `hcom send --intent request`, then blocks on `hcom listen --from gemini --reply-to <id> --timeout 60 --json`.
6. Handler returns reply text.
7. `answer-mapper.mjs` converts reply text into `{questionText: optionLabel}` map.
8. Orchestrator writes JSON to stdout, then exits 0:

   ```json
   {
     "hookSpecificOutput": {
       "hookEventName": "PreToolUse",
       "permissionDecision": "allow",
       "updatedInput": { "questions": [], "answers": {} }
     }
   }
   ```

9. Claude Code sees the tool as successful with those answers baked in and continues the next step.

## Hook response format change

The critical fix. Before:

```js
if (result.action === 'answer') {
  process.stderr.write(`[Auto-answered by ${result.agent}] The user's answer is:\n\n${result.answer}\n\nProceed...`);
  process.exit(2);   // blocks tool — Claude sees refusal
}
```

After:

```js
if (result.action === 'answer') {
  const questions = payload?.tool_input?.questions ?? [];
  const answers = buildAnswersMap(questions, result.answer);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { questions, answers }
    }
  }));
  process.exit(0);   // tool "succeeds" with our answers
}

if (result.action === 'escalate') {
  if (result.reason) process.stderr.write(result.reason);
  process.exit(0);   // let tool run normally; user sees question
}
```

This is documented at `code.claude.com/docs/en/hooks.md` under "Synthesizing Answers for AskUserQuestion."

**Side benefit:** the existing SDK/Haiku flow also becomes smoother after this fix — the bug affected all handlers, not just hcom.

## answer-mapper.mjs

Pure function, isolated from IO for easy testing.

```js
// buildAnswersMap(questions, agentReplyText) → { [questionText]: optionLabel | "Other:<text>" }
```

Rules:

1. **Exact label match** (case-insensitive, trimmed): agent reply `"B"` against option label `"B"` → use `"B"`.
2. **Label-with-explanation**: agent reply `"B. Because it matches the brief..."` → extract `"B"`, use it.
3. **Free-form "Other"**: agent reply `"Other: use SQLite instead"` → `{label: "Other", text: "use SQLite instead"}`.
4. **No confident match**: fall back to `"Other: <raw reply>"` if the question supports Other; otherwise return `null` for that question (triggers rejection counter).
5. **Multiple questions in one call**: split the agent reply on `---` or numbered sections; if splitting is unclear, apply the full reply to the first question and mark the rest as `null`.

## hcom handler contract

`scripts/handlers/hcom.mjs`:

```js
export async function handleHcom(question, brief, agentConfig, promptContent) {
  // agentConfig: { target, persona, timeout_ms }
  // promptContent: contents of gemini-<persona>.md

  assertHcomTargetRunning(agentConfig.target);     // throws if missing/stopped

  const envelope = formatEnvelope({ persona: agentConfig.persona, brief, question, promptContent });
  const msgId    = hcomSend(agentConfig.target, envelope, { intent: 'request' });
  const reply    = hcomListen({ from: agentConfig.target, replyTo: msgId,
                                timeoutSec: Math.ceil(agentConfig.timeout_ms / 1000) });

  return reply.text;
}
```

**Envelope format (sent to Gemini):**

```text
## PERSONA
<contents of gemini-<persona>.md>

## DESIGN BRIEF
<contents of .claude/auto-brainstorm-brief.md>

## QUESTION
<AskUserQuestion question text>

Options:
  A. <label> — <description>
  B. <label> — <description>
  Other. (free-form)

## RESPONSE FORMAT
Reply with one line: the label you pick (e.g., "B"), optionally followed by a brief
explanation on the next line. For free-form answers, write: "Other: <your answer>"
```

**CLI invocation:**

- `hcom send @<target> --intent request --from auto-brainstorm --file <tmpfile>`
  (use `--file` to avoid shell escaping the multiline envelope)
- `hcom listen --from <target> --reply-to <id> --timeout <sec> --json`

Both shelled via `execFileSync`. hcom emits JSON with the listen result; we read `text`.

**`assertHcomTargetRunning(target)`**: runs `hcom list --json`, confirms target exists and isn't `stopped`. Throws a typed error on miss; orchestrator catches and escalates.

## Config changes

`config/default.yml`:

```yaml
classifier:
  model: haiku
  confidence_threshold: 0.7
  max_consecutive_rejections: 3

session:
  brief_path: .claude/auto-brainstorm-brief.md
  state_dir: /tmp
  cleanup_on_end: true

hcom:
  target: gemini
  timeout_ms: 60000

agents:
  answerer:
    description: >
      Answers clarifying questions about user intent, goals,
      constraints, and preferences.
    order: 1
    handler: hcom
    persona: user-stand-in
    prompt: prompts/gemini-user.md

  design-critic:
    description: >
      Evaluates design approaches, trade-offs, section approval.
    order: 2
    handler: hcom
    persona: critic
    prompt: prompts/gemini-critic.md

  spec-reviewer:
    description: >
      Validates written spec for completeness and clarity.
    order: 3
    handler: hcom
    persona: spec-reviewer
    prompt: prompts/gemini-spec-reviewer.md

handler_defaults:
  sdk: { max_turns: 1 }
  webhook: { method: POST, timeout: 30000, headers: { Content-Type: application/json } }
  command: { timeout: 10000 }
  hcom: { timeout_ms: 60000 }
```

**Back-compat:** users who want the old behavior swap `handler: hcom` → `handler: sdk` per agent. No breaking change to the handler plugin API or to the SDK/webhook/command handlers.

## Persona prompts

Three new files under `prompts/`, each ~200-400 words. Each ends with the same output-format directive so `answer-mapper.mjs` parses reliably.

- **`gemini-user.md`** — "You are acting as the user who wants this project built. Use only the brief to answer. Prefer the option that best matches the brief; if none fit, reply `Other:` with a short free-form answer. Don't invent requirements not in the brief."

- **`gemini-critic.md`** — "You are reviewing a proposed design or approach. Pick the option most aligned with the brief, but briefly name the biggest risk you see. If there's a serious flaw, reply `Other: <alternative>`. Don't rubber-stamp."

- **`gemini-spec-reviewer.md`** — "You are reviewing a written spec section. Check: placeholders/TODOs, internal contradictions, ambiguity, scope creep. Pick the option that matches your honest read. Keep response terse."

## Gemini lifecycle

**Pre-launched by the user, not managed by the plugin.** Before starting a session:

```bash
hcom gemini --name gemini
```

The plugin's `SKILL.md` gets a one-line prereq added to "Before You Start":

> Ensure `hcom gemini --name gemini` is running in another terminal before starting. The skill checks this on the first question and escalates to you if not running.

**Why not auto-launch:** `hcom gemini` needs a terminal pane and may need auth / TUI interaction on first start. Keeping the plugin's blast radius small and matching hcom's own usage model.

## Error handling

Every failure escalates cleanly to the human. The plugin never makes things worse than vanilla brainstorming.

| Failure | Behavior |
| --- | --- |
| `hcom gemini` not running | Escalate first attempt. Reason: *"Target `gemini` is not running. Run `hcom gemini --name gemini` and retry."* User answers that one question; next question auto-answers once gemini is up. |
| `hcom send` non-zero exit | Handler throws → orchestrator catches → escalate with stderr message. |
| `hcom listen` timeout (60s default) | Escalate. Increment rejection counter. 3 strikes → hard escalate as per existing logic. |
| Gemini replies unparseably | `answer-mapper.mjs` falls back to `Other: <raw>`. If no `Other` option is available, returns `null`, counter ticks. |
| Gemini replies with an unknown label | Fuzzy-match; on no confident match → `Other: <raw>`. |
| Any other throw | `try/catch` at hook boundary → `exit 0` with no JSON → tool runs normally. |

## Testing plan

**Unit tests** (Node.js built-in `node:test`, fully isolated):

- `tests/answer-mapper.test.js` (new): exact label match, label+explanation, Other with free-form, no-match fallback, multi-question handling, whitespace/case tolerance.
- `tests/handlers/hcom.test.js` (new): stubs `execFileSync`; verifies send args (target, intent, persona tag), listen args (matching `--reply-to`), output extraction. Error paths: missing target, non-zero exit, timeout.
- `tests/auto-answer.test.js` (extend): new test — on `action: answer`, stdout is valid `hookSpecificOutput` JSON with `permissionDecision: "allow"` and populated `updatedInput.answers`; on `action: escalate`, stdout is empty and exit is 0. Existing tests updated for new response format.

**Integration test:**

- `tests/integration/hook-shape.test.js` (new): spawns `auto-answer.mjs` with realistic `AskUserQuestion` payload on stdin; stubs classifier + handler via env var overrides; asserts stdout matches the documented `hookSpecificOutput` schema; asserts exit 0 in both answer and escalate paths.

**Manual smoke test** (documented in `tests/MANUAL.md`):

With `hcom gemini` running, provide a brief, start a brainstorming session. Confirm questions are answered without appearing in your terminal; confirm the final spec-review gate still prompts you; confirm Ctrl-C mid-question escalates gracefully.

**Not tested automatically:**

- hcom itself (external tool)
- Actual Gemini responses (flaky, costs tokens)
- Classifier accuracy (covered by existing tests)

## Success criteria

1. All unit + integration tests pass.
2. Manual smoke test: brainstorming session completes end-to-end with Gemini answering, spec gets written, human reviews final spec.
3. Kill-switch test: kill Gemini mid-session → next question escalates cleanly, session continues with user answering directly.

## Deferred / future work

- **Multi-turn peer-architect dialogue.** If one-shot monologuing feels unsatisfying during approach exploration, add a code path where Claude directly drives `hcom send`/`hcom listen` via `Bash` for that one step, bypassing the hook. Purely additive on top of this design.
- **Auto-launch and lifecycle management** for Gemini, if manual pre-launch becomes annoying.
- **Multiple Gemini instances** (one per persona) if context-bleed between personas degrades quality in practice.
- **Per-persona model selection** (e.g., route critic to a stronger model). Simple config extension.
