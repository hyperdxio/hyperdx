import { Group } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/nextjs';

import { LogoBadge } from './LogoBadge';

const meta = {
  title: 'Components/LogoBadge',
  component: LogoBadge,
  parameters: { layout: 'centered' },
  args: {
    size: 56,
    radius: 12,
    background: '#fff',
  },
} satisfies Meta<typeof LogoBadge>;

export default meta;
type Story = StoryObj<typeof LogoBadge>;

/** Brand logo served from `public/integrations`. */
function Logo({
  src,
  alt,
  size = 26,
}: {
  src: string;
  alt: string;
  size?: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      style={{ height: size, width: 'auto', display: 'block' }}
    />
  );
}

export const Default: Story = {
  args: {
    children: <Logo src="/integrations/python.svg" alt="Python" size={28} />,
  },
};

export const BrandLogos: Story = {
  render: args => (
    <Group gap={16}>
      <LogoBadge {...args}>
        <Logo src="/integrations/python.svg" alt="Python" size={26} />
      </LogoBadge>
      <LogoBadge {...args}>
        <Logo src="/integrations/ruby.svg" alt="Ruby" size={26} />
      </LogoBadge>
      <LogoBadge {...args}>
        <Logo src="/integrations/go.svg" alt="Go" size={30} />
      </LogoBadge>
      <LogoBadge {...args}>
        <Logo src="/integrations/deno.svg" alt="Deno" size={26} />
      </LogoBadge>
      <LogoBadge {...args}>
        <Logo src="/integrations/nextjs.svg" alt="Next.js" size={26} />
      </LogoBadge>
    </Group>
  ),
};
