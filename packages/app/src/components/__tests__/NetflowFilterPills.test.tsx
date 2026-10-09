import { enableMapSet } from 'immer';
import { parseQuery } from '@hyperdx/common-utils/dist/filters';
import {
  Filter,
  SourceKind,
  TNetflowSource,
} from '@hyperdx/common-utils/dist/types';
import { act, renderHook } from '@testing-library/react';

import { useNetflowFilterState } from '@/components/NetflowFilterPills';
import { getNetflowDimensions } from '@/netflow';
import { sankeyDimensionExpression } from '@/netflowSankey';

enableMapSet();

const source: TNetflowSource = {
  id: 'flows',
  name: 'Flows',
  kind: SourceKind.Netflow,
  connection: 'local',
  from: { databaseName: 'default', tableName: 'flows' },
  timestampValueExpression: 'TimeReceived',
  defaultTableSelectExpression: '*',
  bytesExpression: 'Bytes',
  packetsExpression: 'Packets',
  srcAddrExpression: 'SrcAddr',
  dstAddrExpression: 'DstAddr',
  srcPortExpression: 'SrcPort',
  dstPortExpression: 'DstPort',
  protocolExpression: 'Proto',
  exporterExpression: 'ExporterName',
};
const mapped = getNetflowDimensions(source);
const exporter = {
  key: 'exporter',
  label: 'Exporter',
  expression: 'ExporterName',
};

function renderFilters(filters: Filter[] = [], selectedSource = source) {
  const onChange = jest.fn();
  let currentFilters = filters;
  const hook = renderHook(() =>
    useNetflowFilterState({
      source: selectedSource,
      filters: currentFilters,
      onChange,
    }),
  );
  const emitted = () => parseQuery(onChange.mock.lastCall?.[0] ?? []).filters;
  const syncUrl = () => {
    currentFilters = onChange.mock.lastCall?.[0] ?? currentFilters;
    hook.rerender();
  };
  return { ...hook, onChange, emitted, syncUrl };
}

describe('NetFlow explicit filter actions', () => {
  it.each([
    ['exporter', 'edge-a', 'edge-b'],
    ['protocol', 'TCP', 'UDP'],
    ['srcAddr', '192.0.2.1', '192.0.2.2'],
  ] as const)(
    'combines %s values from table and Sankey into one include set',
    (field, first, second) => {
      const { result, emitted, syncUrl } = renderFilters();
      act(() => result.current.onFilter(field, first, false));
      syncUrl();
      act(() =>
        result.current.onDimensionFilter(
          { key: field, label: field, expression: mapped[field]! },
          second,
          false,
        ),
      );
      expect(Object.values(emitted())).toEqual([
        { included: new Set([first, second]), excluded: new Set() },
      ]);
    },
  );

  it('repeated Include and Exclude are idempotent and preserve other included values', () => {
    const { result, emitted } = renderFilters();
    act(() => {
      result.current.onFilter('exporter', 'edge-a', false);
      result.current.onFilter('exporter', 'edge-a', false);
    });
    act(() => result.current.onFilter('exporter', 'edge-b', false));
    act(() => {
      result.current.onDimensionFilter(exporter, 'edge-a', true);
      result.current.onDimensionFilter(exporter, 'edge-a', true);
    });
    expect(Object.values(emitted())).toEqual([
      { included: new Set(['edge-b']), excluded: new Set(['edge-a']) },
    ]);
    act(() => result.current.onFilter('exporter', 'edge-a', false));
    expect(Object.values(emitted())).toEqual([
      { included: new Set(['edge-b', 'edge-a']), excluded: new Set() },
    ]);
  });

  it('migrates legacy table and Sankey keys without losing unrelated filters', () => {
    const unrelated: Filter = { type: 'sql', condition: 'Bytes > 100' };
    const { emitted, onChange } = renderFilters([
      { type: 'sql', condition: "ExporterName IN ('edge-a')" },
      {
        type: 'sql',
        condition: `${sankeyDimensionExpression(exporter)} IN ('edge-b')`,
      },
      unrelated,
    ]);
    expect(Object.values(emitted())).toEqual([
      { included: new Set(['edge-a', 'edge-b']), excluded: new Set() },
    ]);
    expect(onChange.mock.lastCall?.[0]).toContainEqual(unrelated);
  });

  it('retains empty custom dimension filters and makes repeated actions idempotent', () => {
    const { result, emitted } = renderFilters();
    const dimension = {
      key: 'column:provider',
      label: 'Provider',
      expression: "Labels['provider']",
    };
    act(() => result.current.onDimensionFilter(dimension, '', false));
    act(() => result.current.onDimensionFilter(dimension, '', false));
    expect(emitted()).toEqual({
      [sankeyDimensionExpression(dimension)]: {
        included: new Set(['']),
        excluded: new Set(),
      },
    });
  });
});

describe('quoted NetFlow filter expressions', () => {
  it.each(['mapped', 'custom'] as const)(
    'preserves a quoted %s column through reload, another filter, and pill removal',
    kind => {
      const selectedSource = { ...source, exporterExpression: '`router-name`' };
      const dimension = {
        key: 'column:provider-name',
        label: 'Provider',
        expression: '`provider-name`',
      };
      const { result, emitted, syncUrl } = renderFilters([], selectedSource);
      const expression =
        kind === 'mapped'
          ? sankeyDimensionExpression({
              ...exporter,
              expression: '`router-name`',
            })
          : sankeyDimensionExpression(dimension);
      act(() => {
        if (kind === 'mapped')
          result.current.onFilter('exporter', 'edge-a', false);
        else result.current.onDimensionFilter(dimension, 'transit', false);
      });
      expect(emitted()).toHaveProperty(expression);
      syncUrl();
      act(() => result.current.onFilter('protocol', 'TCP', false));
      expect(emitted()).toHaveProperty(expression);
      syncUrl();
      const protocolField = Object.keys(result.current.state.filters).find(
        field => field.includes('transform('),
      )!;
      act(() =>
        result.current.state.setFilterValue(protocolField, 'TCP', 'include'),
      );
      expect(Object.keys(emitted())).toEqual([expression]);
      syncUrl();
      const remainingField = Object.keys(result.current.state.filters)[0];
      act(() =>
        result.current.state.setFilterValue(
          remainingField,
          kind === 'mapped' ? 'edge-a' : 'transit',
          'include',
        ),
      );
      expect(emitted()).toEqual({});
    },
  );
});
