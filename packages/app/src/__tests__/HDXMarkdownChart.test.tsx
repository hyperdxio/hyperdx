import React from 'react';
import { screen } from '@testing-library/react';

import HDXMarkdownChart from '@/HDXMarkdownChart';

const service = { name: 'service', values: ['api', 'web'] };

describe('HDXMarkdownChart', () => {
  it('substitutes variable references', () => {
    renderWithMantine(
      <HDXMarkdownChart
        config={{ markdown: '# Services: $service' }}
        variables={[service]}
      />,
    );
    expect(screen.getByText('# Services: api, web')).toBeInTheDocument();
  });

  it('renders the markdown as written without variables', () => {
    renderWithMantine(
      <HDXMarkdownChart config={{ markdown: '# Services: $service' }} />,
    );
    expect(screen.getByText('# Services: $service')).toBeInTheDocument();
  });

  it('renders the markdown as written when a format is unknown', () => {
    renderWithMantine(
      <HDXMarkdownChart
        config={{ markdown: '${service:nope}' }}
        variables={[service]}
      />,
    );
    expect(screen.getByText('${service:nope}')).toBeInTheDocument();
  });
});
