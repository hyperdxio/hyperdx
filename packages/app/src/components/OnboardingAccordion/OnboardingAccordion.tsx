import React, { useCallback, useState } from 'react';
import { Box, Card, Collapse, Group, Stack, Text } from '@mantine/core';
import { IconCheck, IconChevronDown } from '@tabler/icons-react';

export type OnboardingStepStatus = 'complete' | 'active' | 'upcoming';

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
}

const INDICATOR_SIZE = 20;

function StepIndicator({ status }: { status: OnboardingStepStatus }) {
  if (status === 'complete') {
    return (
      <Box
        style={{
          width: INDICATOR_SIZE,
          height: INDICATOR_SIZE,
          borderRadius: '50%',
          background: 'var(--color-text)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <IconCheck
          size={13}
          stroke={2.5}
          style={{ color: 'var(--color-text-inverted)' }}
        />
      </Box>
    );
  }

  return (
    <Box
      style={{
        width: INDICATOR_SIZE,
        height: INDICATOR_SIZE,
        borderRadius: '50%',
        border: '1.25px dashed var(--color-border-emphasis)',
        flexShrink: 0,
        opacity: status === 'upcoming' ? 0.7 : 1,
      }}
    />
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
        <StepIndicator status={step.status} />
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
}: OnboardingAccordionProps) {
  const isControlled = openStep !== undefined;
  const [internalOpen, setInternalOpen] = useState<string | null>(
    defaultOpenStep ?? null,
  );
  const currentOpen = isControlled ? openStep : internalOpen;

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
      {title || description ? (
        <Stack gap={6} mb={8}>
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
    </Stack>
  );
}

export default OnboardingAccordion;
