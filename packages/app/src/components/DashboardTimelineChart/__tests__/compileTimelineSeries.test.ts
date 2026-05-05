import type { TimelineSeries } from '@hyperdx/common-utils/dist/types';

import {
  compileSingleSeries,
  compileTimelineSeries,
} from '../compileTimelineSeries';

const mockSource = {
  from: { databaseName: 'default', tableName: 'log_stream' },
  timestampValueExpression: 'TimestampTime',
};

describe('compileSingleSeries', () => {
  it('compiles an events series', () => {
    const series: TimelineSeries = {
      id: '1',
      label: 'Errors',
      mode: 'events',
      source: 'src1',
      where: "SeverityText = 'ERROR'",
      labelExpression: 'Body',
      groupExpression: 'ServiceName',
    };

    const sql = compileSingleSeries(series, mockSource);
    expect(sql).toContain('TimestampTime AS ts');
    expect(sql).toContain('(Body) AS label');
    expect(sql).toContain('(ServiceName) AS `group`');
    expect(sql).toContain("'Errors' AS __series");
    expect(sql).toContain('`default`.`log_stream`');
    expect(sql).toContain("(SeverityText = 'ERROR')");
    expect(sql).toContain('ORDER BY ts ASC');
    expect(sql).toContain('LIMIT 1000');
  });

  it('compiles events series without group expression', () => {
    const series: TimelineSeries = {
      id: '1',
      label: 'All Events',
      mode: 'events',
      source: 'src1',
      labelExpression: 'Body',
    };

    const sql = compileSingleSeries(series, mockSource);
    expect(sql).not.toContain('`group`');
    expect(sql).toContain("'All Events' AS __series");
  });

  it('compiles events series without where clause', () => {
    const series: TimelineSeries = {
      id: '1',
      label: 'Events',
      mode: 'events',
      source: 'src1',
      labelExpression: 'Body',
    };

    const sql = compileSingleSeries(series, mockSource);
    expect(sql).not.toContain('AND ()');
    expect(sql).toContain('$__filters');
  });

  it('compiles a value_change series with explicit groupExpression', () => {
    const series: TimelineSeries = {
      id: '2',
      label: 'Deployments',
      mode: 'value_change',
      source: 'src1',
      whereLanguage: 'lucene',
      trackColumn: "ResourceAttributes['service.version']",
      groupExpression: 'ServiceName',
    };

    const sql = compileSingleSeries(series, mockSource);
    expect(sql).toContain('lagInFrame');
    expect(sql).toContain("ResourceAttributes['service.version']");
    expect(sql).toContain('PARTITION BY ServiceName');
    expect(sql).toContain("prev_value != ''");
    expect(sql).toContain('new_value != prev_value');
    expect(sql).toContain("'Deployments' AS __series");
  });

  it('uses ServiceName as the default groupExpression for value_change', () => {
    const series: TimelineSeries = {
      id: '2',
      label: 'Changes',
      mode: 'value_change',
      source: 'src1',
      whereLanguage: 'lucene',
      trackColumn: 'StatusCode',
    };

    const sql = compileSingleSeries(series, mockSource);
    expect(sql).toContain('PARTITION BY ServiceName');
  });

  it('uses groupExpression for both partition and label in value_change', () => {
    const series: TimelineSeries = {
      id: '3',
      label: 'Pod Image Changes',
      mode: 'value_change',
      source: 'src1',
      whereLanguage: 'lucene',
      trackColumn: "ResourceAttributes['k8s.pod.image']",
      groupExpression: "ResourceAttributes['k8s.pod.name']",
    };

    const sql = compileSingleSeries(series, mockSource);
    // Both PARTITION BY and the lane group key derive from groupExpression
    expect(sql).toContain("PARTITION BY ResourceAttributes['k8s.pod.name']");
    expect(sql).toContain('partition_key AS `group`');
  });
});

describe('compileTimelineSeries', () => {
  it('returns empty string for empty series list', () => {
    const result = compileTimelineSeries([], new Map());
    expect(result).toBe('');
  });

  it('returns single query for one series (no UNION ALL)', () => {
    const series: TimelineSeries[] = [
      {
        id: '1',
        label: 'Events',
        mode: 'events',
        source: 'src1',
        labelExpression: 'Body',
      },
    ];

    const sources = new Map([['src1', mockSource]]);
    const result = compileTimelineSeries(series, sources);
    expect(result).not.toContain('UNION ALL');
    expect(result).toContain('TimestampTime AS ts');
  });

  it('produces UNION ALL for multiple series', () => {
    const series: TimelineSeries[] = [
      {
        id: '1',
        label: 'Errors',
        mode: 'events',
        source: 'src1',
        labelExpression: 'Body',
      },
      {
        id: '2',
        label: 'Deploys',
        mode: 'value_change',
        source: 'src1',
        trackColumn: "ResourceAttributes['service.version']",
      },
    ];

    const sources = new Map([['src1', mockSource]]);
    const result = compileTimelineSeries(series, sources);
    expect(result).toContain('UNION ALL');
    expect(result).toContain("'Errors' AS __series");
    expect(result).toContain("'Deploys' AS __series");
    // Outer ORDER BY
    expect(result).toMatch(/\)\nORDER BY ts ASC$/);
  });

  it('skips series with missing source', () => {
    const series: TimelineSeries[] = [
      {
        id: '1',
        label: 'Events',
        mode: 'events',
        source: 'missing-source',
        labelExpression: 'Body',
      },
    ];

    const sources = new Map([['src1', mockSource]]);
    const result = compileTimelineSeries(series, sources);
    expect(result).toBe('');
  });
});
