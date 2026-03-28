import * as React from 'react';
import { useMemo } from 'react';
import {
  Control,
  Controller,
  UseFormSetValue,
  useWatch,
} from 'react-hook-form';
import { NumberFormat } from '@hyperdx/common-utils/dist/types';
import {
  Checkbox as MCheckbox,
  NativeSelect,
  Paper,
  Slider,
  Stack,
  TextInput,
} from '@mantine/core';
import {
  IconClock,
  IconCurrencyDollar,
  IconDatabase,
  IconNumbers,
  IconPercentage,
} from '@tabler/icons-react';

import { formatNumber } from '../utils';

import { ChartConfigDisplaySettings } from './ChartDisplaySettingsDrawer';

const FORMAT_ICONS: Record<string, React.ReactNode> = {
  number: <IconNumbers size={14} />,
  currency: <IconCurrencyDollar size={14} />,
  percent: <IconPercentage size={14} />,
  byte: <IconDatabase size={14} />,
  time: <IconClock size={14} />,
  data_rate: <IconDatabase size={14} />,
  throughput: <IconNumbers size={14} />,
};

const TEST_NUMBER = 1234;

export const DEFAULT_NUMBER_FORMAT: NumberFormat = {
  factor: 1,
  output: 'number' as const,
  mantissa: 2,
  thousandSeparated: true,
  average: false,
  decimalBytes: false,
};

type UnitOption = { value: string; label: string };
type UnitGroup = { group: string; items: UnitOption[] };

const DATA_UNIT_OPTIONS: UnitOption[] = [
  { value: 'bytes_iec', label: 'bytes (IEC)' },
  { value: 'bytes_si', label: 'bytes (SI)' },
  { value: 'bits_iec', label: 'bits (IEC)' },
  { value: 'bits_si', label: 'bits (SI)' },
  { value: 'kibibytes', label: 'kibibytes' },
  { value: 'kilobytes', label: 'kilobytes' },
  { value: 'mebibytes', label: 'mebibytes' },
  { value: 'megabytes', label: 'megabytes' },
  { value: 'gibibytes', label: 'gibibytes' },
  { value: 'gigabytes', label: 'gigabytes' },
  { value: 'tebibytes', label: 'tebibytes' },
  { value: 'terabytes', label: 'terabytes' },
  { value: 'pebibytes', label: 'pebibytes' },
  { value: 'petabytes', label: 'petabytes' },
];

const DATA_RATE_UNIT_OPTIONS: UnitOption[] = [
  { value: 'packets_sec', label: 'packets/sec' },
  { value: 'bytes_sec_iec', label: 'bytes/sec (IEC)' },
  { value: 'bytes_sec_si', label: 'bytes/sec (SI)' },
  { value: 'bits_sec_iec', label: 'bits/sec (IEC)' },
  { value: 'bits_sec_si', label: 'bits/sec (SI)' },
  { value: 'kibibytes_sec', label: 'kibibytes/sec' },
  { value: 'kibibits_sec', label: 'kibibits/sec' },
  { value: 'kilobytes_sec', label: 'kilobytes/sec' },
  { value: 'kilobits_sec', label: 'kilobits/sec' },
  { value: 'mebibytes_sec', label: 'mebibytes/sec' },
  { value: 'mebibits_sec', label: 'mebibits/sec' },
  { value: 'megabytes_sec', label: 'megabytes/sec' },
  { value: 'megabits_sec', label: 'megabits/sec' },
  { value: 'gibibytes_sec', label: 'gibibytes/sec' },
  { value: 'gibibits_sec', label: 'gibibits/sec' },
  { value: 'gigabytes_sec', label: 'gigabytes/sec' },
  { value: 'gigabits_sec', label: 'gigabits/sec' },
  { value: 'tebibytes_sec', label: 'tebibytes/sec' },
  { value: 'tebibits_sec', label: 'tebibits/sec' },
  { value: 'terabytes_sec', label: 'terabytes/sec' },
  { value: 'terabits_sec', label: 'terabits/sec' },
  { value: 'pebibytes_sec', label: 'pebibytes/sec' },
  { value: 'pebibits_sec', label: 'pebibits/sec' },
  { value: 'petabytes_sec', label: 'petabytes/sec' },
  { value: 'petabits_sec', label: 'petabits/sec' },
];

