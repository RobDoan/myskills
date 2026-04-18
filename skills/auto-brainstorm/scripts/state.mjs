import fs from 'node:fs';

export class SessionState {
  constructor(filePath, sessionId) {
    this.filePath = filePath;
    this.sessionId = sessionId || `session-${Date.now()}`;
    this.data = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      // Reset if state is from a different session
      if (parsed.session_id !== this.sessionId) {
        return this._fresh();
      }
      return parsed;
    } catch {
      return this._fresh();
    }
  }

  _fresh() {
    return {
      session_id: this.sessionId,
      total_questions: 0,
      current_sequence: 0,
      consecutive_rejections: 0,
      history: [],
    };
  }

  recordNewQuestion() {
    this.data.total_questions++;
    this.data.current_sequence++;
    this.data.consecutive_rejections = 0;
  }

  recordRejection() {
    this.data.consecutive_rejections++;
  }

  recordAnswer(agent, answer) {
    this.data.history.push({
      seq: this.data.current_sequence,
      agent,
      answer,
      accepted: false,
      timestamp: new Date().toISOString(),
    });
  }

  shouldEscalate(maxRejections) {
    return this.data.consecutive_rejections >= maxRejections;
  }

  getHistory() {
    return this.data.history.map(({ seq, agent, accepted }) => ({
      seq,
      agent,
      accepted,
    }));
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  cleanup() {
    try {
      fs.unlinkSync(this.filePath);
    } catch {
      // already gone
    }
  }
}
