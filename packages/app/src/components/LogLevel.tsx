import {
  collapseSeverityClass,
  getSeverityClass,
  getSeverityLabel,
} from '@hyperdx/common-utils/dist/core/severity';
import { Text, TextProps } from '@mantine/core';

export default function LogLevel({
  level,
  severityNumber,
  ...props
}: { level?: string | null; severityNumber?: unknown } & TextProps) {
  const label = getSeverityLabel({ severityNumber, severityText: level });
  if (!label) return null;

  const levelClass = collapseSeverityClass(
    getSeverityClass({ severityNumber, severityText: level }),
  );
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
      {label}
    </Text>
  );
}
