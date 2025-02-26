import { formatAttributeClause, formatDate } from '../utils';

describe('utils', () => {
  it('12h utc', () => {
    const date = new Date('2021-01-01T12:00:00Z');
    expect(
      formatDate(date, {
        clock: '12h',
        isUTC: true,
      }),
    ).toEqual('Jan 1 12:00:00 PM');
  });

  it('24h utc', () => {
    const date = new Date('2021-01-01T12:00:00Z');
    expect(
      formatDate(date, {
        clock: '24h',
        isUTC: true,
        format: 'withMs',
      }),
    ).toEqual('Jan 1 12:00:00.000');
  });

  it('12h local', () => {
    const date = new Date('2021-01-01T12:00:00');
    expect(
      formatDate(date, {
        clock: '12h',
        isUTC: false,
      }),
    ).toEqual('Jan 1 12:00:00 PM');
  });

  it('24h local', () => {
    const date = new Date('2021-01-01T12:00:00');
    expect(
      formatDate(date, {
        clock: '24h',
        isUTC: false,
        format: 'withMs',
      }),
    ).toEqual('Jan 1 12:00:00.000');
  });
});

describe('formatAttributeClause', () => {
  it('should format SQL attribute clause correctly', () => {
    expect(
      formatAttributeClause('ResourceAttributes', 'service', 'nginx', true),
    ).toBe("ResourceAttributes['service']='nginx'");

    expect(formatAttributeClause('metadata', 'environment', 'prod', true)).toBe(
      "metadata['environment']='prod'",
    );

    expect(formatAttributeClause('data', 'user-id', 'abc-123', true)).toBe(
      "data['user-id']='abc-123'",
    );
  });

  it('should format lucene attribute clause correctly', () => {
    expect(formatAttributeClause('attrs', 'service', 'nginx', false)).toBe(
      'attrs.service:"nginx"',
    );

    expect(
      formatAttributeClause('metadata', 'environment', 'prod', false),
    ).toBe('metadata.environment:"prod"');

    expect(formatAttributeClause('data', 'user-id', 'abc-123', false)).toBe(
      'data.user-id:"abc-123"',
    );
  });
});
