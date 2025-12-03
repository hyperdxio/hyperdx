import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

import * as config from '@/config';

export const analyzeIncident = async (context: string) => {
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error('No ANTHROPIC_API_KEY defined');
  }

  const anthropic = createAnthropic({
    apiKey: config.ANTHROPIC_API_KEY,
  });

  const model = anthropic('claude-sonnet-4-5-20250929');

  const prompt = `You are a Site Reliability Engineer (SRE) expert at debugging distributed systems.
You are investigating an incident.
Here is the context (logs/metrics/alerts) associated with the incident:

${context}

Please provide a preliminary analysis:
1. SUMMARY: A brief 1-sentence summary of what seems to be happening.
2. POTENTIAL ROOT CAUSES: List 2-3 likely culprits based on the error messages or patterns.
3. NEXT STEPS: Suggest 2-3 specific things the on-call engineer should check (e.g. "Check the database connection pool size", "Rollback the last deployment to service X").

Keep your response concise and actionable. Do not halllucinate. If you are unsure, say "Insufficient data to determine root cause".
Format your response in Markdown.`;

  const { text } = await generateText({
    model,
    prompt,
  });

  return text;
};

