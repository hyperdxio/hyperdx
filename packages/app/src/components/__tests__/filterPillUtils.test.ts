import { flattenFilters, PillItem, removePill } from '../filterPillUtils';

describe('filterPillUtils', () => {
  describe('removePill', () => {
    it('calls setFilterValue for included pills', () => {
      const setFilterValue = jest.fn();
      const clearFilter = jest.fn();
      const pill: PillItem = {
        field: 'status',
        value: '200',
        type: 'included',
        rawValue: '200',
      };
      removePill(pill, setFilterValue, clearFilter);
      expect(setFilterValue).toHaveBeenCalledWith('status', '200', undefined);
      expect(clearFilter).not.toHaveBeenCalled();
    });

    it('calls setFilterValue with exclude action for excluded pills', () => {
      const setFilterValue = jest.fn();
      const clearFilter = jest.fn();
      const pill: PillItem = {
        field: 'status',
        value: '500',
        type: 'excluded',
        rawValue: '500',
      };
      removePill(pill, setFilterValue, clearFilter);
      expect(setFilterValue).toHaveBeenCalledWith('status', '500', 'exclude');
      expect(clearFilter).not.toHaveBeenCalled();
    });

    it('calls clearFilter for range pills', () => {
      const setFilterValue = jest.fn();
      const clearFilter = jest.fn();
      const pill: PillItem = {
        field: 'duration',
        value: '100 – 500',
        type: 'range',
      };
      removePill(pill, setFilterValue, clearFilter);
      expect(clearFilter).toHaveBeenCalledWith('duration');
      expect(setFilterValue).not.toHaveBeenCalled();
    });
  });

  describe('flattenFilters', () => {
    it('returns empty array for empty filters', () => {
      expect(flattenFilters({})).toEqual([]);
    });

    it('flattens included filters', () => {
      const result = flattenFilters({
        status: {
          included: new Set<string | boolean>(['200', '404']),
          excluded: new Set<string | boolean>(),
        },
      });
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'status',
            value: '200',
            type: 'included',
            rawValue: '200',
          }),
          expect.objectContaining({
            field: 'status',
            value: '404',
            type: 'included',
            rawValue: '404',
          }),
        ]),
      );
      expect(result).toHaveLength(2);
    });

    it('flattens excluded filters', () => {
      const result = flattenFilters({
        status: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(['500']),
        },
      });
      expect(result).toEqual([
        expect.objectContaining({
          field: 'status',
          value: '500',
          type: 'excluded',
          rawValue: '500',
        }),
      ]);
    });

    it('flattens range filters', () => {
      const result = flattenFilters({
        duration: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(),
          range: { min: 100, max: 500 },
        },
      });
      expect(result).toEqual([
        expect.objectContaining({
          field: 'duration',
          value: '100 – 500',
          type: 'range',
        }),
      ]);
      // range pills should not have rawValue
      expect(result[0].rawValue).toBeUndefined();
    });

    it('flattens mixed filters from multiple fields', () => {
      const result = flattenFilters({
        status: {
          included: new Set<string | boolean>(['200']),
          excluded: new Set<string | boolean>(['500']),
        },
        duration: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(),
          range: { min: 10, max: 200 },
        },
      });
      expect(result).toHaveLength(3);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'status',
            type: 'included',
            value: '200',
          }),
          expect.objectContaining({
            field: 'status',
            type: 'excluded',
            value: '500',
          }),
          expect.objectContaining({
            field: 'duration',
            type: 'range',
            value: '10 – 200',
          }),
        ]),
      );
    });

    it('handles boolean values', () => {
      const result = flattenFilters({
        active: {
          included: new Set<string | boolean>([true]),
          excluded: new Set<string | boolean>([false]),
        },
      });
      expect(result).toHaveLength(2);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'active',
            value: 'true',
            type: 'included',
            rawValue: true,
          }),
          expect.objectContaining({
            field: 'active',
            value: 'false',
            type: 'excluded',
            rawValue: false,
          }),
        ]),
      );
    });

    it('skips fields with no included, excluded, or range values', () => {
      const result = flattenFilters({
        empty: {
          included: new Set<string | boolean>(),
          excluded: new Set<string | boolean>(),
        },
      });
      expect(result).toEqual([]);
    });
  });
});
