import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;

export const openaiEnabled = Boolean(apiKey);

export const openai = openaiEnabled
  ? new OpenAI({ apiKey })
  : null;

export const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
