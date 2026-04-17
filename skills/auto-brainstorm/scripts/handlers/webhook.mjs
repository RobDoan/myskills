export async function handleWebhook(question, brief, agentConfig) {
  const url = agentConfig.url;
  if (!url) throw new Error('Webhook handler requires a "url" in agent config');

  const method = agentConfig.method || 'POST';
  const timeout = agentConfig.timeout || 30000;
  const headers = agentConfig.headers || { 'Content-Type': 'application/json' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: JSON.stringify({ question, brief }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return data.answer || data.response || JSON.stringify(data);
  } finally {
    clearTimeout(timer);
  }
}
