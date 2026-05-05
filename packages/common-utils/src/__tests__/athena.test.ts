import {
  AthenaClient as SdkAthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  StopQueryExecutionCommand,
} from '@aws-sdk/client-athena';
import { mockClient } from 'aws-sdk-client-mock';

import { AthenaClient } from '../athena';
import {
  convertCellValue,
  convertTrinoTypeToJsType,
} from '../athena/typeMapping';

const sdkMock = mockClient(SdkAthenaClient);

beforeEach(() => {
  sdkMock.reset();
});

describe('convertTrinoTypeToJsType', () => {
  it.each([
    ['varchar', 'string'],
    ['char(10)', 'string'],
    ['tinyint', 'number'],
    ['smallint', 'number'],
    ['integer', 'number'],
    ['bigint', 'number'],
    ['real', 'number'],
    ['double', 'number'],
    ['decimal(10,2)', 'number'],
    ['boolean', 'boolean'],
    ['date', 'date'],
    ['time', 'date'],
    ['timestamp', 'date'],
    ['timestamp with time zone', 'date'],
    ['array(varchar)', 'array'],
    ['map(varchar, integer)', 'map'],
    ['row(a varchar, b integer)', 'row'],
    ['json', 'json'],
  ])('maps %s to %s', (trino, expected) => {
    expect(convertTrinoTypeToJsType(trino)).toBe(expected);
  });

  it('handles uppercase', () => {
    expect(convertTrinoTypeToJsType('VARCHAR')).toBe('string');
  });

  it('returns "unknown" for unrecognised types', () => {
    expect(convertTrinoTypeToJsType('hyperloglog')).toBe('unknown');
  });
});

describe('convertCellValue', () => {
  it('returns null for null/undefined raw values', () => {
    expect(convertCellValue(null, 'string')).toBeNull();
    expect(convertCellValue(undefined, 'number')).toBeNull();
  });

  it('parses numbers', () => {
    expect(convertCellValue('42', 'number')).toBe(42);
    expect(convertCellValue('3.14', 'number')).toBeCloseTo(3.14);
  });

  it('parses booleans', () => {
    expect(convertCellValue('true', 'boolean')).toBe(true);
    expect(convertCellValue('false', 'boolean')).toBe(false);
  });

  it('passes date strings through as-is', () => {
    expect(convertCellValue('2024-01-01', 'date')).toBe('2024-01-01');
  });

  it.each(['array', 'map', 'row', 'json'] as const)(
    'JSON-parses %s payloads',
    jsType => {
      expect(convertCellValue('[1,2,3]', jsType)).toEqual([1, 2, 3]);
    },
  );

  it('falls back to raw on JSON parse error', () => {
    expect(convertCellValue('not-json', 'json')).toBe('not-json');
  });
});

describe('AthenaClient.executeSync', () => {
  it('returns results when the query finishes within the timeout', async () => {
    sdkMock
      .on(StartQueryExecutionCommand)
      .resolves({ QueryExecutionId: 'exec-1' });
    sdkMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: { State: 'SUCCEEDED' },
        Statistics: { DataScannedInBytes: 1024 },
      },
    });
    sdkMock.on(GetQueryResultsCommand).resolves({
      ResultSet: {
        ResultSetMetadata: {
          ColumnInfo: [
            { Name: 'id', Type: 'integer' },
            { Name: 'name', Type: 'varchar' },
          ],
        },
        Rows: [
          { Data: [{ VarCharValue: 'id' }, { VarCharValue: 'name' }] },
          { Data: [{ VarCharValue: '1' }, { VarCharValue: 'alice' }] },
        ],
      },
    });

    const client = new AthenaClient({ region: 'us-east-1' });
    const result = await client.executeSync('SELECT id, name FROM users', {
      workgroup: 'primary',
      outputLocation: 's3://b/r/',
      region: 'us-east-1',
      syncTimeoutMs: 5000,
    });

    expect(result.executionId).toBe('exec-1');
    expect(result.status).toBe('finished');
    expect(result.scannedBytes).toBe(1024);
    expect(result.rows).toEqual([{ id: 1, name: 'alice' }]);
    expect(result.schema).toEqual([
      { name: 'id', type: 'integer', jsType: 'number' },
      { name: 'name', type: 'varchar', jsType: 'string' },
    ]);
  });

  it('passes ResultReuseConfiguration on every StartQueryExecution', async () => {
    sdkMock
      .on(StartQueryExecutionCommand)
      .resolves({ QueryExecutionId: 'exec-rr' });
    sdkMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: { State: 'SUCCEEDED' },
        Statistics: { DataScannedInBytes: 0 },
      },
    });
    sdkMock.on(GetQueryResultsCommand).resolves({
      ResultSet: { ResultSetMetadata: { ColumnInfo: [] }, Rows: [] },
    });

    const client = new AthenaClient({ region: 'us-east-1' });
    await client.executeSync('SELECT 1', {
      workgroup: 'primary',
      outputLocation: 's3://b/r/',
      region: 'us-east-1',
      resultReuseTtlMin: 30,
      syncTimeoutMs: 5000,
    });

    const calls = sdkMock.commandCalls(StartQueryExecutionCommand);
    expect(calls.length).toBe(1);
    expect(calls[0].args[0].input.ResultReuseConfiguration).toEqual({
      ResultReuseByAgeConfiguration: {
        Enabled: true,
        MaxAgeInMinutes: 30,
      },
    });
  });
});

