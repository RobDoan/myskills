import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function realListAgents() {
  try {
    const out = execFileSync('hcom', ['list', '--json'], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
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
  const out = execFileSync('hcom', args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
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
  const msgId = deps().sendMessage(target, body, { intent: 'request' });
  const reply = deps().listen({
    from: target,
    replyTo: msgId,
    timeoutSec: Math.ceil(timeoutMs / 1000),
  });

  return reply.text;
}
