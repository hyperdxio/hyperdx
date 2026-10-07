import React from 'react';
import Link from 'next/link';
import {
  Group,
  Loader,
  Paper,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconCheck, IconChevronRight } from '@tabler/icons-react';

import { OnboardingStep } from './onboardingTasks';

export function StepRow({
  step,
  isActive,
}: {
  step: OnboardingStep;
  isActive: boolean;
}) {
  const isActionable =
    !step.isComplete && (step.href != null || step.onClick != null);

  // Tokens via `style` since ThemeIcon's `color` prop only takes palette names.
  const circle = step.isComplete ? (
    <ThemeIcon
      size={16}
      radius="xl"
      variant="filled"
      style={{
        backgroundColor: 'var(--color-bg-success-subtle)',
        color: 'var(--color-text-success)',
      }}
    >
      <IconCheck size={11} stroke={3} />
    </ThemeIcon>
  ) : step.isLoading ? (
    <Loader size={16} color="var(--color-text-muted)" />
  ) : (
    <ThemeIcon
      size={16}
      radius="xl"
      variant="outline"
      style={{ borderColor: 'var(--color-border)', color: 'transparent' }}
    />
  );

  const stepContent = (
    <Group gap="sm" align="center" w="100%" wrap="nowrap">
      {circle}
      <Text
        size="sm"
        c={step.isComplete ? 'dimmed' : undefined}
        fw={isActive ? 600 : 400}
        td={step.isComplete ? 'line-through' : undefined}
        flex={1}
      >
        {step.title}
      </Text>
      {isActionable && (
        <IconChevronRight
          size={16}
          color="var(--color-text-muted)"
          style={{ flexShrink: 0 }}
        />
      )}
    </Group>
  );

  // The active step is elevated onto a surface card.
  const rowBody = isActive ? (
    <Paper withBorder radius="md" px="sm" py="xs" bg="var(--color-bg-surface)">
      {stepContent}
    </Paper>
  ) : (
    <Group px="sm" py={4}>
      {stepContent}
    </Group>
  );

  // Description surfaces on hover, only for incomplete tasks.
  const row =
    !step.isComplete && step.description ? (
      <Tooltip
        label={step.description}
        fz="xs"
        color="gray"
        position="right"
        openDelay={250}
        withArrow
      >
        {rowBody}
      </Tooltip>
    ) : (
      rowBody
    );

  if (step.href && !step.isComplete) {
    return (
      <UnstyledButton component={Link} href={step.href} w="100%">
        {row}
      </UnstyledButton>
    );
  }

  if (step.onClick && !step.isComplete) {
    return (
      <UnstyledButton w="100%" onClick={step.onClick}>
        {row}
      </UnstyledButton>
    );
  }

  return <React.Fragment>{row}</React.Fragment>;
}
