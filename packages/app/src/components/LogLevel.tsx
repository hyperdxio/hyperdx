import { Text, TextProps } from '@mantine/core';

import { getLogLevelClass } from '@/utils';

export default function LogLevel({
  level,
  ...props
}: { level: string } & TextProps) {
  const levelClass = getLogLevelClass(level);

  return (
    <Text
      component="span"
      size="xs"
      c={
        levelClass === 'error'
          ? 'red'
          : levelClass === 'warn'
            ? 'yellow'
            : 'gray.4'
      }
      {...props}
    >
      {level}
    </Text>
  );
}