const THROUGHPUT_UNIT_OPTIONS: UnitOption[] = [
  { value: 'cps', label: 'counts/sec (cps)' },
  { value: 'ops', label: 'ops/sec (ops)' },
  { value: 'rps', label: 'requests/sec (rps)' },
  { value: 'reads_sec', label: 'reads/sec (rps)' },
  { value: 'wps', label: 'writes/sec (wps)' },
  { value: 'iops', label: 'I/O ops/sec (iops)' },
  { value: 'cpm', label: 'counts/min (cpm)' },
  { value: 'opm', label: 'ops/min (opm)' },
  { value: 'rpm_reads', label: 'reads/min (rpm)' },
  { value: 'wpm', label: 'writes/min (wpm)' },
];

const UNIT_OPTIONS_BY_OUTPUT: Record<string, UnitOption[]> = {
  byte: DATA_UNIT_OPTIONS,
  data_rate: DATA_RATE_UNIT_OPTIONS,
  throughput: THROUGHPUT_UNIT_OPTIONS,
};

const DEFAULT_NUMERIC_UNIT_BY_OUTPUT: Record<string, string> = {
  byte: 'bytes_iec',
  data_rate: 'bytes_sec_iec',
  throughput: 'cps',
};

const OUTPUT_CATEGORY_OPTIONS: UnitGroup[] = [
  {
    group: 'Basic',
    items: [
      { value: 'number', label: 'Number' },
      { value: 'currency', label: 'Currency' },
      { value: 'percent', label: 'Percentage' },
      { value: 'time', label: 'Time' },
    ],
  },
  {
    group: 'Data',
    items: [{ value: 'byte', label: 'Data' }],
  },
  {
    group: 'Network',
    items: [
      { value: 'data_rate', label: 'Data rate' },
      { value: 'throughput', label: 'Throughput' },
    ],
  },
];

const hasNumericUnit = (output: string) =>
  output === 'byte' || output === 'data_rate' || output === 'throughput';

