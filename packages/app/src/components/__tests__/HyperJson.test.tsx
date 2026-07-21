import React from 'react';

import HyperJson from '@/components/HyperJson';

describe('HyperJson wrap markers', () => {
  const data = { 'url.path': '/bitdrift.internal_api.unary.example/VeryLong' };

  it('applies withPreWrap when wrap mode is on (whiteSpace="pre-wrap")', () => {
    const { container } = renderWithMantine(
      <HyperJson data={data} whiteSpace="pre-wrap" />,
    );

    expect(container.querySelector('.withPreWrap')).toBeInTheDocument();
  });

  it('does not apply withPreWrap when wrap mode is off (whiteSpace="pre")', () => {
    const { container } = renderWithMantine(
      <HyperJson data={data} whiteSpace="pre" />,
    );

    expect(container.querySelector('.withPreWrap')).not.toBeInTheDocument();
  });
});
