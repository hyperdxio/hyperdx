import { Button, Menu } from '@mantine/core';

export default function ConfirmDeleteMenu({
  onDelete,
}: {
  onDelete: () => void;
}) {
  return (
    <Menu withArrow>
      <Menu.Target>
        <Button variant="outline" color="gray.4" size="xs">
          Delete
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<i className="bi bi-trash-fill" />}
          onClick={onDelete}
        >
          Confirm Delete
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
