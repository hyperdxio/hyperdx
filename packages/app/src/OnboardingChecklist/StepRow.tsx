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

  const circle = step.isComplete ? (
    <ThemeIcon size={16} radius="xl" color="green" variant="filled">
      <IconCheck size={11} stroke={3} color="#fff" />
    </ThemeIcon>
  ) : step.isLoading ? (
    <Loader size={16} color="gray" />
  ) : (
    <ThemeIcon size={16} radius="xl" variant="outline" color="gray.4" />
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

  // The active (next) step is elevated onto a surface card; every other row is
  // flush against the muted card background.
  const rowBody = isActive ? (
    <Paper withBorder radius="md" px="sm" py="xs" bg="var(--color-bg-surface)">
      {stepContent}
    </Paper>
  ) : (
    <Group px="sm" py={4}>
      {stepContent}
    </Group>
  );

  // The row shows only the title; the description (what to do) surfaces on hover
  // for a task that isn't done yet — a completed, struck-through task needs no
  // instructions.
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
