import { useState } from 'react';
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
      title="Double click to edit"
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
            placeholder="Name"
            autoFocus
          />
          <Button ms="sm" variant="primary" type="submit">
            Save Name
          </Button>
        </form>
      ) : (
        <div className="d-flex align-items-center" style={{ minWidth: 100 }}>
          <Title fw={400} order={3}>
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
