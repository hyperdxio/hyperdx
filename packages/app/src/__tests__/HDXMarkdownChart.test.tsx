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

  it('flags a reference to an unknown variable', () => {
    renderWithMantine(
      <HDXMarkdownChart
        config={{ markdown: '$service $nope' }}
        variables={[service]}
      />,
    );
    expect(screen.getByTestId('variable-validation')).toHaveAccessibleName(
      'Markdown references unknown variable $nope. Available variables: service.',
    );
  });

  it('checks references against the available names when given', () => {
    renderWithMantine(
      <HDXMarkdownChart
        config={{ markdown: '$service $env' }}
        variables={[service]}
        availableVariableNames={['service', 'env']}
      />,
    );
    expect(screen.queryByTestId('variable-validation')).not.toBeInTheDocument();
  });

  it('flags nothing when every reference is known', () => {
    renderWithMantine(
      <HDXMarkdownChart
        config={{ markdown: '$service' }}
        variables={[service]}
      />,
    );
    expect(screen.queryByTestId('variable-validation')).not.toBeInTheDocument();
  });

  it('flags nothing without variables', () => {
    renderWithMantine(<HDXMarkdownChart config={{ markdown: '$nope' }} />);
    expect(screen.queryByTestId('variable-validation')).not.toBeInTheDocument();
  });
});
