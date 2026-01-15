import { Button, Menu, Text } from '@mantine/core';
import { IconDotsVertical, IconForms, IconTrash } from '@tabler/icons-react';

export default function SearchPageActionBar({
  onClickDeleteSavedSearch,
  onClickRenameSavedSearch,
}: {
  onClickDeleteSavedSearch: () => void;
  onClickRenameSavedSearch: () => void;
}) {
  return (
    <Menu width={250}>
      <Menu.Target>
        <Button variant="secondary" px="xs" size="xs" style={{ flexShrink: 0 }}>
          <IconDotsVertical size={14} />
        </Button>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconTrash size={16} />}
          onClick={onClickDeleteSavedSearch}
        >
          Delete Saved Search
        </Menu.Item>
        <Menu.Item
          leftSection={<IconForms size={16} />}
          onClick={onClickRenameSavedSearch}
        >
          Rename Saved Search
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
