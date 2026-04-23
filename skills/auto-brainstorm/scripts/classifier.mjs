import fs from 'node:fs';

export function buildClassifierPrompt(question, agents, history) {
  const sortedAgents = Object.entries(agents)
    .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0))
    .map(([name, agent]) => `- **${name}** (order: ${agent.order}): ${agent.description}`)
    .join('\n');

  const historyText =
    history.length > 0
      ? history
          .map((h) => `  seq ${h.seq}: ${h.agent} (accepted: ${h.accepted})`)
          .join('\n')
      : '  (no prior questions)';

  return [
    '## Question',
    question,
    '',
    '## Available Agents',
    sortedAgents,
    '',
    '## Session History',
    historyText,
  ].join('\n');
}

export function parseClassifierResponse(text) {
  try {
    const match = text.match(/\{[^}]*"agent"[^}]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed.agent) return null;
    return {
      agent: parsed.agent,
      confidence: parsed.confidence ?? 0,
      reasoning: parsed.reasoning ?? '',
    };
  } catch {
    return null;
  }
}

export async function classify(question, agents, history, classifierConfig) {
  if (process.env.AUTO_BRAINSTORM_TEST_CLASSIFIER) {
    try { return JSON.parse(process.env.AUTO_BRAINSTORM_TEST_CLASSIFIER); }
    catch { /* fall through to real classifier */ }
  }

  const { query } = await import('@anthropic-ai/claude-code');

  const systemPromptPath = classifierConfig.promptPath;
  const systemPrompt = fs.readFileSync(systemPromptPath, 'utf8');
  const userPrompt = buildClassifierPrompt(question, agents, history);

  const result = await query({
    prompt: userPrompt,
    options: {
      model: classifierConfig.model || 'haiku',
      maxTurns: 1,
      systemPrompt,
    },
  });

  let response = '';
  for await (const message of result) {
    if (message.type === 'assistant') {
      response += message.message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
    }
  }

  return parseClassifierResponse(response);
}
