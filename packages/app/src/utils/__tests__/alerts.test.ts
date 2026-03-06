import { normalizeNoOpAlertScheduleFields } from '../alerts';

describe('normalizeNoOpAlertScheduleFields', () => {
  it('drops no-op schedule fields for pre-migration alerts', () => {
    const normalized = normalizeNoOpAlertScheduleFields(
      {
        scheduleOffsetMinutes: 0,
        scheduleStartAt: null,
      },
      {},
    );

    expect(normalized).toEqual({});
  });

  it('treats undefined previous values as absent fields', () => {
    const normalized = normalizeNoOpAlertScheduleFields(
      {
        scheduleOffsetMinutes: 0,
        scheduleStartAt: null,
      },
      {
        scheduleOffsetMinutes: undefined,
        scheduleStartAt: undefined,
      },
    );

    expect(normalized).toEqual({});
  });

  it('keeps no-op fields when they were already persisted', () => {
    const normalized = normalizeNoOpAlertScheduleFields(
      {
        scheduleOffsetMinutes: 0,
        scheduleStartAt: null,
      },
      {
        scheduleOffsetMinutes: 0,
        scheduleStartAt: null,
      },
    );

    expect(normalized).toEqual({
      scheduleOffsetMinutes: 0,
      scheduleStartAt: null,
    });
  });

  it('keeps non-default schedule fields', () => {
    const normalized = normalizeNoOpAlertScheduleFields(
      {
        scheduleOffsetMinutes: 3,
        scheduleStartAt: '2024-01-01T00:00:00.000Z',
      },
      {},
    );

    expect(normalized).toEqual({
      scheduleOffsetMinutes: 3,
      scheduleStartAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('keeps an explicit offset reset when requested', () => {
    const normalized = normalizeNoOpAlertScheduleFields(
      {
        scheduleOffsetMinutes: 0,
      },
      undefined,
      {
        preserveExplicitScheduleOffsetMinutes: true,
      },
    );

    expect(normalized).toEqual({
      scheduleOffsetMinutes: 0,
    });
  });

  it('keeps an explicit start-at clear when requested', () => {
    const normalized = normalizeNoOpAlertScheduleFields(
      {
        scheduleStartAt: null,
      },
      undefined,
      {
        preserveExplicitScheduleStartAt: true,
      },
    );

    expect(normalized).toEqual({
      scheduleStartAt: null,
    });
  });
});
