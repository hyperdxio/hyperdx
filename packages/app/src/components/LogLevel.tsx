import React from 'react';
import { Text, TextProps } from '@mantine/core';

import { getLogLevelClass } from '@/utils';

/**
 * `level` always drives the color. Pass `children` to render something other
 * than the bare string — e.g. the same text with search matches marked up.
 */
export default function LogLevel({
  level,
  children,
  ...props
}: { level: string; children?: React.ReactNode } & TextProps) {
  const levelClass = getLogLevelClass(level);

  return (
    <Text
      component="span"
      size="xs"
      c={
        levelClass === 'error'
          ? 'red'
          : levelClass === 'warn'
            ? 'var(--color-chart-warning)'
            : 'gray'
      }
      {...props}
    >
      {children ?? level}
    </Text>
  );
}