export const NumberFormatForm: React.FC<{
  control: Control<ChartConfigDisplaySettings>;
  setValue: UseFormSetValue<ChartConfigDisplaySettings>;
}> = ({ control, setValue }) => {
  const format =
    useWatch({ control, name: 'numberFormat' }) ?? DEFAULT_NUMBER_FORMAT;

  const unitOptions = useMemo(
    () =>
      format.output ? (UNIT_OPTIONS_BY_OUTPUT[format.output] ?? null) : null,
    [format.output],
  );

  return (
    <>
      <Stack style={{ flex: 1 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'nowrap',
            alignItems: 'stretch',
            justifyContent: 'stretch',
            gap: 10,
          }}
        >
          <Controller
            control={control}
            key="numberFormat.output"
            name="numberFormat.output"
            render={({ field: { onChange, ...field } }) => (
              <NativeSelect
                {...field}
                label="Output format"
                leftSection={format.output && FORMAT_ICONS[format.output]}
                style={{ flex: 1 }}
                data={OUTPUT_CATEGORY_OPTIONS}
                onChange={e => {
                  const newOutput = e.target.value as NumberFormat['output'];
                  onChange(newOutput);
                  setValue(
                    'numberFormat.numericUnit',
                    DEFAULT_NUMERIC_UNIT_BY_OUTPUT[newOutput] ?? undefined,
                  );
                }}
              />
            )}
          />
          {format.output === 'currency' && (
            <Controller
              control={control}
              key="numberFormat.currencySymbol"
              name="numberFormat.currencySymbol"
              render={({ field }) => (
                <TextInput {...field} w={80} label="Symbol" placeholder="$" />
              )}
            />
          )}
        </div>

        {unitOptions && (
          <Controller
            control={control}
            key="numberFormat.numericUnit"
            name="numberFormat.numericUnit"
            render={({ field: { value, onChange, ...field } }) => (
              <NativeSelect
                {...field}
                label="Unit"
                value={
                  value ?? DEFAULT_NUMERIC_UNIT_BY_OUTPUT[format.output ?? '']
                }
                onChange={e => onChange(e.target.value)}
                data={unitOptions}
              />
            )}
          />
        )}

        <div style={{ marginTop: -6 }}>
          <Paper p="xs" py={4}>
            <div
              style={{
                fontSize: 11,
              }}
            >
              Example
            </div>
            {formatNumber(TEST_NUMBER || 0, {
              ...format,
              numericUnit:
                format.numericUnit ??
                (format.output
                  ? DEFAULT_NUMERIC_UNIT_BY_OUTPUT[format.output]
                  : undefined),
            })}
          </Paper>
        </div>

        {format.output !== 'time' && (
          <div>
            <div className="fs-8 mt-2 fw-bold mb-1">Decimals</div>
            <Controller
              control={control}
              key="numberFormat.mantissa"
              name="numberFormat.mantissa"
              render={({ field: { value, onChange } }) => (
                <Slider
                  mb="xl"
                  min={0}
                  max={10}
                  label={val => `Decimals: ${val}`}
                  marks={[
                    { value: 0, label: '0' },
                    { value: 10, label: '10' },
                  ]}
                  value={value ?? 2}
                  onChange={onChange}
                />
              )}
            />
          </div>
        )}

        <Stack gap="xs">
          {format.output === 'byte' && !format.numericUnit ? (
            <Controller
              control={control}
              key="numberFormat.decimalBytes"
              name="numberFormat.decimalBytes"
              render={({ field: { value, onChange, ...field } }) => {
                return (
                  <MCheckbox
                    {...field}
                    size="xs"
                    label="Decimal base"
                    description="Use 1KB = 1000 bytes"
                    checked={value}
                    onChange={onChange}
                  />
                );
              }}
            />
          ) : format.output === 'time' ? (
            <Controller
              control={control}
              key="numberFormat.factor"
              name="numberFormat.factor"
              render={({ field: { value, onChange, ...field } }) => {
                const options = [
                  { value: '1', label: 'Seconds' },
                  { value: '0.001', label: 'Milliseconds' },
                  { value: '0.000001', label: 'Microseconds' },
                  { value: '0.000000001', label: 'Nanoseconds' },
                ];

                const stringValue =
                  options.find(option => parseFloat(option.value) === value)
                    ?.value ?? '1';

                return (
                  <NativeSelect
                    {...field}
                    size="sm"
                    label="Input unit"
                    value={stringValue}
                    onChange={e => onChange(parseFloat(e.target.value))}
                    data={options}
                  />
                );
              }}
            />
          ) : !hasNumericUnit(format.output ?? '') ? (
            <>
              <Controller
                control={control}
                key="numberFormat.thousandSeparated"
                name="numberFormat.thousandSeparated"
                render={({ field: { value, onChange, ...field } }) => (
                  <MCheckbox
                    {...field}
                    size="xs"
                    label="Separate thousands"
                    description="For example: 1,234,567"
                    checked={value}
                    onChange={onChange}
                  />
                )}
              />
              <Controller
                control={control}
                key="numberFormat.average"
                name="numberFormat.average"
                render={({ field: { value, onChange, ...field } }) => (
                  <MCheckbox
                    {...field}
                    size="xs"
                    label="Large number format"
                    description="For example: 1.2m"
                    checked={value}
                    onChange={onChange}
                  />
                )}
              />
            </>
          ) : null}
        </Stack>
      </Stack>
    </>
  );
};
