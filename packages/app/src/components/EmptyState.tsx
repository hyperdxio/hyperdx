import { ReactNode } from 'react';
import {
  type BoxProps,
  Center,
  Paper,
  type PaperProps,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';

type EmptyStateBaseProps = {
  icon?: ReactNode;
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
};

type EmptyStateDefaultProps = EmptyStateBaseProps & {
  variant?: 'default';
  fullWidth?: never;
} & Omit<BoxProps, 'children'>;

type EmptyStateCardProps = EmptyStateBaseProps & {
  variant: 'card';
  fullWidth?: boolean;
} & Omit<PaperProps, 'children'>;

type EmptyStateProps = EmptyStateDefaultProps | EmptyStateCardProps;

export default function EmptyState({
  icon,
  title,
  description,
  children,
  variant = 'default',
  fullWidth = false,
  ...restProps
}: EmptyStateProps) {
  const inner = (
    <Stack align="center" gap="xs">
      {!!icon && (
        <ThemeIcon size={56} radius="xl" variant="light" color="gray">
          {icon}
        </ThemeIcon>
      )}
      {!!title && (
        <Title order={3} fw={600} size="xl" maw={600}>
          {title}
        </Title>
      )}
      {!!description && (
        <Text size="sm" c="dimmed" ta="center" maw={600}>
          {description}
        </Text>
      )}
      {children}
    </Stack>
  );

  if (variant === 'card') {
    const paperProps = restProps as Omit<PaperProps, 'children'>;
    return (
      <Paper
        withBorder
        radius="md"
        w="100%"
        maw={fullWidth ? undefined : 600}
        mx={fullWidth ? undefined : 'auto'}
        p="xl"
        {...paperProps}
      >
        <Center mih={100}>{inner}</Center>
      </Paper>
    );
  }

  const boxProps = restProps as Omit<BoxProps, 'children'>;
  return (
    <Center mih={100} mx="auto" {...boxProps}>
      {inner}
    </Center>
  );
}
