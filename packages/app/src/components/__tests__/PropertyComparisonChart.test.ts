import { resolveComparisonClick } from '@/components/PropertyComparisonChart';

describe('resolveComparisonClick', () => {
  const rows = [
    { name: 'GET /a' },
    { name: 'GET /b' },
    { name: 'Other', isOther: true },
  ];

  it('selects the clicked bar label', () => {
    expect(resolveComparisonClick('GET /a', rows, null)).toBe('GET /a');
  });

  it('deselects when the label is missing', () => {
    expect(resolveComparisonClick(undefined, rows, null)).toBeNull();
    expect(resolveComparisonClick(null, rows, 'GET /a')).toBeNull();
  });

  it('ignores the aggregated "Other" bucket', () => {
    expect(resolveComparisonClick('Other', rows, null)).toBeNull();
  });

  it('ignores a label with no matching row', () => {
    expect(resolveComparisonClick('missing', rows, null)).toBeNull();
  });

  it('toggles off when clicking the currently selected bar', () => {
    expect(resolveComparisonClick('GET /a', rows, 'GET /a')).toBeNull();
  });

  it('switches selection to a different bar', () => {
    expect(resolveComparisonClick('GET /b', rows, 'GET /a')).toBe('GET /b');
  });
});
