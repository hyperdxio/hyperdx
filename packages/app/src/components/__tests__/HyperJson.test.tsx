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

// ClickHouse returns `Map(...)` keys in physical storage order, which reads as
// random for wide maps like `ProfileEvents`. Sort at render time so the tree is
// scannable — and so the MAX_TREE_NODE_ITEMS cap slices a predictable prefix
// rather than an arbitrary subset.
describe('HyperJson key ordering', () => {
  const renderedKeys = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.keyContainer > .key')).map(el =>
      el.textContent?.trim(),
    );

  const renderedValues = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.valueContainer')).map(el =>
      el.textContent?.trim(),
    );

  it('sorts top-level keys alphabetically, case-insensitively', () => {
    const { container } = renderWithMantine(
      <HyperJson data={{ zebra: 1, alpha: 2, Mango: 3 }} />,
    );

    expect(renderedKeys(container)).toEqual(['alpha', 'Mango', 'zebra']);
  });

  it('sorts nested object keys alphabetically', () => {
    const { container } = renderWithMantine(
      <HyperJson
        data={{ ProfileEvents: { Seek: 59, FileOpen: 2, Query: 1 } }}
        normallyExpanded
      />,
    );

    expect(renderedKeys(container)).toEqual([
      'ProfileEvents',
      'FileOpen',
      'Query',
      'Seek',
    ]);
  });

  it('orders numeric suffixes naturally rather than lexicographically', () => {
    const { container } = renderWithMantine(
      <HyperJson data={{ key10: 1, key2: 2, key1: 3 }} />,
    );

    expect(renderedKeys(container)).toEqual(['key1', 'key2', 'key10']);
  });

  // Arrays are index-keyed, so sorting their "keys" would reorder the data.
  // Uses >10 elements so a lexicographic sort (0, 1, 10, 11, 2, ...) would show
  // up, not just a hypothetical reversal.
  it('preserves array element order', () => {
    const list = Array.from({ length: 12 }, (_, i) => `item-${i}`);
    const { container } = renderWithMantine(
      <HyperJson data={{ list }} normallyExpanded />,
    );

    expect(renderedKeys(container)).toEqual([
      'list',
      ...list.map((_, i) => String(i)),
    ]);
    // First value cell belongs to `list` itself ("[] 12 items").
    expect(renderedValues(container).slice(1)).toEqual(list);
  });
});
