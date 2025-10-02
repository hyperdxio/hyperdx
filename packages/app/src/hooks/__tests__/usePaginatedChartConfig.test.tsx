import { getGranularityAlignedTimeWindows } from '../usePaginatedChartConfig';

describe('usePaginatedChartConfig', () => {
  describe('getTimeWindows', () => {
    it('returns [undefined] if no dateRange is provided', () => {
      expect(
        getGranularityAlignedTimeWindows({
          granularity: '1 hour',
        }),
      ).toEqual([undefined]);
    });

    it('returns [undefined] if no granularity is provided', () => {
      expect(
        getGranularityAlignedTimeWindows({
          dateRange: [new Date('2023-01-01'), new Date('2023-01-02')],
        }),
      ).toEqual([undefined]);
    });

    it('returns windows aligned to the granularity if the granularity is larger than the window size', () => {
      expect(
        getGranularityAlignedTimeWindows(
          {
            dateRange: [
              new Date('2023-01-10 00:00:00'),
              new Date('2023-01-10 00:10:00'),
            ],
            granularity: '1 minute',
          },
          [
            30, // 30s
            60, // 1m
            5 * 60, // 5m
          ],
        ),
      ).toEqual([
        {
          dateRange: [
            new Date('2023-01-10 00:09:00'), // window is expanded beyond the desired 30s, to align to 1m granularity
            new Date('2023-01-10 00:10:00'),
          ],
          dateRangeEndInclusive: undefined,
        },
        {
          dateRange: [
            new Date('2023-01-10 00:08:00'), // Second window is 1m (as desired) and aligned to granularity
            new Date('2023-01-10 00:09:00'),
          ],
          dateRangeEndInclusive: false,
        },
        {
          dateRange: [
            new Date('2023-01-10 00:03:00'), // Third window is 5m (as desired) and aligned to granularity
            new Date('2023-01-10 00:08:00'),
          ],
          dateRangeEndInclusive: false,
        },
        {
          dateRange: [
            new Date('2023-01-10 00:00:00'), // Fourth window is shortened to fit within the overall date range, but still aligned to granularity
            new Date('2023-01-10 00:03:00'),
          ],
          dateRangeEndInclusive: false,
        },
      ]);
    });

    it('Skips windows that would be double-queried due to alignment', () => {
      expect(
        getGranularityAlignedTimeWindows(
          {
            dateRange: [
              new Date('2023-01-10 00:08:00'),
              new Date('2023-01-10 00:10:00'),
            ],
            granularity: '1 minute',
          },
          [
            15, // 15s
          ],
        ),
      ).toEqual([
        {
          dateRange: [
            new Date('2023-01-10 00:09:00'), // window is expanded beyond the desired 30s, to align to 1m granularity
            new Date('2023-01-10 00:10:00'),
          ],
          dateRangeEndInclusive: undefined,
        },
        {
          dateRange: [
            new Date('2023-01-10 00:08:00'),
            new Date('2023-01-10 00:09:00'),
          ],
          dateRangeEndInclusive: false,
        },
      ]);
    });

    it('returns windows aligned to the granularity if the granularity is smaller than the window size', () => {
      expect(
        getGranularityAlignedTimeWindows(
          {
            dateRange: [
              new Date('2023-01-09 22:00:40'),
              new Date('2023-01-10 00:00:30'),
            ],
            granularity: '1 minute',
            dateRangeEndInclusive: true,
          },
          [
            15 * 60, // 15m
            30 * 60, // 30m
          ],
        ),
      ).toEqual([
        {
          dateRange: [
            new Date('2023-01-09 23:45:00'), // Window is lengthened to align to granularity
            new Date('2023-01-10 00:00:30'),
          ],
          dateRangeEndInclusive: true,
        },
        {
          dateRange: [
            new Date('2023-01-09 23:15:00'),
            new Date('2023-01-09 23:45:00'),
          ],
          dateRangeEndInclusive: false,
        },
        {
          dateRange: [
            new Date('2023-01-09 22:45:00'),
            new Date('2023-01-09 23:15:00'),
          ],
          dateRangeEndInclusive: false,
        },
        {
          dateRange: [
            new Date('2023-01-09 22:15:00'),
            new Date('2023-01-09 22:45:00'),
          ],
          dateRangeEndInclusive: false,
        },
        {
          dateRange: [
            new Date('2023-01-09 22:00:40'), // Window is shortened to fit within the overall date range
            new Date('2023-01-09 22:15:00'),
          ],
          dateRangeEndInclusive: false,
        },
      ]);
    });

    it('does not return a window that starts before the overall start date', () => {
      expect(
        getGranularityAlignedTimeWindows(
          {
            dateRange: [
              new Date('2023-01-10 00:00:30'),
              new Date('2023-01-10 00:02:00'),
            ],
            granularity: '1 minute',
          },
          [
            60, // 1m
          ],
        ),
      ).toEqual([
        {
          dateRange: [
            new Date('2023-01-10 00:01:00'),
            new Date('2023-01-10 00:02:00'),
          ],
          dateRangeEndInclusive: undefined,
        },
        {
          dateRange: [
            new Date('2023-01-10 00:00:30'), // Window is shortened to fit within the overall date range
            new Date('2023-01-10 00:01:00'),
          ],
          dateRangeEndInclusive: false,
        },
      ]);
    });
  });
});
