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

  // Long unbroken keys (dots don't produce break opportunities) rely on the
  // `.keyContainer` max-width cap + `.key` overflow-wrap so they can't
  // squeeze the value column to nothing. jsdom doesn't compute layout, so
  // assert the key renders inside the elements carrying those styles.
  it('renders long unbroken keys inside the capped key container', () => {
    const longKey = 'longtask.attribution.entry_type';
    const { container } = renderWithMantine(
      <HyperJson data={{ [longKey]: 'task-attribution' }} />,
    );

    const key = container.querySelector('.keyContainer > .key');
    expect(key).toBeInTheDocument();
    expect(key).toHaveTextContent(longKey);
  });
});
