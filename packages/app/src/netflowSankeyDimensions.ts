import {
  ColumnMeta,
  convertCHDataTypeToJSType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { quoteIdentifierIfNeeded } from '@hyperdx/common-utils/dist/core/metadata';
import { TNetflowSource } from '@hyperdx/common-utils/dist/types';

import { getNetflowDimensions } from '@/netflow';
import { SankeyDimension } from '@/netflowSankey';

export function getSankeyDimensionOptions(
  source: TNetflowSource,
  columns: ColumnMeta[],
): SankeyDimension[] {
  const labels: Record<string, string> = {
    srcAddr: 'Source IP',
    dstAddr: 'Destination IP',
    protocol: 'Protocol',
    exporter: 'Exporter',
    inputInterface: 'Input interface',
    outputInterface: 'Output interface',
  };
  const mapped = Object.entries(getNetflowDimensions(source)).flatMap(
    ([key, expression]) =>
      expression ? [{ key, label: labels[key], expression }] : [],
  );
  const scalarTypes = [
    JSDataType.String,
    JSDataType.Number,
    JSDataType.Bool,
    JSDataType.Date,
  ];
  return [
    ...mapped,
    ...columns
      .filter(column => {
        const type = convertCHDataTypeToJSType(column.type);
        return type !== null && scalarTypes.includes(type);
      })
      .map(column => ({
        key: `column:${column.name}`,
        label: column.name,
        expression: quoteIdentifierIfNeeded(column.name),
      })),
  ];
}

export function getDefaultSankeyDimensions(
  options: SankeyDimension[],
): string[] {
  const akvorado = [
    'column:SrcAS',
    'column:InIfConnectivity',
    'column:InIfProvider',
    'exporter',
  ];
  return akvorado.every(key => options.some(option => option.key === key))
    ? akvorado
    : ['srcAddr', 'protocol', 'dstAddr'];
}
