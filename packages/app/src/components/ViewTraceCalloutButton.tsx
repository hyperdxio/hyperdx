import { useCallback } from 'react';
import { Button, Popover, Stack, Text } from '@mantine/core';
import { IconArrowRight, IconConnection } from '@tabler/icons-react';

import { useLocalStorage } from '@/utils';

import { VIEW_TRACE_CALLOUT_DISMISSED_KEY } from './viewTraceCallout';

type ViewTraceCalloutButtonProps = {
  /** True while the correlated trace hasn't resolved; the button is disabled. */
  disabled: boolean;
  /** Navigate to the correlated trace. Only reachable when not disabled. */
  onView: () => void;
};

/**
 * The prominent "View trace" action shown in a log side panel, wrapped in a
 * one-time nudge popover.
 *
 * The callout is dismissed only by an explicit acknowledgement — clicking
 * "Got it" or the button itself — which persists under its own localStorage key
 * (not user settings). It deliberately does not close on stray clicks, drawer
 * resizes, or Escape: Escape stays owned by the panel-level hotkey so the
 * callout never fights it for the keypress. Because nothing transient is
 * stored, the nudge simply reappears the next time the panel opens on an
 * eligible log until it is acknowledged.
 */
export function ViewTraceCalloutButton({
  disabled,
  onView,
}: ViewTraceCalloutButtonProps) {
  const [dismissed, setDismissed] = useLocalStorage(
    VIEW_TRACE_CALLOUT_DISMISSED_KEY,
    false,
  );
  const dismiss = useCallback(() => setDismissed(true), [setDismissed]);

  return (
    <Popover
      width={260}
      position="bottom-end"
      withArrow
      shadow="md"
      trapFocus={false}
      // Intentional: an outside click neither dismisses the callout nor is it
      // treated as an accidental dismissal. This is a one-time, one-line hint
      // that only ever covers a small strip below the button; it is dismissed
      // deliberately via "Got it" or by clicking View Trace, and does not
      // reappear once acknowledged. We accept that the covered controls are
      // briefly non-interactive so a stray click can't burn the message before
      // it is read. (Reviewed: PR #2815 — kept by design.)
      closeOnClickOutside={false}
      closeOnEscape={false}
      opened={!disabled && !dismissed}
    >
      <Popover.Target>
        <Button
          data-testid="side-panel-view-trace"
          variant="secondary"
          size="compact-sm"
          ml="auto"
          leftSection={<IconConnection size={14} />}
          rightSection={<IconArrowRight size={14} />}
          onClick={() => {
            dismiss();
            onView();
          }}
          disabled={disabled}
        >
          View Trace
        </Button>
      </Popover.Target>
      <Popover.Dropdown
        data-testid="view-trace-callout"
        role="status"
        aria-live="polite"
      >
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Jump to this log&apos;s full trace
          </Text>
          <Text size="xs" c="dimmed">
            Open the correlated trace in one click.
          </Text>
          <Button
            variant="primary"
            size="compact-xs"
            ml="auto"
            onClick={dismiss}
          >
            Got it
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
