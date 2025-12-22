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
        <Button variant="light" size="xs" color="red">
          Delete
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconTrash size={16} />} onClick={onDelete}>
          Confirm Delete
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
