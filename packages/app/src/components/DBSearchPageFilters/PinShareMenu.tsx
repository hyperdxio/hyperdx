import { ActionIcon, Center, Menu } from '@mantine/core';
import { IconPin, IconPinFilled, IconUsers } from '@tabler/icons-react';

/**
 * Shared pin/share dropdown menu used on both value rows and group headers.
 * Shows contextual actions: "Remove from Shared" / "Pin for me" / "Share with team"
 * with the most relevant action first.
 *
 * Icon logic:
 *  - sharedPinned → IconUsers (people icon)
 *  - personalPinned → IconPinFilled
 *  - neither → IconPin (outline)
 */
export function PinShareMenu({
  personalPinned,
  sharedPinned,
  onTogglePersonalPin,
  onToggleSharedPin,
  size = 14,
  onChange,
  'data-testid': dataTestId,
  'aria-label': ariaLabel,
}: {
  personalPinned: boolean;
  sharedPinned: boolean;
  onTogglePersonalPin: VoidFunction;
  onToggleSharedPin?: VoidFunction;
  size?: number;
  onChange?: (opened: boolean) => void;
  'data-testid'?: string;
  'aria-label'?: string;
}) {
  const isPinnedAny = personalPinned || sharedPinned;

  // Personal pin icon takes priority over shared icon
  const triggerIcon = personalPinned ? (
    <IconPinFilled size={size} />
  ) : sharedPinned ? (
    <IconUsers size={size} />
  ) : (
    <IconPin size={size} />
  );

  return (
    <Menu
      position="right"
      withArrow
      shadow="sm"
      width={200}
      onChange={onChange}
    >
      <Menu.Target>
        <ActionIcon
          size="xs"
          variant="subtle"
          color="gray"
          aria-label={ariaLabel ?? (isPinnedAny ? 'Unpin' : 'Pin')}
          data-testid={dataTestId}
        >
          {triggerIcon}
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {onToggleSharedPin && sharedPinned && (
          <Menu.Item
            leftSection={<IconUsers size={14} />}
            onClick={onToggleSharedPin}
            fz="xs"
          >
            Remove from Shared
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={
            personalPinned ? <IconPinFilled size={14} /> : <IconPin size={14} />
          }
          onClick={onTogglePersonalPin}
          fz="xs"
        >
          {personalPinned ? 'Unpin for me' : 'Pin for me'}
        </Menu.Item>
        {onToggleSharedPin && !sharedPinned && (
          <Menu.Item
            leftSection={<IconUsers size={14} />}
            onClick={onToggleSharedPin}
            fz="xs"
          >
            Share with team
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * Small indicator icon shown persistently on pinned/shared values.
 */
export function PinShareIndicator({
  personalPinned,
  sharedPinned,
  'data-testid': dataTestId,
}: {
  personalPinned: boolean;
  sharedPinned: boolean;
  'data-testid'?: string;
}) {
  if (!personalPinned && !sharedPinned) return null;

  // Personal pin icon takes priority over shared icon
  return (
    <Center me="1px">
      {personalPinned ? (
        <IconPinFilled size={12} data-testid={dataTestId} />
      ) : (
        <IconUsers size={12} data-testid={dataTestId} />
      )}
    </Center>
  );
}
