import { PromqlReducer } from '@hyperdx/common-utils/dist/types';

import { stripClientSideConfigFields } from '@/utils/chartConfig';

describe('stripClientSideConfigFields', () => {
  const promqlConfig = {
    configType: 'promql' as const,
    connection: 'conn',
    promqlExpression: [
      {
        expression: 'up',
        queryType: 'range' as const,
        reducer: PromqlReducer.Max,
      },
      { expression: 'rate(http[5m])', alias: 'requests' },
    ],
  };

  it('drops the reducer from every expression', () => {
    expect(stripClientSideConfigFields(promqlConfig)).toEqual({
      ...promqlConfig,
      promqlExpression: [
        { expression: 'up', queryType: 'range' },
        { expression: 'rate(http[5m])', alias: 'requests' },
      ],
    });
  });

  it('normalizes the bare-string expression shape', () => {
    expect(
      stripClientSideConfigFields({ ...promqlConfig, promqlExpression: 'up' }),
    ).toEqual({ ...promqlConfig, promqlExpression: [{ expression: 'up' }] });
  });

  it('returns a non-PromQL config unchanged', () => {
    const config = {
      select: 'count()',
      from: { databaseName: 'db', tableName: 'logs' },
      where: '',
      connection: 'conn',
    };

    expect(stripClientSideConfigFields(config)).toBe(config);
  });
});
