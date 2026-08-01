import { Path } from 'react-hook-form';
import { List } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

import { ChartEditorFormState } from '@/components/ChartEditor/types';

type ErrorNotificationMessageProps = {
  errors: { path: Path<ChartEditorFormState>; message: string }[];
};

export const ErrorNotificationMessage = ({
  errors,
}: ErrorNotificationMessageProps) => {
  return (
    <List
      size="sm"
      icon={<IconX size={14} style={{ verticalAlign: 'middle' }} />}
    >
      {errors.map(({ message }, index) => (
        <List.Item key={index}>{message}</List.Item>
      ))}
    </List>
  );
};
