import { ReactNode } from 'react';
import { Group, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconHelp } from '@tabler/icons-react';

/** One of the caution icons a filter's label row can carry, with its tooltip. */
export const FilterCaution = ({
  label,
  testId,
  variant = 'warning',
}: {
  label: string;
  testId: string;
  variant?: 'warning' | 'danger';
}) => (
  <Tooltip label={label} withinPortal multiline maw={400}>
    <IconAlertTriangle
      size={12}
      color={`var(--color-text-${variant})`}
      data-testid={testId}
    />
  </Tooltip>
);

/**
 * The row above a dashboard filter's input: its name, what it does, and any
 * cautions passed as children.
 */
export const DashboardFilterLabel = ({
  name,
  effect,
  children,
}: {
  name: string;
  effect: { hasEffect: boolean; tooltip: string };
  children?: ReactNode;
}) => (
  <Group gap={4} align="center" wrap="nowrap">
    <Text size="xs" c="dimmed">
      {name}
    </Text>
    <Tooltip label={effect.tooltip} withinPortal>
      {effect.hasEffect ? (
        <IconHelp
          size={12}
          color="var(--color-text-muted)"
          data-testid={`dashboard-filter-help-${name}`}
        />
      ) : (
        <IconAlertTriangle
          size={12}
          color="var(--color-text-warning)"
          data-testid={`dashboard-filter-no-effect-${name}`}
        />
      )}
    </Tooltip>
    {children}
  </Group>
);
