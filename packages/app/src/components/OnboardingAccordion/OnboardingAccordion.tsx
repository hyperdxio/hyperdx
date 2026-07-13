import React, { useCallback, useState } from 'react';
import {
  Anchor,
  Box,
  Card,
  Center,
  Collapse,
  Group,
  RingProgress,
  Stack,
  Text,
} from '@mantine/core';
import { IconCheck, IconChevronDown } from '@tabler/icons-react';

import {
  type ProgressStatus,
  StatusBadge,
  StatusCircle,
} from '@/components/GettingStarted/SummaryRow';

export type OnboardingStepStatus = 'complete' | 'active' | 'upcoming';

function toProgressStatus(status: OnboardingStepStatus): ProgressStatus {
  if (status === 'complete') return 'completed';
  if (status === 'active') return 'in-progress';
  return 'not-started';
}

export interface OnboardingStep {
  /** Stable identifier used to control which step is expanded. */
  id: string;
  title: React.ReactNode;
  /** Always-visible supporting copy rendered under the title. */
  description?: React.ReactNode;
  status: OnboardingStepStatus;
  /** Right-aligned metadata in the header row (e.g. "updated 2s ago"). */
  meta?: React.ReactNode;
  /** Body revealed when the step is expanded. */
  children?: React.ReactNode;
  /**
   * Whether the step header toggles its body. Defaults to `false` for
   * completed steps (their summary stays visible) and `true` otherwise.
   */
  collapsible?: boolean;
}

export interface OnboardingAccordionProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /**
   * Informational content rendered between the header and the steps (e.g. a
   * summary of an already-provisioned resource). Unlike a step, it carries no
   * status indicator or expand affordance.
   */
  banner?: React.ReactNode;
  steps: OnboardingStep[];
  /** Uncontrolled: id of the step expanded on first render. */
  defaultOpenStep?: string;
  /** Controlled: id of the expanded step (`null` collapses all). */
  openStep?: string | null;
  onOpenStepChange?: (id: string | null) => void;
  /**
   * When provided, a "Remove from sidebar" control is rendered in the footer so
   * users can hide the getting-started entry before finishing every step.
   */
  onDismiss?: () => void;
}

const INDICATOR_SIZE = 20;

/**
 * Compact "how far along am I" indicator shown in the accordion header: a
 * circular progress ring plus a "N of M complete" label, in the spirit of
 * Adaline's onboarding ring. The ring fills as steps complete and swaps to a
 * success checkmark once everything is done.
 */
