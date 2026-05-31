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

  it('returns hcom handler for hcom type', () => {
    const handler = getHandler('hcom');
    assert.equal(typeof handler, 'function');
  });

  it('throws for unknown handler type', () => {
    assert.throws(() => getHandler('unknown'), /Unknown handler type/);
  });
});
