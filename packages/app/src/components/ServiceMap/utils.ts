import router from 'next/router';
import { TSource } from '@hyperdx/common-utils/dist/types';

export function navigateToTraceSearch({
  dateRange,
  source,
  where,
}: {
  dateRange: [Date, Date];
  source: TSource;
  where: string;
}) {
  const from = dateRange[0].getTime().toString();
  const to = dateRange[1].getTime().toString();
  const query = new URLSearchParams({
    isLive: 'false',
    source: source?.id,
    where,
    whereLanguage: 'sql',
    from,
    to,
  });

  router.push(`/search?${query.toString()}`);
}

export function formatApproximateNumber(num: number): string {
  if (num < 1000) {
    return `~${num.toString()}`;
  }

  if (num < 1_000_000) {
    const thousands = num / 1000;
    return `~${Math.round(thousands)}k`;
  }

  if (num < 1_000_000_000) {
    const millions = num / 1_000_000;
    return `~${Math.round(millions)}M`;
  }

  const billions = num / 1_000_000_000;
  return `~${Math.round(billions)}B`;
}

export function getNodeColors(
  errorPercent: number,
  maxErrorPercent: number,
  isSelected: boolean,
) {
  const saturation =
    maxErrorPercent > 0
      ? (Math.min(errorPercent, maxErrorPercent) / maxErrorPercent) * 100
      : 0;
  const backgroundColor = `hsl(0 ${saturation}% 80%)`;
  const borderColor = isSelected ? 'white' : `hsl(0 ${saturation}% 40%)`;

  return {
    backgroundColor,
    borderColor,
  };
}
