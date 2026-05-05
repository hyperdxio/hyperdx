import { TimelineSeriesSchema } from '../types';

const baseValid = {
  id: 'series-1',
  label: 'My Series',
  source: 'logs',
  whereLanguage: 'lucene' as const,
};

describe('TimelineSeriesSchema', () => {
  describe('mode: events', () => {
    it('accepts a valid events series with labelExpression', () => {
      const result = TimelineSeriesSchema.safeParse({
        ...baseValid,
        mode: 'events',
        labelExpression: 'Body',
      });
      expect(result.success).toBe(true);
    });

    it('rejects an events series missing labelExpression', () => {
      const result = TimelineSeriesSchema.safeParse({
        ...baseValid,
        mode: 'events',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map(i => i.path.join('.'));
        expect(paths).toContain('labelExpression');
      }
    });
  });

  describe('mode: value_change', () => {
    it('accepts a valid value_change series with trackColumn', () => {
      const result = TimelineSeriesSchema.safeParse({
        ...baseValid,
        mode: 'value_change',
        trackColumn: "ResourceAttributes['service.version']",
      });
      expect(result.success).toBe(true);
    });

    it('rejects a value_change series missing trackColumn', () => {
      const result = TimelineSeriesSchema.safeParse({
        ...baseValid,
        mode: 'value_change',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map(i => i.path.join('.'));
        expect(paths).toContain('trackColumn');
      }
    });
  });
});
