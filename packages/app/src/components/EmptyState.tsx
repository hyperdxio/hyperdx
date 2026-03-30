import { ReactNode } from 'react';
import { Center, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconDatabaseOff } from '@tabler/icons-react';

type EmptyStateProps = {
  icon?: ReactNode;
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
};

export default function EmptyState({
  icon = <IconDatabaseOff size={32} />,
  title = 'No data available',
  description,
  children,
}: EmptyStateProps) {
  return (
    <Center mih={100} h="100%">
      <Stack align="center" gap="xs">
        <ThemeIcon size={56} radius="xl" variant="light" color="gray">
          {icon}
        </ThemeIcon>
        <Title order={3} fw={600}>
          {title}
        </Title>
        {description && (
          <Text size="sm" c="dimmed" ta="center">
            {description}
          </Text>
        )}
        {children}
      </Stack>
    </Center>
  );
}
