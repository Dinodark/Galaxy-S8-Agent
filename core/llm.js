const axios = require('axios');
const config = require('../config');

async function chatCompletion({ messages, tools, toolChoice = 'auto' }) {
  const body = {
    model: config.openrouter.model,
    messages,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }

  const res = await axios.post(
    `${config.openrouter.baseUrl}/chat/completions`,
    body,
    {
      headers: {
        Authorization: `Bearer ${config.openrouter.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/Dinodark/Galaxy-S8-Agent',
        'X-Title': 'Galaxy S8 Agent',
      },
      timeout: 60_000,
    }
  );

  const choice = res.data.choices && res.data.choices[0];
  if (!choice) {
    throw new Error('OpenRouter returned no choices');
  }
  return choice.message;
}

module.exports = { chatCompletion };
