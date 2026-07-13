import { type ReactNode } from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

// Nested getting-started indicators are deliberately a notch smaller than the
// parent step indicator (a 20px circle with a 13px check) so the hierarchy
// reads correctly: parent step > items inside it.
const NESTED_CIRCLE_SIZE = 18;
const NESTED_CHECK_SIZE = 11;
const ICON_CHIP_SIZE = 36;

/** Three-state progress used by status badges and circles. */
export type ProgressStatus = 'completed' | 'in-progress' | 'not-started';

interface StatusMeta {
  label: string;
  /** Foreground (text / icon / border accent). */
  fg: string;
  /** Soft badge background. */
  bg: string;
}

// Each state owns a color so badges and circles read consistently: green =
// done, amber = in progress, neutral = not started. Backgrounds are soft tints
// of the same accent so they sit quietly next to the content.
const STATUS_META: Record<ProgressStatus, StatusMeta> = {
  completed: {
    label: 'Completed',
    fg: 'var(--color-text-success)',
    bg: 'color-mix(in srgb, var(--color-text-success) 16%, transparent)',
  },
  'in-progress': {
    label: 'In progress',
    fg: 'var(--color-bg-warning)',
    bg: 'color-mix(in srgb, var(--color-bg-warning) 18%, transparent)',
  },
  'not-started': {
    label: 'Not started',
    fg: 'var(--color-text-muted)',
    bg: 'var(--color-bg-muted)',
  },
};

function IconChip({ children }: { children: ReactNode }) {
  return (
    <Box
      style={{
        width: ICON_CHIP_SIZE,
        height: ICON_CHIP_SIZE,
        borderRadius: 8,
        background: 'var(--color-bg-muted)',
        color: 'var(--color-text-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {children}
    </Box>
  );
}

/**
 * Status circle whose color tracks the state: a filled green check when
 * complete, an amber ring while in progress, and a neutral dashed outline when
 * not started. Sized for nested items by default; pass `size`/`checkSize` for
 * the larger parent step indicator.
 */
export function StatusCircle({
  status,
  size = NESTED_CIRCLE_SIZE,
  checkSize = NESTED_CHECK_SIZE,
}: {
  status: ProgressStatus;
  size?: number;
  checkSize?: number;
}) {
  if (status === 'completed') {
    return (
      <Box
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'var(--color-bg-success)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <IconCheck size={checkSize} stroke={2.5} style={{ color: '#fff' }} />
      </Box>
    );
  }
  // In progress and not started share a neutral gray dashed ring; only the
  // badge carries the amber "in progress" accent.
  return (
    <Box
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '1.25px dashed var(--color-border-emphasis)',
        flexShrink: 0,
      }}
    />
  );
}

/**
 * Shared status circle for nested getting-started items, keyed off a simple
 * done/not-done boolean. Smaller than the parent step indicator.
 */
export function CheckCircle({ done }: { done: boolean }) {
  return <StatusCircle status={done ? 'completed' : 'not-started'} />;
}

/** Adaline-style status badge: Completed / In progress / Not started. */
export function StatusBadge({ status }: { status: ProgressStatus }) {
  const meta = STATUS_META[status];
  return (
    <Box
      style={{
        flexShrink: 0,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.6,
        padding: '2px 10px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        background: meta.bg,
        color: meta.fg,
      }}
    >
      {meta.label}
    </Box>
  );
}

/** Two-state convenience wrapper around {@link StatusBadge}. */
export function StatusPill({ done }: { done: boolean }) {
  return <StatusBadge status={done ? 'completed' : 'not-started'} />;
}

// Indent for the footer actions so they line up under the title/description
// text rather than the leading icon (icon chip 36 + 12 gap).
const TEXT_INDENT = ICON_CHIP_SIZE + 12;

export interface SummaryRowProps {
  /** Leading icon shown while not `done` (replaced by a check when done). */
  icon?: ReactNode;
  title: string;
  description: ReactNode;
  /**
   * Compact control rendered inline on the right — meant for the lightweight
   * "Manage" affordance on a completed row.
   */
  action?: ReactNode;
  /**
   * Prominent action(s) rendered below the text, aligned under it. Use this for
   * the primary choices on an active card (e.g. connect / detect) so they get
   * room to breathe instead of being squeezed to the right.
   */
  footer?: ReactNode;
  /** Tints the row and swaps the leading icon for a completed check. */
  done?: boolean;
}

/**
 * Card used for nested getting-started setup (connection, data sources). While
 * active it lays out vertically — icon + title, a full (wrapping) description,
 * and the primary actions below the text. Once `done` it collapses to a compact
 * one-line summary with an optional right-aligned "Manage" affordance.
 */
export function SummaryRow({
  icon,
  title,
  description,
  action,
  footer,
  done = false,
}: SummaryRowProps) {
  return (
    <Box
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '14px 16px',
        background: done ? 'var(--color-bg-muted)' : 'var(--color-bg-body)',
      }}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="md">
        <Group
          gap={12}
          wrap="nowrap"
          align="flex-start"
          style={{ minWidth: 0 }}
        >
          <Box style={{ marginTop: 1 }}>
            {done ? <CheckCircle done /> : <IconChip>{icon}</IconChip>}
          </Box>
          <Stack gap={3} style={{ minWidth: 0 }}>
            <Text fz={15} fw={600} style={{ color: 'var(--color-text)' }}>
              {title}
            </Text>
            <Text
              fz={13}
              lh={1.45}
              style={{ color: 'var(--color-text-muted)' }}
            >
              {description}
            </Text>
          </Stack>
        </Group>
        {action ? <Box style={{ flexShrink: 0 }}>{action}</Box> : null}
      </Group>
      {footer ? (
        <Group gap="sm" mt={12} pl={TEXT_INDENT} wrap="wrap">
          {footer}
        </Group>
      ) : null}
    </Box>
  );
}
