import { hdxServer } from '@/api';

import { isSmartSummaryModeEnabled } from './helpers';
import {
  buildEventSummaryPayload,
  buildPatternSummaryPayload,
  buildTraceSummaryPayload,
} from './requestBuilders';
import type {
  SummaryPayload,
  SummaryResponse,
} from './requestTypes';

type AISummaryNotEnabledError = Error & {
  code: 'AI_SUMMARY_NOT_ENABLED';
};

function buildAISummaryNotEnabledError(): AISummaryNotEnabledError {
  const error = new Error(
    'AI summary is not enabled. Configure AI_PROVIDER and AI_API_KEY (or legacy ANTHROPIC_API_KEY), then restart the API.',
  ) as AISummaryNotEnabledError;
  error.code = 'AI_SUMMARY_NOT_ENABLED';
  return error;
}

export async function requestAISummary(
  payload: SummaryPayload,
  options?: { aiEnabled?: boolean },
): Promise<string> {
  if (options?.aiEnabled === false) {
    throw buildAISummaryNotEnabledError();
  }
  const tone =
    isSmartSummaryModeEnabled() && payload.tone ? payload.tone : 'default';
  const response = await hdxServer('ai/summarize', {
    method: 'POST',
    json: { ...payload, tone },
  }).json<SummaryResponse>();

  return response.summary;
}

export {
  buildEventSummaryPayload,
  buildPatternSummaryPayload,
  buildTraceSummaryPayload,
};

export type { SummaryPayload };
