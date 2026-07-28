import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Input, Title } from '@mantine/core';
import { useHover } from '@mantine/hooks';
import { IconPencil } from '@tabler/icons-react';

export function EditablePageName({
  name,
  onSave,
}: {
  name: string;
  onSave: (name: string) => void;
}) {
  const { t } = useTranslation('dashboards');
  const [editing, setEditing] = useState(false);
  const [editedName, setEditedName] = useState(name);

  const { hovered, ref } = useHover();

  const cancelEditing = () => {
    setEditedName(name);
    setEditing(false);
  };

  return (
    <Box
      ref={ref}
      pe="md"
      onDoubleClick={() => setEditing(true)}
      className="cursor-pointer"
      title={t('editableName.editHint')}
    >
      {editing ? (
        <form
          className="d-flex align-items-center"
          onSubmit={e => {
            e.preventDefault();
            if (!editedName.trim()) return;
            onSave(editedName);
            setEditing(false);
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              cancelEditing();
            }
          }}
          onBlur={e => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              cancelEditing();
            }
          }}
        >
          <Input
            type="text"
            value={editedName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setEditedName(e.target.value)
            }
            placeholder={t('editableName.placeholder')}
            autoFocus
          />
          <Button ms="sm" variant="primary" type="submit">
            {t('editableName.save')}
          </Button>
        </form>
      ) : (
        <div className="d-flex align-items-center" style={{ minWidth: 100 }}>
          <Title
            fw={400}
            maw={500}
            order={3}
            style={{
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {name}
          </Title>
          {hovered && (
            <Button
              ms="xs"
              variant="subtle"
              size="xs"
              onClick={() => setEditing(true)}
            >
              <IconPencil size={14} />
            </Button>
          )}
        </div>
      )}
    </Box>
  );
}
