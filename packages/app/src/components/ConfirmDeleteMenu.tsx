import { Trans } from 'next-i18next/pages';
import { Button, Menu } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';

export default function ConfirmDeleteMenu({
  onDelete,
}: {
  onDelete: () => void;
}) {
  return (
    <Menu withArrow>
      <Menu.Target>
        <Button variant="danger" size="xs">
          <Trans>Delete</Trans>
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconTrash size={16} />} onClick={onDelete}>
          <Trans>Confirm Delete</Trans>
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
