import { type ReactNode, useState } from 'react';
import { Button, Group, Popover, SegmentedControl, Stack } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';

export type ClauseMode = 'pick' | 'sql';

const MODE_OPTIONS = [
  { label: 'Pick', value: 'pick' },
  { label: 'SQL', value: 'sql' },
];

/**
 * A toolbar button that edits one query clause in a popover. Edits stay in a
 * draft owned by the caller until Apply, so closing the popover discards them.
 */
export function ClausePopover({
  label,
  title,
  icon,
  initialMode,
  onOpen,
  onApply,
  onReset,
  resetDisabled,
  renderPick,
  renderSql,
  'data-testid': testId,
}: {
  label: ReactNode;
  /** The full clause, shown on hover since the label only summarizes it. */
  title: string;
  icon?: ReactNode;
  /** The tab to show each time the popover opens. */
  initialMode: ClauseMode;
  /** Reset the caller's draft to the current value. */
  onOpen: () => void;
  onApply: () => void;
  /** Restore the source default in the draft. Apply still has to confirm it. */
  onReset: () => void;
  resetDisabled?: boolean;
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
        <Button
          variant="secondary"
          size="xs"
          leftSection={icon}
          rightSection={<IconChevronDown size={14} />}
          onClick={() => (opened ? setOpened(false) : open())}
          title={title}
          data-testid={testId}
        >
          {label}
        </Button>
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
