const axios = require('axios');

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Calls Gemini and returns the parsed JSON object from its reply.
// Throws an error with code 'NO_API_KEY' when GEMINI_API_KEY is not set.
async function geminiJSON(prompt, { temperature = 0.3 } = {}) {
  if (!process.env.GEMINI_API_KEY) {
    const err = new Error('GEMINI_API_KEY is not configured on the server.');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature }
    },
    {
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY },
      timeout: 90000
    }
  );

  const parts = response.data?.candidates?.[0]?.content?.parts || [];
  const raw = parts.map(p => p.text || '').join('');
  if (!raw) throw new Error('Gemini returned an empty response.');

  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

module.exports = { geminiJSON };