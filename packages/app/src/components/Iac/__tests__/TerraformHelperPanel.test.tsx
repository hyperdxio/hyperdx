import React from 'react';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

import { TerraformHelperPanel } from '@/components/Iac/TerraformHelperPanel';

const SNIPPETS = [
  {
    label: 'Import block',
    snippet: 'import { to = foo.bar }',
    hint: 'Add to your Terraform project.',
  },
  {
    label: 'Provider setup',
    snippet: 'terraform { required_providers {} }',
    collapsible: true,
    hint: 'Add once per module.',
  },
];

function renderPanel() {
  return render(
    <MantineProvider>
      <TerraformHelperPanel snippets={SNIPPETS} />
    </MantineProvider>,
  );
}

describe('TerraformHelperPanel', () => {
  it('renders a plain snippet inline', () => {
    renderPanel();

    expect(screen.getByText('Import block')).toBeInTheDocument();
    expect(screen.getByText('import { to = foo.bar }')).toBeInTheDocument();
  });

  it('hides a collapsible snippet behind a toggle and reveals its hint', () => {
    renderPanel();

    expect(
      screen.getByText('terraform { required_providers {} }'),
    ).not.toBeVisible();

    fireEvent.click(screen.getByText(/Show provider setup/));

    expect(screen.getByText(/Hide provider setup/)).toBeInTheDocument();
    expect(screen.getByText('Add once per module.')).toBeInTheDocument();
  });
});
