import { ClickhouseClient } from '@/clickhouse/node';
import { getMetadata } from '@/core/metadata';
import { CustomSchemaSQLSerializerV2 } from '@/queryParser';

describe('CustomSchemaSQLSerializerV2 - json', () => {
  function getTestTable(field) {
    return { name: field, type: 'JSON' };
  }
  const metadata = getMetadata(
    new ClickhouseClient({ host: 'http://localhost:8123' }),
  );
  // @ts-ignore
  metadata.getColumn = ({ column }) => {
    return new Promise((resolve, reject) => {
      if (column.indexOf('.') >= 0) return resolve(undefined);
      const testTable = getTestTable(column);
      // @ts-ignore
      return resolve(testTable);
    });
  };
  const databaseName = 'testName';
  const tableName = 'testTable';
  const connectionId = 'testId';
  const serializer = new CustomSchemaSQLSerializerV2({
    metadata,
    databaseName,
    tableName,
    connectionId,
  });

  it('getColumnForField', async () => {
    const field1 = 'serviceName.test';
    const res1 = await serializer.getColumnForField(field1);
    expect(res1).toEqual({
      column: '',
      columnJSON: {
        number:
          "dynamicType(`serviceName`.`test`) in ('Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Float32', 'Float64') and `serviceName`.`test`",
        string: 'toString(`serviceName`.`test`)',
      },
      found: true,
      propertyType: 'json',
    });
    const field2 = 'logBody.test.nest';
    const res2 = await serializer.getColumnForField(field2);
    expect(res2).toEqual({
      column: '',
      columnJSON: {
        number:
          "dynamicType(`logBody`.`test`.`nest`) in ('Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Float32', 'Float64') and `logBody`.`test`.`nest`",
        string: 'toString(`logBody`.`test`.`nest`)',
      },
      found: true,
      propertyType: 'json',
    });
  });

  it('compare - eq, isNotNull, gte, lte, lt, gt', async () => {
    const eqField = 'serviceName.eq.test';
    const eqTerm = 'testTerm';
    const eq1 = await serializer.eq(eqField, eqTerm, false);
    expect(eq1).toBe("(toString(`serviceName`.`eq`.`test`) = 'testTerm')");
    const eq2 = await serializer.eq(eqField, eqTerm, true);
    expect(eq2).toBe("(toString(`serviceName`.`eq`.`test`) != 'testTerm')");
  });

  it('compare - isNotNull', async () => {
    const isNotNullField = 'serviceName.isNotNull.test';
    const isNotNull1 = await serializer.isNotNull(isNotNullField, false);
    expect(isNotNull1).toBe(
      'notEmpty(toString(`serviceName`.`isNotNull`.`test`)) = 1',
    );
    const isNotNull2 = await serializer.isNotNull(isNotNullField, true);
    expect(isNotNull2).toBe(
      'notEmpty(toString(`serviceName`.`isNotNull`.`test`)) != 1',
    );
  });

  it('compare - gte', async () => {
    const gteField = 'serviceName.gte.test';
    const gteTerm = '30';
    const gte = await serializer.gte(gteField, gteTerm);
    expect(gte).toBe(
      "(dynamicType(`serviceName`.`gte`.`test`) in ('Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Float32', 'Float64') and `serviceName`.`gte`.`test` >= '30')",
    );
  });

  it('compare - lte', async () => {
    const lteField = 'serviceName.lte.test';
    const lteTerm = '40';
    const lte = await serializer.lte(lteField, lteTerm);
    expect(lte).toBe(
      "(dynamicType(`serviceName`.`lte`.`test`) in ('Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Float32', 'Float64') and `serviceName`.`lte`.`test` <= '40')",
    );
  });

  it('compare - gt', async () => {
    const gtField = 'serviceName.gt.test';
    const gtTerm = '70';
    const gt = await serializer.gt(gtField, gtTerm);
    expect(gt).toBe(
      "(dynamicType(`serviceName`.`gt`.`test`) in ('Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Float32', 'Float64') and `serviceName`.`gt`.`test` > '70')",
    );
  });

  it('compare - lt', async () => {
    const ltField = 'serviceName.lt.test';
    const ltTerm = '2';
    const lt = await serializer.lt(ltField, ltTerm);
    expect(lt).toBe(
      "(dynamicType(`serviceName`.`lt`.`test`) in ('Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Float32', 'Float64') and `serviceName`.`lt`.`test` < '2')",
    );
  });
});
