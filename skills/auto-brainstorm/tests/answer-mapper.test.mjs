import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswersMap } from '../scripts/answer-mapper.mjs';

const Q1 = {
  question: 'Which approach?',
  options: [
    { label: 'A', description: 'Simple' },
    { label: 'B', description: 'Complex' },
    { label: 'Other', description: 'Free-form' },
  ],
};

describe('buildAnswersMap — single question', () => {
  it('matches exact label', () => {
    const out = buildAnswersMap([Q1], 'B');
    assert.deepEqual(out.answers, { 'Which approach?': 'B' });
    assert.deepEqual(out.unmatched, []);
  });

  it('matches label with trailing explanation', () => {
    const out = buildAnswersMap([Q1], 'B. Because it matches the brief');
    assert.equal(out.answers['Which approach?'], 'B');
  });

  it('matches "Option X" prefix form', () => {
    const out = buildAnswersMap([Q1], 'Option A');
    assert.equal(out.answers['Which approach?'], 'A');
  });

  it('is case-insensitive', () => {
    const out = buildAnswersMap([Q1], 'b');
    assert.equal(out.answers['Which approach?'], 'B');
  });

  it('tolerates leading/trailing whitespace', () => {
    const out = buildAnswersMap([Q1], '   A   \n');
    assert.equal(out.answers['Which approach?'], 'A');
  });

  it('uses Other when reply starts with "Other:" and Other option exists', () => {
    const out = buildAnswersMap([Q1], 'Other: use SQLite instead');
    assert.equal(out.answers['Which approach?'], 'Other: use SQLite instead');
  });

  it('records unmatched when reply has no label and no Other option exists', () => {
    const q = { question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] };
    const out = buildAnswersMap([q], 'something unrelated');
    assert.equal(out.answers['Pick one'], undefined);
    assert.deepEqual(out.unmatched, ['Pick one']);
  });

  it('falls back to Other when no label matches but Other exists', () => {
    const out = buildAnswersMap([Q1], 'something unrelated');
    assert.equal(out.answers['Which approach?'], 'Other: something unrelated');
  });
});

describe('buildAnswersMap — multiple questions', () => {
  const q1 = { question: 'Q1?', options: [{ label: 'A' }, { label: 'B' }, { label: 'Other' }] };
  const q2 = { question: 'Q2?', options: [{ label: 'Yes' }, { label: 'No' }, { label: 'Other' }] };

  it('splits reply on --- separator', () => {
    const out = buildAnswersMap([q1, q2], 'A\n---\nYes');
    assert.deepEqual(out.answers, { 'Q1?': 'A', 'Q2?': 'Yes' });
  });

  it('splits reply on numbered list', () => {
    const out = buildAnswersMap([q1, q2], '1. B\n2. No');
    assert.deepEqual(out.answers, { 'Q1?': 'B', 'Q2?': 'No' });
  });

  it('applies whole reply to first question when no split found', () => {
    const out = buildAnswersMap([q1, q2], 'A');
    assert.equal(out.answers['Q1?'], 'A');
    assert.deepEqual(out.unmatched, ['Q2?']);
  });
});
