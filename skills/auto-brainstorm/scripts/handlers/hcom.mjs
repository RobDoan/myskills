import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SELF_NAME = 'auto_brainstorm';

function ensureIdentity() {
  // hcom listen requires a registered identity. `start --as <name>` is
  // idempotent-ish: creates or rebinds. Errors are swallowed because the
  // subsequent listen call will surface any real issue.
  try {
    execFileSync('hcom', ['start', '--as', SELF_NAME], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    /* identity may already be registered; listen will report real failures */
  }
}

function realListAgents() {
  try {
    const out = execFileSync('hcom', ['list', '--json'], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    // hcom list --json returns a top-level array of agent objects.
    // Older shapes may wrap them in {agents: [...]}.
    if (Array.isArray(parsed)) return parsed;
    return parsed.agents || [];
  } catch {
    return [];
  }
}

function realSendMessage(target, body, opts) {
  const tmp = path.join(os.tmpdir(), `hcom-envelope-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(tmp, body);
  try {
    // `hcom send` does not support --json or return an event id.
    // It just prints "Sent to: ◉ <target>" to stdout.
    const args = [
      'send', `@${target}`,
      '--intent', opts.intent || 'request',
      '--from', SELF_NAME,
      '--file', tmp,
    ];
    execFileSync('hcom', args, { encoding: 'utf8' });
    return '';
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
  }
}

function eventTextById(id) {
  try {
    const out = execFileSync('hcom', ['events', '--sql', `id=${id}`], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    const lines = out.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return '';
    const event = JSON.parse(lines[0]);
    return String(event?.data?.text ?? event?.data?.body ?? '');
  } catch {
    return '';
  }
}

function realListen({ from, timeoutSec }) {
  ensureIdentity();
  // --name is our registered identity; --from filters to messages from the target.
  const args = [
    'listen', String(timeoutSec),
    '--name', SELF_NAME,
    '--from', from,
    '--json',
  ];
  const out = execFileSync('hcom', args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const trimmed = out.trim();
  if (!trimmed) return { text: '' };

  // `hcom listen --json` returns {matched, notification} where notification
  // is a summary string like `@... | #<id> | message | <agent> | from:<x> | "<excerpt>"`.
  // The excerpt is truncated, so fetch the full event by ID.
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.notification) {
      const notification = String(parsed.notification);
      const idMatch = /#(\d+)/.exec(notification);
      if (idMatch) {
        const fullText = eventTextById(idMatch[1]);
        if (fullText) return { text: fullText };
      }
      // Fall back to the excerpt in the notification if event fetch failed.
      const excerptMatch = /\|\s*"([\s\S]*)"\s*$/.exec(notification);
      if (excerptMatch) return { text: excerptMatch[1] };
    }
    // Older shape: raw event object
    if (parsed?.data?.text) return { text: String(parsed.data.text) };
    if (parsed.text || parsed.body || parsed.message) {
      return { text: String(parsed.text ?? parsed.body ?? parsed.message) };
    }
  } catch { /* fall through */ }

  return { text: trimmed };
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
    throw new Error(
      `hcom target "${target}" is not running. Start it with: hcom gemini --name ${target}`
    );
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
  deps().sendMessage(target, body, { intent: 'request' });
  const reply = deps().listen({
    from: target,
    timeoutSec: Math.ceil(timeoutMs / 1000),
  });

  return reply.text;
}
