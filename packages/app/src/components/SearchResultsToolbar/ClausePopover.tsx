import { type ReactNode, useState } from 'react';
import { Button, Group, Popover, SegmentedControl, Stack } from '@mantine/core';

import { SplitValueButton } from '@/components/SplitValueButton/SplitValueButton';

export type ClauseMode = 'pick' | 'sql';

const matchesDefault = (draft: string, defaultValue: string) =>
  draft.trim() === defaultValue.trim();

/**
 * What Apply writes. An empty form value means "use the source default", so a
 * draft that matches the default is stored as "" rather than a copy of it.
 */
export function storedClause(
  draft: string,
  value: string,
  defaultValue: string,
) {
  return matchesDefault(draft, defaultValue)
    ? ''
    : draft === (value || defaultValue)
      ? value
      : draft;
}

export const clauseResetDisabled = matchesDefault;

export const clauseApplyDisabled = (draft: string) => draft.trim() === '';

const MODE_OPTIONS = [
  { label: 'Fields', value: 'pick' },
  { label: 'SQL', value: 'sql' },
];

/**
 * A toolbar button that edits one query clause in a popover. Edits stay in a
 * draft owned by the caller until Apply, so closing the popover discards them.
 */
export function ClausePopover({
  name,
  summary,
  count,
  dimmed,
  title,
  initialMode,
  onOpen,
  onApply,
  onReset,
  resetDisabled,
  applyDisabled,
  renderPick,
  renderSql,
  'data-testid': testId,
}: {
  /** The muted side of the split button, such as Columns or Sort. */
  name: string;
  /** Desktop value: a field name, "3 fields", or "none". */
  summary: string;
  /** How many fields the summary counts. */
  count: number;
  /** The clause is still the source default, so the value is quiet. */
  dimmed?: boolean;
  /** The full clause, shown on hover since the value only summarizes it. */
  title: string;
  /** The tab to show each time the popover opens. */
  initialMode: ClauseMode;
  /** Reset the caller's draft to the current value. */
  onOpen: () => void;
  onApply: () => void;
  /** Restore the source default in the draft. Apply still has to confirm it. */
  onReset: () => void;
  resetDisabled?: boolean;
  /** An empty clause is stored as the source default, so Apply cannot submit one. */
  applyDisabled?: boolean;
  renderPick: (apply: () => void) => ReactNode;
  renderSql: (apply: () => void) => ReactNode;
  'data-testid': string;
}) {
  const [opened, setOpened] = useState(false);
  const [mode, setMode] = useState<ClauseMode>(initialMode);

  const open = () => {
    onOpen();
    setMode(initialMode);
    setOpened(true);
  };

  const apply = () => {
    if (applyDisabled) return;
    onApply();
    setOpened(false);
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      width={440}
      shadow="md"
      withinPortal
    >
      <Popover.Target>
        <SplitValueButton
          name={name}
          summary={summary}
          count={count}
          dimmed={dimmed}
          title={title}
          onClick={() => (opened ? setOpened(false) : open())}
          data-testid={testId}
        />
      </Popover.Target>
      <Popover.Dropdown data-testid={`${testId}-popover`}>
        <Stack gap="sm">
          <SegmentedControl
            size="xs"
            fullWidth
            value={mode}
            onChange={value => setMode(value === 'sql' ? 'sql' : 'pick')}
            data={MODE_OPTIONS}
            data-testid={`${testId}-mode`}
          />
          {mode === 'pick' ? renderPick(apply) : renderSql(apply)}
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Button
              variant="link"
              size="xs"
              onClick={onReset}
              disabled={resetDisabled}
              data-testid={`${testId}-reset`}
            >
              Reset to default
            </Button>
            <Group gap="xs" wrap="nowrap">
              <Button
                variant="secondary"
                size="xs"
                onClick={() => setOpened(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="xs"
                onClick={apply}
                disabled={applyDisabled}
                data-testid={`${testId}-apply`}
              >
                Apply
              </Button>
            </Group>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
