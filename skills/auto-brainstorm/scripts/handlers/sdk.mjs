export async function handleSdk(question, brief, agentConfig, promptContent) {
  const { query } = await import('@anthropic-ai/claude-code');

  const systemPrompt = promptContent;
  const userPrompt = [
    '## Design Brief',
    brief,
    '',
    '## Question',
    question,
  ].join('\n');

  const result = await query({
    prompt: userPrompt,
    options: {
      model: agentConfig.model,
      maxTurns: agentConfig.max_turns || 1,
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

  return response;
}
