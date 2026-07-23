import React from 'react';
import { ActionIcon, Alert, Button, Group, Stack, Text } from '@mantine/core';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconExclamationCircle,
  IconInfoCircle,
  IconTrash,
} from '@tabler/icons-react';

/**
 * Showcases the semantic component variants wired to the `--color-text-*`
 * design tokens. Use the Brand (HyperDX / ClickStack) and Theme (Light / Dark)
 * toolbar toggles to verify each variant across all four combinations.
 */
const story = {
  title: 'Design Tokens/Semantic Variants',
};
export default story;

// Variants exposed as Button / ActionIcon (only danger).
const CONTROL_VARIANTS = ['danger'] as const;

// Variants supported by Text.
const TEXT_VARIANTS = ['danger', 'warning', 'success'] as const;

// Alert additionally supports an informational variant.
const ALERT_VARIANTS = ['info', 'success', 'warning', 'danger'] as const;

const ALERT_META: Record<
  (typeof ALERT_VARIANTS)[number],
  { icon: React.ReactNode; title: string; body: string }
> = {
  info: {
    icon: <IconInfoCircle size={16} />,
    title: 'Heads up',
    body: 'This is an informational message with additional context.',
  },
  success: {
    icon: <IconCircleCheck size={16} />,
    title: 'Success',
    body: 'Your changes have been saved successfully.',
  },
  warning: {
    icon: <IconAlertTriangle size={16} />,
    title: 'Warning',
    body: 'This action may have unintended side effects.',
  },
  danger: {
    icon: <IconExclamationCircle size={16} />,
    title: 'Something went wrong',
    body: 'We were unable to complete your request. Please try again.',
  },
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div>
    <Text
      size="xs"
      fw={600}
      mb="xs"
      style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
      c="var(--color-text-muted)"
    >
      {title}
    </Text>
    {children}
  </div>
);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const Alerts = () => (
  <Stack gap="md" p="lg" style={{ maxWidth: 560 }}>
    {ALERT_VARIANTS.map(variant => {
      const meta = ALERT_META[variant];
      return (
        <Alert
          key={variant}
          variant={variant}
          icon={meta.icon}
          title={meta.title}
          withCloseButton
        >
          {meta.body}
        </Alert>
      );
    })}
  </Stack>
);

export const Buttons = () => (
  <Stack gap="lg" p="lg">
    <Section title="Buttons">
      <Group>
        {CONTROL_VARIANTS.map(variant => (
          <Button key={variant} variant={variant}>
            {capitalize(variant)}
          </Button>
        ))}
      </Group>
    </Section>
    <Section title="Action Icons">
      <Group>
        {CONTROL_VARIANTS.map(variant => (
          <ActionIcon key={variant} variant={variant} aria-label={variant}>
            <IconTrash size={16} />
          </ActionIcon>
        ))}
      </Group>
    </Section>
  </Stack>
);

export const TextColors = () => (
  <Stack gap="xs" p="lg">
    {TEXT_VARIANTS.map(variant => (
      <Text key={variant} variant={variant}>
        {capitalize(variant)} text — the quick brown fox jumps over the lazy
        dog.
      </Text>
    ))}
  </Stack>
);

export const AllSemanticVariants = () => (
  <Stack gap="xl" p="lg" style={{ maxWidth: 560 }}>
    <Section title="Alerts">
      <Stack gap="md">
        {ALERT_VARIANTS.map(variant => {
          const meta = ALERT_META[variant];
          return (
            <Alert
              key={variant}
              variant={variant}
              icon={meta.icon}
              title={meta.title}
            >
              {meta.body}
            </Alert>
          );
        })}
      </Stack>
    </Section>
    <Section title="Buttons">
      <Group>
        {CONTROL_VARIANTS.map(variant => (
          <Button key={variant} variant={variant}>
            {capitalize(variant)}
          </Button>
        ))}
      </Group>
    </Section>
    <Section title="Action Icons">
      <Group>
        {CONTROL_VARIANTS.map(variant => (
          <ActionIcon key={variant} variant={variant} aria-label={variant}>
            <IconTrash size={16} />
          </ActionIcon>
        ))}
      </Group>
    </Section>
    <Section title="Text">
      <Stack gap="xs">
        {TEXT_VARIANTS.map(variant => (
          <Text key={variant} variant={variant}>
            {capitalize(variant)} text sample
          </Text>
        ))}
      </Stack>
    </Section>
  </Stack>
);
