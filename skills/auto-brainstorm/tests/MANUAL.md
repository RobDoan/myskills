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