describe('AthenaClient.executeSync timeout fallback', () => {
  it('returns running status when timeout elapses before finish', async () => {
    sdkMock
      .on(StartQueryExecutionCommand)
      .resolves({ QueryExecutionId: 'exec-2' });
    sdkMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: { Status: { State: 'RUNNING' } },
    });

    const client = new AthenaClient({ region: 'us-east-1' });
    const start = Date.now();
    const result = await client.executeSync('SELECT 1', {
      workgroup: 'wg',
      outputLocation: 's3://b/',
      region: 'us-east-1',
      syncTimeoutMs: 500,
    });
    expect(Date.now() - start).toBeGreaterThanOrEqual(500);
    expect(result.status).toBe('running');
    expect(result.executionId).toBe('exec-2');
  });
});

describe('AthenaClient.executeAsync', () => {
  it('starts a query and returns the execution id immediately', async () => {
    sdkMock
      .on(StartQueryExecutionCommand)
      .resolves({ QueryExecutionId: 'exec-async' });

    const client = new AthenaClient({ region: 'us-east-1' });
    const result = await client.executeAsync('SELECT 1', {
      workgroup: 'wg',
      outputLocation: 's3://b/',
      region: 'us-east-1',
    });

    expect(result.executionId).toBe('exec-async');
    expect(sdkMock.commandCalls(GetQueryExecutionCommand).length).toBe(0);
  });
});

describe('AthenaClient.getStatus', () => {
  it.each([
    ['QUEUED', 'queued'],
    ['RUNNING', 'running'],
    ['SUCCEEDED', 'finished'],
    ['FAILED', 'failed'],
    ['CANCELLED', 'cancelled'],
  ])('maps SDK state %s to %s', async (sdkState, expected) => {
    sdkMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: { Status: { State: sdkState } },
    });
    const client = new AthenaClient({ region: 'us-east-1' });
    await expect(client.getStatus('exec-status')).resolves.toBe(expected);
  });
});

describe('AthenaClient.getResults', () => {
  it('returns the second page when nextToken is provided (does not skip first row)', async () => {
    sdkMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: { State: 'SUCCEEDED' },
        Statistics: { DataScannedInBytes: 10 },
      },
    });
    sdkMock.on(GetQueryResultsCommand).resolves({
      ResultSet: {
        ResultSetMetadata: {
          ColumnInfo: [{ Name: 'n', Type: 'integer' }],
        },
        Rows: [{ Data: [{ VarCharValue: '99' }] }],
      },
      NextToken: 'token-abc',
    });

    const client = new AthenaClient({ region: 'us-east-1' });
    const page = await client.getResults('exec-page', 'token-prev');

    expect(page.rows).toEqual([{ n: 99 }]);
    expect(page.nextToken).toBe('token-abc');
    const resultCalls = sdkMock.commandCalls(GetQueryResultsCommand);
    expect(resultCalls[0].args[0].input.NextToken).toBe('token-prev');
  });
});

