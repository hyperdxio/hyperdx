import React from 'react';

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
