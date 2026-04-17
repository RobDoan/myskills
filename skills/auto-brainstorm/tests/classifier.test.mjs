import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassifierPrompt, parseClassifierResponse } from '../scripts/classifier.mjs';

describe('buildClassifierPrompt', () => {
  const agents = {
    answerer: { description: 'Answers clarifying questions', order: 1 },
    'design-critic': { description: 'Evaluates designs', order: 2 },
  };

  it('includes question text', () => {
    const prompt = buildClassifierPrompt('What is the goal?', agents, []);
    assert.ok(prompt.includes('What is the goal?'));
  });

  it('includes agent descriptions sorted by order', () => {
    const prompt = buildClassifierPrompt('question', agents, []);
    const answererIdx = prompt.indexOf('answerer');
    const criticIdx = prompt.indexOf('design-critic');
    assert.ok(answererIdx < criticIdx);
  });

  it('includes session history', () => {
    const history = [{ seq: 1, agent: 'answerer', accepted: true }];
    const prompt = buildClassifierPrompt('question', agents, history);
    assert.ok(prompt.includes('answerer'));
    assert.ok(prompt.includes('accepted'));
  });
});

describe('parseClassifierResponse', () => {
  it('parses valid JSON response', () => {
    const result = parseClassifierResponse(
      '{"agent": "answerer", "confidence": 0.95, "reasoning": "clarifying question"}'
    );
    assert.equal(result.agent, 'answerer');
    assert.equal(result.confidence, 0.95);
  });

  it('extracts JSON from text with surrounding content', () => {
    const result = parseClassifierResponse(
      'Here is my analysis:\n{"agent": "design-critic", "confidence": 0.8, "reasoning": "design phase"}\n'
    );
    assert.equal(result.agent, 'design-critic');
  });

  it('returns null for unparseable response', () => {
    const result = parseClassifierResponse('I cannot determine this');
    assert.equal(result, null);
  });

  it('returns null when agent field is missing', () => {
    const result = parseClassifierResponse('{"confidence": 0.9}');
    assert.equal(result, null);
  });
});
