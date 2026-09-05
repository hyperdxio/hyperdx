import React from 'react';
import { Alert, Stack } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconExclamationCircle,
  IconInfoCircle,
} from '@tabler/icons-react';

/**
 * Themed Mantine `Alert` with our semantic variants (`info` / `success` /
 * `warning` / `danger`). Each variant is wired to the `--color-text-*` and
 * `--alert-*` design tokens in both brand themes, so use the Brand
 * (HyperDX / ClickStack) and Theme (Light / Dark) toolbar toggles to review
 * every combination. The alert body keeps a high-contrast text color while the
 * title/icon take the semantic accent.
 */
const meta = {
  title: 'Components/Alert',
  component: Alert,
  // The global preview config hides the addons panel (showPanel: false); the
  // interactive Playground story below needs it visible to expose Controls.
  parameters: {
    options: { showPanel: true },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['info', 'success', 'warning', 'danger'],
      description: 'Semantic variant wired to the design tokens.',
    },
    title: { control: 'text' },
    children: { control: 'text', description: 'Alert body content.' },
    withCloseButton: { control: 'boolean' },
    radius: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg', 'xl'],
    },
  },
} satisfies Meta<typeof Alert>;

export default meta;

type Story = StoryObj<typeof Alert>;

const VARIANTS = ['info', 'success', 'warning', 'danger'] as const;

const VARIANT_META: Record<
  string,
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

/**
 * Interactive story — edit `variant`, `title`, `children`, etc. in the
 * Controls panel to preview the themed Alert live.
 */
export const Playground: Story = {
  args: {
    variant: 'warning',
    title: 'Warning',
    children: 'This action may have unintended side effects.',
    withCloseButton: false,
  },
  render: args => {
    const variant = typeof args.variant === 'string' ? args.variant : 'warning';
    return (
      <div style={{ maxWidth: 520, padding: 24 }}>
        <Alert {...args} icon={VARIANT_META[variant]?.icon} />
      </div>
    );
  },
};

export const Warning = () => (
  <div style={{ maxWidth: 520, padding: 24 }}>
    <Alert
      variant="warning"
      icon={<IconAlertTriangle size={16} />}
      title="Warning"
    >
      This action may have unintended side effects.
    </Alert>
  </div>
);

export const SemanticVariants = () => (
  <Stack gap="md" p="lg" style={{ maxWidth: 520 }}>
    {VARIANTS.map(variant => {
      const m = VARIANT_META[variant];
      return (
        <Alert key={variant} variant={variant} icon={m.icon} title={m.title}>
          {m.body}
        </Alert>
      );
    })}
  </Stack>
);

export const WithCloseButton = () => (
  <Stack gap="md" p="lg" style={{ maxWidth: 520 }}>
    {VARIANTS.map(variant => {
      const m = VARIANT_META[variant];
      return (
        <Alert
          key={variant}
          variant={variant}
          icon={m.icon}
          title={m.title}
          withCloseButton
        >
          {m.body}
        </Alert>
      );
    })}
  </Stack>
);

export const WithoutTitle = () => (
  <Stack gap="md" p="lg" style={{ maxWidth: 520 }}>
    {VARIANTS.map(variant => {
      const m = VARIANT_META[variant];
      return (
        <Alert key={variant} variant={variant} icon={m.icon}>
          {m.body}
        </Alert>
      );
    })}
  </Stack>
);

export const WithoutIcon = () => (
  <Stack gap="md" p="lg" style={{ maxWidth: 520 }}>
    {VARIANTS.map(variant => {
      const m = VARIANT_META[variant];
      return (
        <Alert key={variant} variant={variant} title={m.title}>
          {m.body}
        </Alert>
      );
    })}
  </Stack>
);
