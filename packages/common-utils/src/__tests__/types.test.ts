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

    it('accepts optional fields on a valid events series', () => {
      const result = TimelineSeriesSchema.safeParse({
        ...baseValid,
        mode: 'events',
        labelExpression: 'Body',
        groupExpression: 'ServiceName',
        severityExpression: 'SeverityText',
        where: 'SeverityText = "ERROR"',
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.mode === 'events') {
        expect(result.data.groupExpression).toBe('ServiceName');
        expect(result.data.severityExpression).toBe('SeverityText');
      }
    });

    it('rejects an events series missing labelExpression', () => {
      const result = TimelineSeriesSchema.safeParse({
        ...baseValid,
        mode: 'events',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an events series with an empty-string labelExpression', () => {
      const result = TimelineSeriesSchema.safeParse({
        ...baseValid,
        mode: 'events',
        labelExpression: '',
      });
      expect(result.success).toBe(false);
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
    });

    it('rejects a value_change series with an empty-string trackColumn', () => {
      const result = TimelineSeriesSchema.safeParse({
        ...baseValid,
        mode: 'value_change',
        trackColumn: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('invalid mode', () => {
    it('rejects an unrecognised mode value', () => {
      const result = TimelineSeriesSchema.safeParse({
        ...baseValid,
        mode: 'unknown_mode',
        labelExpression: 'Body',
      });
      expect(result.success).toBe(false);
    });
  });
});
