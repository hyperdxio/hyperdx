import { useTranslation } from 'react-i18next';
import { Button, Menu } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';

export default function ConfirmDeleteMenu({
  onDelete,
}: {
  onDelete: () => void;
}) {
  const { t } = useTranslation('common');

  return (
    <Menu withArrow>
      <Menu.Target>
        <Button variant="danger" size="xs">
          {t('actions.delete')}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconTrash size={16} />} onClick={onDelete}>
          {t('actions.confirmDelete')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
