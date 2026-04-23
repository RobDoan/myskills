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
  beforeEach(() => _setDeps(null));

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

  it('listens with correct from and timeout', async () => {
    const { calls } = stubDeps({
      listen: (opts) => {
        calls.listen.push(opts);
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
