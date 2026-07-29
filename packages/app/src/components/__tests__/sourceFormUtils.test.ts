import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { distinctSections } from '@/components/Sources/SourceForm/sourceFormUtils';

const makeSource = (id: string, section?: string): TSource =>
  ({
    id,
    name: id,
    kind: SourceKind.Log,
    connection: 'conn-a',
    ...(section === undefined ? {} : { section }),
  }) as unknown as TSource;

describe('distinctSections', () => {
  it('returns [] for undefined sources', () => {
    expect(distinctSections(undefined)).toEqual([]);
  });

  it('returns [] when no source has a section', () => {
    expect(distinctSections([makeSource('a'), makeSource('b')])).toEqual([]);
  });

  it('dedupes, trims, drops empty/whitespace, and sorts alphabetically', () => {
    const sources = [
      makeSource('a', 'Control Plane Prod'),
      makeSource('b', 'Billing'),
      makeSource('c', '  Billing  '), // trims to a duplicate of "Billing"
      makeSource('d', '   '), // whitespace-only -> dropped
      makeSource('e', ''), // empty -> dropped
      makeSource('f', 'Billing'),
    ];
    expect(distinctSections(sources)).toEqual([
      'Billing',
      'Control Plane Prod',
    ]);
  });

  it('keeps distinct casings as separate suggestions', () => {
    // Grouping is case-sensitive, so "Billing" and "billing" are different
    // sections; both are offered so the user can pick the existing one.
    const result = distinctSections([
      makeSource('a', 'billing'),
      makeSource('b', 'Billing'),
    ]);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining(['Billing', 'billing']));
  });
});
