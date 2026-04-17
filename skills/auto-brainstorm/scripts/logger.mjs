import fs from 'node:fs';

export class Logger {
  constructor(logPath) {
    this.logPath = logPath;
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(this.logPath, line);
  }

  cleanup() {
    try {
      fs.unlinkSync(this.logPath);
    } catch {
      // already gone
    }
  }
}
