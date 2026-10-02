import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';

jest.mock('@/config', () => ({ INSTANCE_LABEL: 'UK' }));

import { InstanceLabel } from '@/components/AppNav/InstanceLabel';

describe('InstanceLabel', () => {
  it('renders the label when INSTANCE_LABEL is set', () => {
    render(
      <MantineProvider>
        <InstanceLabel />
      </MantineProvider>,
    );
    expect(screen.getByText('UK')).toBeInTheDocument();
  });
});