describe('AthenaClient.cancel', () => {
  it('invokes StopQueryExecution', async () => {
    sdkMock.on(StopQueryExecutionCommand).resolves({});
    const client = new AthenaClient({ region: 'us-east-1' });
    await client.cancel('exec-3');
    const calls = sdkMock.commandCalls(StopQueryExecutionCommand);
    expect(calls.length).toBe(1);
    expect(calls[0].args[0].input.QueryExecutionId).toBe('exec-3');
  });
});

describe('AthenaClient error classification', () => {
  it('classifies AccessDenied as access_denied (non-retryable)', async () => {
    sdkMock
      .on(StartQueryExecutionCommand)
      .resolves({ QueryExecutionId: 'exec-4' });
    sdkMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: {
          State: 'FAILED',
          StateChangeReason:
            'AccessDenied: principal does not have GetTable on glue',
        },
      },
    });
    const client = new AthenaClient({ region: 'us-east-1' });
    await expect(
      client.executeSync('SELECT 1', {
        workgroup: 'wg',
        outputLocation: 's3://b/',
        region: 'us-east-1',
        syncTimeoutMs: 5000,
      }),
    ).rejects.toMatchObject({ code: 'access_denied', retryable: false });
  });

  it('classifies missing-column reasons as column_not_found', async () => {
    sdkMock
      .on(StartQueryExecutionCommand)
      .resolves({ QueryExecutionId: 'exec-col' });
    sdkMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: {
          State: 'FAILED',
          StateChangeReason: "Column 'foo' does not exist",
        },
      },
    });
    const client = new AthenaClient({ region: 'us-east-1' });
    await expect(
      client.executeSync('SELECT foo', {
        workgroup: 'wg',
        outputLocation: 's3://b/',
        region: 'us-east-1',
        syncTimeoutMs: 5000,
      }),
    ).rejects.toMatchObject({ code: 'column_not_found', retryable: false });
  });

  it('classifies missing-table reasons as table_not_found', async () => {
    sdkMock
      .on(StartQueryExecutionCommand)
      .resolves({ QueryExecutionId: 'exec-tbl' });
    sdkMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: {
          State: 'FAILED',
          StateChangeReason: "Table 'db.t' not found",
        },
      },
    });
    const client = new AthenaClient({ region: 'us-east-1' });
    await expect(
      client.executeSync('SELECT * FROM db.t', {
        workgroup: 'wg',
        outputLocation: 's3://b/',
        region: 'us-east-1',
        syncTimeoutMs: 5000,
      }),
    ).rejects.toMatchObject({ code: 'table_not_found', retryable: false });
  });

  it('classifies syntax errors as syntax_error', async () => {
    sdkMock
      .on(StartQueryExecutionCommand)
      .resolves({ QueryExecutionId: 'exec-syn' });
    sdkMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: {
          State: 'FAILED',
          StateChangeReason: 'line 1:8: SYNTAX ERROR near "FROMM"',
        },
      },
    });
    const client = new AthenaClient({ region: 'us-east-1' });
    await expect(
      client.executeSync('SELECT * FROMM t', {
        workgroup: 'wg',
        outputLocation: 's3://b/',
        region: 'us-east-1',
        syncTimeoutMs: 5000,
      }),
    ).rejects.toMatchObject({ code: 'syntax_error', retryable: false });
  });

  it('classifies throttling reasons as retryable', async () => {
    sdkMock
      .on(StartQueryExecutionCommand)
      .resolves({ QueryExecutionId: 'exec-thr' });
    sdkMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: {
          State: 'FAILED',
          StateChangeReason: 'ThrottlingException: rate exceeded',
        },
      },
    });
    const client = new AthenaClient({ region: 'us-east-1' });
    await expect(
      client.executeSync('SELECT 1', {
        workgroup: 'wg',
        outputLocation: 's3://b/',
        region: 'us-east-1',
        syncTimeoutMs: 5000,
      }),
    ).rejects.toMatchObject({ code: 'throttled', retryable: true });
  });
});
