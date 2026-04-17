import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SessionState } from '../scripts/state.mjs';

describe('SessionState', () => {
  let tmpDir;
  let statePath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-brainstorm-test-'));
    statePath = path.join(tmpDir, 'state.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('creates fresh state when file does not exist', () => {
      const state = new SessionState(statePath);
      assert.equal(state.data.total_questions, 0);
      assert.equal(state.data.current_sequence, 0);
      assert.equal(state.data.consecutive_rejections, 0);
      assert.deepEqual(state.data.history, []);
    });

    it('loads existing state from file', () => {
      const existing = {
        session_id: 'test-123',
        total_questions: 3,
        current_sequence: 3,
        consecutive_rejections: 1,
        history: [
          { seq: 1, agent: 'answerer', accepted: true }
        ]
      };
      fs.writeFileSync(statePath, JSON.stringify(existing));
      const state = new SessionState(statePath);
      assert.equal(state.data.total_questions, 3);
      assert.equal(state.data.history.length, 1);
    });

    it('creates fresh state when file is corrupted', () => {
      fs.writeFileSync(statePath, 'not json');
      const state = new SessionState(statePath);
      assert.equal(state.data.total_questions, 0);
    });
  });

  describe('recordNewQuestion', () => {
    it('increments total_questions and current_sequence', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      assert.equal(state.data.total_questions, 1);
      assert.equal(state.data.current_sequence, 1);
      assert.equal(state.data.consecutive_rejections, 0);
    });
  });

  describe('recordRejection', () => {
    it('increments consecutive_rejections without changing sequence', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      state.recordAnswer('answerer', 'some answer');
      state.recordRejection();
      assert.equal(state.data.consecutive_rejections, 1);
      assert.equal(state.data.current_sequence, 1);
    });
  });

  describe('recordAnswer', () => {
    it('adds entry to history', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      state.recordAnswer('answerer', 'my answer');
      assert.equal(state.data.history.length, 1);
      assert.equal(state.data.history[0].agent, 'answerer');
      assert.equal(state.data.history[0].answer, 'my answer');
      assert.equal(state.data.history[0].seq, 1);
    });
  });

  describe('shouldEscalate', () => {
    it('returns false when under threshold', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      state.recordAnswer('answerer', 'a1');
      state.recordRejection();
      assert.equal(state.shouldEscalate(3), false);
    });

    it('returns true when at threshold', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      state.recordAnswer('answerer', 'a1');
      state.recordRejection();
      state.recordAnswer('answerer', 'a2');
      state.recordRejection();
      state.recordAnswer('answerer', 'a3');
      state.recordRejection();
      assert.equal(state.shouldEscalate(3), true);
    });
  });

  describe('getHistory', () => {
    it('returns formatted history for classifier context', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      state.recordAnswer('answerer', 'a1');
      state.recordNewQuestion();
      state.recordAnswer('design-critic', 'a2');
      const history = state.getHistory();
      assert.equal(history.length, 2);
      assert.equal(history[0].agent, 'answerer');
      assert.equal(history[1].agent, 'design-critic');
    });
  });

  describe('save and cleanup', () => {
    it('persists state to disk', () => {
      const state = new SessionState(statePath);
      state.recordNewQuestion();
      state.save();
      assert.ok(fs.existsSync(statePath));
      const loaded = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.equal(loaded.total_questions, 1);
    });

    it('cleanup removes state file', () => {
      const state = new SessionState(statePath);
      state.save();
      state.cleanup();
      assert.ok(!fs.existsSync(statePath));
    });
  });
});
