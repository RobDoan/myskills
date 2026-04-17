import { execSync } from 'node:child_process';

export function handleCommand(question, brief, agentConfig) {
  const command = agentConfig.command;
  if (!command) throw new Error('Command handler requires a "command" in agent config');

  const timeout = agentConfig.timeout || 10000;

  const result = execSync(command, {
    encoding: 'utf8',
    timeout,
    env: {
      ...process.env,
      AUTO_BRAINSTORM_QUESTION: question,
      AUTO_BRAINSTORM_BRIEF: brief,
    },
  });

  return result.trim();
}