function StepProgress({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const allDone = total > 0 && completed >= total;
  const pct = total > 0 ? (completed / total) * 100 : 0;
  const label = allDone
    ? 'All steps complete'
    : `${completed} of ${total} complete`;

  return (
    <Group gap={10} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
      <Text
        fz={13}
        fw={500}
        style={{ color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}
      >
        {label}
      </Text>
      <RingProgress
        size={26}
        thickness={3}
        roundCaps
        rootColor="var(--color-border-emphasis)"
        sections={[
          {
            value: pct,
            color: allDone ? 'var(--color-text-success)' : 'var(--color-text)',
          },
        ]}
        label={
          allDone ? (
            <Center>
              <IconCheck
                size={12}
                stroke={2.5}
                style={{ color: 'var(--color-text-success)' }}
              />
            </Center>
          ) : undefined
        }
      />
    </Group>
  );
}

function StepCard({
  step,
  isOpen,
  onToggle,
}: {
  step: OnboardingStep;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const collapsible = step.collapsible ?? step.status !== 'complete';
  const showBody = collapsible ? isOpen : true;
  const isMuted = step.status === 'upcoming' && !isOpen;

  const header = (
    <Group justify="space-between" wrap="nowrap" align="center" w="100%">
      <Group gap="sm" wrap="nowrap" align="center" style={{ minWidth: 0 }}>
        <StatusCircle
          status={toProgressStatus(step.status)}
          size={INDICATOR_SIZE}
          checkSize={13}
        />
        <Text
          fw={700}
          fz={18}
          lh={1.2}
          style={{
            color: isMuted ? 'var(--color-text-muted)' : 'var(--color-text)',
          }}
        >
          {step.title}
        </Text>
      </Group>
      <Group gap="md" wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
        <StatusBadge status={toProgressStatus(step.status)} />
        {step.meta ? (
          <Text fz={13} style={{ color: 'var(--color-text-muted)' }}>
            {step.meta}
          </Text>
        ) : null}
        {collapsible && (
          <IconChevronDown
            size={20}
            style={{
              color: 'var(--color-text-muted)',
              transform: isOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 150ms ease',
            }}
          />
        )}
      </Group>
    </Group>
  );

  return (
    <Card withBorder radius={8} p={24}>
      <Stack gap={8}>
        {collapsible ? (
          <Box
            component="button"
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            style={{
              all: 'unset',
              cursor: 'pointer',
              width: '100%',
              display: 'block',
            }}
          >
            {header}
          </Box>
        ) : (
          header
        )}

        {step.description ? (
          <Text fz={14} lh={1.45} style={{ color: 'var(--color-text-muted)' }}>
            {step.description}
          </Text>
        ) : null}
      </Stack>

      {step.children ? (
        collapsible ? (
          <Collapse expanded={showBody}>
            <Box pt={22}>{step.children}</Box>
          </Collapse>
        ) : (
          <Box pt={16}>{step.children}</Box>
        )
      ) : null}
    </Card>
  );
}

/**
 * Onboarding accordion used to walk a new user through getting telemetry
 * flowing. Each step renders a status indicator (complete / active /
 * upcoming), an always-visible title + description, and a collapsible body.
 *
 * The expanded step can be controlled via `openStep`/`onOpenStepChange`, or
 * left uncontrolled with `defaultOpenStep`.
 */
export function OnboardingAccordion({
  title,
  description,
  banner,
  steps,
  defaultOpenStep,
  openStep,
  onOpenStepChange,
  onDismiss,
}: OnboardingAccordionProps) {
  const isControlled = openStep !== undefined;
  const [internalOpen, setInternalOpen] = useState<string | null>(
    defaultOpenStep ?? null,
  );
  const currentOpen = isControlled ? openStep : internalOpen;

  const completedCount = steps.filter(
    step => step.status === 'complete',
  ).length;

  const handleToggle = useCallback(
    (id: string) => {
      const next = currentOpen === id ? null : id;
      if (!isControlled) {
        setInternalOpen(next);
      }
      onOpenStepChange?.(next);
    },
    [currentOpen, isControlled, onOpenStepChange],
  );

  return (
    <Stack gap={16}>
      {title || description || steps.length > 0 ? (
        <Group
          justify="space-between"
          align="flex-start"
          wrap="nowrap"
          gap="md"
          mb={8}
        >
          <Stack gap={6} style={{ minWidth: 0 }}>
            {title ? (
              <Text
                fw={700}
                fz={20}
                lh={1.2}
                style={{ color: 'var(--color-text)' }}
              >
                {title}
              </Text>
            ) : null}
            {description ? (
              <Text
                fz={14}
                lh={1.45}
                style={{ color: 'var(--color-text-muted)' }}
              >
                {description}
              </Text>
            ) : null}
          </Stack>
          {steps.length > 0 ? (
            <Box style={{ flexShrink: 0 }}>
              <StepProgress completed={completedCount} total={steps.length} />
            </Box>
          ) : null}
        </Group>
      ) : null}

      {banner ? <Box>{banner}</Box> : null}

      {steps.map(step => (
        <StepCard
          key={step.id}
          step={step}
          isOpen={currentOpen === step.id}
          onToggle={() => handleToggle(step.id)}
        />
      ))}

      {onDismiss ? (
        <Group gap={5} justify="center" align="center" wrap="nowrap" mt={4}>
          <Text fz={13} style={{ color: 'var(--color-text-muted)' }}>
            Don&apos;t want to see this in the sidebar?
          </Text>
          <Anchor
            component="button"
            type="button"
            onClick={onDismiss}
            fz={13}
            fw={500}
            style={{ color: 'var(--color-text-muted)' }}
          >
            Remove from sidebar
          </Anchor>
        </Group>
      ) : null}
    </Stack>
  );
}
