import { COLORS } from '@/utils';

/**
 * Stable color for the Nth selected source in a multi-source search. Indexed
 * by position in the selection (not hashed) so the ≤MAX_SEARCH_SOURCES badges
 * never collide; the same assignment is used by the results table badge, the
 * histogram series, and the per-source status chips so a source reads as one
 * color everywhere on the page.
 */
export function getMultiSourceColor(index: number): string {
  return COLORS[index % COLORS.length];
}

/** Colored-dot source label used in the merged results table. */
export function SourceBadge({ name, color }: { name: string; color?: string }) {
  return (
    <span
      className="d-inline-flex align-items-center text-truncate"
      style={{ gap: 6, maxWidth: '100%' }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'inline-block',
          backgroundColor: color ?? 'var(--mantine-color-gray-6)',
        }}
      />
      <span className="text-truncate">{name}</span>
    </span>
  );
}
