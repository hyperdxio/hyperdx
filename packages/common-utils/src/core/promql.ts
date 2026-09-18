import { convertGranularityToSeconds } from '@/core/utils';
import { SQLInterval } from '@/types';

/** A HyperDX granularity ("5 minute") as a Prometheus step ("300s"). */
export const promqlStep = (granularity: string | undefined): string => {
  if (!granularity || granularity === 'auto') return '60s';
  // convertGranularityToSeconds returns 0 for units it doesn't recognize.
  return `${convertGranularityToSeconds(granularity as SQLInterval) || 60}s`;
};
