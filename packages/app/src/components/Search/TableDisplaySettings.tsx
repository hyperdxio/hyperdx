import {
  Button,
  Group,
  Popover,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
import { IconAdjustmentsHorizontal } from '@tabler/icons-react';

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="md">
      <Text size="xs" fw={500}>
        {label}
      </Text>
      {children}
    </Group>
  );
}

export function TableDisplaySettings({
  rowSelection,
  wrapLines,
  onWrapLinesChange,
  onResetColumnWidths,
}: {
  /** Omit when the table doesn't support selecting rows. */
  rowSelection?: { enabled: boolean; onChange: (enabled: boolean) => void };
  wrapLines: boolean;
  onWrapLinesChange: (wrap: boolean) => void;
  /** Undefined while the columns have their default widths. */
  onResetColumnWidths?: () => void;
}) {
  return (
    <Popover position="bottom-end" width={320} shadow="md" withinPortal>
      <Popover.Target>
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<IconAdjustmentsHorizontal size={14} />}
          data-testid="table-display-settings"
        >
          Display
        </Button>
      </Popover.Target>
      <Popover.Dropdown data-testid="table-display-settings-dropdown">
        <Stack gap="sm">
          {rowSelection && (
            <SettingRow label="Row checkboxes">
              <SegmentedControl
                size="xs"
                value={rowSelection.enabled ? 'show' : 'hide'}
                onChange={v => rowSelection.onChange(v === 'show')}
                data={[
                  { label: 'Hide', value: 'hide' },
                  { label: 'Show', value: 'show' },
                ]}
                data-testid="row-selection-setting"
              />
            </SettingRow>
          )}
          <SettingRow label="Lines per row">
            <SegmentedControl
              size="xs"
              value={wrapLines ? 'wrap' : 'single'}
              onChange={v => onWrapLinesChange(v === 'wrap')}
              data={[
                { label: 'Single line', value: 'single' },
                { label: 'Wrap', value: 'wrap' },
              ]}
              data-testid="wrap-lines-setting"
            />
          </SettingRow>
          <SettingRow label="Column widths">
            <Button
              variant="secondary"
              size="compact-xs"
              disabled={onResetColumnWidths == null}
              onClick={onResetColumnWidths}
            >
              Reset
            </Button>
          </SettingRow>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
