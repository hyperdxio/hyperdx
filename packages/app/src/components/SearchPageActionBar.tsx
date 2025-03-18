import { Button, Menu, Text } from '@mantine/core';

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
        <Button
          variant="outline"
          color="dark.2"
          px="xs"
          size="xs"
          style={{ flexShrink: 0 }}
          data-testid="search-page-action-bar-button"
        >
          <i className="bi bi-three-dots-vertical" />
        </Button>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Item
          leftSection={<i className="bi bi-trash-fill" />}
          onClick={onClickDeleteSavedSearch}
          data-testid="search-page-action-bar-delete-saved-search"
        >
          Delete Saved Search
        </Menu.Item>
        <Menu.Item
          leftSection={<i className="bi bi-input-cursor-text" />}
          onClick={onClickRenameSavedSearch}
          data-testid="search-page-action-bar-rename-saved-search"
        >
          Rename Saved Search
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
